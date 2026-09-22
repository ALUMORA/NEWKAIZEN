"""Configuración del API leída del entorno. Un solo objeto inmutable por proceso.

Variables (todas opcionales en desarrollo):

=====================  =========================================================================
PORT                   Puerto HTTP. Default 8002 (Render lo define solo).
KAIZEN_ENV             ``development`` (default) o ``production``.
AUTH_REQUIRED          ``true`` exige ``Authorization: Bearer`` en todo salvo /health y /auth/login.
SECRET_KEY             Llave HS256 de los JWT, 32 caracteres o más. En producción es obligatoria.
USERS                  JSON ``{"usuario": "scrypt$n$r$p$salt_hex$hash_hex"}`` (scripts/hash_password.py).
                       Fuera de producción también acepta contraseñas en texto plano, con aviso.
TOKEN_TTL_HOURS        Vigencia del token. Default 12.
TOKEN_VERSION          Subirlo invalida todos los tokens emitidos. Default 1.
ALLOWED_ORIGINS        Orígenes CORS exactos separados por coma.
ALLOWED_ORIGIN_REGEX   Regex de orígenes CORS. Default los previews de Vercel de newkaizen; fuera de
                       producción se suman http://localhost:* y http://127.0.0.1:*.
KAIZEN_LEGACY_ROUTES   Monta las rutas v1 (/stock, /chart...). Default encendido salvo en producción.
BANXICO_TOKEN          Token del SIE de Banxico.
FRED_API_KEY           Llave de la API de FRED.
EODHD_API_TOKEN        Token de EODHD.
KAIZEN_VERSION         Versión que reporta /health. Default ``kaizen_api.__version__``.
RENDER_GIT_COMMIT      Commit que reporta /health (Render lo define solo).
=====================  =========================================================================

Una configuración de producción inválida (sin SECRET_KEY, con contraseñas en texto plano o con
USERS mal formado) lanza ``SettingsError`` y el servidor no arranca.
"""

from __future__ import annotations

import json
import os
import re
from collections.abc import Mapping
from dataclasses import dataclass, field

DEFAULT_PORT = 8002
DEFAULT_ORIGIN_REGEX = r"^https://newkaizen(-[a-z0-9-]+)?\.vercel\.app$"
DEV_ORIGIN_REGEXES = (r"^http://localhost(:\d+)?$", r"^http://127\.0\.0\.1(:\d+)?$")
DEV_SECRET_KEY = "kaizen-dev-secret-key-solo-para-desarrollo-local"
MIN_SECRET_LENGTH = 32
SCRYPT_PREFIX = "scrypt$"

_TRUE = {"1", "true", "yes", "on", "si", "sí"}
_FALSE = {"0", "false", "no", "off"}


class SettingsError(RuntimeError):
    """Configuración inválida: el servidor no debe arrancar."""


def _flag(env: Mapping[str, str], name: str, default: bool) -> bool:
    raw = env.get(name)
    if raw is None or raw.strip() == "":
        return default
    value = raw.strip().lower()
    if value in _TRUE:
        return True
    if value in _FALSE:
        return False
    raise SettingsError(f"{name} debe ser true o false, no {raw!r}")


def _int(env: Mapping[str, str], name: str, default: int, lo: int, hi: int) -> int:
    raw = env.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        value = int(raw.strip())
    except ValueError as exc:
        raise SettingsError(f"{name} debe ser un entero, no {raw!r}") from exc
    if not lo <= value <= hi:
        raise SettingsError(f"{name} debe estar entre {lo} y {hi}")
    return value


def _parse_users(raw: str | None, production: bool, warnings: list[str]) -> dict[str, str]:
    """``USERS`` a ``{usuario_en_minúsculas: hash_o_texto}``. Nunca registra contraseñas."""
    if raw is None or raw.strip() == "":
        return {}
    try:
        data = json.loads(raw)
    except ValueError as exc:
        if production:
            raise SettingsError("USERS no es JSON válido") from exc
        warnings.append("USERS no es JSON válido; no hay usuarios configurados")
        return {}
    if not isinstance(data, dict):
        if production:
            raise SettingsError("USERS debe ser un objeto JSON {usuario: hash}")
        warnings.append("USERS debe ser un objeto JSON {usuario: hash}; se ignora")
        return {}
    users: dict[str, str] = {}
    plaintext: list[str] = []
    for name, secret in data.items():
        key = str(name).strip().lower()
        if not key or not isinstance(secret, str) or not secret:
            warnings.append(f"USERS: se ignora la entrada {key or '(vacía)'!r}, su valor no es texto")
            continue
        if not secret.startswith(SCRYPT_PREFIX):
            plaintext.append(key)
        users[key] = secret
    if plaintext:
        if production:
            raise SettingsError(
                "USERS tiene contraseñas en texto plano para: "
                + ", ".join(sorted(plaintext))
                + ". Genera hashes con scripts/hash_password.py"
            )
        warnings.append(
            "USERS tiene contraseñas en texto plano (solo se aceptan fuera de producción) para: "
            + ", ".join(sorted(plaintext))
        )
    return users


