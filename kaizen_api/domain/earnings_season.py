"""Temporada de reportes: próximos reportes de una muestra curada de México (23) o EE. UU. (38).

Sale de ``Ticker.calendar`` por símbolo (la misma lectura que ``/v2/events``), con una caché propia
de 12 horas por símbolo para que cambiar de pestaña o de ventana no vuelva a pedirle 38 llamadas a
Yahoo. Una emisora que no respondió sale en ``missing`` con su motivo y las demás se publican en
orden de fecha. El universo es una muestra curada, no el mercado entero, y la respuesta lo dice.

Toda fecha se compara contra ``today`` (parámetro): el reloj del replay es el del set base.
"""

from __future__ import annotations

import datetime as _dt
import json
from pathlib import Path
from typing import Any

from kaizen_api.cache import _cached
from kaizen_api.domain.currency import normalize_currency, scale_minor
from kaizen_api.domain.events import YAHOO_PERSONAL_USE, as_date
from kaizen_api.providers.yahoo import fundamentals as _yahoo

DATA = Path(__file__).resolve().parent.parent / "data"

SEASON_TTL = 12 * 3600
"""Caché del calendario por símbolo para la temporada (12 horas)."""

UNIVERSE_LABEL = {"mx": "de la BMV", "us": "de Estados Unidos"}

NO_CALENDAR = "Yahoo no publicó calendario para esta emisora"
NO_EARNINGS_DATE = "Yahoo no publicó fecha de reporte"
PROVIDER_ERROR = "Yahoo no respondió"


def load_universe(universe: str) -> dict:
    return json.loads((DATA / f"universe_{universe}.json").read_text(encoding="utf-8"))


def _season_calendar(symbol: str) -> dict | None:
    """Calendario de Yahoo con caché de 12 h; ``None`` si el proveedor falló."""

    def fetch() -> dict | None:
        try:
            data = _yahoo.get_calendar(symbol)
        except Exception:
            return None
        return data if isinstance(data, dict) else {}

    return _cached(f"v5pf:season:{symbol.upper()}", fetch, ttl=SEASON_TTL, ok=lambda d: bool(d))


def _round(value: Any) -> float | None:
    return round(value, 4) if isinstance(value, (int, float)) else None


def symbol_events(symbol: str, name: str | None, currency: str | None, calendar: dict, today: str, until: str) -> list[dict]:
    """Reportes de un símbolo dentro de ``[today, until]`` con el consenso de UPA y su rango."""
    code, divisor = normalize_currency(currency)
    raw = calendar.get("Earnings Date")
    dates = raw if isinstance(raw, (list, tuple, set)) else [raw]
    found = sorted({d for d in (as_date(v) for v in dates) if d and today <= d <= until})
    rows = []
    for date in found:
        rows.append({
            "symbol": symbol,
            "name": name,
            "date": date,
            "kind": "earnings",
            "estimateAvg": _round(scale_minor(calendar.get("Earnings Average"), divisor)),
            "estimateLow": _round(scale_minor(calendar.get("Earnings Low"), divisor)),
            "estimateHigh": _round(scale_minor(calendar.get("Earnings High"), divisor)),
            "currency": code,
        })
    return rows


def get_season(universe: str, days: int, today: _dt.date) -> dict:
    """``{"universe", "events", "missing", "universeSize", "notes", "as_of"}`` sin ``meta``."""
    data = load_universe(universe)
    members = data["members"]
    start = today.isoformat()
    until = (today + _dt.timedelta(days=days)).isoformat()
    events: list[dict] = []
    missing: list[dict] = []
    for member in members:
        symbol = member["symbol"].upper()
        calendar = _season_calendar(symbol)
        if calendar is None:
            missing.append({"symbol": symbol, "reason": PROVIDER_ERROR})
            continue
        if not calendar:
            missing.append({"symbol": symbol, "reason": NO_CALENDAR})
            continue
        if not calendar.get("Earnings Date"):
            missing.append({"symbol": symbol, "reason": NO_EARNINGS_DATE})
            continue
        events.extend(symbol_events(symbol, member.get("name"), data.get("currency"), calendar, start, until))
    events.sort(key=lambda row: (row["date"], row["symbol"]))
    notes = [
        f"Muestra curada de {len(members)} emisoras {UNIVERSE_LABEL[universe]}, no el mercado entero.",
        "El estimado es el consenso de utilidad por acción que publica Yahoo; en la BMV suele salir de 2 a 4 analistas.",
        YAHOO_PERSONAL_USE,
    ]
    if missing:
        notes.append(f"{len(missing)} de {len(members)} emisoras sin fecha de reporte en Yahoo.")
    return {
        "universe": universe,
        "events": events,
        "missing": missing,
        "universeSize": len(members),
        "notes": notes,
        "as_of": start,
    }
