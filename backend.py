#!/usr/bin/env python3
"""
MOMENTUM Backend — Servidor local de datos financieros
Usa yfinance para obtener datos sin problemas de CORS.

Instalar dependencias: pip install yfinance
Correr: python backend.py
"""

from http.server import HTTPServer, BaseHTTPRequestHandler
import json, math, time, requests, threading, os
from concurrent.futures import ThreadPoolExecutor
import yfinance as yf
from urllib.parse import urlparse, parse_qs

# Sesión con headers de navegador para evitar bloqueos de Yahoo Finance en cloud
_session = requests.Session()
_session.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
})

def yft(ticker: str):
    """Crea un Ticker con sesión custom para evitar bloqueos de Yahoo en cloud."""
    return yf.Ticker(ticker, session=_session)

# ─── Cache en memoria con TTL ─────────────────────────────────────────────────
_cache: dict = {}
_cache_lock = threading.Lock()

def _cached(key: str, fn, ttl: int = 300):
    now = time.time()
    with _cache_lock:
        if key in _cache:
            val, ts = _cache[key]
            if now - ts < ttl:
                return val
    result = fn()
    with _cache_lock:
        _cache[key] = (result, now)
    return result

# ─── Helper robusto para histórico ───────────────────────────────────────────
def _fetch_hist(sym: str, period: str = "5d", interval: str = "1d"):
    """Intenta obtener histórico con múltiples estrategias."""
    # Estrategia 1: yft().history() con sesión custom (2 intentos)
    for attempt in range(2):
        try:
            hist = yft(sym).history(period=period, interval=interval)
            if hist is not None and not hist.empty:
                return hist
        except Exception:
            pass
        if attempt == 0:
            time.sleep(1.5)
    # Estrategia 2: yf.download() usa endpoint distinto de Yahoo
    try:
        hist = yf.download(
            sym, period=period, interval=interval,
            progress=False, auto_adjust=True,
        )
        if hist is not None and not hist.empty:
            # Aplanar MultiIndex si lo hay (ocurre con múltiples tickers)
            if hasattr(hist.columns, "levels"):
                hist.columns = hist.columns.get_level_values(0)
            return hist
    except Exception:
        pass
    return None

PORT = 8002

SECTOR_ETF = {
    "Technology": "XLK", "Healthcare": "XLV", "Financial Services": "XLF",
    "Financials": "XLF", "Energy": "XLE", "Consumer Cyclical": "XLY",
    "Consumer Defensive": "XLP", "Industrials": "XLI", "Materials": "XLB",
    "Real Estate": "XLRE", "Utilities": "XLU", "Communication Services": "XLC",
    "Basic Materials": "XLB",
}


def safe(v):
    if v is None: return None
    try:
        f = float(v)
        return None if (math.isnan(f) or math.isinf(f)) else f
    except Exception:
        return None

def pct(v):
    s = safe(v)
    return round(s * 100, 2) if s is not None else None

def r2(v):
    s = safe(v)
    return round(s, 2) if s is not None else None

def _debt_to_assets(info):
    de = safe(info.get("debtToEquity"))
    if not de: return None
    r = de / 100.0
    return round(r / (1 + r) * 100, 1)

def _leverage_ratio(info):
    de = safe(info.get("debtToEquity"))
    if not de: return None
    return round(1 + de / 100.0, 2)


