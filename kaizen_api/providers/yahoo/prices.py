"""Precios de Yahoo para el v2 (stream B2a): cotización puntual, histórico ajustado y lotes.

Aquí vive la lectura de cotizaciones e históricos que usan ``domain.history.get_series``,
``domain.fx`` y ``domain.markets``. Datos que hay que respetar (yfinance 1.7): los índices de
``history()`` vienen en datetime64[s] con zona (Nueva York para EE. UU., Ciudad de México para
``.MX`` y ``^MXX``, Londres para ``MXN=X``) y ``yf.download`` regresa columnas MultiIndex con
índice sin zona y renglones de fin de semana si el lote mezcla cripto: siempre ``dropna`` por
columna.

Dos reglas de las que depende todo lo demás:

* **Las fechas se sacan del índice tal cual se ve en su zona**, con ``tz_localize(None)``. El cierre
  del 22 de septiembre en Nueva York y el del 22 de septiembre en Londres son ambos ``2026-09-22``,
  que es lo que hace comparables una serie en dólares y el tipo de cambio.
* **``history()`` ya viene ajustado** por splits y dividendos (``auto_adjust=True`` es el valor por
  omisión de yfinance 1.x), así que ``close`` es rendimiento total y el contrato puede declarar
  ``adjusted: true`` sin mentir.

Nada de esto inventa datos: si Yahoo no contesta o contesta vacío, las funciones devuelven ``None``
o un diccionario vacío y quien llama decide el error del contrato.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from typing import Any

import yfinance as yf

from kaizen_api.cache import _cached
from kaizen_api.domain import _log
from kaizen_api.providers.yahoo.session import yft

QUOTE_TTL = 30
"""Segundos que se guarda una cotización (misma clase de caché que ``Cache-Control: quotes``)."""

HISTORY_TTL = 3600
"""Segundos que se guarda una serie histórica."""

DELAY_MINUTES = 15
"""Retraso típico de Yahoo para acciones y ETF. Se publica en ``meta.delayMinutes``."""

MAX_WORKERS = 6
"""Hilos para pedir varios símbolos a la vez sin pasarse con el límite de tasa de Yahoo."""


def _dates_and_closes(hist: Any) -> tuple[list[str], list[float]]:
    """``(fechas ISO, cierres)`` de un DataFrame de ``history()``, en orden y sin duplicados."""
    if hist is None or getattr(hist, "empty", True) or "Close" not in getattr(hist, "columns", []):
        return [], []
    close = hist["Close"].dropna()
    if close.empty:
        return [], []
    index = close.index
    if getattr(index, "tz", None) is not None:
        index = index.tz_localize(None)
    close = close.copy()
    close.index = index.normalize()
    close = close[~close.index.duplicated(keep="last")].sort_index()
    dates = [d.date().isoformat() for d in close.index]
    values = [float(v) for v in close.tolist()]
    return dates, values


def fetch_history(symbol: str, period: str, interval: str) -> Any:
    """Histórico ajustado de un símbolo. ``None`` si Yahoo no contesta o viene vacío.

    La llave del replay deja fuera los valores por omisión, así que ``interval="1d"`` reproduce la
    misma llamada grabada que omitirlo.
    """

    def _fetch():
        try:
            hist = yft(symbol).history(period=period, interval=interval)
        except Exception as exc:
            _log(f"prices: history({symbol}, {period}, {interval}) falló ({exc})")
            return None
        if hist is None or hist.empty:
            return None
        return hist

    return _cached(
        f"v2:hist:{symbol.upper()}:{period}:{interval}",
        _fetch,
        ttl=HISTORY_TTL,
        ok=lambda h: h is not None and not h.empty,
    )


def fetch_series(symbol: str, period: str, interval: str) -> tuple[list[str], list[float]]:
    """``(fechas ISO, cierres ajustados)`` de un símbolo. Listas vacías si no hay dato."""
    return _dates_and_closes(fetch_history(symbol, period, interval))


def fetch_info(symbol: str) -> dict:
    """``Ticker.info`` de un símbolo, o ``{}`` si Yahoo no lo tiene.

    Un símbolo inexistente devuelve un diccionario sin precio (Yahoo contesta 404 y yfinance
    entrega ``{"trailingPegRatio": None}``), así que quien llama comprueba el precio, no el tamaño.
    """

    def _fetch():
        try:
            info = yft(symbol).info
        except Exception as exc:
            _log(f"prices: info({symbol}) falló ({exc})")
            return {}
        return dict(info) if isinstance(info, dict) else {}

    return _cached(f"v2:info:{symbol.upper()}", _fetch, ttl=QUOTE_TTL, ok=lambda d: bool(d))


def fetch_infos(symbols: list[str]) -> dict[str, dict]:
    """``info`` de varios símbolos en paralelo, respetando el orden pedido."""
    if not symbols:
        return {}
    workers = min(MAX_WORKERS, len(symbols))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(fetch_info, symbols))
    return dict(zip(symbols, results, strict=True))


def download_closes(symbols: list[str], period: str = "5d", interval: str = "1d") -> dict[str, dict]:
    """Cierres ajustados de varios símbolos en UNA llamada a ``yf.download``.

    Devuelve ``{símbolo: {"dates": [...], "closes": [...]}}`` solo con los que trajeron dato. Es la
    forma barata de armar ``/v2/markets/*``: una sola petición en vez de una por símbolo, que es
    justo lo que el límite de tasa de Yahoo castiga.
    """
    if not symbols:
        return {}

    def _fetch() -> dict[str, dict]:
        try:
            raw = yf.download(symbols, period=period, interval=interval, progress=False, auto_adjust=True)
        except Exception as exc:
            _log(f"prices: download({len(symbols)} símbolos, {period}) falló ({exc})")
            return {}
        if raw is None or raw.empty:
            return {}
        columns = raw.columns
        if hasattr(columns, "levels") and "Close" in columns.get_level_values(0):
            closes = raw["Close"]
        else:
            closes = raw
        out: dict[str, dict] = {}
        for symbol in symbols:
            if symbol not in closes.columns:
                continue
            frame = closes[[symbol]].rename(columns={symbol: "Close"})
            dates, values = _dates_and_closes(frame)
            if dates:
                out[symbol] = {"dates": dates, "closes": values}
        return out

    key = f"v2:bulk:{period}:{interval}:" + ",".join(symbols)
    return _cached(key, _fetch, ttl=QUOTE_TTL, ok=bool)
