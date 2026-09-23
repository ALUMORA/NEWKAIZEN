"""Arma la respuesta de ``GET /v2/valuation/{symbol}``: múltiplos, DCF y P/VL de bancos.

Aquí se juntan las tres piezas: los insumos de la emisora (``inputs.py``), los parámetros de
mercado (``params.py``) y las matemáticas (``dcf.py``). Este módulo decide qué aplica y qué no, y
deja por escrito en español cada supuesto que se movió.

Reglas que no se negocian:

* Los múltiplos se llaman "múltiplos relativos", nunca "DCF". Son dos bloques distintos.
* Nada de valores fijos silenciosos: sin ninguna tasa libre de riesgo real, la ruta responde 503.
  Si falta solo la de la moneda en que reporta la empresa (un ADR de Taiwán), los múltiplos salen
  igual y el DCF sale con ``applicable=false`` y su razón.
* Todo porcentaje sale como fracción. Los múltiplos y el P/VL van en moneda de cotización; el
  bloque del DCF va en la moneda en la que la empresa REPORTA, que es la de sus flujos, y lo dice
  en ``dcf.inputs.currency`` y en un aviso de ``dcf.warnings`` con la conversión.
* Yahoo y FRED se leen una vez por emisora y por moneda (``_load_inputs`` y ``_risk_free``, con
  caché); los parámetros de la consulta solo mueven la capa de cálculo, que es barata.
* Ningún texto sugiere comprar ni vender.
"""

from __future__ import annotations

import datetime as _dt
from copy import deepcopy

from kaizen_api.cache import _cached
from kaizen_api.domain.valuation import dcf as dcf_math
from kaizen_api.domain.valuation import inputs as inputs_mod
from kaizen_api.domain.valuation import params as params_mod
from kaizen_api.domain.valuation.multiples import relative_multiples
from kaizen_api.errors import ApiError
from kaizen_api.http_cache import CACHE_SECONDS

DEFAULT_YEARS = 5
DEFAULT_LAMBDA = 1.0
MIN_INDUSTRY_SPREAD = 0.005
"""Piso del diferencial de crédito de la industria sobre la tasa libre de riesgo."""

DELAY_MINUTES = 15
"""Retraso típico de Yahoo en cotizaciones de mercado."""

INPUTS_TTL = CACHE_SECONDS["fundamentals"]
"""Los estados financieros cambian una vez por trimestre: seis horas de caché por emisora."""

RF_TTL = CACHE_SECONDS["macro"]
"""La tasa libre de riesgo se relee cada hora. Un fallo solo se recuerda un minuto."""

FX_STALE_DAYS = 4
"""Días naturales que puede tener el tipo de cambio antes de marcar la respuesta como atrasada."""


def _load_inputs(sym: str) -> inputs_mod.ValuationInputs:
    """``inputs.load`` con caché por emisora. Devuelve una copia: el servicio la ajusta en su lugar."""
    data = _cached(f"v2:valuation:inputs:{sym}", lambda: inputs_mod.load(sym), ttl=INPUTS_TTL)
    return deepcopy(data)


def _risk_free(currency: str) -> params_mod.RiskFree | None:
    """``params.risk_free`` con caché por moneda; un ``None`` no se guarda más de un minuto."""
    return _cached(
        f"v2:valuation:rf:{currency.upper()}",
        lambda: params_mod.risk_free(currency),
        ttl=RF_TTL,
        ok=lambda value: value is not None,
    )


def _round(value: float | None, digits: int = 6) -> float | None:
    return None if value is None else round(float(value), digits)


def _newest(*dates: str | None) -> str | None:
    clean = [d for d in dates if d]
    return max(clean) if clean else None


def _cost_of_debt(rf: float, risk: params_mod.CountryRisk, bench: params_mod.SectorBenchmark) -> tuple[float, str]:
    """``Rd = rf + diferencial soberano + diferencial de la industria``.

    El diferencial de la industria sale del costo de deuda en dólares que publica Damodaran menos
    los dos ingredientes que él ya le había metido en ESE archivo: la tasa del Tesoro y el
    diferencial soberano promedio del mercado. Así queda el spread de crédito puro del sector y el
    riesgo soberano se suma una sola vez, el del país de la emisora.
    """
    file_params = params_mod.market_parameters(bench.market)
    base_rf = float(file_params.get("riskFreeUsd") or 0.0)
    base_default = float(file_params.get("globalDefaultSpread") or 0.0)
    spread = MIN_INDUSTRY_SPREAD
    if bench.cost_of_debt_usd:
        spread = max(bench.cost_of_debt_usd - base_rf - base_default, MIN_INDUSTRY_SPREAD)
    detalle = (
        f"Costo de deuda = tasa libre de riesgo + {risk.default_spread:.2%} de riesgo soberano de "
        f"{risk.label} + {spread:.2%} de diferencial de crédito del sector (Damodaran)."
    )
    return rf + risk.default_spread + spread, detalle


