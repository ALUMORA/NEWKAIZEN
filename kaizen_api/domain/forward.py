"""Forward teórico USD/MXN por paridad cubierta de tasas (stream V5FX).

``F = S x (1 + iMXN x d/360) / (1 + iUSD x d/360)``, con las dos tasas en convención act/360 simple.
Es un **precio teórico sin margen bancario**: no es una cotización ni una sugerencia de cubrirse.

Referencias (``mxn`` y ``usd`` del contrato):

* ``tiie``: TIIE a 28, 91 y 182 días (SF43783, SF43878, SF111916), act/360 simple. Entre nodos se
  interpola lineal por días; fuera de ellos se usa el nodo más cercano (plano), y se dice.
* ``cetes``: CETES de subasta a 28, 91, 182 y 364 días (SF43936, SF43939, SF43942, SF43945).
* ``fondeo``: fondeo bancario (SF331451), overnight aplicado plano a todos los plazos.
* ``ust``: rendimientos CMT del Tesoro (FRED DGS1MO, DGS3MO, DGS6MO, DGS1). Son base act/365
  equivalente, así que se pasan a act/360 multiplicando por 360/365.
* ``sofr``: SOFR overnight (FRED SOFR) plano a todos los plazos. Term SOFR de CME no es gratuito.

Las tasas llegan en por ciento del SIE y de FRED y aquí se pasan a fracción. Toda función que
dependa de "hoy" recibe ``today``.
"""

from __future__ import annotations

import datetime as _dt
from dataclasses import dataclass

from kaizen_api.cache import _cached
from kaizen_api.domain import fxdesk
from kaizen_api.errors import ApiError
from kaizen_api.provenance import meta
from kaizen_api.providers import banxico, fred

ACT360 = "act/360 simple"
OVERNIGHT = "overnight plano"
CMT360 = "cmt convertida x360/365"

MXN_NODES: dict[str, list[tuple[int, str]]] = {
    "tiie": [(28, "SF43783"), (91, "SF43878"), (182, "SF111916")],
    "cetes": [(28, "SF43936"), (91, "SF43939"), (182, "SF43942"), (364, "SF43945")],
    "fondeo": [(1, "SF331451")],
}
USD_NODES: dict[str, list[tuple[int, str]]] = {
    "ust": [(30, "DGS1MO"), (91, "DGS3MO"), (182, "DGS6MO"), (365, "DGS1")],
    "sofr": [(1, "SOFR")],
}
MXN_LABEL = {"tiie": "TIIE", "cetes": "CETES", "fondeo": "fondeo bancario"}
USD_LABEL = {"ust": "Tesoro de EE. UU. (CMT)", "sofr": "SOFR"}
RATE_TTL = 1800


# ─── matemática pura ─────────────────────────────────────────────────────────


def cmt_to_act360(yield_cmt: float) -> float:
    """Rendimiento CMT (base 365) a tasa simple act/360: ``y x 360/365``."""
    return yield_cmt * 360 / 365


def forward_price(spot: float, i_mxn: float, i_usd: float, days: int) -> float:
    """Paridad cubierta con tasas simples act/360."""
    return spot * (1 + i_mxn * days / 360) / (1 + i_usd * days / 360)


def points_pips(spot: float, forward: float) -> float:
    """Puntos forward en pips: ``(F - S) x 10,000``."""
    return (forward - spot) * 10_000


def carry_annual(spot: float, forward: float, days: int) -> float:
    """Costo anualizado del forward: ``(F/S - 1) x 360/días``, como fracción."""
    return (forward / spot - 1) * 360 / days


def interpolate(nodes: list[tuple[int, float]], days: int) -> tuple[float, list[int]]:
    """Tasa a ``days`` por interpolación lineal entre nodos ``(días, tasa)``; plana fuera de ellos.

    Devuelve la tasa y los plazos de los nodos que la formaron.
    """
    ordered = sorted(nodes)
    if not ordered:
        raise ValueError("sin nodos")
    if days <= ordered[0][0]:
        return ordered[0][1], [ordered[0][0]]
    if days >= ordered[-1][0]:
        return ordered[-1][1], [ordered[-1][0]]
    for (d0, r0), (d1, r1) in zip(ordered, ordered[1:], strict=False):
        if d0 == days:
            return r0, [d0]
        if d0 < days < d1:
            return r0 + (r1 - r0) * (days - d0) / (d1 - d0), [d0, d1]
        if d1 == days:
            return r1, [d1]
    return ordered[-1][1], [ordered[-1][0]]


# ─── datos ───────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class RateNode:
    days: int
    series: str
    rate: float | None
    as_of: str | None


def _banxico_last(series_id: str, today: _dt.date) -> tuple[str | None, float | None]:
    start, end = fxdesk.history_window(today)

    def load():
        try:
            data = banxico.fetch_series([series_id], start, end).get(series_id) or {}
        except ApiError:
            return None
        dates, values = data.get("dates") or [], data.get("values") or []
        return (dates[-1], values[-1] / 100) if dates else None

    point = _cached(f"v5fx:sie-last:{series_id}:{start}:{end}", load, ttl=RATE_TTL, ok=lambda p: p is not None)
    return point if point else (None, None)


