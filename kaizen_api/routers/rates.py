"""Tasas de México y tasa libre de riesgo en serie (stream B2b).

Mientras B2b no las implemente responden 501 NOT_IMPLEMENTED. Los ids del SIE distintos de
SF43718 y SF61745 se verifican contra el endpoint de metadatos del SIE en una prueba antes de usarse.
La macro de EE. UU. vive en ``macro.py`` (también de B2b).
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query

from kaizen_api.errors import invalid_param, not_implemented
from kaizen_api.routers import ERROR_RESPONSES, IsoDateQuery, cache_control, check_date_range
from kaizen_api.schemas import MxRatesResponse, RfSeriesResponse

router = APIRouter(prefix="/v2", tags=["tasas y macro"], responses=ERROR_RESPONSES)
CAPABILITIES: list[str] = []

TENORS = (28, 91, 182, 364)


@router.get(
    "/rates/mx",
    response_model=MxRatesResponse,
    dependencies=[cache_control("macro")],
    summary="Objetivo de Banxico, TIIE, CETES, Bono M, inflación, UDI y FIX",
)
def rates_mx() -> MxRatesResponse:
    raise not_implemented("GET /v2/rates/mx")


@router.get(
    "/rates/rf",
    response_model=RfSeriesResponse,
    dependencies=[cache_control("macro")],
    summary="Serie de la tasa libre de riesgo (CETES, simple act/360, fracción)",
)
def rates_rf(
    start: IsoDateQuery = None,
    end: IsoDateQuery = None,
    tenor_days: Annotated[
        int, Query(alias="tenorDays", description="Plazo en días", json_schema_extra={"enum": list(TENORS)})
    ] = 28,
) -> RfSeriesResponse:
    check_date_range(start, end)
    if tenor_days not in TENORS:
        raise invalid_param("query.tenorDays", "enum", "El plazo debe ser de 28, 91, 182 o 364 días.")
    raise not_implemented("GET /v2/rates/rf")
