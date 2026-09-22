"""Aplicación FastAPI: ``create_app()`` arma la app y ``run()`` la sirve con uvicorn.

Capas, de afuera hacia adentro: registro de cada request (id y tiempo), CORS, GZip (desde 1 KB),
captura de errores inesperados (500 INTERNAL sin texto de la excepción, con CORS) y los routers.

``kaizen_api.main.app`` se crea la primera vez que alguien lo pide (``uvicorn kaizen_api.main:app``
o ``scripts/run_replay_backend.py --module kaizen_api.main``), no al importar el módulo.
"""

from __future__ import annotations

import json
import logging
import re
import sys
import time
import traceback
import uuid
from typing import Any

from fastapi import Depends, FastAPI
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware

from kaizen_api import __version__
from kaizen_api.errors import error_body, install_exception_handlers
from kaizen_api.routers import (
    auth,
    health,
    history,
    legacy_v1,
    markets,
    news,
    quotes,
    rates,
    research,
    screeners,
    search,
)
from kaizen_api.security.auth import require_user
from kaizen_api.security.ratelimit import LoginRateLimiter
from kaizen_api.settings import Settings, SettingsError, configure, get_settings

logger = logging.getLogger("kaizen_api")

V2_ROUTERS = (quotes, history, rates, markets, news, search, research, screeners)
"""Routers de datos v2: con AUTH_REQUIRED exigen sesión."""

_REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")

CORS_ALLOW_HEADERS = ("Authorization", "Content-Type", "X-Request-ID")
"""Cabeceras que el navegador puede mandar desde otro origen (el preflight las autoriza)."""
CORS_EXPOSE_HEADERS = ("Retry-After", "X-Request-ID")
"""Cabeceras de respuesta que el JS de otro origen puede leer: el contrato le pide usarlas."""


class RequestLogMiddleware:
    """Una línea por request: método, ruta (sin query), status y milisegundos. Pone ``X-Request-ID``."""

    def __init__(self, app: Any):
        self.app = app

    async def __call__(self, scope: dict, receive: Any, send: Any) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        incoming = dict(scope.get("headers") or []).get(b"x-request-id", b"").decode("latin-1")
        rid = incoming if _REQUEST_ID_RE.match(incoming) else uuid.uuid4().hex[:16]
        scope.setdefault("state", {})["request_id"] = rid
        status = 500
        started = time.perf_counter()

        async def _send(message: dict) -> None:
            nonlocal status
            if message.get("type") == "http.response.start":
                status = message.get("status", 500)
                headers = list(message.get("headers") or [])
                headers.append((b"x-request-id", rid.encode("latin-1")))
                message = {**message, "headers": headers}
            await send(message)

        try:
            await self.app(scope, receive, _send)
        finally:
            ms = (time.perf_counter() - started) * 1000
            logger.info("%s %s %s %.0fms rid=%s", scope.get("method"), scope.get("path"), status, ms, rid)


class CatchAllMiddleware:
    """Convierte una excepción inesperada en 500 INTERNAL dentro de CORS (el navegador lo puede leer).

    Solo atrapa ``Exception``: ``ReplayMiss`` y ``NetworkBlocked`` (``BaseException``) siguen de largo
    para que el servidor de replay las reporte.
    """

    def __init__(self, app: Any):
        self.app = app

    async def __call__(self, scope: dict, receive: Any, send: Any) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        started = False

        async def _send(message: dict) -> None:
            nonlocal started
            if message.get("type") == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, receive, _send)
        except Exception as exc:
            rid = (scope.get("state") or {}).get("request_id")
            logger.error(
                "error interno en %s %s rid=%s\n%s",
                scope.get("method"),
                scope.get("path"),
                rid,
                "".join(traceback.format_exception(exc)),
            )
            if started:
                raise
            body = json.dumps(error_body("INTERNAL"), ensure_ascii=False).encode("utf-8")
            await send(
                {
                    "type": "http.response.start",
                    "status": 500,
                    "headers": [
                        (b"content-type", b"application/json"),
                        (b"content-length", str(len(body)).encode()),
                        (b"cache-control", b"no-store"),
                    ],
                }
            )
            await send({"type": "http.response.body", "body": body})


def _collect_capabilities(settings: Settings) -> list[str]:
    caps: list[str] = []
    modules = [health, auth, *V2_ROUTERS] + ([legacy_v1] if settings.legacy_routes else [])
    for module in modules:
        for cap in getattr(module, "CAPABILITIES", []):
            if cap not in caps:
                caps.append(cap)
    return caps


def create_app(settings: Settings | None = None) -> FastAPI:
    """Arma la app. Con ``settings=None`` lee el entorno (y lanza ``SettingsError`` si es inválido)."""
    settings = settings or get_settings()
    configure(settings)
    for warning in settings.warnings:
        logger.warning("configuración: %s", warning)

    docs = not settings.is_production
    app = FastAPI(
        title="KAIZEN API",
        version=settings.version or __version__,
        summary="Datos de mercado de México y EE. UU. con procedencia explícita",
        docs_url="/docs" if docs else None,
        redoc_url=None,
        openapi_url="/openapi.json" if docs else None,
    )
    app.state.settings = settings
    app.state.login_limiter = LoginRateLimiter()
    install_exception_handlers(app)

    app.include_router(health.router)
    app.include_router(auth.router)
    for module in V2_ROUTERS:
        app.include_router(module.router, dependencies=[Depends(require_user)])
    if settings.legacy_routes:
        app.include_router(legacy_v1.router)
    app.state.capabilities = _collect_capabilities(settings)

    # add_middleware apila hacia afuera: el último agregado es el más externo.
    app.add_middleware(CatchAllMiddleware)
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.allowed_origins),
        allow_origin_regex=settings.cors_origin_regex,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=list(CORS_ALLOW_HEADERS),
        expose_headers=list(CORS_EXPOSE_HEADERS),
        allow_credentials=False,
        max_age=600,
    )
    app.add_middleware(RequestLogMiddleware)
    logger.info(
        "KAIZEN API %s env=%s auth=%s legado=%s capacidades=%s",
        settings.version,
        settings.env,
        settings.auth_required,
        settings.legacy_routes,
        ",".join(app.state.capabilities),
    )
    return app


def _configure_logging() -> None:
    log = logging.getLogger("kaizen_api")
    if not any(getattr(h, "_kaizen", False) for h in log.handlers):
        handler = logging.StreamHandler(sys.stderr)
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        handler._kaizen = True  # type: ignore[attr-defined]
        log.addHandler(handler)
    log.setLevel(logging.INFO)
    log.propagate = False


def run() -> None:
    """Sirve la app con uvicorn en 0.0.0.0:PORT, un proceso. Configuración inválida: no arranca."""
    import uvicorn

    _configure_logging()
    try:
        settings = Settings.from_env()
        application = create_app(settings)
    except SettingsError as exc:
        logger.critical("configuración inválida: %s", exc)
        raise SystemExit(f"KAIZEN API no arranca: {exc}") from exc
    uvicorn.run(
        application,
        host="0.0.0.0",
        port=settings.port,
        workers=1,
        limit_concurrency=64,
        timeout_keep_alive=5,
        proxy_headers=True,
        forwarded_allow_ips="*",
        log_level="info",
        access_log=False,  # RequestLogMiddleware ya registra cada request, sin la query
    )


def __getattr__(name: str) -> Any:
    if name == "app":
        application = create_app()
        globals()["app"] = application
        return application
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
