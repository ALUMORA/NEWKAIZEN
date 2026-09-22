"""Fundamentales de Yahoo para el v2: accesos con caché a ``info``, estados, dividendos,
calendario y operaciones de consejeros.

Todo pasa por ``yft()`` (costura congelada) para que el replay lo grabe, y todo va envuelto en
caché de ``kaizen_api.cache`` para no pedirle a Yahoo lo mismo tres veces en una sola ficha, que
es lo que hacía el legado e invitaba al límite de tasa.

Datos de yfinance 1.7 que hay que respetar y que este módulo no corrige por su cuenta:

* ``info["currency"]`` es la moneda de COTIZACIÓN y ``info["financialCurrency"]`` la de los
  ESTADOS. En AAPL.MX son MXN y USD. Los convierte ``domain/currency.py``.
* Vienen en la moneda del precio: ``marketCap``, ``currentPrice``, ``previousClose``,
  ``dayLow``/``dayHigh``, los 52 semanas, ``trailingEps``, ``bookValue`` y por lo tanto
  ``trailingPE``, ``forwardPE`` y ``priceToBook``.
* Vienen en la moneda de los estados: ``totalRevenue``, ``netIncomeToCommon``, ``totalDebt``,
  ``totalCash``, ``ebitda``, ``grossProfits``, ``operatingCashflow`` y ``freeCashflow``.
* Salen mezcladas y NO se deben usar tal cual: ``priceToSalesTrailing12Months``,
  ``enterpriseValue`` y ``enterpriseToEbitda`` (AAPL.MX: 182.6 y 507.5, que es capitalización en
  pesos entre estados en dólares).
* ``info["dividendYield"]`` ya viene en porcentaje y ``trailingAnnualDividendYield`` en fracción.
* ``info["debtToEquity"]`` viene en PORCENTAJE (78.445 = 0.78 veces).
* ``info["beta"]`` es 5 años mensual contra el S&P 500, sirva o no para el papel.
"""

from __future__ import annotations

import pandas as pd

from kaizen_api.cache import _cached
from kaizen_api.providers.yahoo.session import yft

INFO_TTL = 6 * 3600
"""``info`` cambia con el precio, pero la ficha se cachea seis horas como los fundamentales."""

STATEMENT_TTL = 21600
DIVIDENDS_TTL = 21600
CALENDAR_TTL = 21600
INSIDERS_TTL = 21600

STATEMENT_ATTRS: dict[tuple[str, str], str] = {
    ("income", "annual"): "income_stmt",
    ("income", "quarterly"): "quarterly_income_stmt",
    ("balance", "annual"): "balance_sheet",
    ("balance", "quarterly"): "quarterly_balance_sheet",
    ("cash", "annual"): "cashflow",
    ("cash", "quarterly"): "quarterly_cashflow",
}
"""``(estado, frecuencia)`` al atributo de ``yfinance.Ticker`` que lo entrega."""


def _ok_frame(value) -> bool:
    return isinstance(value, pd.DataFrame) and not value.empty


def get_info(symbol: str) -> dict:
    """``Ticker.info`` con caché. Devuelve ``{}`` si Yahoo no contesta o no conoce el símbolo."""

    def fetch() -> dict:
        try:
            data = yft(symbol).info
        except Exception:
            return {}
        return data if isinstance(data, dict) else {}

    return _cached(f"v2:info:{symbol.upper()}", fetch, ttl=INFO_TTL, ok=lambda d: len(d) > 5)


def get_fast_value(symbol: str, name: str):
    """Una propiedad de ``fast_info`` (``last_price``, ``shares``, ``market_cap``...) o ``None``."""

    def fetch():
        try:
            return getattr(yft(symbol).fast_info, name, None)
        except Exception:
            return None

    return _cached(f"v2:fast:{symbol.upper()}:{name}", fetch, ttl=INFO_TTL, ok=lambda v: v is not None)


def get_statement(symbol: str, kind: str, freq: str = "annual") -> pd.DataFrame | None:
    """Estado financiero de Yahoo como ``DataFrame`` (renglones = conceptos, columnas = cierres).

    ``kind``: ``income``, ``balance`` o ``cash``. ``freq``: ``annual`` o ``quarterly``.
    Devuelve ``None`` cuando Yahoo no lo tiene (ETF, índice, emisora sin estados).
    """
    attr = STATEMENT_ATTRS.get((kind, freq))
    if attr is None:
        raise ValueError(f"estado desconocido: {kind}/{freq}")

    def fetch() -> pd.DataFrame | None:
        try:
            frame = getattr(yft(symbol), attr)
        except Exception:
            return None
        return frame if _ok_frame(frame) else None

    return _cached(f"v2:stmt:{symbol.upper()}:{attr}", fetch, ttl=STATEMENT_TTL, ok=_ok_frame)


def get_dividends(symbol: str) -> pd.Series | None:
    """Serie de dividendos por acción, indexada por fecha de pago, en la moneda de cotización."""

    def fetch() -> pd.Series | None:
        try:
            series = yft(symbol).dividends
        except Exception:
            return None
        if not isinstance(series, pd.Series) or series.empty:
            return None
        return series

    return _cached(
        f"v2:div:{symbol.upper()}",
        fetch,
        ttl=DIVIDENDS_TTL,
        ok=lambda s: isinstance(s, pd.Series) and not s.empty,
    )


def get_calendar(symbol: str) -> dict:
    """``Ticker.calendar``: fechas de reporte, ex dividendo y pago. ``{}`` si no hay."""

    def fetch() -> dict:
        try:
            data = yft(symbol).calendar
        except Exception:
            return {}
        if isinstance(data, pd.DataFrame):
            return data.to_dict() if not data.empty else {}
        return data if isinstance(data, dict) else {}

    return _cached(f"v2:cal:{symbol.upper()}", fetch, ttl=CALENDAR_TTL, ok=lambda d: bool(d))


def get_insider_transactions(symbol: str) -> pd.DataFrame | None:
    """``Ticker.insider_transactions``. Yahoo solo cubre Form 4 de EE. UU.: la BMV sale vacía."""

    def fetch() -> pd.DataFrame | None:
        try:
            frame = yft(symbol).insider_transactions
        except Exception:
            return None
        return frame if _ok_frame(frame) else None

    return _cached(f"v2:insiders:{symbol.upper()}", fetch, ttl=INSIDERS_TTL, ok=_ok_frame)