def get_stock(ticker: str) -> dict:
    t = yft(ticker)
    info = {}

    # 1) Intentar .info (puede ser lento o None en cloud)
    for attempt in range(2):
        try:
            result = t.info
            if result and isinstance(result, dict) and len(result) > 5:
                info = result
                break
        except Exception:
            pass
        time.sleep(2)

    # 2) Precio robusto con múltiples fallbacks
    price = safe(info.get("currentPrice") or info.get("regularMarketPrice"))
    if price is None:
        try:
            fi = t.fast_info
            price = safe(getattr(fi, "last_price", None) or getattr(fi, "regularMarketPrice", None))
        except Exception:
            pass
    if price is None:
        try:
            hist = t.history(period="5d")
            if not hist.empty:
                price = round(float(hist["Close"].iloc[-1]), 2)
        except Exception:
            pass

    # 3) Nombre desde fast_info si info está vacío
    name = info.get("shortName") or info.get("longName")
    if not name:
        try:
            name = getattr(t.fast_info, "name", None) or ticker
        except Exception:
            name = ticker

    # 4) Financials desde DataFrames de yfinance (más confiables que .info)
    total_revenue = safe(info.get("totalRevenue"))
    net_income    = safe(info.get("netIncomeToCommon"))
    total_assets  = safe(info.get("totalAssets"))
    total_debt    = safe(info.get("totalDebt"))
    op_cashflow   = safe(info.get("operatingCashflow"))
    free_cashflow = safe(info.get("freeCashflow"))

    # Variables que se poblan desde estados financieros
    equity = None
    inc = bal = None  # guardadas para reusar en cálculos posteriores

    # Intentar estados financieros para métricas que .info no pudo dar
    try:
        fin = t.financials
        if fin is not None and not fin.empty:
            for row in ["Total Revenue", "totalRevenue"]:
                if row in fin.index and total_revenue is None:
                    total_revenue = safe(float(fin.loc[row].iloc[0]))
                    break
        inc = t.income_stmt
        if inc is not None and not inc.empty and net_income is None:
            for row in ["Net Income", "netIncome", "Net Income Common Stockholders"]:
                if row in inc.index:
                    net_income = safe(float(inc.loc[row].iloc[0]))
                    break
        bal = t.balance_sheet
        if bal is not None and not bal.empty:
            for row in ["Total Assets", "totalAssets"]:
                if row in bal.index and total_assets is None:
                    total_assets = safe(float(bal.loc[row].iloc[0]))
                    break
            for row in ["Total Debt", "totalDebt", "Long Term Debt"]:
                if row in bal.index and total_debt is None:
                    total_debt = safe(float(bal.loc[row].iloc[0]))
                    break
            # Equity para calcular ROE, D/E, P/B
            for row in ["Stockholders Equity", "Common Stock Equity",
                        "Total Equity Gross Minority Interest", "stockholdersEquity"]:
                if row in bal.index:
                    equity = safe(float(bal.loc[row].iloc[0]))
                    break
        cf = t.cashflow
        if cf is not None and not cf.empty:
            for row in ["Operating Cash Flow", "operatingCashflow"]:
                if row in cf.index and op_cashflow is None:
                    op_cashflow = safe(float(cf.loc[row].iloc[0]))
                    break
            for row in ["Free Cash Flow", "freeCashflow"]:
                if row in cf.index and free_cashflow is None:
                    free_cashflow = safe(float(cf.loc[row].iloc[0]))
                    break
    except Exception:
        pass

    # Obtener shares para cálculos
    shares_out = safe(info.get("sharesOutstanding"))
    if shares_out is None:
        try:
            shares_out = safe(getattr(t.fast_info, "shares", None))
        except Exception:
            pass

    # Métricas calculadas como fallback cuando .info está vacío
    roe_val    = pct(info.get("returnOnEquity"))
    margin_val = pct(info.get("profitMargins"))
    de_val     = r2(safe(info.get("debtToEquity")))
    beta_val   = r2(safe(info.get("beta")))
    market_cap = safe(info.get("marketCap"))
    pb_val     = r2(safe(info.get("priceToBook")))
    eps_val    = r2(safe(info.get("trailingEps")))

    if roe_val is None and net_income is not None and equity is not None and equity > 0:
        roe_val = round((net_income / equity) * 100, 2)
    if margin_val is None and net_income is not None and total_revenue is not None and total_revenue > 0:
        margin_val = round((net_income / total_revenue) * 100, 2)
    if de_val is None and total_debt is not None and equity is not None and equity > 0:
        de_val = round((total_debt / equity) * 100, 2)
    if market_cap is None:
        try:
            market_cap = safe(getattr(t.fast_info, "market_cap", None))
        except Exception:
            pass
    # P/B desde equity y shares
    if pb_val is None and equity is not None and shares_out and shares_out > 0 and price:
        bvps = equity / shares_out
        if bvps > 0:
            pb_val = round(price / bvps, 2)

    # EPS y P/E desde net income y shares
    if eps_val is None and net_income is not None and shares_out and shares_out > 0:
        eps_val = round(net_income / shares_out, 4)
    pe = r2(safe(info.get("trailingPE")))
    if pe is None and eps_val is not None and eps_val > 0 and price is not None:
        pe = round(price / eps_val, 2)

    # EV/EBITDA desde estados financieros
    ev_ebitda = r2(safe(info.get("enterpriseToEbitda")))
    if ev_ebitda is None:
        try:
            # EV = MarketCap + Deuda - Caja
            cash = safe(info.get("totalCash"))
            if cash is None and bal is not None and not bal.empty:
                for row in ["Cash And Cash Equivalents", "Cash Cash Equivalents And Short Term Investments",
                            "Cash Financial", "Available For Sale Securities"]:
                    if row in bal.index:
                        cash = safe(float(bal.loc[row].iloc[0]))
                        break
            ev_computed = None
            if market_cap and total_debt is not None:
                ev_computed = market_cap + (total_debt or 0) - (cash or 0)
            # EBITDA desde income statement
            ebitda = None
            if inc is not None and not inc.empty:
                for row in ["Normalized EBITDA", "EBITDA", "Ebitda", "Reconciled Depreciation"]:
                    if row in inc.index:
                        v = safe(float(inc.loc[row].iloc[0]))
                        if row in ("Normalized EBITDA", "EBITDA", "Ebitda") and v:
                            ebitda = v
                            break
            if ebitda is None and op_cashflow is not None and total_revenue is not None:
                ebitda = op_cashflow  # proxy: operating CF ≈ EBITDA para estimación
            if ev_computed and ebitda and ebitda > 0 and ev_computed > 0:
                ev_ebitda = round(ev_computed / ebitda, 2)
        except Exception:
            pass

    # BETA desde datos históricos semanales vs SPY
    if beta_val is None:
        try:
            h_stock = _fetch_hist(ticker, period="1y", interval="1wk")
            h_spy   = _fetch_hist("SPY",  period="1y", interval="1wk")
            if h_stock is not None and h_spy is not None and not h_stock.empty and not h_spy.empty:
                sc = h_stock["Close"].dropna().tolist()
                mc = h_spy["Close"].dropna().tolist()
                n  = min(len(sc), len(mc)) - 1
                if n >= 12:
                    sr = [sc[i] / sc[i-1] - 1 for i in range(1, n+1)]
                    mr = [mc[i] / mc[i-1] - 1 for i in range(1, n+1)]
                    sm = sum(sr) / n;  mm = sum(mr) / n
                    cov = sum((sr[i] - sm) * (mr[i] - mm) for i in range(n)) / n
                    var = sum((mr[i] - mm) ** 2 for i in range(n)) / n
                    if var > 0:
                        beta_val = round(cov / var, 2)
        except Exception:
            pass

    # 52-week change desde histórico si .info no lo dio
    price52chg = safe(info.get("52WeekChange"))
    if price52chg is None:
        try:
            h52 = _fetch_hist(ticker, period="1y", interval="1wk")
            if h52 is not None and not h52.empty and len(h52) >= 2:
                first = float(h52["Close"].dropna().iloc[0])
                last  = float(h52["Close"].dropna().iloc[-1])
                if first > 0:
                    price52chg = (last - first) / first
        except Exception:
            pass

    growth_raw = safe(info.get("earningsGrowth") or info.get("earningsQuarterlyGrowth"))
    div_raw    = safe(info.get("dividendYield"))
    growth     = growth_raw * 100 if growth_raw else None
    div_pct    = div_raw  * 100 if div_raw  else None
    peg        = round(pe / growth,             2) if (pe and growth and growth > 0) else None
    pegy       = round(pe / (growth + div_pct), 2) if (pe and growth and growth > 0 and div_pct) else None

    return {
        "name":               name,
        "price":              r2(price),
        "pe":                 pe,
        "eps":                eps_val,
        "peg":                peg,
        "pegy":               pegy,
        "evEbitda":           ev_ebitda,
        "pb":                 pb_val,
        "roe":                roe_val,
        "profitMargin":       margin_val,
        "debtEquity":         de_val,
        "revenueGrowth":      pct(info.get("revenueGrowth")),
        "priceChange52w":     round(price52chg * 100, 2) if price52chg is not None else None,
        "beta":               beta_val,
        "marketCap":          market_cap,
        "dividendYield":      div_raw,
        "pcf":                r2(safe(info.get("priceToFreeCashflow"))),
        "debtToAssets":       _debt_to_assets(info),
        "leverageRatio":      _leverage_ratio(info),
        "sector":             info.get("sector"),
        "totalRevenue":       total_revenue,
        "netIncomeToCommon":  net_income,
        "totalAssets":        total_assets,
        "totalDebt":          total_debt,
        "operatingCashflow":  op_cashflow,
        "freeCashflow":       free_cashflow,
    }


def get_chart(ticker: str, period: str = "5y") -> dict:
    period_interval = {
        "1mo": ("1mo", "1d"),
        "3mo": ("3mo", "1d"),
        "6mo": ("6mo", "1wk"),
        "1y":  ("1y",  "1wk"),
        "2y":  ("2y",  "1wk"),
        "5y":  ("5y",  "1wk"),
        "10y": ("10y", "1wk"),
    }
    yf_period, interval = period_interval.get(period, ("1y", "1wk"))
    hist = yft(ticker).history(period=yf_period, interval=interval)
    closes = [round(float(v), 4) for v in hist["Close"].tolist() if not math.isnan(float(v))]
    return {"closes": closes, "period": period, "bars": len(closes)}


def _fred_rate(series_id: str):
    """Obtiene la tasa más reciente de FRED (API pública de la Reserva Federal)."""
    try:
        resp = _session.get(
            f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}",
            timeout=8
        )
        for line in reversed(resp.text.strip().split("\n")[1:]):
            parts = line.split(",")
            if len(parts) == 2 and parts[1].strip() not in (".", ""):
                return float(parts[1].strip())
    except Exception:
        pass
    return None


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
    if "t2y"  not in results: missing["^IRX"]    = "t2y"
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
            spread = round(t10["value"] - t2["value"] / 10, 2)
            results["spread"] = {"value": spread, "inverted": spread < 0}
    except Exception:
        results["spread"] = None

    return results

def get_macro() -> dict:
    """VIX, spread 10Y-2Y, DXY — indicadores macro clave. Cacheado 5 min."""
    return _cached("macro", _get_macro_fresh, ttl=300)


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
    return _cached("market", _get_market_fresh, ttl=120)


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
    return _cached("worldmap", _get_worldmap_fresh, ttl=300)


