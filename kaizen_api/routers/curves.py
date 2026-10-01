"""Centro de tasas: curvas de rendimiento, diferenciales, mercado de dinero y expectativas (stream V5TS).

Lo dejó M5 con cada ruta del contrato de la fase 5 registrada y en ``@stub``: los parámetros ya se
validan aquí (un 422 o un 400 sale antes del 501), así que las pruebas de contrato los cubren desde
el primer día. V5TS borra ``@stub`` y el ``raise not_implemented(...)`` de cada ruta al
implementarla y agrega su capacidad a ``CAPABILITIES``.
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Query

from kaizen_api.errors import not_implemented
from kaizen_api.http_cache import cache_control
from kaizen_api.routers import ERROR_RESPONSES, stub
from kaizen_api.schemas import CurveSpreadsResponse, CurvesResponse, ExpectationsResponse, MoneyMarketResponse

router = APIRouter(prefix="/v2", tags=["tasas y curvas"], responses=ERROR_RESPONSES)
CAPABILITIES: list[str] = []

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
@stub
def curves(
    country: Annotated[Literal["mx", "us"], Query(description="mx = CETES, Bonos M y Udibonos; us = Tesoro")],
    compare: Annotated[
        str | None,
        Query(pattern=_COMPARE_PATTERN, description="Curvas pasadas para comparar: 1w, 1m, 1y separadas por coma"),
    ] = None,
) -> CurvesResponse:
    parse_compare(compare)
    raise not_implemented("GET /v2/curves")


@router.get(
    "/curves/spreads",
    response_model=CurveSpreadsResponse,
    dependencies=[cache_control("curves")],
    summary="Diferencial México menos EE. UU. por plazo, en pb, y su historia a 10 años",
)
@stub
def curve_spreads(
    history: Annotated[Literal["1y", "5y"], Query(description="Ventana de la historia del diferencial a 10 años")] = "1y",
) -> CurveSpreadsResponse:
    raise not_implemented("GET /v2/curves/spreads")


@router.get(
    "/money-market",
    response_model=MoneyMarketResponse,
    dependencies=[cache_control("macro")],
    summary="Tasas cortas que no trae /v2/rates/mx y cambios semanal y mensual en pb",
)
@stub
def money_market() -> MoneyMarketResponse:
    raise not_implemented("GET /v2/money-market")


@router.get(
    "/expectations",
    response_model=ExpectationsResponse,
    dependencies=[cache_control("macro")],
    summary="Encuesta de especialistas de Banxico, tasa real y forwards implícitos",
)
@stub
def expectations() -> ExpectationsResponse:
    raise not_implemented("GET /v2/expectations")
