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

MINOR_UNITS: dict[str, tuple[str, float]] = {"GBp": ("GBP", 100.0), "ZAc": ("ZAR", 100.0)}
"""Unidades menores que Yahoo reporta en algunas plazas, con su moneda mayor y su divisor.

Londres cotiza en peniques (``GBp``) y Johannesburgo en centavos (``ZAc``). La llave se compara
CRUDA, sin pasar a mayúsculas, porque ``GBp`` y ``GBP`` solo se distinguen por esa minúscula: al
normalizar antes de comparar, 7420 peniques salían etiquetados como 7420 libras, cien veces el
valor real y con un código ISO que se ve correcto. Esto es lo que ``schemas.py`` promete por
escrito, y la frontera donde toca cumplirlo es esta, no cada ruta.
"""

PRICE_FIELDS = (
    "regularMarketPrice",
    "currentPrice",
    "regularMarketPreviousClose",
    "previousClose",
    "regularMarketOpen",
    "open",
    "regularMarketDayHigh",
    "regularMarketDayLow",
    "dayHigh",
    "dayLow",
    "fiftyTwoWeekHigh",
    "fiftyTwoWeekLow",
    "bid",
    "ask",
)
"""Campos de ``info`` que vienen por acción y por lo tanto en la misma unidad que ``currency``."""

MAJOR_WITH_MINOR = frozenset(major for major, _ in MINOR_UNITS.values())
"""Monedas mayores que tienen unidad menor. Fuera de estas no hay nada que dividir ni que consultar."""

DIVISOR_KEY = "_minorUnitDivisor"
"""Divisor que ya se aplicó al ``info``, para que quien lea cierres del histórico sepa cuál usar."""


def normalize_currency(reported: object) -> tuple[str, float]:
    """``(código ISO en mayúsculas, divisor)`` de la moneda que reporta Yahoo.

    ``GBp`` devuelve ``("GBP", 100.0)`` y ``MXN`` devuelve ``("MXN", 1.0)``. Es idempotente: pasarle
    un código ya normalizado no vuelve a dividir, porque las llaves llevan la minúscula.
    """
    text = str(reported or "").strip()
    major, divisor = MINOR_UNITS.get(text, (text.upper(), 1.0))
    return major.upper(), divisor


def normalize_info(info: dict) -> dict:
    """``info`` con la moneda en su unidad mayor y los precios por acción divididos entre 100.

    Solo toca los símbolos que cotizan en unidad menor (``.L`` y ``.JO``); para todo lo demás
    devuelve el mismo diccionario sin cambios.
    """
    major, divisor = normalize_currency(info.get("currency"))
    if divisor == 1.0:
        return info
    out = dict(info)
    out["currency"] = major
    out[DIVISOR_KEY] = divisor
    for field in PRICE_FIELDS:
        value = out.get(field)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            out[field] = float(value) / divisor
    return out


def minor_unit_divisor(symbol: str) -> float:
    """Divisor de unidad menor de un símbolo, leído del ``info`` ya cacheado (no pide nada a Yahoo).

    Los cierres de ``history()`` vienen en la MISMA unidad que ``info.currency``, así que quien
    arma una serie tiene que dividirlos igual que el precio puntual.
    """
    return float(fetch_info(symbol).get(DIVISOR_KEY) or 1.0)


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
        return normalize_info(dict(info)) if isinstance(info, dict) else {}

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
