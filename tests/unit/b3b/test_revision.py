"""Los diez puntos de la revisión adversaria de B3b (``docs/overhaul/notas/fase2-revision-b3.md``).

Cada prueba reproduce el defecto tal como lo encontró el revisor y falla con el código de antes del
arreglo. Las que necesitan precios usan series falsas o las grabaciones de ``2026-09-22-b3b``; las
de valuación usan insumos falsos con la tasa de FRED fija, así que ninguna sale a la red.
"""

from __future__ import annotations

import datetime as dt

import pytest

from kaizen_api.domain.history import PriceSeries
from kaizen_api.domain.screeners import momentum as mom
from kaizen_api.domain.valuation import dcf, params
from kaizen_api.domain.valuation import inputs as inp
from kaizen_api.schemas import MomentumResponse, ValuationResponse

HOY = dt.date(2026, 9, 22)


class _Hoy(dt.date):
    @classmethod
    def today(cls):
        return HOY


@pytest.fixture
def hoy_fijo(monkeypatch):
    """Fija "hoy" en el 22 de septiembre de 2026, el día en que se grabaron las series."""
    monkeypatch.setattr(mom._dt, "date", _Hoy)


def _meses(desde: str, hasta: str) -> list[str]:
    fechas = [f"{y}-{m:02d}-01" for y in range(2023, 2028) for m in range(1, 13)]
    return [f for f in fechas if desde <= f <= hasta]


def _serie_falsa(monkeypatch, series: dict[str, list[float]], fechas: list[str], moneda: str = "USD"):
    def falsa(symbol, range="2y", interval="1mo", ccy="native"):
        return PriceSeries(
            symbol=symbol, currency=moneda, interval=interval, dates=list(fechas),
            close=list(series[symbol]), source="yahoo",
        )

    monkeypatch.setattr(mom, "get_series", falsa)
    monkeypatch.setattr(mom, "_currency_of", lambda s: moneda)


# ─── 1. el 12-1 cuenta fechas, no posiciones ─────────────────────────────────


def test_un_hueco_en_la_serie_no_recorre_la_ventana_del_12_1(monkeypatch, hoy_fijo):
    fechas = _meses("2024-09-01", "2026-08-01")
    spy = [100.0 * 1.01**i for i in range(len(fechas))]
    emisora = list(spy)
    emisora[fechas.index("2026-03-01")] = float("nan")  # Yahoo manda NaN en marzo de 2026
    _serie_falsa(monkeypatch, {"SPY": spy, "FAKE": emisora}, fechas)

    r = mom.get_momentum_v2("FAKE")
    assert r["r12m1"] == pytest.approx(1.01**11 - 1, abs=1e-6)
    assert r["benchmarkR12m1"] == pytest.approx(1.01**11 - 1, abs=1e-6)
    assert r["relative12m1"] == pytest.approx(0.0, abs=1e-9)


def test_si_falta_el_mes_de_arranque_el_12_1_queda_sin_dato(monkeypatch, hoy_fijo):
    fechas = _meses("2024-09-01", "2026-08-01")
    spy = [100.0 * 1.01**i for i in range(len(fechas))]
    emisora = list(spy)
    emisora[fechas.index("2025-08-01")] = float("nan")  # justo el mes t − 12
    _serie_falsa(monkeypatch, {"SPY": spy, "FAKE": emisora}, fechas)

    r = mom.get_momentum_v2("FAKE")
    assert r["r12m1"] is None and r["relative12m1"] is None
    assert r["benchmarkR12m1"] == pytest.approx(1.01**11 - 1, abs=1e-6)


def test_la_funcion_publica_del_12_1_recibe_fechas_y_cierres():
    fechas = _meses("2025-01-01", "2026-09-01")
    cierres = [100.0 + i for i in range(len(fechas))]
    # t = agosto de 2026 (septiembre no ha cerrado): julio de 2026 contra agosto de 2025.
    esperado = cierres[fechas.index("2026-07-01")] / cierres[fechas.index("2025-08-01")] - 1
    assert mom.momentum_12_1(dates=fechas, closes=cierres, as_of="2026-09-22") == pytest.approx(esperado)
    # Cierres diarios: manda el último de cada mes, no el primero.
    diarios = ["2025-08-01", "2025-08-29", "2026-07-01", "2026-07-31"]
    assert mom.momentum_12_1(dates=diarios, closes=[1.0, 2.0, 5.0, 3.0], as_of="2026-09-22") == pytest.approx(0.5)
    assert mom.momentum_12_1(dates=fechas[:5], closes=cierres[:5], as_of="2026-09-22") is None


