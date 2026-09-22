"""Contraseñas (scrypt), tokens (JWT HS256) y las dependencias de FastAPI que exigen sesión.

* Hash: ``scrypt$<n>$<r>$<p>$<salt_hex>$<hash_hex>`` con n=2**14, r=8, p=1, sal de 16 bytes y
  32 bytes de salida. Se compara con ``hmac.compare_digest``.
* Token: JWT HS256 con ``sub`` (usuario), ``iat``, ``exp`` y ``ver`` (= TOKEN_VERSION). Subir
  TOKEN_VERSION revoca todos los tokens; quitar a alguien de USERS revoca los suyos.
* ``require_user``: exige ``Authorization: Bearer`` solo cuando AUTH_REQUIRED está activo.
  ``current_user``: siempre lo exige (``/auth/me``).
"""

from __future__ import annotations

import datetime as _dt
import hashlib
import hmac
import secrets
from dataclasses import dataclass

import jwt
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from kaizen_api.errors import ApiError
from kaizen_api.provenance import iso_instant
from kaizen_api.settings import SCRYPT_PREFIX, Settings, get_settings

SCRYPT_N = 2**14
SCRYPT_R = 8
SCRYPT_P = 1
SALT_BYTES = 16
DKLEN = 32
_MAXMEM = 2**27  # techo de memoria para scrypt (128 MiB); n y r se acotan abajo
JWT_ALGORITHM = "HS256"
JWT_REQUIRED_CLAIMS = ["sub", "iat", "exp", "ver"]
"""Sin cualquiera de estas el token no vale: así un JWT de otro emisor nunca se parece a uno nuestro."""
JWT_LEEWAY_SECONDS = 5
"""Tolerancia de reloj al validar ``exp``/``iat``. Chica a propósito: es para el desfase entre
máquinas (Render contra el navegador), no para alargar la sesión."""

MSG_BAD_CREDENTIALS = "Usuario o contraseña incorrectos."
MSG_NO_SESSION = "Necesitas iniciar sesión para ver esto."
MSG_EXPIRED = "Tu sesión expiró. Vuelve a iniciar sesión."
MSG_INVALID_TOKEN = "Tu sesión ya no es válida. Vuelve a iniciar sesión."


# ─── contraseñas ─────────────────────────────────────────────────────────────


def hash_password(password: str, *, n: int = SCRYPT_N, r: int = SCRYPT_R, p: int = SCRYPT_P, salt: bytes | None = None) -> str:
    if not isinstance(password, str) or password == "":
        raise ValueError("la contraseña no puede ir vacía")
    salt = salt if salt is not None else secrets.token_bytes(SALT_BYTES)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=n, r=r, p=p, dklen=DKLEN, maxmem=_MAXMEM)
    return f"{SCRYPT_PREFIX}{n}${r}${p}${salt.hex()}${digest.hex()}"


def parse_hash(encoded: str) -> tuple[int, int, int, bytes, bytes] | None:
    try:
        scheme, n_s, r_s, p_s, salt_hex, hash_hex = encoded.split("$")
        n, r, p = int(n_s), int(r_s), int(p_s)
        salt, expected = bytes.fromhex(salt_hex), bytes.fromhex(hash_hex)
    except (ValueError, AttributeError):
        return None
    # Límites para que un hash mal formado no dispare trabajo o memoria desmedidos.
    if scheme != "scrypt" or not (2 <= n <= 2**16 and n & (n - 1) == 0) or not 1 <= r <= 16 or not 1 <= p <= 4:
        return None
    if not salt or not 16 <= len(expected) <= 64:
        return None
    return n, r, p, salt, expected


def verify_password(password: str, encoded: str) -> bool:
    """``True`` si ``password`` corresponde al hash ``encoded``. Un hash inválido da ``False``."""
    parsed = parse_hash(encoded) if isinstance(encoded, str) else None
    if parsed is None or not isinstance(password, str):
        return False
    n, r, p, salt, expected = parsed
    try:
        digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=n, r=r, p=p, dklen=len(expected), maxmem=_MAXMEM)
    except (ValueError, MemoryError):
        return False
    return hmac.compare_digest(digest, expected)


_DUMMY_HASH = hash_password("kaizen-usuario-inexistente", salt=b"\x00" * SALT_BYTES)


def display_name(username: str) -> str:
    return username[:1].upper() + username[1:]


