"""Screener de FIBRAs mexicanas del legado (``get_fibras``).

Unidades del legado: porcentajes. El v2 (``/v2/screeners/fibras``) usa fracciones.

Movido sin cambios desde backend.py (fase S1): los cuerpos son idénticos al legado y los
goldens de tests/goldens_legacy lo prueban. La versión v2 se escribe al lado, no encima.

Al final del archivo, después de la línea de separación, vive la versión v2 (stream B3c) que sirve
``/v2/screeners/fibras``. Convive con el legado en el mismo archivo porque ``scripts/ownership.json``
le da a B3c este archivo completo, y los goldens del legado exigen que lo de arriba no cambie.
"""

from __future__ import annotations

import re

from kaizen_api.cache import _cached
from kaizen_api.domain import _log, r2, safe
from kaizen_api.domain.fundamentals import _div_yield_pct
from kaizen_api.domain.history import _fetch_hist
from kaizen_api.domain.universe import (
    FIBRAS_LIST,
    SymbolData,
    column_date,
    fetch_symbols,
    get_fibras_universe,
    row_value,
)
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


# ─── v2 (B3c): FIBRAs con las métricas que sí aplican ─────────────────────────
#
# Screener de FIBRAs de ``/v2/screeners/fibras`` (stream B3c), con las métricas que sí aplican.
#
# Lo que el legado tenía mal y aquí queda corregido:
#
# * **LTV** es ``deuda total / activos totales``, que es como lo reporta la propia FIBRA y como lo
#   pide el mercado. El legado calculaba ``deuda / (deuda + capitalización)``, que es otra cosa: un
#   apalancamiento contra valor de mercado que sube y baja con el precio del CBFI. Ese ratio sigue
#   aquí, pero con su nombre: ``debtToMarketCap``.
# * **El flujo no se llama FFO.** El legado publicaba el flujo libre de caja bajo la etiqueta "FFO
#   yield". El FFO de un REIT es utilidad neta más depreciación menos ganancias por venta de
#   inmuebles, y en una FIBRA bajo IFRS la revaluación a valor razonable pasa por la utilidad neta,
#   así que "utilidad más depreciación" no da un FFO. Aquí se publica el flujo de operación (o el
#   libre, si no hay de operación) con la base escrita en ``cashFlowBasis``.
# * **Nada se inventa.** Rendimiento por distribución, cap rate y NAV salen solo cuando hay dato
#   real; si no, van en ``null`` y la interfaz muestra "s/d".
# * **El diferencial contra CETES** usa la tasa de CETES 28 del servidor, no una referencia fija.
#
# La señal es descriptiva, no una recomendación: ``descuento`` cuando el precio está debajo del
# 90 % del valor en libros por CBFI, ``prima`` arriba del 110 %, ``en_linea`` entre los dos y
# ``sin_datos`` cuando no hay NAV. El valor en libros no es un avalúo, pero bajo IFRS las FIBRAs
# cargan sus inmuebles a valor razonable, así que se le parece bastante; ``meta.notes`` lo dice.



CACHE_TTL = 43200
CACHE_FAIL_TTL = 300

STATEMENTS = ("income_stmt", "balance_sheet", "cashflow")

DISCOUNT_BELOW = 0.90
PREMIUM_ABOVE = 1.10

TOTAL_ASSETS_ROWS = ("Total Assets",)
TOTAL_DEBT_ROWS = ("Total Debt",)
LONG_DEBT_ROWS = ("Long Term Debt And Capital Lease Obligation", "Long Term Debt")
CURRENT_DEBT_ROWS = ("Current Debt And Capital Lease Obligation", "Current Debt")
CASH_ROWS = ("Cash And Cash Equivalents", "Cash Cash Equivalents And Short Term Investments", "Cash Financial")
EQUITY_ROWS = ("Stockholders Equity", "Common Stock Equity", "Total Equity Gross Minority Interest")
SHARES_ROWS = ("Ordinary Shares Number", "Share Issued")
NOI_ROWS = ("Operating Income", "Total Operating Income As Reported", "EBIT")
OCF_ROWS = ("Operating Cash Flow", "Cash Flow From Continuing Operating Activities")
FCF_ROWS = ("Free Cash Flow",)

