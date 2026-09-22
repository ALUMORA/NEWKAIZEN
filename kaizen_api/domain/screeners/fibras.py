"""Screener de FIBRAs mexicanas del legado (``get_fibras``).

Unidades del legado: porcentajes. El v2 (``/v2/screeners/fibras``) usa fracciones.

Movido sin cambios desde backend.py (fase S1): los cuerpos son idénticos al legado y los
goldens de tests/goldens_legacy lo prueban. La versión v2 se escribe al lado, no encima.
"""

import re

from kaizen_api.domain import _log, r2, safe
from kaizen_api.domain.fundamentals import _div_yield_pct
from kaizen_api.domain.history import _fetch_hist
from kaizen_api.domain.universe import FIBRAS_LIST
from kaizen_api.providers.yahoo.session import yft
from kaizen_api.schemas import SYMBOL_PATTERN

# Mismo patrón que el legado (re de Python, no el motor de pydantic).
_TICKER_RE = re.compile(SYMBOL_PATTERN)
_FIBRAS_EXTRA_MAX = 20


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
    # Solo tickers válidos y máximo _FIBRAS_EXTRA_MAX: cada uno cuesta varias llamadas a Yahoo
    extra_tickers = [t for t in extra_tickers if _TICKER_RE.match(t)][:_FIBRAS_EXTRA_MAX]
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
            div_yield   = _div_yield_pct(info)                # ya en %
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
            fx_ok = True
            if price_cur != fin_cur:
                fx_ok = False
                try:
                    fxh = yft(f"{fin_cur}{price_cur}=X").history(period="2d")
                    if not fxh.empty:
                        fx = float(fxh["Close"].iloc[-1])
                        fx_ok = True
                except Exception as e:
                    _log(f"fibras {ticker}: sin tipo de cambio {fin_cur}{price_cur} ({e})")

            # Sin FX, FCF y deuda quedarían en otra moneda que el market cap: mejor None que un % falso
            fcf_local = None if not fx_ok else ((fcf * fx) if (fcf is not None and fx != 1.0) else fcf)
            ffo_yield = None
            if fcf_local and market_cap and market_cap > 0:
                ffo_yield = round((fcf_local / (market_cap * fx if fx != 1.0 else market_cap)) * 100, 2)
            # simpler: market_cap from Yahoo is already in price_cur
            if fcf_local and market_cap and market_cap > 0:
                ffo_yield = round((fcf_local / market_cap) * 100, 2)

            # LTV = deuda / (deuda + equity market value)
            ltv = None
            debt_local = total_debt * fx if fx_ok else None
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
                "name":        info.get("longName") or info.get("shortName") or ticker,  # shortName es el fiduciario
                "price":       round(price, 2),
                "currency":    price_cur,
                "capRate":     cap_rate,
                "pNAV":        r2(p_nav),
                "navPS":       r2(nav_ps),
                "navDiscount": nav_discount,
                "divYield":    div_yield,   # en %; antes ×100 sobre un valor que yfinance 1.x ya da en %
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