def get_valuation(
    symbol: str,
    *,
    erp: float | None = None,
    crp: float | None = None,
    terminal_growth: float | None = None,
    years: int | None = None,
    growth: float | None = None,
) -> dict:
    """Valuación completa de ``symbol``. Lanza ``ApiError`` 404 o 503 cuando no se puede."""
    sym = symbol.upper()
    try:
        data = _load_inputs(sym)
    except inputs_mod.SymbolNotFound as exc:
        raise ApiError(404, "NOT_FOUND", f"No encontramos la emisora {sym}.") from exc
    except Exception as exc:
        raise ApiError(503, "UPSTREAM_UNAVAILABLE", "No pudimos leer los datos de la emisora.") from exc

    notes: list[str] = list(data.notes)
    risk = params_mod.country_risk(data.country, data.price_currency, sym)
    if data.tax_rate_source.startswith("estatutaria"):
        data.tax_rate = risk.statutory_tax
    market = params_mod.market_for(data.country, sym)
    bench = params_mod.sector_benchmark(data.sector, market)
    classification = params_mod.classify(
        quote_type=data.quote_type, sector=data.sector, industry=data.industry, symbol=sym
    )

    price_ccy = data.price_currency
    dcf_ccy = data.financial_currency
    if dcf_ccy != price_ccy:
        notes.append(
            f"El DCF sale en {dcf_ccy} porque esa es la moneda de los flujos de la empresa; el "
            f"precio y los múltiplos van en {price_ccy}."
        )
    rf_info = _risk_free(dcf_ccy)
    converted_from: str | None = None
    if rf_info is None and dcf_ccy != "USD":
        usd = _risk_free("USD")
        if usd is not None and params_mod.inflation_anchor(dcf_ccy) and params_mod.inflation_anchor("USD"):
            rf_info = usd
            converted_from = "USD"

    # Sin tasa en la moneda de los flujos no hay DCF honesto, pero los múltiplos no la necesitan: se
    # muestra la tasa de la moneda de cotización (o del dólar) como referencia y el DCF sale con su
    # razón. Solo si no hay NINGUNA tasa real la ruta responde 503.
    dcf_blocked: str | None = None
    if rf_info is None:
        for candidate in dict.fromkeys((price_ccy, "USD")):
            if candidate != dcf_ccy:
                rf_info = _risk_free(candidate)
                if rf_info is not None:
                    break
        if rf_info is None:
            raise ApiError(
                503,
                "UPSTREAM_UNAVAILABLE",
                f"No tenemos una tasa libre de riesgo real en {dcf_ccy}, así que no valuamos a ciegas.",
            )
        dcf_blocked = (
            f"La empresa reporta en {dcf_ccy} y no tenemos tasa libre de riesgo en esa moneda ni "
            f"inflación esperada para convertir el costo de capital: sin tasa de descuento en "
            f"{dcf_ccy} no hay DCF."
        )
        notes.append(
            f"La tasa libre de riesgo y el crecimiento terminal de los supuestos son los de "
            f"{rf_info.currency} ({rf_info.label}): se muestran como referencia y no se usó para "
            f"descontar ninguno de los dos, porque los flujos de la empresa están en {dcf_ccy}."
        )
    notes.extend(rf_info.notes)

    erp_value = erp if erp is not None else risk.mature_erp
    crp_value = crp if crp is not None else risk.crp
    rf_value = rf_info.rate

    beta_u = bench.beta_u
    d_e = data.debt_to_equity_market
    tax_rate = data.tax_rate if data.tax_rate is not None else risk.statutory_tax
    beta_l = None
    if classification.is_financial and bench.beta_levered:
        # En bancos y aseguradoras la deuda es materia prima: reapalancar con D/E de mercado da una
        # beta sin sentido. Se usa la beta de regresión del sector, que ya viene apalancada.
        beta_l = bench.beta_levered
        notes.append(
            f"Por ser {'banco' if classification.is_bank else 'aseguradora'} se usó la beta de "
            f"regresión del sector ({beta_l:.2f}) en vez de reapalancar con Hamada."
        )
    elif beta_u is not None:
        beta_l = dcf_math.levered_beta(beta_u, d_e if d_e is not None else 0.0, tax_rate)

    re_value: float | None = None
    rd_value: float | None = None
    wacc_value: float | None = None
    if dcf_blocked is None:
        re_value = dcf_math.cost_of_equity(rf_value, beta_l, erp_value, crp_value, DEFAULT_LAMBDA) if beta_l else None
        rd_value, rd_note = _cost_of_debt(rf_value, risk, bench)
        equity_weight = data.equity_weight
        wacc_value = (
            dcf_math.wacc(re_value, rd_value, tax_rate, equity_weight)
            if (re_value is not None and equity_weight is not None)
            else None
        )
        if converted_from:
            local = params_mod.inflation_anchor(dcf_ccy)
            base = params_mod.inflation_anchor(converted_from)
            notes.append(
                f"No hubo tasa larga en {dcf_ccy}: el costo de capital se estimó en {converted_from} "
                f"y se pasó a {dcf_ccy} con el diferencial de inflación esperada "
                f"({local['value']:.1%} contra {base['value']:.1%}). Fuentes: {local['source']} y {base['source']}."
            )
            rf_value = dcf_math.wacc_in_currency(rf_value, local["value"], base["value"])
            if re_value is not None:
                re_value = dcf_math.wacc_in_currency(re_value, local["value"], base["value"])
            rd_value = dcf_math.wacc_in_currency(rd_value, local["value"], base["value"])
            if wacc_value is not None:
                wacc_value = dcf_math.wacc_in_currency(wacc_value, local["value"], base["value"])
        notes.append(rd_note)
    notes.append(
        f"Tasa de impuesto {tax_rate:.1%}, {data.tax_rate_source}. Prima de mercado maduro "
        f"{erp_value:.2%} y riesgo país de {risk.label} {crp_value:.2%}, con lambda 1."
    )

    tg_ccy = dcf_ccy if dcf_blocked is None else rf_info.currency
    tg_default = params_mod.default_terminal_growth(tg_ccy)
    if terminal_growth is not None:
        tg_requested = terminal_growth
    elif tg_default is not None:
        tg_requested = tg_default
        anchor = params_mod.inflation_anchor(tg_ccy)
        notes.append(
            f"Crecimiento terminal por omisión {tg_default:.1%}: meta de inflación en {tg_ccy} "
            f"({anchor['value']:.1%}, {anchor['source']}) más {params_mod.TERMINAL_REAL_GROWTH:.1%} "
            "real. La tasa libre de riesgo es solo el tope."
        )
    else:  # pragma: no cover - toda moneda con tasa real tiene ancla de inflación
        tg_requested = rf_value

    missing_note = params_mod.dataset().get("missing", {}).get("pfcf")
    multiples_block, multiples_notes = relative_multiples(data, bench, classification, missing_note=missing_note)
    notes.extend(multiples_notes)

    dcf_block, dcf_notes = _dcf_block(
        data,
        classification,
        bench,
        rf_value=rf_value,
        re_value=re_value,
        rd_value=rd_value,
        wacc_value=wacc_value,
        beta_u=beta_u,
        beta_l=beta_l,
        d_e=d_e,
        tax_rate=tax_rate,
        years=years,
        growth=growth,
        terminal_growth=tg_requested,
        blocked=dcf_blocked,
    )
    notes.extend(dcf_notes)

    bank_block = _bank_block(data, classification, re_value, tg_requested, rf_value, notes)

    if dcf_block["applicable"]:
        tg_used = dcf_block["inputs"]["terminalGrowth"]
    elif bank_block is not None and bank_block["applicable"]:
        tg_used = bank_block["growth"]
    else:
        tg_used = _round(tg_requested)

    stale = _stale(rf_info, data, notes)
    as_of = _newest(data.fiscal_period_end, rf_info.as_of, data.fx_as_of)
    sources = "yahoo,fred,damodaran,computed"
    return {
        "symbol": sym,
        "currency": price_ccy,
        "assumptions": {
            "rf": _round(rf_value),
            "erp": _round(erp_value),
            "crp": _round(crp_value),
            "lambda": DEFAULT_LAMBDA,
            "taxRate": _round(tax_rate),
            "terminalGrowth": tg_used,
            "source": (
                f"{rf_info.label} para la tasa libre de riesgo; Damodaran enero 2026 para prima de "
                "mercado, riesgo país, beta del sector y múltiplos; Yahoo para los estados financieros"
            ),
            "asOf": as_of,
        },
        "multiples": multiples_block,
        "dcf": dcf_block,
        "bank": bank_block,
        "meta": {
            "source": sources,
            "asOf": as_of,
            "delayMinutes": DELAY_MINUTES,
            "stale": stale,
            "fallback": bool(rf_info.fallback or converted_from or dcf_blocked or data.fx_rate is None),
            "notes": notes,
        },
    }


