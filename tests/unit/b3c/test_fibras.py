"""FIBRAs v2: LTV contra activos, flujo con su base escrita y diferencial contra CETES real."""

from __future__ import annotations

import pytest

from kaizen_api import cache
from kaizen_api.domain import rates
from kaizen_api.domain.screeners import fibras as FB
from tests.unit.b3c import fakes

AÑOS = ["2025-12-31", "2024-12-31"]


@pytest.fixture(autouse=True)
def _clean_cache():
    cache.reset_state()
    yield
    cache.reset_state()


def balance(**over):
    filas = {
        "Total Assets": [1_000.0, 950.0],
        "Total Debt": [350.0, 330.0],
        "Cash And Cash Equivalents": [50.0, 45.0],
        "Stockholders Equity": [600.0, 580.0],
    }
    for clave, valor in over.items():
        filas[clave] = [valor, valor]
    return fakes.frame(filas, AÑOS)


def cashflow(ocf: float | None = 80.0, fcf: float | None = 60.0):
    filas = {}
    if ocf is not None:
        filas["Operating Cash Flow"] = [ocf, ocf * 0.9]
    if fcf is not None:
        filas["Free Cash Flow"] = [fcf, fcf * 0.9]
    return fakes.frame(filas, AÑOS) if filas else None


def income(noi: float = 90.0):
    return fakes.frame({"Operating Income": [noi, noi * 0.9], "Total Revenue": [120.0, 110.0]}, AÑOS)


def fibra(sym="FUNO11.MX", **over):
    base = dict(
        currency="MXN", financialCurrency="MXN", sector="Real Estate", industry="REIT - Diversified",
        currentPrice=30.0, marketCap=500.0, bookValue=40.0, dividendYield=8.0,
        trailingAnnualDividendYield=0.08, longName="Fibra de prueba",
    )
    base.update(over)
    return fakes.symbol(sym, income=income(), balance=balance(), cashflow=cashflow(), **base)


def _build(monkeypatch, datos, extra=None, rate=None):
    monkeypatch.setattr(FB, "fetch_symbols", lambda syms, **kw: ({s: datos[s] for s in syms if s in datos}, []))
    monkeypatch.setattr(FB, "get_fibras_universe", lambda: fakes_universe(datos))
    # Al juntar los streams, B2b ya publica get_rf_series y compañía: para probar "sin costura" hay
    # que quitar TODAS las que busca cetes28(), o la prueba termina saliendo a la red de verdad.
    for _name in FB.RF_FUNCTIONS:
        monkeypatch.delattr(rates, _name, raising=False)
    if rate is not None:
        monkeypatch.setattr(rates, "get_cetes28", lambda: rate, raising=False)
    return FB.build(extra)


def fakes_universe(datos):
    from kaizen_api.domain.universe import Member, Universe

    return Universe(
        id="fibras-mx",
        name="FIBRAs de prueba",
        currency="MXN",
        members=tuple(
            Member(symbol=s, name="Fibra " + s, sector="Real Estate", type="propiedades")
            for s in datos
        ),
    )


# ─── LTV y apalancamiento ────────────────────────────────────────────────────


def test_el_ltv_es_deuda_entre_activos_no_deuda_entre_deuda_mas_capitalizacion():
    """350/1000 = 0.35. El ratio del legado, 350/(350+500), daría 0.41: otra cosa con otro nombre."""
    data = fibra()
    fila = FB._row("FUNO11.MX", data, None, None)
    assert fila["ltv"] == pytest.approx(0.35)
    assert fila["debtToMarketCap"] == pytest.approx(0.70)
    assert fila["ltv"] != pytest.approx(350 / (350 + 500))


def test_sin_activos_totales_no_hay_ltv():
    data = fibra()
    data.balance = data.balance.drop(index=["Total Assets"])
    fila = FB._row("FUNO11.MX", data, None, None)
    assert fila["ltv"] is None
    assert fila["debtToMarketCap"] == pytest.approx(0.70)


def test_la_deuda_se_arma_de_largo_y_corto_plazo_si_falta_el_total():
    bal = balance().drop(index=["Total Debt"])
    bal.loc["Long Term Debt"] = [300.0, 290.0]
    bal.loc["Current Debt"] = [50.0, 40.0]
    assert FB.total_debt(bal) == pytest.approx(350.0)
    assert FB.total_debt(None) is None


