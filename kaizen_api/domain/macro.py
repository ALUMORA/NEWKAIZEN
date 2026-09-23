"""Indicadores macro de EE. UU. del legado: tasas del Tesoro (FRED), VIX (CBOE) y DXY (Stooq).

Movido sin cambios desde backend.py (fase S1): los cuerpos son idénticos al legado y los
goldens de tests/goldens_legacy lo prueban. La versión v2 se escribe al lado, no encima.
"""

import datetime as _dt
from concurrent.futures import ThreadPoolExecutor

import yfinance as yf

from kaizen_api.cache import _cached
from kaizen_api.domain.markets import _bulk_download, get_market
from kaizen_api.errors import ApiError
from kaizen_api.provenance import utc_now
from kaizen_api.providers import fred
from kaizen_api.providers.fred import _fred_rate
from kaizen_api.providers.yahoo.session import _session


def _cboe_vix():
    """VIX desde el CSV público de CBOE: funciona desde cloud."""
    try:
        resp = _session.get(
            "https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv",
            timeout=8
        )
        for line in reversed(resp.text.strip().split("\n")[1:]):
            parts = line.split(",")
            if len(parts) >= 5 and parts[4].strip():
                return float(parts[4].strip())
    except Exception:
        pass
    return None


def _stooq_dxy():
    """DXY desde Stooq (CSV público, no requiere auth)."""
    try:
        resp = _session.get("https://stooq.com/q/d/l/?s=dxy.fo&i=d", timeout=8)
        lines = [l for l in resp.text.strip().split("\n") if l and not l.lower().startswith("date")]
        for line in reversed(lines):
            parts = line.split(",")
            if len(parts) >= 5 and parts[4].strip():
                return float(parts[4].strip())
    except Exception:
        pass
    return None


def _make_entry(value, prev=None):
    chg = round(value - prev, 4) if prev is not None else 0
    return {"value": round(value, 4), "change": chg}


def _get_macro_fresh() -> dict:
    results = {}

    # ── FRED como fuente PRIMARIA para tasas (API pública de la Fed, sin restricciones) ──
    def _fred_entry(series):
        v = _fred_rate(series)
        return {"value": round(v, 2), "change": 0} if v is not None else None

    with ThreadPoolExecutor(max_workers=4) as ex:
        f10  = ex.submit(_fred_entry, "DGS10")
        f2   = ex.submit(_fred_entry, "DGS2")
        fvix = ex.submit(_cboe_vix)
        fdxy = ex.submit(_stooq_dxy)

    v10 = f10.result(); v2 = f2.result()
    if v10: results["t10y"] = v10
    if v2:  results["t2y"]  = v2
    raw_vix = fvix.result()
    if raw_vix is not None: results["vix"] = {"value": round(raw_vix, 2), "change": 0}
    raw_dxy = fdxy.result()
    if raw_dxy is not None: results["dxy"] = {"value": round(raw_dxy, 2), "change": 0}

    # ── Fallback Yahoo Finance (bulk) para lo que siga faltando ──
    missing = {}
    if "vix"  not in results: missing["^VIX"]    = "vix"
    if "t10y" not in results: missing["^TNX"]    = "t10y"
    # Sin fallback para t2y: ^IRX es el bono de 13 semanas, no el de 2 años, y daba un spread falso.
    if "dxy"  not in results: missing["DX-Y.NYB"] = "dxy"
    if missing:
        bulk = _bulk_download(missing)
        for k, v in bulk.items():
            if v is not None and k not in results:
                results[k] = v

    # ── VIX desde market cache como último recurso ──
    if "vix" not in results:
        try:
            mkt = get_market()
            if mkt.get("vix"):
                results["vix"] = mkt["vix"]
        except Exception:
            pass

    # Spread 10Y - 2Y
    try:
        t10 = results.get("t10y") or {}
        t2  = results.get("t2y")  or {}
        if t10.get("value") and t2.get("value"):
            spread = round(t10["value"] - t2["value"], 2)  # ambos vienen de FRED en puntos porcentuales
            results["spread"] = {"value": spread, "inverted": spread < 0}
    except Exception:
        results["spread"] = None

    return results


def get_macro() -> dict:
    """VIX, spread 10Y-2Y, DXY: indicadores macro clave. Cacheado 5 min."""
    return _cached("macro", _get_macro_fresh, ttl=300, ok=bool)  # vacío = todas las fuentes fallaron


# ─── v2: Tesoro, diferenciales en pb, VIX, DXY y Fed Funds ───────────────────
#
# Lo de arriba es el legado (valores en puntos porcentuales, sin fecha, con el DXY de Stooq que
# siempre falla) y se queda para v1. Aquí las tasas van como fracción, los diferenciales en puntos
# base, todo trae fecha y previo, y el DXY sale de Yahoo.

CBOE_VIX_URL = "https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv"
DXY_SYMBOL = "DX-Y.NYB"