def test_la_funcion_publica_del_12_1_acepta_un_simbolo(replay_b3b, hoy_fijo):
    assert mom.momentum_12_1("AAPL", as_of="2026-09-22") == pytest.approx(0.33447, abs=1e-5)
    assert mom.momentum_12_1("ZZZNOTREAL", as_of="2026-09-22") is None


# ─── 2. el P/VL de bancos pasa por las guardas ───────────────────────────────


def _banco(sym, statutory_tax=0.30):
    return inp.ValuationInputs(
        symbol=sym, name="Banco X", quote_type="EQUITY", sector="Financial Services",
        industry="Banks - Diversified", country="United States", price=200.0, shares=2.8e9, eps=18.0,
        bvps=110.0, market_cap=5.6e11, tax_rate=0.21, tax_rate_source="efectiva", total_debt=4e11,
        cash=5e11, roe=0.17,
    )


def _adr_twd(sym, statutory_tax=0.30):
    return inp.ValuationInputs(
        symbol=sym, name="Taiwan Semi ADR", quote_type="EQUITY", sector="Technology",
        industry="Semiconductors", country="Taiwan", price=250.0, price_currency="USD",
        financial_currency="TWD", fx_rate=1 / 32.0, fx_as_of="2026-09-21", fx_pair="TWDUSD=X",
        shares=5.2e9, eps=9.0, bvps=40.0, market_cap=1.3e12, ebit=1.6e12, ebitda=2.4e12, tax_rate=0.15,
        tax_rate_source="efectiva", depreciation=7e11, capex=-9e11, change_in_wc=0.0, total_debt=9e11,
        cash=2.5e12,
    )


def _industrial(sym, statutory_tax=0.30):
    return inp.ValuationInputs(
        symbol=sym, name="X", quote_type="EQUITY", sector="Technology", industry="Software",
        country="United States", price=100.0, shares=1e9, eps=5.0, bvps=20.0, market_cap=1e11,
        ebit=1e10, ebitda=1.2e10, tax_rate=0.21, tax_rate_source="efectiva", depreciation=1e9,
        capex=-1e9, change_in_wc=0.0, total_debt=1e10, cash=5e9,
    )


def test_el_pvl_justificado_respeta_la_guarda_de_la_tasa_libre_de_riesgo(client, monkeypatch):
    monkeypatch.setattr(inp, "load", _banco)
    monkeypatch.setattr(params, "_fred_last", lambda s: (0.045, "2026-09-18"))
    cuerpo = client.get("/v2/valuation/BANKX?terminalGrowth=0.06").json()
    rf = cuerpo["assumptions"]["rf"]
    banco = cuerpo["bank"]
    assert banco["growth"] <= rf + 1e-12
    assert banco["justifiedPB"] == pytest.approx((banco["roe"] - rf) / (banco["costOfEquity"] - rf), rel=1e-3)
    assert any("se recortó" in n and "P/VL" in n for n in cuerpo["meta"]["notes"])


# ─── 3. un ADR sin tasa en su moneda de reporte conserva los múltiplos ───────


def test_un_adr_sin_tasa_en_su_moneda_conserva_los_multiplos(client, monkeypatch):
    monkeypatch.setattr(inp, "load", _adr_twd)
    monkeypatch.setattr(params, "_fred_last", lambda s: (0.045, "2026-09-18"))
    r = client.get("/v2/valuation/TSM")
    assert r.status_code == 200, r.text
    cuerpo = ValuationResponse.model_validate(r.json()).model_dump(by_alias=True)
    assert cuerpo["multiples"]["applicable"] is True
    assert cuerpo["dcf"]["applicable"] is False and "TWD" in cuerpo["dcf"]["reason"]
    assert cuerpo["dcf"]["perShare"] is None and cuerpo["dcf"]["inputs"]["wacc"] is None
    assert cuerpo["meta"]["fallback"] is True
    assert any("TWD" in n and "no se usó para descontar" in n for n in cuerpo["meta"]["notes"])


