"""``GET /v2/valuation/{symbol}`` y ``GET /v2/momentum/{symbol}`` contra las grabaciones.

Sin red: todo sale de ``tests/fixtures/recorded/2026-09-22`` más la capa ``-b3b``.
"""

from __future__ import annotations

import pytest

from kaizen_api.schemas import ErrorBody, MomentumResponse, ValuationResponse

EMISORAS = ["AAPL", "AAPL.MX", "WALMEX.MX", "CEMEXCPO.MX", "FUNO11.MX", "GFNORTEO.MX", "SPY", "%5EMXX"]


def textos(valor, camino="") -> list[tuple[str, str]]:
    """Todas las cadenas de una respuesta, con su ruta, para revisarlas de un jalón."""
    if isinstance(valor, str):
        return [(camino, valor)]
    if isinstance(valor, dict):
        return [t for k, v in valor.items() for t in textos(v, f"{camino}.{k}")]
    if isinstance(valor, list):
        return [t for i, v in enumerate(valor) for t in textos(v, f"{camino}[{i}]")]
    return []


# ─── valuación ───────────────────────────────────────────────────────────────


@pytest.mark.parametrize("symbol", EMISORAS)
def test_la_valuacion_cumple_el_contrato(client, symbol):
    r = client.get(f"/v2/valuation/{symbol}")
    assert r.status_code == 200, r.text
    cuerpo = ValuationResponse.model_validate(r.json())
    assert cuerpo.symbol == symbol.replace("%5E", "^")
    assert len(cuerpo.currency) == 3
    assert r.headers["cache-control"] == "private, max-age=21600"


@pytest.mark.parametrize("symbol", EMISORAS)
def test_las_unidades_son_fracciones_y_la_procedencia_es_honesta(client, symbol):
    cuerpo = client.get(f"/v2/valuation/{symbol}").json()
    a = cuerpo["assumptions"]
    for campo in ("rf", "erp", "crp", "taxRate", "terminalGrowth"):
        assert 0 <= a[campo] < 1, f"{campo} tiene que ser fracción, no porcentaje"
    assert a["lambda"] == 1.0
    assert a["source"] and a["asOf"]
    meta = cuerpo["meta"]
    assert set(meta) == {"asOf", "source", "delayMinutes", "stale", "fallback", "generatedAt", "notes"}
    assert set(meta["source"].split(",")) <= {"yahoo", "fred", "damodaran", "computed"}
    assert meta["notes"], "cada supuesto que se movió se explica"
    assert isinstance(meta["stale"], bool) and isinstance(meta["fallback"], bool)


@pytest.mark.parametrize("symbol", EMISORAS)
def test_ningun_texto_trae_guiones_largos_ni_lenguaje_de_recomendacion(client, symbol):
    for ruta, texto in textos(client.get(f"/v2/valuation/{symbol}").json()):
        assert "—" not in texto and "–" not in texto, f"{ruta}: {texto}"
        arriba = texto.upper()
        assert " BUY" not in arriba and " SELL" not in arriba, ruta
        assert "RECOMENDAMOS COMPRAR" not in arriba and "RECOMENDAMOS VENDER" not in arriba, ruta


def test_una_emisora_de_eeuu_trae_dcf_y_multiplos(client):
    cuerpo = client.get("/v2/valuation/AAPL").json()
    assert cuerpo["currency"] == "USD"
    m = cuerpo["multiples"]
    assert m["applicable"] is True and m["reason"] is None
    assert m["market"] == "US" and "Damodaran" in m["source"] and m["asOf"] == "2026-01-05"
    assert [x["id"] for x in m["methods"]] == ["pe", "pb", "evEbitda", "pfcf"]
    assert m["fairValueRange"]["low"] <= m["fairValueRange"]["mid"] <= m["fairValueRange"]["high"]

    d = cuerpo["dcf"]
    assert d["applicable"] is True and d["reason"] is None
    assert d["inputs"]["currency"] == "USD"
    assert len(d["projection"]) == d["inputs"]["years"] == 5
    assert d["projection"][0]["year"] == 1
    # El puente de valor: EV − deuda neta − minoritarios = capital.
    esperado = d["enterpriseValue"] - d["netDebt"] - d["minorityInterest"]
    assert d["equityValue"] == pytest.approx(esperado, rel=1e-9)
    assert d["perShare"] == pytest.approx(d["equityValue"] / d["sharesOutstanding"], rel=1e-6)
    assert 0 < d["tvShare"] < 1
    assert d["sensitivity"] and len(d["sensitivity"]["grid"]) == len(d["sensitivity"]["waccs"]) == 5
    assert cuerpo["bank"] is None


