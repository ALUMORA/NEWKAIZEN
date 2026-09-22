"""Rutas v1 del backend viejo (``/stock``, ``/chart``, ``/rf``...) con respuestas idénticas.

Se montan solo con ``KAIZEN_LEGACY_ROUTES`` (encendido por defecto fuera de producción) y sirven a
la UI vieja durante la transición. Reproducen ``Handler.do_GET``/``do_POST`` de backend.py:

* Mismo despacho sobre la ruta cruda (``raw_path``) partida por ``/`` y decodificada por segmento,
  mismos parámetros (``parse_qs``) y misma validación de ticker (``re`` de Python).
* Semántica HTTP 200 con ``{"error": ...}`` y cuerpo ``json.dumps(result, default=str)``, byte por
  byte igual que antes (incluidos ``NaN`` si una función los devolviera).
* Con AUTH_REQUIRED también exigen ``Authorization: Bearer`` (401 con el cuerpo de error v2).

Diferencias deliberadas con el backend viejo:

* ``/health`` es el nuevo (forma v2); la UI vieja solo revisa ``status == "ok"``.
* Se quitó ``/debug/macro`` (exponía llamadas crudas a proveedores) y el precalentamiento de la
  Fórmula Mágica al arrancar (8 s después del arranque bajaba ~80 tickers de Yahoo).
* Una ruta desconocida da 404 con el cuerpo de error v2 en vez de 200 ``{"error": "Ruta no
  encontrada"}``. Las rutas conocidas sin segmento (``/stock``) siguen dando ese 200 del legado.
* ``POST /login`` verifica contra USERS con scrypt (o texto plano fuera de producción), comparte
  el límite de tasa de ``/auth/login`` (429 con ``Retry-After``) y no emite token.
* CORS lo decide la configuración (ALLOWED_ORIGINS y ALLOWED_ORIGIN_REGEX), ya no ``*``.
"""

from __future__ import annotations

import json
import re
from typing import Any
from urllib.parse import parse_qs, quote, unquote, urlparse

from fastapi import APIRouter, Depends, Request, Response
from starlette.concurrency import run_in_threadpool

from kaizen_api.domain.fundamentals import get_stock
from kaizen_api.domain.fx import get_fx
from kaizen_api.domain.history import get_chart, get_returns
from kaizen_api.domain.macro import get_macro
from kaizen_api.domain.markets import get_market, get_worldmap
from kaizen_api.domain.news import get_market_news, get_news
from kaizen_api.domain.rates import get_rf
from kaizen_api.domain.screeners.fibras import get_fibras
from kaizen_api.domain.screeners.insiders import get_insiders
from kaizen_api.domain.screeners.magic import get_magic_formula, get_magic_one
from kaizen_api.domain.screeners.momentum import get_momentum
from kaizen_api.domain.statements import get_edgar_financials
from kaizen_api.domain.valuation.multiples import get_dcf
from kaizen_api.routers.auth import check_login_rate
from kaizen_api.schemas import SYMBOL_PATTERN
from kaizen_api.security.auth import app_settings, authenticate, require_user
from kaizen_api.security.ratelimit import retry_after_header

CAPABILITIES: list[str] = ["legacy.v1"]

_TICKER_RE = re.compile(SYMBOL_PATTERN)
_POST_MAX_BYTES = 10 * 1024
# Rutas cuyo segundo segmento es un ticker
_TICKER_ROUTES = {"stock", "chart", "news", "dcf", "edgar", "magic_one", "insiders", "momentum", "returns"}
LEGACY_GET_PREFIXES = (
    "stock",
    "chart",
    "rf",
    "news",
    "macro",
    "market",
    "worldmap",
    "dcf",
    "edgar",
    "fibras",
    "magic",
    "magic_one",
    "insiders",
    "momentum",
    "returns",
    "fx",
)

LEGACY_FUNCTIONS: dict[str, Any] = {
    "get_stock": get_stock,
    "get_chart": get_chart,
    "get_rf": get_rf,
    "get_market_news": get_market_news,
    "get_news": get_news,
    "get_macro": get_macro,
    "get_market": get_market,
    "get_worldmap": get_worldmap,
    "get_dcf": get_dcf,
    "get_edgar_financials": get_edgar_financials,
    "get_fibras": get_fibras,
    "get_magic_formula": get_magic_formula,
    "get_magic_one": get_magic_one,
    "get_insiders": get_insiders,
    "get_momentum": get_momentum,
    "get_returns": get_returns,
    "get_fx": get_fx,
}
"""Nombre de la función del legado (el de los goldens) a su implementación en el paquete."""

MSG_LOGIN_RATE = "Demasiados intentos. Espera un momento y vuelve a intentarlo."