@dataclass(frozen=True)
class Settings:
    """Configuración resuelta. Los secretos no salen en ``repr``."""

    port: int = DEFAULT_PORT
    env: str = "development"
    auth_required: bool = False
    secret_key: str = field(default=DEV_SECRET_KEY, repr=False)
    users: dict[str, str] = field(default_factory=dict, repr=False)
    token_ttl_hours: int = 12
    token_version: int = 1
    allowed_origins: tuple[str, ...] = ()
    allowed_origin_regex: str = DEFAULT_ORIGIN_REGEX
    legacy_routes: bool = True
    banxico_token: str | None = field(default=None, repr=False)
    fred_api_key: str | None = field(default=None, repr=False)
    eodhd_api_token: str | None = field(default=None, repr=False)
    version: str = "dev"
    commit: str | None = None
    warnings: tuple[str, ...] = ()

    @property
    def is_production(self) -> bool:
        return self.env == "production"

    @property
    def cors_origin_regex(self) -> str:
        """Regex final para CORS: la configurada más localhost fuera de producción."""
        parts = [self.allowed_origin_regex]
        if not self.is_production:
            parts += list(DEV_ORIGIN_REGEXES)
        return "|".join(f"(?:{p})" for p in parts if p)

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> Settings:
        env = os.environ if env is None else env
        warnings: list[str] = []

        kaizen_env = (env.get("KAIZEN_ENV") or "development").strip().lower()
        if kaizen_env not in ("development", "production"):
            raise SettingsError(f"KAIZEN_ENV debe ser development o production, no {kaizen_env!r}")
        production = kaizen_env == "production"

        secret = env.get("SECRET_KEY") or ""
        if not secret:
            if production:
                raise SettingsError("SECRET_KEY es obligatoria en producción")
            secret = DEV_SECRET_KEY
            warnings.append("SECRET_KEY no está definida: se usa la llave de desarrollo")
        elif len(secret) < MIN_SECRET_LENGTH:
            if production:
                raise SettingsError(f"SECRET_KEY debe tener al menos {MIN_SECRET_LENGTH} caracteres")
            warnings.append(f"SECRET_KEY tiene menos de {MIN_SECRET_LENGTH} caracteres")

        origin_regex = env.get("ALLOWED_ORIGIN_REGEX") or DEFAULT_ORIGIN_REGEX
        try:
            re.compile(origin_regex)
        except re.error as exc:
            raise SettingsError(f"ALLOWED_ORIGIN_REGEX no es una regex válida: {exc}") from exc
        origins = tuple(o.strip().rstrip("/") for o in (env.get("ALLOWED_ORIGINS") or "").split(",") if o.strip())
        if "*" in origins:
            raise SettingsError("ALLOWED_ORIGINS no acepta '*': lista los orígenes exactos")

        auth_required = _flag(env, "AUTH_REQUIRED", False)
        users = _parse_users(env.get("USERS"), production, warnings)
        if auth_required and not users:
            warnings.append("AUTH_REQUIRED está activo pero USERS está vacío: nadie podrá entrar")

        from kaizen_api import __version__

        return cls(
            port=_int(env, "PORT", DEFAULT_PORT, 1, 65535),
            env=kaizen_env,
            auth_required=auth_required,
            secret_key=secret,
            users=users,
            token_ttl_hours=_int(env, "TOKEN_TTL_HOURS", 12, 1, 24 * 30),
            token_version=_int(env, "TOKEN_VERSION", 1, 1, 1_000_000),
            allowed_origins=origins,
            allowed_origin_regex=origin_regex,
            legacy_routes=_flag(env, "KAIZEN_LEGACY_ROUTES", not production),
            banxico_token=env.get("BANXICO_TOKEN") or None,
            fred_api_key=env.get("FRED_API_KEY") or None,
            eodhd_api_token=env.get("EODHD_API_TOKEN") or None,
            version=env.get("KAIZEN_VERSION") or __version__,
            commit=env.get("RENDER_GIT_COMMIT") or None,
            warnings=tuple(warnings),
        )


_current: Settings | None = None


def get_settings() -> Settings:
    """Configuración del proceso (se lee del entorno la primera vez)."""
    global _current
    if _current is None:
        _current = Settings.from_env()
    return _current


def configure(settings: Settings | None) -> None:
    """Fija (o con ``None`` olvida) la configuración del proceso. ``create_app`` la llama."""
    global _current
    _current = settings
