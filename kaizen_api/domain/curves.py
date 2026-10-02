"""Curvas de rendimiento de México y EE. UU., inflación implícita y diferenciales (stream V5TS).

Fuentes: el SIE de Banxico (CETES, Bonos M y Udibonos, con el candado del catálogo), FRED
(``fredgraph.csv`` de los DGS) y el Tesoro de EE. UU. (curva par y curva real, en
``providers/treasury.py``). Los nodos viven en ``kaizen_api/data/curve_nodes.json``.

Reglas que aplican aquí y en ``money_market.py`` y ``expectations.py``:

* Todo lo que depende de "hoy" recibe ``today`` como parámetro. El router le pasa la fecha del reloj
  del servidor (en replay, la del set: 2026-09-22) y nada se lee después de esa fecha.
* Rendimientos como fracción (el SIE y FRED publican por ciento: ``9.35`` es ``0.0935``), cambios y
  diferenciales en pb. Un ``N/E`` del SIE o un ``.`` de FRED es ``None`` y la UI dice s/d, nunca 0.
* En México cada plazo cambia solo en su subasta, así que cada nodo lleva su propia fecha y el
  diferencial avisa con ``asOfMismatch`` cuando las dos tasas no son del mismo día.
* Las series del SIE se leen una por llamada con la ventana de 10 años que terminan en ``today``:
  es la forma que grabó la capa compartida ``2026-10-01-banxico``, y aquí se recorta en memoria.
"""

from __future__ import annotations

import datetime as _dt
import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from kaizen_api.cache import register_reset
from kaizen_api.errors import ApiError
from kaizen_api.providers import banxico, fred, treasury

CONFIG_PATH = Path(__file__).resolve().parents[1] / "data" / "curve_nodes.json"
HISTORY_YEARS = 10
"""Ventana con la que se pide cada serie del SIE (la misma de la capa compartida)."""
MISMATCH_DAYS = 7
"""Más de 7 días entre las dos fechas de un diferencial o de una inflación implícita = ``asOfMismatch``."""
COMPARE_DAYS = {"1w": 7, "1m": 30, "1y": 365}
US_MAX_AGE_DAYS = 7
DEFAULT_SIE_MAX_AGE = 14


# ─── configuración ───────────────────────────────────────────────────────────


@lru_cache(maxsize=1)
def config() -> dict[str, Any]:
    """``curve_nodes.json`` completo."""
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


@register_reset
def _forget_config() -> None:
    config.cache_clear()


# ─── aritmética pura (pruebas de respuesta conocida) ─────────────────────────


def to_bp(fraction: float) -> float:
    """Fracción a puntos base con dos decimales: ``0.0409`` a ``409.0``."""
    return round(fraction * 10_000, 2)


def spread_bp(mx: float | None, us: float | None) -> float | None:
    """México menos EE. UU. en pb; ``None`` si falta un lado. ``0.0935`` y ``0.0526`` dan 409."""
    if mx is None or us is None:
        return None
    return to_bp(mx - us)


def fisher(nominal: float | None, real: float | None) -> float | None:
    """Inflación implícita de Fisher ``(1 + n)/(1 + r) - 1``, redondeada a 6 decimales."""
    if nominal is None or real is None:
        return None
    return round((1 + nominal) / (1 + real) - 1, 6)


def simple_bp(nominal: float | None, real: float | None) -> float | None:
    """Diferencia simple nominal menos real en pb (``0.0964 - 0.0461`` = 503)."""
    if nominal is None or real is None:
        return None
    return to_bp(nominal - real)


def date_gap_days(a: str | None, b: str | None) -> int | None:
    """Días entre dos fechas ISO, sin signo; ``None`` si falta una."""
    if not a or not b:
        return None
    return abs((_dt.date.fromisoformat(a) - _dt.date.fromisoformat(b)).days)


def as_of_mismatch(gap: int | None) -> bool:
    """``True`` si las dos fechas están separadas por más de :data:`MISMATCH_DAYS`."""
    return gap is not None and gap > MISMATCH_DAYS


