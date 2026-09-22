"""Fórmula Mágica de Greenblatt (screener y cálculo por emisora) del legado.

Ojo: ``get_magic_one`` estima EBIT como EBITDA x 0.85 cuando no hay estado de resultados;
el v2 (``/v2/screeners/magic``) nunca mezcla EBIT estimado.

Movido sin cambios desde backend.py (fase S1): los cuerpos son idénticos al legado y los
goldens de tests/goldens_legacy lo prueban. La versión v2 se escribe al lado, no encima.
"""

from concurrent.futures import ThreadPoolExecutor

from kaizen_api.cache import _cached
from kaizen_api.domain import _log, r2, safe
from kaizen_api.domain.universe import EXCLUDED_SECTORS, MAGIC_UNIVERSE
from kaizen_api.providers.yahoo.session import yft


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
            "name":      info.get("longName") or info.get("shortName") or ticker,  # shortName de una FIBRA es su fiduciario
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
    from concurrent.futures import as_completed, TimeoutError as FutTimeout
    universe = list(dict.fromkeys(MAGIC_UNIVERSE))
    candidates = []
    # Sin "with": su salida espera a todos los hilos y anulaba el timeout de 25 s
    pool = ThreadPoolExecutor(max_workers=12)
    partial = False
    futures = {pool.submit(_fetch_magic_ticker, t): t for t in universe}
    try:
        for fut in as_completed(futures, timeout=25):
            try:
                r = fut.result()
                if r is not None:
                    candidates.append(r)
            except Exception:
                pass
    except FutTimeout:
        # El timeout salta fuera del for: conservar lo que ya llegó en vez de perderlo todo
        partial = True
        pending = sum(1 for f in futures if not f.done())
        _log(f"magic: timeout de 25 s, {pending} tickers sin respuesta; se usan {len(candidates)} parciales")
    finally:
        pool.shutdown(wait=False, cancel_futures=True)

    if not candidates:
        return {"stocks": [], "count": 0, "universe": len(universe), "partial": partial}

    sorted_ey  = sorted(candidates, key=lambda x: x["ey"],  reverse=True)
    sorted_roc = sorted(candidates, key=lambda x: x["roc"], reverse=True)
    rank_ey    = {r["ticker"]: i + 1 for i, r in enumerate(sorted_ey)}
    rank_roc   = {r["ticker"]: i + 1 for i, r in enumerate(sorted_roc)}

    for c in candidates:
        c["rank_ey"]    = rank_ey[c["ticker"]]
        c["rank_roc"]   = rank_roc[c["ticker"]]
        c["magic_rank"] = c["rank_ey"] + c["rank_roc"]

    candidates.sort(key=lambda x: x["magic_rank"])
    return {"stocks": candidates[:30], "count": len(candidates), "universe": len(universe), "partial": partial}


def get_magic_formula() -> dict:
    """Fórmula Mágica de Greenblatt — cacheada 12h (no cambia intradía)."""
    # Un screener vacío o parcial (timeout) no se guarda 12h: solo 5 min y se reintenta
    return _cached("magic", _get_magic_formula_fresh, ttl=43200, fail_ttl=300,
                   ok=lambda r: r.get("count", 0) > 0 and not r.get("partial"))


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
            "name":      info.get("longName") or info.get("shortName") or ticker,  # shortName de una FIBRA es su fiduciario
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