def _rss_news(url: str) -> list:
    """Obtiene noticias de un feed RSS público (no requiere auth)."""
    items = []
    try:
        resp = _session.get(url, timeout=6)
        text = resp.text
        import re as _re
        entries = _re.findall(r"<item>(.*?)</item>", text, _re.DOTALL)
        for entry in entries[:8]:
            def _tag(tag, s=entry):
                m = _re.search(rf"<{tag}[^>]*>(.*?)</{tag}>", s, _re.DOTALL)
                return (m.group(1).strip().replace("<![CDATA[","").replace("]]>","") if m else "")
            title = _tag("title")
            link  = _tag("link") or _tag("guid")
            desc  = _tag("description")[:250]
            pub   = _tag("pubDate")
            try:
                from email.utils import parsedate_to_datetime
                ts = int(parsedate_to_datetime(pub).timestamp())
            except Exception:
                ts = 0
            if title:
                items.append({"title": title, "summary": desc, "url": link, "publisher": "Yahoo Finance", "time": ts})
    except Exception:
        pass
    return items


def get_market_news() -> dict:
    """Noticias de mercados — intenta yfinance y luego RSS como fallback."""
    seen, all_news = set(), []

    # Primario: yfinance .news (puede fallar en cloud)
    tickers = ["^MXX", "^GSPC", "USDMXN=X", "GC=F", "CL=F", "BTC-USD"]
    for ticker in tickers:
        try:
            raw = yft(ticker).news or []
            for item in raw[:10]:
                parsed = _extract_news_item(item)
                if not parsed["title"] or parsed["url"] in seen:
                    continue
                seen.add(parsed["url"])
                parsed["sentiment"] = classify_sentiment(parsed["title"] + " " + parsed["summary"])
                all_news.append(parsed)
        except Exception:
            pass

    # Fallback: RSS feeds públicos si yfinance no dio noticias
    if len(all_news) < 5:
        rss_feeds = [
            # Yahoo Finance
            "https://feeds.finance.yahoo.com/rss/2.0/headline?s=%5EGSPC&region=US&lang=en-US",
            "https://feeds.finance.yahoo.com/rss/2.0/headline?s=USDMXN%3DX&region=US&lang=en-US",
            "https://feeds.finance.yahoo.com/rss/2.0/headline?s=GC%3DF&region=US&lang=en-US",
            # MarketWatch
            "https://feeds.content.dowjones.io/public/rss/mw_topstories",
            "https://feeds.content.dowjones.io/public/rss/mw_marketpulse",
            # CNBC
            "https://www.cnbc.com/id/100003114/device/rss/rss.html",
            "https://www.cnbc.com/id/10000664/device/rss/rss.html",
            # Seeking Alpha
            "https://seekingalpha.com/market_currents.xml",
            # Investing.com
            "https://www.investing.com/rss/news.rss",
        ]
        for feed in rss_feeds:
            if len(all_news) >= 20:
                break
            for item in _rss_news(feed):
                if item["url"] not in seen:
                    seen.add(item["url"])
                    item["sentiment"] = classify_sentiment(item["title"] + " " + item["summary"])
                    all_news.append(item)

    all_news.sort(key=lambda x: x.get("time", 0), reverse=True)
    return {"news": all_news[:30]}