def years_ago(day: _dt.date, years: int) -> _dt.date:
    """El mismo día de hace ``years`` años (el 29 de febrero cae en el 28)."""
    try:
        return day.replace(year=day.year - years)
    except ValueError:
        return day.replace(year=day.year - years, day=28)


def sie_percent(raw: Any) -> float | None:
    """Dato del SIE en por ciento a fracción: ``'9.35'`` a ``0.0935``; ``'N/E'`` a ``None``."""
    value = banxico.parse_amount(raw)
    return None if value is None else round(value / 100, 8)


def on_or_before(serie: dict, day: str) -> tuple[str, float] | None:
    """Última observación ``(fecha, valor)`` con fecha menor o igual a ``day``."""
    found = None
    for date, value in zip(serie.get("dates") or [], serie.get("values") or [], strict=False):
        if date > day:
            break
        found = (date, value)
    return found


def latest(serie: dict | None) -> tuple[str, float] | None:
    """Última observación de una serie ``{"dates", "values"}``."""
    if not serie or not serie.get("dates"):
        return None
    return serie["dates"][-1], serie["values"][-1]


def is_stale(as_of: str | None, today: _dt.date, max_age_days: int) -> bool:
    """¿El dato es más viejo que su tolerancia? Sin fecha cuenta como viejo."""
    if not as_of:
        return True
    return (today - _dt.date.fromisoformat(as_of)).days > max_age_days


# ─── lectura de series ───────────────────────────────────────────────────────


def _clip(serie: dict, end: str, scale: float = 1.0) -> dict:
    dates: list[str] = []
    values: list[float] = []
    for date, value in zip(serie.get("dates") or [], serie.get("values") or [], strict=False):
        if date > end or value is None:
            continue
        dates.append(date)
        values.append(round(value * scale, 8))
    return {"dates": dates, "values": values}


class Sources:
    """Lee las series que pide una respuesta y junta sus avisos. Una instancia por petición.

    El SIE solo se usa con token y para series revisadas a mano (``verified`` en el catálogo) que el
    propio SIE confirma en sus metadatos; lo que no pasa queda en ``None`` con su razón en ``notes``.
    """

    def __init__(self, today: _dt.date):
        self.today = today
        self.end = today.isoformat()
        self.notes: list[str] = []
        self.sie_failed = False
        self._sie: dict[str, dict | None] = {}
        self._fred: dict[str, dict] = {}
        self._gate: dict[str, list[str]] = {}

    def note(self, text: str) -> None:
        if text not in self.notes:
            self.notes.append(text)

    # SIE

    @property
    def sie_configured(self) -> bool:
        return banxico.configured()

    def _gate_group(self, sid: str) -> list[str]:
        """Los ids con los que se pide la verificación: el catálogo de ``/v2/rates/mx`` o el grupo adicional.

        Se piden igual que los grabó la capa compartida (mismo grupo, mismo orden) para que el replay
        las encuentre y para compartir la caché de 24 h con ``/v2/rates/mx``.
        """
        if sid in banxico.catalog():
            return list(banxico.catalog())
        group = (banxico.extra_catalog().get(sid) or {}).get("group")
        return list(banxico.extra_group(group)) if group else [sid]

    def sie_reasons(self, sid: str) -> list[str]:
        """Por qué no se publica una serie del SIE; lista vacía si se puede publicar."""
        if sid in self._gate:
            return self._gate[sid]
        if not self.sie_configured:
            reasons = ["no hay token de Banxico"]
        else:
            try:
                checked = banxico.verification(self._gate_group(sid))
                reasons = list(checked.get(sid, [banxico.NOT_RETURNED]))
            except ApiError:
                self.sie_failed = True
                reasons = ["Banxico no respondió"]
            if not reasons and not banxico.reviewed(sid):
                reasons = ["la serie todavía no tiene revisión humana"]
        self._gate[sid] = reasons
        if reasons and reasons != ["no hay token de Banxico"] and reasons != ["Banxico no respondió"]:
            self.note(f"No se publicó la serie {sid} del SIE: " + "; ".join(reasons) + ".")
        return reasons

    def sie(self, sid: str) -> dict | None:
        """Serie del SIE en la unidad del contrato (por ciento a fracción) hasta ``today``; ``None`` si no se puede."""
        if sid in self._sie:
            return self._sie[sid]
        result: dict | None = None
        if not self.sie_reasons(sid):
            try:
                start = years_ago(self.today, HISTORY_YEARS).isoformat()
                raw = banxico.fetch_series([sid], start, self.end).get(sid) or {}
                result = _clip(raw, self.end, banxico.scale_for(sid))
            except ApiError:
                self.sie_failed = True
                result = None
        self._sie[sid] = result
        return result

    def sie_max_age(self, sid: str) -> int:
        entry = banxico.catalog().get(sid) or banxico.extra_catalog().get(sid) or {}
        return int(entry.get("maxAgeDays") or DEFAULT_SIE_MAX_AGE)

    # FRED y Tesoro

    def fred(self, sid: str, scale: float = 0.01) -> dict:
        """Serie de FRED como fracción hasta ``today`` (vacía si FRED no respondió)."""
        if sid not in self._fred:
            self._fred[sid] = _clip(fred.fetch_series(sid), self.end, scale)
        return self._fred[sid]

    def treasury(self, kind: str, column: str, years: int = 0) -> dict:
        """Columna de la curva ``par`` o ``real`` del Tesoro hasta ``today``, con ``years`` años atrás."""
        span = list(range(self.today.year - years, self.today.year + 1))
        serie = treasury.series(kind, column, span, end=self.end)  # type: ignore[arg-type]
        if not serie["dates"] and years == 0:
            # A principios de enero el CSV del año todavía no trae filas: se usa el del año anterior.
            serie = treasury.series(kind, column, [self.today.year - 1], end=self.end)  # type: ignore[arg-type]
        return serie

    def us_node(self, node: dict, years: int = 0) -> dict:
        if node.get("source") == "treasury":
            return self.treasury("par", node["column"], years)
        return self.fred(node["seriesId"])

    def sie_note(self) -> None:
        """Aviso general cuando el SIE no estuvo disponible (sin token o sin respuesta)."""
        if not self.sie_configured:
            self.note("Este servidor no tiene el token de Banxico, así que los datos de México salen s/d.")
        elif self.sie_failed:
            self.note("Banxico no respondió, así que algunos datos de México salen s/d.")


