"""Las que más se mueven, amplitud del mercado y mapa por sector (stream V5MK).

Lo dejó M5 con cada ruta del contrato registrada y en ``@stub``; los parámetros ya se validan antes
del 501 (mercado, tipo y ``limit`` de 10 a 50, 422 si no cuadran). V5MK borra ``@stub`` y el
``raise not_implemented(...)`` al implementar cada ruta y agrega su capacidad.
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Query

from kaizen_api.errors import not_implemented
from kaizen_api.http_cache import cache_control
from kaizen_api.routers import ERROR_RESPONSES, stub
from kaizen_api.schemas import BreadthResponse, MoversResponse, SectorsResponse

router = APIRouter(prefix="/v2", tags=["mercados"], responses=ERROR_RESPONSES)
CAPABILITIES: list[str] = []

MarketQuery = Annotated[Literal["us", "mx"], Query(description="mx = BMV; us = bolsas de EE. UU.")]


@router.get(
    "/movers",
    response_model=MoversResponse,
    dependencies=[cache_control("quotes")],
    summary="Las que más suben, bajan o se operan en el día",
)
@stub
def movers(
    market: MarketQuery = "mx",
    kind: Annotated[Literal["gainers", "losers", "active"], Query(description="Suben, bajan o más operadas")] = "gainers",
    limit: Annotated[int, Query(ge=10, le=50, description="Cuántos renglones")] = 20,
) -> MoversResponse:
    raise not_implemented("GET /v2/movers")


@router.get(
    "/breadth",
    response_model=BreadthResponse,
    dependencies=[cache_control("quotes")],
    summary="Amplitud de una muestra curada: suben contra bajan, arriba de la media de 200 días, máximos y mínimos",
)
@stub
def breadth(market: MarketQuery = "mx") -> BreadthResponse:
    raise not_implemented("GET /v2/breadth")


@router.get(
    "/sectors",
    response_model=SectorsResponse,
    dependencies=[cache_control("quotes")],
    summary="Mapa del mercado por sector con cambios en día, semana, mes, año corrido y año",
)
@stub
def sectors(market: MarketQuery = "mx") -> SectorsResponse:
    raise not_implemented("GET /v2/sectors")
