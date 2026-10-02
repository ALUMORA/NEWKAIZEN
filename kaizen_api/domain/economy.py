"""Tablero de economía de México y EE. UU. y comparador de países (stream V5EC).

``/v2/macro/indicators`` arma cada indicador de ``data/macro_catalog.json`` con la serie de su
fuente (SIE de Banxico o FRED sin llave) y la lleva a la unidad del contrato según ``transform``:

* ``yoy``: variación anual de un índice, calculada aquí (CPIAUCSL 110 contra 100 = 0.10).
* ``pct``: la fuente ya publica por ciento; se divide entre 100 y NO se recalcula (SP30578 ``3.76``
  es 0.0376; A191RL1Q225SBEA ``2.2`` es 0.022 y no se vuelve a anualizar).
* ``level``: nivel tal cual (remesas, reserva, nómina, PIB real, WTI).
* ``annualizedQoq``: crecimiento trimestral anualizado de un nivel, ``(v / v_ant)^4 - 1``.

``kind`` rate cambia en pb (``changeYoYBp``) y level en fracción (``changeYoY``). Los espejos de la
OCDE en FRED se marcan como tales y, si su último dato tiene más de 18 meses, se rechazan: salen con
``stale`` y sin dato. Banxico sin token sale s/d con su aviso, nunca con un valor fijo.

``/v2/macro/world`` toma del Banco Mundial (CC BY 4.0) el último año con dato de cada indicador para
los países pedidos; un país sin dato ese año sale con ``value`` en ``None`` (la UI dice s/d).

Toda función que dependa de "hoy" recibe ``today``.
"""

from __future__ import annotations

import datetime as _dt
import json
from functools import lru_cache
from pathlib import Path

from kaizen_api.domain.econ_calendar import _years_back, bls_events, curated, curated_events
from kaizen_api.errors import ApiError
from kaizen_api.providers import banxico, bls, fred, worldbank

DATA = Path(__file__).resolve().parents[1] / "data"
MAX_AGE_DAYS = {"monthly": 100, "quarterly": 200, "weekly": 21, "daily": 10}
"""Edad del último dato a partir de la cual se marca ``stale`` (se sigue mostrando)."""


@lru_cache(maxsize=1)
def catalog() -> dict:
    with open(DATA / "macro_catalog.json", encoding="utf-8") as fh:
        return json.load(fh)


# ─── transformaciones ────────────────────────────────────────────────────────


def _shift_months(iso: str, months: int) -> str:
    d = _dt.date.fromisoformat(iso)
    total = d.year * 12 + d.month - 1 + months
    return f"{total // 12:04d}-{total % 12 + 1:02d}-{d.day:02d}"


def yoy_series(dates: list[str], values: list[float]) -> tuple[list[str], list[float]]:
    """Variación anual de un índice mensual: cada mes contra el mismo mes del año anterior."""
    by = dict(zip(dates, values, strict=True))
    out_d, out_v = [], []
    for d, v in zip(dates, values, strict=True):
        base = by.get(_shift_months(d, -12))
        if base:
            out_d.append(d)
            out_v.append(round(v / base - 1, 6))
    return out_d, out_v


def annualized_qoq(current: float, previous: float) -> float:
    """Crecimiento trimestral anualizado: 101 contra 100 = 1.01^4 - 1 = 0.040604."""
    return round((current / previous) ** 4 - 1, 6)


def transform(kind: str, dates: list[str], values: list[float]) -> tuple[list[str], list[float]]:
    if kind == "pct":
        return list(dates), [round(v / 100, 6) for v in values]
    if kind == "yoy":
        return yoy_series(dates, values)
    if kind == "annualizedQoq":
        out_d, out_v = [], []
        for i in range(1, len(values)):
            if values[i - 1]:
                out_d.append(dates[i])
                out_v.append(annualized_qoq(values[i], values[i - 1]))
        return out_d, out_v
    return list(dates), list(values)


