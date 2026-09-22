"""Fundamentales de una emisora: ``get_stock`` del legado y sus helpers.

Unidades del legado: porcentajes (2.4 = 2.4 %). El v2 (``/v2/instrument``) usa fracciones.

Movido sin cambios desde backend.py (fase S1): los cuerpos son idénticos al legado y los
goldens de tests/goldens_legacy lo prueban. La versión v2 se escribe al lado, no encima.
"""

import time

from kaizen_api.domain import _log, pct, r2, safe
from kaizen_api.domain.history import _fetch_hist
from kaizen_api.providers.yahoo.session import yft


def _debt_to_assets(total_debt, total_assets):
    """Deuda total / activos totales en %. Antes se derivaba de D/E y daba D/(D+E), otro ratio."""
    d, a = safe(total_debt), safe(total_assets)
    if d is None or not a or a <= 0: return None
    return round(d / a * 100, 1)

def _div_yield_pct(info):
    """
    Rendimiento por dividendo en % (2.4 = 2.4%).
    yfinance >= 0.2.5x entrega dividendYield ya en % (KO -> 2.4), pero
    trailingAnnualDividendYield sigue como fracción (KO -> 0.0236). Se prefiere
    dividendYield (es el que muestra Yahoo) y se contrasta con el trailing para
    detectar la unidad: si dividendYield×100 queda más cerca del trailing en %,
    venía como fracción y se escala. Sin dividendYield se usa el trailing×100.
    """
    d = safe(info.get("dividendYield"))
    t = safe(info.get("trailingAnnualDividendYield"))
    t_pct = t * 100 if t and t > 0 else None
    if d is not None and d > 0:
        if t_pct is not None and abs(d * 100 - t_pct) < abs(d - t_pct):
            d = d * 100
        return round(d, 2)
    return round(t_pct, 2) if t_pct is not None else None

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
    except Exception as e:
        _log(f"stock {ticker}: estados financieros incompletos ({e})")

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
    # Preferir precio/EPS (lo que muestra la página de Yahoo Finance) sobre el campo
    # cacheado trailingPE, que puede quedar desfasado tras un reporte de resultados.
    if eps_val is not None and eps_val > 0 and price is not None:
        pe = round(price / eps_val, 2)
    else:
        pe = r2(safe(info.get("trailingPE")))

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
                # Emparejar por fecha, no por posición: si a una serie le falta una semana
                # las posiciones se desfasan. Se quita la zona horaria porque .MX y SPY
                # vienen en husos distintos y el join por timestamp exacto quedaría vacío.
                def _by_date(h):
                    s = h["Close"].dropna()
                    idx = s.index
                    if getattr(idx, "tz", None) is not None:
                        idx = idx.tz_localize(None)
                    s.index = idx.normalize()
                    return s[~s.index.duplicated(keep="last")]
                pair = _by_date(h_stock).to_frame("s").join(_by_date(h_spy).to_frame("m"), how="inner").dropna()
                sc = pair["s"].tolist()
                mc = pair["m"].tolist()
                n  = len(sc) - 1
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

    # PEG: Yahoo publica trailingPegRatio con el crecimiento esperado a 5 años de analistas.
    # earningsGrowth es el YoY de UN trimestre (GOOGL 294% por una ganancia única) y daba
    # PEG de 0.06; solo se usa de respaldo cuando es creíble (0-50%).
    div_pct    = _div_yield_pct(info)   # ya en %, ver _div_yield_pct
    peg_yahoo  = safe(info.get("trailingPegRatio"))
    if pe and peg_yahoo and peg_yahoo > 0:
        growth = pe / peg_yahoo          # crecimiento implícito, en %
    else:
        growth_raw = safe(info.get("earningsGrowth") or info.get("earningsQuarterlyGrowth"))
        growth = growth_raw * 100 if growth_raw and 0 < growth_raw <= 0.5 else None
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
        "dividendYield":      div_pct,   # en % (2.4 = 2.4%), igual que lo entrega yfinance 1.x
        "pcf":                r2(safe(info.get("priceToFreeCashflow"))),
        "debtToAssets":       _debt_to_assets(total_debt, total_assets),
        "leverageRatio":      _leverage_ratio(info),
        "sector":             info.get("sector"),
        "totalRevenue":       total_revenue,
        "netIncomeToCommon":  net_income,
        "totalAssets":        total_assets,
        "totalDebt":          total_debt,
        "operatingCashflow":  op_cashflow,
        "freeCashflow":       free_cashflow,
        "description":        info.get("longBusinessSummary"),
        "industry":           info.get("industry"),
        "website":            info.get("website"),
        "employees":          info.get("fullTimeEmployees"),
        "country":            info.get("country"),
        "currency":           info.get("currency", "USD"),
    }