def legacy_dispatch(target: str) -> Any:
    """Lo mismo que ``Handler.do_GET`` para ``target`` = ruta cruda más ``?query``."""
    parsed = urlparse(target)
    parts = [unquote(p) for p in parsed.path.strip("/").split("/")]
    params = parse_qs(parsed.query)
    try:
        is_market_news = parts[0] == "news" and len(parts) > 1 and parts[1] == "market"
        if parts[0] in _TICKER_ROUTES and len(parts) > 1 and not is_market_news and not _TICKER_RE.match(parts[1]):
            result = {"error": "Ticker inválido"}
        elif parts[0] == "stock" and len(parts) > 1:
            result = get_stock(parts[1])
        elif parts[0] == "chart" and len(parts) > 1:
            period = params.get("period", ["5y"])[0]
            result = get_chart(parts[1], period, params.get("ccy", [""])[0])
        elif parts[0] == "rf":
            result = get_rf()
        elif parts[0] == "news" and len(parts) > 1 and parts[1] == "market":
            result = get_market_news()
        elif parts[0] == "news" and len(parts) > 1:
            result = get_news(parts[1])
        elif parts[0] == "macro":
            result = get_macro()
        elif parts[0] == "market":
            result = get_market()
        elif parts[0] == "worldmap":
            result = get_worldmap()
        elif parts[0] == "dcf" and len(parts) > 1:
            result = get_dcf(parts[1])
        elif parts[0] == "edgar" and len(parts) > 1:
            result = get_edgar_financials(parts[1])
        elif parts[0] == "fibras" and len(parts) > 1:
            result = get_fibras(parts[1])
        elif parts[0] == "fibras":
            result = get_fibras()
        elif parts[0] == "magic":
            result = get_magic_formula()
        elif parts[0] == "magic_one" and len(parts) > 1:
            result = get_magic_one(parts[1])
        elif parts[0] == "insiders" and len(parts) > 1:
            result = get_insiders(parts[1])
        elif parts[0] == "momentum" and len(parts) > 1:
            result = get_momentum(parts[1])
        elif parts[0] == "returns" and len(parts) > 1:
            result = get_returns(parts[1])
        elif parts[0] == "fx":
            result = get_fx()
        else:
            result = {"error": "Ruta no encontrada"}
    except Exception as e:
        result = {"error": str(e)}
    return result


def legacy_json(result: Any, status_code: int = 200, headers: dict[str, str] | None = None) -> Response:
    """El cuerpo exacto del backend viejo: ``json.dumps(result, default=str)``."""
    body = json.dumps(result, default=str).encode()
    return Response(content=body, status_code=status_code, media_type="application/json", headers=headers)


def request_target(request: Request) -> str:
    """Ruta cruda (sin decodificar) más ``?query``, como ``self.path`` del BaseHTTPRequestHandler."""
    raw = request.scope.get("raw_path")
    path = raw.split(b"?", 1)[0].decode("latin-1") if raw else quote(request.scope.get("path", "/"))
    query = request.scope.get("query_string", b"").decode("latin-1")
    return f"{path}?{query}" if query else path


def legacy_get(request: Request) -> Response:
    return legacy_json(legacy_dispatch(request_target(request)))


async def legacy_login(request: Request) -> Response:
    """``POST /login`` del legado: 200 con ``{"ok": true}`` o ``{"ok": false, "error": ...}``."""
    try:
        length = int(request.headers.get("content-length", 0))
    except (TypeError, ValueError):
        length = -1
    too_big = length > _POST_MAX_BYTES
    if length < 0 or too_big:
        body = None  # no se lee el cuerpo
    else:
        body_raw = await request.body() if length > 0 else b"{}"
        try:
            body = json.loads(body_raw)
        except Exception:
            body = {}
        if not isinstance(body, dict):
            body = {}
    if body is None:
        return legacy_json({"error": "Cuerpo demasiado grande" if too_big else "Content-Length inválido"})
    username = str(body.get("username", "")).strip()
    password = str(body.get("password", ""))
    wait = check_login_rate(request, username)
    if wait is not None:
        return legacy_json({"ok": False, "error": MSG_LOGIN_RATE}, 429, {"Retry-After": retry_after_header(wait)})
    user = await run_in_threadpool(authenticate, username, password, app_settings(request))
    return legacy_json({"ok": True} if user else {"ok": False, "error": "Credenciales incorrectas"})


def build_router() -> APIRouter:
    """Router v1. Las rutas de datos llevan ``require_user`` (solo actúa con AUTH_REQUIRED)."""
    router = APIRouter(tags=["v1 (legado)"])
    auth = [Depends(require_user)]
    for prefix in LEGACY_GET_PREFIXES:
        for path in (f"/{prefix}", f"/{prefix}/{{rest:path}}"):
            router.add_api_route(
                path, legacy_get, methods=["GET"], dependencies=auth, include_in_schema=False, name=f"v1_{prefix}"
            )
    for path in ("/login", "/login/{rest:path}"):
        router.add_api_route(path, legacy_login, methods=["POST"], include_in_schema=False, name="v1_login")
    return router


router = build_router()
