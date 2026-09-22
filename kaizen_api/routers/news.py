"""Noticias con tono heurístico (stream B2b).

Solo titular, liga y fuente: entidades HTML decodificadas, ligas que no sean ``http`` descartadas y
duplicados quitados por título normalizado. El tono viene de ``domain/tone.py``, es una heurística
con léxico propio y va en un campo aparte, nunca mezclado con los números.

``symbol`` vacío (``?symbol=``) se trata como si no viniera, porque es lo que manda un formulario sin
llenar; un símbolo mal formado sí es 400 ``INVALID_SYMBOL``.
"""

from __future__ import annotations

import re
from typing import Annotated, Literal

from fastapi import APIRouter, Query

from kaizen_api.domain.news import get_news_v2
from kaizen_api.errors import ApiError, field_error
from kaizen_api.provenance import meta
from kaizen_api.routers import ERROR_RESPONSES, cache_control
from kaizen_api.schemas import SYMBOL_PATTERN, NewsResponse

router = APIRouter(prefix="/v2", tags=["noticias"], responses=ERROR_RESPONSES)
CAPABILITIES: list[str] = ["news"]

_SYMBOL_RE = re.compile(SYMBOL_PATTERN)
DELAY_MINUTES = 15
"""Los feeds y Yahoo publican con retraso; se declara para que la UI no lo presente como tiempo real."""


def _clean_symbol(raw: str | None) -> str | None:
    """``None`` si no vino o vino vacío; el símbolo en mayúsculas si es válido; 400 si no lo es."""
    value = (raw or "").strip()
    if not value:
        return None
    if not _SYMBOL_RE.fullmatch(value):
        raise ApiError(400, "INVALID_SYMBOL", details=field_error("query.symbol", "string_pattern_mismatch"))
    return value.upper()


@router.get(
    "/news",
    response_model=NewsResponse,
    dependencies=[cache_control("news")],
    summary="Titulares de mercado o de un símbolo, sin duplicados",
)
def news(
    symbol: Annotated[
        str | None,
        Query(max_length=20, description="Sin símbolo (o vacío): noticias de mercado", examples=["WALMEX.MX"]),
    ] = None,
    lang: Annotated[Literal["es", "en", "all"], Query(description="Idioma de los titulares")] = "all",
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
) -> NewsResponse:
    data = get_news_v2(_clean_symbol(symbol), lang=lang, limit=limit)
    return NewsResponse(
        items=data["items"],
        meta=meta(
            ",".join(data["sources"]),
            as_of=data["asOf"],
            delay_minutes=DELAY_MINUTES,
            stale=data["stale"],
            fallback=False,
            notes=data["notes"],
        ),
    )
