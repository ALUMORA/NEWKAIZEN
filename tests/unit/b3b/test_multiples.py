"""Múltiplos relativos v2: qué aplica, qué no y cómo cuadran las monedas."""

from __future__ import annotations

import pytest

from kaizen_api.domain.valuation.inputs import ValuationInputs
from kaizen_api.domain.valuation.multiples import enterprise_value, relative_multiples
from kaizen_api.domain.valuation.params import Classification, SectorBenchmark

BENCH = SectorBenchmark(
    sector="Technology",
    market="US",
    industries=["Software (System & Application)"],
    pe=20.0,
    pb=4.0,
    ev_ebitda=12.0,
    beta_u=1.0,
    growth5y=0.10,
    cost_of_debt_usd=0.055,
    as_of="2026-01-05",
    method="Mediana de 1 industria de prueba",
)
NADA = Classification()


def emisora(**cambios) -> ValuationInputs:
    base = {
        "symbol": "PRUEBA",
        "price": 100.0,
        "price_currency": "USD",
        "financial_currency": "USD",
        "fx_rate": 1.0,
        "shares": 1_000.0,
        "eps": 5.0,
        "bvps": 20.0,
        "market_cap": 100_000.0,
        "ebitda": 12_000.0,
        "total_debt": 20_000.0,
        "cash": 5_000.0,
        "minority_interest": 1_000.0,
        "free_cash_flow": 4_000.0,
    }
    base.update(cambios)
    return ValuationInputs(**base)


def por_id(bloque: dict) -> dict:
    return {m["id"]: m for m in bloque["methods"]}


def test_valor_empresa_suma_deuda_y_minoritarios_y_resta_efectivo():
    assert enterprise_value(emisora()) == 100_000 + 20_000 + 1_000 - 5_000


def test_los_cuatro_metodos_con_sus_precios_implicitos():
    bloque, notas = relative_multiples(emisora(), BENCH, NADA)
    assert bloque["applicable"] is True and bloque["reason"] is None
    assert bloque["market"] == "US" and bloque["asOf"] == "2026-01-05"
    metodos = por_id(bloque)
    assert [m["id"] for m in bloque["methods"]] == ["pe", "pb", "evEbitda", "pfcf"]
    assert metodos["pe"]["current"] == 20.0 and metodos["pe"]["impliedPrice"] == 100.0
    assert metodos["pb"]["current"] == 5.0 and metodos["pb"]["impliedPrice"] == 80.0
    # EV objetivo 12 x 12,000 = 144,000; capital = 144,000 − 20,000 − 1,000 + 5,000 = 128,000
    assert metodos["evEbitda"]["current"] == round(116_000 / 12_000, 4)
    assert metodos["evEbitda"]["impliedPrice"] == 128.0
    assert bloque["fairValueRange"] == {"low": 80.0, "mid": 100.0, "high": 128.0}
    assert any("Mediana de 1 industria" in n for n in notas)


def test_pfcf_no_tiene_referencia_porque_damodaran_no_la_publica():
    bloque, notas = relative_multiples(emisora(), BENCH, NADA, missing_note="Damodaran no publica P/FCF")
    pfcf = por_id(bloque)["pfcf"]
    assert pfcf["benchmark"] is None
    assert pfcf["impliedPrice"] is None
    assert pfcf["applicable"] is False
    assert pfcf["current"] == 25.0  # precio 100 entre FCF por acción 4
    assert "Damodaran no publica P/FCF" in notas


def test_utilidades_negativas_apagan_el_bloque_pero_dejan_ver_los_valores():
    bloque, _ = relative_multiples(emisora(eps=-2.0), BENCH, NADA)
    assert bloque["applicable"] is False
    assert "negativas" in bloque["reason"]
    assert bloque["fairValueRange"] is None
    metodos = por_id(bloque)
    assert all(m["impliedPrice"] is None and m["applicable"] is False for m in bloque["methods"])
    assert metodos["pb"]["current"] == 5.0, "el P/VL actual se sigue publicando"
    assert metodos["pb"]["benchmark"] == 4.0


@pytest.mark.parametrize(
    "clasificacion,pista",
    [
        (Classification(is_bank=True), "banco"),
        (Classification(is_insurer=True), "aseguradora"),
        (Classification(is_reit=True), "FIBRA"),
        (Classification(is_fund=True), "ETF"),
    ],
)
def test_bancos_aseguradoras_fibras_y_fondos_no_se_valuan_por_multiplos(clasificacion, pista):
    bloque, _ = relative_multiples(emisora(), BENCH, clasificacion)
    assert bloque["applicable"] is False
    assert pista in bloque["reason"]
    assert bloque["fairValueRange"] is None


def test_los_agregados_del_balance_se_pasan_a_moneda_de_cotizacion():
    # Reporta en dólares y cotiza en pesos: 1 USD = 17 MXN. El precio y el capital ya van en pesos.
    mx = emisora(
        price=1_700.0,
        price_currency="MXN",
        financial_currency="USD",
        fx_rate=17.0,
        market_cap=1_700_000.0,
        eps=85.0,
        bvps=340.0,
    )
    assert enterprise_value(mx) == 1_700_000 + 17 * (20_000 + 1_000 - 5_000)
    bloque, _ = relative_multiples(mx, BENCH, NADA)
    metodos = por_id(bloque)
    # Los múltiplos son razones: salen iguales que en dólares.
    assert metodos["pe"]["current"] == 20.0
    assert metodos["evEbitda"]["current"] == round(116_000 / 12_000, 4)
    # Y los precios implícitos, 17 veces los de dólares.
    assert metodos["pe"]["impliedPrice"] == 1_700.0
    assert metodos["evEbitda"]["impliedPrice"] == 2_176.0


def test_sin_tipo_de_cambio_no_hay_multiplos_de_valor_empresa():
    sin_fx = emisora(price_currency="MXN", financial_currency="USD", fx_rate=None)
    assert enterprise_value(sin_fx) is None
    bloque, notas = relative_multiples(sin_fx, BENCH, NADA)
    metodos = por_id(bloque)
    assert metodos["evEbitda"]["current"] is None and metodos["evEbitda"]["impliedPrice"] is None
    # El P/U y el P/VL siguen porque son datos por acción, que ya vienen en moneda de cotización.
    assert metodos["pe"]["impliedPrice"] == 100.0
    assert notas


def test_sin_datos_suficientes_lo_dice_en_vez_de_inventar():
    vacía = ValuationInputs(symbol="X", price=None, eps=None, bvps=None)
    bloque, notas = relative_multiples(vacía, BENCH, NADA)
    assert bloque["applicable"] is True
    assert bloque["fairValueRange"] is None
    assert any("No hubo datos suficientes" in n for n in notas)


def test_ningun_texto_trae_guiones_largos_ni_lenguaje_de_recomendacion():
    bloque, notas = relative_multiples(emisora(), BENCH, Classification(is_reit=True))
    textos = [bloque["reason"] or "", bloque["source"], *notas, *(m["label"] for m in bloque["methods"])]
    for t in textos:
        assert "—" not in t and "–" not in t
        assert not any(p in t.upper() for p in ("COMPRAR", "VENDER", "BUY", "SELL"))
