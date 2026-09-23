"""Fundamentales de una emisora: ``get_stock`` del legado y sus helpers.

Unidades del legado: porcentajes (2.4 = 2.4 %). El v2 (``/v2/instrument``) usa fracciones.

Movido sin cambios desde backend.py (fase S1): los cuerpos son idénticos al legado y los
goldens de tests/goldens_legacy lo prueban. La versión v2 se escribe al lado, no encima.
"""

import datetime as _v2dt
import time

from kaizen_api.domain import _log, pct, r2, safe
from kaizen_api.domain import history as _history
from kaizen_api.domain.currency import Converter, normalize_currency, scale_minor
from kaizen_api.domain.history import _fetch_hist
from kaizen_api.errors import ApiError
from kaizen_api.provenance import iso_instant, utc_now
from kaizen_api.providers.yahoo import fundamentals as _yahoo
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


# ─── v2: ficha de la emisora (stream B3a) ────────────────────────────────────
#
# Todo lo de arriba es el legado y se queda igual (los goldens lo fijan). De aquí para abajo vive
# ``/v2/instrument/{symbol}`` y ``/v2/instrument/{symbol}/dividends``, con dos diferencias de fondo
# contra el legado:
#
# 1. **Moneda.** Ninguna razón mezcla la moneda del precio con la de los estados. Lo que sale de
#    los estados se convierte con ``domain/currency.py`` (que usa la costura ``fx.convert``) ANTES
#    de dividirlo entre el precio o la capitalización; si no hay tipo de cambio, la razón va en
#    ``None`` con su nota, nunca mezclada.
# 2. **Beta.** Se calcula contra un referente LOCAL en la MISMA moneda (NAFTRAC.MX para pesos, SPY
#    para dólares), con dos años de rendimientos semanales emparejados por fecha, y se entrega
#    cruda y ajustada por Blume. La beta de Yahoo es 5 años mensual contra el S&P 500: para un
#    papel de la BMV no aplica, y si se usa como respaldo la respuesta lo dice.
#
# Unidades: todo porcentaje sale como FRACCIÓN, los múltiplos como razón simple.

BETA_RANGE = "2y"
BETA_INTERVAL = "1wk"
BETA_MIN_OBS = 52
BETA_WINDOW_LABEL = "2 años, semanal"
BETA_BENCHMARKS: dict[str, str] = {"MXN": "NAFTRAC.MX", "USD": "SPY"}
"""Referente local por moneda de cotización. NAFTRAC replica al IPC y cotiza en pesos; el ^MXX es
un índice de precios sin dividendos y Yahoo además lo etiqueta en dólares."""

QUOTE_TYPES: dict[str, str] = {
    "EQUITY": "equity",
    "ETF": "etf",
    "INDEX": "index",
    "MUTUALFUND": "fund",
    "CRYPTOCURRENCY": "crypto",
    "CURRENCY": "fx",
    "FUTURE": "commodity",
    "COMMODITY": "commodity",
}

FUNDAMENTAL_KEYS = (
    "pe", "forwardPe", "pb", "ps", "evEbitda", "pfcf", "earningsYield", "fcfYield", "dividendYield",
    "payoutRatio", "roe", "roa", "grossMargin", "operatingMargin", "netMargin", "revenueGrowthYoY",
    "epsGrowthYoY", "debtToEquity", "netDebtToEbitda", "currentRatio", "enterpriseValue",
    "sharesOutstanding",
)
"""Las 22 métricas de ``Fundamentals``. ``coverage`` cuenta cuántas traen dato."""


def _pos(value):
    """El número si es positivo; ``None`` si no. Un P/E negativo no es un múltiplo, es ruido."""
    v = safe(value)
    return v if v is not None and v > 0 else None


def _ratio(numerator, denominator):
    n, d = safe(numerator), safe(denominator)
    if n is None or d is None or d == 0:
        return None
    return n / d


