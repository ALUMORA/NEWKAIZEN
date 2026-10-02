"""Calendario de eventos por símbolo: reportes, fecha ex dividendo y de pago (stream B3a).

Movida sin cambios desde ``markets.py`` en M1 (conserva la etiqueta ``mercados`` en OpenAPI).
Solo fechas publicadas por Yahoo: un símbolo sin calendario no aporta renglones y se anota en
``meta.notes``, en vez de estimar la fecha del próximo reporte.

Fase 5 (V5PF): ``/v2/events`` suma, sin cambiar lo que ya mandaba, el rango del consenso
(``estimateLow``/``estimateHigh``) y ``dividendSummary`` (capacidad ``events.dividends``);
``amount`` sigue en ``null`` porque el monto futuro no se conoce. ``GET /v2/events/season`` es la
temporada de reportes de una muestra curada (capacidad ``events.season``).
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Query

from kaizen_api.domain.earnings_season import get_season
from kaizen_api.domain.events import FUTURE_AMOUNT_NOTE, YAHOO_PERSONAL_USE, dividend_summary, get_events
from kaizen_api.errors import invalid_param
from kaizen_api.provenance import meta, utc_now
from kaizen_api.routers import ERROR_RESPONSES, Symbols, cache_control
from kaizen_api.schemas import EventsResponse, EventsSeasonResponse

router = APIRouter(prefix="/v2", tags=["mercados"], responses=ERROR_RESPONSES)
CAPABILITIES: list[str] = ["events", "events.dividends", "events.season"]

SEASON_DAYS = (30, 60, 90)


@router.get(
    "/events",
    response_model=EventsResponse,
    dependencies=[cache_control("fundamentals")],
    summary="Reportes de resultados y fechas de dividendos de varios símbolos",
)
def events(symbols: Symbols) -> EventsResponse:
    data = get_events(symbols)
    summary = dividend_summary(symbols, utc_now().date())
    notes = [*data["notes"], FUTURE_AMOUNT_NOTE, YAHOO_PERSONAL_USE]
    return {
        "items": data["items"],
        "dividendSummary": summary,
        "meta": meta("yahoo", as_of=data["as_of"], notes=list(dict.fromkeys(notes))),
    }


def check_season_days(days: int) -> None:
    if days not in SEASON_DAYS:
        raise invalid_param("query.days", "enum", "La ventana puede ser de 30, 60 o 90 días.")


@router.get(
    "/events/season",
    response_model=EventsSeasonResponse,
    dependencies=[cache_control("fundamentals")],
    summary="Temporada de reportes de una muestra curada de emisoras de México o EE. UU.",
)
def events_season(
    universe: Annotated[Literal["mx", "us"], Query(description="Muestra curada de México (23) o EE. UU. (38)")] = "mx",
    days: Annotated[int, Query(description="Ventana en días", json_schema_extra={"enum": list(SEASON_DAYS)})] = 90,
) -> EventsSeasonResponse:
    check_season_days(days)
    data = get_season(universe, days, utc_now().date())
    return {
        "universe": data["universe"],
        "events": data["events"],
        "missing": data["missing"],
        "universeSize": data["universeSize"],
        "meta": meta("yahoo", as_of=data["as_of"], notes=data["notes"]),
    }
