"""Fórmula Mágica de Greenblatt (screener y cálculo por emisora) del legado.

Ojo: ``get_magic_one`` estima EBIT como EBITDA x 0.85 cuando no hay estado de resultados;
el v2 (``/v2/screeners/magic``) nunca mezcla EBIT estimado.

Movido sin cambios desde backend.py (fase S1): los cuerpos son idénticos al legado y los
goldens de tests/goldens_legacy lo prueban. La versión v2 se escribe al lado, no encima.

Al final del archivo, después de la línea de separación, vive la versión v2 (stream B3c) que sirve
``/v2/screeners/magic``. Convive con el legado en el mismo archivo porque ``scripts/ownership.json``
le da a B3c este archivo completo, y los goldens del legado exigen que lo de arriba no cambie.
"""

from __future__ import annotations


from concurrent.futures import ThreadPoolExecutor

from kaizen_api.cache import _cached
from kaizen_api.domain import _log, r2, safe
from kaizen_api.domain.universe import (
    EXCLUDED_SECTORS,
    MAGIC_EXCLUDED_SECTORS,
    MAGIC_UNIVERSE,
    SymbolData,
    Universe,
    column_date,
    fetch_symbols,
    get_universe,
    row_pick,
    row_value,
    sector_label,
)
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


# ─── v2 (B3c): la fórmula mágica honesta ──────────────────────────────────────
#
# Fórmula Mágica de Greenblatt para ``/v2/screeners/magic`` (stream B3c), sin EBIT inventado.
#
# La receta original de *The Little Book That Still Beats the Market* ordena por dos cosas y suma
# los lugares:
#
# * **Rendimiento de utilidades** ``EY = EBIT / valor de empresa``, con
#   ``valor de empresa = capitalización + deuda total + interés minoritario + acciones preferentes
#   menos efectivo``. El interés minoritario y las preferentes entran porque son parte del precio que
#   pagaría quien comprara la empresa completa.
# * **Rendimiento sobre capital** ``ROC = EBIT / (capital de trabajo neto + propiedad, planta y
#   equipo neta)``, donde el capital de trabajo neto **deja fuera el efectivo y la deuda de corto
#   plazo**: ninguno de los dos es capital que el negocio necesite para operar.
#
# Lo que esta versión hace distinto al legado:
#
# * **El EBIT es la utilidad de operación reportada** en el estado de resultados (renglón
#   "Operating Income"). El renglón "EBIT" de Yahoo es otra cosa: utilidad antes de impuestos más
#   intereses, que arrastra partidas no operativas (CMCSA 30.2 mil M contra 20.7 mil M de utilidad
#   de operación, APD negativo contra 2.89 mil M positivos). Solo se usa cuando la emisora no trae
#   utilidad de operación, y ``meta.notes`` dice cuáles fueron. El legado, cuando no encontraba
#   ninguno de los dos, usaba EBITDA por 0.85, que es un número inventado; aquí la emisora sale de
#   la lista con el motivo escrito.
# * **Un EBIT de cero o negativo sale de la lista**: con él, el rendimiento de utilidades y el
#   rendimiento sobre capital son negativos y ordenarlos junto a los positivos no significa nada.
#   Greenblatt tampoco los considera.
# * **Se excluyen bancos, aseguradoras, servicios públicos y bienes raíces (FIBRAs)**, como pide la
#   fórmula: su balance no se compara con el de una empresa operativa.
# * **Los empates son estables**: dos emisoras con el mismo valor reciben el mismo lugar (ranking de
#   competencia, 1-2-2-4) y el orden final desempata por el lugar de EY y luego por símbolo en orden
#   alfabético. En el legado los empates los decidía el orden en que contestaban los hilos.
# * **Nunca se mezclan monedas**: si la emisora reporta en una moneda y cotiza en otra (CEMEXCPO.MX
#   reporta en dólares y cotiza en pesos), no se puede dividir un EBIT en dólares entre un valor de
#   empresa en pesos. Sale de la lista con el motivo, hasta que exista la costura de tipo de cambio.



CACHE_TTL = 43200
CACHE_FAIL_TTL = 300

STATEMENTS = ("income_stmt", "balance_sheet")

MIN_MARKET_CAP = {"us": 2_000_000_000.0, "mx": 5_000_000_000.0}
"""Piso de capitalización por universo (USD para us, MXN para mx). Debajo, la cifra es ruido."""