UST_SPEC = (
    ("ust3m", "Tesoro EE. UU. 3 meses", "DGS3MO"),
    ("ust2y", "Tesoro EE. UU. 2 años", "DGS2"),
    ("ust10y", "Tesoro EE. UU. 10 años", "DGS10"),
)
SPREAD_SPEC = (
    ("spread10y2y", "Diferencial 10 años menos 2 años", "ust10y", "ust2y"),
    ("spread10y3m", "Diferencial 10 años menos 3 meses", "ust10y", "ust3m"),
)
FED_FUNDS_SERIES = "DFF"
VIX_FRED_SERIES = "VIXCLS"

PLAUSIBLE = {
    "ust3m": (-0.01, 0.25),
    "ust2y": (-0.01, 0.25),
    "ust10y": (-0.01, 0.25),
    "fedFunds": (-0.01, 0.25),
    "vix": (5.0, 150.0),
    "dxy": (60.0, 160.0),
}
"""Banda de cordura del último valor, en la unidad del contrato (tasas como fracción, niveles tal cual).

Si FRED cambia la unidad de una serie o Yahoo devuelve otra cosa, el renglón no se publica y la
razón queda en ``meta.notes``, en vez de salir un 450 % o un DXY de 1.
"""


def _implausible(entry: dict, series_id: str) -> str | None:
    band = PLAUSIBLE.get(entry["id"])
    if band is None or band[0] <= entry["value"] <= band[1]:
        return None
    return (
        f"No se publicó {entry['label']} ({series_id}): el último dato salió en {entry['value']:g},"
        f" fuera del rango creíble de {band[0]:g} a {band[1]:g}."
    )


MAX_AGE_DAYS = 7
"""Más de una semana sin dato nuevo en una serie diaria: se marca ``stale``."""


def _stale(as_of: str | None) -> bool:
    if not as_of:
        return True
    try:
        day = _dt.date.fromisoformat(as_of[:10])
    except ValueError:
        return True
    return (utc_now().date() - day).days > MAX_AGE_DAYS


def parse_cboe_csv(text: str, tail: int = 10) -> dict[str, list]:
    """CSV de CBOE (``DATE,OPEN,HIGH,LOW,CLOSE`` con fechas MM/DD/YYYY) a ``{"dates", "values"}``."""
    dates: list[str] = []
    values: list[float] = []
    lines = [line for line in (text or "").strip().splitlines() if line.strip()][1:]
    for line in lines[-max(tail, 2) :]:
        parts = line.split(",")
        if len(parts) < 5:
            continue
        try:
            day = _dt.datetime.strptime(parts[0].strip(), "%m/%d/%Y").date().isoformat()
            close = float(parts[4].strip())
        except ValueError:
            continue
        dates.append(day)
        values.append(close)
    return {"dates": dates, "values": values}


def _cboe_vix_series() -> dict[str, list]:
    def fetch() -> dict[str, list]:
        try:
            resp = _session.get(CBOE_VIX_URL, timeout=10)
        except Exception:
            return {"dates": [], "values": []}
        if getattr(resp, "status_code", 500) >= 400:
            return {"dates": [], "values": []}
        return parse_cboe_csv(resp.text)

    return _cached("macro:vix:cboe", fetch, ttl=1800, ok=lambda r: bool(r["dates"]))


def _yahoo_close_series(symbol: str) -> dict[str, list]:
    """Cierres con fecha de un símbolo de Yahoo, con los mismos argumentos que usa el bajado en lote.

    ``domain.markets._bulk_download`` (costura de B2a) tira el índice de fechas y aquí la fecha es
    obligatoria (``UsMacroItem.asOf``), así que se llama a ``yf.download`` con exactamente los mismos
    parámetros: es la MISMA llave de fixture (``yf.download:[DX-Y.NYB]?period=5d``), no una llamada
    de más a Yahoo.
    """

    def fetch() -> dict[str, list]:
        try:
            raw = yf.download([symbol], period="5d", interval="1d", progress=False, auto_adjust=True)
        except Exception:
            return {"dates": [], "values": []}
        if raw is None or getattr(raw, "empty", True):
            return {"dates": [], "values": []}
        try:
            close = raw["Close"]
            if hasattr(close, "columns"):
                close = close[symbol]
            close = close.dropna()
            dates = [d.date().isoformat() if hasattr(d, "date") else str(d)[:10] for d in close.index]
            return {"dates": dates, "values": [float(v) for v in close.to_numpy()]}
        except Exception:
            return {"dates": [], "values": []}

    return _cached(f"macro:yahoo:{symbol}", fetch, ttl=600, ok=lambda r: bool(r["dates"]))


DECIMALS = {"fraction": 6, "bp": 2, "index": 2}
"""Decimales por unidad. El DXY llega de Yahoo como float32 (100.53800201416016): publicarlo así
sugiere una precisión que el dato no tiene, y además ensucia cualquier comparación."""


