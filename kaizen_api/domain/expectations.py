"""Expectativas: encuesta de especialistas de Banxico, tasa real y forwards implícitos (stream V5TS).

* **Encuesta.** Las series ``SR...`` del grupo ``encuesta`` del catálogo del SIE. El periodo se fecha
  el día 01 del mes del levantamiento; ``yearT`` es el año de esa fecha (la encuesta de diciembre de
  2026 consultada en enero de 2027 sigue hablando de 2026), y los renglones ``...T1`` son del año
  siguiente. Una serie que no pasa el candado sale ``null`` con ``verified: false`` y la UI dice s/d.
* **Tasa real de CETES 28.** Ex post contra la inflación anual observada (SP30578) y ex ante contra la
  mediana de la encuesta para el año en curso, las dos con Fisher ``(1 + c)/(1 + i) - 1``.
* **Forwards implícitos.** México con CETES (act/360 simple) contra la tasa objetivo; EE. UU. con los
  Tesoros cortos de FRED pasados de cmt a act/360 con ``x 360/365``, contra la de fondos federales.
"""

from __future__ import annotations

import datetime as _dt

from kaizen_api.domain.curves import Sources, fisher, is_stale, latest, to_bp
from kaizen_api.providers import banxico

SURVEY_ITEMS = (
    ("inflationT", "Inflación al cierre del año", 0, "fraction"),
    ("inflationT1", "Inflación al cierre del año siguiente", 1, "fraction"),
    ("gdpT", "Crecimiento real del PIB en el año", 0, "fraction"),
    ("fxT", "Tipo de cambio al cierre del año", 0, "mxnPerUsd"),
    ("fxT1", "Tipo de cambio al cierre del año siguiente", 1, "mxnPerUsd"),
)
"""``(id, etiqueta, años después de yearT, unidad)`` de cada renglón de la encuesta."""

MX_FORWARD_NODES = (("SF43936", 28), ("SF43939", 91), ("SF43942", 182), ("SF43945", 364))
US_FORWARD_NODES = (("DGS1MO", 30), ("DGS3MO", 91), ("DGS6MO", 182), ("DGS1", 365))
SURVEY_MAX_AGE_DAYS = 70
"""La encuesta es mensual y se fecha el día 01: con más de 70 días ya faltó un levantamiento."""
US_NOTE = "de rendimientos cmt convertidos a act/360 con x360/365"


def survey_years(survey_date: str | None, today: _dt.date) -> tuple[int | None, int | None]:
    """``(yearT, yearT + 1)`` de un levantamiento. Depende de la fecha del periodo, no de ``today``.

    ``today`` se recibe para dejar explícito que consultar en enero una encuesta de diciembre no
    cambia el año: 2026-12-01 consultada el 2027-01-15 sigue siendo ``yearT = 2026``.
    """
    del today
    if not survey_date:
        return None, None
    year = _dt.date.fromisoformat(survey_date).year
    return year, year + 1


def real_rate(nominal: float | None, inflation: float | None) -> float | None:
    """Tasa real de Fisher: CETES 0.07 e inflación 0.04 dan ``1.07/1.04 - 1 = 0.028846``."""
    return fisher(nominal, inflation)


def cmt_to_act360(cmt: float | None) -> float | None:
    """Rendimiento cmt (base bono, 365) a tasa simple act/360: ``0.0425`` da ``0.041918``."""
    return None if cmt is None else round(cmt * 360 / 365, 6)


def forward_act360(r1: float | None, d1: int, r2: float | None, d2: int) -> float | None:
    """Forward simple act/360 entre ``d1`` y ``d2`` días: ``((1 + r2 d2/360)/(1 + r1 d1/360) - 1) 360/(d2 - d1)``."""
    if r2 is None or d2 <= d1:
        return None
    if d1 == 0:
        return round(r2, 6)
    if r1 is None:
        return None
    growth = (1 + r2 * d2 / 360) / (1 + r1 * d1 / 360)
    return round((growth - 1) * 360 / (d2 - d1), 6)


def _forwards(rates: list[tuple[int, float | None]]) -> list[tuple[int, int, float | None]]:
    out: list[tuple[int, int, float | None]] = []
    prev_days, prev_rate = 0, None
    for days, rate in rates:
        out.append((prev_days, days, forward_act360(prev_rate, prev_days, rate, days)))
        prev_days, prev_rate = days, rate
    return out