OPERATING_INCOME_ROWS = ("Operating Income", "Total Operating Income As Reported")
"""La utilidad de operación: lo que Greenblatt llama EBIT. Siempre se prefiere."""
EBIT_FALLBACK_ROWS = ("EBIT", "Ebit")
"""El renglón "EBIT" de Yahoo (antes de impuestos más intereses). Solo de respaldo y anotado."""
EBIT_ROWS = OPERATING_INCOME_ROWS + EBIT_FALLBACK_ROWS
TOTAL_DEBT_ROWS = ("Total Debt",)
LONG_DEBT_ROWS = ("Long Term Debt And Capital Lease Obligation", "Long Term Debt")
CURRENT_DEBT_ROWS = ("Current Debt And Capital Lease Obligation", "Current Debt")
CASH_ROWS = ("Cash And Cash Equivalents", "Cash Cash Equivalents And Short Term Investments", "Cash Financial")
MINORITY_ROWS = ("Minority Interest", "Minority Interests")
PREFERRED_ROWS = ("Preferred Stock", "Preferred Securities Outside Stock Equity", "Preferred Stock Equity")
CURRENT_ASSETS_ROWS = ("Current Assets", "Total Current Assets")
CURRENT_LIABILITIES_ROWS = ("Current Liabilities", "Total Current Liabilities Net Minority Interest")
PPE_ROWS = ("Net PPE", "Net Property Plant And Equipment", "Properties", "Investment Properties")

UNIVERSE_DESCRIPTION = {
    "us": (
        "Emisoras grandes de Estados Unidos, sin bancos, servicios públicos ni bienes raíces. El "
        "EBIT es la utilidad de operación del estado de resultados anual más reciente y el valor "
        "de empresa sale de la capitalización de hoy."
    ),
    "mx": (
        "Emisoras grandes de la Bolsa Mexicana de Valores, sin bancos, servicios públicos ni "
        "FIBRAs. El EBIT es la utilidad de operación del estado de resultados anual más reciente "
        "y el valor de empresa sale de la capitalización de hoy."
    ),
}


def competition_ranks(pairs: list[tuple[str, float]], reverse: bool = True) -> dict[str, int]:
    """Lugares 1-2-2-4: el mismo valor recibe el mismo lugar y el siguiente salta.

    Así el resultado depende solo de los números, nunca del orden en que llegaron los datos.
    """
    ordered = sorted(pairs, key=lambda p: (-p[1] if reverse else p[1], p[0]))
    ranks: dict[str, int] = {}
    last_value: float | None = None
    last_rank = 0
    for position, (symbol, value) in enumerate(ordered, start=1):
        if last_value is not None and value == last_value:
            ranks[symbol] = last_rank
        else:
            ranks[symbol] = position
            last_rank = position
            last_value = value
    return ranks


def enterprise_value(market_cap: float, balance) -> float | None:
    """Capitalización + deuda + minoritario + preferentes menos efectivo, todo del mismo balance."""
    debt = row_value(balance, TOTAL_DEBT_ROWS)
    if debt is None:
        long_debt = row_value(balance, LONG_DEBT_ROWS)
        short_debt = row_value(balance, CURRENT_DEBT_ROWS)
        if long_debt is None and short_debt is None:
            return None
        debt = (long_debt or 0.0) + (short_debt or 0.0)
    cash = row_value(balance, CASH_ROWS) or 0.0
    minority = row_value(balance, MINORITY_ROWS) or 0.0
    preferred = row_value(balance, PREFERRED_ROWS) or 0.0
    return market_cap + debt + minority + preferred - cash


def capital_employed(balance) -> float | None:
    """Capital de trabajo neto (sin efectivo ni deuda de corto plazo) más PP&E neta."""
    current_assets = row_value(balance, CURRENT_ASSETS_ROWS)
    current_liabilities = row_value(balance, CURRENT_LIABILITIES_ROWS)
    ppe = row_value(balance, PPE_ROWS)
    if current_assets is None or current_liabilities is None or ppe is None:
        return None
    cash = row_value(balance, CASH_ROWS) or 0.0
    short_debt = row_value(balance, CURRENT_DEBT_ROWS) or 0.0
    working_capital = (current_assets - cash) - (current_liabilities - short_debt)
    return working_capital + ppe


def _sector_of(symbol: str, universe: Universe, data: SymbolData) -> str | None:
    member = universe.member(symbol)
    if member and member.sector:
        return member.sector
    return data.info.get("sector") or None


def _row_or_reason(symbol: str, universe: Universe, data: SymbolData, floor: float) -> tuple[dict | None, str | None]:
    """Devuelve ``(renglón, None)`` o ``(None, motivo de exclusión)``. Nunca inventa un EBIT."""
    if not data.ok:
        return None, "El proveedor no respondió para esta emisora."

    sector = _sector_of(symbol, universe, data)
    if sector in MAGIC_EXCLUDED_SECTORS:
        return None, f"La fórmula deja fuera el sector {sector_label(sector)}."

    if not data.same_currency:
        return None, (
            f"Reporta en {data.financial_currency} y cotiza en {data.currency}: falta el tipo de "
            "cambio para no mezclar monedas."
        )

    market_cap = safe(data.info.get("marketCap"))
    if market_cap is None or market_cap <= 0:
        return None, "Yahoo no trae la capitalización de mercado."
    if market_cap < floor:
        return None, "Capitalización por debajo del piso del universo."

    ebit, ebit_row = row_pick(data.income, EBIT_ROWS)
    if ebit is None:
        return None, "No hay EBIT reportado en el estado de resultados: no se estima."
    if ebit <= 0:
        return None, "La utilidad de operación no es positiva: la fórmula no aplica."

    ev = enterprise_value(market_cap, data.balance)
    if ev is None:
        return None, "Falta el balance para armar el valor de empresa."
    if ev <= 0:
        return None, "El valor de empresa no es positivo."

    capital = capital_employed(data.balance)
    if capital is None:
        return None, "Falta el balance para calcular el capital empleado."
    if capital <= 0:
        return None, "El capital empleado no es positivo: la fórmula no aplica."

    return {
        "symbol": symbol,
        "name": (universe.member(symbol).name if universe.member(symbol) else None)
        or data.info.get("longName")
        or data.info.get("shortName"),
        "sector": sector_label(sector),
        "ebit": ebit,
        "enterpriseValue": ev,
        "earningsYield": ebit / ev,
        "returnOnCapital": ebit / capital,
        "currency": data.financial_currency,
        "fiscalPeriodEnd": column_date(data.income),
        "_ebitRow": ebit_row,
        "_quoteDate": data.quote_date,
    }, None


