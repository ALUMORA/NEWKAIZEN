"""Cotizaciones y tipo de cambio spot (stream B2).

Rutas registradas con su validación y su ``response_model``; mientras B2 no las implemente
responden 501 NOT_IMPLEMENTED. Al implementar una, agrega su capacidad a ``CAPABILITIES``.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query

from kaizen_api.errors import not_implemented
from kaizen_api.routers import ERROR_RESPONSES, Symbols, cache_control
from kaizen_api.schemas import FX_PAIR_PATTERN, FxResponse, QuotesResponse

router = APIRouter(prefix="/v2", tags=["cotizaciones"], responses=ERROR_RESPONSES)
CAPABILITIES: list[str] = []

FxPairQuery = Annotated[str, Query(pattern=FX_PAIR_PATTERN, description="Par sin separador", examples=["USDMXN"])]


@router.get(
    "/quotes",
    response_model=QuotesResponse,
    dependencies=[cache_control("quotes")],
    summary="Cotización de hasta 50 símbolos",
)
def quotes(symbols: Symbols) -> QuotesResponse:
    raise not_implemented("GET /v2/quotes")


@router.get(
    "/fx",
    response_model=FxResponse,
    dependencies=[cache_control("quotes")],
    summary="Tipo de cambio spot (FIX de Banxico si hay token, si no Yahoo marcado)",
)
def fx(pair: FxPairQuery = "USDMXN") -> FxResponse:
    raise not_implemented("GET /v2/fx")