def _round(value, digits: int = 6):
    v = safe(value)
    return None if v is None else round(v, digits)


def div_yield_fraction(info: dict):
    """Rendimiento por dividendo como FRACCIÓN (0.0445 = 4.45 %).

    Reutiliza ``_div_yield_pct``, que es la costura que ya resuelve la trampa de yfinance 1.x:
    ``dividendYield`` viene en porcentaje y ``trailingAnnualDividendYield`` en fracción.
    """
    pct_value = _div_yield_pct(info)
    return None if pct_value is None else pct_value / 100.0


def instrument_type(info: dict, symbol: str) -> str | None:
    """Tipo del papel para el contrato. Una FIBRA es una emisora de la BMV del sector inmobiliario."""
    kind = QUOTE_TYPES.get(str(info.get("quoteType") or "").upper())
    if kind == "equity" and symbol.upper().endswith(".MX") and info.get("sector") == "Real Estate":
        return "fibra"
    return kind


def _weekly_returns(series) -> dict[str, tuple[str, float]]:
    """``{fecha final: (fecha inicial, rendimiento simple)}`` de una ``PriceSeries``.

    Se guardan las DOS fechas del intervalo: si a una serie le falta una semana, su rendimiento
    siguiente abarca dos, y solo comparando también la fecha inicial se ve que no es el mismo
    intervalo que el de la otra serie.
    """
    out: dict[str, tuple[str, float]] = {}
    dates, close = series.dates, series.close
    for i in range(1, len(close)):
        prev, cur = safe(close[i - 1]), safe(close[i])
        if prev is None or cur is None or prev <= 0:
            continue
        out[dates[i]] = (dates[i - 1], cur / prev - 1.0)
    return out


def compute_beta(symbol: str, price_currency: str | None, notes: list[str]) -> dict | None:
    """Beta contra el referente local en la MISMA moneda, con rendimientos semanales por fecha.

    Devuelve el ``Beta`` del contrato (cruda, ajustada por Blume, referente, moneda, ventana y
    observaciones) o ``None`` cuando no hay serie, no hay referente en esa moneda o quedan menos de
    ``BETA_MIN_OBS`` observaciones. Nunca empareja por posición ni cruza monedas.
    """
    ccy = (price_currency or "").upper()
    benchmark = BETA_BENCHMARKS.get(ccy)
    if not benchmark:
        notes.append(f"No hay un referente local en {ccy or 'esa moneda'} para calcular la beta.")
        return None
    try:
        own = _history.get_series(symbol, BETA_RANGE, BETA_INTERVAL, "native")
        market = _history.get_series(benchmark, BETA_RANGE, BETA_INTERVAL, "native")
    except NotImplementedError:
        notes.append("La serie de precios v2 todavía no está disponible, así que la beta no se calculó.")
        return None
    except ApiError as exc:
        notes.append(f"No se pudo calcular la beta: {exc.message}")
        return None
    own_ccy = (getattr(own, "currency", "") or "").upper()
    market_ccy = (getattr(market, "currency", "") or "").upper()
    if own_ccy != market_ccy:
        notes.append(
            f"La beta no se calculó: {symbol} cotiza en {own_ccy or 's/d'} y {benchmark} en "
            f"{market_ccy or 's/d'}, y comparar monedas distintas la distorsiona."
        )
        return None
    own_returns = _weekly_returns(own)
    market_returns = _weekly_returns(market)
    common = sorted(set(own_returns) & set(market_returns))
    # Se empareja solo cuando coinciden las DOS fechas del intervalo; si no, uno de los dos
    # rendimientos abarca más semanas que el otro por un hueco en su serie.
    dates = [d for d in common if own_returns[d][0] == market_returns[d][0]]
    dropped = len(common) - len(dates)
    if dropped:
        weeks = "1 semana" if dropped == 1 else f"{dropped} semanas"
        notes.append(
            f"Para la beta se descartó {weeks} en la que las dos series no coinciden en el intervalo "
            "(a una le falta un cierre)."
        )
    n = len(dates)
    if n < BETA_MIN_OBS:
        notes.append(f"La beta necesita al menos {BETA_MIN_OBS} semanas emparejadas y solo hubo {n}.")
        return None
    xs = [market_returns[d][1] for d in dates]
    ys = [own_returns[d][1] for d in dates]
    mx = sum(xs) / n
    my = sum(ys) / n
    var = sum((x - mx) ** 2 for x in xs)
    if var <= 0:
        notes.append("La beta no se calculó: el referente no se movió en la ventana.")
        return None
    cov = sum((xs[i] - mx) * (ys[i] - my) for i in range(n))
    beta = cov / var
    return {
        "value": round(beta, 4),
        "adjusted": round(0.67 * beta + 0.33, 4),
        "benchmark": benchmark,
        "currency": own_ccy or ccy,
        "window": BETA_WINDOW_LABEL,
        "observations": n,
        "source": "computed",
    }