# ─── /v2/curves ──────────────────────────────────────────────────────────────


def _point(serie: dict | None, day: str) -> dict:
    hit = on_or_before(serie or {}, day)
    return {"value": hit[1] if hit else None, "asOf": hit[0] if hit else None}


def _compare(series_by_node: list[tuple[dict, dict | None]], windows: list[str], today: _dt.date) -> dict:
    out: dict[str, list[dict]] = {}
    for window in windows:
        day = (today - _dt.timedelta(days=COMPARE_DAYS[window])).isoformat()
        out[window] = [{"tenorDays": node["tenorDays"], **_point(serie, day)} for node, serie in series_by_node]
    return out


def _breakeven(nominal: tuple[str, float] | None, real: tuple[str, float] | None, tenor_days: int) -> dict:
    n_val = nominal[1] if nominal else None
    r_val = real[1] if real else None
    n_as_of = nominal[0] if nominal else None
    r_as_of = real[0] if real else None
    return {
        "tenorDays": tenor_days,
        "value": fisher(n_val, r_val),
        "simpleBp": simple_bp(n_val, r_val),
        "nominalAsOf": n_as_of,
        "realAsOf": r_as_of,
        "dateGapDays": date_gap_days(n_as_of, r_as_of),
    }


def _mx_curves(src: Sources, windows: list[str]) -> dict:
    cfg = config()["mx"]
    nodes: list[dict] = []
    pairs: list[tuple[dict, dict | None]] = []
    stale = False
    for node in cfg["nodes"]:
        serie = src.sie(node["seriesId"])
        last = latest(serie)
        nodes.append(
            {
                "tenorDays": node["tenorDays"],
                "label": node["label"],
                "value": last[1] if last else None,
                "asOf": last[0] if last else None,
                "seriesId": node["seriesId"],
                "instrument": node["instrument"],
            }
        )
        pairs.append((node, serie))
        if last and is_stale(last[0], src.today, src.sie_max_age(node["seriesId"])):
            stale = True
    fallback = False
    source = "banxico"
    if not any(n["value"] is not None for n in nodes):
        # Sin SIE, lo único honesto es el Bono M 10 años mensual de la OCDE en FRED, marcado respaldo.
        fb = cfg["fallbackBonoM10"]
        last = latest(src.fred(fb["seriesId"]))
        if last:
            fallback = True
            source = "fred"
            for node in nodes:
                if node["tenorDays"] == fb["tenorDays"] and node["instrument"] == fb["instrument"]:
                    node.update(value=last[1], asOf=last[0], seriesId=fb["seriesId"])
            stale = is_stale(last[0], src.today, fb["maxAgeDays"])
            src.note(
                "Respaldo: el Bono M a 10 años es la serie mensual de la OCDE en FRED, no la subasta de"
                " Banxico. Los demás plazos salen s/d mientras no haya datos del SIE."
            )
    real: list[dict] = []
    real_by_sid: dict[str, tuple[str, float] | None] = {}
    for node in cfg["real"]:
        last = latest(src.sie(node["seriesId"]))
        real_by_sid[node["seriesId"]] = last
        real.append(
            {
                "tenorDays": node["tenorDays"],
                "value": last[1] if last else None,
                "asOf": last[0] if last else None,
                "seriesId": node["seriesId"],
            }
        )
    breakeven = []
    for pair in cfg["breakeven"]:
        nominal = latest(src.sie(pair["nominal"]))
        breakeven.append(_breakeven(nominal, real_by_sid.get(pair["real"]), pair["tenorDays"]))
    if any(b["dateGapDays"] and b["dateGapDays"] > MISMATCH_DAYS for b in breakeven):
        src.note(
            "La inflación implícita de México compara el Bono M y el Udibono de su última subasta, que puede"
            " ser de fechas distintas: cada renglón dice cuántos días las separan."
        )
    src.note("El Udibono a 10 años no tiene serie de subasta en el SIE, así que ese plazo no tiene tasa real.")
    src.sie_note()
    return {
        "nodes": nodes,
        "compare": _compare(pairs, windows, src.today),
        "real": real,
        "breakeven": breakeven,
        "source": source,
        "fallback": fallback,
        "stale": stale,
    }