def get_dcf(ticker: str) -> dict:
    """
    Valuación relativa por múltiplos sectoriales (Damodaran Jan 2025).

    Principio de moneda: precio y objetivos siempre en la moneda de cotización.
    - Si financialCurrency != currency, los datos por acción (EPS, BVPS, FCF)
      se convierten a la moneda de cotización MULTIPLICANDO por fx_rate.
    - ETFs y fondos mutuos quedan excluidos (no aplican múltiplos de acciones).

    Múltiplos usados (según disponibilidad):
      P/E   → precio_justo = EPS_local × PE_sector
      P/B   → precio_justo = BVPS_local × PB_sector
      P/FCF → precio_justo = FCF_ps_local × PFCF_sector
      EV/EBITDA (solo si < 80x, sanity check)
    """
    # ── Medianas sectoriales (Damodaran Jan 2025) ─────────────────────────
    SECTOR_PE   = {"Technology":28,"Healthcare":22,"Financial Services":12,
                   "Consumer Cyclical":18,"Consumer Defensive":22,
                   "Communication Services":16,"Industrials":20,
                   "Energy":11,"Materials":14,"Real Estate":30,
                   "Utilities":18,"Basic Materials":14}
    SECTOR_PB   = {"Technology":8,"Healthcare":4,"Financial Services":1.4,
                   "Consumer Cyclical":4,"Consumer Defensive":6,
                   "Communication Services":3,"Industrials":4,
                   "Energy":2,"Materials":2,"Real Estate":1.5,
                   "Utilities":1.8,"Basic Materials":2}
    SECTOR_PFCF = {"Technology":30,"Healthcare":25,"Financial Services":14,
                   "Consumer Cyclical":20,"Consumer Defensive":22,
                   "Communication Services":18,"Industrials":22,
                   "Energy":10,"Materials":14,"Real Estate":22,
                   "Utilities":16,"Basic Materials":14}
    SECTOR_EV_EBITDA = {"Technology":22,"Healthcare":18,"Financial Services":14,
                        "Consumer Cyclical":14,"Consumer Defensive":16,
                        "Communication Services":14,"Industrials":13,
                        "Energy":8,"Materials":10,"Real Estate":18,
                        "Utilities":12,"Basic Materials":10}
    try:
        t    = yft(ticker)
        info = t.info

        # ── Detectar ETFs y fondos: múltiplos de acciones no aplican ─────────
        quote_type = (info.get("quoteType") or "").upper()
        if quote_type in ("ETF", "MUTUALFUND", "FUND"):
            price_raw = safe(info.get("currentPrice") or info.get("regularMarketPrice") or info.get("navPrice"))
            return {
                "isETF":         True,
                "error":         "ETF/Fondo — valuación por múltiplos de acciones no aplica",
                "price":         round(price_raw, 2) if price_raw else None,
                "priceCurrency": info.get("currency", "USD"),
                "sector":        info.get("sector") or info.get("category") or "—",
            }

        price_raw = safe(info.get("currentPrice") or info.get("regularMarketPrice"))
        if not price_raw:
            return {"error": "Sin precio"}

        # ── Monedas ───────────────────────────────────────────────────────────
        price_currency     = info.get("currency", "USD") or "USD"
        financial_currency = info.get("financialCurrency", "USD") or "USD"
        fx_rate = 1.0   # multiplicador: 1 financial_currency = fx_rate price_currency
        fx_note = None

        if price_currency != financial_currency:
            pair = f"{financial_currency}{price_currency}=X"
            try:
                fx_hist = yft(pair).history(period="2d")
                if not fx_hist.empty:
                    fx_rate = float(fx_hist["Close"].iloc[-1])
                    fx_note = (f"Financieros en {financial_currency} → {price_currency} "
                               f"(1 {financial_currency} = {fx_rate:.2f} {price_currency})")
            except Exception:
                pass

        # ── Precio en moneda de cotización (sin convertir) ────────────────────
        price  = price_raw

        # ── Sector: override para compañías mal clasificadas por Yahoo ────────
        # Yahoo clasifica Amazon/Meta como Consumer Cyclical/Communication Services
        # pero su negocio principal es tecnología (cloud, ads, plataformas digitales)
        SECTOR_OVERRIDE = {
            # Amazon — AWS domina utilidades; Yahoo dice Consumer Cyclical
            "AMZN": "Technology", "AMZN.MX": "Technology",
            # Meta — plataforma digital/IA; Yahoo dice Communication Services
            "META": "Technology", "META.MX": "Technology",
            # Alphabet/Google — búsqueda + cloud; Yahoo dice Communication Services
            "GOOGL": "Technology", "GOOGL.MX": "Technology",
            "GOOG":  "Technology", "GOOG.MX":  "Technology",
            # Netflix — streaming digital; Yahoo dice Communication Services
            "NFLX": "Communication Services", "NFLX.MX": "Communication Services",
            # Tesla — Yahoo dice Consumer Cyclical pero es tech + auto
            "TSLA": "Technology", "TSLA.MX": "Technology",
            # Berkshire — conglomerado financiero
            "BRK-B": "Financial Services", "BRK.B.MX": "Financial Services",
        }
        ticker_upper = ticker.upper()
        sector = SECTOR_OVERRIDE.get(ticker_upper) or info.get("sector") or ""
        sector_note = f"Sector ajustado a '{sector}'" if ticker_upper in SECTOR_OVERRIDE else None
        shares = safe(info.get("sharesOutstanding")) or 1

        # ── Datos por acción ──────────────────────────────────────────────────
        # Yahoo ya devuelve trailingEps y bookValue en la moneda de cotización
        # (price_currency). Son ratios por acción normalizados al precio local.
        # → NO aplicar conversión de moneda.
        eps  = safe(info.get("trailingEps"))
        bvps = safe(info.get("bookValue"))

        # Las métricas AGREGADAS (FCF total, EV, cash, debt) sí vienen en
        # financialCurrency → multiplicar por fx_rate para llevarlas a price_currency.
        fcf_fin = safe(info.get("freeCashflow"))
        fcf     = (fcf_fin * fx_rate) if (fcf_fin is not None and fx_rate != 1.0) else fcf_fin
        fcf_ps  = (fcf / shares) if (fcf and shares > 0) else None

        ev_fin = safe(info.get("enterpriseValue"))
        ev     = (ev_fin * fx_rate) if (ev_fin is not None and fx_rate != 1.0) else ev_fin
        cash_l = (safe(info.get("totalCash")) or 0) * fx_rate
        debt_l = (safe(info.get("totalDebt")) or 0) * fx_rate
        ev_eb  = safe(info.get("enterpriseToEbitda"))  # ratio puro, sin conversión
        net_cash_ps = (cash_l - debt_l) / shares if shares else 0

        pe_fair   = SECTOR_PE.get(sector, 18)
        pb_fair   = SECTOR_PB.get(sector, 3)
        pfcf_fair = SECTOR_PFCF.get(sector, 20)
        eveb_fair = SECTOR_EV_EBITDA.get(sector, 15)

        # ── Precio objetivo por cada múltiplo (todos en price_currency) ───────
        methods = []

        if eps and eps > 0:
            pt = round(eps * pe_fair, 2)
            methods.append({"name": "P/E", "actual": r2(safe(info.get("trailingPE"))),
                            "fair": pe_fair, "target": pt,
                            "signal": "barato" if price < pt * 0.85 else ("caro" if price > pt * 1.15 else "justo")})

        if bvps and bvps > 0:
            pt = round(bvps * pb_fair, 2)
            methods.append({"name": "P/B", "actual": r2(safe(info.get("priceToBook"))),
                            "fair": pb_fair, "target": pt,
                            "signal": "barato" if price < pt * 0.85 else ("caro" if price > pt * 1.15 else "justo")})

        if fcf_ps and fcf_ps > 0:
            pt = round(fcf_ps * pfcf_fair, 2)
            # Calcular P/FCF actual: Yahoo lo omite frecuentemente, lo derivamos
            pfcf_actual = r2(safe(info.get("priceToFreeCashflow"))) or r2(price / fcf_ps)
            methods.append({"name": "P/FCF", "actual": pfcf_actual,
                            "fair": pfcf_fair, "target": pt,
                            "signal": "barato" if price < pt * 0.85 else ("caro" if price > pt * 1.15 else "justo")})

        if ev_eb and 0 < ev_eb < 80 and ev and shares > 0:
            ebitda_total = ev / ev_eb
            ebitda_ps    = ebitda_total / shares
            pt = round(ebitda_ps * eveb_fair + net_cash_ps, 2)
            if pt > 0:
                methods.append({"name": "EV/EBITDA", "actual": r2(ev_eb),
                                "fair": eveb_fair, "target": pt,
                                "signal": "barato" if price < pt * 0.85 else ("caro" if price > pt * 1.15 else "justo")})

        if not methods:
            return {"error": "Sin suficientes datos fundamentales", "sector": sector,
                    "price": round(price, 2), "priceCurrency": price_currency,
                    "financialCurrency": financial_currency, "fxNote": fx_note}

        # ── Precio justo compuesto (promedio de objetivos) ────────────────────
        fair_price = round(sum(m["target"] for m in methods) / len(methods), 2)
        margin     = round((fair_price - price) / fair_price * 100, 1)

        # Señal global: mayoría de métodos
        signals = [m["signal"] for m in methods]
        n_cheap = signals.count("barato")
        n_exp   = signals.count("caro")
        if n_cheap > len(signals) / 2:       overall = "INFRAVALORADO"
        elif n_exp  > len(signals) / 2:      overall = "SOBREVALORADO"
        elif margin > 15:                     overall = "INFRAVALORADO"
        elif margin < -15:                    overall = "SOBREVALORADO"
        else:                                 overall = "PRECIO JUSTO"

        return {
            "price":             round(price, 2),
            "priceCurrency":     price_currency,
            "financialCurrency": financial_currency,
            "fxRate":            round(fx_rate, 4),
            "fxNote":            fx_note,
            "fairPrice":         fair_price,
            "margin":            margin,
            "overall":           overall,
            "methods":           methods,
            "sector":            sector,
            "sectorNote":        sector_note,
            "nMethods":          len(methods),
        }
    except Exception as e:
        return {"error": str(e)}


# ─── Magic Formula Universe — 60 tickers curados, ~15s con 12 workers ─────────
MAGIC_UNIVERSE = [
    # Technology
    "AAPL","MSFT","NVDA","GOOGL","META","AVGO","ORCL","ADBE","CRM","AMD",
    "INTC","QCOM","TXN","NOW","NFLX","IBM","ACN","CTSH","FTNT","CDNS",
    # Healthcare
    "LLY","UNH","JNJ","ABBV","MRK","TMO","ABT","BMY","AMGN","GILD",
    "VRTX","ISRG","MCK","CVS","CI",
    # Consumer Cyclical
    "AMZN","TSLA","HD","MCD","SBUX","NKE","BKNG","TJX","ROST","CMG",
    "LOW","F","GM","ORLY","AZO",
    # Consumer Defensive
    "WMT","COST","PG","KO","PEP","PM","TGT","MO","CL","MDLZ",
    # Industrials
    "CAT","DE","HON","RTX","GE","BA","FDX","UPS","UNP","LMT",
    # Energy
    "XOM","CVX","COP","SLB","OXY","MPC","EOG",
    # Materials
    "LIN","APD","NEM","FCX","SHW",
    # Communication Services
    "DIS","CMCSA","EA","FOXA",
]

