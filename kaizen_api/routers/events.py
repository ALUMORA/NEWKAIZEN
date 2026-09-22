"""Calendario de eventos por símbolo: reportes, fecha ex dividendo y de pago (stream B3a).

Responde 501 NOT_IMPLEMENTED hasta que B3a la implemente; al hacerlo, agrega su capacidad a
``CAPABILITIES``. Movida sin cambios desde ``markets.py`` en M1 (conserva la etiqueta ``mercados``
en OpenAPI).
"""

from __future__ import annotations

from fastapi import APIRouter

from kaizen_api.errors import not_implemented
from kaizen_api.routers import ERROR_RESPONSES, Symbols, cache_control
from kaizen_api.schemas import EventsResponse

router = APIRouter(prefix="/v2", tags=["mercados"], responses=ERROR_RESPONSES)
CAPABILITIES: list[str] = []


@router.get(
    "/events",
    response_model=EventsResponse,
    dependencies=[cache_control("fundamentals")],
    summary="Reportes de resultados y fechas de dividendos de varios símbolos",
)
def events(symbols: Symbols) -> EventsResponse:
    raise not_implemented("GET /v2/events")