def authenticate(username: str, password: str, settings: Settings) -> str | None:
    """Devuelve el usuario normalizado si las credenciales son buenas, si no ``None``.

    Tarda lo mismo exista o no el usuario (se calcula un scrypt de relleno) para no revelar
    qué usuarios existen. Fuera de producción acepta valores en texto plano (con aviso al
    arrancar), como el backend viejo.
    """
    user = (username or "").strip().lower()
    if not user or not password:
        return None
    stored = settings.users.get(user)
    if stored is None:
        verify_password(password, _DUMMY_HASH)
        return None
    if stored.startswith(SCRYPT_PREFIX):
        return user if verify_password(password, stored) else None
    if settings.is_production:  # Settings.from_env ya lo impide; defensa en profundidad
        return None
    ok = hmac.compare_digest(stored.encode("utf-8"), password.encode("utf-8"))
    return user if ok else None


# ─── tokens ──────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Session:
    username: str
    expires_at: _dt.datetime

    @property
    def display_name(self) -> str:
        return display_name(self.username)

    def user_dict(self) -> dict:
        return {"username": self.username, "displayName": self.display_name}

    @property
    def expires_at_iso(self) -> str:
        return iso_instant(self.expires_at)


def create_token(username: str, settings: Settings, now: _dt.datetime | None = None) -> tuple[str, _dt.datetime]:
    now = (now or _dt.datetime.now(_dt.UTC)).replace(microsecond=0)
    expires = now + _dt.timedelta(hours=settings.token_ttl_hours)
    claims = {
        "sub": username,
        "iat": int(now.timestamp()),
        "exp": int(expires.timestamp()),
        "ver": settings.token_version,
    }
    return jwt.encode(claims, settings.secret_key, algorithm=JWT_ALGORITHM), expires


def verify_token(token: str, settings: Settings) -> Session:
    """Valida firma, vigencia, versión y que el usuario siga en USERS. Si no, ``ApiError`` 401.

    El algoritmo va fijo en HS256 (``algorithms=[JWT_ALGORITHM]``), así que un token con ``alg:none``
    o firmado con RS256 usando la llave pública como HMAC no pasa. ``require`` exige las cuatro
    afirmaciones que emitimos, y la tolerancia de reloj son ``JWT_LEEWAY_SECONDS`` segundos.
    """
    try:
        claims = jwt.decode(
            token,
            settings.secret_key,
            algorithms=[JWT_ALGORITHM],
            leeway=JWT_LEEWAY_SECONDS,
            options={"require": list(JWT_REQUIRED_CLAIMS)},
        )
    except jwt.ExpiredSignatureError as exc:
        raise _unauthorized(MSG_EXPIRED, "token_expired") from exc
    except jwt.PyJWTError as exc:
        raise _unauthorized(MSG_INVALID_TOKEN, "token_invalid") from exc
    username = claims.get("sub")
    if claims.get("ver") != settings.token_version:
        raise _unauthorized(MSG_INVALID_TOKEN, "token_revoked")
    if not isinstance(username, str) or username not in settings.users:
        raise _unauthorized(MSG_INVALID_TOKEN, "user_unknown")
    return Session(username=username, expires_at=_dt.datetime.fromtimestamp(int(claims["exp"]), _dt.UTC))


def _unauthorized(message: str, reason: str) -> ApiError:
    return ApiError(401, "UNAUTHORIZED", message, details={"reason": reason}, headers={"WWW-Authenticate": "Bearer"})


# ─── dependencias de FastAPI ─────────────────────────────────────────────────

bearer_scheme = HTTPBearer(auto_error=False, description="JWT de POST /auth/login")


def app_settings(request: Request) -> Settings:
    settings = getattr(request.app.state, "settings", None)
    return settings if isinstance(settings, Settings) else get_settings()


def _session_from(credentials: HTTPAuthorizationCredentials | None, settings: Settings) -> Session:
    if credentials is None or credentials.scheme.lower() != "bearer" or not credentials.credentials:
        raise _unauthorized(MSG_NO_SESSION, "missing_token")
    return verify_token(credentials.credentials, settings)


def require_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> Session | None:
    """Exige sesión solo si AUTH_REQUIRED está activo; si no, deja pasar (``None``)."""
    settings = app_settings(request)
    if not settings.auth_required:
        return None
    session = _session_from(credentials, settings)
    request.state.user = session.username
    return session


def current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> Session:
    """Siempre exige sesión (``/auth/me``)."""
    session = _session_from(credentials, app_settings(request))
    request.state.user = session.username
    return session
