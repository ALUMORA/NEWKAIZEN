"""Panorama de mercados y mapa mundial (stream B2a).

El estado de BMV y NYSE sale de ``kaizen_api.domain.market_calendar`` (también de B2a).
``/v2/events`` es de B3a y vive en ``events.py``.

Dos defectos del backend viejo que aquí quedan corregidos, y que por eso valen un renglón:

* el IPC (``^MXX``) sale en **pesos**, no en dólares;
* el índice del dólar sale de Yahoo (``DX-Y.NYB``). El CSV de Stooq falla siempre desde aquí.
"""

from __future__ import annotations

from fastapi import APIRouter

from kaizen_api.domain import market_calendar
from kaizen_api.domain import markets as markets_domain
from kaizen_api.provenance import meta
from kaizen_api.providers.yahoo import prices
from kaizen_api.routers import ERROR_RESPONSES, cache_control
from kaizen_api.schemas import MarketsOverviewResponse, WorldResponse

router = APIRouter(prefix="/v2", tags=["mercados"], responses=ERROR_RESPONSES)
CAPABILITIES: list[str] = ["markets.overview", "markets.world"]


@router.get(
    "/markets/overview",
    response_model=MarketsOverviewResponse,
    dependencies=[cache_control("quotes")],
    summary="Índices, divisas, materias primas y cripto, con estado de BMV y NYSE",
)
def markets_overview() -> MarketsOverviewResponse:
    groups, as_of, notes = markets_domain.overview_data()
    status, status_notes = market_calendar.market_status()
    return {
        "groups": groups,
        "marketStatus": status,
        "meta": meta(
            "yahoo",
            as_of=as_of,
            delay_minutes=prices.DELAY_MINUTES,
            stale=markets_domain.basket_is_stale(as_of),
            notes=[*notes, *status_notes],
        ),
    }


@router.get(
    "/markets/world",
    response_model=WorldResponse,
    dependencies=[cache_control("quotes")],
    summary="Variación por país con ETF de iShares en USD",
)
def markets_world() -> WorldResponse:
    items, as_of, notes = markets_domain.world_data()
    return {
        "items": items,
        "method": markets_domain.WORLD_METHOD,
        "meta": meta(
            "yahoo",
            as_of=as_of,
            delay_minutes=prices.DELAY_MINUTES,
            stale=markets_domain.basket_is_stale(as_of),
            notes=notes,
        ),
    }