EXCLUDED_SECTORS = {
    "Financial Services", "Financials", "Utilities",
    "Real Estate",  # REITs tienen estructura diferente
}


def _fetch_magic_ticker(ticker: str):
    """Datos Magic Formula para un ticker — .info primero, luego income_stmt/balance_sheet."""
    try:
        t = yft(ticker)
        info = {}
        try:
            r = t.info
            if r and isinstance(r, dict) and len(r) > 5:
                info = r
        except Exception:
            pass

        sector = info.get("sector") or ""
        if sector in EXCLUDED_SECTORS:
            return None

        # Market cap
        market_cap = safe(info.get("marketCap"))
        if market_cap is None:
            try:
                fi = t.fast_info
                market_cap = safe(getattr(fi, "market_cap", None))
            except Exception:
                pass
        if not market_cap or market_cap < 50_000_000:
            return None

        ebit       = safe(info.get("ebit"))
        ev         = safe(info.get("enterpriseValue"))
        ca         = safe(info.get("totalCurrentAssets"))
        cl         = safe(info.get("totalCurrentLiabilities"))
        ppe        = safe(info.get("netPPE") or info.get("propertyPlantEquipmentNet"))
        total_debt = safe(info.get("totalDebt"))
        total_cash = safe(info.get("totalCash"))

        # Fallback: estados financieros cuando .info está bloqueado
        if any(v is None for v in [ebit, ca, cl, ppe]):
            try:
                inc = t.income_stmt
                if inc is not None and not inc.empty and ebit is None:
                    for row in ["EBIT", "Ebit", "Operating Income",
                                "Total Operating Income As Reported"]:
                        if row in inc.index:
                            v = safe(float(inc.loc[row].iloc[0]))
                            if v is not None:
                                ebit = v; break
            except Exception:
                pass
            try:
                bal = t.balance_sheet
                if bal is not None and not bal.empty:
                    for row in ["Current Assets", "Total Current Assets"]:
                        if row in bal.index and ca is None:
                            ca = safe(float(bal.loc[row].iloc[0])); break
                    for row in ["Current Liabilities",
                                "Total Current Liabilities Net Minority Interest",
                                "Current Liabilities Net Minority Interest"]:
                        if row in bal.index and cl is None:
                            cl = safe(float(bal.loc[row].iloc[0])); break
                    for row in ["Net PPE", "Net Property Plant And Equipment",
                                "Properties"]:
                        if row in bal.index and ppe is None:
                            ppe = safe(float(bal.loc[row].iloc[0])); break
                    for row in ["Total Debt", "Long Term Debt And Capital Lease Obligation"]:
                        if row in bal.index and total_debt is None:
                            total_debt = safe(float(bal.loc[row].iloc[0])); break
                    for row in ["Cash And Cash Equivalents",
                                "Cash Cash Equivalents And Short Term Investments"]:
                        if row in bal.index and total_cash is None:
                            total_cash = safe(float(bal.loc[row].iloc[0])); break
            except Exception:
                pass

        if ev is None and market_cap:
            ev = market_cap + (total_debt or 0) - (total_cash or 0)

        if not ebit or ebit <= 0 or not ev or ev <= 0:
            return None
        if ca is None or cl is None or ppe is None:
            return None

        nwc = ca - cl
        capital_employed = nwc + ppe
        if capital_employed <= 0:
            return None

        ey  = ebit / ev
        roc = ebit / capital_employed

        price = safe(info.get("currentPrice") or info.get("regularMarketPrice"))
        if price is None:
            try:
                fi = t.fast_info
                price = safe(getattr(fi, "last_price", None))
            except Exception:
                pass

        return {
            "ticker":    ticker,
            "name":      info.get("shortName") or info.get("longName") or ticker,
            "sector":    sector,
            "marketCap": market_cap,
            "price":     round(price, 2) if price else None,
            "ebit":      ebit,
            "ev":        ev,
            "ey":        round(ey  * 100, 2),
            "roc":       round(roc * 100, 2),
            "pe":        r2(safe(info.get("trailingPE"))),
            "pb":        r2(safe(info.get("priceToBook"))),
        }
    except Exception:
        return None


def _get_magic_formula_fresh() -> dict:
    from concurrent.futures import as_completed
    universe = list(dict.fromkeys(MAGIC_UNIVERSE))
    candidates = []
    with ThreadPoolExecutor(max_workers=12) as pool:
        futures = {pool.submit(_fetch_magic_ticker, t): t for t in universe}
        for fut in as_completed(futures, timeout=25):
            try:
                r = fut.result(timeout=8)
                if r is not None:
                    candidates.append(r)
            except Exception:
                pass

    if not candidates:
        return {"stocks": [], "count": 0, "universe": len(universe)}

    sorted_ey  = sorted(candidates, key=lambda x: x["ey"],  reverse=True)
    sorted_roc = sorted(candidates, key=lambda x: x["roc"], reverse=True)
    rank_ey    = {r["ticker"]: i + 1 for i, r in enumerate(sorted_ey)}
    rank_roc   = {r["ticker"]: i + 1 for i, r in enumerate(sorted_roc)}

    for c in candidates:
        c["rank_ey"]    = rank_ey[c["ticker"]]
        c["rank_roc"]   = rank_roc[c["ticker"]]
        c["magic_rank"] = c["rank_ey"] + c["rank_roc"]

    candidates.sort(key=lambda x: x["magic_rank"])
    return {"stocks": candidates[:30], "count": len(candidates), "universe": len(universe)}


def get_magic_formula() -> dict:
    """Fórmula Mágica de Greenblatt — cacheada 12h (no cambia intradía)."""
    return _cached("magic", _get_magic_formula_fresh, ttl=43200)