def _us_curves(src: Sources, windows: list[str]) -> dict:
    cfg = config()["us"]
    back = 1 if "1y" in windows else (1 if src.today.month == 1 and windows else 0)
    nodes: list[dict] = []
    pairs: list[tuple[dict, dict | None]] = []
    stale = False
    for node in cfg["nodes"]:
        serie = src.us_node(node, back)
        last = latest(serie)
        nodes.append(
            {
                "tenorDays": node["tenorDays"],
                "label": node["label"],
                "value": last[1] if last else None,
                "asOf": last[0] if last else None,
                "seriesId": node["seriesId"],
                "instrument": "ust",
            }
        )
        pairs.append((node, serie))
        if is_stale(last[0] if last else None, src.today, US_MAX_AGE_DAYS):
            stale = True
    real: list[dict] = []
    breakeven: list[dict] = []
    for node in cfg["real"]:
        real_last = latest(src.treasury("real", node["column"]))
        nominal_serie = src.treasury("par", node["nominalColumn"])
        # La inflación implícita usa el nominal del Tesoro del MISMO día que la real cuando existe.
        nominal_last = on_or_before(nominal_serie, real_last[0]) if real_last else latest(nominal_serie)
        real.append(
            {
                "tenorDays": node["tenorDays"],
                "value": real_last[1] if real_last else None,
                "asOf": real_last[0] if real_last else None,
                "seriesId": node["seriesId"],
            }
        )
        breakeven.append(_breakeven(nominal_last, real_last, node["tenorDays"]))
    if not any(n["value"] is not None for n in nodes):
        src.note("FRED y el Tesoro no respondieron, así que la curva de EE. UU. sale s/d.")
    src.note(
        "Los plazos de 3, 7 y 20 años, la curva real y la inflación implícita vienen del Tesoro de EE. UU.;"
        " los demás plazos, de FRED. Las dos fuentes publican el mismo rendimiento par (cmt)."
    )
    return {
        "nodes": nodes,
        "compare": _compare(pairs, windows, src.today),
        "real": real,
        "breakeven": breakeven,
        "source": "fred,treasury",
        "fallback": False,
        "stale": stale,
    }


