"""Búsqueda de símbolos (stream B2): lista curada de México con alias en español y el índice de la SEC.

Responde 501 NOT_IMPLEMENTED hasta que B2 la implemente.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query

from kaizen_api.errors import not_implemented
from kaizen_api.routers import ERROR_RESPONSES, cache_control, stub
from kaizen_api.schemas import SearchResponse

router = APIRouter(prefix="/v2", tags=["búsqueda"], responses=ERROR_RESPONSES)
CAPABILITIES: list[str] = []


@router.get(
    "/search",
    response_model=SearchResponse,
    dependencies=[cache_control("fundamentals")],
    summary="Busca por símbolo, nombre o alias",
)
@stub
def search(
    q: Annotated[str, Query(min_length=1, max_length=64, description="Texto a buscar")],
    limit: Annotated[int, Query(ge=1, le=50)] = 10,
) -> SearchResponse:
    raise not_implemented("GET /v2/search")
