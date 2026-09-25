"""Históricos, panel alineado y serie del tipo de cambio (stream B2a).

Las tres consumen la costura ``kaizen_api.domain.history.get_series``, que devuelve cierres
AJUSTADOS por splits y dividendos con su fecha real. Ese es el arreglo que hace posible todo lo
demás: el backend viejo mandaba una lista de precios sin fechas y el frontend alineaba dos series
por posición en el arreglo, así que un día feriado en México corría un año entero de rendimientos.

``/v2/panel`` cruza las series con INNER JOIN por fecha y **no rellena precios**: un símbolo que no
operó ese día se queda fuera de esa fecha en vez de repetir el precio anterior, que inventaría un
rendimiento de cero. Lo que no se pudo alinear sale en ``dropped`` con su motivo.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query

from kaizen_api.domain import fx as fx_domain
from kaizen_api.domain import history as history_domain
from kaizen_api.errors import ApiError
from kaizen_api.provenance import meta
from kaizen_api.providers.yahoo import prices
from kaizen_api.routers import ERROR_RESPONSES, IsoDateQuery, SymbolPath, Symbols, cache_control, check_date_range
from kaizen_api.routers.quotes import FxPairQuery
from kaizen_api.schemas import CcyParam, FxHistoryResponse, HistoryResponse, Interval, PanelResponse, Range

router = APIRouter(prefix="/v2", tags=["históricos"], responses=ERROR_RESPONSES)
CAPABILITIES: list[str] = ["history", "panel", "fx.history"]

RangeQuery = Annotated[Range, Query(alias="range", description="Periodo hacia atrás")]
IntervalQuery = Annotated[Interval, Query(description="Frecuencia de las observaciones")]
CcyQuery = Annotated[CcyParam, Query(description="native = moneda de cotización")]


def _source_token(series: history_domain.PriceSeries) -> str:
    """``meta.source`` de una serie: Yahoo, y Banxico también si el tipo de cambio salió del FIX."""
    if series.fx_source == fx_domain.BANXICO_FIX_SOURCE:
        return "yahoo,banxico"
    return "yahoo"


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
    series = history_domain.get_series(symbol, range_, interval, ccy)
    fx_used = None
    if series.fx_pair:
        fx_used = {"pair": series.fx_pair, "source": series.fx_source}
    return {
        "symbol": series.symbol,
        "currency": series.currency,
        "interval": series.interval,
        "adjusted": True,
        "dates": series.dates,
        "close": series.close,
        "fx": fx_used,
        "meta": meta(
            _source_token(series),
            as_of=series.as_of,
            delay_minutes=prices.DELAY_MINUTES,
            stale=history_domain.is_stale(series.symbol, series.as_of, series.interval),
            fallback=series.fx_source == fx_domain.YAHOO_SOURCE,
            notes=series.notes,
        ),
    }


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
    series_by_symbol: dict[str, history_domain.PriceSeries] = {}
    dropped: list[dict] = []
    notes: list[str] = []
    used_banxico = False
    used_yahoo_fx = False

    for symbol in symbols:
        try:
            series = history_domain.get_series(symbol, range_, interval, ccy)
        except ApiError as exc:
            dropped.append({"symbol": symbol, "reason": exc.message})
            continue
        if not series.dates:
            dropped.append({"symbol": symbol, "reason": "No hay observaciones en el periodo pedido."})
            continue
        series_by_symbol[series.symbol] = series
        used_banxico = used_banxico or series.fx_source == fx_domain.BANXICO_FIX_SOURCE
        used_yahoo_fx = used_yahoo_fx or series.fx_source == fx_domain.YAHOO_SOURCE

    if not series_by_symbol:
        raise ApiError(
            404,
            "NOT_FOUND",
            "Ninguna emisora de la lista tiene histórico para alinear.",
            details={"dropped": dropped},
        )

    mixed = {s.currency for s in series_by_symbol.values()}
    if len(mixed) > 1:
        raise ApiError(
            400,
            "BAD_REQUEST",
            "Las emisoras cotizan en monedas distintas (" + ", ".join(sorted(mixed)) + "). "
            "Pide ccy=MXN o ccy=USD para poder compararlos.",
        )
    currency = mixed.pop()

    common = set.intersection(*(set(s.dates) for s in series_by_symbol.values()))
    dates = sorted(common)
    if not dates:
        raise ApiError(
            404,
            "NOT_FOUND",
            "Los símbolos pedidos no comparten ninguna fecha de mercado, así que no hay nada que alinear.",
            details={"dropped": dropped + [{"symbol": s, "reason": "sin fechas en común"} for s in series_by_symbol]},
        )

    prices_by_symbol: dict[str, list[float]] = {}
    for symbol, series in series_by_symbol.items():
        by_date = dict(zip(series.dates, series.close, strict=True))
        prices_by_symbol[symbol] = [by_date[d] for d in dates]

    total = sum(len(s.dates) for s in series_by_symbol.values())
    kept = len(dates) * len(series_by_symbol)
    if total > kept:
        notes.append(
            f"Se cruzaron las series por fecha: quedaron {len(dates)} fechas comunes de {total} "
            "observaciones. Las fechas que no tenían todos los símbolos se quitaron, no se rellenaron."
        )
    for series in series_by_symbol.values():
        for note in series.notes:
            if note not in notes:
                notes.append(note)

    late = sorted(
        symbol
        for symbol, series in series_by_symbol.items()
        if history_domain.is_stale(symbol, series.as_of, series.interval)
    )
    if late:
        notes.append("Vienen atrasados, les falta al menos una jornada ya cerrada: " + ", ".join(late) + ".")

    source = "yahoo,banxico" if used_banxico else "yahoo"
    return {
        "currency": currency,
        "interval": interval,
        "dates": dates,
        "prices": prices_by_symbol,
        "dropped": dropped,
        "meta": meta(
            source,
            as_of=dates[-1],
            delay_minutes=prices.DELAY_MINUTES,
            stale=bool(late),
            fallback=used_yahoo_fx,
            notes=notes,
        ),
    }


@router.get(
    "/fx/history",
    response_model=FxHistoryResponse,
    dependencies=[cache_control("history")],
    summary="Serie diaria del tipo de cambio (FIX SF43718 con token, si no Yahoo marcado)",
)
def fx_history(pair: FxPairQuery = "USDMXN", start: IsoDateQuery = None, end: IsoDateQuery = None) -> FxHistoryResponse:
    first, last = check_date_range(start, end)
    series = fx_domain.daily_range(first, last, pair)
    source = "banxico" if series.source == fx_domain.BANXICO_FIX_SOURCE else "yahoo"
    return {
        "pair": pair.upper(),
        "dates": series.dates,
        "values": series.values,
        "source": series.source,
        "meta": meta(
            source,
            as_of=series.dates[-1],
            delay_minutes=None if source == "banxico" else prices.DELAY_MINUTES,
            stale=fx_domain.series_is_stale(series),
            fallback=series.fallback,
            notes=series.notes,
        ),
    }