def get_magic_one(ticker: str) -> dict:
    """
    Calcula EY y ROC para un solo ticker (Fórmula Mágica de Greenblatt).
    Usa campos disponibles en yfinance info + balance_sheet cuando sea posible.

    EY  = EBIT / Enterprise Value
    ROC = EBIT / (Net Working Capital + Net PP&E)

    Fallbacks cuando balance_sheet no está disponible:
      EY  ← 1 / enterpriseToEbitda  (EBITDA yield es proxy confiable)
      ROC ← returnOnAssets * (1 + debtToEquity/100)  (ajuste por apalancamiento)
    """
    try:
        t    = yft(ticker)
        info = t.info

        sector = info.get("sector") or ""
        if sector in EXCLUDED_SECTORS:
            return {"skip": True}

        market_cap = safe(info.get("marketCap"))
        if not market_cap or market_cap < 50_000_000:
            return {"skip": True}

        ev = safe(info.get("enterpriseValue"))
        if not ev or ev <= 0:
            return {"skip": True}

        # ── Earnings Yield ────────────────────────────────────────────────────
        # Intentar EBIT real desde el estado de resultados
        ebit = None
        try:
            inc = t.income_stmt
            if inc is not None and not inc.empty:
                for label in ["EBIT", "Ebit", "Operating Income", "OperatingIncome"]:
                    if label in inc.index:
                        val = safe(float(inc.loc[label].iloc[0]))
                        if val is not None:
                            ebit = val
                            break
        except Exception:
            pass

        # Fallback: EBITDA - D&A aproximado (EBITDA × 0.85 ≈ EBIT para industrials)
        if ebit is None:
            ev_ebitda = safe(info.get("enterpriseToEbitda"))
            ebitda    = safe(info.get("ebitda"))
            if ebitda and ebitda > 0:
                # Si tenemos ambos verificamos consistencia
                ebit = ebitda * 0.85   # conservador
            elif ev_ebitda and ev_ebitda > 0:
                ebit = ev / ev_ebitda * 0.85

        if not ebit or ebit <= 0:
            return {"skip": True}

        ey = ebit / ev

        # ── Return on Capital ─────────────────────────────────────────────────
        # Intentar balance sheet para NWC + PP&E
        roc = None
        try:
            bs = t.balance_sheet
            if bs is not None and not bs.empty:
                def get_bs(names):
                    for n in names:
                        if n in bs.index:
                            v = safe(float(bs.loc[n].iloc[0]))
                            if v is not None:
                                return v
                    return None

                ca  = get_bs(["Current Assets", "Total Current Assets", "CurrentAssets"])
                cl  = get_bs(["Current Liabilities", "Total Current Liabilities", "CurrentLiabilities"])
                ppe = get_bs(["Net PPE", "NetPPE", "Property Plant Equipment Net",
                              "Net Property Plant And Equipment", "PropertyPlantAndEquipmentNet"])
                if ca is not None and cl is not None and ppe is not None:
                    nwc = ca - cl
                    capital = nwc + ppe
                    if capital > 0:
                        roc = ebit / capital
        except Exception:
            pass

        # Fallback: ROA ajustado por apalancamiento
        if roc is None:
            roa = safe(info.get("returnOnAssets"))
            if roa and roa > 0:
                de = safe(info.get("debtToEquity")) or 0
                leverage = 1 + de / 100
                roc = roa * leverage
            else:
                roe = safe(info.get("returnOnEquity"))
                if roe and roe > 0:
                    roc = roe * 0.6   # aproximación conservadora
                else:
                    return {"skip": True}

        if roc <= 0:
            return {"skip": True}

        price = safe(info.get("currentPrice") or info.get("regularMarketPrice"))
        return {
            "ticker":    ticker,
            "name":      info.get("shortName") or info.get("longName") or ticker,
            "sector":    sector,
            "marketCap": market_cap,
            "price":     round(price, 2) if price else None,
            "ey":        round(ey  * 100, 2),
            "roc":       round(roc * 100, 2),
            "pe":        r2(safe(info.get("trailingPE"))),
            "pb":        r2(safe(info.get("priceToBook"))),
        }
    except Exception:
        return {"skip": True}


FIBRAS_LIST = [
    "FUNO11.MX", "FIBRAMQ.MX", "FIBRAPL14.MX", "TERRA13.MX",
    "FINN13.MX",  "DANHOS13.MX", "FMTY14.MX",   "FHIPO14.MX",
    "STORAGE.MX", "LFPE.MX",
]

def get_fibras(extra: str = "") -> dict:
    """
    Screener de FIBRAs mexicanas con métricas de valuación propias de REITs.

    Métricas calculadas:
      Cap Rate  = Ingreso operativo (NOI proxy) / Valor empresa (EV)  × 100
      P/NAV     = Precio / Valor en libros por acción  (≈ priceToBook)
      FFO Yield = Free Cash Flow / Market Cap  × 100  (proxy de FFO)
      Div Yield = Rendimiento por distribución
      LTV       = Deuda total / (Deuda + Market Cap)  × 100

    Señal:
      OPORTUNIDAD  si P/NAV < 0.85  (cotiza con descuento al activo neto)
      PRECIO JUSTO si 0.85 ≤ P/NAV ≤ 1.15
      CARA         si P/NAV > 1.15
    """
    extra_tickers = [t.strip().upper() for t in extra.split(",") if t.strip()] if extra else []
    extra_tickers = [t if "." in t else t + ".MX" for t in extra_tickers]
    tickers = FIBRAS_LIST + [t for t in extra_tickers if t not in FIBRAS_LIST]
    results = []
    for ticker in tickers:
        try:
            t = yft(ticker)

            # Intentar .info con guard (puede retornar None en cloud)
            info = {}
            try:
                result = t.info
                if result and isinstance(result, dict) and len(result) > 5:
                    info = result
            except Exception:
                pass

            # Precio con fallback chain
            price = safe(info.get("currentPrice") or info.get("regularMarketPrice"))
            if price is None:
                try:
                    fi = t.fast_info
                    price = safe(getattr(fi, "last_price", None))
                except Exception:
                    pass
            if price is None:
                hist = _fetch_hist(ticker)
                if hist is not None and not hist.empty:
                    price = round(float(hist["Close"].iloc[-1]), 2)
            if not price:
                continue

            market_cap  = safe(info.get("marketCap"))
            shares      = safe(info.get("sharesOutstanding")) or 0
            op_income   = safe(info.get("operatingIncome") or info.get("ebit"))
            ev          = safe(info.get("enterpriseValue"))
            nav_ps      = safe(info.get("bookValue"))          # NAV/acción en MXN
            p_nav       = safe(info.get("priceToBook"))        # P/NAV directo
            div_yield   = safe(info.get("dividendYield"))
            total_debt  = safe(info.get("totalDebt"))  or 0
            total_cash  = safe(info.get("totalCash"))  or 0
            fcf         = safe(info.get("freeCashflow"))

            # Fallback: fast_info para shares y market_cap
            if market_cap is None or shares == 0:
                try:
                    fi = t.fast_info
                    if market_cap is None:
                        market_cap = safe(getattr(fi, "market_cap", None))
                    if shares == 0:
                        sh = safe(getattr(fi, "shares", None))
                        if sh and sh > 100: shares = sh
                except Exception:
                    pass

            # Fallback: estados financieros para NAV (equity), deuda y FCF
            try:
                bal = t.balance_sheet
                if bal is not None and not bal.empty:
                    for row in ["Stockholders Equity", "Common Stock Equity",
                                "Total Equity Gross Minority Interest"]:
                        if row in bal.index and nav_ps is None and shares > 1:
                            eq = safe(float(bal.loc[row].iloc[0]))
                            if eq and eq > 0:
                                nav_ps = round(eq / shares, 4)
                            break
                    for row in ["Total Debt", "Long Term Debt"]:
                        if row in bal.index and total_debt == 0:
                            total_debt = safe(float(bal.loc[row].iloc[0])) or 0
                            break
            except Exception:
                pass
            try:
                cf = t.cashflow
                if cf is not None and not cf.empty and fcf is None:
                    for row in ["Free Cash Flow", "Operating Cash Flow"]:
                        if row in cf.index:
                            fcf = safe(float(cf.loc[row].iloc[0]))
                            break
                inc = t.income_stmt
                if inc is not None and not inc.empty and op_income is None:
                    for row in ["Operating Income", "EBIT", "Ebit"]:
                        if row in inc.index:
                            op_income = safe(float(inc.loc[row].iloc[0]))
                            break
            except Exception:
                pass
            # market_cap fallback desde precio × shares (solo si shares parece real)
            if market_cap is None and price is not None and shares > 100:
                market_cap = price * shares

            # EV fallback = market_cap + deuda - caja
            if ev is None and market_cap and market_cap > 0:
                ev = market_cap + total_debt - total_cash

            # Cap Rate = NOI / EV
            cap_rate = None
            if op_income and ev and ev > 0:
                cap_rate = round((op_income / ev) * 100, 2)

            # FFO Yield ≈ FCF / Market Cap (FCF en MXN si .MX)
            # financialCurrency puede ser USD → convertir FCF
            price_cur = info.get("currency", "MXN") or "MXN"
            fin_cur   = info.get("financialCurrency", "MXN") or "MXN"
            fx = 1.0
            if price_cur != fin_cur:
                try:
                    fxh = yft(f"{fin_cur}{price_cur}=X").history(period="2d")
                    if not fxh.empty:
                        fx = float(fxh["Close"].iloc[-1])
                except Exception:
                    pass

            fcf_local = (fcf * fx) if (fcf is not None and fx != 1.0) else fcf
            ffo_yield = None
            if fcf_local and market_cap and market_cap > 0:
                ffo_yield = round((fcf_local / (market_cap * fx if fx != 1.0 else market_cap)) * 100, 2)
            # simpler: market_cap from Yahoo is already in price_cur
            if fcf_local and market_cap and market_cap > 0:
                ffo_yield = round((fcf_local / market_cap) * 100, 2)

            # LTV = deuda / (deuda + equity market value)
            ltv = None
            debt_local = total_debt * fx
            if debt_local and market_cap and market_cap > 0:
                ltv = round(debt_local / (debt_local + market_cap) * 100, 1)

            # NAV descuento/prima
            nav_discount = None
            if nav_ps and nav_ps > 0:
                if not p_nav:
                    p_nav = round(price / nav_ps, 2)
                nav_discount = round((price / nav_ps - 1) * 100, 1)

            # Señal
            if   p_nav and p_nav < 0.85:  signal = "OPORTUNIDAD"
            elif p_nav and p_nav > 1.15:  signal = "CARA"
            else:                          signal = "PRECIO JUSTO"

            results.append({
                "ticker":      ticker,
                "name":        info.get("shortName") or info.get("longName") or ticker,
                "price":       round(price, 2),
                "currency":    price_cur,
                "capRate":     cap_rate,
                "pNAV":        r2(p_nav),
                "navPS":       r2(nav_ps),
                "navDiscount": nav_discount,
                "divYield":    round(div_yield * 100, 2) if div_yield else None,
                "ffoYield":    ffo_yield,
                "ltv":         ltv,
                "marketCap":   market_cap,
                "signal":      signal,
                "sector":      info.get("category") or info.get("sector") or "Real Estate",
            })
        except Exception:
            pass

    results.sort(key=lambda x: x.get("pNAV") or 999)
    return {"fibras": results, "count": len(results)}