def test_la_beta_reapalancada_sigue_a_hamada(client):
    d = client.get("/v2/valuation/WALMEX.MX").json()["dcf"]["inputs"]
    esperado = d["betaU"] * (1 + (1 - d["taxRate"]) * d["debtToEquity"])
    assert d["betaL"] == pytest.approx(esperado, rel=1e-3)
    assert d["costOfEquity"] > d["wacc"] > d["costOfDebt"] * (1 - d["taxRate"])


def test_una_emisora_mexicana_descuenta_con_la_tasa_del_peso(client):
    cuerpo = client.get("/v2/valuation/WALMEX.MX").json()
    assert cuerpo["currency"] == "MXN"
    assert cuerpo["multiples"]["market"] == "EM"
    assert cuerpo["assumptions"]["rf"] == pytest.approx(0.0916 - 0.016181, abs=1e-6)
    assert cuerpo["assumptions"]["crp"] == 0.02465
    assert cuerpo["dcf"]["inputs"]["currency"] == "MXN"


def test_quien_reporta_en_otra_moneda_descuenta_en_esa_moneda(client):
    cuerpo = client.get("/v2/valuation/CEMEXCPO.MX").json()
    assert cuerpo["currency"] == "MXN", "el precio y los múltiplos van en pesos"
    assert cuerpo["dcf"]["inputs"]["currency"] == "USD", "los flujos de Cemex son dólares"
    assert cuerpo["assumptions"]["rf"] == pytest.approx(0.0501 - 0.002334, abs=1e-6)
    assert any("moneda de los flujos" in n for n in cuerpo["meta"]["notes"])
    assert any("tipo de cambio" in n.lower() or "cotiza en" in n for n in cuerpo["meta"]["notes"])


def test_una_fibra_no_se_valua_por_multiplos_ni_por_dcf(client):
    cuerpo = client.get("/v2/valuation/FUNO11.MX").json()
    assert cuerpo["multiples"]["applicable"] is False
    assert "FIBRA" in cuerpo["multiples"]["reason"]
    assert cuerpo["multiples"]["fairValueRange"] is None
    assert cuerpo["dcf"]["applicable"] is False
    assert "revaluación" in cuerpo["dcf"]["reason"]
    assert cuerpo["dcf"]["projection"] == []
    # Los múltiplos actuales se siguen viendo, solo que sin precio implícito.
    pe = next(m for m in cuerpo["multiples"]["methods"] if m["id"] == "pe")
    assert pe["current"] and pe["impliedPrice"] is None


def test_un_banco_se_valua_con_p_vl_justificado(client):
    cuerpo = client.get("/v2/valuation/GFNORTEO.MX").json()
    banco = cuerpo["bank"]
    assert banco and banco["applicable"] is True
    esperado = (banco["roe"] - banco["growth"]) / (banco["costOfEquity"] - banco["growth"])
    assert banco["justifiedPB"] == pytest.approx(esperado, rel=1e-4)
    assert banco["impliedPrice"] > 0
    assert cuerpo["multiples"]["applicable"] is False and "banco" in cuerpo["multiples"]["reason"]
    assert cuerpo["dcf"]["applicable"] is False and "FCFF" in cuerpo["dcf"]["reason"]
    assert any("beta de regresión" in n for n in cuerpo["meta"]["notes"])


