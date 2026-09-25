"""Calendario de BMV y NYSE para ``marketStatus`` de ``/v2/markets/overview`` (stream B2a).

Contrato por bolsa: ``{"open": bool, "label": str, "nextOpen": instante|null, "nextClose": instante|null}``.
Los días inhábiles y las jornadas recortadas viven en ``kaizen_api/data/holidays_bmv.json`` y
``kaizen_api/data/holidays_nyse.json``; aquí solo se resuelven contra el reloj.

Tres decisiones que valen la pena escribir:

* **Las horas se resuelven con la zona de cada bolsa**, no con un desfase fijo. Nueva York cambia
  con el horario de verano y la Ciudad de México ya no, así que restar horas a mano daría una hora
  mal la mitad del año.
* **``nextOpen`` y ``nextClose`` son siempre el siguiente de cada uno**, esté abierta o cerrada la
  bolsa. Con la bolsa abierta, ``nextClose`` es el cierre de hoy y ``nextOpen`` el de la siguiente
  jornada; con la bolsa cerrada, los dos son de la siguiente jornada.
* **Fuera de los años que trae el archivo no se adivina.** Si el calendario no cubre la fecha, el
  estado sale igual pero con un aviso en ``notes``, porque un feriado que falta se ve idéntico a un
  día hábil y eso hay que decirlo.
"""

from __future__ import annotations

import datetime as _dt
import json
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from zoneinfo import ZoneInfo

from kaizen_api.provenance import iso_instant

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

EXCHANGES = ("bmv", "nyse")
"""Bolsas con calendario propio. Los ids son los de ``schemas.MarketStatus``."""

TZ_LABEL = {"America/Mexico_City": "la Ciudad de México", "America/New_York": "Nueva York"}

WEEKDAYS_ES = ("lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo")
MONTHS_ES = (
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
)

SEARCH_DAYS = 30
"""Días hacia adelante que se buscan antes de rendirse buscando la siguiente jornada."""


@dataclass(frozen=True)
class ExchangeStatus:
    """Estado de una bolsa, con los mismos nombres de campo que ``schemas.ExchangeStatus``."""

    open: bool
    label: str
    next_open: str | None
    next_close: str | None
    notes: list[str] = field(default_factory=list)

    def as_contract(self) -> dict:
        return {"open": self.open, "label": self.label, "nextOpen": self.next_open, "nextClose": self.next_close}


@lru_cache(maxsize=len(EXCHANGES))
def load_calendar(exchange: str) -> dict:
    """Calendario de una bolsa desde ``kaizen_api/data/holidays_<bolsa>.json``."""
    key = exchange.lower()
    if key not in EXCHANGES:
        raise ValueError(f"Bolsa sin calendario: {exchange!r}")
    with (DATA_DIR / f"holidays_{key}.json").open(encoding="utf-8") as handle:
        return json.load(handle)


def _hhmm(text: str) -> _dt.time:
    hour, minute = text.split(":")
    return _dt.time(int(hour), int(minute))


def _pretty_time(moment: _dt.datetime) -> str:
    return f"{moment.hour}:{moment.minute:02d}"


def session(calendar: dict, day: _dt.date) -> tuple[_dt.time, _dt.time] | None:
    """``(apertura, cierre)`` de una fecha, o ``None`` si esa bolsa no opera ese día."""
    if (day.weekday() + 1) not in calendar["tradingDays"]:
        return None
    iso = day.isoformat()
    if iso in calendar["holidays"]:
        return None
    hours = calendar["regularHours"]
    close = calendar.get("earlyCloses", {}).get(iso)
    close_text = close["close"] if isinstance(close, dict) else (close or hours["close"])
    return _hhmm(hours["open"]), _hhmm(close_text)


def holiday_name(calendar: dict, day: _dt.date) -> str | None:
    return calendar["holidays"].get(day.isoformat())


def _localize(tz: ZoneInfo, day: _dt.date, clock: _dt.time) -> _dt.datetime:
    return _dt.datetime.combine(day, clock, tzinfo=tz)


