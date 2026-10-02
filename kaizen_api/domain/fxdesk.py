"""Mesa de tipo de cambio: monitor del peso, cruces, FIX por fecha y tabla del FIX (stream V5FX).

El FIX (SF43718) se lee SIEMPRE por ``kaizen_api/domain/fx.py`` (``daily_range``), con la ventana
de 10 años que termina ``today``: es una sola llamada al SIE por día, sirve al monitor, a la consulta
por fecha, a la tabla y al spot del forward, y es la misma que trae grabada la capa compartida
``2026-10-01-banxico``. Si ``fx`` cae a Yahoo (sin token o con el SIE caído), el monitor y el FIX
contable responden 503: el contrato publica el FIX de Banxico y una cotización de mercado no lo
sustituye para efectos contables. El forward sí acepta el respaldo, marcado.

Toda función que dependa de "hoy" recibe ``today``. Las funciones de estadística son puras y llevan
las pruebas de respuesta conocida de la spec.
"""

from __future__ import annotations

import datetime as _dt
import math
import statistics
from collections import OrderedDict

from kaizen_api.cache import _cached
from kaizen_api.domain import dof_rule, fx
from kaizen_api.errors import ApiError
from kaizen_api.provenance import meta
from kaizen_api.providers import banxico, cftc, frankfurter

HISTORY_YEARS = 10
FIX_TTL = 900
STALE_AFTER_DAYS = fx.STALE_AFTER_DAYS
HISTOGRAM_WIDTH = 0.0025
"""Ancho de cada barra del histograma de movimientos diarios: 0.25%."""

SIE_CROSSES: list[tuple[str, str, str]] = [
    ("EURMXN", "SF46410", "EUR"),
    ("JPYMXN", "SF46406", "JPY"),
    ("GBPMXN", "SF46407", "GBP"),
    ("CNYMXN", "SF290383", "CNY"),
    ("CADMXN", "SF60632", "CAD"),
]
LATAM_CROSSES: list[tuple[str, str]] = [
    ("BRLMXN", "BRL"),
    ("COPMXN", "COP"),
    ("CLPMXN", "CLP"),
    ("ARSMXN", "ARS"),
    ("PENMXN", "PEN"),
]
CROSS_MAX_AGE_DAYS = 7
"""Un cruce del SIE cuyo último dato válido tiene más de 7 días se reemplaza por la referencia del BCE."""
CROSS_LOOKBACK_DAYS = 400


# ─── fechas ──────────────────────────────────────────────────────────────────


def years_before(day: _dt.date, years: int) -> _dt.date:
    try:
        return day.replace(year=day.year - years)
    except ValueError:  # 29 de febrero
        return day.replace(year=day.year - years, day=28)


def history_window(today: _dt.date) -> tuple[str, str]:
    """La ventana de 10 años que termina hoy, en el formato de las llamadas al SIE."""
    return years_before(today, HISTORY_YEARS).isoformat(), today.isoformat()


def is_stale(as_of: str, today: _dt.date, max_days: int = STALE_AFTER_DAYS) -> bool:
    return (today - _dt.date.fromisoformat(as_of)).days > max_days


def _on_or_before(dates: list[str], target: str) -> int | None:
    """Índice del último elemento de ``dates`` (ordenadas) menor o igual a ``target``."""
    lo, hi = 0, len(dates)
    while lo < hi:
        mid = (lo + hi) // 2
        if dates[mid] <= target:
            lo = mid + 1
        else:
            hi = mid
    return lo - 1 if lo > 0 else None


# ─── estadística pura ────────────────────────────────────────────────────────


def percentile_rank(window: list[float], current: float) -> float | None:
    """Fracción de observaciones de ``window`` menores o iguales a ``current``."""
    clean = [v for v in window if v is not None]
    if not clean:
        return None
    return sum(1 for v in clean if v <= current) / len(clean)


def realized_vol(closes: list[float]) -> float | None:
    """Volatilidad anualizada: desviación (n-1) de los rendimientos logarítmicos por raíz de 252."""
    clean = [c for c in closes if c is not None and c > 0]
    if len(clean) < 3:
        return None
    rets = [math.log(b / a) for a, b in zip(clean, clean[1:], strict=False)]
    return statistics.stdev(rets) * math.sqrt(252)


def change(current: float, base: float | None) -> tuple[float | None, float | None]:
    """Cambio como fracción y en centavos de peso: 18.25 contra 18.10 da (0.008287, +15.00)."""
    if base is None or base == 0:
        return None, None
    return current / base - 1, (current - base) * 100