def _yahoo_beta(info: dict, price_currency: str, notes: list[str]) -> dict | None:
    """Respaldo: la beta que publica Yahoo, SOLO para papeles en dólares y diciendo qué es.

    Para un papel de la BMV no se usa: Yahoo la mide contra el S&P 500 en dólares y eso no es la
    beta de mercado de un inversionista en pesos.
    """
    value = safe(info.get("beta"))
    if value is None or price_currency != "USD":
        return None
    notes.append("La beta es la que publica Yahoo: 5 años mensual contra el S&P 500, no la calculamos aquí.")
    return {
        "value": round(value, 4),
        "adjusted": round(0.67 * value + 0.33, 4),
        "benchmark": "^GSPC",
        "currency": "USD",
        "window": "5 años, mensual",
        "observations": 0,
        "source": "yahoo",
    }


def _annual_growth(symbol: str) -> tuple[float | None, float | None]:
    """Crecimiento anual de ingresos y de UPA entre los dos últimos ejercicios de Yahoo.

    Es lo que la gente entiende por "crecimiento anual". ``info["revenueGrowth"]`` y
    ``info["earningsGrowth"]`` son el año contra año de UN trimestre, que salta con cualquier
    partida extraordinaria.
    """
    frame = _yahoo.get_statement(symbol, "income", "annual")
    if frame is None or len(frame.columns) < 2:
        return None, None
    columns = sorted(frame.columns)
    last, prev = columns[-1], columns[-2]

    def growth(labels: tuple[str, ...]) -> float | None:
        for label in labels:
            if label not in frame.index:
                continue
            row = frame.loc[label]
            if hasattr(row, "iloc") and getattr(row, "ndim", 1) > 1:
                row = row.iloc[0]
            new, old = safe(row.get(last)), safe(row.get(prev))
            if new is None or old is None or old <= 0:
                return None
            return new / old - 1.0
        return None

    return growth(("Total Revenue", "Operating Revenue")), growth(("Diluted EPS", "Basic EPS"))


def _quote(info: dict, price, divisor: float) -> dict:
    previous = scale_minor(info.get("previousClose") or info.get("regularMarketPreviousClose"), divisor)
    change = None if price is None or previous is None else price - previous
    change_pct = None if change is None or not previous else change / previous
    stamp = safe(info.get("regularMarketTime"))
    as_of = None
    if stamp:
        as_of = iso_instant(_v2dt.datetime.fromtimestamp(stamp, _v2dt.UTC))
    return {
        "price": _round(price, 6),
        "previousClose": _round(previous, 6),
        "change": _round(change, 6),
        "changePct": _round(change_pct),
        "dayLow": _round(scale_minor(info.get("dayLow") or info.get("regularMarketDayLow"), divisor)),
        "dayHigh": _round(scale_minor(info.get("dayHigh") or info.get("regularMarketDayHigh"), divisor)),
        "low52w": _round(scale_minor(info.get("fiftyTwoWeekLow"), divisor)),
        "high52w": _round(scale_minor(info.get("fiftyTwoWeekHigh"), divisor)),
        "volume": safe(info.get("regularMarketVolume") or info.get("volume")),
        "avgVolume": safe(info.get("averageVolume")),
        "marketCap": _round(scale_minor(info.get("marketCap"), divisor), 2),
        "asOf": as_of,
    }


