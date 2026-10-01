"""Calendario de eventos por símbolo: reportes, fecha ex dividendo y de pago (stream B3a).

Movida sin cambios desde ``markets.py`` en M1 (conserva la etiqueta ``mercados`` en OpenAPI).
Solo fechas publicadas por Yahoo: un símbolo sin calendario no aporta renglones y se anota en
``meta.notes``, en vez de estimar la fecha del próximo reporte.

Fase 5: el router pasa a V5PF. M5 registró ``GET /v2/events/season`` en ``@stub`` (con
``universe`` y ``days`` ya validados); V5PF lo implementa y agrega ``events.season`` a
``CAPABILITIES``, y ``events.dividends`` cuando ``/v2/events`` mande ``dividendSummary``.
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Query

from kaizen_api.domain.events import get_events
from kaizen_api.errors import invalid_param, not_implemented
from kaizen_api.provenance import meta
from kaizen_api.routers import ERROR_RESPONSES, Symbols, cache_control, stub
from kaizen_api.schemas import EventsResponse, EventsSeasonResponse

router = APIRouter(prefix="/v2", tags=["mercados"], responses=ERROR_RESPONSES)
CAPABILITIES: list[str] = ["events"]

SEASON_DAYS = (30, 60, 90)


@router.get(
    "/events",
    response_model=EventsResponse,
    dependencies=[cache_control("fundamentals")],
    summary="Reportes de resultados y fechas de dividendos de varios símbolos",
)
def events(symbols: Symbols) -> EventsResponse:
    data = get_events(symbols)
    return {
        "items": data["items"],
        "meta": meta("yahoo", as_of=data["as_of"], notes=data["notes"]),
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
@stub
def events_season(
    universe: Annotated[Literal["mx", "us"], Query(description="Muestra curada de México (23) o EE. UU. (38)")] = "mx",
    days: Annotated[int, Query(description="Ventana en días", json_schema_extra={"enum": list(SEASON_DAYS)})] = 90,
) -> EventsSeasonResponse:
    check_season_days(days)
    raise not_implemented("GET /v2/events/season")
