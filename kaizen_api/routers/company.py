"""Ficha de la emisora: resultados contra estimado, tenencia, acciones en circulación y documentos de
la SEC (stream V5FI).

Lo dejó M5 con cada ruta del contrato registrada y en ``@stub``. Las validaciones ya corren antes
del 501: un símbolo mal formado responde 400 ``INVALID_SYMBOL``; un tipo de documento que no existe
o un ``limit`` fuera de 1 a 50, 422; una fecha inicial en el futuro, 400 ``INVALID_PARAM``. V5FI
borra ``@stub`` y el ``raise not_implemented(...)`` al implementar cada ruta y agrega su capacidad.
"""

from __future__ import annotations

import datetime as _dt
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Query

from kaizen_api.errors import ApiError, field_error, invalid_param, not_implemented
from kaizen_api.http_cache import cache_control
from kaizen_api.routers import ERROR_RESPONSES, IsoDateQuery, SymbolPath, check_date_range, stub
from kaizen_api.schemas import EarningsResponse, FilingsResponse, HoldersResponse, SharesResponse

router = APIRouter(prefix="/v2", tags=["investigación"], responses=ERROR_RESPONSES)
CAPABILITIES: list[str] = []

FILING_FORMS = ("10-K", "10-Q", "8-K", "20-F", "6-K", "SC 13D", "SC 13G", "DEF 14A")
DEFAULT_FORMS = "10-K,10-Q,8-K,20-F,6-K"
_MX = ZoneInfo("America/Mexico_City")


def parse_forms(forms: str) -> list[str]:
    """``"10-k, 8-K"`` a ``["10-K", "8-K"]``. Un tipo fuera de ``FILING_FORMS`` es 422."""
    out: list[str] = []
    for part in forms.split(","):
        form = " ".join(part.split()).upper()
        if not form:
            continue
        if form not in FILING_FORMS:
            raise invalid_param("query.forms", "enum", "Tipos válidos: " + ", ".join(FILING_FORMS) + ".")
        if form not in out:
            out.append(form)
    if not out:
        raise invalid_param("query.forms", "missing", "Indica al menos un tipo de documento.")
    return out


def check_shares_start(start: str | None, *, today: _dt.date | None = None) -> _dt.date | None:
    """Fecha inicial de la serie de acciones; futura (contra ``today``, hora del centro) es 400."""
    first, _ = check_date_range(start, None)
    if first and first > (today or _dt.datetime.now(_MX).date()):
        raise ApiError(
            400,
            "INVALID_PARAM",
            "La fecha inicial no puede ser futura.",
            details=field_error("query.start", "out_of_range"),
        )
    return first


@router.get(
    "/earnings/{symbol}",
    response_model=EarningsResponse,
    dependencies=[cache_control("fundamentals")],
    summary="Resultados contra estimado, estimados y su tendencia, sin precios objetivo ni calificaciones",
)
@stub
def earnings(symbol: SymbolPath) -> EarningsResponse:
    raise not_implemented("GET /v2/earnings/{symbol}")


@router.get(
    "/holders/{symbol}",
    response_model=HoldersResponse,
    dependencies=[cache_control("fundamentals")],
    summary="Tenencia de directivos, instituciones y fondos",
)
@stub
def holders(symbol: SymbolPath) -> HoldersResponse:
    raise not_implemented("GET /v2/holders/{symbol}")


@router.get(
    "/shares/{symbol}",
    response_model=SharesResponse,
    dependencies=[cache_control("fundamentals")],
    summary="Acciones en circulación en el tiempo y splits",
)
@stub
def shares(symbol: SymbolPath, start: IsoDateQuery = None) -> SharesResponse:
    check_shares_start(start)
    raise not_implemented("GET /v2/shares/{symbol}")


@router.get(
    "/filings/{symbol}",
    response_model=FilingsResponse,
    dependencies=[cache_control("fundamentals")],
    summary="Documentos de la emisora ante la SEC (10-K, 10-Q, 8-K, 20-F, 6-K)",
)
@stub
def filings(
    symbol: SymbolPath,
    forms: Annotated[str, Query(max_length=80, description="Tipos separados por coma")] = DEFAULT_FORMS,
    limit: Annotated[int, Query(ge=1, le=50, description="Cuántos documentos")] = 20,
) -> FilingsResponse:
    parse_forms(forms)
    raise not_implemented("GET /v2/filings/{symbol}")
