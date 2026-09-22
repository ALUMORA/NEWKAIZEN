"""El dataset de Damodaran y los parámetros de mercado: que los números sean los del archivo."""

from __future__ import annotations

import json
import statistics

import pytest

from kaizen_api.domain import rates as rates_mod
from kaizen_api.domain.valuation import params

MERCADOS = ("US", "EM")


@pytest.fixture(scope="module")
def data() -> dict:
    return params.dataset()


def test_el_archivo_dice_de_donde_salio_y_de_cuando_es(data):
    assert data["vintage"] == "2026-01"
    assert data["dataUpdated"] == "2026-01-05"
    assert data["websiteStatedUpdate"] == "2026-01-09"
    assert data["downloadedAt"] == "2026-09-22"
    assert "Damodaran" in data["author"]
    urls = {s["url"] for s in data["sources"]}
    assert urls, "cada serie tiene que decir de qué archivo salió"
    assert all(u.startswith("https://pages.stern.nyu.edu/~adamodar/") for u in urls)
    assert {s["id"] for s in data["sources"]} >= {"pe", "pb", "evEbitda", "beta", "wacc", "countryRisk"}


def test_lo_que_damodaran_no_publica_queda_marcado_como_faltante(data):
    assert "pfcf" in data["missing"]
    assert "no publica" in data["missing"]["pfcf"]


@pytest.mark.parametrize("market", MERCADOS)
def test_cada_mercado_trae_las_94_industrias_y_sus_parametros(data, market):
    industrias = data["markets"][market]["industries"]
    assert len(industrias) == 94
    assert "Total Market" in data["markets"][market]["totals"]
    p = data["markets"][market]["parameters"]
    assert p["riskFreeUsd"] == 0.0395
    assert p["globalDefaultSpread"] > 0


def test_el_mapa_de_sectores_solo_apunta_a_industrias_que_existen(data):
    conocidas = set(data["markets"]["US"]["industries"])
    for sector, industrias in data["sectorIndustries"].items():
        faltantes = [i for i in industrias if i not in conocidas]
        assert not faltantes, f"{sector}: {faltantes}"
        assert len(industrias) >= 3


def test_riesgo_pais_de_mexico_y_estados_unidos(data):
    assert data["matureMarketErp"] == 0.0423
    mx = data["countries"]["Mexico"]
    assert mx["rating"] == "Baa2"
    assert mx["crp"] == 0.02465
    assert mx["defaultSpread"] == 0.016181
    assert mx["statutoryTaxRate"] == 0.30
    us = data["countries"]["United States"]
    assert us["crp"] == 0.002334
    assert us["statutoryTaxRate"] == 0.25


def test_la_prima_total_de_cada_pais_es_la_del_archivo(data):
    """Comprobado contra ctryprem.xls de enero 2026, hoja "ERPs by country".

    México sale de la fórmula (mercado maduro más prima país) y da 0.06694963, que redondeado
    a cinco decimales es lo que guardamos. Estados Unidos NO: el archivo trae 0.0446 a mano,
    que no es 0.0423 + 0.002334. Copiamos lo que dice el archivo y explicamos la diferencia.
    """
    mx = data["countries"]["Mexico"]
    assert mx["erpTotal"] == 0.06695
    assert round(data["matureMarketErp"] + mx["crp"], 5) == mx["erpTotal"]
    us = data["countries"]["United States"]
    assert us["erpTotal"] == 0.0446
    assert round(data["matureMarketErp"] + us["crp"], 6) != us["erpTotal"]
    assert us["erpTotal"] == data["erpUsdInFile"]
    assert "4.46" in us["erpTotalNote"]


def test_el_pais_se_escribe_en_espanol_para_el_texto_visible():
    assert params.country_risk("Mexico").label == "México"
    assert params.country_risk("United States").label == "Estados Unidos"


def test_country_risk_resuelve_por_pais_moneda_y_sufijo():
    assert params.country_risk("Mexico").country == "Mexico"
    assert params.country_risk(None, "MXN").country == "Mexico"
    assert params.country_risk(None, None, "WALMEX.MX").country == "Mexico"
    assert params.country_risk("Marte", "USD").country == "United States"
    assert params.country_risk("Mexico").mature_erp == 0.0423


def test_la_referencia_sectorial_es_la_mediana_de_sus_industrias(data):
    bench = params.sector_benchmark("Technology", "US")
    industrias = data["markets"]["US"]["industries"]
    esperado = [
        industrias[n]["pe"] for n in data["sectorIndustries"]["Technology"] if (industrias[n]["pe"] or 0) > 0
    ]
    assert len(esperado) >= 8
    assert round(bench.pe, 6) == round(statistics.median(esperado), 6)
    assert bench.market == "US"
    assert bench.sector == "Technology"
    assert "Mediana de 11 industrias" in bench.method
    assert bench.beta_u and 0.2 < bench.beta_u < 3
    assert bench.growth5y is not None


def test_un_sector_desconocido_cae_al_total_del_mercado():
    bench = params.sector_benchmark("Criptomagia", "EM")
    assert bench.sector is None
    assert bench.industries == ["Total Market (without financials)"]
    assert "Total del mercado EM" in bench.method
    assert bench.pe and bench.pe > 0


