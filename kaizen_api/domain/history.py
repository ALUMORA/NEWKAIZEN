"""Históricos de precios: el legado (``get_chart``, ``get_returns``, ``_fetch_hist``) y la costura v2.

La costura CONGELADA es ``get_series(symbol, range, interval, ccy) -> PriceSeries``. B2 la
implementa y todo lo que necesite precios (beta, momentum, panel, valuación) la consume en vez de
llamar a yfinance directo. Hasta entonces lanza ``NotImplementedError``.

Contrato de ``get_series``:

* Cierres AJUSTADOS por splits y dividendos (rendimiento total), en orden cronológico, una
  observación por fecha de mercado (``YYYY-MM-DD``, sin hora ni zona).
* ``range``: ``1mo 3mo 6mo 1y 2y 5y 10y max``; ``interval``: ``1d 1wk 1mo``.
* ``ccy``: ``native`` (moneda de cotización), ``MXN`` o ``USD``. La conversión usa el tipo de
  cambio de LA MISMA fecha, con relleno hacia adelante de a lo más 3 días en huecos del FX; cada
  relleno se anota en ``notes``. Sin FX para una fecha, esa observación se descarta y se anota.
* Nunca inventa datos: sin histórico lanza ``ApiError`` (``NOT_FOUND`` o ``UPSTREAM_UNAVAILABLE``).

Legado: ``_fetch_hist`` y ``get_chart`` quedan idénticos a backend.py; los goldens lo prueban.
"""

import time
from dataclasses import dataclass, field

import yfinance as yf

from kaizen_api.cache import _cached
from kaizen_api.providers.yahoo.session import yft

RANGES = ("1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "max")
INTERVALS = ("1d", "1wk", "1mo")
CURRENCIES = ("native", "MXN", "USD")


@dataclass(frozen=True)
class PriceSeries:
    """Serie de cierres ajustados lista para ``HistoryResponse`` (mismos nombres de campo)."""

    symbol: str
    currency: str
    interval: str
    dates: list[str]
    close: list[float]
    source: str
    as_of: str | None = None
    fx_pair: str | None = None
    fx_source: str | None = None
    notes: list[str] = field(default_factory=list)
    adjusted: bool = True

    def __post_init__(self) -> None:
        if len(self.dates) != len(self.close):
            raise ValueError("dates y close deben tener la misma longitud")


def get_series(symbol: str, range: str = "1y", interval: str = "1d", ccy: str = "native") -> PriceSeries:
    """Costura CONGELADA de históricos v2 (ver el docstring del módulo). La implementa B2."""
    raise NotImplementedError("get_series lo implementa el stream B2")


def _fetch_hist(sym: str, period: str = "5d", interval: str = "1d"):
    """Intenta obtener histórico con múltiples estrategias."""
    # Estrategia 1: yft().history() con sesión custom (2 intentos)
    for attempt in range(2):
        try:
            hist = yft(sym).history(period=period, interval=interval)
            if hist is not None and not hist.empty:
                return hist
        except Exception:
            pass
        if attempt == 0:
            time.sleep(1.5)
    # Estrategia 2: yf.download() usa endpoint distinto de Yahoo
    try:
        hist = yf.download(
            sym, period=period, interval=interval,
            progress=False, auto_adjust=True,
        )
        if hist is not None and not hist.empty:
            # Aplanar MultiIndex si lo hay (ocurre con múltiples tickers)
            if hasattr(hist.columns, "levels"):
                hist.columns = hist.columns.get_level_values(0)
            return hist
    except Exception:
        pass
    return None


def get_returns(ticker: str) -> dict:
    """Retorna el rendimiento (%) para cada período estándar usando datos semanales de 5 años."""
    try:
        hist = yft(ticker.upper()).history(period="5y", interval="1wk")
        closes = hist["Close"].dropna()
        n = len(closes)
        last = float(closes.iloc[-1]) if n >= 1 else None

        period_weeks = [("1mo", 4), ("3mo", 13), ("6mo", 26), ("1y", 52), ("2y", 104), ("5y", 260)]
        result = {}
        for pid, weeks in period_weeks:
            # N períodos atrás es la barra -(N+1): iloc[-N] solo cubría N-1 semanas
            if last and n >= weeks + 1:
                first = float(closes.iloc[-(weeks + 1)])
                result[pid] = round((last / first - 1) * 100, 2) if first > 0 else None
            else:
                result[pid] = None
        return result
    except Exception as e:
        return {pid: None for pid in ["1mo", "3mo", "6mo", "1y", "2y", "5y"]}


def _is_mxn(ticker: str) -> bool:
    return ticker.upper().endswith(".MX") or ticker == "$MXN"


def get_chart(ticker: str, period: str = "5y", ccy: str = "") -> dict:
    """Cierres por periodo. Con ccy=MXN los activos en USD se convierten con el USD/MXN
    de la misma fecha, para que Sharpe, backtest y Monte Carlo midan en pesos contra la
    tasa libre de riesgo mexicana (antes se restaba la tasa MX a retornos en dólares)."""
    period_interval = {
        "1mo": ("1mo", "1d"),
        "3mo": ("3mo", "1d"),
        "6mo": ("6mo", "1wk"),
        "1y":  ("1y",  "1wk"),
        "2y":  ("2y",  "1wk"),
        "5y":  ("5y",  "1wk"),
        "10y": ("10y", "1wk"),
    }
    yf_period, interval = period_interval.get(period, ("1y", "1wk"))
    hist = yft(ticker).history(period=yf_period, interval=interval)
    close = hist["Close"].dropna()
    currency = "MXN" if _is_mxn(ticker) else "USD"
    if ccy.upper() == "MXN" and currency == "USD" and not close.empty:
        # El FX se cachea por periodo: sin esto cada gráfica en USD pedía a Yahoo dos series
        fx = _cached(f"fx_hist:{yf_period}:{interval}",
                     lambda: yft("MXN=X").history(period=yf_period, interval=interval)["Close"].dropna(),
                     ttl=3600, ok=lambda v: not v.empty)
        if fx.empty:
            return {"error": "Sin histórico USD/MXN para convertir", "closes": [], "period": period, "bars": 0}
        # Las zonas horarias difieren entre series; se alinea por fecha con el último FX disponible
        close.index = close.index.tz_localize(None).normalize()
        fx = fx.copy()   # la serie cacheada es compartida entre hilos: no se muta
        fx.index = fx.index.tz_localize(None).normalize()
        fx = fx[~fx.index.duplicated(keep="last")]
        close = close[~close.index.duplicated(keep="last")]
        fx_aligned = fx.reindex(close.index, method="ffill").bfill()
        close = (close * fx_aligned).dropna()
        currency = "MXN"
    closes = [round(float(v), 4) for v in close.tolist()]
    return {"closes": closes, "period": period, "bars": len(closes), "currency": currency}