def _survey(src: Sources) -> dict:
    by_item: dict[tuple[str, str], str] = {}
    for sid, entry in banxico.extra_group("encuesta").items():
        by_item[(entry.get("item"), entry.get("stat"))] = sid
    latest_by_sid: dict[str, tuple[str, float] | None] = {}
    for sid in by_item.values():
        latest_by_sid[sid] = latest(src.sie(sid))
    dates = [hit[0] for hit in latest_by_sid.values() if hit]
    survey_date = max(dates) if dates else None
    year_t, year_t1 = survey_years(survey_date, src.today)
    items = []
    for item_id, label, offset, unit in SURVEY_ITEMS:
        mean_sid = by_item.get((item_id, "mean"))
        median_sid = by_item.get((item_id, "median"))
        values = {}
        for stat, sid in (("mean", mean_sid), ("median", median_sid)):
            hit = latest_by_sid.get(sid) if sid else None
            # Solo cuenta el dato del mismo levantamiento: un mes viejo no se mezcla con el actual.
            values[stat] = round(hit[1], 6) if hit and hit[0] == survey_date else None
        verified = all(sid and not src.sie_reasons(sid) for sid in (mean_sid, median_sid))
        items.append(
            {
                "id": item_id,
                "label": label,
                "year": None if year_t is None else (year_t if offset == 0 else year_t1),
                "mean": values["mean"],
                "median": values["median"],
                "unit": unit,
                "seriesIdMean": mean_sid,
                "seriesIdMedian": median_sid,
                "verified": bool(verified),
            }
        )
    return {"surveyDate": survey_date, "yearT": year_t, "items": items}


def get_expectations(today: _dt.date) -> dict:
    """``/v2/expectations``: encuesta, tasa real ex post y ex ante y forwards implícitos."""
    src = Sources(today)
    survey = _survey(src)
    cetes = {sid: latest(src.sie(sid)) for sid, _ in MX_FORWARD_NODES}
    cetes28 = cetes["SF43936"][1] if cetes["SF43936"] else None
    inflation_hit = latest(src.sie("SP30578"))
    observed = inflation_hit[1] if inflation_hit else None
    inflation_t = next((i for i in survey["items"] if i["id"] == "inflationT"), None)
    expected = inflation_t["median"] if inflation_t else None
    real_rates = {
        "cetes28": cetes28,
        "observedInflation": observed,
        "exPost": real_rate(cetes28, observed),
        "expectedInflation": expected,
        "exAnte": real_rate(cetes28, expected),
    }
    target_hit = latest(src.sie("SF61745"))
    target = target_hit[1] if target_hit else None
    mx = [
        {
            "fromDays": a,
            "toDays": b,
            "rate": rate,
            "vsTargetBp": to_bp(rate - target) if rate is not None and target is not None else None,
        }
        for a, b, rate in _forwards([(days, cetes[sid][1] if cetes[sid] else None) for sid, days in MX_FORWARD_NODES])
    ]
    dff_hit = latest(src.fred("DFF"))
    dff = dff_hit[1] if dff_hit else None
    us_rates = []
    us_dates = []
    for sid, days in US_FORWARD_NODES:
        hit = latest(src.fred(sid))
        us_rates.append((days, cmt_to_act360(hit[1]) if hit else None))
        if hit:
            us_dates.append(hit[0])
    us = [
        {
            "fromDays": a,
            "toDays": b,
            "rate": rate,
            "vsDffBp": to_bp(rate - dff) if rate is not None and dff is not None else None,
            "note": US_NOTE,
        }
        for a, b, rate in _forwards(us_rates)
    ]
    src.note(
        "La encuesta es de los especialistas del sector privado que levanta Banxico cada mes; su año se toma"
        " de la fecha del levantamiento."
    )
    src.note(
        "Los forwards implícitos salen de la curva de hoy y no son un pronóstico: incluyen primas por plazo."
    )
    src.sie_note()
    dates = [d for d in (survey["surveyDate"], inflation_hit and inflation_hit[0], target_hit and target_hit[0]) if d]
    dates += [hit[0] for hit in cetes.values() if hit] + us_dates
    return {
        "survey": survey,
        "realRates": real_rates,
        "impliedForwards": {"mx": mx, "us": us},
        "asOf": max(dates) if dates else None,
        "stale": survey["surveyDate"] is not None and is_stale(survey["surveyDate"], today, SURVEY_MAX_AGE_DAYS),
        "notes": src.notes,
    }
