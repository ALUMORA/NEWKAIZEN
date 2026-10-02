"""Calendario económico de México y EE. UU. (stream V5EC, ``GET /v2/calendar/economic``).

Cuatro calendarios:

* Banxico 2026 (``data/calendar_banxico.json``): decisiones a las 13:00, minutas e informes,
  transcritos del PDF oficial. El de 2027 no está publicado: ``coverage.banxicoUntil`` lo dice y
  después de esa fecha no se inventa nada.
* Reserva Federal (``data/calendar_fomc.json``): reuniones 2026 y 2027 con la marca de proyecciones.
  La decisión se fecha el segundo día de la reunión, a las 14:00 hora del este.
* INEGI (``data/calendar_inegi.json``): IGAE, PIB, PIB oportuno, INPC quincenal y mensual y ENOE
  de 2026 y del primer semestre de 2027, a las 06:00 hora del centro.
* BLS por su ICS (``providers/bls.py``), en vivo con caché diaria.

Todas las horas se muestran en ``America/Mexico_City`` y ``datetimeUtc`` sale de convertir la hora
en la zona de su fuente, así que los cambios de horario de EE. UU. se respetan (el CPI de las 08:30
del este es 06:30 en octubre y 07:30 en noviembre). El consenso es siempre ``None``: las fuentes de
consenso son de pago.

**Ventana por omisión** (M5 la dejó abierta): sin fechas, del lunes de la semana de hoy a 13 días
después (dos semanas); con solo ``start``, de ``start`` a 13 días después; con solo ``end``, de 13
días antes a ``end``. El tope de 90 días lo valida el router.

Toda función que dependa de "hoy" lo recibe como parámetro (``today``).
"""

from __future__ import annotations

import datetime as _dt
import json
import re
from functools import cache
from pathlib import Path
from zoneinfo import ZoneInfo

from kaizen_api.errors import ApiError
from kaizen_api.providers import banxico, bls, fred

DATA = Path(__file__).resolve().parents[1] / "data"
MX_TZ = ZoneInfo("America/Mexico_City")
DEFAULT_WINDOW_DAYS = 13
MESES = ("enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre",
         "octubre", "noviembre", "diciembre")
MES_CORTO = ("ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic")
MONTHS_EN = {m: i + 1 for i, m in enumerate(
    ("january", "february", "march", "april", "may", "june", "july", "august", "september", "october",
     "november", "december"))}

BLS_RELEASES = (
    # (prefijo del SUMMARY del ICS, código, título, serie, transformación, unidad)
    ("consumer price index", "CPI", "Índice de precios al consumidor (CPI)", "CPIAUCSL", "yoy", "fraction"),
    ("employment situation", "EMPSIT", "Situación del empleo (nómina no agrícola)", "PAYEMS", "diff", "thousandsPersons"),
    ("producer price index", "PPI", "Índice de precios al productor (PPI)", None, None, None),
    ("job openings and labor turnover survey", "JOLTS", "Vacantes y rotación laboral (JOLTS)", None, None, None),
    ("employment cost index", "ECI", "Índice del costo del empleo (ECI)", None, None, None),
    ("real earnings", "EARN", "Salarios reales", None, None, None),
)
BLS_LAG_MONTHS = {"CPI": 1, "EMPSIT": 1, "PPI": 1, "EARN": 1, "JOLTS": 2}
"""El ICS del BLS no dice qué mes reporta cada publicación: se infiere del rezago fijo de cada una
(el CPI y el empleo publican el mes anterior; JOLTS, dos meses atrás). El ECI es trimestral y
reporta el trimestre que terminó antes del mes de publicación."""


def inferred_period(code: str, release: _dt.date) -> str | None:
    """Periodo que reporta una publicación del BLS según su rezago: CPI del 14 oct 2026 = sep 2026."""
    if code in BLS_LAG_MONTHS:
        total = release.year * 12 + release.month - 1 - BLS_LAG_MONTHS[code]
        return f"{MES_CORTO[total % 12]} {total // 12}"
    if code == "ECI":
        total = release.year * 12 + release.month - 2
        return f"{(total % 12) // 3 + 1}T {total // 12}"
    return None
SERIES_TRANSFORM = {"SF61745": "policy", "DFF": "policy", "SP30578": "pct", "CPIAUCSL": "yoy", "PAYEMS": "diff"}
BANXICO_SERIES = ("SF61745", "SP30578")
NOTE_OFF_CALENDAR = "Banxico se reserva el derecho de tomar decisiones fuera de las fechas programadas."
NOTE_CONSENSUS = "El consenso del mercado se muestra como s/d: las fuentes de consenso son de pago."


