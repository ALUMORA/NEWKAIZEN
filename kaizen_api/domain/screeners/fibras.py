"""Screener de FIBRAs mexicanas del legado (``get_fibras``).

Unidades del legado: porcentajes. El v2 (``/v2/screeners/fibras``) usa fracciones.

Movido sin cambios desde backend.py (fase S1): los cuerpos son idénticos al legado y los
goldens de tests/goldens_legacy lo prueban. La versión v2 se escribe al lado, no encima.

Al final del archivo, después de la línea de separación, vive la versión v2 (stream B3c) que sirve
``/v2/screeners/fibras``. Convive con el legado en el mismo archivo porque ``scripts/ownership.json``
le da a B3c este archivo completo, y los goldens del legado exigen que lo de arriba no cambie.
"""

from __future__ import annotations

import datetime as _dt
import re
import time
from concurrent.futures import ThreadPoolExecutor

from kaizen_api.cache import _cached
from kaizen_api.domain import _log, r2, safe
from kaizen_api.domain.fundamentals import _div_yield_pct, get_dividends
from kaizen_api.domain.history import _fetch_hist
from kaizen_api.domain.universe import (
    FIBRAS_LIST,
    SymbolData,
    column_date,
    fetch_symbols,
    get_fibras_universe,
    row_value,
)
from kaizen_api.provenance import utc_now
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
# * **El rendimiento por distribución es lo que se pagó**: la suma de los pagos de los últimos 12
#   meses entre el precio, con la costura de dividendos de B3a (la misma de
#   ``/v2/instrument/{sym}/dividends``). No el ``dividendYield`` de Yahoo, que va hacia adelante.
# * **El diferencial contra CETES** usa la tasa libre de riesgo del servidor (``/v2/rates/rf``), no
#   una referencia fija. Si esa tasa no son CETES de Banxico (hoy, sin token, es la interbancaria a
#   3 meses de la OCDE en FRED), la fuente entra a ``meta.source``, ``meta.fallback`` va en
#   ``true`` y ``meta.notes`` lo dice. El campo se sigue llamando ``cetes28`` porque así lo fija
#   el contrato.
# * **Estados ajenos o viejos no se publican.** Yahoo le sirve a varias FIBRAs los estados de su
#   fiduciario (FMTY14 y FHIPO14 traían el balance de Banco Invex al 2023-12-31) o cifras con otra
#   escala (DANHOS13, deuda mil veces menor). Antes de usar un estado se revisa contra lo que el
#   propio Yahoo dice de la FIBRA; si no cuadra, las métricas que salen de él van en ``null`` y
#   ``meta.notes`` dice por qué. Ver ``statement_problems``.
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
"""Fuentes que puede traer la tasa, como token de ``meta.source``. B2b las nombra con más detalle
(``fred_ir3tib``), así que se toma el prefijo."""

STALE_STATEMENT_DAYS = 548
"""18 meses. Un cierre anual más viejo que esto no describe a la FIBRA de hoy."""

SHARES_TOLERANCE = 0.20
"""CBFIs del balance contra los de Yahoo: más de 20 % de diferencia es otra entidad."""

DEBT_TOLERANCE = 0.50
"""Deuda del balance contra ``info.totalDebt``. El info es trimestral y el balance anual, así que se
deja holgura; más de 50 % ya no es el paso del tiempo sino otra escala u otra entidad."""

FIDUCIARY_WORDS = ("bank", "banco")
"""Si Yahoo clasifica la industria de una FIBRA como banco, los datos que sirve son del fiduciario.

El ``shortName`` no sirve para esto: en todas las FIBRAs es el banco fiduciario (Actinver, Invex,
CIBanco), sanas o no. La industria sí distingue: las sanas dicen "REIT - ..." y las que traen
estados ajenos dicen "Banks - Regional".
"""

DIVIDEND_WORKERS = 4
DIVIDEND_TIMEOUT = 30.0

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
    "stale": False,
    "note": "Todavía no hay tasa de CETES 28 en este servidor, así que el diferencial va en s/d.",
    "notes": [],
}


