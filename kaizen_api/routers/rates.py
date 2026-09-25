"""Tasas de México y tasa libre de riesgo en serie (stream B2b).

Las dos salen de ``domain/rates.py``. Con token de Banxico se publican las series del SIE que el
propio SIE confirma en sus metadatos; sin token se cae al respaldo de FRED, siempre con
``meta.fallback`` en ``true``, y si no queda nada honesto que mostrar la ruta responde 503
``NOT_CONFIGURED`` en vez de inventar un número. La macro de EE. UU. vive en ``macro.py``.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query

from kaizen_api.domain.rates import get_inpc, get_mx_rates, get_rf_series
from kaizen_api.errors import invalid_param
from kaizen_api.provenance import meta
from kaizen_api.routers import ERROR_RESPONSES, IsoDateQuery, cache_control, check_date_range
from kaizen_api.schemas import InpcResponse, MxRatesResponse, RfSeriesResponse

router = APIRouter(prefix="/v2", tags=["tasas y macro"], responses=ERROR_RESPONSES)
CAPABILITIES: list[str] = ["rates.mx", "rf.series", "rates.inpc"]

TENORS = (28, 91, 182, 364)


@router.get(
    "/rates/mx",
    response_model=MxRatesResponse,
    dependencies=[cache_control("macro")],
    summary="Objetivo de Banxico, TIIE, CETES, Bono M, inflación, UDI y FIX",
)
def rates_mx() -> MxRatesResponse:
    data = get_mx_rates()
    return MxRatesResponse(
        items=data["items"],
        meta=meta(
            data["source"],
            as_of=data["asOf"],
            stale=data["stale"],
            fallback=data["fallback"],
            notes=data["notes"],
        ),
    )


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
    data = get_rf_series(start, end, tenor_days)
    return RfSeriesResponse(
        tenorDays=data["tenorDays"],
        convention="simple_act360",
        dates=data["dates"],
        values=data["values"],
        source=data["source"],
        fallback=data["fallback"],
        meta=meta(
            "fred" if data["fallback"] else "banxico",
            as_of=data["asOf"],
            stale=data["stale"],
            fallback=data["fallback"],
            notes=data["notes"],
        ),
    )


@router.get(
    "/rates/mx/inpc",
    response_model=InpcResponse,
    dependencies=[cache_control("macro")],
    summary="Serie mensual del INPC general (SIE SP1), {AAAA-MM: nivel}",
)
def rates_mx_inpc(start: IsoDateQuery = None, end: IsoDateQuery = None) -> InpcResponse:
    check_date_range(start, end)
    data = get_inpc(start, end)
    return InpcResponse(
        seriesId=data["seriesId"],
        base=data["base"],
        monthly=data["monthly"],
        meta=meta("banxico", as_of=data["asOf"], stale=data["stale"], notes=data["notes"]),
    )