# ─── fechas ──────────────────────────────────────────────────────────────────


def fecha_larga(iso: str) -> str:
    """``2026-12-17`` a ``17 de diciembre de 2026`` (texto para notas visibles)."""
    d = _dt.date.fromisoformat(iso)
    return f"{d.day} de {MESES[d.month - 1]} de {d.year}"


def default_window(start: _dt.date | None, end: _dt.date | None, today: _dt.date) -> tuple[_dt.date, _dt.date]:
    """Ventana por omisión: dos semanas desde el lunes de hoy, o 13 días desde la fecha que llegó."""
    if start and end:
        return start, end
    if start:
        return start, start + _dt.timedelta(days=DEFAULT_WINDOW_DAYS)
    if end:
        return end - _dt.timedelta(days=DEFAULT_WINDOW_DAYS), end
    monday = today - _dt.timedelta(days=today.weekday())
    return monday, monday + _dt.timedelta(days=DEFAULT_WINDOW_DAYS)


def localize(date: str, time: str | None, tz: str) -> tuple[str, str | None, str | None]:
    """Fecha y hora en la zona de la fuente a ``(fecha, HH:MM, instante UTC)`` en hora del centro."""
    if not time:
        return date, None, None
    hh, mm = (int(x) for x in time.split(":"))
    local = _dt.datetime.combine(_dt.date.fromisoformat(date), _dt.time(hh, mm), tzinfo=ZoneInfo(tz))
    mx = local.astimezone(MX_TZ)
    utc = local.astimezone(_dt.UTC)
    return mx.date().isoformat(), mx.strftime("%H:%M"), utc.strftime("%Y-%m-%dT%H:%M:%SZ")


def bls_period(summary: str) -> str | None:
    """``... for September 2026`` a ``sep 2026``; ``... for 3rd Quarter 2026`` a ``3T 2026``."""
    text = summary.lower()
    m = re.search(r"for ([a-z]+) (\d{4})", text)
    if m and m.group(1) in MONTHS_EN:
        return f"{MES_CORTO[MONTHS_EN[m.group(1)] - 1]} {m.group(2)}"
    m = re.search(r"(\d)(?:st|nd|rd|th) quarter (\d{4})", text)
    if m:
        return f"{m.group(1)}T {m.group(2)}"
    words = {"first": 1, "second": 2, "third": 3, "fourth": 4}
    m = re.search(r"(first|second|third|fourth) quarter (\d{4})", text)
    if m:
        return f"{words[m.group(1)]}T {m.group(2)}"
    return None


def period_month(period: str | None) -> str | None:
    """``sep 2026`` a ``2026-09-01`` (fecha con la que FRED y el SIE fechan el mes)."""
    if not period:
        return None
    parts = period.split()
    if len(parts) != 2 or parts[0] not in MES_CORTO:
        return None
    return f"{int(parts[1]):04d}-{MES_CORTO.index(parts[0]) + 1:02d}-01"


def _shift_month(iso: str, months: int) -> str:
    d = _dt.date.fromisoformat(iso)
    total = d.year * 12 + d.month - 1 + months
    return f"{total // 12:04d}-{total % 12 + 1:02d}-01"


# ─── dato anterior y publicado ───────────────────────────────────────────────


def release_values(transform: str, series: dict, period: str | None, date: str, today: _dt.date) -> tuple[float | None, float | None]:
    """``(previous, actual)`` de una publicación con la serie ``{dates, values}`` de su fuente.

    * ``yoy``: variación anual de un índice (110 contra 100 doce meses antes = 0.10).
    * ``pct``: la fuente publica por ciento (SP30578 ``3.76`` = 0.0376) y no se recalcula.
    * ``diff``: cambio mensual de un nivel (PAYEMS 159075 contra 158953 = +122 miles).
    * ``policy``: tasa de política; anterior = último dato antes de la fecha y publicado = primer
      dato después de ella.

    ``actual`` solo existe si la fecha de publicación ya pasó (``date <= today``).
    """
    by_date = dict(zip(series.get("dates") or [], series.get("values") or [], strict=False))
    published = _dt.date.fromisoformat(date) <= today
    if transform == "policy":
        before = [v for d, v in by_date.items() if d < date]
        after = [v for d, v in sorted(by_date.items()) if d > date]
        prev = round(before[-1] / 100, 6) if before else None
        act = round(after[0] / 100, 6) if (after and published) else None
        return prev, act
    month = period_month(period)
    if month is None:
        return None, None

    def value(m: str) -> float | None:
        if transform == "pct":
            v = by_date.get(m)
            return round(v / 100, 6) if v is not None else None
        if transform == "yoy":
            cur, base = by_date.get(m), by_date.get(_shift_month(m, -12))
            return round(cur / base - 1, 6) if cur is not None and base else None
        if transform == "diff":
            cur, base = by_date.get(m), by_date.get(_shift_month(m, -1))
            return round(cur - base, 3) if cur is not None and base is not None else None
        return None

    return value(_shift_month(month, -1)), (value(month) if published else None)


