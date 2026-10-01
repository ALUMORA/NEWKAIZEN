"""Centro de tasas: curvas de rendimiento, diferenciales, mercado de dinero y expectativas (stream V5TS).

Las cuatro rutas están implementadas y anuncian ``curves``, ``moneyMarket`` y ``expectations``. El
dominio vive en ``domain/curves.py``, ``domain/money_market.py`` y ``domain/expectations.py``, y cada
función recibe la fecha de hoy del reloj del servidor (``utc_now``), que en replay es la del set.
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Query

from kaizen_api.domain.curves import get_curves, get_spreads
from kaizen_api.domain.expectations import get_expectations
from kaizen_api.domain.money_market import get_money_market
from kaizen_api.http_cache import cache_control
from kaizen_api.provenance import meta, utc_now
from kaizen_api.routers import ERROR_RESPONSES
from kaizen_api.schemas import CurveSpreadsResponse, CurvesResponse, ExpectationsResponse, MoneyMarketResponse

router = APIRouter(prefix="/v2", tags=["tasas y curvas"], responses=ERROR_RESPONSES)
CAPABILITIES: list[str] = ["curves", "moneyMarket", "expectations"]

COMPARE_WINDOWS = ("1w", "1m", "1y")
_COMPARE_PATTERN = r"^(1w|1m|1y)(,(1w|1m|1y)){0,2}$"


def parse_compare(compare: str | None) -> list[str]:
    """``"1y,1w,1y"`` a ``["1w", "1y"]``: sin repetidos y en el orden de ``COMPARE_WINDOWS``."""
    if not compare:
        return []
    asked = set(compare.split(","))
    return [w for w in COMPARE_WINDOWS if w in asked]


@router.get(
    "/curves",
    response_model=CurvesResponse,
    dependencies=[cache_control("curves")],
    summary="Curva de rendimiento de México o EE. UU., con la curva real y la inflación implícita",
)
def curves(
    country: Annotated[Literal["mx", "us"], Query(description="mx = CETES, Bonos M y Udibonos; us = Tesoro")],
    compare: Annotated[
        str | None,
        Query(pattern=_COMPARE_PATTERN, description="Curvas pasadas para comparar: 1w, 1m, 1y separadas por coma"),
    ] = None,
) -> CurvesResponse:
    data = get_curves(country, parse_compare(compare), utc_now().date())
    return CurvesResponse(
        country=data["country"],
        nodes=data["nodes"],
        compare=data["compare"],
        real=data["real"],
        breakeven=data["breakeven"],
        meta=meta(
            data["source"],
            as_of=data["asOf"],
            stale=data["stale"],
            fallback=data["fallback"],
            notes=data["notes"],
        ),
    )


@router.get(
    "/curves/spreads",
    response_model=CurveSpreadsResponse,
    dependencies=[cache_control("curves")],
    summary="Diferencial México menos EE. UU. por plazo, en pb, y su historia a 10 años",
)
def curve_spreads(
    history: Annotated[Literal["1y", "5y"], Query(description="Ventana de la historia del diferencial a 10 años")] = "1y",
) -> CurveSpreadsResponse:
    data = get_spreads(history, utc_now().date())
    return CurveSpreadsResponse(
        rows=data["rows"],
        history10y=data["history10y"],
        meta=meta("banxico,fred,treasury", as_of=data["asOf"], stale=data["stale"], notes=data["notes"]),
    )


@router.get(
    "/money-market",
    response_model=MoneyMarketResponse,
    dependencies=[cache_control("macro")],
    summary="Tasas cortas que no trae /v2/rates/mx y cambios semanal y mensual en pb",
)
def money_market() -> MoneyMarketResponse:
    data = get_money_market(utc_now().date())
    return MoneyMarketResponse(
        rows=data["rows"],
        mxChanges=data["mxChanges"],
        meta=meta("banxico,fred", as_of=data["asOf"], stale=data["stale"], notes=data["notes"]),
    )


@router.get(
    "/expectations",
    response_model=ExpectationsResponse,
    dependencies=[cache_control("macro")],
    summary="Encuesta de especialistas de Banxico, tasa real y forwards implícitos",
)
def expectations() -> ExpectationsResponse:
    data = get_expectations(utc_now().date())
    return ExpectationsResponse(
        survey=data["survey"],
        realRates=data["realRates"],
        impliedForwards=data["impliedForwards"],
        meta=meta("banxico,fred", as_of=data["asOf"], stale=data["stale"], notes=data["notes"]),
    )
