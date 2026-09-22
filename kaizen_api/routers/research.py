"""Ficha de emisora, estados financieros, dividendos, valuación y momentum (stream B3).

Mientras B3 no las implemente responden 501 NOT_IMPLEMENTED. Al implementar una, agrega su
capacidad a ``CAPABILITIES``.
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Query

from kaizen_api.errors import not_implemented
from kaizen_api.routers import ERROR_RESPONSES, SymbolPath, cache_control
from kaizen_api.schemas import (
    DividendsResponse,
    InstrumentResponse,
    MomentumResponse,
    StatementsResponse,
    ValuationResponse,
)

router = APIRouter(prefix="/v2", tags=["investigación"], responses=ERROR_RESPONSES)
CAPABILITIES: list[str] = []


@router.get(
    "/instrument/{symbol}",
    response_model=InstrumentResponse,
    dependencies=[cache_control("quotes")],
    summary="Ficha: cotización, fundamentales en la moneda del precio, beta y cobertura",
)
def instrument(symbol: SymbolPath) -> InstrumentResponse:
    raise not_implemented("GET /v2/instrument/{symbol}")


@router.get(
    "/instrument/{symbol}/statements",
    response_model=StatementsResponse,
    dependencies=[cache_control("fundamentals")],
    summary="Estados financieros reales (SEC o Yahoo), nunca sintetizados",
)
def statements(
    symbol: SymbolPath,
    freq: Annotated[Literal["annual", "quarterly"], Query(description="Anual o trimestral")] = "annual",
) -> StatementsResponse:
    raise not_implemented("GET /v2/instrument/{symbol}/statements")


@router.get(
    "/instrument/{symbol}/dividends",
    response_model=DividendsResponse,
    dependencies=[cache_control("fundamentals")],
    summary="Dividendos pagados, suma de 12 meses y rendimiento",
)
def dividends(symbol: SymbolPath) -> DividendsResponse:
    raise not_implemented("GET /v2/instrument/{symbol}/dividends")


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
    raise not_implemented("GET /v2/valuation/{symbol}")


@router.get(
    "/momentum/{symbol}",
    response_model=MomentumResponse,
    dependencies=[cache_control("history")],
    summary="Rendimiento 12-1, 6 y 3 meses contra su referencia",
)
def momentum(symbol: SymbolPath) -> MomentumResponse:
    raise not_implemented("GET /v2/momentum/{symbol}")