def _stale(rf_info: params_mod.RiskFree, data: inputs_mod.ValuationInputs, notes: list[str]) -> bool:
    """``meta.stale``: la tasa libre de riesgo o el tipo de cambio son más viejos de lo esperado."""
    today = params_mod.today()
    rf_stale = params_mod.rf_is_stale(rf_info, today)
    if rf_stale:
        notes.append(
            f"La tasa libre de riesgo viene atrasada: su último dato es del {rf_info.as_of} "
            f"({rf_info.label})."
        )
    fx_stale = False
    if data.fx_pair and data.fx_as_of:
        age = (today - _dt.date.fromisoformat(str(data.fx_as_of)[:10])).days
        fx_stale = age > FX_STALE_DAYS
        if fx_stale:
            notes.append(f"El tipo de cambio {data.fx_pair} viene atrasado: su último dato es del {data.fx_as_of}.")
    return bool(rf_stale or fx_stale)


def _dcf_block(
    data: inputs_mod.ValuationInputs,
    classification: params_mod.Classification,
    bench: params_mod.SectorBenchmark,
    *,
    rf_value: float,
    re_value: float | None,
    rd_value: float | None,
    wacc_value: float | None,
    beta_u: float | None,
    beta_l: float | None,
    d_e: float | None,
    tax_rate: float,
    years: int | None,
    growth: float | None,
    terminal_growth: float,
    blocked: str | None = None,
) -> tuple[dict, list[str]]:
    """Bloque ``dcf`` del contrato. Si no aplica, sale con ``applicable=False`` y su razón.

    ``terminal_growth`` llega ya resuelto (el pedido o el de omisión); aquí solo pasa por las
    guardas. El crecimiento de la etapa 1 se desvanece hacia el terminal cuando es el de omisión.
    """
    notes: list[str] = []
    years_value = years or DEFAULT_YEARS
    growth_value = growth if growth is not None else bench.growth5y
    fade = growth is None and params_mod.FADE_STAGE_ONE
    tg_requested = terminal_growth
    fcff0 = data.fcff0()

    empty = {
        "applicable": False,
        "reason": None,
        "inputs": {
            "fcff0": _round(fcff0, 2),
            "growth": _round(growth_value),
            "years": years_value,
            "terminalGrowth": _round(tg_requested),
            "betaU": _round(beta_u, 4),
            "betaL": _round(beta_l, 4),
            "debtToEquity": _round(d_e, 4),
            "taxRate": _round(tax_rate),
            "costOfEquity": _round(re_value),
            "costOfDebt": _round(rd_value),
            "wacc": _round(wacc_value),
            "currency": data.financial_currency,
        },
        "projection": [],
        "terminalValue": None,
        "pvTerminal": None,
        "tvShare": None,
        "enterpriseValue": None,
        "netDebt": _round(data.net_debt, 2),
        "minorityInterest": _round(data.minority_interest, 2),
        "equityValue": None,
        "sharesOutstanding": data.shares,
        "perShare": None,
        "sensitivity": None,
        "warnings": [],
    }

    reason = classification.dcf_reason
    if reason is None and blocked is not None:
        reason = blocked
    if reason is None and wacc_value is None:
        reason = "No pudimos estimar el costo de capital con los datos disponibles."
    if reason is None and growth_value is None:
        reason = "No hay una tasa de crecimiento de referencia para este sector."
    if reason is None and fcff0 is None:
        faltan = [
            etiqueta
            for etiqueta, valor in (
                ("EBIT", data.ebit),
                ("depreciación y amortización", data.depreciation),
                ("inversión en activos fijos", data.capex),
            )
            if valor is None
        ]
        reason = "Los estados financieros no traen " + " ni ".join(faltan) + ", así que no se puede armar el FCFF."
    if reason is None and fcff0 is not None and fcff0 <= 0:
        reason = (
            "El flujo libre a la empresa del último ejercicio es negativo: proyectarlo con una tasa "
            "de crecimiento daría un valor sin sentido."
        )
    if reason is not None:
        empty["reason"] = reason
        return empty, notes

    result = dcf_math.two_stage_fcff(
        fcff0, growth_value, years_value, tg_requested, wacc_value, rf=rf_value, fade=fade
    )
    equity_value, per_share = dcf_math.equity_bridge(
        result.enterprise_value, data.net_debt, data.minority_interest, data.shares
    )
    grid = dcf_math.sensitivity(
        fcff0=fcff0,
        growth=growth_value,
        years=years_value,
        base_wacc=wacc_value,
        base_terminal_growth=result.terminal_growth,
        net_debt=data.net_debt,
        minority_interest=data.minority_interest,
        shares=data.shares,
        rf=rf_value,
        fade=fade,
    )
    if fade:
        notes.append(
            f"FCFF del último ejercicio {fcff0:,.0f} {data.financial_currency}, proyectado {years_value} años: "
            f"arranca al {growth_value:.1%} (crecimiento esperado a 5 años de las utilidades que "
            f"Damodaran publica para {bench.label()}) y baja en línea recta hasta el "
            f"{result.terminal_growth:.1%} terminal, porque ese dato es de utilidades y no de flujo. "
            f"Descontado al {wacc_value:.2%}."
        )
    else:
        notes.append(
            f"FCFF del último ejercicio {fcff0:,.0f} {data.financial_currency}, proyectado {years_value} años "
            f"al {growth_value:.1%} (que pediste en la consulta) y descontado al {wacc_value:.2%}."
        )
    warnings = list(result.warnings)
    share = result.tv_share
    if share is not None and share > params_mod.TV_SHARE_WARNING:
        warnings.append(
            f"El valor terminal pesa {share:.0%} del valor de empresa: el resultado depende sobre todo "
            f"de lo que se suponga después del año {years_value}. La tabla de sensibilidad muestra "
            "cuánto se mueve con la WACC y el crecimiento terminal."
        )
    if per_share is not None and data.financial_currency != data.price_currency:
        if data.fx_rate:
            warnings.append(
                f"El valor por acción del DCF ({per_share:,.2f}) está en {data.financial_currency}, la "
                f"moneda en que reporta la empresa; el precio y los múltiplos van en "
                f"{data.price_currency}. Con {data.fx_pair} a {data.fx_rate:,.4f} equivale a "
                f"{per_share * data.fx_rate:,.2f} {data.price_currency} por acción."
            )
        else:
            warnings.append(
                f"El valor por acción del DCF ({per_share:,.2f}) está en {data.financial_currency}, la "
                f"moneda en que reporta la empresa, y no hubo tipo de cambio para pasarlo a "
                f"{data.price_currency}, la del precio y los múltiplos."
            )
    block = dict(empty)
    block["applicable"] = True
    block["reason"] = None
    block["inputs"] = dict(empty["inputs"], terminalGrowth=_round(result.terminal_growth))
    block["projection"] = [
        {
            "year": p.year,
            "fcff": round(p.fcff, 2),
            "discountFactor": round(p.discount_factor, 6),
            "pv": round(p.pv, 2),
        }
        for p in result.projection
    ]
    block["terminalValue"] = round(result.terminal_value, 2)
    block["pvTerminal"] = round(result.pv_terminal, 2)
    block["tvShare"] = _round(result.tv_share)
    block["enterpriseValue"] = round(result.enterprise_value, 2)
    block["equityValue"] = None if equity_value is None else round(equity_value, 2)
    block["perShare"] = None if per_share is None else round(per_share, 4)
    block["sensitivity"] = grid
    block["warnings"] = warnings
    return block, notes


