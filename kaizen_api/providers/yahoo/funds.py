"""Composición de un fondo en Yahoo: ``Ticker.funds_data`` con caché (stream V5PF).

Proveedor propio para no tocar ``fundamentals.py`` (de B3a). Todo pasa por ``yft()``, así que el
replay graba cada propiedad por separado (``yf:SPY:funds_data.top_holdings``). Una llamada por
fondo: las propiedades comparten la misma descarga dentro de yfinance.

Lo que entrega yfinance 1.7 y que aquí se respeta tal cual:

* ``top_holdings``: DataFrame indexado por ``Symbol`` con ``Name`` y ``Holding Percent``
  (fracción). Solo las 10 principales.
* ``sector_weightings``: dict ``{"technology": 0.3869, ...}`` en fracción.
* ``asset_classes``: dict con ``stockPosition``, ``bondPosition``, ``cashPosition``,
  ``preferredPosition``, ``convertiblePosition`` y ``otherPosition``.
* ``fund_overview``: ``categoryName``, ``family`` y ``legalType``.
* ``fund_operations``: DataFrame con ``Annual Report Expense Ratio``, ``Annual Holdings
  Turnover`` y ``Total Net Assets`` en la columna del símbolo y en ``Category Average``.
* ``equity_holdings``: DataFrame con ``Price/Earnings`` y compañía. OJO: Yahoo manda ahí el
  RENDIMIENTO de utilidades (0.04035), no el múltiplo.

Ningún campo de calificación de analistas ni de precio objetivo sale de aquí: se quitan por llave
(``Firm``, ``ToGrade``, ``FromGrade``, ``Action``, ``rating``, ``target``) antes de devolver nada.
``bond_ratings`` no se pide.
"""

from __future__ import annotations

import math
import re
from typing import Any

import pandas as pd

from kaizen_api.cache import _cached
from kaizen_api.providers.yahoo.session import yft

FUNDS_TTL = 12 * 3600
"""La composición cambia una vez al mes; 12 horas de caché sobran."""

PROPERTIES = ("top_holdings", "sector_weightings", "asset_classes", "fund_overview", "fund_operations", "equity_holdings")

_FORBIDDEN = re.compile(r"(firm|tograde|fromgrade|^action$|rating|target)", re.IGNORECASE)
"""Llaves de recomendación que nunca llegan al dominio (regla del producto)."""


def is_forbidden_key(key: Any) -> bool:
    """¿La llave es de una calificación de analista o de un precio objetivo?"""
    return bool(_FORBIDDEN.search(str(key)))


def _number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _clean_dict(data: Any) -> dict:
    if not isinstance(data, dict):
        return {}
    return {str(k): v for k, v in data.items() if not is_forbidden_key(k)}


def _holdings(frame: Any) -> list[dict]:
    if not isinstance(frame, pd.DataFrame) or frame.empty:
        return []
    frame = frame[[c for c in frame.columns if not is_forbidden_key(c)]]
    out: list[dict] = []
    for symbol, row in frame.iterrows():
        weight = _number(row.get("Holding Percent"))
        if weight is None:
            continue
        name = row.get("Name")
        out.append({
            "symbol": str(symbol) if symbol not in (None, "") and not pd.isna(symbol) else None,
            "name": str(name) if isinstance(name, str) and name else None,
            "weight": weight,
        })
    return out


def _operations(frame: Any, symbol: str) -> dict:
    """``{"expenseRatio", "turnover", "totalNetAssets"}`` en crudo, solo de la columna del fondo.

    ``Category Average`` no se lee: en Total Net Assets Yahoo copia ahí el dato del fondo.
    """
    out = {"expenseRatio": None, "turnover": None, "totalNetAssets": None}
    if not isinstance(frame, pd.DataFrame) or frame.empty:
        return out
    own = symbol if symbol in frame.columns else next((c for c in frame.columns if c != "Category Average"), None)

    def cell(row: str, column: str | None) -> float | None:
        if column is None or row not in frame.index or column not in frame.columns:
            return None
        return _number(frame.at[row, column])

    out["expenseRatio"] = cell("Annual Report Expense Ratio", own)
    out["turnover"] = cell("Annual Holdings Turnover", own)
    out["totalNetAssets"] = cell("Total Net Assets", own)
    return out


def _equity(frame: Any, symbol: str) -> dict:
    if not isinstance(frame, pd.DataFrame) or frame.empty:
        return {}
    own = symbol if symbol in frame.columns else next((c for c in frame.columns if c not in ("Average", "Category Average")), None)
    if own is None:
        return {}
    labels = frame["Average"] if "Average" in frame.columns else frame.index
    out: dict[str, float | None] = {}
    for label, value in zip(labels, frame[own], strict=False):
        if not is_forbidden_key(label):
            out[str(label)] = _number(value)
    return out


def get_fund_data(symbol: str) -> dict | None:
    """Composición limpia de un fondo, o ``None`` si Yahoo no la tiene (acción, ETF de la BMV).

    Devuelve ``{"holdings", "sectors", "assetClasses", "overview", "operations", "equity"}`` con
    números en fracción tal como los publica Yahoo.
    """
    key = symbol.upper()

    def fetch() -> dict | None:
        try:
            data = yft(key).funds_data
            raw = {name: getattr(data, name) for name in PROPERTIES}
        except Exception:
            return None
        holdings = _holdings(raw["top_holdings"])
        sectors = {k: _number(v) for k, v in _clean_dict(raw["sector_weightings"]).items()}
        classes = {k: _number(v) for k, v in _clean_dict(raw["asset_classes"]).items()}
        if not holdings and not any(v for v in sectors.values()) and not any(v for v in classes.values()):
            return None
        return {
            "holdings": holdings,
            "sectors": sectors,
            "assetClasses": classes,
            "overview": _clean_dict(raw["fund_overview"]),
            "operations": _operations(raw["fund_operations"], key),
            "equity": _equity(raw["equity_holdings"], key),
        }

    return _cached(f"v5pf:fund:{key}", fetch, ttl=FUNDS_TTL, ok=lambda d: d is not None)