# ─── calendarios curados ─────────────────────────────────────────────────────


@cache
def curated(name: str) -> dict:
    """``banxico``, ``fomc`` o ``inegi``: el JSON transcrito de la fuente oficial."""
    with open(DATA / f"calendar_{name}.json", encoding="utf-8") as fh:
        return json.load(fh)


def _event(country: str, source_key: str, raw: dict, tz: str, source: str = "curated") -> dict:
    date, time_local, dt_utc = localize(raw["date"], raw.get("time"), tz)
    code = raw.get("code") or raw["kind"]
    return {
        "id": f"{source_key}-{code}-{raw['date']}".lower(),
        "country": country,
        "kind": raw["kind"],
        "title": raw["title"] + (" con proyecciones" if raw.get("projections") else ""),
        "period": raw.get("period"),
        "date": date,
        "timeLocal": time_local,
        "datetimeUtc": dt_utc,
        "source": source,
        "seriesId": raw.get("seriesId"),
        "unit": raw.get("unit"),
        "previous": None,
        "actual": None,
        "consensus": None,
    }


def curated_events(countries: list[str]) -> list[dict]:
    out: list[dict] = []
    if "mx" in countries:
        for raw in curated("banxico")["events"]:
            out.append(_event("MX", "banxico", raw, curated("banxico")["timeZone"]))
        for raw in curated("inegi")["events"]:
            out.append(_event("MX", "inegi", raw, curated("inegi")["timeZone"]))
    if "us" in countries:
        for raw in curated("fomc")["events"]:
            out.append(_event("US", "fomc", raw, curated("fomc")["timeZone"]))
    return out


def bls_events(raw_events: list[dict]) -> list[dict]:
    """Del ICS solo las publicaciones del tablero (CPI, empleo, PPI, JOLTS, ECI, salarios reales)."""
    out: list[dict] = []
    for ev in raw_events:
        summary = str(ev.get("summary") or "")
        low = summary.lower()
        for prefix, code, title, sid, _transform, unit in BLS_RELEASES:
            if low.startswith(prefix):
                start: _dt.datetime = ev["start"]
                eastern = start.astimezone(bls.EASTERN)
                raw = {
                    "kind": "release",
                    "code": code,
                    "title": title,
                    "period": bls_period(summary) or inferred_period(code, eastern.date()),
                    "date": eastern.date().isoformat(),
                    "time": eastern.strftime("%H:%M"),
                    "seriesId": sid,
                    "unit": unit,
                }
                out.append(_event("US", "bls", raw, "America/New_York", source="bls"))
                break
    return out


def next_decisions(today: _dt.date) -> dict:
    """Próxima decisión de Banxico y de la Fed desde ``today`` (incluido), con los días que faltan."""
    out: dict = {}
    for key, name in (("banxico", "banxico"), ("fed", "fomc")):
        cal = curated(name)
        found = None
        for raw in cal["events"]:
            if raw["kind"] != "decision":
                continue
            date, _, _ = localize(raw["date"], raw.get("time"), cal["timeZone"])
            if date >= today.isoformat():
                found = {"date": date, "daysLeft": (_dt.date.fromisoformat(date) - today).days}
                break
        out[key] = found
    return out


def coverage(bls_until: str | None) -> dict:
    return {
        "banxicoUntil": curated("banxico").get("coverageUntil"),
        "fomcUntil": curated("fomc").get("coverageUntil"),
        "inegiUntil": curated("inegi").get("coverageUntil"),
        "blsUntil": bls_until,
    }


