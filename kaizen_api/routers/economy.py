"""Calendario económico de México y EE. UU. y tablero de indicadores con comparador de países (stream V5EC).

Lo dejó M5 con cada ruta del contrato registrada y en ``@stub``. Las validaciones ya corren antes
del 501: una ventana de más de 90 días en el calendario responde 400 ``INVALID_PARAM`` y una lista
con países o indicadores que no existen, 422. V5EC borra ``@stub`` y el
``raise not_implemented(...)`` al implementar cada ruta y agrega su capacidad.
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Query

from kaizen_api.errors import ApiError, field_error, not_implemented
from kaizen_api.http_cache import cache_control
from kaizen_api.routers import ERROR_RESPONSES, IsoDateQuery, check_date_range, stub
from kaizen_api.schemas import EconomicCalendarResponse, MacroIndicatorsResponse, MacroWorldResponse

router = APIRouter(prefix="/v2", tags=["economía"], responses=ERROR_RESPONSES)
CAPABILITIES: list[str] = []

CALENDAR_MAX_DAYS = 90
WORLD_MAX_COUNTRIES = 10
WORLD_INDICATORS = ("gdpUsd", "gdpGrowth", "inflation", "debt")
_INDICATOR = "(" + "|".join(WORLD_INDICATORS) + ")"


def check_calendar_params(start: str | None, end: str | None, country: str) -> list[str]:
    """Países pedidos sin repetir; la ventana no puede pasar de 90 días (400 ``INVALID_PARAM``)."""
    first, last = check_date_range(start, end)
    if first and last and (last - first).days > CALENDAR_MAX_DAYS:
        raise ApiError(
            400,
            "INVALID_PARAM",
            "El calendario abarca hasta 90 días por consulta.",
            details=field_error("query.end", "out_of_range"),
        )
    return [c for c in ("mx", "us") if c in country.split(",")]


def parse_world(countries: str, indicators: str) -> tuple[list[str], list[str]]:
    codes: list[str] = []
    for code in countries.upper().split(","):
        if code not in codes:
            codes.append(code)
    asked = set(indicators.split(","))
    return codes, [i for i in WORLD_INDICATORS if i in asked]


@router.get(
    "/calendar/economic",
    response_model=EconomicCalendarResponse,
    dependencies=[cache_control("reference")],
    summary="Calendario de Banxico, la Fed, INEGI y BLS con dato anterior y publicado",
)
@stub
def economic_calendar(
    start: IsoDateQuery = None,
    end: IsoDateQuery = None,
    country: Annotated[
        str, Query(pattern=r"^(mx|us)(,(mx|us))?$", description="mx, us o los dos separados por coma")
    ] = "mx,us",
) -> EconomicCalendarResponse:
    check_calendar_params(start, end, country)
    raise not_implemented("GET /v2/calendar/economic")


@router.get(
    "/macro/indicators",
    response_model=MacroIndicatorsResponse,
    dependencies=[cache_control("macro")],
    summary="Indicadores de economía de México o EE. UU. con su historia y su unidad",
)
@stub
def macro_indicators(
    country: Annotated[Literal["mx", "us"], Query(description="País del tablero")] = "mx",
    years: Annotated[Literal["5", "10", "max"], Query(description="Años de historia")] = "5",
) -> MacroIndicatorsResponse:
    raise not_implemented("GET /v2/macro/indicators")


@router.get(
    "/macro/world",
    response_model=MacroWorldResponse,
    dependencies=[cache_control("reference")],
    summary="Comparador de países con datos del Banco Mundial (CC BY 4.0)",
)
@stub
def macro_world(
    countries: Annotated[
        str,
        Query(
            pattern=r"^[A-Za-z]{3}(,[A-Za-z]{3}){0,9}$",
            description=f"Códigos ISO alfa-3 separados por coma (hasta {WORLD_MAX_COUNTRIES})",
        ),
    ] = "MEX,USA,BRA",
    indicators: Annotated[
        str,
        Query(pattern=rf"^{_INDICATOR}(,{_INDICATOR}){{0,3}}$", description="gdpUsd, gdpGrowth, inflation, debt"),
    ] = "gdpUsd,gdpGrowth,inflation,debt",
) -> MacroWorldResponse:
    parse_world(countries, indicators)
    raise not_implemented("GET /v2/macro/world")