# ─── 4. el DCF de una emisora del SIC avisa en qué moneda sale ───────────────


def test_el_dcf_de_una_emisora_del_sic_avisa_la_moneda(client):
    cuerpo = client.get("/v2/valuation/AAPL.MX").json()
    d = cuerpo["dcf"]
    assert cuerpo["currency"] == "MXN" and d["inputs"]["currency"] == "USD"
    aviso = next(w for w in d["warnings"] if "USD" in w and "MXN" in w)
    assert "por acción" in aviso


# ─── 5. los parámetros no vuelven a salir a Yahoo ni a FRED ─────────────────


def test_cambiar_los_parametros_no_vuelve_a_leer_yahoo_ni_fred(client, monkeypatch):
    llamadas = {"yahoo": 0, "fred": 0}

    def carga(sym, statutory_tax=0.30):
        llamadas["yahoo"] += 1
        return _industrial(sym)

    def fred(series):
        llamadas["fred"] += 1
        return 0.045, "2026-09-18"

    monkeypatch.setattr(inp, "load", carga)
    monkeypatch.setattr(params, "_fred_last", fred)
    for erp in ("0.040", "0.041", "0.042", "0.043", "0.044"):
        assert client.get(f"/v2/valuation/TESTX?erp={erp}").status_code == 200
    assert llamadas == {"yahoo": 1, "fred": 1}


# ─── 6. supuestos por omisión del DCF ────────────────────────────────────────


def test_el_crecimiento_terminal_por_omision_es_inflacion_mas_un_real_modesto(client):
    walmex = client.get("/v2/valuation/WALMEX.MX").json()
    assert walmex["dcf"]["inputs"]["terminalGrowth"] == pytest.approx(0.04, abs=1e-9)
    aapl = client.get("/v2/valuation/AAPL").json()
    assert aapl["dcf"]["inputs"]["terminalGrowth"] == pytest.approx(0.03, abs=1e-9)
    assert params.default_terminal_growth("USD") == pytest.approx(0.03)
    assert params.default_terminal_growth("MXN") == pytest.approx(0.04)
    assert params.default_terminal_growth("TWD") is None


def test_la_etapa_1_se_desvanece_hacia_el_crecimiento_terminal():
    r = dcf.two_stage_fcff(100.0, 0.20, 5, terminal_growth=0.03, wacc_value=0.10, fade=True)
    tasas = [r.projection[0].fcff / 100.0 - 1] + [
        r.projection[i].fcff / r.projection[i - 1].fcff - 1 for i in range(1, 5)
    ]
    esperadas = [0.20 - (0.20 - 0.03) * n / 5 for n in range(5)]
    assert tasas == pytest.approx(esperadas)
    # Sin desvanecer sigue siendo la respuesta conocida del spec.
    fijo = dcf.two_stage_fcff(100.0, 0.10, 5, terminal_growth=0.03, wacc_value=0.09)
    assert round(fijo.enterprise_value, 2) == 2310.80


def test_la_ruta_desvanece_el_crecimiento_por_omision_y_respeta_el_pedido(client):
    base = client.get("/v2/valuation/AAPL").json()["dcf"]
    fcff = [base["inputs"]["fcff0"]] + [p["fcff"] for p in base["projection"]]
    tasas = [fcff[i] / fcff[i - 1] - 1 for i in range(1, len(fcff))]
    assert tasas[0] == pytest.approx(base["inputs"]["growth"], abs=1e-6)
    assert all(a > b for a, b in zip(tasas, tasas[1:], strict=False))
    pedido = client.get("/v2/valuation/AAPL?growth=0.05").json()["dcf"]
    fcff = [pedido["inputs"]["fcff0"]] + [p["fcff"] for p in pedido["projection"]]
    assert all(fcff[i] / fcff[i - 1] - 1 == pytest.approx(0.05, abs=1e-6) for i in range(1, len(fcff)))


def test_un_valor_terminal_que_pesa_mas_de_tres_cuartos_se_avisa(client, monkeypatch):
    monkeypatch.setattr(inp, "load", _industrial)
    monkeypatch.setattr(params, "_fred_last", lambda s: (0.045, "2026-09-18"))
    d = client.get("/v2/valuation/TESTX?growth=0.10&terminalGrowth=0.03").json()["dcf"]
    assert d["tvShare"] > 0.75
    assert any("valor terminal" in w and "%" in w for w in d["warnings"])
    bajo = client.get("/v2/valuation/TESTX?growth=0.0&terminalGrowth=-0.02&years=15").json()["dcf"]
    assert bajo["tvShare"] <= 0.75
    assert not any("valor terminal" in w for w in bajo["warnings"])


