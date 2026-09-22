"""Indicadores macro de EE. UU. del legado: tasas del Tesoro (FRED), VIX (CBOE) y DXY (Stooq).

Movido sin cambios desde backend.py (fase S1): los cuerpos son idénticos al legado y los
goldens de tests/goldens_legacy lo prueban. La versión v2 se escribe al lado, no encima.
"""

from concurrent.futures import ThreadPoolExecutor

from kaizen_api.cache import _cached
from kaizen_api.domain.markets import _bulk_download, get_market
from kaizen_api.providers.fred import _fred_rate
from kaizen_api.providers.yahoo.session import _session


def _cboe_vix():
    """VIX desde el CSV público de CBOE — funciona desde cloud."""
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
    """VIX, spread 10Y-2Y, DXY — indicadores macro clave. Cacheado 5 min."""
    return _cached("macro", _get_macro_fresh, ttl=300, ok=bool)  # vacío = todas las fuentes fallaron
