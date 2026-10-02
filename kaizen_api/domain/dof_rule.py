"""Qué FIX aplica a una fecha: por fecha o con la regla del DOF (art. 20 del CFF). Stream V5FX.

Funciones puras: reciben el FIX ya leído (``{fecha de determinación: valor}``) y ``today``.

**Fechas futuras.** Con cualquiera de las dos reglas, una fecha posterior a ``today`` sale sin FIX
(``fix_date`` y ``value`` en ``None``) y la explicación lo dice, como pide ``docs/api-v2.md``.

**Días hábiles bancarios.** Son las fechas que traen FIX publicado en la serie SF43718 del SIE, no
el calendario de la BMV. Los sábados y domingos nunca son hábiles. Un día entre semana posterior al
último FIX conocido es **desconocido**: todavía no se sabe si fue hábil, y por eso una fecha que
dependa de él responde que aún no hay FIX en vez de adivinar.

**rule = fecha.** El FIX determinado ese mismo día. Si el día no fue hábil, el último determinado
antes (el criterio de siempre para un fin de semana o un feriado bancario).

**rule = dof.** Art. 20 del CFF: el tipo de cambio publicado en el DOF el día anterior a la fecha;
si ese día no hubo publicación, el último publicado antes. El DOF publica el FIX en día hábil
bancario y esa publicación trae el FIX determinado el día hábil anterior. O sea: la publicación
usada es el último día hábil antes de la fecha, y el FIX es el del día hábil antes de esa
publicación. Ejemplos (decisión 1 del orquestador): el miércoles 30/09/2026 usa el DOF del 29/09,
que trae el FIX del 28/09; el lunes 05/10/2026 usa el DOF del viernes 02/10, que trae el FIX del
01/10. La pantalla explica la regla y no la recomienda: anunciarla es decisión fiscal del dueño.
"""

from __future__ import annotations

import datetime as _dt
from dataclasses import dataclass

RULES = ("fecha", "dof")

_MONTHS = (
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
_WEEKDAYS = ("lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo")


@dataclass(frozen=True)
class FixResolution:
    """El FIX que aplica a ``date`` según ``rule``. ``fix_date`` y ``value`` son ``None`` si aún no hay."""

    date: str
    rule: str
    fix_date: str | None
    value: float | None
    dof_publication_date: str | None
    explanation: str


def human_date(day: _dt.date | str) -> str:
    """``2026-10-05`` a ``lunes 5 de octubre de 2026``."""
    d = _dt.date.fromisoformat(day) if isinstance(day, str) else day
    return f"{_WEEKDAYS[d.weekday()]} {d.day} de {_MONTHS[d.month - 1]} de {d.year}"


class BankingDays:
    """Días hábiles bancarios inferidos de las fechas con FIX."""

    def __init__(self, fixes: dict[str, float]):
        self.fixes = {k: v for k, v in fixes.items() if v is not None}
        self.dates = sorted(self.fixes)
        self.first = _dt.date.fromisoformat(self.dates[0]) if self.dates else None
        self.last = _dt.date.fromisoformat(self.dates[-1]) if self.dates else None

    def status(self, day: _dt.date) -> bool | None:
        """``True`` hábil, ``False`` inhábil, ``None`` desconocido (después del último FIX)."""
        if day.weekday() >= 5:
            return False
        if self.last is None or day > self.last:
            return None
        return day.isoformat() in self.fixes

    def previous(self, day: _dt.date, *, inclusive: bool) -> _dt.date | None:
        """Último día hábil antes de ``day`` (o igual si ``inclusive``); ``None`` si hay un día desconocido en medio."""
        cursor = day if inclusive else day - _dt.timedelta(days=1)
        while self.first is not None and cursor >= self.first:
            state = self.status(cursor)
            if state is None:
                return None
            if state:
                return cursor
            cursor -= _dt.timedelta(days=1)
        return None


def resolve(fixes: dict[str, float], date: _dt.date, rule: str, today: _dt.date) -> FixResolution:
    """El FIX que aplica a ``date`` con ``rule`` (``fecha`` o ``dof``), sabiendo lo publicado hasta ``today``."""
    if rule not in RULES:
        raise ValueError(f"regla desconocida: {rule}")
    days = BankingDays(fixes)
    iso = date.isoformat()
    if rule == "fecha":
        return _by_date(days, date, iso, today)
    return _by_dof(days, date, iso, today)


def _pending(iso: str, rule: str, text: str, publication: str | None = None) -> FixResolution:
    return FixResolution(iso, rule, None, None, publication, text)


def _by_date(days: BankingDays, date: _dt.date, iso: str, today: _dt.date) -> FixResolution:
    if date > today:
        return _pending(iso, "fecha", f"El {human_date(date)} todavía no llega, así que aún no hay FIX para esa fecha.")
    used = days.previous(date, inclusive=True)
    if used is None:
        return _pending(
            iso,
            "fecha",
            f"Aún no hay FIX publicado para el {human_date(date)}: Banxico lo determina alrededor de las "
            "12:00 de cada día hábil bancario.",
        )
    value = days.fixes[used.isoformat()]
    if used == date:
        text = f"Se usa el FIX determinado por Banxico el mismo {human_date(date)}."
    else:
        text = (
            f"El {human_date(date)} no fue día hábil bancario (no hubo FIX), así que se usa el último FIX "
            f"determinado antes: el del {human_date(used)}."
        )
    return FixResolution(iso, "fecha", used.isoformat(), value, None, text)


def _by_dof(days: BankingDays, date: _dt.date, iso: str, today: _dt.date) -> FixResolution:
    if date > today:
        return _pending(iso, "dof", f"El {human_date(date)} todavía no llega, así que aún no hay FIX para esa fecha.")
    publication = days.previous(date, inclusive=False)
    if publication is None:
        return _pending(
            iso,
            "dof",
            f"Aún no hay FIX para el {human_date(date)} con la regla del DOF: depende de días que Banxico "
            "todavía no confirma como hábiles, así que no se sabe qué publicación del DOF le corresponde.",
        )
    fix_day = days.previous(publication, inclusive=False)
    if fix_day is None:
        return _pending(
            iso,
            "dof",
            f"Aún no hay FIX para el {human_date(date)}: no hay un FIX determinado antes de la publicación del "
            f"DOF del {human_date(publication)}.",
            publication.isoformat(),
        )
    value = days.fixes[fix_day.isoformat()]
    day_before = date - _dt.timedelta(days=1)
    if publication == day_before:
        where = f"el tipo publicado en el DOF el día anterior, el {human_date(publication)}"
    else:
        where = (
            f"el día anterior ({human_date(day_before)}) no hubo publicación, así que se toma la última "
            f"publicada antes: la del DOF del {human_date(publication)}"
        )
    text = (
        f"Con la regla del DOF (art. 20 del CFF), para el {human_date(date)} se usa {where}, que trae el FIX "
        f"determinado el {human_date(fix_day)}."
    )
    return FixResolution(iso, "dof", fix_day.isoformat(), value, publication.isoformat(), text)