def coverage_notes(cov: dict, first: _dt.date, last: _dt.date, countries: list[str]) -> list[str]:
    """Avisos de la UI cuando la ventana pasa de lo que cubre algún calendario."""
    labels = (
        ("mx", "banxicoUntil", "El calendario de Banxico"),
        ("mx", "inegiUntil", "El calendario de INEGI"),
        ("us", "fomcUntil", "El calendario de la Reserva Federal"),
        ("us", "blsUntil", "El calendario del BLS"),
    )
    notes: list[str] = []
    for country, key, label in labels:
        if country not in countries:
            continue
        until = cov.get(key)
        if until is None:
            notes.append(f"{label} no está disponible por ahora.")
        elif last.isoformat() > until:
            notes.append(f"{label} publicado cubre hasta el {fecha_larga(until)}; después no se muestra ningún evento.")
    return notes


# ─── armado ──────────────────────────────────────────────────────────────────


def fill_values(events: list[dict], series: dict[str, dict], today: _dt.date) -> None:
    for ev in events:
        sid = ev.get("seriesId")
        if not sid or sid not in series:
            continue
        transform = SERIES_TRANSFORM.get(sid)
        if transform:
            ev["previous"], ev["actual"] = release_values(transform, series[sid], ev["period"], ev["date"], today)


def _banxico_series(today: _dt.date, ids: set[str], notes: list[str]) -> dict[str, dict]:
    if not ids:
        return {}
    if not banxico.configured():
        notes.append("Falta el token de Banxico en el servidor: la tasa objetivo y la inflación de México salen s/d.")
        return {}
    try:
        reasons = banxico.verification(list(banxico.catalog()))
    except ApiError:
        notes.append("Banxico no respondió: el dato anterior y el publicado de México salen s/d.")
        return {}
    start = _years_back(today, 10).isoformat()
    out: dict[str, dict] = {}
    for sid in sorted(ids):
        if reasons.get(sid) or not banxico.reviewed(sid):
            notes.append(f"La serie {sid} del SIE no pasó la verificación: sale s/d.")
            continue
        try:
            got = banxico.fetch_series([sid], start, today.isoformat())
        except ApiError:
            notes.append("Banxico no respondió: el dato anterior y el publicado de México salen s/d.")
            return out
        if sid in got:
            out[sid] = got[sid]
    return out


def _years_back(today: _dt.date, years: int) -> _dt.date:
    try:
        return today.replace(year=today.year - years)
    except ValueError:  # 29 de febrero
        return today.replace(year=today.year - years, day=28)


def build_calendar(start: _dt.date | None, end: _dt.date | None, countries: list[str], today: _dt.date) -> dict:
    """Eventos de la ventana con dato anterior y publicado, cobertura y próximas decisiones."""
    first, last = default_window(start, end, today)
    notes: list[str] = []
    sources = ["curated"]
    events = curated_events(countries)
    bls_until = None
    if "us" in countries:
        raw = bls.releases()
        if raw:
            sources.append("bls")
            bls_until = max(ev["start"].astimezone(bls.EASTERN).date() for ev in raw).isoformat()
            events.extend(bls_events(raw))
            notes.append("El mes que reporta cada publicación del BLS se deduce de su rezago habitual.")
        else:
            notes.append("El calendario del BLS no respondió: faltan las publicaciones de empleo y precios de EE. UU.")
    lo, hi = first.isoformat(), last.isoformat()
    events = [ev for ev in events if lo <= ev["date"] <= hi]
    events.sort(key=lambda e: (e["date"], e["timeLocal"] or "99:99", e["country"], e["id"]))

    wanted = {ev["seriesId"] for ev in events if ev.get("seriesId")}
    series = _banxico_series(today, wanted & set(BANXICO_SERIES), notes)
    if series:
        sources.append("banxico")
    fred_ids = sorted(wanted - set(BANXICO_SERIES))
    for sid in fred_ids:
        got = fred.fetch_series(sid)
        if got["dates"]:
            series[sid] = got
    if fred_ids:
        sources.append("fred")
    fill_values(events, series, today)

    cov = coverage(bls_until)
    notes.extend(coverage_notes(cov, first, last, countries))
    if "mx" in countries:
        notes.append(NOTE_OFF_CALENDAR)
        notes.append("Los indicadores de INEGI (IGAE, PIB, ENOE e inflación quincenal) salen s/d en el dato: requieren un token gratuito de INEGI que no está configurado.")
    notes.append(NOTE_CONSENSUS)
    return {
        "events": events,
        "coverage": cov,
        "nextDecisions": next_decisions(today),
        "source": ",".join(dict.fromkeys(sources)),
        "asOf": today.isoformat(),
        "notes": notes,
        "window": (lo, hi),
    }
