"""Panorama de mercados, mapa mundial y calendario de eventos (stream B2).

Mientras B2 no las implemente responden 501 NOT_IMPLEMENTED. El estado de BMV y NYSE sale de
``kaizen_api.domain.market_calendar`` (B1).
"""

from __future__ import annotations

from fastapi import APIRouter

from kaizen_api.errors import not_implemented
from kaizen_api.routers import ERROR_RESPONSES, Symbols, cache_control
from kaizen_api.schemas import EventsResponse, MarketsOverviewResponse, WorldResponse

router = APIRouter(prefix="/v2", tags=["mercados"], responses=ERROR_RESPONSES)
CAPABILITIES: list[str] = []


@router.get(
    "/markets/overview",
    response_model=MarketsOverviewResponse,
    dependencies=[cache_control("quotes")],
    summary="Índices, divisas, materias primas y cripto, con estado de BMV y NYSE",
)
def markets_overview() -> MarketsOverviewResponse:
    raise not_implemented("GET /v2/markets/overview")


@router.get(
    "/markets/world",
    response_model=WorldResponse,
    dependencies=[cache_control("quotes")],
    summary="Variación por país con ETF de iShares en USD",
)
def markets_world() -> WorldResponse:
    raise not_implemented("GET /v2/markets/world")


@router.get(
    "/events",
    response_model=EventsResponse,
    dependencies=[cache_control("fundamentals")],
    summary="Reportes de resultados y fechas de dividendos de varios símbolos",
)
def events(symbols: Symbols) -> EventsResponse:
    raise not_implemented("GET /v2/events")