# ─── flujo, NAV y cap rate ───────────────────────────────────────────────────


def test_el_flujo_dice_su_base_y_nunca_se_llama_ffo():
    fila = FB._row("FUNO11.MX", fibra(), None, None)
    assert fila["cashFlowBasis"] == "ocf"
    assert fila["cashFlowYield"] == pytest.approx(80 / 500)
    assert "ffo" not in " ".join(fila.keys()).lower()


def test_sin_flujo_de_operacion_se_usa_el_libre_y_se_dice():
    data = fibra()
    data.cashflow = cashflow(ocf=None, fcf=60.0)
    fila = FB._row("FUNO11.MX", data, None, None)
    assert fila["cashFlowBasis"] == "fcf"
    assert fila["cashFlowYield"] == pytest.approx(60 / 500)


def test_sin_estado_de_flujos_el_rendimiento_va_en_nulo():
    data = fibra()
    data.cashflow = None
    fila = FB._row("FUNO11.MX", data, None, None)
    assert fila["cashFlowYield"] is None
    assert fila["cashFlowBasis"] is None


def test_el_nav_sale_del_valor_en_libros_y_si_no_del_capital_entre_cbfis():
    assert FB.nav_per_cbfi(fibra()) == pytest.approx(40.0)
    sin_book = fibra(bookValue=None, sharesOutstanding=20.0)
    assert FB.nav_per_cbfi(sin_book) is None  # 20 CBFIs no es una FIBRA real, se descarta
    con_cbfis = fibra(bookValue=None, sharesOutstanding=1_000.0)
    assert FB.nav_per_cbfi(con_cbfis) == pytest.approx(0.6)


def test_el_cap_rate_usa_el_ingreso_operativo_entre_el_valor_de_empresa():
    """EV = 500 + 350 - 50 = 800; cap rate = 90/800."""
    fila = FB._row("FUNO11.MX", fibra(), None, None)
    assert fila["capRate"] == pytest.approx(90 / 800)


def test_sin_ingreso_operativo_no_hay_cap_rate():
    data = fibra()
    data.income = fakes.frame({"Total Revenue": [120.0, 110.0]}, AÑOS)
    assert FB._row("FHIPO14.MX", data, None, None)["capRate"] is None


def test_rendimiento_por_distribucion_en_fraccion():
    """La costura de B3a entrega porcentaje (8.0); el contrato v2 pide fracción (0.08)."""
    fila = FB._row("FUNO11.MX", fibra(), None, None)
    assert fila["distributionYield"] == pytest.approx(0.08)


# ─── señal y tipo ────────────────────────────────────────────────────────────


def test_la_senal_sigue_la_regla_escrita():
    assert FB.signal_of(0.5) == "descuento"
    assert FB.signal_of(0.89) == "descuento"
    assert FB.signal_of(0.90) == "en_linea"
    assert FB.signal_of(1.10) == "en_linea"
    assert FB.signal_of(1.11) == "prima"
    assert FB.signal_of(None) == "sin_datos"
    assert FB.signal_of(0.0) == "sin_datos"


def test_el_tipo_lo_manda_la_lista_curada_y_si_no_la_industria():
    from kaizen_api.domain.universe import Member

    curada = Member(symbol="FHIPO14.MX", name="FHipo", type="hipotecaria")
    assert FB.classify(fibra(), "hipotecaria") == "hipotecaria"
    assert FB.classify(fibra(industry="REIT - Mortgage"), None) == "hipotecaria"
    assert FB.classify(fibra(industry="REIT - Retail"), None) == "propiedades"
    assert FB.classify(fibra(industry="Oil & Gas Midstream Pipeline"), None) == "energia"
    assert FB.classify(fibra(industry="Something else"), None) == "otro"
    assert curada.type == "hipotecaria"


# ─── CETES 28 y el diferencial ───────────────────────────────────────────────


def test_sin_costura_de_tasas_el_diferencial_va_en_nulo_y_se_avisa(monkeypatch):
    tabla = _build(monkeypatch, {"FUNO11.MX": fibra()})
    assert tabla["cetes28"] is None
    assert tabla["rows"][0]["spreadVsCetes"] is None
    assert any("CETES 28" in n for n in tabla["notes"])
    # Jamás la referencia fija del legado.
    assert tabla["cetes28"] != 0.086