def cetes28() -> dict:
    """Tasa de referencia de corto plazo como fracción, con fecha, fuente y si es sustituta.

    Devuelve ``{"rate", "asOf", "source", "fallback", "stale", "note", "notes"}``. ``rate`` en
    ``None`` significa que la costura de B2b no dio tasa: el diferencial sale en s/d. ``notes`` son
    las de B2b, tal cual; ``note`` es la de este screener. Si la fuente no es Banxico la tasa se
    publica marcada como sustituta: no son CETES de 28 días y se dice.
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
        source, fallback, stale, tenor, upstream = None, False, False, None, []
        if isinstance(raw, dict):
            source = _source_token(raw.get("source"))
            fallback = bool(raw.get("fallback"))
            stale = bool(raw.get("stale"))
            tenor = safe(raw.get("tenorDays"))
            upstream = [n for n in (raw.get("notes") or []) if isinstance(n, str) and n]
        note = None
        if source != "banxico":
            fallback = True
            note = _substitute_note(source, tenor, as_of)
        return {
            "rate": rate, "asOf": as_of, "source": source, "fallback": fallback,
            "stale": stale, "note": note, "notes": upstream,
        }
    return dict(NO_RATE)


def _source_token(raw) -> str | None:
    """``fred_ir3tib`` a ``fred``, ``banxico`` a ``banxico``; lo que no se reconozca, ``None``."""
    text = str(raw or "").lower()
    for token in RATE_SOURCES:
        if text == token or text.startswith(token + "_"):
            return token
    return None


def _substitute_note(source: str | None, tenor: float | None, as_of: str | None) -> str:
    """La nota de que ``cetes28`` no son CETES de 28 días, con la serie que sí es."""
    fecha = f", dato del {as_of}" if as_of else ""
    if source == "fred":
        plazo = f"a {int(tenor)} días" if tenor else "de corto plazo"
        return (
            f"El campo cetes28 y el diferencial usan una tasa sustituta, no CETES de 28 días: la tasa "
            f"interbancaria de México {plazo} de la OCDE en FRED, promedio mensual{fecha}. Sirve como "
            "referencia de corto plazo mientras el servidor no tenga CETES de Banxico."
        )
    return (
        "El servidor no dijo de dónde sale la tasa de referencia, así que no se puede afirmar que "
        f"sean CETES de 28 días{fecha}. El diferencial se calcula contra ella."
    )


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


def nav_per_cbfi(data: SymbolData, use_balance: bool = True) -> float | None:
    """Valor en libros por CBFI: el ``bookValue`` de Yahoo y, si falta, capital entre CBFIs.

    Con ``use_balance`` en ``False`` (balance ajeno o viejo) solo vale el ``bookValue``.
    """
    book = safe(data.info.get("bookValue"))
    if book is not None and book > 0:
        return book
    if not use_balance:
        return None
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


def _today():
    """Fecha de hoy en UTC. Con el reloj congelado del replay, la del replay."""
    return utc_now().date()


def info_shares(info: dict) -> float | None:
    """CBFIs en circulación según Yahoo: ``sharesOutstanding`` y, si viene en 0, el implícito."""
    for key in ("sharesOutstanding", "impliedSharesOutstanding"):
        value = safe(info.get(key))
        if value is not None and value > 0:
            return value
    return None


def _millions(value: float) -> str:
    return f"{value / 1e6:,.1f} millones"


def _differs(a: float, b: float, tolerance: float) -> bool:
    """¿``a`` se aleja de ``b`` más que ``tolerance`` (fracción de ``b``)?"""
    return b > 0 and abs(a - b) / b > tolerance


def statement_problems(symbol: str, data: SymbolData, twins: list[str] | None = None) -> dict:
    """Revisa que los estados de Yahoo sean de esta FIBRA y de ahora.

    Devuelve ``{"foreign": [motivos], "debt": [motivos]}``. Con algún motivo en ``foreign`` no se usa
    ningún estado (ni balance, ni resultados, ni flujos): son de otra entidad o de otra época. Con
    motivos solo en ``debt``, lo que falla es la deuda del balance, así que salen en ``null`` las
    métricas que la usan (LTV, deuda entre capitalización y cap rate) y el flujo se queda.

    Criterios, del más directo al más indirecto:

    * Yahoo clasifica a la FIBRA como banco: sirve los datos del fiduciario.
    * Su balance es idéntico al de otra FIBRA de la tabla (``twins``): es el del fiduciario común.
    * El último cierre anual tiene más de 18 meses.
    * Los CBFIs del balance difieren más de 20 % de los que Yahoo reporta para la FIBRA.
    * La deuda del balance difiere más de 50 % de ``info.totalDebt``.
    """
    foreign: list[str] = []
    debt_issues: list[str] = []
    if data.balance is None and data.income is None and data.cashflow is None:
        return {"foreign": foreign, "debt": debt_issues}
    info = data.info
    industry = str(info.get("industry") or "")
    if any(word in industry.lower() for word in FIDUCIARY_WORDS):
        foreign.append(f"Yahoo la clasifica como banco ({industry}), así que sirve los datos del fiduciario")
    if twins:
        foreign.append(
            "su balance es idéntico al de " + ", ".join(twins) + ", así que es el del fiduciario que comparten"
        )
    closing = column_date(data.balance) or column_date(data.income) or column_date(data.cashflow)
    if closing:
        try:
            age = (_today() - _dt.date.fromisoformat(closing[:10])).days
        except ValueError:
            age = None
        if age is not None and age > STALE_STATEMENT_DAYS:
            foreign.append(f"su último cierre anual es del {closing}, de hace más de 18 meses")
    stmt_shares = row_value(data.balance, SHARES_ROWS)
    yahoo_shares = info_shares(info)
    if stmt_shares and yahoo_shares and _differs(stmt_shares, yahoo_shares, SHARES_TOLERANCE):
        foreign.append(
            f"su balance reporta {_millions(stmt_shares)} de CBFIs contra {_millions(yahoo_shares)} "
            "que Yahoo le cuenta a la FIBRA"
        )
    stmt_debt = total_debt(data.balance)
    yahoo_debt = safe(info.get("totalDebt"))
    if stmt_debt is not None and yahoo_debt and _differs(stmt_debt, yahoo_debt, DEBT_TOLERANCE):
        debt_issues.append(
            f"la deuda de su balance ({_millions(stmt_debt)}) no cuadra con la que Yahoo le reporta "
            f"({_millions(yahoo_debt)})"
        )
    return {"foreign": foreign, "debt": debt_issues}


def _twins(fetched: dict[str, SymbolData]) -> dict[str, list[str]]:
    """Para cada FIBRA, las otras de la tabla que traen exactamente el mismo balance."""
    usable = [
        (sym, data.balance) for sym, data in fetched.items()
        if data.ok and data.balance is not None and not getattr(data.balance, "empty", True)
    ]
    out: dict[str, list[str]] = {}
    for i, (sym_a, bal_a) in enumerate(usable):
        for sym_b, bal_b in usable[i + 1:]:
            try:
                same = bal_a.equals(bal_b)
            except Exception:
                same = False
            if same:
                out.setdefault(sym_a, []).append(sym_b)
                out.setdefault(sym_b, []).append(sym_a)
    return {sym: sorted(others) for sym, others in out.items()}


def _sentence(text: str) -> str:
    """Primera letra en mayúscula y punto final."""
    text = text.strip()
    if not text:
        return text
    return text[0].upper() + text[1:] + ("" if text.endswith(".") else ".")


ROW_METRICS = {
    "price": "precio",
    "marketCap": "capitalización",
    "distributionYield": "rendimiento por distribución",
    "capRate": "cap rate",
    "navPerCbfi": "NAV por CBFI",
    "pNav": "P/NAV",
    "ltv": "LTV",
    "debtToMarketCap": "deuda entre capitalización",
    "cashFlowYield": "flujo",
    "spreadVsCetes": "diferencial contra CETES",
}
"""Cifras de ``FibraRow`` que pueden ir en s/d, con su nombre en español para ``notes`` del renglón."""


def _labels(fields: list[str]) -> str:
    names = [ROW_METRICS[f] for f in fields]
    if len(names) == 1:
        return names[0]
    return ", ".join(names[:-1]) + " y " + names[-1]


def row_notes(row: dict, reasons: list[tuple[tuple[str, ...], str]]) -> list[str]:
    """``notes`` de un renglón: el motivo de cada s/d, sin símbolo y sin repetir cifras.

    ``reasons`` va en orden de prioridad: ``(cifras que explica, motivo)``. Cada motivo nombra solo
    las cifras que de verdad salieron en ``null`` y que ningún motivo anterior ya explicó. Lo que
    quede sin explicar al final se atribuye a que Yahoo no trae el dato, para que ninguna s/d se
    quede sin motivo escrito.
    """
    missing = [f for f in ROW_METRICS if row.get(f) is None]
    explained: set[str] = set()
    notes: list[str] = []
    for fields, why in reasons:
        mine = [f for f in missing if f in fields and f not in explained]
        if not mine:
            continue
        explained.update(mine)
        verb = "va" if len(mine) == 1 else "van"
        notes.append(_sentence(f"{_labels(mine)} {verb} en s/d porque {why}"))
    rest = [f for f in missing if f not in explained]
    if rest:
        verb = "va" if len(rest) == 1 else "van"
        notes.append(
            _sentence(f"{_labels(rest)} {verb} en s/d porque Yahoo no publica el dato con que se calcula")
        )
    return notes


def distributions(symbols: list[str]) -> tuple[dict[str, dict | None], list[str]]:
    """Pagos de 12 meses por FIBRA con la costura de dividendos de B3a (``get_dividends``).

    Devuelve ``({símbolo: respuesta o None}, [símbolos que fallaron])``. Una FIBRA que falla no
    tumba la tabla: su rendimiento va en ``null`` y la nota lo dice.
    """
    out: dict[str, dict | None] = {}
    failed: list[str] = []
    if not symbols:
        return out, failed
    pool = ThreadPoolExecutor(max_workers=max(1, min(DIVIDEND_WORKERS, len(symbols))))
    futures = [(sym, pool.submit(get_dividends, sym)) for sym in symbols]
    deadline = time.monotonic() + DIVIDEND_TIMEOUT
    try:
        for sym, fut in futures:
            try:
                out[sym] = fut.result(timeout=max(0.0, deadline - time.monotonic()))
            except Exception as exc:
                _log(f"fibras: dividendos de {sym} fallaron ({type(exc).__name__}: {str(exc)[:120]})")
                out[sym] = None
                failed.append(sym)
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    return out, failed


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


def _row(
    symbol: str,
    data: SymbolData | None,
    curated,
    rate: float | None,
    dividend: dict | None = None,
    problems: dict | None = None,
) -> dict:
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

    # Lo que se pagó en 12 meses entre el precio (costura de B3a), no el dividendYield de Yahoo.
    distribution_yield = safe(dividend.get("yield")) if dividend else None

    problems = problems or {}
    trusted = not problems.get("foreign")
    debt_ok = trusted and not problems.get("debt")
    balance = data.balance if trusted else None
    income = data.income if trusted else None
    cashflow = data.cashflow if trusted else None

    assets = row_value(balance, TOTAL_ASSETS_ROWS)
    debt = total_debt(balance) if debt_ok else None
    ltv = debt / assets if (debt is not None and assets and assets > 0) else None

    debt_to_cap = None
    if same and debt is not None and market_cap and market_cap > 0:
        debt_to_cap = debt / market_cap

    nav = nav_per_cbfi(data, use_balance=trusted) if same else None
    p_nav = price / nav if (price and nav and nav > 0) else None

    cap_rate = None
    if same:
        noi = row_value(income, NOI_ROWS)
        cash = row_value(balance, CASH_ROWS) or 0.0
        if noi is not None and market_cap and debt is not None:
            ev = market_cap + debt - cash
            if ev > 0:
                cap_rate = noi / ev

    cf_yield, cf_basis = (None, None)
    if same and cashflow is not None:
        cf_yield, cf_basis = cash_flow_yield(data, market_cap)

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
    answered = [s for s in symbols if fetched.get(s) is not None and fetched[s].ok]
    dividends, failed = distributions(answered)
    twins = _twins({s: fetched[s] for s in answered})
    problems = {s: statement_problems(s, fetched[s], twins.get(s)) for s in answered}

    rows = [
        _row(sym, fetched.get(sym), universe.member(sym), rate, dividends.get(sym), problems.get(sym))
        for sym in symbols
    ]
    no_payments = {
        s for s in answered
        if s not in failed and (not dividends.get(s) or dividends[s].get("yield") is None)
    }
    for row in rows:
        sym = row["symbol"]
        data = fetched.get(sym)
        reasons: list[tuple[tuple[str, ...], str]] = []
        if data is None or not data.ok:
            reasons.append((
                tuple(ROW_METRICS),
                "el proveedor no respondió por esta FIBRA" if sym in pending or data is None
                else "Yahoo no devolvió datos de esta FIBRA",
            ))
        else:
            found = problems.get(sym) or {}
            if found.get("foreign"):
                reasons.append((
                    ("ltv", "debtToMarketCap", "capRate", "cashFlowYield", "navPerCbfi", "pNav"),
                    "los estados financieros que publica Yahoo no son de esta FIBRA o ya no la describen: "
                    + "; ".join(found["foreign"]),
                ))
            elif found.get("debt"):
                reasons.append((("ltv", "debtToMarketCap", "capRate"), "; ".join(found["debt"])))
            if not data.same_currency:
                reasons.append((
                    ("navPerCbfi", "pNav", "capRate", "debtToMarketCap", "cashFlowYield"),
                    f"reporta en {data.financial_currency} y cotiza en {data.currency}, y no se mezclan monedas",
                ))
            if sym in failed:
                reasons.append((
                    ("distributionYield", "spreadVsCetes"), "no se pudo leer su historia de pagos"
                ))
            elif sym in no_payments:
                reasons.append((
                    ("distributionYield", "spreadVsCetes"), "Yahoo no publica pagos de esta FIBRA en 12 meses"
                ))
            if rate is None:
                reasons.append((("spreadVsCetes",), "el servidor no tiene tasa de referencia de CETES"))
            reasons.append((("price", "pNav"), "Yahoo no trae su precio ni su último cierre"))
            reasons.append((
                ("navPerCbfi", "pNav"),
                "Yahoo no publica su valor en libros por CBFI ni el capital y los CBFIs para calcularlo",
            ))
        row["notes"] = row_notes(row, reasons)
    rows.sort(key=lambda r: (r["pNav"] is None, r["pNav"] or 0.0, r["symbol"]))

    notes: list[str] = [
        "El NAV por CBFI es el valor en libros que reporta la FIBRA, no un avalúo independiente. "
        "Bajo IFRS los inmuebles ya van a valor razonable, así que se le parece, pero no es lo mismo.",
        "Señal por P/NAV: descuento abajo de 0.90, prima arriba de 1.10 y en línea entre las dos. "
        "Es una descripción del precio contra libros, no una recomendación de inversión.",
        "El rendimiento por distribución suma lo que cada FIBRA pagó en los últimos 12 meses y lo "
        "divide entre el precio de hoy; no es el rendimiento proyectado que publica Yahoo.",
    ]
    if cetes["note"]:
        notes.append(cetes["note"])
    notes.extend(n for n in cetes.get("notes") or [] if n not in notes)
    for sym in answered:
        found = problems[sym]
        if found["foreign"]:
            notes.append(
                f"{sym}: LTV, deuda entre capitalización, cap rate y flujo van en s/d porque los "
                "estados financieros que publica Yahoo no son de esta FIBRA o ya no la describen. "
                + _sentence("; ".join(found["foreign"]))
            )
        elif found["debt"]:
            notes.append(
                f"{sym}: LTV, deuda entre capitalización y cap rate van en s/d porque "
                + "; ".join(found["debt"]) + "."
            )
    if failed:
        notes.append(
            "No se pudo leer la historia de pagos, así que el rendimiento por distribución y el "
            "diferencial van en s/d: " + ", ".join(sorted(failed)) + "."
        )
    no_history = [
        s for s in answered
        if s not in failed and (not dividends.get(s) or dividends[s].get("yield") is None)
    ]
    if no_history:
        notes.append(
            "Yahoo no publica pagos de estas FIBRAs, así que su rendimiento por distribución y su "
            "diferencial van en s/d: " + ", ".join(sorted(no_history)) + "."
        )
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

    periods = sorted({
        d for d in (column_date(fetched[s].balance) for s in answered if not problems[s]["foreign"]) if d
    })
    quotes = sorted({d for d in (fetched[s].quote_date for s in answered) if d})
    as_of = quotes[-1] if quotes else (cetes["asOf"] or (periods[-1] if periods else None))
    if quotes and (cetes["asOf"] or periods):
        parts = [f"Los precios son del {quotes[-1]}"]
        if cetes["asOf"]:
            parts.append(f"la tasa de referencia, del {cetes['asOf']}")
        if periods:
            parts.append(f"los estados financieros cierran a más tardar el {periods[-1]}")
        notes.append("; ".join(parts) + ".")
    return {
        "rows": rows,
        "cetes28": rate,
        "notes": notes,
        "asOf": as_of,
        "rateSource": cetes["source"],
        "rateFallback": cetes["fallback"],
        "rateStale": bool(cetes.get("stale")),
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