def year_ago_value(dates: list[str], values: list[float], frequency: str) -> float | None:
    """Valor de hace un año del último dato: el mismo mes o trimestre, o el más cercano (semanal y diario)."""
    if not dates:
        return None
    last = dates[-1]
    if frequency in ("monthly", "quarterly"):
        return dict(zip(dates, values, strict=True)).get(_shift_months(last, -12))
    target = _dt.date.fromisoformat(last) - _dt.timedelta(days=365)
    best = None
    for d, v in zip(dates, values, strict=True):
        dd = _dt.date.fromisoformat(d)
        if dd <= target and (target - dd).days <= 10:
            best = v
    return best


def change_yoy(kind: str, dates: list[str], values: list[float], frequency: str) -> tuple[float | None, float | None]:
    """``(changeYoY, changeYoYBp)``: nivel en fracción, tasa en pb (0.041 a 0.045 = +40 pb)."""
    base = year_ago_value(dates, values, frequency)
    if base is None or not values:
        return None, None
    if kind == "rate":
        return None, round((values[-1] - base) * 10000, 2)
    return (round(values[-1] / base - 1, 6) if base else None), None


def oecd_too_old(last_date: str | None, today: _dt.date, max_months: int) -> bool:
    """¿El último dato del espejo OCDE tiene más de ``max_months`` meses? (se rechaza con stale)."""
    if last_date is None:
        return True
    return last_date < _shift_months(today.isoformat(), -max_months)


def build_indicator(spec: dict, raw: dict | None, years: str, today: _dt.date, next_release: str | None) -> tuple[dict, list[str]]:
    """Un indicador del contrato a partir de la serie cruda ``{dates, values}`` de su fuente."""
    notes: list[str] = []
    dates, values = transform(spec["transform"], list((raw or {}).get("dates") or []), list((raw or {}).get("values") or []))
    stale = False
    if spec.get("oecdMirror") and dates and oecd_too_old(dates[-1], today, catalog()["oecdMaxAgeMonths"]):
        notes.append(f"{spec['label']}: el espejo de la OCDE ({spec['seriesId']}) no se actualiza desde hace más de 18 meses; no se muestra.")
        dates, values, stale = [], [], True
    elif dates:
        age = (today - _dt.date.fromisoformat(dates[-1])).days
        stale = age > MAX_AGE_DAYS[spec["frequency"]] + (31 if spec["frequency"] == "monthly" else 0)
    change, change_bp = change_yoy(spec["kind"], dates, values, spec["frequency"])
    if years != "max" and dates:
        cut = _years_back(_dt.date.fromisoformat(dates[-1]), int(years)).isoformat()
        keep = [i for i, d in enumerate(dates) if d >= cut]
        dates, values = [dates[i] for i in keep], [values[i] for i in keep]
    item = {
        "id": spec["id"],
        "label": spec["label"],
        "kind": spec["kind"],
        "unit": spec["unit"],
        "frequency": spec["frequency"],
        "last": {"date": dates[-1], "value": values[-1]} if dates else None,
        "previous": {"date": dates[-2], "value": values[-2]} if len(dates) > 1 else None,
        "changeYoY": change,
        "changeYoYBp": change_bp,
        "history": {"dates": dates, "values": values},
        "seriesId": spec["seriesId"],
        "source": spec["source"],
        "fallback": False,
        "stale": stale,
        "nextRelease": next_release,
    }
    return item, notes


# ─── fuentes ─────────────────────────────────────────────────────────────────


def _banxico_raw(ids: list[str], today: _dt.date, notes: list[str]) -> dict[str, dict]:
    if not ids:
        return {}
    if not banxico.configured():
        notes.append("Falta el token de Banxico en el servidor: inflación, remesas y reserva de México salen s/d.")
        return {}
    try:
        reasons = banxico.verification(list(banxico.catalog()))
        reasons.update(banxico.verification(list(banxico.extra_group("macro"))))
    except ApiError:
        notes.append("Banxico no respondió: sus indicadores salen s/d.")
        return {}
    start = _years_back(today, 10).isoformat()
    out: dict[str, dict] = {}
    for sid in ids:
        if reasons.get(sid) or not banxico.reviewed(sid):
            notes.append(f"La serie {sid} del SIE no pasó la verificación: sale s/d.")
            continue
        try:
            got = banxico.fetch_series([sid], start, today.isoformat())
        except ApiError:
            notes.append("Banxico no respondió: sus indicadores salen s/d.")
            return out
        if sid in got:
            out[sid] = got[sid]
    return out