def test_con_la_tasa_de_b2b_el_diferencial_es_la_resta(monkeypatch):
    rate = {"rate": 0.0975, "asOf": "2026-09-18", "source": "banxico", "fallback": False}
    tabla = _build(monkeypatch, {"FUNO11.MX": fibra()}, rate=rate)
    assert tabla["cetes28"] == pytest.approx(0.0975)
    assert tabla["rows"][0]["spreadVsCetes"] == pytest.approx(0.08 - 0.0975)
    assert tabla["rateSource"] == "banxico"
    assert tabla["rateFallback"] is False
    assert tabla["asOf"] == "2026-09-18"


def test_una_tasa_sustituta_se_marca_como_sustituta(monkeypatch):
    rate = {"rate": 0.101, "asOf": "2026-08-31", "source": "fred", "fallback": True}
    tabla = _build(monkeypatch, {"FUNO11.MX": fibra()}, rate=rate)
    assert tabla["rateFallback"] is True
    assert tabla["rateSource"] == "fred"


def test_la_tasa_en_porcentaje_se_normaliza_a_fraccion(monkeypatch):
    tabla = _build(monkeypatch, {"FUNO11.MX": fibra()}, rate={"rate": 9.75, "asOf": "2026-09-18"})
    assert tabla["cetes28"] == pytest.approx(0.0975)


def test_una_tasa_absurda_no_se_publica(monkeypatch):
    tabla = _build(monkeypatch, {"FUNO11.MX": fibra()}, rate={"rate": 87.0})
    assert tabla["cetes28"] is None


def test_la_tasa_puede_venir_como_serie(monkeypatch):
    rate = {"dates": ["2026-09-11", "2026-09-18"], "values": [0.0970, 0.0975], "source": "banxico"}
    tabla = _build(monkeypatch, {"FUNO11.MX": fibra()}, rate=rate)
    assert tabla["cetes28"] == pytest.approx(0.0975)
    assert tabla["asOf"] == "2026-09-18"


# ─── la tabla completa ───────────────────────────────────────────────────────


def test_la_tabla_ordena_por_p_nav_y_avisa_lo_que_falta(monkeypatch):
    datos = {
        "CARA.MX": fibra("CARA.MX", currentPrice=60.0),      # P/NAV 1.5
        "BARATA.MX": fibra("BARATA.MX", currentPrice=20.0),  # P/NAV 0.5
        "MUDA.MX": fakes.symbol("MUDA.MX", error="sin respuesta"),
    }
    tabla = _build(monkeypatch, datos)
    assert [r["symbol"] for r in tabla["rows"]] == ["BARATA.MX", "CARA.MX", "MUDA.MX"]
    assert tabla["rows"][0]["signal"] == "descuento"
    assert tabla["rows"][1]["signal"] == "prima"
    assert tabla["rows"][2]["signal"] == "sin_datos"
    assert any("Sin NAV" in n for n in tabla["notes"])
    assert any("valor en libros" in n for n in tabla["notes"])
    assert any("no es una recomendación" in n or "no una recomendación" in n or "no es una recomend" in n
               or "no es recomendación" in n for n in tabla["notes"])


def test_las_notas_no_llevan_guiones_largos(monkeypatch):
    tabla = _build(monkeypatch, {"FUNO11.MX": fibra()})
    texto = " ".join(tabla["notes"])
    assert "—" not in texto and "–" not in texto


def test_los_extras_se_agregan_y_se_les_pone_mx(monkeypatch):
    datos = {"FUNO11.MX": fibra(), "OTRA.MX": fibra("OTRA.MX")}
    tabla = _build(monkeypatch, datos, extra=["otra"])
    assert {r["symbol"] for r in tabla["rows"]} == {"FUNO11.MX", "OTRA.MX"}


def test_moneda_distinta_deja_las_razones_en_nulo_menos_el_ltv(monkeypatch):
    """El LTV vive todo dentro del balance, así que no mezcla monedas; P/NAV y cap rate sí."""
    mixta = fibra("RARA.MX", financialCurrency="USD")
    tabla = _build(monkeypatch, {"RARA.MX": mixta})
    fila = tabla["rows"][0]
    assert fila["ltv"] == pytest.approx(0.35)
    assert fila["pNav"] is None
    assert fila["capRate"] is None
    assert fila["debtToMarketCap"] is None
    assert fila["cashFlowYield"] is None
    assert any("otra moneda" in n for n in tabla["notes"])