def _website(info: dict) -> str | None:
    url = info.get("website")
    return url if isinstance(url, str) and url.startswith(("http://", "https://")) else None


def get_instrument(symbol: str) -> dict:
    """Ficha completa de la emisora para ``/v2/instrument/{symbol}``.

    Levanta ``ApiError`` 404 cuando Yahoo no conoce el símbolo. Devuelve el cuerpo del contrato sin
    ``meta``, más las llaves auxiliares ``notes``, ``sources`` y ``fallback`` que arma el router.
    """
    symbol = symbol.upper()
    info = _yahoo.get_info(symbol)
    # Un ``info`` casi vacío es Yahoo diciendo que no conoce el símbolo. Se corta aquí para no
    # salir a pedirle a fast_info lo mismo tres veces por un ticker que no existe.
    if len(info) <= 5:
        raise ApiError(404, "NOT_FOUND", f"No encontramos datos de {symbol}. Revisa el símbolo.")
    price_ccy_raw = info.get("currency") or _yahoo.get_fast_value(symbol, "currency")
    price_currency, px_divisor = normalize_currency(price_ccy_raw)
    price = scale_minor(info.get("currentPrice") or info.get("regularMarketPrice"), px_divisor)
    if price is None:
        price = scale_minor(_yahoo.get_fast_value(symbol, "last_price"), px_divisor)
    if price is None or not price_currency:
        raise ApiError(404, "NOT_FOUND", f"No encontramos datos de {symbol}. Revisa el símbolo.")

    notes: list[str] = []
    financial_currency, fin_divisor = normalize_currency(info.get("financialCurrency"))
    if price_ccy_raw != price_currency:
        notes.append(
            f"Yahoo cotiza este papel en {price_ccy_raw} (unidad menor); los montos se entregan en "
            f"{price_currency}."
        )
    conv = Converter(financial_currency, price_currency)
    if not conv.same and conv.failure:
        notes.append(conv.failure + " Las razones que mezclan precio con estados quedan vacías.")
    fx_fallback = False
    if conv.used() is not None and conv.fallback:
        # Una fuente sustituta es ``fallback`` aunque el precio sea en vivo: las razones que mezclan
        # precio con estados se hicieron con ese tipo de cambio.
        fx_fallback = True
        notes.append(
            f"El tipo de cambio {conv.pair} con el que se convirtieron los estados viene del mercado "
            "en Yahoo, no del FIX de Banxico."
        )

    # En la moneda de los ESTADOS (se convierten antes de mezclarlas con el precio).
    revenue = scale_minor(info.get("totalRevenue"), fin_divisor)
    net_income = scale_minor(info.get("netIncomeToCommon"), fin_divisor)
    ebitda = scale_minor(info.get("ebitda"), fin_divisor)
    free_cash = scale_minor(info.get("freeCashflow"), fin_divisor)
    total_debt = scale_minor(info.get("totalDebt"), fin_divisor)
    total_cash = scale_minor(info.get("totalCash"), fin_divisor)
    gross_profit = scale_minor(info.get("grossProfits"), fin_divisor)

    # Ya en la moneda del PRECIO.
    market_cap = scale_minor(info.get("marketCap"), px_divisor)
    shares = safe(info.get("sharesOutstanding")) or safe(_yahoo.get_fast_value(symbol, "shares"))
    revenue_px = conv.to_price(revenue)
    net_income_px = conv.to_price(net_income)
    ebitda_px = conv.to_price(ebitda)
    free_cash_px = conv.to_price(free_cash)
    net_debt_px = None
    if total_debt is not None and total_cash is not None:
        net_debt_px = conv.to_price(total_debt - total_cash)
    enterprise_value = None if market_cap is None or net_debt_px is None else market_cap + net_debt_px

    pe = _pos(info.get("trailingPE"))
    if pe is None:
        eps = _pos(scale_minor(info.get("trailingEps"), px_divisor))
        pe = _ratio(price, eps) if eps else None
    pb = _pos(info.get("priceToBook"))
    if pb is None:
        bvps = _pos(scale_minor(info.get("bookValue"), px_divisor))
        pb = _ratio(price, bvps) if bvps else None

    revenue_growth, eps_growth = _annual_growth(symbol)
    if revenue_growth is None:
        revenue_growth = safe(info.get("revenueGrowth"))
        if revenue_growth is not None:
            notes.append("El crecimiento de ingresos es el del último trimestre contra el mismo del año pasado.")
    if eps_growth is None:
        eps_growth = safe(info.get("earningsGrowth"))
        if eps_growth is not None:
            notes.append("El crecimiento de la UPA es el del último trimestre contra el mismo del año pasado.")

    debt_to_equity = safe(info.get("debtToEquity"))
    if debt_to_equity is not None:
        debt_to_equity = debt_to_equity / 100.0  # Yahoo lo publica en porcentaje: 78.445 = 0.78 veces

    fundamentals = {
        "pe": _round(pe, 4),
        "forwardPe": _round(_pos(info.get("forwardPE")), 4),
        "pb": _round(pb, 4),
        "ps": _round(_pos(_ratio(market_cap, revenue_px)), 4),
        "evEbitda": _round(_pos(_ratio(enterprise_value, _pos(ebitda_px))), 4),
        "pfcf": _round(_pos(_ratio(market_cap, _pos(free_cash_px))), 4),
        "earningsYield": _round(_ratio(net_income_px, market_cap)),
        "fcfYield": _round(_ratio(free_cash_px, market_cap)),
        "dividendYield": _round(div_yield_fraction(info)),
        "payoutRatio": _round(safe(info.get("payoutRatio"))),
        "roe": _round(safe(info.get("returnOnEquity"))),
        "roa": _round(safe(info.get("returnOnAssets"))),
        "grossMargin": _round(safe(info.get("grossMargins")) or _ratio(gross_profit, revenue)),
        "operatingMargin": _round(safe(info.get("operatingMargins"))),
        "netMargin": _round(safe(info.get("profitMargins")) or _ratio(net_income, revenue)),
        "revenueGrowthYoY": _round(revenue_growth),
        "epsGrowthYoY": _round(eps_growth),
        "debtToEquity": _round(debt_to_equity),  # 6 decimales: viene de dividir un porcentaje
        "netDebtToEbitda": _round(
            _ratio(None if total_debt is None or total_cash is None else total_debt - total_cash, _pos(ebitda)),
            4,
        ),
        "currentRatio": _round(safe(info.get("currentRatio")), 4),
        "enterpriseValue": _round(enterprise_value, 2),
        "sharesOutstanding": safe(shares),
    }
    if fundamentals["earningsYield"] is None and pe:
        # Respaldo: 1/(P/U). El P/U de Yahoo ya viene por listado, así que no mezcla monedas, pero
        # no sale de los estados que convertimos aquí. Se dice, porque si no la nota de arriba
        # ("las razones que mezclan precio con estados quedan vacías") se contradice sola.
        fundamentals["earningsYield"] = _round(1.0 / pe)
        notes.append(
            "El rendimiento de la utilidad se sacó del P/U que publica Yahoo, no de los estados financieros."
        )

    fallback = fx_fallback
    beta = compute_beta(symbol, price_currency, notes)
    if beta is None:
        beta = _yahoo_beta(info, price_currency, notes)
        fallback = fallback or beta is not None
    sources = ["yahoo"] + (["computed"] if beta and beta["source"] == "computed" else [])
    if conv.used() is not None and conv.source and conv.source not in sources:
        sources.append(conv.source)
    available = sum(1 for key in FUNDAMENTAL_KEYS if fundamentals[key] is not None)
    quote = _quote(info, price, px_divisor)
    return {
        "symbol": symbol,
        "name": str(info.get("longName") or info.get("shortName") or symbol),
        "exchange": info.get("fullExchangeName") or info.get("exchange"),
        "type": instrument_type(info, symbol),
        "sector": info.get("sector"),
        "industry": info.get("industry"),
        "country": info.get("country"),
        "description": info.get("longBusinessSummary"),
        "website": _website(info),
        "priceCurrency": price_currency,
        "financialCurrency": financial_currency,
        "fxUsed": conv.used(),
        "quote": quote,
        "fundamentals": fundamentals,
        "beta": beta,
        "sectorMedians": None,
        "coverage": {"available": available, "total": len(FUNDAMENTAL_KEYS)},
        "notes": notes,
        "sources": sources,
        "as_of": quote["asOf"],
        "fallback": fallback,
    }