def _next_session(calendar: dict, tz: ZoneInfo, after: _dt.datetime) -> tuple[_dt.datetime, _dt.datetime] | None:
    """Primera jornada cuyo cierre es posterior a ``after``, mirando hasta ``SEARCH_DAYS`` adelante."""
    day = after.date()
    for offset in range(SEARCH_DAYS + 1):
        current = day + _dt.timedelta(days=offset)
        hours = session(calendar, current)
        if hours is None:
            continue
        opens = _localize(tz, current, hours[0])
        closes = _localize(tz, current, hours[1])
        if closes > after:
            return opens, closes
    return None


def last_completed_session(exchange: str, now: _dt.datetime | None = None) -> _dt.date | None:
    """Última jornada de esa bolsa que YA cerró, mirando hasta ``SEARCH_DAYS`` hacia atrás.

    Sirve para decidir si una serie diaria viene atrasada: si su punto más nuevo es anterior a esta
    fecha, al proveedor le falta al menos una jornada que ya terminó. La jornada de hoy no cuenta
    mientras el mercado siga abierto, porque su barra todavía se está formando.
    """
    calendar = load_calendar(exchange)
    tz = ZoneInfo(calendar["timezone"])
    moment = (now or _dt.datetime.now(_dt.UTC)).astimezone(tz)
    for offset in range(SEARCH_DAYS + 1):
        current = moment.date() - _dt.timedelta(days=offset)
        hours = session(calendar, current)
        if hours is None:
            continue
        if _localize(tz, current, hours[1]) <= moment:
            return current
    return None


def status(exchange: str, now: _dt.datetime | None = None) -> ExchangeStatus:
    """Estado de una bolsa en este instante (o en ``now``, que sirve para las pruebas)."""
    calendar = load_calendar(exchange)
    tz = ZoneInfo(calendar["timezone"])
    moment = (now or _dt.datetime.now(_dt.UTC)).astimezone(tz)
    notes: list[str] = []

    years = set(calendar["years"])
    horizon = (moment + _dt.timedelta(days=SEARCH_DAYS)).year
    missing = sorted({moment.year, horizon} - years)
    if missing:
        notes.append(
            f"El calendario de {calendar['label']} cubre de {min(years)} a {max(years)}; "
            f"para {', '.join(str(y) for y in missing)} se asume el horario normal sin días inhábiles."
        )

    upcoming = _next_session(calendar, tz, moment)
    if upcoming is None:
        return ExchangeStatus(False, f"{calendar['label']} cerrada, sin jornada programada.", None, None, notes)

    opens, closes = upcoming
    is_open = opens <= moment < closes
    where = TZ_LABEL.get(calendar["timezone"], calendar["timezone"])

    if is_open:
        following = _next_session(calendar, tz, closes)
        next_open = iso_instant(following[0]) if following else None
        label = f"Abierto. Cierra hoy a las {_pretty_time(closes)} h de {where}."
        return ExchangeStatus(True, label, next_open, iso_instant(closes), notes)

    reason = ""
    today_holiday = holiday_name(calendar, moment.date())
    if today_holiday:
        reason = f" por {today_holiday}"
    label = f"Cerrado{reason}. Abre {_when(moment, opens)} a las {_pretty_time(opens)} h de {where}."
    return ExchangeStatus(False, label, iso_instant(opens), iso_instant(closes), notes)


def _when(now: _dt.datetime, opens: _dt.datetime) -> str:
    """"hoy", "mañana" o "el lunes 28 de septiembre", según qué tan lejos queda la apertura."""
    days = (opens.date() - now.date()).days
    if days == 0:
        return "hoy"
    if days == 1:
        return "mañana"
    return f"el {WEEKDAYS_ES[opens.weekday()]} {opens.day} de {MONTHS_ES[opens.month - 1]}"


def market_status(now: _dt.datetime | None = None) -> tuple[dict, list[str]]:
    """``marketStatus`` del contrato para BMV y NYSE, más los avisos que haya que publicar."""
    notes: list[str] = []
    payload = {}
    for exchange in EXCHANGES:
        state = status(exchange, now)
        payload[exchange] = state.as_contract()
        # ``lastClose``: fecha (en la zona de la bolsa) de la última jornada que ya cerró. Sale del
        # calendario, no de los datos del grupo, así que no depende de que Yahoo haya contestado.
        closed = last_completed_session(exchange, now)
        payload[exchange]["lastClose"] = closed.isoformat() if closed else None
        for note in state.notes:
            if note not in notes:
                notes.append(note)
    return payload, notes
