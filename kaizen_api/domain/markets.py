"""Mercados: índices, divisas, materias primas, cripto y el mapa mundial por ETF de país.

Movido sin cambios desde backend.py (fase S1): los cuerpos son idénticos al legado y los
goldens de tests/goldens_legacy lo prueban. La versión v2 se escribe al lado, no encima.
"""

from concurrent.futures import ThreadPoolExecutor

import yfinance as yf

from kaizen_api.cache import _cached
from kaizen_api.domain.history import _fetch_hist

_MARKET_SYMS = {
    "sp500":  "^GSPC",  "nasdaq": "^IXIC",  "dow":    "^DJI",
    "ipc":    "^MXX",   "nikkei": "^N225",   "ftse":   "^FTSE",
    "dax":    "^GDAXI", "cac":    "^FCHI",   "hsi":    "^HSI",
    "usdmxn": "USDMXN=X", "eurusd": "EURUSD=X", "eurmxn": "EURMXN=X",
    "gbpusd": "GBPUSD=X", "usdjpy": "USDJPY=X",
    "wti":    "CL=F",   "brent":  "BZ=F",    "gold":   "GC=F",
    "silver": "SI=F",   "copper": "HG=F",    "natgas": "NG=F",
    "btc":    "BTC-USD", "eth":   "ETH-USD",
    "vix":    "^VIX",   "dxy":   "DX-Y.NYB", "t10y":  "^TNX",
    "sb_lv": "IVE",  "sb_lb": "IVV",  "sb_lg": "IVW",
    "sb_mv": "IJJ",  "sb_mb": "IJH",  "sb_mg": "IJK",
    "sb_sv": "IJS",  "sb_sb": "IJR",  "sb_sg": "IJT",
}


def _bulk_download(sym_to_key: dict, period: str = "5d") -> dict:
    """
    Descarga todos los símbolos en UNA sola llamada yf.download().
    Mucho menos propenso a rate-limiting que múltiples requests individuales.
    """
    results = {}
    syms = list(sym_to_key.keys())
    try:
        raw = yf.download(
            syms, period=period, interval="1d",
            progress=False, auto_adjust=True,
        )
        if raw is None or raw.empty:
            raise ValueError("empty")
        # Con múltiples tickers, columns es MultiIndex (Price, Ticker)
        closes = raw["Close"] if "Close" in raw.columns.get_level_values(0) else raw
        for sym, key in sym_to_key.items():
            try:
                col = closes[sym].dropna()
                if len(col) >= 1:
                    val  = float(col.iloc[-1])
                    prev = float(col.iloc[-2]) if len(col) >= 2 else val
                    chg  = round(val - prev, 4)
                    pct_v = round((chg / prev) * 100, 2) if prev != 0 else 0
                    results[key] = {"value": round(val, 4), "change": chg, "change_pct": pct_v}
            except Exception:
                pass
    except Exception:
        pass

    # Fallback individual para símbolos que fallaron
    missing = {s: k for s, k in sym_to_key.items() if k not in results}
    if missing:
        def _fetch_one(args):
            sym, key = args
            try:
                hist = _fetch_hist(sym)
                if hist is not None and not hist.empty:
                    val  = float(hist["Close"].iloc[-1])
                    prev = float(hist["Close"].iloc[-2]) if len(hist) >= 2 else val
                    chg  = round(val - prev, 4)
                    pct_v = round((chg / prev) * 100, 2) if prev != 0 else 0
                    return key, {"value": round(val, 4), "change": chg, "change_pct": pct_v}
            except Exception:
                pass
            return key, None
        with ThreadPoolExecutor(max_workers=4) as ex:
            for key, val in ex.map(_fetch_one, missing.items()):
                if val is not None:
                    results[key] = val

    return results


def _get_market_fresh() -> dict:
    sym_to_key = {v: k for k, v in _MARKET_SYMS.items()}
    return _bulk_download(sym_to_key)

def get_market() -> dict:
    """Mercados globales: índices, divisas, commodities, crypto. Cacheado 2 min."""
    return _cached("market", _get_market_fresh, ttl=120, ok=bool)


_WORLDMAP_SYMS = {
    "SPY":  "840", "EWC": "124", "EWW": "484", "EWZ": "076",
    "ECH":  "152", "EWU": "826", "EWG": "276", "EWQ": "250",
    "EWI":  "380", "EWP": "724", "EWN": "528", "EWL": "756",
    "EWD":  "752", "EWO": "040", "EWJ": "392", "FXI": "156",
    "EWA":  "036", "INDA":"356", "EWY": "410", "EWT": "158",
    "EWH":  "344", "EWS": "702", "EZA": "710", "KSA": "682",
    "TUR":  "792", "EPOL":"616",
}

def _get_worldmap_fresh() -> dict:
    sym_to_key = _WORLDMAP_SYMS
    raw = _bulk_download(sym_to_key)
    # _bulk_download retorna {key: {...}} donde key es el valor del mapa (country_id)
    return raw

def get_worldmap() -> dict:
    """ETFs de países para el mapa mundial de desempeño. Cacheado 5 min."""
    return _cached("worldmap", _get_worldmap_fresh, ttl=300, ok=bool)