def test_los_alias_de_sector_de_yahoo():
    assert params.normalize_sector("Financial Services") == "Financial Services"
    assert params.normalize_sector("Financials") == "Financial Services"
    assert params.normalize_sector("Materials") == "Basic Materials"
    assert params.normalize_sector(None) is None


def test_el_mercado_sale_del_pais_y_el_sufijo_desempata():
    assert params.market_for("United States") == "US"
    assert params.market_for("Mexico") == "EM"
    assert params.market_for(None, "WALMEX.MX") == "EM"
    assert params.market_for(None, "AAPL") == "US"


@pytest.mark.parametrize(
    "quote_type,sector,industry,symbol,esperado",
    [
        ("EQUITY", "Technology", "Consumer Electronics", "AAPL", ()),
        ("EQUITY", "Financial Services", "Banks - Regional", "GFNORTEO.MX", ("is_bank",)),
        ("EQUITY", "Financial Services", "Insurance - Life", "MET", ("is_insurer",)),
        ("EQUITY", "Real Estate", "REIT - Diversified", "FUNO11.MX", ("is_reit",)),
        ("ETF", None, None, "SPY", ("is_fund",)),
        ("INDEX", None, None, "^MXX", ("is_fund",)),
    ],
)
def test_clasificacion_de_la_emisora(quote_type, sector, industry, symbol, esperado):
    c = params.classify(quote_type=quote_type, sector=sector, industry=industry, symbol=symbol)
    for bandera in ("is_fund", "is_bank", "is_insurer", "is_reit"):
        assert getattr(c, bandera) is (bandera in esperado), bandera
    if esperado:
        assert c.multiples_reason
        assert "—" not in c.multiples_reason


def test_las_razones_estan_en_espanol_y_sin_guiones_largos():
    for c in (
        params.Classification(is_fund=True),
        params.Classification(is_bank=True),
        params.Classification(is_insurer=True),
        params.Classification(is_reit=True),
    ):
        for texto in (c.multiples_reason, c.dcf_reason):
            if texto:
                assert "—" not in texto and "–" not in texto
                assert not any(p in texto.upper() for p in ("COMPRAR", "VENDER", "BUY", "SELL"))


# ─── tasa libre de riesgo ────────────────────────────────────────────────────


def test_la_tasa_libre_de_riesgo_sale_del_bono_a_10_anos(replay_b3b):
    usd = params.risk_free("USD")
    assert usd is not None
    assert usd.source == "fred"
    assert usd.gross_rate == 0.0501 and usd.as_of == "2026-09-18"
    # Al bono se le resta el diferencial soberano del país.
    assert round(usd.rate, 6) == round(0.0501 - 0.002334, 6)
    assert usd.fallback is False
    assert any("incumplimiento soberano" in n for n in usd.notes)

    mxn = params.risk_free("MXN")
    assert mxn.gross_rate == 0.0916 and mxn.as_of == "2026-08-01"
    assert round(mxn.rate, 6) == round(0.0916 - 0.016181, 6)
    assert mxn.fallback is False


def test_sin_bono_largo_se_usa_la_costura_de_b2b_y_queda_marcada_como_respaldo(monkeypatch):
    monkeypatch.setattr(params, "_fred_last", lambda series: None)
    monkeypatch.setattr(
        rates_mod,
        "rf_latest",
        lambda currency: {"rate": 0.0785, "asOf": "2026-09-19", "source": "banxico"},
        raising=False,
    )
    rf = params.risk_free("MXN")
    assert rf is not None
    assert rf.rate == 0.0785 and rf.as_of == "2026-09-19" and rf.source == "banxico"
    assert rf.fallback is True
    assert any("CETES 28" in n for n in rf.notes)


def test_una_costura_con_forma_rara_no_se_usa(monkeypatch):
    monkeypatch.setattr(params, "_fred_last", lambda series: None)
    for payload in (None, {}, {"rate": "ocho"}, {"rate": 12.0}, ["0.08"]):
        monkeypatch.setattr(rates_mod, "rf_latest", lambda currency, p=payload: p, raising=False)
        assert params.risk_free("MXN") is None
    monkeypatch.setattr(rates_mod, "rf_latest", lambda currency: 1 / 0, raising=False)
    assert params.risk_free("MXN") is None


def test_sin_ninguna_fuente_no_hay_valor_fijo_silencioso(monkeypatch):
    monkeypatch.setattr(params, "_fred_last", lambda series: None)
    monkeypatch.delattr(rates_mod, "rf_latest", raising=False)
    assert params.risk_free("MXN") is None
    assert params.risk_free("EUR") is None


def test_las_anclas_de_inflacion_dicen_su_fuente():
    for moneda in ("MXN", "USD"):
        ancla = params.inflation_anchor(moneda)
        assert 0 < ancla["value"] < 0.1
        assert ancla["source"] and ancla["asOf"]
    assert params.inflation_anchor("JPY") is None


def test_el_archivo_es_json_valido_y_no_trae_guiones_largos():
    crudo = params.DATA_FILE.read_text(encoding="utf-8")
    json.loads(crudo)
    assert "—" not in crudo and "–" not in crudo


def test_la_referencia_se_nombra_igual_en_las_notas():
    """La nota del DCF dice de dónde salió el crecimiento, así que la etiqueta importa."""
    assert params.sector_benchmark("Technology", "US").label() == "el sector Technology en el mercado US"
    assert params.sector_benchmark("Criptomagia", "EM").label() == "el total del mercado EM"