def _fred_last(series_id: str, today: _dt.date) -> tuple[str | None, float | None]:
    data = fred.fetch_series(series_id, None, today.isoformat())
    if not data["dates"]:
        return None, None
    return data["dates"][-1], data["values"][-1] / 100


def mxn_nodes(ref: str, today: _dt.date) -> list[RateNode]:
    out = []
    for days, sid in MXN_NODES[ref]:
        as_of, rate = _banxico_last(sid, today)
        out.append(RateNode(days, sid, rate, as_of))
    return out


def usd_nodes(ref: str, today: _dt.date) -> list[RateNode]:
    out = []
    for days, sid in USD_NODES[ref]:
        as_of, rate = _fred_last(sid, today)
        if rate is not None and ref == "ust":
            rate = cmt_to_act360(rate)
        out.append(RateNode(days, sid, rate, as_of))
    return out


def _rate_for(nodes: list[RateNode], days: int) -> tuple[float | None, str]:
    usable = [(n.days, n.rate) for n in nodes if n.rate is not None]
    if not usable:
        return None, ",".join(n.series for n in nodes)
    rate, used = interpolate(usable, days)
    ids = [n.series for n in nodes if n.days in used and n.rate is not None]
    return rate, ",".join(ids)


def build_forward(tenors: list[int], mxn: str, usd: str, today: _dt.date) -> dict:
    """Respuesta de ``/v2/fxdesk/forward`` (``FxForwardResponse``)."""
    fix = fxdesk.fix_history(today)
    spot_date, spot_value = fix.dates[-1], fix.values[-1]
    m_nodes, u_nodes = mxn_nodes(mxn, today), usd_nodes(usd, today)
    m_conv = OVERNIGHT if mxn == "fondeo" else ACT360
    u_conv = OVERNIGHT if usd == "sofr" else CMT360
    rows = []
    for days in tenors:
        i_mxn, m_ids = _rate_for(m_nodes, days)
        i_usd, u_ids = _rate_for(u_nodes, days)
        fwd = pts = carry = None
        if i_mxn is not None and i_usd is not None:
            raw = forward_price(spot_value, i_mxn, i_usd, days)
            fwd = round(raw, 6)
            pts = round(points_pips(spot_value, raw), 2)
            carry = round(carry_annual(spot_value, raw, days), 6)
        rows.append(
            {
                "days": days,
                "date": (today + _dt.timedelta(days=days)).isoformat(),
                "iMxn": None if i_mxn is None else round(i_mxn, 6),
                "iUsd": None if i_usd is None else round(i_usd, 6),
                "iMxnSeries": m_ids,
                "iUsdSeries": u_ids,
                "iMxnConvention": m_conv,
                "iUsdConvention": u_conv,
                "forward": fwd,
                "pointsPips": pts,
                "carryAnnual": carry,
            }
        )
    notes = ["Precio teórico sin margen bancario: no es cotización ni sugerencia de cubrirse."]
    notes.append(_mxn_note(mxn, m_nodes))
    notes.append(_usd_note(usd, u_nodes))
    missing = [n.series for n in (*m_nodes, *u_nodes) if n.rate is None]
    if missing:
        notes.append(f"Sin dato de {', '.join(missing)}: los plazos que dependen de esas tasas salen s/d.")
    if fix.fallback:
        notes.extend(fix.notes)
    dated = [n.as_of for n in (*m_nodes, *u_nodes) if n.as_of]
    as_of = max([spot_date, *dated]) if dated else spot_date
    source = "yahoo,banxico,fred" if fix.fallback else "banxico,fred"
    return {
        "spot": {"value": spot_value, "asOf": spot_date},
        "rows": rows,
        "meta": meta(source, as_of=as_of, stale=fxdesk.is_stale(spot_date, today), fallback=fix.fallback, notes=notes),
    }


def _when(nodes: list[RateNode]) -> str:
    dates = sorted({n.as_of for n in nodes if n.as_of})
    return f" (dato al {dates[-1]})" if dates else ""


def _mxn_note(ref: str, nodes: list[RateNode]) -> str:
    if ref == "fondeo":
        return f"Pesos: fondeo bancario overnight aplicado plano a todos los plazos{_when(nodes)}."
    terms = ", ".join(str(n.days) for n in nodes)
    return (
        f"Pesos: {MXN_LABEL[ref]} a {terms} días, act/360 simple, interpolada lineal entre plazos y plana fuera "
        f"de ellos{_when(nodes)}."
    )


def _usd_note(ref: str, nodes: list[RateNode]) -> str:
    if ref == "sofr":
        return (
            "Dólares: SOFR overnight aplicado plano a todos los plazos, porque Term SOFR de CME no es gratuito"
            f"{_when(nodes)}."
        )
    return (
        "Dólares: rendimientos CMT del Tesoro a 1, 3, 6 y 12 meses convertidos a act/360 multiplicando por "
        f"360/365, interpolados lineal entre plazos{_when(nodes)}."
    )
