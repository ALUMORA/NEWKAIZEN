"""Velas OHLC con volumen, diarias o intradía, para la gráfica técnica (stream V5TC).

Lo dejó M5 con la ruta del contrato registrada y en ``@stub``. Las combinaciones de rango e
intervalo que Yahoo no sirve (``interval=5m`` con ``range=1y``, por ejemplo) responden 400
``INVALID_PARAM`` antes del 501. El ``Cache-Control`` depende del intervalo: ``intraday`` (60 s) con
5m o 1h e ``history`` con velas diarias, semanales o mensuales. V5TC borra ``@stub`` y el
``raise not_implemented(...)`` al implementarla y agrega ``ohlc`` (y ``ohlc.intraday`` cuando sirva
5m y 1h) a ``CAPABILITIES``.
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Query

from kaizen_api.errors import ApiError, field_error, not_implemented
from kaizen_api.http_cache import cache_control_by
from kaizen_api.routers import ERROR_RESPONSES, SymbolPath, stub
from kaizen_api.schemas import OhlcInterval, OhlcRange, OhlcResponse

router = APIRouter(prefix="/v2", tags=["históricos"], responses=ERROR_RESPONSES)
CAPABILITIES: list[str] = []

VALID_RANGES: dict[str, frozenset[str]] = {
    "5m": frozenset({"1d", "5d", "1mo"}),  # Yahoo da 5 minutos hasta 60 días atrás
    "1h": frozenset({"1d", "5d", "1mo", "6mo", "1y"}),  # y 1 hora hasta 730 días
    "1d": frozenset({"1d", "5d", "1mo", "6mo", "1y", "5y", "max"}),
    "1wk": frozenset({"1mo", "6mo", "1y", "5y", "max"}),
    "1mo": frozenset({"6mo", "1y", "5y", "max"}),
}
"""Rangos que admite cada intervalo. Lo demás es 400 ``INVALID_PARAM``."""


def check_ohlc_params(range_: str, interval: str) -> None:
    if range_ not in VALID_RANGES[interval]:
        allowed = ", ".join(r for r in ("1d", "5d", "1mo", "6mo", "1y", "5y", "max") if r in VALID_RANGES[interval])
        raise ApiError(
            400,
            "INVALID_PARAM",
            f"Con intervalo {interval} el rango puede ser {allowed}.",
            details=field_error("query.range", "out_of_range"),
        )


@router.get(
    "/ohlc/{symbol}",
    response_model=OhlcResponse,
    dependencies=[cache_control_by("interval", {"5m": "intraday", "1h": "intraday"}, default="history")],
    summary="Velas con apertura, máximo, mínimo, cierre y volumen, ajustadas solo por splits",
)
@stub
def ohlc(
    symbol: SymbolPath,
    range_: Annotated[OhlcRange, Query(alias="range", description="Periodo hacia atrás")] = "6mo",
    interval: Annotated[OhlcInterval, Query(description="Duración de cada vela (5m y 1h son intradía)")] = "1d",
    compare: Annotated[
        Literal["^MXX", "^GSPC", "SPY"] | None, Query(description="Serie de referencia para comparar en base 100")
    ] = None,
) -> OhlcResponse:
    check_ohlc_params(range_, interval)
    raise not_implemented("GET /v2/ohlc/{symbol}")