def histogram(returns: list[float], width: float = HISTOGRAM_WIDTH) -> list[dict]:
    """Conteo de movimientos diarios por barras de ``width`` (fracción), de la mínima a la máxima."""
    if not returns:
        return []
    lo = math.floor(min(returns) / width)
    hi = math.ceil(max(returns) / width)
    if hi == lo:
        hi = lo + 1
    counts = [0] * (hi - lo)
    for r in returns:
        idx = min(int(math.floor(r / width)) - lo, len(counts) - 1)
        counts[idx] += 1
    return [
        {"low": round((lo + i) * width, 6), "high": round((lo + i + 1) * width, 6), "count": c}
        for i, c in enumerate(counts)
    ]


def monthly_stats(dates: list[str], values: list[float]) -> list[dict]:
    groups: OrderedDict[str, list[float]] = OrderedDict()
    for d, v in zip(dates, values, strict=True):
        groups.setdefault(d[:7], []).append(v)
    return [
        {"month": m, "average": round(sum(vs) / len(vs), 6), "min": min(vs), "max": max(vs), "last": vs[-1]}
        for m, vs in groups.items()
    ]


def cot_position(legacy: list[dict], tff: list[dict]) -> dict | None:
    """Posicionamiento CFTC: neto de no comerciales (y su cambio semanal), apalancados y administradores."""
    if not legacy:
        return None
    now = legacy[0]

    def net(row: dict, long_key: str, short_key: str) -> float | None:
        a, b = row.get(long_key), row.get(short_key)
        return None if a is None or b is None else a - b

    nc = net(now, "noncomm_positions_long_all", "noncomm_positions_short_all")
    prev = net(legacy[1], "noncomm_positions_long_all", "noncomm_positions_short_all") if len(legacy) > 1 else None
    same_week = tff[0] if tff and tff[0]["reportDate"] == now["reportDate"] else None
    return {
        "reportDate": now["reportDate"],
        "openInterest": now.get("open_interest_all"),
        "nonCommercialNet": nc,
        "nonCommercialNetChange": None if nc is None or prev is None else nc - prev,
        "leveragedNet": net(same_week, "lev_money_positions_long", "lev_money_positions_short") if same_week else None,
        "assetManagerNet": net(same_week, "asset_mgr_positions_long", "asset_mgr_positions_short")
        if same_week
        else None,
    }


# ─── FIX ─────────────────────────────────────────────────────────────────────


def fix_history(today: _dt.date, start: _dt.date | None = None) -> fx.FxSeries:
    """FIX diario por ``fx.daily_range``: la ventana de 10 años, o desde ``start`` si es más vieja."""
    first, last = history_window(today)
    if start is not None and start.isoformat() < first:
        first = start.isoformat()
    key = f"v5fx:fix:{first}:{last}"
    return _cached(
        key,
        lambda: fx.daily_range(_dt.date.fromisoformat(first), _dt.date.fromisoformat(last)),
        ttl=FIX_TTL,
        ok=lambda s: not s.fallback,
    )


def no_fix() -> ApiError:
    return ApiError(
        503,
        "UPSTREAM_UNAVAILABLE",
        "El FIX de Banxico no está disponible en este momento. Intenta más tarde.",
    )


def banxico_fix(today: _dt.date, start: _dt.date | None = None) -> fx.FxSeries:
    """El FIX de Banxico, sin sustituto: si ``fx`` cayó a Yahoo responde 503."""
    series = fix_history(today, start)
    if series.fallback or not series.dates:
        raise no_fix()
    return series


FIX_NOTE = (
    "FIX de Banxico (serie SF43718): tipo de cambio para solventar obligaciones en dólares, fechado el día "
    "en que se determina; el DOF lo publica el día hábil siguiente."
)


def lookup_fix(date: _dt.date, rule: str, today: _dt.date) -> dict:
    """Respuesta de ``/v2/fxdesk/fix`` (``FixLookupResponse``)."""
    series = banxico_fix(today, date - _dt.timedelta(days=15))
    res = dof_rule.resolve(series.as_map(), date, rule, today)
    notes = [FIX_NOTE]
    if rule == "dof":
        notes.append(
            "La regla del DOF es la del art. 20 del CFF. Usarla o no para tu contabilidad es decisión fiscal "
            "de tu empresa: aquí solo se explica."
        )
    return {
        "date": res.date,
        "rule": res.rule,
        "fixDate": res.fix_date,
        "value": res.value,
        "dofPublicationDate": res.dof_publication_date,
        "explanation": res.explanation,
        "meta": meta("banxico", as_of=res.fix_date or series.dates[-1], notes=notes),
    }


def _month_last_day(year: int, month: int) -> _dt.date:
    nxt = _dt.date(year + (month == 12), month % 12 + 1, 1)
    return nxt - _dt.timedelta(days=1)