def _entry(item_id: str, label: str, unit: str, source: str, dates, values, scale: float = 1.0) -> dict:
    nd = DECIMALS.get(unit, 4)
    value = round(values[-1] * scale, nd)
    previous = round(values[-2] * scale, nd) if len(values) >= 2 else None
    change = round(value - previous, nd) if previous is not None else None
    change_bp = round(change * 10_000, 2) if (change is not None and unit == "fraction") else None
    if unit == "bp" and change is not None:
        change_bp = round(change, 2)
    return {
        "id": item_id,
        "label": label,
        "value": value,
        "previous": previous,
        "change": change,
        "changeBp": change_bp,
        "unit": unit,
        "asOf": dates[-1],
        "source": source,
    }


def _aligned_tail(a: dict[str, list], b: dict[str, list], count: int = 2) -> tuple[list[str], list[float], list[float]]:
    """Las últimas ``count`` fechas que las dos series tienen en común, con sus valores.

    Sin esto, un diferencial mezcla el 10 años de ayer con el de 2 años de anteayer cuando una de
    las dos publicó tarde, y el resultado son puntos base inventados.
    """
    index_b = dict(zip(b["dates"], b["values"], strict=True))
    dates: list[str] = []
    left: list[float] = []
    right: list[float] = []
    for date, value in zip(a["dates"], a["values"], strict=True):
        if date in index_b:
            dates.append(date)
            left.append(value)
            right.append(index_b[date])
    return dates[-count:], left[-count:], right[-count:]


def _append_plausible(items: list[dict], notes: list[str], entry: dict, series_id: str) -> None:
    reason = _implausible(entry, series_id)
    if reason:
        notes.append(reason)
    else:
        items.append(entry)


def get_us_macro() -> dict:
    """``/v2/macro/us``: ``{"items", "source", "asOf", "stale", "fallback", "notes"}``.

    Tasas del Tesoro y Fed Funds como fracción, diferenciales en puntos base, VIX y DXY como nivel.
    Cada renglón trae su previo y su cambio. Si no se pudo armar ni un renglón, levanta 503.
    """
    notes: list[str] = []
    fallback = False
    items: list[dict] = []
    curves: dict[str, dict[str, list]] = {}
    for item_id, label, series_id in UST_SPEC:
        serie = fred.fetch_series(series_id)
        if not serie["values"]:
            notes.append(f"FRED no devolvió la serie {series_id}.")
            continue
        entry = _entry(item_id, label, "fraction", "fred", serie["dates"], serie["values"], 0.01)
        reason = _implausible(entry, series_id)
        if reason:
            notes.append(reason)
            continue
        curves[item_id] = serie
        items.append(entry)
    for item_id, label, long_id, short_id in SPREAD_SPEC:
        long_serie, short_serie = curves.get(long_id), curves.get(short_id)
        if not long_serie or not short_serie:
            continue
        dates, longs, shorts = _aligned_tail(long_serie, short_serie)
        if not dates:
            notes.append(f"{label}: las dos series no coinciden en ninguna fecha reciente.")
            continue
        spread = [round((a - b) * 100, 4) for a, b in zip(longs, shorts, strict=True)]
        items.append(_entry(item_id, label, "bp", "fred", dates, spread))
    vix = _cboe_vix_series()
    vix_source = "cboe"
    if not vix["values"]:
        vix = fred.fetch_series(VIX_FRED_SERIES)
        vix_source = "fred"
        if vix["values"]:
            fallback = True
            notes.append("El VIX salió de FRED (VIXCLS) porque CBOE no respondió.")
    if vix["values"]:
        _append_plausible(items, notes, _entry("vix", "VIX (volatilidad implícita del S&P 500)", "index",
                                               vix_source, vix["dates"], vix["values"]),
                          "VIX_History" if vix_source == "cboe" else VIX_FRED_SERIES)
    else:
        notes.append("Ni CBOE ni FRED devolvieron el VIX.")
    dxy = _yahoo_close_series(DXY_SYMBOL)
    if dxy["values"]:
        _append_plausible(items, notes, _entry("dxy", "Índice del dólar (DXY)", "index", "yahoo", dxy["dates"],
                                               dxy["values"]), DXY_SYMBOL)
    else:
        notes.append("Yahoo no devolvió el índice del dólar.")
    funds = fred.fetch_series(FED_FUNDS_SERIES)
    if funds["values"]:
        _append_plausible(items, notes, _entry("fedFunds", "Tasa efectiva de fondos federales", "fraction", "fred",
                                               funds["dates"], funds["values"], 0.01), FED_FUNDS_SERIES)
    else:
        notes.append(f"FRED no devolvió la serie {FED_FUNDS_SERIES}.")
    if not items:
        raise ApiError(503, "UPSTREAM_UNAVAILABLE", "No se pudo leer ningún indicador de EE. UU. Intenta más tarde.")
    order = {"ust3m": 0, "ust2y": 1, "ust10y": 2, "spread10y2y": 3, "spread10y3m": 4, "vix": 5, "dxy": 6,
             "fedFunds": 7}
    items.sort(key=lambda it: order.get(it["id"], len(order)))
    as_of = max(it["asOf"] for it in items)
    return {
        "items": items,
        "source": ",".join(sorted({it["source"] for it in items})),
        "asOf": as_of,
        "stale": any(_stale(it["asOf"]) for it in items),
        "fallback": fallback,
        "notes": notes,
    }
