"""Valuación y momentum 12-1 (stream B3b).

Mientras B3b no las implemente responden 501 NOT_IMPLEMENTED. Al implementar una, agrega su
capacidad a ``CAPABILITIES``. Movidas sin cambios desde ``research.py`` en M1: misma ruta,
parámetros, validación, ``response_model`` y ``Cache-Control``.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query

from kaizen_api.errors import not_implemented
from kaizen_api.routers import ERROR_RESPONSES, SymbolPath, cache_control, stub
from kaizen_api.schemas import MomentumResponse, ValuationResponse

router = APIRouter(prefix="/v2", tags=["investigación"], responses=ERROR_RESPONSES)
CAPABILITIES: list[str] = []


@router.get(
    "/valuation/{symbol}",
    response_model=ValuationResponse,
    dependencies=[cache_control("fundamentals")],
    summary="Múltiplos contra el sector, DCF con sensibilidad y P/B justificado para bancos",
)
@stub
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
    raise not_implemented("GET /v2/valuation/{symbol}")


@router.get(
    "/momentum/{symbol}",
    response_model=MomentumResponse,
    dependencies=[cache_control("history")],
    summary="Rendimiento 12-1, 6 y 3 meses contra su referencia",
)
@stub
def momentum(symbol: SymbolPath) -> MomentumResponse:
    raise not_implemented("GET /v2/momentum/{symbol}")