def fix_table(start: _dt.date, end: _dt.date, rule: str, month_end: bool, today: _dt.date) -> dict:
    """Respuesta de ``/v2/fxdesk/fix-table`` (``FixTableResponse``)."""
    series = banxico_fix(today, start - _dt.timedelta(days=15))
    fixes = series.as_map()
    daily = []
    day = start
    while day <= end:
        res = dof_rule.resolve(fixes, day, rule, today)
        daily.append({"date": res.date, "fixDate": res.fix_date, "value": res.value})
        day += _dt.timedelta(days=1)
    month_ends = []
    year, month = start.year, start.month
    while (year, month) <= (end.year, end.month):
        close = _month_last_day(year, month)
        if close <= end:
            res = dof_rule.resolve(fixes, close, rule, today)
            prefix = f"{year:04d}-{month:02d}"
            values = [v for d, v in fixes.items() if d.startswith(prefix)]
            month_ends.append(
                {
                    "month": prefix,
                    "fixDate": res.fix_date,
                    "value": res.value,
                    "average": round(sum(values) / len(values), 6) if values else None,
                }
            )
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    rows = daily
    if month_end:
        closes = {f"{m['month']}": m for m in month_ends}
        rows = [r for r in daily if r["date"][:7] in closes and _is_month_close(r["date"])]
    notes = [FIX_NOTE, "Promedio del mes: media simple de los FIX determinados en ese mes."]
    if rule == "dof":
        notes.append(
            "Regla del DOF (art. 20 del CFF): se explica en pantalla; usarla es decisión fiscal de tu empresa."
        )
    if end > today:
        notes.append("Las fechas posteriores a hoy salen sin FIX: todavía no se determina.")
    known = [r["fixDate"] for r in daily if r["fixDate"]]
    return {
        "rule": rule,
        "rows": rows,
        "monthEnds": month_ends,
        "meta": meta("banxico", as_of=max(known) if known else series.dates[-1], notes=notes),
    }


def _is_month_close(iso: str) -> bool:
    d = _dt.date.fromisoformat(iso)
    return (d + _dt.timedelta(days=1)).month != d.month


# ─── monitor ─────────────────────────────────────────────────────────────────


def build_monitor(years: int, today: _dt.date) -> dict:
    """Respuesta de ``/v2/fxdesk/monitor`` (``FxMonitorResponse``)."""
    series = banxico_fix(today)
    dates, values = series.dates, series.values
    last_date, current = dates[-1], values[-1]
    last = _dt.date.fromisoformat(last_date)

    def base_at(target: _dt.date) -> float | None:
        idx = _on_or_before(dates, target.isoformat())
        return values[idx] if idx is not None else None

    bases = {
        "d1": values[-2] if len(values) > 1 else None,
        "w1": base_at(last - _dt.timedelta(days=7)),
        "m1": base_at(_month_back(last)),
        "ytd": base_at(_dt.date(last.year - 1, 12, 31)),
        "y1": base_at(years_before(last, 1)),
    }
    changes, cents = {}, {}
    for key, base in bases.items():
        frac, cts = change(current, base)
        changes[key] = None if frac is None else round(frac, 6)
        cents[key] = None if cts is None else round(cts, 2)

    year_ago = years_before(last, 1).isoformat()
    window = [v for d, v in zip(dates, values, strict=True) if d > year_ago]
    pct = percentile_rank(window, current)

    vols = {f"d{n}": _round(realized_vol(values[-(n + 1) :]) if len(values) > n else None) for n in (20, 60, 250)}

    since = years_before(last, years).isoformat()
    start_idx = next((i for i, d in enumerate(dates) if d > since), 0)
    w_dates, w_values = dates[start_idx:], values[start_idx:]
    rets = [b / a - 1 for a, b in zip(w_values, w_values[1:], strict=False) if a]

    notes = [FIX_NOTE, "Volatilidad realizada: desviación de los rendimientos logarítmicos diarios por raíz de 252."]
    cot = None
    try:
        cot = cot_position(cftc.legacy_rows(today), cftc.tff_rows(today))
    except Exception:  # noqa: BLE001 - un fallo de la CFTC no tumba el monitor
        cot = None
    if cot is None:
        notes.append("Posicionamiento CFTC s/d: el reporte de la CFTC no respondió.")
    else:
        notes.append(
            f"Posicionamiento: CFTC Commitments of Traders, peso mexicano en CME (contrato 095741), solo futuros, "
            f"reporte del {cot['reportDate']}, en contratos."
        )
    return {
        "pair": "USDMXN",
        "spot": {"value": current, "asOf": last_date, "source": "banxico"},
        "range52w": {
            "low": min(window) if window else None,
            "high": max(window) if window else None,
            "percentile": _round(pct),
        },
        "changes": changes,
        "changesCents": cents,
        "realizedVol": vols,
        "monthly": monthly_stats(w_dates, w_values),
        "histogram": histogram(rets),
        "series": {"dates": w_dates, "values": w_values},
        "cot": cot,
        "meta": meta(
            "banxico,cftc" if cot else "banxico",
            as_of=last_date,
            stale=is_stale(last_date, today),
            notes=notes,
        ),
    }