def get_dividends(symbol: str) -> dict:
    """Dividendos pagados, suma de los últimos 12 meses y rendimiento, para ``/dividends``.

    Los dividendos de Yahoo vienen por acción y en la moneda de COTIZACIÓN, así que el rendimiento
    se calcula contra el precio sin convertir nada. Sin historia, ``ttm`` y ``yield`` van en
    ``None`` y ``history`` vacío.
    """
    symbol = symbol.upper()
    info = _yahoo.get_info(symbol)
    if len(info) <= 5:
        raise ApiError(404, "NOT_FOUND", f"No encontramos datos de {symbol}. Revisa el símbolo.")
    price_currency, divisor = normalize_currency(info.get("currency") or _yahoo.get_fast_value(symbol, "currency"))
    price = scale_minor(info.get("currentPrice") or info.get("regularMarketPrice"), divisor)
    series = _yahoo.get_dividends(symbol)
    history: list[dict] = []
    if series is not None:
        for stamp, amount in series.items():
            value = scale_minor(amount, divisor)
            if value is None:
                continue
            try:
                date = stamp.date().isoformat()
            except AttributeError:
                date = str(stamp)[:10]
            history.append({"date": date, "amount": round(value, 6)})
    history.sort(key=lambda row: row["date"])
    notes: list[str] = []
    ttm = None
    if history:
        cutoff = (utc_now().date() - _v2dt.timedelta(days=365)).isoformat()
        recent = [row["amount"] for row in history if row["date"] > cutoff]
        ttm = round(sum(recent), 6) if recent else 0.0
        if not recent:
            notes.append("No hubo pagos en los últimos 12 meses.")
    else:
        notes.append("Yahoo no publica historia de dividendos para este símbolo.")
    computed_yield = _round(_ratio(ttm, price)) if ttm else (0.0 if ttm == 0.0 else None)
    # El rendimiento de /instrument es el que PUBLICA Yahoo y este es el que sale de los pagos que
    # de veras ocurrieron en 12 meses. Los dos son defendibles y no dan lo mismo (WALMEX: 4.45 %
    # contra 3.75 %). Si alguien ve las dos pantallas sin esta nota, parece que una está mal.
    published = div_yield_fraction(info)
    if computed_yield and published and abs(computed_yield - published) > 0.1 * published:
        notes.append(
            "Este rendimiento sale de los dividendos pagados en los últimos 12 meses. "
            f"Yahoo publica {published * 100:.2f} % por su propia cuenta, que puede ir por delante."
        )
    return {
        "symbol": symbol,
        "currency": price_currency,
        "ttm": ttm,
        "yield": computed_yield,
        "history": history[-60:],
        "notes": notes,
        "as_of": history[-1]["date"] if history else None,
    }