def build(universe: Universe) -> dict:
    """Arma la tabla de la fórmula mágica de un universo ya resuelto. Sin caché ni HTTP propio."""
    # A las que el universo curado ya marca como banco o servicio público ni se les pregunta:
    # la fórmula no las usa y cada una cuesta tres llamadas a Yahoo.
    skipped = {
        m.symbol: f"La fórmula deja fuera el sector {sector_label(m.sector)}."
        for m in universe.members
        if m.sector in MAGIC_EXCLUDED_SECTORS
    }
    asked = [s for s in universe.symbols if s not in skipped]
    fetched, pending = fetch_symbols(asked, statements=STATEMENTS)
    floor = MIN_MARKET_CAP.get(universe.id, 0.0)

    rows: list[dict] = []
    excluded: list[dict] = []
    failures = 0
    for symbol in universe.symbols:
        if symbol in skipped:
            excluded.append({"symbol": symbol, "reason": skipped[symbol]})
            continue
        data = fetched.get(symbol)
        if data is None:
            excluded.append({"symbol": symbol, "reason": "El proveedor no respondió a tiempo."})
            failures += 1
            continue
        row, reason = _row_or_reason(symbol, universe, data, floor)
        if row is None:
            excluded.append({"symbol": symbol, "reason": reason})
            if not data.ok:
                failures += 1
            continue
        rows.append(row)

    rank_ey = competition_ranks([(r["symbol"], r["earningsYield"]) for r in rows])
    rank_roc = competition_ranks([(r["symbol"], r["returnOnCapital"]) for r in rows])
    for row in rows:
        row["rankEY"] = rank_ey[row["symbol"]]
        row["rankROC"] = rank_roc[row["symbol"]]
        row["rank"] = row["rankEY"] + row["rankROC"]
    rows.sort(key=lambda r: (r["rank"], r["rankEY"], r["symbol"]))

    partial = bool(pending) or failures > 0
    ebit_fallback = sorted(r["symbol"] for r in rows if r["_ebitRow"] in EBIT_FALLBACK_ROWS)
    quote_dates = sorted({r["_quoteDate"] for r in rows if r["_quoteDate"]})
    for row in rows:
        row.pop("_ebitRow", None)
        row.pop("_quoteDate", None)
    notes: list[str] = []
    if excluded:
        notes.append(f"{len(excluded)} de {universe.size} emisoras quedaron fuera, cada una con su motivo.")
    if partial:
        notes.append("Faltaron datos de algunas emisoras, así que la tabla está incompleta.")
    if ebit_fallback:
        notes.append(
            "Sin utilidad de operación reportada, se usó el renglón EBIT de Yahoo (antes de impuestos "
            "más intereses), que puede incluir partidas no operativas: " + ", ".join(ebit_fallback) + "."
        )
    periods = sorted({r["fiscalPeriodEnd"] for r in rows if r["fiscalPeriodEnd"]})
    if len(periods) > 1:
        notes.append(
            f"Los cierres fiscales van de {periods[0]} a {periods[-1]}: no todas comparan el mismo periodo."
        )
    as_of = quote_dates[-1] if quote_dates else (periods[-1] if periods else None)
    if quote_dates and periods:
        notes.append(
            f"La capitalización es del {quote_dates[-1]} y la utilidad de operación del cierre fiscal "
            f"más reciente de cada emisora (el último, {periods[-1]})."
        )
    return {
        "universe": {
            "id": universe.id,
            "name": universe.name,
            "size": universe.size,
            "description": UNIVERSE_DESCRIPTION.get(universe.id, universe.name),
        },
        "rows": rows,
        "excluded": excluded,
        "partial": partial,
        "notes": notes,
        "asOf": as_of,
    }


def get_magic(universe_id: str) -> dict:
    """Tabla de la fórmula mágica, cacheada 12 h por universo. Una tabla vacía solo se guarda 5 min."""
    universe = get_universe(universe_id)
    return _cached(
        "v2:magic:" + universe_id,
        lambda: build(universe),
        ttl=CACHE_TTL,
        fail_ttl=CACHE_FAIL_TTL,
        ok=lambda r: bool(r["rows"]) and not r["partial"],
    )