def _month_back(day: _dt.date) -> _dt.date:
    year, month = (day.year - 1, 12) if day.month == 1 else (day.year, day.month - 1)
    return _dt.date(year, month, min(day.day, _month_last_day(year, month).day))


def _round(value: float | None, digits: int = 6) -> float | None:
    return None if value is None else round(value, digits)


# ─── cruces ──────────────────────────────────────────────────────────────────


def _row_from_points(pair: str, points: list[tuple[str, float]], source: str, provider: str, fallback: bool) -> dict:
    if not points:
        return {
            "pair": pair,
            "value": None,
            "asOf": None,
            "change1d": None,
            "change1y": None,
            "source": source,
            "provider": provider,
            "fallback": fallback,
        }
    dates = [d for d, _ in points]
    last_date, value = points[-1]
    d1 = points[-2][1] if len(points) > 1 else None
    idx = _on_or_before(dates, years_before(_dt.date.fromisoformat(last_date), 1).isoformat())
    y1 = points[idx][1] if idx is not None else None
    return {
        "pair": pair,
        "value": value,
        "asOf": last_date,
        "change1d": _round(change(value, d1)[0]),
        "change1y": _round(change(value, y1)[0]),
        "source": source,
        "provider": provider,
        "fallback": fallback,
    }


def invert(points: list[tuple[str, float]]) -> list[tuple[str, float]]:
    """De unidades de la otra moneda por peso a pesos por unidad: ``1/tasa`` a 6 decimales."""
    return [(d, round(1 / r, 6)) for d, r in points if r]


def sie_cross_points(series_id: str, today: _dt.date) -> list[tuple[str, float]]:
    """Cruce del SIE en su ventana de 10 años (los ``N/E`` ya vienen fuera, nunca como 0)."""
    start, end = history_window(today)
    try:
        data = banxico.fetch_series([series_id], start, end).get(series_id) or {}
    except ApiError:
        return []
    return list(zip(data.get("dates") or [], data.get("values") or [], strict=False))


def build_crosses(today: _dt.date) -> dict:
    """Respuesta de ``/v2/fxdesk/crosses`` (``FxCrossesResponse``)."""
    rows: list[dict] = []
    notes: list[str] = []
    stale_pairs: list[tuple[str, str]] = []
    sie_rows: dict[str, dict] = {}
    for pair, sid, code in SIE_CROSSES:
        points = sie_cross_points(sid, today)
        if points and not is_stale(points[-1][0], today, CROSS_MAX_AGE_DAYS):
            sie_rows[pair] = _row_from_points(pair, points, "banxico", "banxico", False)
        else:
            stale_pairs.append((pair, code))
    ecb: frankfurter.Points = {}
    if stale_pairs:
        start = (today - _dt.timedelta(days=CROSS_LOOKBACK_DAYS)).isoformat()
        ecb = frankfurter.v1_series("MXN", [c for _, c in stale_pairs], start, today.isoformat())
        names = ", ".join(p for p, _ in stale_pairs)
        notes.append(
            f"{names}: el SIE de Banxico no trae dato reciente, así que se muestra la referencia del BCE vía "
            "Frankfurter, marcada como respaldo."
        )
    for pair, _sid, code in SIE_CROSSES:
        if pair in sie_rows:
            rows.append(sie_rows[pair])
        else:
            rows.append(_row_from_points(pair, invert(ecb.get(code, [])), "frankfurter", "ecb", True))
    start = (today - _dt.timedelta(days=CROSS_LOOKBACK_DAYS)).isoformat()
    latam = frankfurter.v2_series("MXN", [c for _, c in LATAM_CROSSES], start, today.isoformat())
    for pair, code in LATAM_CROSSES:
        rows.append(_row_from_points(pair, invert(latam.get(code, [])), "frankfurter", "mezcla", False))
    notes.append("Euro, yen, libra, yuan y dólar canadiense: cotización de Banxico (SIE) respecto al peso, desde 2018.")
    notes.append(
        "Real, pesos colombiano, chileno y argentino y sol: Frankfurter, que reúne datos de varios bancos "
        "centrales; no son el FIX ni una cotización de Banxico. Se omiten sábados y domingos."
    )
    if not latam:
        notes.append("Los cruces latinoamericanos salen s/d: Frankfurter no respondió.")
    dated = [r["asOf"] for r in rows if r["asOf"]]
    as_of = max(dated) if dated else None
    any_fallback = any(r["fallback"] for r in rows)
    return {
        "rows": rows,
        "meta": meta(
            "banxico,frankfurter",
            as_of=as_of,
            stale=bool(as_of) and is_stale(as_of, today, CROSS_MAX_AGE_DAYS),
            fallback=any_fallback,
            notes=notes,
        ),
    }