def get_curves(country: str, compare: list[str], today: _dt.date) -> dict:
    """``/v2/curves``: nodos con su fecha, curvas pasadas, curva real e inflación implícita."""
    src = Sources(today)
    data = _mx_curves(src, compare) if country == "mx" else _us_curves(src, compare)
    dates = [n["asOf"] for n in data["nodes"] if n["asOf"]]
    data.update(country=country, asOf=max(dates) if dates else None, notes=src.notes)
    return data


# ─── /v2/curves/spreads ──────────────────────────────────────────────────────


def spread_row(tenor_years: int, mx_sid: str, us_sid: str, mx: tuple[str, float] | None, us: tuple[str, float] | None) -> dict:
    """Un renglón del diferencial México menos EE. UU. con sus dos fechas."""
    mx_as_of = mx[0] if mx else None
    us_as_of = us[0] if us else None
    gap = date_gap_days(mx_as_of, us_as_of)
    return {
        "tenorYears": tenor_years,
        "mxSeriesId": mx_sid,
        "usSeriesId": us_sid,
        "mx": mx[1] if mx else None,
        "us": us[1] if us else None,
        "spreadBp": spread_bp(mx[1] if mx else None, us[1] if us else None),
        "mxAsOf": mx_as_of,
        "usAsOf": us_as_of,
        "dateGapDays": gap,
        "asOfMismatch": as_of_mismatch(gap),
    }


def spread_history(mx: dict | None, us: dict, start: str) -> dict:
    """Diferencial a 10 años en las fechas de subasta del Bono M desde ``start``.

    El lado de EE. UU. es el DGS10 de ese día o el último publicado hasta 7 días antes; si no hay,
    el punto es ``None``. No se rellena el Bono M entre subastas: cada punto es una subasta real.
    """
    dates: list[str] = []
    values: list[float | None] = []
    for date, value in zip((mx or {}).get("dates") or [], (mx or {}).get("values") or [], strict=False):
        if date < start:
            continue
        hit = on_or_before(us, date)
        usable = hit is not None and (date_gap_days(hit[0], date) or 0) <= MISMATCH_DAYS
        dates.append(date)
        values.append(spread_bp(value, hit[1]) if usable and hit else None)
    return {"dates": dates, "valuesBp": values}


def get_spreads(history: str, today: _dt.date) -> dict:
    """``/v2/curves/spreads``: diferencial por plazo y su historia a 10 años en 1 o 5 años."""
    src = Sources(today)
    us_nodes = {n["seriesId"]: n for n in config()["us"]["nodes"]}
    rows = []
    for item in config()["spreads"]:
        mx = latest(src.sie(item["mx"]))
        us = latest(src.us_node(us_nodes[item["us"]]))
        rows.append(spread_row(item["tenorYears"], item["mx"], item["us"], mx, us))
    years = 5 if history == "5y" else 1
    start = years_ago(today, years).isoformat()
    hist = spread_history(src.sie("SF44071"), src.fred("DGS10"), start)
    if any(r["asOfMismatch"] for r in rows):
        src.note(
            "En México cada plazo cambia solo en su subasta: los renglones marcados comparan tasas de fechas"
            " distintas."
        )
    src.note("La historia del diferencial a 10 años tiene un punto por subasta del Bono M a 10 años.")
    src.sie_note()
    dates = [d for r in rows for d in (r["mxAsOf"], r["usAsOf"]) if d]
    stale = any(
        (r["mxAsOf"] and is_stale(r["mxAsOf"], today, src.sie_max_age(r["mxSeriesId"])))
        or (r["usAsOf"] and is_stale(r["usAsOf"], today, US_MAX_AGE_DAYS))
        for r in rows
    )
    return {
        "rows": rows,
        "history10y": hist,
        "asOf": max(dates) if dates else None,
        "stale": stale,
        "notes": src.notes,
    }
