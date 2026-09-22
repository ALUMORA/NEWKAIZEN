"""Valuación relativa por múltiplos sectoriales (``get_dcf`` del legado, tablas incluidas).

Pese al nombre, ``get_dcf`` NO es un DCF: son múltiplos. El DCF v2 vive en ``valuation/dcf.py``.

Movido sin cambios desde backend.py (fase S1): los cuerpos son idénticos al legado y los
goldens de tests/goldens_legacy lo prueban. La versión v2 se escribe al lado, no encima.
"""

from kaizen_api.domain import _log, r2, safe
from kaizen_api.providers.yahoo.session import yft


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
        fx_ok   = True  # False si hace falta convertir y no hubo tipo de cambio

        if price_currency != financial_currency:
            fx_ok = False
            pair = f"{financial_currency}{price_currency}=X"
            try:
                fx_hist = yft(pair).history(period="2d")
                if not fx_hist.empty:
                    fx_rate = float(fx_hist["Close"].iloc[-1])
                    fx_ok = True
                    fx_note = (f"Financieros en {financial_currency} → {price_currency} "
                               f"(1 {financial_currency} = {fx_rate:.2f} {price_currency})")
            except Exception as e:
                _log(f"dcf {ticker}: sin tipo de cambio {pair} ({e})")
            if not fx_ok:
                # Sin FX, los agregados quedarían en la moneda equivocada con fx_rate = 1:
                # se omiten P/FCF y EV/EBITDA en vez de dar objetivos falsos.
                fx_note = f"Sin tipo de cambio {financial_currency}→{price_currency}: se omiten P/FCF y EV/EBITDA"

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
        # Sin acciones en circulación no hay cifras por acción: None, nunca 1
        # (con 1 el FCF total se volvía "FCF por acción" y el objetivo salía absurdo).
        shares = safe(info.get("sharesOutstanding"))
        if not shares or shares <= 0:
            try:
                shares = safe(getattr(t.fast_info, "shares", None))
            except Exception:
                shares = None
        if not shares or shares <= 0:
            shares = None

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
        fcf_ps  = (fcf / shares) if (fcf and shares and fx_ok) else None

        ev_fin = safe(info.get("enterpriseValue"))
        ev     = (ev_fin * fx_rate) if (ev_fin is not None and fx_rate != 1.0) else ev_fin
        if not fx_ok:
            ev = None
        cash_l = (safe(info.get("totalCash")) or 0) * fx_rate
        debt_l = (safe(info.get("totalDebt")) or 0) * fx_rate
        ev_eb  = safe(info.get("enterpriseToEbitda"))  # ratio puro, sin conversión
        net_cash_ps = (cash_l - debt_l) / shares if shares else None

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

        if ev_eb and 0 < ev_eb < 80 and ev and shares:
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


# ─── v2: múltiplos relativos con referencia de Damodaran ─────────────────────
#
# Lo de arriba es el legado y se queda igual (los goldens lo prueban). Lo de abajo es el v2 de
# /v2/valuation: se llama "múltiplos relativos" y NUNCA "DCF", porque no descuenta nada.

from kaizen_api.domain.valuation.inputs import ValuationInputs  # noqa: E402
from kaizen_api.domain.valuation.params import Classification, SectorBenchmark  # noqa: E402

METHOD_LABELS = {
    "pe": "Precio / utilidad",
    "pb": "Precio / valor en libros",
    "evEbitda": "Valor empresa / EBITDA",
    "pfcf": "Precio / flujo libre",
}


def enterprise_value(inputs: ValuationInputs) -> float | None:
    """``capitalización + deuda + minoritarios − efectivo``, todo en MONEDA DE COTIZACIÓN.

    La capitalización ya viene en esa moneda; la deuda, los minoritarios y el efectivo salen del
    balance, así que pasan por ``to_price()`` antes de sumarse. Sin tipo de cambio no hay EV.
    """
    if not inputs.market_cap or inputs.total_debt is None:
        return None
    debt = inputs.to_price(inputs.total_debt)
    if debt is None:
        return None
    return debt + inputs.market_cap + (inputs.to_price(inputs.minority_interest) or 0.0) - (inputs.to_price(inputs.cash) or 0.0)


