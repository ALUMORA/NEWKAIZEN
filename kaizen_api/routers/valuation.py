"""Valuación y momentum 12-1 (stream B3b).

``GET /v2/valuation/{symbol}`` entrega tres bloques que no se mezclan: **múltiplos relativos**
contra la referencia sectorial de Damodaran (enero 2026), un **DCF de FCFF en dos etapas** con su
tabla de sensibilidad, y el **P/VL justificado** cuando la emisora es banco o aseguradora. Lo que
no aplica sale con ``applicable=false`` y su razón en español, nunca con un número inventado.

``GET /v2/momentum/{symbol}`` entrega el 12-1 (12 meses saltándose el último) sobre cierres
ajustados de fin de mes, contra una referencia en la MISMA moneda.

Movidas sin cambios desde ``research.py`` en M1: misma ruta, parámetros, validación,
``response_model`` y ``Cache-Control``.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query

from kaizen_api.cache import _cached
from kaizen_api.domain.screeners.momentum import NoHistory, get_momentum_v2
from kaizen_api.domain.valuation.service import get_valuation
from kaizen_api.errors import ApiError
from kaizen_api.provenance import meta
from kaizen_api.routers import CACHE_SECONDS, ERROR_RESPONSES, SymbolPath, cache_control
from kaizen_api.schemas import MomentumResponse, ValuationResponse

router = APIRouter(prefix="/v2", tags=["investigación"], responses=ERROR_RESPONSES)
CAPABILITIES: list[str] = ["valuation.multiples", "valuation.dcf", "momentum"]


@router.get(
    "/valuation/{symbol}",
    response_model=ValuationResponse,
    dependencies=[cache_control("fundamentals")],
    summary="Múltiplos contra el sector, DCF con sensibilidad y P/B justificado para bancos",
)
def valuation(
    symbol: SymbolPath,
    erp: Annotated[float | None, Query(ge=0, le=0.2, description="Prima de riesgo de mercado, fracción")] = None,
    crp: Annotated[float | None, Query(ge=0, le=0.2, description="Prima de riesgo país, fracción")] = None,
    terminal_growth: Annotated[
        float | None, Query(alias="terminalGrowth", ge=-0.02, le=0.06, description="Crecimiento terminal, fracción")
    ] = None,
    years: Annotated[int | None, Query(ge=1, le=15, description="Años de proyección explícita")] = None,
    growth: Annotated[float | None, Query(ge=-0.5, le=1.0, description="Crecimiento del FCFF, fracción anual")] = None,
) -> ValuationResponse:
    key = f"v2:valuation:{symbol.upper()}:{erp}:{crp}:{terminal_growth}:{years}:{growth}"
    payload = _cached(
        key,
        lambda: get_valuation(
            symbol,
            erp=erp,
            crp=crp,
            terminal_growth=terminal_growth,
            years=years,
            growth=growth,
        ),
        ttl=CACHE_SECONDS["fundamentals"],
    )
    raw = payload["meta"]
    return {
        **payload,
        "meta": meta(
            raw["source"],
            as_of=raw.get("asOf"),
            delay_minutes=raw.get("delayMinutes"),
            stale=bool(raw.get("stale")),
            fallback=bool(raw.get("fallback")),
            notes=list(raw.get("notes") or []),
        ),
    }


@router.get(
    "/momentum/{symbol}",
    response_model=MomentumResponse,
    dependencies=[cache_control("history")],
    summary="Rendimiento 12-1, 6 y 3 meses contra su referencia",
)
def momentum(symbol: SymbolPath) -> MomentumResponse:
    key = f"v2:momentum:{symbol.upper()}"
    try:
        payload = _cached(key, lambda: get_momentum_v2(symbol), ttl=CACHE_SECONDS["history"])
    except NoHistory as exc:
        raise ApiError(404, "NOT_FOUND", f"No encontramos precios mensuales de {symbol.upper()}.") from exc
    except ApiError:
        raise
    except Exception as exc:
        raise ApiError(503, "UPSTREAM_UNAVAILABLE", "No pudimos leer el histórico de precios.") from exc
    body = {k: v for k, v in payload.items() if not k.startswith("_")}
    body["meta"] = meta(
        "yahoo,computed",
        as_of=payload.get("_asOf"),
        delay_minutes=None,
        stale=bool(payload.get("_stale")),
        fallback=False,
        notes=payload.get("_notes") or [],
    )
    return body
