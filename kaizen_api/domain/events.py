"""Calendario de eventos por símbolo: reporte de resultados, fecha ex dividendo y de pago.

Sale del ``calendar`` de Yahoo y, cuando ahí falta algo, de las fechas que trae ``info``
(``earningsTimestamp``, ``exDividendDate``, ``dividendDate``). Un símbolo sin calendario
simplemente no aporta renglones: no se inventa ninguna fecha ni se estima un monto.

Yahoo no publica el MONTO del dividendo que viene, solo su fecha, así que ``amount`` va en
``None`` y la nota lo dice. ``estimate`` del reporte es el consenso de UPA (``Earnings Average``).
"""

from __future__ import annotations

import datetime as _dt
from typing import Any

from kaizen_api.domain import safe
from kaizen_api.domain.currency import normalize_currency
from kaizen_api.providers.yahoo import fundamentals as _yahoo

CALENDAR_FIELDS: dict[str, str] = {
    "Earnings Date": "earnings",
    "Ex-Dividend Date": "exDividend",
    "Dividend Date": "dividendPay",
}
"""Llave del ``calendar`` de Yahoo al tipo de evento del contrato."""

INFO_FIELDS: dict[str, str] = {
    "earningsTimestamp": "earnings",
    "exDividendDate": "exDividend",
    "dividendDate": "dividendPay",
}
"""Respaldo: las mismas fechas en ``info``, en segundos desde época."""


def _as_date(value: Any) -> str | None:
    """Cualquier cosa que Yahoo use para una fecha a ``YYYY-MM-DD``, o ``None``."""
    if value is None:
        return None
    if isinstance(value, _dt.datetime):
        return value.date().isoformat()
    if isinstance(value, _dt.date):
        return value.isoformat()
    if isinstance(value, (int, float)):
        number = safe(value)
        if number is None or number <= 0:
            return None
        try:
            return _dt.datetime.fromtimestamp(number, _dt.UTC).date().isoformat()
        except (OSError, OverflowError, ValueError):
            return None
    text = str(value)[:10]
    try:
        _dt.date.fromisoformat(text)
    except ValueError:
        return None
    return text


def _symbol_events(symbol: str, notes: list[str]) -> list[dict]:
    calendar = _yahoo.get_calendar(symbol)
    info = _yahoo.get_info(symbol)
    currency, _divisor = normalize_currency(info.get("currency"))
    estimate = safe(calendar.get("Earnings Average")) if isinstance(calendar, dict) else None
    found: set[tuple[str, str]] = set()
    items: list[dict] = []

    def add(kind: str, raw: Any) -> None:
        date = _as_date(raw)
        if not date or (kind, date) in found:
            return
        found.add((kind, date))
        items.append({
            "symbol": symbol,
            "type": kind,
            "date": date,
            "estimate": round(estimate, 4) if kind == "earnings" and estimate is not None else None,
            "amount": None,
            "currency": currency if kind in ("exDividend", "dividendPay") else None,
        })

    if isinstance(calendar, dict):
        for field, kind in CALENDAR_FIELDS.items():
            value = calendar.get(field)
            if isinstance(value, (list, tuple, set)):
                for item in value:
                    add(kind, item)
            else:
                add(kind, value)
    for field, kind in INFO_FIELDS.items():
        add(kind, info.get(field))
    if items and any(item["type"] in ("exDividend", "dividendPay") for item in items):
        notes.append("Yahoo publica la fecha del dividendo que viene, no su monto.")
    return items


def get_events(symbols: list[str]) -> dict:
    """Eventos de varios símbolos, ordenados por fecha y luego por símbolo.

    Devuelve ``{"items", "notes", "as_of", "missing"}``; el router arma ``meta``. ``missing`` son
    los símbolos para los que Yahoo no publicó ninguna fecha.
    """
    notes: list[str] = []
    items: list[dict] = []
    missing: list[str] = []
    for symbol in symbols:
        found = _symbol_events(symbol.upper(), notes)
        if not found:
            missing.append(symbol.upper())
        items.extend(found)
    items.sort(key=lambda row: (row["date"], row["symbol"], row["type"]))
    if missing:
        notes.append("Sin fechas publicadas para: " + ", ".join(missing) + ".")
    # Sin duplicar la misma nota cuando se piden varios símbolos.
    unique_notes = list(dict.fromkeys(notes))
    return {
        "items": items,
        "notes": unique_notes,
        "as_of": items[-1]["date"] if items else None,
        "missing": missing,
    }
