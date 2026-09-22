"""Configuración del API leída del entorno. Un solo objeto inmutable por proceso.

Variables (todas opcionales en desarrollo):

=====================  =========================================================================
PORT                   Puerto HTTP. Default 8002 (Render lo define solo).
KAIZEN_ENV             ``development`` (default) o ``production``.
AUTH_REQUIRED          ``true`` exige ``Authorization: Bearer`` en todo salvo /health y /auth/login.
SECRET_KEY             Llave HS256 de los JWT, 32 caracteres o más. Es obligatoria en producción y
                       siempre que AUTH_REQUIRED esté activo, en cualquier entorno.
USERS                  JSON ``{"usuario": "scrypt$n$r$p$salt_hex$hash_hex"}`` (scripts/hash_password.py
                       ``--json``). En producción cada hash se valida al arrancar. Fuera de
                       producción también acepta contraseñas en texto plano, con aviso.
TOKEN_TTL_HOURS        Vigencia del token. Default 12.
TOKEN_VERSION          Subirlo invalida todos los tokens emitidos. Default 1.
ALLOWED_ORIGINS        Orígenes CORS exactos separados por coma.
ALLOWED_ORIGIN_REGEX   Regex de orígenes CORS. Default los previews de Vercel de newkaizen; fuera de
                       producción se suman http://localhost:* y http://127.0.0.1:*.
VERCEL_TEAM_SLUG       Acota la regex default a los previews de un equipo de Vercel
                       (``newkaizen-<rama>-<equipo>.vercel.app``). El dominio de producción se pone
                       en ALLOWED_ORIGINS. Se ignora si ALLOWED_ORIGIN_REGEX viene explícita.
TRUSTED_PROXY_HOPS     Cuántos saltos finales de ``X-Forwarded-For`` escribe infraestructura de
                       confianza. Default 1 (Render). Con 0 se ignora la cabecera y se usa la IP del
                       socket. Es lo que decide con qué llave limita el login por IP.
LOGIN_RATE_LIMIT_IP_PER_MINUTE    Intentos de login por minuto y por IP. Default 5.
LOGIN_RATE_LIMIT_USER_PER_HOUR    Intentos FALLIDOS de login por hora y por usuario. Default 10.
                       Los dos solo se pueden RELAJAR fuera de producción.
MAX_CONCURRENCY        Requests en vuelo que atiende la app antes de contestar 503. Default 48, y
                       tiene que quedar por debajo del ``limit_concurrency`` de uvicorn (64).
KAIZEN_LEGACY_ROUTES   Monta las rutas v1 (/stock, /chart...). Default encendido salvo en producción,
                       donde hay que pedirlas explícitamente con ``KAIZEN_LEGACY_ROUTES=1``.
BANXICO_TOKEN          Token del SIE de Banxico.
FRED_API_KEY           Llave de la API de FRED.
EODHD_API_TOKEN        Token de EODHD.
KAIZEN_VERSION         Versión que reporta /health. Default ``kaizen_api.__version__``.
RENDER_GIT_COMMIT      Commit que reporta /health (Render lo define solo).
=====================  =========================================================================

Una configuración de producción inválida (sin SECRET_KEY, con contraseñas en texto plano o con
USERS mal formado) lanza ``SettingsError`` y el servidor no arranca.

``DEV_SECRET_KEY`` está en el repo, que es público: cualquiera puede firmar tokens con ella. Por eso
solo sirve en desarrollo con AUTH_REQUIRED apagado. Con AUTH_REQUIRED activo (en cualquier entorno)
o en producción, SECRET_KEY tiene que ser propia, de 32 caracteres o más y distinta de la de
desarrollo; si no, el servidor no arranca.
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

DEFAULT_LOGIN_IP_PER_MINUTE = 5
"""Intentos de login por minuto y por IP (spec v2). En producción no se puede subir."""
DEFAULT_LOGIN_USER_PER_HOUR = 10
"""Intentos FALLIDOS de login por hora y por usuario (spec v2). En producción no se puede subir."""
DEFAULT_TRUSTED_PROXY_HOPS = 1
"""Saltos finales de ``X-Forwarded-For`` que escribe infraestructura de confianza (1 = Render)."""
MAX_TRUSTED_PROXY_HOPS = 8
UVICORN_LIMIT_CONCURRENCY = 64
"""Último recurso de uvicorn: contesta 503 en texto plano, sin CORS ni cuerpo del contrato."""
DEFAULT_MAX_CONCURRENCY = 48
"""Guarda de la app, por debajo de la de uvicorn, para que el 503 salga con CORS y ErrorBody."""
_TEAM_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")

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


_DEV_KEY_MSG = (
    "SECRET_KEY no puede ser la llave de desarrollo (está publicada en el repo) en producción ni con "
    "AUTH_REQUIRED activo"
)


def _resolve_secret(secret: str, production: bool, auth_required: bool, warnings: list[str]) -> str:
    """La llave de los JWT. Sin llave propia y fuerte solo se arranca en desarrollo sin AUTH_REQUIRED."""
    strict = production or auth_required
    why = "en producción" if production else "con AUTH_REQUIRED activo"
    if not secret:
        if strict:
            raise SettingsError(f"SECRET_KEY es obligatoria {why}")
        warnings.append("SECRET_KEY no está definida: se usa la llave de desarrollo")
        return DEV_SECRET_KEY
    if secret == DEV_SECRET_KEY:
        if strict:
            raise SettingsError(_DEV_KEY_MSG)
        warnings.append("SECRET_KEY es la llave de desarrollo")
    elif len(secret) < MIN_SECRET_LENGTH:
        if strict:
            raise SettingsError(f"SECRET_KEY debe tener al menos {MIN_SECRET_LENGTH} caracteres {why}")
        warnings.append(f"SECRET_KEY tiene menos de {MIN_SECRET_LENGTH} caracteres")
    return secret


def _reject(production: bool, warnings: list[str], message: str) -> None:
    """En producción una configuración así no arranca; fuera de producción solo avisa."""
    if production:
        raise SettingsError(message)
    warnings.append(message)


def _valid_scrypt_hash(encoded: str) -> bool:
    """¿``encoded`` es un hash scrypt que ``verify_password`` puede usar?

    El import va aquí adentro a propósito: ``security/auth.py`` importa este módulo, así que a nivel
    de módulo sería un ciclo. Validar al arrancar evita el caso de S1: un ``scrypt$...`` mal formado
    se aceptaba en silencio y ese usuario nunca podía entrar.
    """
    from kaizen_api.security.auth import parse_hash

    return parse_hash(encoded) is not None


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
        if not key:
            _reject(production, warnings, "USERS tiene una entrada con el usuario vacío")
            continue
        if not isinstance(secret, str) or not secret:
            _reject(production, warnings, f"USERS: el valor de {key!r} no es una cadena de texto")
            continue
        if secret.startswith(SCRYPT_PREFIX):
            if not _valid_scrypt_hash(secret):
                # El hash no se imprime: es un secreto, aunque esté hasheado.
                _reject(production, warnings, f"USERS: el hash scrypt de {key!r} está mal formado")
                continue
        else:
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


_CONCURRENCY_MSG = (
    f"MAX_CONCURRENCY debe estar entre 1 y {UVICORN_LIMIT_CONCURRENCY - 1}: la guarda de la app va por "
    f"debajo del limit_concurrency de uvicorn ({UVICORN_LIMIT_CONCURRENCY}), que es el último recurso"
)


def _check_login_limits(ip_per_minute: int, user_per_hour: int) -> None:
    """En producción los límites del login solo se pueden apretar, nunca aflojar."""
    for name, value, default in (
        ("LOGIN_RATE_LIMIT_IP_PER_MINUTE", ip_per_minute, DEFAULT_LOGIN_IP_PER_MINUTE),
        ("LOGIN_RATE_LIMIT_USER_PER_HOUR", user_per_hour, DEFAULT_LOGIN_USER_PER_HOUR),
    ):
        if value > default:
            raise SettingsError(f"{name} no puede pasar de {default} en producción (solo se puede apretar)")


def _origin_regex(env: Mapping[str, str], production: bool, warnings: list[str]) -> str:
    """Regex de orígenes CORS: la explícita, la del equipo de Vercel, o la default (más ancha)."""
    explicit = (env.get("ALLOWED_ORIGIN_REGEX") or "").strip()
    slug = (env.get("VERCEL_TEAM_SLUG") or "").strip().lower()
    if explicit:
        if slug:
            warnings.append("VERCEL_TEAM_SLUG se ignora porque ALLOWED_ORIGIN_REGEX viene explícita")
        return explicit
    if slug:
        if not _TEAM_SLUG_RE.match(slug):
            raise SettingsError("VERCEL_TEAM_SLUG solo acepta letras, números y guiones")
        # Previews de ese equipo: newkaizen-<rama>-<equipo>.vercel.app. El dominio de producción
        # (newkaizen.vercel.app) se lista aparte en ALLOWED_ORIGINS.
        return rf"^https://newkaizen-[a-z0-9-]+-{re.escape(slug)}\.vercel\.app$"
    if production:
        warnings.append(
            "ALLOWED_ORIGIN_REGEX default: cualquier proyecto de Vercel que empiece con 'newkaizen-' "
            "puede llamar al API desde el navegador. Acota con VERCEL_TEAM_SLUG o ALLOWED_ORIGIN_REGEX"
        )
    return DEFAULT_ORIGIN_REGEX


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
    trusted_proxy_hops: int = DEFAULT_TRUSTED_PROXY_HOPS
    login_ip_per_minute: int = DEFAULT_LOGIN_IP_PER_MINUTE
    login_user_per_hour: int = DEFAULT_LOGIN_USER_PER_HOUR
    max_concurrency: int = DEFAULT_MAX_CONCURRENCY
    legacy_routes: bool = True
    banxico_token: str | None = field(default=None, repr=False)
    fred_api_key: str | None = field(default=None, repr=False)
    eodhd_api_token: str | None = field(default=None, repr=False)
    version: str = "dev"
    commit: str | None = None
    warnings: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        # Respaldo para quien arme Settings a mano sin pasar por from_env: la llave pública de
        # desarrollo nunca firma sesiones que protegen algo.
        if self.secret_key == DEV_SECRET_KEY and (self.auth_required or self.is_production):
            raise SettingsError(_DEV_KEY_MSG)
        # Mismo respaldo para los límites del login: aflojarlos es cómodo en desarrollo y en las
        # suites e2e, pero en producción es justo lo que abre la puerta a la fuerza bruta.
        if self.is_production:
            _check_login_limits(self.login_ip_per_minute, self.login_user_per_hour)
        if not 1 <= self.max_concurrency < UVICORN_LIMIT_CONCURRENCY:
            raise SettingsError(_CONCURRENCY_MSG)

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

        auth_required = _flag(env, "AUTH_REQUIRED", False)
        secret = _resolve_secret(env.get("SECRET_KEY") or "", production, auth_required, warnings)

        origin_regex = _origin_regex(env, production, warnings)
        try:
            re.compile(origin_regex)
        except re.error as exc:
            raise SettingsError(f"ALLOWED_ORIGIN_REGEX no es una regex válida: {exc}") from exc
        origins = tuple(o.strip().rstrip("/") for o in (env.get("ALLOWED_ORIGINS") or "").split(",") if o.strip())
        if "*" in origins:
            raise SettingsError("ALLOWED_ORIGINS no acepta '*': lista los orígenes exactos")

        users = _parse_users(env.get("USERS"), production, warnings)
        if auth_required and not users:
            warnings.append("AUTH_REQUIRED está activo pero USERS está vacío: nadie podrá entrar")

        ip_per_minute = _int(env, "LOGIN_RATE_LIMIT_IP_PER_MINUTE", DEFAULT_LOGIN_IP_PER_MINUTE, 1, 10_000)
        user_per_hour = _int(env, "LOGIN_RATE_LIMIT_USER_PER_HOUR", DEFAULT_LOGIN_USER_PER_HOUR, 1, 10_000)
        if production:
            _check_login_limits(ip_per_minute, user_per_hour)
        elif (ip_per_minute, user_per_hour) != (DEFAULT_LOGIN_IP_PER_MINUTE, DEFAULT_LOGIN_USER_PER_HOUR):
            warnings.append(f"límites del login fuera del default: {ip_per_minute}/min por IP, {user_per_hour}/h por usuario")

        legacy_routes = _flag(env, "KAIZEN_LEGACY_ROUTES", not production)
        if legacy_routes and production:
            warnings.append(
                "KAIZEN_LEGACY_ROUTES=1 en producción: las rutas v1 contestan 200 con {'error': ...} y "
                "pueden traer texto de excepciones. Apágalas en cuanto la UI nueva esté arriba"
            )

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
            trusted_proxy_hops=_int(env, "TRUSTED_PROXY_HOPS", DEFAULT_TRUSTED_PROXY_HOPS, 0, MAX_TRUSTED_PROXY_HOPS),
            login_ip_per_minute=ip_per_minute,
            login_user_per_hour=user_per_hour,
            max_concurrency=_int(env, "MAX_CONCURRENCY", DEFAULT_MAX_CONCURRENCY, 1, UVICORN_LIMIT_CONCURRENCY - 1),
            legacy_routes=legacy_routes,
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