def _bank_block(
    data: inputs_mod.ValuationInputs,
    classification: params_mod.Classification,
    re_value: float | None,
    growth: float | None,
    rf_value: float | None,
    notes: list[str],
) -> dict | None:
    """P/VL justificado ``(ROE − g)/(Re − g)``. Solo para bancos y aseguradoras.

    ``g`` pasa por las mismas dos guardas que el crecimiento terminal del DCF (``g ≤ rf`` y
    ``Re − g ≥ 2`` puntos); si se recorta, el aviso sale en ``meta.notes``.
    """
    if not classification.is_financial:
        return None
    if growth is not None and re_value is not None:
        avisos: list[str] = []
        growth = dcf_math.clamp_terminal_growth(
            growth, re_value, rf_value, avisos, rate_label="el costo de capital propio"
        )
        notes.extend(f"P/VL justificado: {aviso}" for aviso in avisos)
    roe = data.roe
    if roe is None or re_value is None or growth is None:
        return {
            "applicable": False,
            "justifiedPB": None,
            "roe": _round(roe),
            "costOfEquity": _round(re_value),
            "growth": _round(growth),
            "impliedPrice": None,
        }
    pb = dcf_math.justified_pb(roe, growth, re_value)
    implied = pb * data.bvps if (pb is not None and data.bvps and data.bvps > 0) else None
    return {
        "applicable": pb is not None,
        "justifiedPB": _round(pb, 4),
        "roe": _round(roe),
        "costOfEquity": _round(re_value),
        "growth": _round(growth),
        "impliedPrice": None if implied is None else round(implied, 4),
    }