RATE_SOURCES = frozenset({"banxico", "fred"})
"""Fuentes que puede traer la tasa; cualquier otra cosa no se copia a ``meta.source``."""

RF_FUNCTIONS = ("get_cetes28", "get_rf_current", "get_rf_series", "get_rf_v2")
"""Nombres con los que B2b puede publicar el CETES 28 en ``domain/rates.py``.

La costura está documentada en ``docs/OWNERSHIP.md`` como "B2b ``domain/rates.py``, rf CETES 28",
pero sin nombre de función, y B2b trabaja en paralelo. Se prueban estos nombres en orden y, si
ninguno existe todavía, el diferencial sale en ``null`` con su nota. Nunca se usa el 8.6 % fijo del
legado, que es justo lo que este proyecto vino a quitar. El pedido con el nombre exacto está en
``docs/requests/B3c.md``.
"""


NO_RATE = {
    "rate": None,
    "asOf": None,
    "source": None,
    "fallback": False,
    "note": "Todavía no hay tasa de CETES 28 en este servidor, así que el diferencial va en s/d.",
}


def cetes28() -> dict:
    """Tasa anual de CETES 28 como fracción, con su fecha, su fuente y si es un sustituto.

    Devuelve ``{"rate", "asOf", "source", "fallback", "note"}``. ``rate`` en ``None`` significa que
    la costura de B2b todavía no existe: el diferencial sale en s/d y la nota lo explica.
    """
    from kaizen_api.domain import rates

    for name in RF_FUNCTIONS:
        fn = getattr(rates, name, None)
        if not callable(fn):
            continue
        try:
            raw = fn()
        except Exception as exc:
            _log(f"fibras: {name}() falló ({str(exc)[:120]})")
            continue
        rate, as_of = _read_rate(raw)
        if rate is None:
            continue
        source, fallback = None, False
        if isinstance(raw, dict):
            candidate = str(raw.get("source") or "").lower()
            if candidate in RATE_SOURCES:
                source = candidate
            fallback = bool(raw.get("fallback"))
        return {"rate": rate, "asOf": as_of, "source": source, "fallback": fallback, "note": None}
    return dict(NO_RATE)


def _read_rate(raw) -> tuple[float | None, str | None]:
    """Saca ``(tasa, fecha)`` de lo que devuelva la función de tasas: dict, serie o número."""
    if raw is None:
        return None, None
    if isinstance(raw, int | float):
        value, as_of = safe(raw), None
    elif isinstance(raw, dict):
        for key in ("rate", "value", "yield", "annual", "last"):
            if key in raw:
                value = safe(raw[key])
                break
        else:
            value = None
        as_of = raw.get("asOf") or raw.get("as_of") or raw.get("date")
        points = raw.get("values") or raw.get("series")
        dates = raw.get("dates")
        if value is None and isinstance(points, list) and points:
            value = safe(points[-1])
            if as_of is None and isinstance(dates, list) and dates:
                as_of = dates[-1]
    else:
        value, as_of = safe(getattr(raw, "rate", None)), getattr(raw, "as_of", None)
    if value is None:
        return None, None
    if value > 1.0:  # alguien la entregó en porcentaje; el contrato v2 pide fracción
        value = value / 100.0
    if not 0.0 < value < 0.5:
        return None, None
    return value, (str(as_of)[:10] if as_of else None)


def total_debt(balance) -> float | None:
    """Deuda total del balance; si no viene el renglón, la suma de largo y corto plazo."""
    debt = row_value(balance, TOTAL_DEBT_ROWS)
    if debt is not None:
        return debt
    long_debt = row_value(balance, LONG_DEBT_ROWS)
    short_debt = row_value(balance, CURRENT_DEBT_ROWS)
    if long_debt is None and short_debt is None:
        return None
    return (long_debt or 0.0) + (short_debt or 0.0)


