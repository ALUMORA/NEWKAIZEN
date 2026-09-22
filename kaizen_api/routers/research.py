"""Ficha de emisora, estados financieros y dividendos (stream B3a).

Mientras B3a no las implemente responden 501 NOT_IMPLEMENTED. Al implementar una, agrega su
capacidad a ``CAPABILITIES``. Las otras rutas de B3a viven en ``events.py`` (``/v2/events``) e
``insiders.py`` (``/v2/insiders/{symbol}``); valuación y momentum son de B3b (``valuation.py``).
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Query

from kaizen_api.errors import not_implemented
from kaizen_api.routers import ERROR_RESPONSES, SymbolPath, cache_control
from kaizen_api.schemas import DividendsResponse, InstrumentResponse, StatementsResponse

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