def get_insiders(ticker: str) -> dict:
    """Insider transactions + top institutional holders."""
    try:
        t = yft(ticker)
        result = {"transactions": [], "institutions": []}

        # Insider transactions
        try:
            ins = t.insider_transactions
            if ins is not None and not ins.empty:
                ins = ins.head(15)
                for _, row in ins.iterrows():
                    shares_val = row.get("Shares") or row.get("shares") or 0
                    val        = row.get("Value") or row.get("value") or 0
                    text       = row.get("Text") or row.get("text") or row.get("Transaction") or ""
                    name       = row.get("Insider") or row.get("insider") or row.get("Name") or "—"
                    date_raw   = row.get("Start Date") or row.get("startDate") or row.get("Date") or ""
                    try:
                        date_str = str(date_raw)[:10]
                    except Exception:
                        date_str = ""
                    action = "BUY" if ("purchase" in str(text).lower() or "buy" in str(text).lower() or (safe(shares_val) or 0) > 0) else "SELL"
                    result["transactions"].append({
                        "name":   str(name),
                        "action": action,
                        "shares": int(safe(shares_val) or 0),
                        "value":  int(safe(val) or 0),
                        "date":   date_str,
                        "text":   str(text)[:80],
                    })
        except Exception:
            pass

        # Institutional holders
        try:
            inst = t.institutional_holders
            if inst is not None and not inst.empty:
                for _, row in inst.head(8).iterrows():
                    holder = row.get("Holder") or row.get("holder") or "—"
                    shares_val = row.get("Shares") or row.get("shares") or 0
                    pct_held   = row.get("% Out") or row.get("pctHeld") or 0
                    result["institutions"].append({
                        "name":   str(holder),
                        "shares": int(safe(shares_val) or 0),
                        "pct":    round(float(pct_held) * 100, 2) if pct_held else 0,
                    })
        except Exception:
            pass

        return result
    except Exception as e:
        return {"error": str(e), "transactions": [], "institutions": []}


def get_momentum(ticker: str) -> dict:
    """
    Momentum relativo vs sector (3m, 6m, 12m).
    Compara el retorno del activo contra el ETF de su sector.
    """
    try:
        t    = yft(ticker)
        info = t.info
        sector = info.get("sector")
        etf    = SECTOR_ETF.get(sector, "SPY")

        hist_stock = yft(ticker).history(period="1y", interval="1wk")
        hist_etf   = yft(etf).history(period="1y", interval="1wk")

        def ret(hist, weeks):
            if hist.empty or len(hist) < weeks:
                return None
            closes = hist["Close"].tolist()
            return round((closes[-1] / closes[-weeks] - 1) * 100, 2)

        stock_3m  = ret(hist_stock, 13)
        stock_6m  = ret(hist_stock, 26)
        stock_12m = ret(hist_stock, 52)
        etf_3m    = ret(hist_etf,   13)
        etf_6m    = ret(hist_etf,   26)
        etf_12m   = ret(hist_etf,   52)

        alpha_3m  = round(stock_3m  - etf_3m,  2) if (stock_3m  is not None and etf_3m  is not None) else None
        alpha_6m  = round(stock_6m  - etf_6m,  2) if (stock_6m  is not None and etf_6m  is not None) else None
        alpha_12m = round(stock_12m - etf_12m, 2) if (stock_12m is not None and etf_12m is not None) else None

        # Score de momentum: +1 por cada período donde supera al sector
        score = sum(1 for a in [alpha_3m, alpha_6m, alpha_12m] if a is not None and a > 0)

        return {
            "sector":    sector or "—",
            "benchmark": etf,
            "stock":     {"m3": stock_3m,  "m6": stock_6m,  "m12": stock_12m},
            "sector_r":  {"m3": etf_3m,    "m6": etf_6m,    "m12": etf_12m},
            "alpha":     {"m3": alpha_3m,  "m6": alpha_6m,  "m12": alpha_12m},
            "score":     score,   # 0-3
        }
    except Exception as e:
        return {"error": str(e)}


# ─── Sentiment helpers (sin cambios) ─────────────────────────────────────────
POSITIVE_WORDS = {
    "beat","beats","record","surge","surges","rally","rallies","gain","gains",
    "profit","profits","growth","grows","upgrade","upgrades","buy","outperform",
    "strong","stronger","raise","raised","rises","rose","jump","jumps","boost",
    "positive","exceed","exceeds","expansion","dividend","buyback","upside",
    "revenue","milestone","breakthrough","partnership","deal","approved","approval",
    "gana","sube","alza","récord","supera","crecimiento","dividendo","compra",
    "acuerdo","positivo","mejora","impulso","expansión","aprobación",
}
NEGATIVE_WORDS = {
    "miss","misses","loss","losses","decline","declines","fall","falls","drop",
    "drops","cut","cuts","downgrade","downgrades","sell","underperform","weak",
    "weaker","lower","lowered","plunge","plunges","crash","crashes","warning",
    "risk","risks","lawsuit","fraud","investigation","fine","penalty","recall",
    "layoff","layoffs","bankruptcy","debt","crisis","concern","concerns","negative",
    "pierde","baja","caída","pérdida","recorte","demanda","fraude","multa",
    "débil","riesgo","crisis","preocupación","negativo","reducción",
}

