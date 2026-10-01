"""Mercado de dinero: tasas cortas que no trae ``/v2/rates/mx`` y sus cambios en pb (stream V5TS).

Los renglones son la TIIE a 91 y 182 días (SIE), la tasa de fondos federales efectiva y la SOFR
(FRED, overnight) y los Tesoros de 1, 3 y 6 meses y 1 año (FRED, rendimiento cmt en base bono).
``mxChanges`` trae los cambios semanal y mensual de las tasas que YA publica ``/v2/rates/mx``, sin
repetir sus valores: la UI une las dos respuestas por ``id``.

Cambios: ``change1dBp`` contra la observación anterior, ``change1wBp`` contra la última publicada
7 días o más antes de la fecha del dato, ``change1mBp`` contra la de 30 días o más antes.
"""

from __future__ import annotations

import datetime as _dt

from kaizen_api.domain.curves import Sources, config, is_stale, on_or_before, to_bp
from kaizen_api.providers import banxico

SOFR_CITATION = (
    "SOFR: Federal Reserve Bank of New York, Secured Overnight Financing Rate, obtenida de FRED, Federal"
    " Reserve Bank of St. Louis. Se publica con la cita que pide el NY Fed."
)
CONVENTION_NOTE = (
    "Convenciones: la TIIE es tasa simple act/360, la de fondos federales y la SOFR son tasas a un día, y"
    " los Tesoros son rendimientos cmt en base bono; no se comparan directo sin convertirlas."
)


def change_bp(value: float | None, base: float | None) -> float | None:
    """Cambio en pb con dos decimales: ``0.068134`` contra ``0.069`` da ``-8.66``."""
    if value is None or base is None:
        return None
    return to_bp(value - base)


def changes(serie: dict | None) -> dict:
    """Valor, fecha y cambios de 1 día, 1 semana y 1 mes de una serie ``{"dates", "values"}``."""
    dates = (serie or {}).get("dates") or []
    values = (serie or {}).get("values") or []
    if not dates:
        return {"value": None, "asOf": None, "change1dBp": None, "change1wBp": None, "change1mBp": None}
    value, as_of = values[-1], dates[-1]
    day = _dt.date.fromisoformat(as_of)
    previous = values[-2] if len(values) >= 2 else None
    week = on_or_before(serie or {}, (day - _dt.timedelta(days=7)).isoformat())
    month = on_or_before(serie or {}, (day - _dt.timedelta(days=30)).isoformat())
    return {
        "value": value,
        "asOf": as_of,
        "change1dBp": change_bp(value, previous),
        "change1wBp": change_bp(value, week[1] if week else None),
        "change1mBp": change_bp(value, month[1] if month else None),
    }


def get_money_market(today: _dt.date) -> dict:
    """``/v2/money-market``: renglones, cambios de las tasas de ``/v2/rates/mx`` y avisos."""
    src = Sources(today)
    rows: list[dict] = []
    for spec in config()["moneyMarket"]:
        serie = src.sie(spec["seriesId"]) if spec["source"] == "banxico" else src.fred(spec["seriesId"])
        moves = changes(serie)
        rows.append(
            {
                "id": spec["id"],
                "label": spec["label"],
                "country": spec["country"],
                "value": moves["value"],
                "convention": spec["convention"],
                "asOf": moves["asOf"],
                "change1dBp": moves["change1dBp"],
                "change1wBp": moves["change1wBp"],
                "change1mBp": moves["change1mBp"],
                "seriesId": spec["seriesId"],
                "source": spec["source"],
                "stale": is_stale(moves["asOf"], today, int(spec["maxAgeDays"])),
            }
        )
    mx_changes: list[dict] = []
    for rate_id in config()["mxChanges"]:
        sid = banxico.series_for(rate_id)
        serie = src.sie(sid) if sid else None
        if not serie or not serie.get("dates"):
            continue
        moves = changes(serie)
        mx_changes.append({"id": rate_id, "change1wBp": moves["change1wBp"], "change1mBp": moves["change1mBp"]})
    src.note(CONVENTION_NOTE)
    src.note(SOFR_CITATION)
    src.sie_note()
    dates = [r["asOf"] for r in rows if r["asOf"]]
    return {
        "rows": rows,
        "mxChanges": mx_changes,
        "asOf": max(dates) if dates else None,
        "stale": any(r["stale"] for r in rows),
        "notes": src.notes,
    }
