"""Históricos, panel alineado y serie del tipo de cambio (stream B2).

Todas consumen la costura ``kaizen_api.domain.history.get_series``. Mientras B2 no las implemente
responden 501 NOT_IMPLEMENTED. Al implementar una, agrega su capacidad a ``CAPABILITIES``.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query

from kaizen_api.errors import not_implemented
from kaizen_api.routers import ERROR_RESPONSES, IsoDateQuery, SymbolPath, Symbols, cache_control, check_date_range
from kaizen_api.routers.quotes import FxPairQuery
from kaizen_api.schemas import CcyParam, FxHistoryResponse, HistoryResponse, Interval, PanelResponse, Range

router = APIRouter(prefix="/v2", tags=["históricos"], responses=ERROR_RESPONSES)
CAPABILITIES: list[str] = []

RangeQuery = Annotated[Range, Query(alias="range", description="Periodo hacia atrás")]
IntervalQuery = Annotated[Interval, Query(description="Frecuencia de las observaciones")]
CcyQuery = Annotated[CcyParam, Query(description="native = moneda de cotización")]


@router.get(
    "/history/{symbol}",
    response_model=HistoryResponse,
    dependencies=[cache_control("history")],
    summary="Cierres ajustados de un símbolo, opcionalmente convertidos a MXN o USD",
)
def history(
    symbol: SymbolPath,
    range_: RangeQuery = "1y",
    interval: IntervalQuery = "1d",
    ccy: CcyQuery = "native",
) -> HistoryResponse:
    raise not_implemented("GET /v2/history/{symbol}")


@router.get(
    "/panel",
    response_model=PanelResponse,
    dependencies=[cache_control("history")],
    summary="Precios de varios símbolos alineados por fecha (INNER JOIN, sin rellenar)",
)
def panel(
    symbols: Symbols,
    range_: RangeQuery = "1y",
    interval: IntervalQuery = "1d",
    ccy: CcyQuery = "MXN",
) -> PanelResponse:
    raise not_implemented("GET /v2/panel")


@router.get(
    "/fx/history",
    response_model=FxHistoryResponse,
    dependencies=[cache_control("history")],
    summary="Serie diaria del tipo de cambio (FIX SF43718 con token, si no Yahoo marcado)",
)
def fx_history(pair: FxPairQuery = "USDMXN", start: IsoDateQuery = None, end: IsoDateQuery = None) -> FxHistoryResponse:
    check_date_range(start, end)
    raise not_implemented("GET /v2/fx/history")
