"""Calendario de eventos por símbolo: reportes, fecha ex dividendo y de pago (stream B3a).

Movida sin cambios desde ``markets.py`` en M1 (conserva la etiqueta ``mercados`` en OpenAPI).
Solo fechas publicadas por Yahoo: un símbolo sin calendario no aporta renglones y se anota en
``meta.notes``, en vez de estimar la fecha del próximo reporte.
"""

from __future__ import annotations

from fastapi import APIRouter

from kaizen_api.domain.events import get_events
from kaizen_api.provenance import meta
from kaizen_api.routers import ERROR_RESPONSES, Symbols, cache_control
from kaizen_api.schemas import EventsResponse

router = APIRouter(prefix="/v2", tags=["mercados"], responses=ERROR_RESPONSES)
CAPABILITIES: list[str] = ["events"]


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
