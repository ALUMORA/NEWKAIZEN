"""Operaciones de consejeros y directivos (stream B3a).

Responde 501 NOT_IMPLEMENTED hasta que B3a la implemente; al hacerlo, agrega su capacidad a
``CAPABILITIES``. Movida sin cambios desde ``screeners.py`` en M1 (conserva la etiqueta
``screeners`` en OpenAPI).
"""

from __future__ import annotations

from fastapi import APIRouter

from kaizen_api.errors import not_implemented
from kaizen_api.routers import ERROR_RESPONSES, SymbolPath, cache_control, stub
from kaizen_api.schemas import InsidersResponse

router = APIRouter(prefix="/v2", tags=["screeners"], responses=ERROR_RESPONSES)
CAPABILITIES: list[str] = []


@router.get(
    "/insiders/{symbol}",
    response_model=InsidersResponse,
    dependencies=[cache_control("fundamentals")],
    summary="Operaciones de consejeros y directivos",
)
@stub
def insiders(symbol: SymbolPath) -> InsidersResponse:
    raise not_implemented("GET /v2/insiders/{symbol}")