def next_release_dates(country: str, today: _dt.date) -> dict[str, str]:
    """Primera fecha desde ``today`` de cada código de publicación (INPC, ENOE, PIBT, CPI, EMPSIT)."""
    events = curated_events([country])
    if country == "us":
        events += bls_events(bls.releases())
    out: dict[str, str] = {}
    for ev in sorted(events, key=lambda e: e["date"]):
        code = ev["id"].split("-")[1].upper()
        if ev["date"] >= today.isoformat() and code not in out:
            out[code] = ev["date"]
    return out


def macro_indicators(country: str, years: str, today: _dt.date) -> dict:
    specs = catalog()["indicators"][country]
    notes: list[str] = []
    bx_ids = [s["seriesId"] for s in specs if s["source"] == "banxico"]
    raw = _banxico_raw(bx_ids, today, notes)
    for s in specs:
        if s["source"] != "banxico" and s["seriesId"] not in raw:
            got = fred.fetch_series(s["seriesId"])
            if got["dates"]:
                raw[s["seriesId"]] = got
            else:
                notes.append(f"FRED no devolvió {s['seriesId']}: {s['label']} sale s/d.")
    upcoming = next_release_dates(country, today)
    items = []
    for s in specs:
        item, extra = build_indicator(s, raw.get(s["seriesId"]), years, today, upcoming.get(s["nextRelease"] or ""))
        items.append(item)
        notes.extend(extra)
    if country == "mx":
        notes.append("Desempleo y PIB de México vienen de los espejos de la OCDE en FRED, con dos meses o más de rezago.")
        notes.append("IGAE, empleo IMSS e inflación quincenal requieren un token gratuito de INEGI que no está configurado: salen s/d.")
        if years == "max":
            notes.append("Con Banxico la historia llega a 10 años.")
    sources = sorted({tok for s in specs for tok in s["source"].split(",") if s["seriesId"] in raw})
    as_of = max((i["last"]["date"] for i in items if i["last"]), default=None)
    return {
        "country": country,
        "indicators": items,
        "source": ",".join(sources) or ("banxico" if country == "mx" else "fred"),
        "asOf": as_of,
        "stale": any(i["stale"] for i in items),
        "notes": list(dict.fromkeys(notes)),
    }


def world_rows(countries: list[str], indicators: list[str]) -> dict:
    """Filas del comparador: el último año con dato de cada indicador, un renglón por país."""
    cat = catalog()["world"]
    names = cat["names"]
    rows: list[dict] = []
    notes = ["Datos del Banco Mundial bajo licencia CC BY 4.0."]
    years: list[int] = []
    for ind in indicators:
        spec = cat["indicators"][ind]
        data = worldbank.indicator(countries, spec["code"])
        if not data:
            notes.append(f"El Banco Mundial no respondió para {ind}: sale s/d.")
        with_value = [r["year"] for r in data if r["value"] is not None]
        year = max(with_value) if with_value else None
        if year:
            years.append(year)
        for code in countries:
            match = next((r for r in data if r["country"] == code and r["year"] == year), None)
            name = names.get(code) or (match or next((r for r in data if r["country"] == code), {})).get("name") or code
            value = match["value"] if match else None
            rows.append({
                "country": code,
                "name": name,
                "indicator": ind,
                "unit": spec["unit"],
                "year": year,
                "value": round(value * spec["scale"], 6) if value is not None and spec["scale"] != 1 else value,
            })
    return {"rows": rows, "notes": notes, "asOf": f"{max(years)}-12-31" if years else None}


__all__ = ["annualized_qoq", "build_indicator", "change_yoy", "curated", "macro_indicators", "world_rows", "yoy_series"]
