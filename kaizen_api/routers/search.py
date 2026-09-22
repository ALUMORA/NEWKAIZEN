"""Búsqueda de símbolos (stream B2a): lista curada de México con alias en español y el índice de la SEC.

La parte de México no necesita red: vive en ``kaizen_api/data/symbols_mx.json``, así que buscar
"walmart", "bimbo" o "fibra uno" funciona siempre. El índice de la SEC agrega las emisoras de
EE. UU. y se baja una sola vez cada 24 horas.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query

from kaizen_api.domain import search as search_domain
from kaizen_api.provenance import meta
from kaizen_api.routers import ERROR_RESPONSES, cache_control
from kaizen_api.schemas import SearchResponse

router = APIRouter(prefix="/v2", tags=["búsqueda"], responses=ERROR_RESPONSES)
CAPABILITIES: list[str] = ["search"]


@router.get(
    "/search",
    response_model=SearchResponse,
    dependencies=[cache_control("fundamentals")],
    summary="Busca por símbolo, nombre o alias",
)
def search(
    q: Annotated[str, Query(min_length=1, max_length=64, description="Texto a buscar")],
    limit: Annotated[int, Query(ge=1, le=50)] = 10,
) -> SearchResponse:
    results, notes, source = search_domain.search(q, limit)
    if not results:
        notes.append(f"No encontramos nada que se parezca a {q.strip()!r}.")
    return {
        "results": results,
        "meta": meta(
            source,
            as_of=search_domain.curated_as_of(),
            stale=search_domain.curated_is_stale(),
            notes=notes,
        ),
    }