# ─── 7. la tabla de sensibilidad respeta g ≤ rf ──────────────────────────────


def test_la_sensibilidad_deja_vacio_lo_que_pasa_de_la_tasa_libre_de_riesgo(client):
    cuerpo = client.get("/v2/valuation/AAPL?terminalGrowth=0.06").json()
    rf = cuerpo["assumptions"]["rf"]
    tabla = cuerpo["dcf"]["sensitivity"]
    columnas = [j for j, g in enumerate(tabla["growths"]) if g > rf + 1e-12]
    assert columnas, "con g recortado a rf, los dos pasos de arriba pasan de rf"
    for fila in tabla["grid"]:
        for j in columnas:
            assert fila[j] is None


# ─── 8. monedas sin referencia ───────────────────────────────────────────────


def test_una_moneda_sin_referencia_no_se_compara_contra_spy(monkeypatch, hoy_fijo):
    fechas = _meses("2024-09-01", "2026-08-01")
    _serie_falsa(monkeypatch, {"SAP.DE": [100.0 + k for k in range(len(fechas))]}, fechas, moneda="EUR")
    r = mom.get_momentum_v2("SAP.DE")
    assert r["currency"] == "EUR"
    assert r["benchmark"] != "SPY"
    assert r["benchmarkR12m1"] is None and r["relative12m1"] is None
    assert r["r12m1"] is not None
    assert not any("la misma moneda del activo" in n for n in r["_notes"])
    assert any("EUR" in n and "sin dato" in n for n in r["_notes"])


# ─── 9. la razón de las FIBRAs no promete lo que el screener no hace ────────


def test_la_razon_de_las_fibras_no_promete_ffo_ni_affo():
    razon = params.Classification(is_reit=True).dcf_reason
    assert "FFO y AFFO en el screener" not in razon
    assert "flujo de la operación" in razon


# ─── 10. fechas reales de fin de mes y stale calculado ──────────────────────


def test_los_cierres_mensuales_van_fechados_en_el_ultimo_dia_habil(replay_b3b, hoy_fijo):
    fechas, _ = mom.monthly_closes("WALMEX.MX")
    assert fechas[-1] == "2026-08-31"
    assert "2026-05-29" in fechas  # 30 y 31 de mayo de 2026 caen en fin de semana
    fechas, _ = mom.monthly_closes("AAPL")
    assert fechas[-1] == "2026-08-31"
    assert "2026-05-29" in fechas
    assert all(dt.date.fromisoformat(d).weekday() < 5 for d in fechas)
    assert not any(d.endswith("-01") for d in fechas), "Yahoo fecha la barra al día 1; el cierre es de fin de mes"


def test_el_momentum_se_fecha_al_cierre_y_calcula_stale(client, hoy_fijo):
    cuerpo = client.get("/v2/momentum/WALMEX.MX").json()
    MomentumResponse.model_validate(cuerpo)
    assert cuerpo["meta"]["asOf"] == "2026-08-31"
    assert cuerpo["meta"]["stale"] is False


def test_una_serie_mensual_atrasada_sale_stale(monkeypatch):
    monkeypatch.setattr(mom._dt, "date", type("H", (dt.date,), {"today": classmethod(lambda c: dt.date(2026, 11, 20))}))
    assert mom.is_stale_month_end("2026-08-31") is True
    monkeypatch.setattr(mom._dt, "date", _Hoy)
    assert mom.is_stale_month_end("2026-08-31") is False


def test_una_tasa_libre_de_riesgo_atrasada_marca_stale(client, monkeypatch):
    monkeypatch.setattr(inp, "load", _industrial)
    monkeypatch.setattr(params, "_fred_last", lambda s: (0.045, "2026-06-01"))
    cuerpo = client.get("/v2/valuation/TESTX").json()
    assert cuerpo["meta"]["stale"] is True
    assert any("atrasad" in n for n in cuerpo["meta"]["notes"])