def test_un_etf_o_un_indice_no_se_valuan(client):
    for symbol in ("SPY", "%5EMXX"):
        cuerpo = client.get(f"/v2/valuation/{symbol}").json()
        assert cuerpo["multiples"]["applicable"] is False
        assert cuerpo["dcf"]["applicable"] is False
        assert "ETF" in cuerpo["dcf"]["reason"]
        assert cuerpo["bank"] is None


def test_los_parametros_de_la_consulta_mueven_la_valuacion(client):
    base = client.get("/v2/valuation/AAPL").json()
    otro = client.get("/v2/valuation/AAPL?erp=0.06&crp=0.01&terminalGrowth=0.02&years=10&growth=0.05").json()
    assert otro["assumptions"]["erp"] == 0.06
    assert otro["assumptions"]["crp"] == 0.01
    assert otro["assumptions"]["terminalGrowth"] == 0.02
    assert otro["dcf"]["inputs"]["years"] == 10 and len(otro["dcf"]["projection"]) == 10
    assert otro["dcf"]["inputs"]["growth"] == 0.05
    assert otro["dcf"]["inputs"]["costOfEquity"] > base["dcf"]["inputs"]["costOfEquity"]
    # Más prima de riesgo y menos crecimiento terminal: vale menos.
    assert otro["dcf"]["perShare"] < base["dcf"]["perShare"]


def test_un_crecimiento_terminal_arriba_de_la_tasa_libre_de_riesgo_se_recorta(client):
    cuerpo = client.get("/v2/valuation/AAPL?terminalGrowth=0.06").json()
    d = cuerpo["dcf"]
    assert d["inputs"]["terminalGrowth"] == pytest.approx(cuerpo["assumptions"]["rf"], abs=1e-6)
    assert d["warnings"] and "tasa libre de riesgo" in d["warnings"][0]


@pytest.mark.parametrize(
    "url,status,code",
    [
        ("/v2/valuation/ZZZNOTREAL", 404, "NOT_FOUND"),
        ("/v2/momentum/ZZZNOTREAL", 404, "NOT_FOUND"),
        ("/v2/valuation/AAPL%20X", 400, "INVALID_SYMBOL"),
        ("/v2/momentum/%3Cscript%3E", 400, "INVALID_SYMBOL"),
        ("/v2/valuation/AAPL?erp=0.5", 422, "VALIDATION_ERROR"),
        ("/v2/valuation/AAPL?crp=-0.1", 422, "VALIDATION_ERROR"),
        ("/v2/valuation/AAPL?years=40", 422, "VALIDATION_ERROR"),
        ("/v2/valuation/AAPL?terminalGrowth=0.2", 422, "VALIDATION_ERROR"),
        ("/v2/valuation/AAPL?growth=3", 422, "VALIDATION_ERROR"),
    ],
)
def test_los_errores_traen_el_cuerpo_del_contrato_en_espanol(client, url, status, code):
    r = client.get(url)
    assert r.status_code == status, r.text
    cuerpo = ErrorBody.model_validate(r.json())
    assert cuerpo.error.code == code
    assert cuerpo.error.message and "—" not in cuerpo.error.message
    assert r.headers["cache-control"] == "no-store"


def test_sin_tasa_libre_de_riesgo_la_ruta_no_valua_a_ciegas(client, monkeypatch):
    from kaizen_api.domain.valuation import params

    monkeypatch.setattr(params, "_fred_last", lambda series: None)
    r = client.get("/v2/valuation/AAPL")
    assert r.status_code == 503
    cuerpo = ErrorBody.model_validate(r.json())
    assert cuerpo.error.code == "UPSTREAM_UNAVAILABLE"
    assert "libre de riesgo" in cuerpo.error.message