def classify_sentiment(text: str) -> str:
    words = text.lower().split()
    pos = sum(1 for w in words if any(p in w for p in POSITIVE_WORDS))
    neg = sum(1 for w in words if any(n in w for n in NEGATIVE_WORDS))
    if pos > neg: return "positive"
    elif neg > pos: return "negative"
    return "neutral"

def _extract_news_item(item: dict) -> dict:
    content   = item.get("content") or {}
    title     = item.get("title") or content.get("title") or item.get("headline") or ""
    summary   = item.get("summary") or content.get("summary") or item.get("description") or content.get("description") or content.get("body") or ""
    url       = item.get("link") or item.get("url") or content.get("canonicalUrl", {}).get("url") or content.get("clickThroughUrl", {}).get("url") or ""
    publisher = item.get("publisher") or content.get("provider", {}).get("displayName") or item.get("source") or ""
    time_val  = item.get("providerPublishTime") or item.get("pubDate") or content.get("pubDate") or content.get("publishedAt") or 0
    if isinstance(time_val, str):
        try:
            from datetime import datetime
            time_val = int(datetime.fromisoformat(time_val.replace("Z", "+00:00")).timestamp())
        except Exception:
            time_val = 0
    return {"title": title, "summary": str(summary)[:250], "url": url, "publisher": publisher, "time": time_val}

def get_news(ticker: str) -> dict:
    try:
        raw  = yft(ticker).news or []
        news = []
        for item in raw[:20]:
            parsed = _extract_news_item(item)
            if not parsed["title"]: continue
            parsed["sentiment"] = classify_sentiment(parsed["title"] + " " + parsed["summary"])
            news.append(parsed)
        return {"news": news}
    except Exception as e:
        return {"news": [], "error": str(e)}

def get_rf() -> dict:
    """
    Tasa libre de riesgo: Bono M México 5 años.
    Yahoo Finance no expone directamente los bonos gubernamentales mexicanos,
    por lo que intentamos varios proxies y caemos en el valor de referencia actual.
    """
    # Intentar proxies en Yahoo Finance para tasas MX
    mx_proxies = [
        ("MXN10YT=RR", "Bono M 10Y"),
        ("MXN5YT=RR",  "Bono M 5Y"),
        ("MX5Y=X",     "Bono M 5Y"),
        ("^MX5Y",      "Bono M 5Y"),
    ]
    for sym, label in mx_proxies:
        try:
            hist = yft(sym).history(period="5d")
            if not hist.empty:
                val = float(hist["Close"].iloc[-1])
                rate = val / 100 if val > 1 else val
                if 0.03 < rate < 0.20:   # sanity: 3%-20%
                    return {"rate": round(rate, 6), "label": label}
        except Exception:
            pass
    # Fallback: Bono M México 10 años — mayo 2026
    return {"rate": 0.0860, "label": "Bono M 10Y"}


# ─── Autenticación ────────────────────────────────────────────────────────────
def _get_users() -> dict:
    """Lee usuarios desde variable de entorno USERS (JSON).
    Formato en Render: {"arturo":"pass1","juan":"pass2"}
    """
    raw = os.environ.get("USERS", "{}")
    try:
        return json.loads(raw)
    except Exception:
        return {}

def check_login(username: str, password: str) -> bool:
    users = _get_users()
    return bool(username and password and users.get(username.strip()) == password.strip())


# ─── HTTP Handler ─────────────────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        parts  = parsed.path.strip("/").split("/")
        params = parse_qs(parsed.query)
        try:
            if   parts[0] == "stock"    and len(parts) > 1: result = get_stock(parts[1])
            elif parts[0] == "chart"    and len(parts) > 1:
                period = params.get("period", ["5y"])[0]
                result = get_chart(parts[1], period)
            elif parts[0] == "rf":                           result = get_rf()
            elif parts[0] == "news" and len(parts) > 1 and parts[1] == "market": result = get_market_news()
            elif parts[0] == "news"     and len(parts) > 1: result = get_news(parts[1])
            elif parts[0] == "macro":                        result = get_macro()
            elif parts[0] == "market":                       result = get_market()
            elif parts[0] == "worldmap":                     result = get_worldmap()
            elif parts[0] == "dcf"      and len(parts) > 1: result = get_dcf(parts[1])
            elif parts[0] == "fibras" and len(parts) > 1:   result = get_fibras(parts[1])
            elif parts[0] == "fibras":                       result = get_fibras()
            elif parts[0] == "magic":                        result = get_magic_formula()
            elif parts[0] == "magic_one" and len(parts) > 1: result = get_magic_one(parts[1])
            elif parts[0] == "insiders" and len(parts) > 1: result = get_insiders(parts[1])
            elif parts[0] == "momentum" and len(parts) > 1: result = get_momentum(parts[1])
            elif parts[0] == "health":                       result = {"status": "ok"}
            elif parts[0] == "debug" and len(parts) > 1 and parts[1] == "macro":
                fred10 = _fred_rate("DGS10")
                fred2  = _fred_rate("DGS2")
                vix_c  = _cboe_vix()
                dxy_s  = _stooq_dxy()
                bulk   = _bulk_download({"^VIX":"vix","^TNX":"t10y","^IRX":"t2y","DX-Y.NYB":"dxy"})
                result = {"fred10": fred10, "fred2": fred2, "cboe_vix": vix_c,
                          "stooq_dxy": dxy_s, "yf_bulk": bulk, "macro_cache": get_macro()}
            else:                                            result = {"error": "Ruta no encontrada"}
        except Exception as e:
            result = {"error": str(e)}

        body = json.dumps(result, default=str).encode()
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        parsed = urlparse(self.path)
        parts  = parsed.path.strip("/").split("/")
        length = int(self.headers.get("Content-Length", 0))
        body_raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            body = json.loads(body_raw)
        except Exception:
            body = {}
        try:
            if parts[0] == "login":
                username = str(body.get("username", "")).strip()
                password = str(body.get("password", "")).strip()
                if check_login(username, password):
                    result = {"ok": True}
                else:
                    result = {"ok": False, "error": "Credenciales incorrectas"}
            else:
                result = {"error": "Not found"}
        except Exception as e:
            result = {"error": str(e)}
        resp = json.dumps(result, default=str).encode()
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(resp)))
        self.end_headers()
        self.wfile.write(resp)

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")

    def log_message(self, fmt, *args):
        print(f"  {args[1]}  {args[0]}")


def _prewarm():
    """Pre-calienta el cache de Fórmula Mágica en background al arrancar."""
    time.sleep(8)  # espera a que el servidor esté listo
    try:
        get_magic_formula()
        print("  [prewarm] Fórmula Mágica cacheada.")
    except Exception as e:
        print(f"  [prewarm] Error: {e}")

if __name__ == "__main__":
    import os
    host = "0.0.0.0"
    port = int(os.environ.get("PORT", PORT))
    server = HTTPServer((host, port), Handler)
    print(f"\n  KAIZEN Backend  →  http://{host}:{port}")
    print("  Endpoints: /stock /chart /rf /news /macro /dcf /momentum /health")
    print("  Ctrl+C para detener\n")
    threading.Thread(target=_prewarm, daemon=True).start()
    server.serve_forever()
