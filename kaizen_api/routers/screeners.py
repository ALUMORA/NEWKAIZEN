"""Screeners: factores, Fórmula Mágica, FIBRAs e información de directivos (stream B3).

Mientras B3 no las implemente responden 501 NOT_IMPLEMENTED. Al implementar una, agrega su
capacidad a ``CAPABILITIES``.
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Query

from kaizen_api.errors import invalid_param, not_implemented
from kaizen_api.routers import ERROR_RESPONSES, SymbolPath, cache_control, parse_symbols
from kaizen_api.schemas import FactorsResponse, FibrasResponse, InsidersResponse, MagicResponse

router = APIRouter(prefix="/v2", tags=["screeners"], responses=ERROR_RESPONSES)
CAPABILITIES: list[str] = []

MAX_CUSTOM_UNIVERSE = 50
MAX_FIBRAS_EXTRA = 20


@router.get(
    "/screeners/factors",
    response_model=FactorsResponse,
    dependencies=[cache_control("screeners")],
    summary="Puntajes por factor (valor, calidad, momentum, baja volatilidad, crecimiento)",
)
def factors(
    universe: Annotated[Literal["mx", "us", "custom"], Query(description="custom exige symbols")] = "mx",
    symbols: Annotated[str | None, Query(max_length=MAX_CUSTOM_UNIVERSE * 21, description="Solo con universe=custom")] = None,
) -> FactorsResponse:
    if universe == "custom":
        if not symbols:
            raise invalid_param("query.symbols", "missing", "Con universe=custom indica los símbolos.")
        parse_symbols(symbols, limit=MAX_CUSTOM_UNIVERSE)
    elif symbols:
        raise invalid_param("query.symbols", "extra_forbidden", "symbols solo aplica con universe=custom.")
    raise not_implemented("GET /v2/screeners/factors")


@router.get(
    "/screeners/magic",
    response_model=MagicResponse,
    dependencies=[cache_control("screeners")],
    summary="Fórmula Mágica de Greenblatt con EBIT reportado",
)
def magic(universe: Annotated[Literal["us", "mx"], Query(description="Universo")] = "us") -> MagicResponse:
    raise not_implemented("GET /v2/screeners/magic")


@router.get(
    "/screeners/fibras",
    response_model=FibrasResponse,
    dependencies=[cache_control("screeners")],
    summary="FIBRAs: rendimiento de distribución, P/NAV, LTV y diferencial contra CETES",
)
def fibras(
    extra: Annotated[str | None, Query(max_length=MAX_FIBRAS_EXTRA * 21, description="FIBRAs extra separadas por coma")] = None,
) -> FibrasResponse:
    if extra:
        parse_symbols(extra, limit=MAX_FIBRAS_EXTRA, param="extra")
    raise not_implemented("GET /v2/screeners/fibras")


@router.get(
    "/insiders/{symbol}",
    response_model=InsidersResponse,
    dependencies=[cache_control("fundamentals")],
    summary="Operaciones de consejeros y directivos",
)
def insiders(symbol: SymbolPath) -> InsidersResponse:
    raise not_implemented("GET /v2/insiders/{symbol}")
