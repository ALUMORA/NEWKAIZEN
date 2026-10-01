"""Herramientas para empresas: valores de referencia de México, factor de actualización por INPC,
industrias de Damodaran y salud financiera de contrapartes (stream V5EM).

Lo dejó M5 con cada ruta del contrato registrada y en ``@stub``. Las validaciones ya corren antes
del 501: meses con forma inválida o ``from`` posterior a ``to`` responden 422, igual que
``years`` fuera de 3 o 5. V5EM borra ``@stub`` y el ``raise not_implemented(...)`` al implementar
cada ruta y agrega su capacidad.
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Query

from kaizen_api.errors import invalid_param, not_implemented
from kaizen_api.http_cache import cache_control
from kaizen_api.routers import ERROR_RESPONSES, SymbolPath, stub
from kaizen_api.schemas import (
    CreditHealthResponse,
    IndustriesResponse,
    ReferenceMxResponse,
    UpdateFactorResponse,
)

router = APIRouter(prefix="/v2", tags=["empresas"], responses=ERROR_RESPONSES)
CAPABILITIES: list[str] = []

MONTH_PATTERN = r"^\d{4}-(0[1-9]|1[0-2])$"
CREDIT_YEARS = (3, 5)


def check_update_factor_params(from_: str, to: str) -> None:
    if from_ > to:  # AAAA-MM se ordena igual como texto que como fecha
        raise invalid_param("query.from", "date_order", "El mes inicial es posterior al final.")


def check_credit_years(years: int) -> None:
    if years not in CREDIT_YEARS:
        raise invalid_param("query.years", "enum", "Los años pueden ser 3 o 5.")


@router.get(
    "/reference/mx",
    response_model=ReferenceMxResponse,
    dependencies=[cache_control("reference")],
    summary="UMA, salario mínimo, tasa de recargos y UDI con su publicación oficial",
)
@stub
def reference_mx() -> ReferenceMxResponse:
    raise not_implemented("GET /v2/reference/mx")


@router.get(
    "/reference/mx/update-factor",
    response_model=UpdateFactorResponse,
    dependencies=[cache_control("macro")],
    summary="Factor de actualización por INPC entre dos meses",
)
@stub
def update_factor(
    from_: Annotated[str, Query(alias="from", pattern=MONTH_PATTERN, description="Mes del INPC inicial AAAA-MM")],
    to: Annotated[str, Query(pattern=MONTH_PATTERN, description="Mes del INPC final AAAA-MM")],
) -> UpdateFactorResponse:
    check_update_factor_params(from_, to)
    raise not_implemented("GET /v2/reference/mx/update-factor")


@router.get(
    "/business/industries",
    response_model=IndustriesResponse,
    dependencies=[cache_control("reference")],
    summary="Industrias de Damodaran con beta desapalancada, VE/EBITDA, ROIC y costo de capital",
)
@stub
def industries(
    market: Annotated[Literal["US", "EM"], Query(description="US = EE. UU.; EM = mercados emergentes")] = "US",
) -> IndustriesResponse:
    raise not_implemented("GET /v2/business/industries")


@router.get(
    "/credit-health/{symbol}",
    response_model=CreditHealthResponse,
    dependencies=[cache_control("fundamentals")],
    summary="Razones de salud financiera por año, sin letras de calificación",
)
@stub
def credit_health(
    symbol: SymbolPath,
    years: Annotated[int, Query(description="Años fiscales", json_schema_extra={"enum": list(CREDIT_YEARS)})] = 5,
) -> CreditHealthResponse:
    check_credit_years(years)
    raise not_implemented("GET /v2/credit-health/{symbol}")