def nav_per_cbfi(data: SymbolData) -> float | None:
    """Valor en libros por CBFI: el ``bookValue`` de Yahoo y, si falta, capital entre CBFIs."""
    book = safe(data.info.get("bookValue"))
    if book is not None and book > 0:
        return book
    equity = row_value(data.balance, EQUITY_ROWS)
    shares = safe(data.info.get("sharesOutstanding")) or row_value(data.balance, SHARES_ROWS)
    if equity and shares and shares > 100 and equity > 0:
        return equity / shares
    return None


def cash_flow_yield(data: SymbolData, market_cap: float | None) -> tuple[float | None, str | None]:
    """Flujo entre capitalización, con la base escrita. Nunca se le llama FFO."""
    if not market_cap or market_cap <= 0:
        return None, None
    ocf = row_value(data.cashflow, OCF_ROWS)
    if ocf is not None:
        return ocf / market_cap, "ocf"
    fcf = row_value(data.cashflow, FCF_ROWS)
    if fcf is not None:
        return fcf / market_cap, "fcf"
    return None, None


def classify(data: SymbolData, curated_type: str | None) -> str:
    """Tipo de FIBRA: manda la lista curada y, para las que manden de más, la industria de Yahoo."""
    if curated_type:
        return curated_type
    industry = (data.info.get("industry") or "").lower() if data.ok else ""
    if "mortgage" in industry or "hipotec" in industry:
        return "hipotecaria"
    if "reit" in industry or "real estate" in industry:
        return "propiedades"
    if "energy" in industry or "pipeline" in industry or "utilit" in industry:
        return "energia"
    return "otro"


def signal_of(p_nav: float | None) -> str:
    """Señal descriptiva por P/NAV. Sin NAV no hay señal: ``sin_datos``."""
    if p_nav is None or p_nav <= 0:
        return "sin_datos"
    if p_nav < DISCOUNT_BELOW:
        return "descuento"
    if p_nav > PREMIUM_ABOVE:
        return "prima"
    return "en_linea"


def _price_of(data: SymbolData) -> float | None:
    """Precio del CBFI: el de ``info`` y, si falta, el último cierre (costura de historia de B2a)."""
    price = safe(data.info.get("currentPrice") or data.info.get("regularMarketPrice"))
    if price is not None and price > 0:
        return price
    hist = _fetch_hist(data.symbol)
    try:
        if hist is not None and not hist.empty:
            return safe(float(hist["Close"].iloc[-1]))
    except Exception:
        return None
    return None


def _row(symbol: str, data: SymbolData | None, curated, rate: float | None) -> dict:
    name = curated.name if curated else None
    if data is None or not data.ok:
        return {
            "symbol": symbol, "name": name, "price": None, "currency": "MXN",
            "financialCurrency": None, "marketCap": None, "distributionYield": None,
            "capRate": None, "navPerCbfi": None, "pNav": None, "ltv": None,
            "debtToMarketCap": None, "cashFlowYield": None, "cashFlowBasis": None,
            "spreadVsCetes": None, "signal": "sin_datos",
            "type": classify(data, curated.type if curated else None) if data else (
                (curated.type if curated else None) or "otro"
            ),
        }

    info = data.info
    currency = data.currency or "MXN"
    fin_currency = data.financial_currency
    same = data.same_currency
    price = _price_of(data)
    market_cap = safe(info.get("marketCap"))

    div = _div_yield_pct(info)
    distribution_yield = div / 100.0 if div is not None else None

    assets = row_value(data.balance, TOTAL_ASSETS_ROWS)
    debt = total_debt(data.balance)
    ltv = debt / assets if (debt is not None and assets and assets > 0) else None

    debt_to_cap = None
    if same and debt is not None and market_cap and market_cap > 0:
        debt_to_cap = debt / market_cap

    nav = nav_per_cbfi(data) if same else None
    p_nav = price / nav if (price and nav and nav > 0) else None

    cap_rate = None
    if same:
        noi = row_value(data.income, NOI_ROWS)
        cash = row_value(data.balance, CASH_ROWS) or 0.0
        if noi is not None and market_cap and debt is not None:
            ev = market_cap + debt - cash
            if ev > 0:
                cap_rate = noi / ev

    cf_yield, cf_basis = cash_flow_yield(data, market_cap) if same else (None, None)

    spread = None
    if distribution_yield is not None and rate is not None:
        spread = distribution_yield - rate

    return {
        "symbol": symbol,
        "name": name or info.get("longName") or symbol,  # shortName de una FIBRA es su fiduciario
        "price": price,
        "currency": currency,
        "financialCurrency": fin_currency,
        "marketCap": market_cap,
        "distributionYield": distribution_yield,
        "capRate": cap_rate,
        "navPerCbfi": nav,
        "pNav": p_nav,
        "ltv": ltv,
        "debtToMarketCap": debt_to_cap,
        "cashFlowYield": cf_yield,
        "cashFlowBasis": cf_basis,
        "spreadVsCetes": spread,
        "signal": signal_of(p_nav),
        "type": classify(data, curated.type if curated else None),
    }