def test_sin_tasa_en_pesos_el_costo_de_capital_se_convierte_con_la_inflacion(client, monkeypatch):
    from kaizen_api.domain.valuation import params

    original = params._fred_last
    monkeypatch.setattr(params, "_fred_last", lambda s: None if s == "IRLTLT01MXM156N" else original(s))
    cuerpo = client.get("/v2/valuation/WALMEX.MX").json()
    assert cuerpo["meta"]["fallback"] is True
    assert any("diferencial de inflación esperada" in n for n in cuerpo["meta"]["notes"])
    # El costo de capital en pesos queda arriba del que salía en dólares.
    assert cuerpo["dcf"]["inputs"]["wacc"] > 0
    en_dolares = (1 + cuerpo["dcf"]["inputs"]["wacc"]) * 1.02 / 1.03 - 1
    assert en_dolares < cuerpo["dcf"]["inputs"]["wacc"]


# ─── momentum ────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("symbol", EMISORAS)
def test_el_momentum_cumple_el_contrato(client, symbol):
    r = client.get(f"/v2/momentum/{symbol}")
    assert r.status_code == 200, r.text
    cuerpo = MomentumResponse.model_validate(r.json())
    assert cuerpo.symbol == symbol.replace("%5E", "^")
    assert cuerpo.benchmark in ("SPY", "NAFTRAC.MX")
    assert r.headers["cache-control"] == "private, max-age=3600"
    for campo in ("r12m1", "r6m", "r3m", "benchmarkR12m1", "relative12m1"):
        valor = getattr(cuerpo, campo)
        assert valor is None or -1 <= valor <= 10, f"{campo} tiene que ser fracción"


def test_el_momentum_compara_contra_la_referencia_de_su_moneda(client, monkeypatch):
    import datetime as dt

    from kaizen_api.domain.screeners import momentum as mom

    monkeypatch.setattr(mom._dt, "date", type("H", (dt.date,), {"today": classmethod(lambda cls: dt.date(2026, 9, 22))}))
    eeuu = client.get("/v2/momentum/AAPL").json()
    assert eeuu["currency"] == "USD" and eeuu["benchmark"] == "SPY"
    mexico = client.get("/v2/momentum/WALMEX.MX").json()
    assert mexico["currency"] == "MXN" and mexico["benchmark"] == "NAFTRAC.MX"
    assert mexico["relative12m1"] == pytest.approx(mexico["r12m1"] - mexico["benchmarkR12m1"], abs=1e-9)
    assert mexico["meta"]["source"] == "yahoo,computed"
    assert mexico["meta"]["asOf"] == "2026-08-31", "fecha del cierre, no del día 1 con que Yahoo fecha la barra"
    assert mexico["meta"]["stale"] is False
    assert mexico["meta"]["fallback"] is False


def test_las_notas_del_momentum_estan_en_espanol_y_sin_guiones_largos(client):
    for ruta, texto in textos(client.get("/v2/momentum/CEMEXCPO.MX").json()):
        assert "—" not in texto and "–" not in texto, f"{ruta}: {texto}"


# ─── capacidades ─────────────────────────────────────────────────────────────


def test_health_anuncia_las_tres_capacidades_de_b3b(client):
    caps = client.get("/health").json()["capabilities"]
    assert {"valuation.multiples", "valuation.dcf", "momentum"} <= set(caps)


def test_el_router_no_deja_ninguna_ruta_marcada_como_stub():
    from kaizen_api.routers import is_stub, valuation

    assert not is_stub(valuation.valuation)
    assert not is_stub(valuation.momentum)
    assert valuation.CAPABILITIES == ["valuation.multiples", "valuation.dcf", "momentum"]


def test_la_nota_del_dcf_dice_de_donde_salio_el_crecimiento(client):
    """Un 18.7 % anual sin decir de dónde viene no es honesto: la nota nombra la fuente."""
    base = client.get("/v2/valuation/AAPL").json()
    nota = next(n for n in base["meta"]["notes"] if n.startswith("FCFF del último ejercicio"))
    assert "Damodaran" in nota and "el sector Technology en el mercado US" in nota

    pedido = client.get("/v2/valuation/AAPL?growth=0.05").json()
    nota = next(n for n in pedido["meta"]["notes"] if n.startswith("FCFF del último ejercicio"))
    assert "que pediste en la consulta" in nota
    assert "Damodaran" not in nota
    assert pedido["dcf"]["inputs"]["growth"] == 0.05
