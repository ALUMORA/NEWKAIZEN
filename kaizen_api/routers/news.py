"""Noticias con tono heurístico (stream B2). Responde 501 NOT_IMPLEMENTED hasta que B2 la implemente."""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Query

from kaizen_api.errors import not_implemented
from kaizen_api.routers import ERROR_RESPONSES, cache_control
from kaizen_api.schemas import SYMBOL_PATTERN, NewsResponse

router = APIRouter(prefix="/v2", tags=["noticias"], responses=ERROR_RESPONSES)
CAPABILITIES: list[str] = []


@router.get(
    "/news",
    response_model=NewsResponse,
    dependencies=[cache_control("news")],
    summary="Titulares de mercado o de un símbolo, sin duplicados",
)
def news(
    symbol: Annotated[str | None, Query(pattern=SYMBOL_PATTERN, description="Sin símbolo: noticias de mercado")] = None,
    lang: Annotated[Literal["es", "en", "all"], Query(description="Idioma de los titulares")] = "all",
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
) -> NewsResponse:
    raise not_implemented("GET /v2/news")
