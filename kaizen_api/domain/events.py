"""Calendario de eventos por símbolo: reporte de resultados, fecha ex dividendo y de pago.

Sale del ``calendar`` de Yahoo y, cuando ahí falta algo, de las fechas que trae ``info``
(``earningsTimestamp``, ``exDividendDate``, ``dividendDate``). Un símbolo sin calendario
simplemente no aporta renglones: no se inventa ninguna fecha ni se estima un monto.

Yahoo no publica el MONTO del dividendo que viene, solo su fecha, así que ``amount`` va en
``None`` y la nota lo dice. ``estimate`` del reporte es el consenso de UPA (``Earnings Average``),
y desde la fase 5 (V5PF) ``estimateLow`` y ``estimateHigh`` su rango (``Earnings Low``/``High``).

``dividend_summary`` (fase 5) resume la historia de dividendos de cada símbolo: el último pagado,
su fecha, la frecuencia y los meses en que suele pagar en los dos años antes de ``today``. Sirve
para proyectar en el navegador, siempre etiquetado como "último pagado".
"""

from __future__ import annotations

import datetime as _dt
from typing import Any

import pandas as pd

from kaizen_api.domain import safe
from kaizen_api.domain.currency import normalize_currency, scale_minor
from kaizen_api.provenance import utc_now
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

YAHOO_PERSONAL_USE = "Datos de Yahoo Finance obtenidos con yfinance, que según los términos de Yahoo es para uso personal."
"""Nota obligatoria de toda respuesta con datos de Yahoo (fase 5)."""

FUTURE_AMOUNT_NOTE = (
    "El monto del próximo dividendo no se conoce: el resumen trae el último pagado, con la fecha ex "
    "dividendo que registra Yahoo, y no es una promesa."
)

FREQUENCY_WINDOW_DAYS = 730
"""La frecuencia se lee en los dos años anteriores a ``today``."""


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


def _symbol_events(symbol: str, today: str, notes: list[str]) -> list[dict]:
    calendar = _yahoo.get_calendar(symbol)
    info = _yahoo.get_info(symbol)
    currency, divisor = normalize_currency(info.get("currency"))
    # El consenso de UPA de Yahoo viene en la moneda de COTIZACIÓN (peniques para Londres), así
    # que se lleva a la moneda mayor igual que el precio y se entrega con esa moneda.
    estimate = scale_minor(calendar.get("Earnings Average"), divisor) if isinstance(calendar, dict) else None
    low = scale_minor(calendar.get("Earnings Low"), divisor) if isinstance(calendar, dict) else None
    high = scale_minor(calendar.get("Earnings High"), divisor) if isinstance(calendar, dict) else None
    found: set[tuple[str, str]] = set()
    items: list[dict] = []

    def add(kind: str, raw: Any) -> None:
        date = _as_date(raw)
        if not date or (kind, date) in found:
            return
        found.add((kind, date))
        # El consenso de UPA es para el reporte que VIENE. Colgárselo a una fecha que ya pasó
        # haría creer que ese fue el resultado, y no lo es.
        upcoming = kind == "earnings" and date >= today and estimate is not None
        items.append({
            "symbol": symbol,
            "type": kind,
            "date": date,
            "estimate": round(estimate, 4) if upcoming else None,
            "amount": None,
            "currency": currency if kind in ("exDividend", "dividendPay") or upcoming else None,
            "estimateLow": round(low, 4) if upcoming and isinstance(low, (int, float)) else None,
            "estimateHigh": round(high, 4) if upcoming and isinstance(high, (int, float)) else None,
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
    today = utc_now().date().isoformat()
    notes: list[str] = []
    items: list[dict] = []
    missing: list[str] = []
    for symbol in symbols:
        found = _symbol_events(symbol.upper(), today, notes)
        if not found:
            missing.append(symbol.upper())
        items.extend(found)
    items.sort(key=lambda row: (row["date"], row["symbol"], row["type"]))
    if any(row["date"] < today for row in items):
        notes.append("Yahoo mezcla la última fecha ocurrida con la que viene; aquí salen las dos, en orden.")
    if missing:
        notes.append("Sin fechas publicadas para: " + ", ".join(missing) + ".")
    return {
        "items": items,
        # El calendario vale al momento de leerlo: poner la fecha del evento más lejano en asOf
        # diría que el dato es del futuro.
        "notes": list(dict.fromkeys(notes)),
        "as_of": today,
        "missing": missing,
    }


as_date = _as_date
"""Alias público para otros módulos de V5PF (``earnings_season``)."""


def classify_frequency(dates: list[_dt.date], today: _dt.date) -> tuple[str | None, list[int]]:
    """Frecuencia y meses de pago de las fechas de los dos años anteriores a ``today``.

    Ocho pagos en enero, abril, julio y octubre dan ``("trimestral", [1, 4, 7, 10])``. Sin pagos
    en la ventana, ``(None, [])``. Lo que no encaja en un patrón limpio es ``"irregular"``.
    """
    start = today - _dt.timedelta(days=FREQUENCY_WINDOW_DAYS)
    recent = [d for d in dates if start < d <= today]
    if not recent:
        return None, []
    months = sorted({d.month for d in recent})
    per_year = len(recent) / (FREQUENCY_WINDOW_DAYS / 365)
    if per_year >= 10 and len(months) >= 10:
        return "mensual", months
    if 3 <= per_year <= 4.5 and len(months) == 4:
        return "trimestral", months
    if 1.5 <= per_year <= 2.5 and len(months) == 2 and min(months[1] - months[0], 12 - months[1] + months[0]) >= 4:
        return "semestral", months
    if 0.5 <= per_year <= 1.25 and len(months) == 1:
        return "anual", months
    return "irregular", months


def summarize_dividends(symbol: str, series: Any, currency: str | None, divisor: float, today: _dt.date) -> dict:
    """Un renglón de ``dividendSummary`` a partir de la serie de Yahoo (índice = fecha)."""
    row = {"symbol": symbol, "currency": currency, "lastPaidAmount": None, "lastPaidDate": None, "frequency": None, "paidMonths": []}
    if not isinstance(series, pd.Series) or series.empty:
        return row
    points: list[tuple[_dt.date, float]] = []
    for stamp, value in series.items():
        amount = safe(value)
        date = _as_date(stamp)
        if amount is None or amount <= 0 or date is None:
            continue
        day = _dt.date.fromisoformat(date)
        if day <= today:
            points.append((day, amount))
    if not points:
        return row
    points.sort()
    last_day, last_amount = points[-1]
    frequency, months = classify_frequency([d for d, _ in points], today)
    amount = scale_minor(last_amount, divisor)
    row.update({
        "lastPaidAmount": round(amount, 6) if amount is not None else None,
        "lastPaidDate": last_day.isoformat(),
        "frequency": frequency,
        "paidMonths": months,
    })
    return row


def dividend_summary(symbols: list[str], today: _dt.date) -> list[dict]:
    """``dividendSummary`` de ``/v2/events``: uno por símbolo pedido, aunque no pague."""
    out = []
    for symbol in symbols:
        key = symbol.upper()
        currency, divisor = normalize_currency(_yahoo.get_info(key).get("currency"))
        out.append(summarize_dividends(key, _yahoo.get_dividends(key), currency, divisor, today))
    return out