def build(extra: list[str] | None = None) -> dict:
    """Arma la tabla de FIBRAs. ``extra`` agrega símbolos que no están en la lista curada."""
    universe = get_fibras_universe()
    symbols = list(universe.symbols)
    for sym in extra or []:
        sym = sym.upper()
        if "." not in sym:
            sym += ".MX"
        if sym not in symbols:
            symbols.append(sym)

    fetched, pending = fetch_symbols(symbols, statements=STATEMENTS)
    cetes = cetes28()
    rate = cetes["rate"]

    rows = [_row(sym, fetched.get(sym), universe.member(sym), rate) for sym in symbols]
    rows.sort(key=lambda r: (r["pNav"] is None, r["pNav"] or 0.0, r["symbol"]))

    notes: list[str] = [
        "El NAV por CBFI es el valor en libros que reporta la FIBRA, no un avalúo independiente. "
        "Bajo IFRS los inmuebles ya van a valor razonable, así que se le parece, pero no es lo mismo.",
        "Señal por P/NAV: descuento abajo de 0.90, prima arriba de 1.10 y en línea entre las dos. "
        "Es una descripción del precio contra libros, no una recomendación de inversión.",
    ]
    if cetes["note"]:
        notes.append(cetes["note"])
    if pending:
        notes.append("El proveedor no respondió por: " + ", ".join(sorted(pending)) + ".")
    missing = [r["symbol"] for r in rows if r["signal"] == "sin_datos"]
    if missing:
        notes.append("Sin NAV para calcular P/NAV: " + ", ".join(missing) + ".")
    mixed = [
        r["symbol"] for r in rows
        if r["financialCurrency"] and r["financialCurrency"] != r["currency"]
    ]
    if mixed:
        notes.append(
            "Reportan en otra moneda que la de cotización, así que sus razones quedan en s/d: "
            + ", ".join(mixed)
            + "."
        )
    if any(r["cashFlowBasis"] == "fcf" for r in rows):
        notes.append(
            "Donde no hubo flujo de operación se usó el flujo libre de caja; la base va en cada renglón."
        )

    periods = sorted({d for d in (column_date(v.balance) for v in fetched.values() if v.ok) if d})
    return {
        "rows": rows,
        "cetes28": rate,
        "notes": notes,
        "asOf": cetes["asOf"] or (periods[-1] if periods else None),
        "rateSource": cetes["source"],
        "rateFallback": cetes["fallback"],
    }


def get_fibras_v2(extra: list[str] | None = None) -> dict:
    """Tabla de FIBRAs, cacheada 12 h. La lista curada y los extras se cachean por separado."""
    key = "v2:fibras"
    if extra:
        key += ":" + ",".join(sorted(s.upper() for s in extra))
    return _cached(
        key,
        lambda: build(extra),
        ttl=CACHE_TTL,
        fail_ttl=CACHE_FAIL_TTL,
        ok=lambda r: any(row["price"] is not None for row in r["rows"]),
    )