def _method(id_: str, current: float | None, benchmark: float | None, implied: float | None, ok: bool) -> dict:
    return {
        "id": id_,
        "label": METHOD_LABELS[id_],
        "current": round(current, 4) if current is not None else None,
        "benchmark": round(benchmark, 4) if benchmark is not None else None,
        "impliedPrice": round(implied, 4) if (ok and implied is not None and implied > 0) else None,
        "applicable": bool(ok and implied is not None and implied > 0),
    }


def relative_multiples(
    inputs: ValuationInputs,
    bench: SectorBenchmark,
    classification: Classification,
    *,
    missing_note: str | None = None,
) -> tuple[dict, list[str]]:
    """Bloque ``multiples`` del contrato más las notas en español que lo explican.

    ``applicable=False`` (con razón) en bancos, aseguradoras, FIBRAs/REIT, fondos y cuando las
    utilidades son negativas: ahí un múltiplo de utilidad no significa nada. Los valores actuales
    se siguen publicando para que la UI los muestre, pero sin precio implícito ni rango.
    """
    notes: list[str] = []
    reason = classification.multiples_reason
    negative_earnings = inputs.eps is not None and inputs.eps <= 0
    if reason is None and negative_earnings:
        reason = (
            "Las utilidades de los últimos doce meses son negativas: un múltiplo de utilidad sobre "
            "una pérdida no dice nada, así que no se publica precio implícito."
        )
    applicable = reason is None

    price = inputs.price
    shares = inputs.shares if (inputs.shares or 0) > 0 else None
    ev = enterprise_value(inputs)

    pe_current = price / inputs.eps if (price and inputs.eps and inputs.eps > 0) else None
    pe_implied = inputs.eps * bench.pe if (inputs.eps and inputs.eps > 0 and bench.pe) else None

    pb_current = price / inputs.bvps if (price and inputs.bvps and inputs.bvps > 0) else None
    pb_implied = inputs.bvps * bench.pb if (inputs.bvps and inputs.bvps > 0 and bench.pb) else None

    ebitda = inputs.to_price(inputs.ebitda)
    ev_ebitda_current = ev / ebitda if (ev and ebitda and ebitda > 0) else None
    ev_implied = None
    if bench.ev_ebitda and ebitda and ebitda > 0 and shares and inputs.total_debt is not None:
        debt = inputs.to_price(inputs.total_debt)
        if debt is not None:
            target_ev = bench.ev_ebitda * ebitda
            equity = (
                target_ev - debt - (inputs.to_price(inputs.minority_interest) or 0.0)
                + (inputs.to_price(inputs.cash) or 0.0)
            )
            ev_implied = equity / shares

    fcf_price = inputs.to_price(inputs.free_cash_flow)
    fcf_ps = fcf_price / shares if (fcf_price and shares) else None
    pfcf_current = price / fcf_ps if (price and fcf_ps and fcf_ps > 0) else None

    methods = [
        _method("pe", pe_current, bench.pe, pe_implied, applicable),
        _method("pb", pb_current, bench.pb, pb_implied, applicable),
        _method("evEbitda", ev_ebitda_current, bench.ev_ebitda, ev_implied, applicable),
        _method("pfcf", pfcf_current, None, None, False),
    ]
    if missing_note:
        notes.append(missing_note)

    implied = sorted(m["impliedPrice"] for m in methods if m["impliedPrice"] is not None)
    fair_range = None
    if implied:
        mid = implied[len(implied) // 2] if len(implied) % 2 else (implied[len(implied) // 2 - 1] + implied[len(implied) // 2]) / 2
        fair_range = {"low": round(implied[0], 4), "mid": round(mid, 4), "high": round(implied[-1], 4)}
    elif applicable:
        notes.append("No hubo datos suficientes para un precio implícito por múltiplos.")

    if applicable:
        notes.append(bench.method + ".")
    return (
        {
            "applicable": applicable,
            "reason": reason,
            "market": bench.market,
            "source": f"Damodaran, datasets de enero 2026 ({bench.market})",
            "asOf": bench.as_of,
            "methods": methods,
            "fairValueRange": fair_range,
        },
        notes,
    )
