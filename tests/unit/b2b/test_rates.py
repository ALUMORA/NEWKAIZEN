"""``/v2/rates/mx`` y ``/v2/rates/rf``: unidades, respaldo marcado y el camino con token de Banxico.

Hay dos escenarios y los dos importan:

* **sin token**, que es el de hoy: las rutas salen del respaldo de FRED con ``fallback`` en ``true``
  y diciendo en ``notes`` qué falta. Se prueba en replay, contra los fixtures grabados.
* **con token**, que es el del día que el dueño lo consiga: el SIE se simula con ``responses``,
  porque no hay token que grabar.
"""

from __future__ import annotations

import re

import pytest
import responses
from fastapi.testclient import TestClient

from kaizen_api.domain import rates as rates_domain
from kaizen_api.providers import banxico
from kaizen_api.schemas import MxRatesResponse, RfSeriesResponse

from .conftest import build_app

SIE_METADATOS_RE = re.compile(r"https://www\.banxico\.org\.mx/SieAPIRest/service/v1/series/[A-Z0-9,]+$")
SIE_DATOS_RE = re.compile(r"https://www\.banxico\.org\.mx/SieAPIRest/service/v1/series/[A-Z0-9,]+/datos/.+")

TITULOS = {
    "SF43718": "Tipo de cambio FIX, pesos por dólar",
    "SF61745": "Tasa objetivo de política monetaria",
    # El título real del SIE (25 sep 2026): la subasta semanal, con "subasta" en el título.
    "SF43936": "Valores gubernamentales Resultados de la subasta semanal Tasa de rendimiento Cetes a 28 días",
}
"""Solo tres series se dan por buenas en la simulación: las demás no las confirma el SIE."""


def _unidad(sid: str) -> str:
    return "Por ciento anual" if banxico.catalog()[sid]["sieUnit"] == "percent" else "Pesos por Dólar"


def _metadatos(ids=None, titulos=None) -> dict:
    """Metadatos como los devuelve el SIE: título, unidad y periodicidad de cada serie."""
    return {"bmx": {"series": [{"idSerie": sid, "titulo": titulo, "unidad": _unidad(sid),
                                "periodicidad": banxico.catalog()[sid]["periodicidad"],
                                "fechaInicio": "01/01/2000", "fechaFin": "18/09/2026"}
                               for sid, titulo in (titulos or TITULOS).items() if ids is None or sid in ids]}}


def _datos() -> dict:
    return {"bmx": {"series": [
        {"idSerie": "SF43718", "titulo": TITULOS["SF43718"], "datos": [
            {"fecha": "17/09/2026", "dato": "17.2510"}, {"fecha": "18/09/2026", "dato": "17.3125"}]},
        {"idSerie": "SF61745", "titulo": TITULOS["SF61745"], "datos": [
            {"fecha": "14/08/2026", "dato": "7.50"}, {"fecha": "18/09/2026", "dato": "7.25"}]},
        {"idSerie": "SF43936", "titulo": TITULOS["SF43936"], "datos": [
            {"fecha": "11/09/2026", "dato": "7.38"}, {"fecha": "18/09/2026", "dato": "7.45"}, ]},
    ]}}


@pytest.fixture
def cetes28_revisada(clean_state, monkeypatch):
    """Simula que el dueño ya corrió la prueba en vivo y dejó ``verified: true`` en CETES 28."""
    monkeypatch.setitem(banxico.catalog()["SF43936"], "verified", True)


@pytest.fixture
def cetes28_sin_revision(clean_state, monkeypatch):
    """Simula una serie del catálogo que todavía nadie confirmó con la prueba en vivo."""
    monkeypatch.setitem(banxico.catalog()["SF43936"], "verified", False)


@pytest.fixture
def cliente_con_token(clean_state):
    """Cliente de la app con BANXICO_TOKEN puesto y el SIE simulado; sin replay, porque no hay token real."""
    with responses.RequestsMock(assert_all_requests_are_fired=False) as mock:
        mock.add(responses.GET, SIE_DATOS_RE, json=_datos(), status=200)
        mock.add(responses.GET, SIE_METADATOS_RE, json=_metadatos(), status=200)
        mock.add(responses.GET, re.compile(r"https://fred\.stlouisfed\.org/graph/fredgraph\.csv.*"),
                 body="observation_date,IR3TIB01MXM156N\n2026-07-01,6.81\n2026-08-01,6.79\n",
                 status=200, content_type="text/csv")
        with TestClient(build_app(BANXICO_TOKEN="token-de-prueba"), raise_server_exceptions=False) as http:
            yield http, mock


# ─── sin token: el respaldo marcado ──────────────────────────────────────────


def test_rates_mx_sin_token_usa_el_respaldo_de_fred_y_lo_dice(client):
    r = client.get("/v2/rates/mx")
    assert r.status_code == 200, r.text
    body = MxRatesResponse.model_validate(r.json())
    assert body.meta.fallback is True, "un sustituto NUNCA se muestra como dato en vivo"
    assert body.meta.source == "fred"
    assert [item.id for item in body.items] == ["bonoM10"]
    bono = body.items[0]
    assert bono.seriesId == "IRLTLT01MXM156N"
    assert bono.value == pytest.approx(0.0916), "9.16 % anual sale como fracción, no como 9.16"
    assert bono.previous == pytest.approx(0.0902)
    assert bono.changeBp == pytest.approx(14.0), "14 puntos base, no 0.0014"
    assert bono.unit == "fraction"
    assert bono.asOf == "2026-08-01"
    assert "BANXICO_TOKEN" in " ".join(body.meta.notes)
    assert r.headers["cache-control"] == "private, max-age=3600"


def test_rates_mx_no_disfraza_la_serie_interbancaria_de_fred_de_tiie_ni_de_cetes(client):
    """La serie mensual a 3 meses de la OCDE no es la TIIE de 28 días ni los CETES: no se publica ahí."""
    body = MxRatesResponse.model_validate(client.get("/v2/rates/mx").json())
    ids = {item.id for item in body.items}
    assert not (ids & {"tiie28", "tiieFondeo", "cetes28", "cetes91", "cetes182", "cetes364", "fix", "udi"})
    assert "IR3TIB01MXM156N" not in {item.seriesId for item in body.items}
    assert rates_domain.FRED_RF_SERIES == "IR3TIB01MXM156N", "esa serie solo se usa, marcada, en /v2/rates/rf"


def test_rates_rf_sin_token_es_la_serie_de_fred_marcada(client):
    r = client.get("/v2/rates/rf?tenorDays=28")
    assert r.status_code == 200, r.text
    body = RfSeriesResponse.model_validate(r.json())
    assert body.source == "fred_ir3tib"
    assert body.fallback is True and body.meta.fallback is True
    assert body.convention == "simple_act360"
    assert body.tenorDays == 91, "la serie de respaldo es a 3 meses: el plazo servido es 91, no el pedido"
    assert len(body.dates) == len(body.values) > 12
    assert body.dates == sorted(body.dates)
    assert all(0 < v < 0.5 for v in body.values), "rendimientos anualizados como fracción"
    assert body.values[-1] == pytest.approx(0.0679)
    assert any("no son cetes" in nota.lower() for nota in body.meta.notes)


@pytest.mark.parametrize("tenor", [28, 91, 182, 364])
def test_el_aviso_del_respaldo_nombra_el_plazo_pedido(client, tenor):
    """El respaldo sirve la misma serie de 3 meses para todos los plazos, y lo tiene que decir.

    Antes el aviso dec\u00eda "no son CETES de 28 d\u00edas" aunque pidieras 364, que es cierto pero no
    responde la duda de quien pregunt\u00f3 por 364.
    """
    r = client.get(f"/v2/rates/rf?tenorDays={tenor}")
    assert r.status_code == 200, r.text
    body = RfSeriesResponse.model_validate(r.json())
    assert body.fallback is True
    aviso = next(n for n in body.meta.notes if "no son cetes" in n.lower())
    assert f"de {tenor} d\u00edas" in aviso, f"el aviso no nombra el plazo pedido: {aviso}"
    otros = [t for t in (28, 91, 182, 364) if t != tenor]
    assert not any(f"de {o} d\u00edas" in aviso for o in otros), f"el aviso nombra otro plazo: {aviso}"


def test_rates_rf_respeta_el_rango_de_fechas(client):
    body = RfSeriesResponse.model_validate(
        client.get("/v2/rates/rf?start=2025-01-01&end=2025-12-31").json()
    )
    assert body.dates[0] >= "2025-01-01" and body.dates[-1] <= "2025-12-31"
    assert len(body.dates) == 12, "la serie de respaldo es mensual"


def test_rates_rf_valida_los_parametros(client):
    assert client.get("/v2/rates/rf?tenorDays=30").status_code == 422
    assert client.get("/v2/rates/rf?start=2026-09-22&end=2026-01-01").status_code == 422
    assert client.get("/v2/rates/rf?start=2026-02-30").status_code == 422
    assert client.get("/v2/rates/rf?tenorDays=364").status_code == 200


def test_sin_token_y_sin_fred_la_ruta_dice_qué_falta(client, monkeypatch):
    """Sin nada honesto que mostrar se responde 503 NOT_CONFIGURED, no un número inventado."""
    monkeypatch.setattr(rates_domain.fred, "fetch_series", lambda *a, **k: {"dates": [], "values": []})
    r = client.get("/v2/rates/mx")
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "NOT_CONFIGURED"
    assert "Banxico" in r.json()["error"]["message"]
    rf = client.get("/v2/rates/rf")
    assert rf.status_code == 503
    assert rf.json()["error"]["code"] == "UPSTREAM_UNAVAILABLE"


# ─── con token: las series del SIE ───────────────────────────────────────────


def test_rates_mx_con_token_publica_solo_lo_que_el_sie_confirma(cetes28_revisada, cliente_con_token):
    http, _mock = cliente_con_token
    r = http.get("/v2/rates/mx")
    assert r.status_code == 200, r.text
    body = MxRatesResponse.model_validate(r.json())
    assert body.meta.fallback is False, "con token los datos son de Banxico, no un sustituto"
    assert body.meta.source == "banxico"
    # El orden es el del contrato: objetivo, cetes28, fix.
    assert [item.id for item in body.items] == ["target", "cetes28", "fix"]
    por_id = {item.id: item for item in body.items}
    assert por_id["target"].value == pytest.approx(0.0725), "7.25 % sale como fracción"
    assert por_id["target"].previous == pytest.approx(0.0750)
    assert por_id["target"].changeBp == pytest.approx(-25.0), "un recorte de 25 puntos base"
    assert por_id["target"].seriesId == banxico.SERIES_TARGET
    assert por_id["cetes28"].value == pytest.approx(0.0745)
    assert por_id["cetes28"].changeBp == pytest.approx(7.0)
    # El FIX son pesos por dólar: ni fracción ni puntos base.
    assert por_id["fix"].unit == "mxn"
    assert por_id["fix"].value == pytest.approx(17.3125)
    assert por_id["fix"].changeBp is None
    assert body.meta.asOf == "2026-09-18"


def test_rates_mx_con_token_avisa_de_las_series_que_no_confirmo(cliente_con_token):
    http, _mock = cliente_con_token
    body = MxRatesResponse.model_validate(http.get("/v2/rates/mx").json())
    aviso = " ".join(body.meta.notes)
    assert "SF43783" in aviso and "SP68257" in aviso, "las no confirmadas se nombran, no se esconden"
    assert "SF43718" not in aviso


def test_rates_rf_con_token_usa_cetes_de_banxico(cetes28_revisada, cliente_con_token):
    http, _mock = cliente_con_token
    body = RfSeriesResponse.model_validate(http.get("/v2/rates/rf?tenorDays=28").json())
    assert body.source == "banxico"
    assert body.fallback is False and body.meta.fallback is False
    assert body.dates == ["2026-09-11", "2026-09-18"]
    assert body.values == [pytest.approx(0.0738), pytest.approx(0.0745)]


def test_rates_rf_con_token_cae_a_fred_si_el_plazo_no_esta_verificado(clean_state):
    """CETES a 91 días no lo confirma el SIE en esta simulación: se cae al respaldo, marcado."""
    with responses.RequestsMock(assert_all_requests_are_fired=False) as mock:
        mock.add(responses.GET, SIE_METADATOS_RE, json=_metadatos(ids={"SF43718"}), status=200)
        mock.add(responses.GET, re.compile(r"https://fred\.stlouisfed\.org/graph/fredgraph\.csv.*"),
                 body="observation_date,IR3TIB01MXM156N\n2026-08-01,6.79\n", status=200, content_type="text/csv")
        with TestClient(build_app(BANXICO_TOKEN="token-de-prueba"), raise_server_exceptions=False) as http:
            body = RfSeriesResponse.model_validate(http.get("/v2/rates/rf?tenorDays=91").json())
    assert body.source == "fred_ir3tib"
    assert body.fallback is True
    assert any("SF43939" in nota for nota in body.meta.notes)


def test_si_banxico_no_responde_se_cae_al_respaldo_y_se_avisa(clean_state):
    with responses.RequestsMock(assert_all_requests_are_fired=False) as mock:
        mock.add(responses.GET, SIE_METADATOS_RE, status=500, json={})
        mock.add(responses.GET, re.compile(r"https://fred\.stlouisfed\.org/graph/fredgraph\.csv.*"),
                 body="observation_date,IRLTLT01MXM156N\n2026-07-01,9.02\n2026-08-01,9.16\n",
                 status=200, content_type="text/csv")
        with TestClient(build_app(BANXICO_TOKEN="token-de-prueba"), raise_server_exceptions=False) as http:
            body = MxRatesResponse.model_validate(http.get("/v2/rates/mx").json())
    assert body.meta.fallback is True
    assert [item.id for item in body.items] == ["bonoM10"]
    assert any("respaldo" in nota.lower() for nota in body.meta.notes)


# ─── unidades y frescura ─────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "valor,previo,unidad,esperado",
    [(0.0745, 0.0738, "fraction", 7.0), (0.0725, 0.0750, "fraction", -25.0), (17.31, 17.25, "mxn", None),
     (0.0745, None, "fraction", None)],
)
def test_change_bp(valor, previo, unidad, esperado):
    assert rates_domain._change_bp(valor, previo, unidad) == (
        None if esperado is None else pytest.approx(esperado)
    )


def test_health_anuncia_las_capacidades_de_b2b(client):
    capacidades = set(client.get("/health").json()["capabilities"])
    assert {"rates.mx", "rf.series", "macro.us", "news"} <= capacidades


def test_las_dos_rutas_comparten_una_sola_consulta_de_metadatos(cetes28_revisada, cliente_con_token):
    """Verificar ids cuesta una llamada al SIE, no una por ruta: la caché es del catálogo completo."""
    http, mock = cliente_con_token
    assert http.get("/v2/rates/mx").status_code == 200
    assert http.get("/v2/rates/rf?tenorDays=28").status_code == 200
    metadatos = [llamada for llamada in mock.calls if SIE_METADATOS_RE.match(llamada.request.url)]
    assert len(metadatos) == 1, [llamada.request.url for llamada in metadatos]


# ─── con token: el flag de revisión humana y el candado completo ─────────────


def test_con_token_una_serie_sin_revision_humana_no_se_publica(cetes28_sin_revision, cliente_con_token):
    """El spec pide verificar cada id del SIE en una prueba antes de usarlo.

    Con CETES 28 en ``verified: false``, aunque el SIE la confirme en caliente, no se publica como
    dato en vivo hasta que alguien corra la prueba con token y cambie el flag.
    """
    http, _mock = cliente_con_token
    mx = MxRatesResponse.model_validate(http.get("/v2/rates/mx").json())
    assert [item.id for item in mx.items] == ["target", "fix"]
    aviso = " ".join(mx.meta.notes)
    assert "SF43936" in aviso and "revisión" in aviso
    rf = RfSeriesResponse.model_validate(http.get("/v2/rates/rf?tenorDays=28").json())
    assert rf.source == "fred_ir3tib" and rf.fallback is True
    assert any("SF43936" in nota for nota in rf.meta.notes)


def test_con_token_una_tasa_de_descuento_mensual_no_sale_como_rf(cetes28_revisada, clean_state):
    """El repro de la revisión: el SIE devuelve otra serie de CETES bajo el mismo id.

    Aunque CETES 28 ya esté revisada a mano, el candado en caliente la rechaza si el SIE dice que
    hoy es una tasa de descuento mensual, y la ruta cae al respaldo marcado en vez de servirla.
    """
    titulos = dict(TITULOS, SF43936="Cetes a 28 dias, Tasa de descuento, Promedio mensual")
    meta = _metadatos(titulos=titulos)
    for serie in meta["bmx"]["series"]:
        if serie["idSerie"] == "SF43936":
            serie["periodicidad"] = "Mensual"
    with responses.RequestsMock(assert_all_requests_are_fired=False) as mock:
        mock.add(responses.GET, SIE_DATOS_RE, json=_datos(), status=200)
        mock.add(responses.GET, SIE_METADATOS_RE, json=meta, status=200)
        mock.add(responses.GET, re.compile(r"https://fred\.stlouisfed\.org/graph/fredgraph\.csv.*"),
                 body="observation_date,IR3TIB01MXM156N\n2026-07-01,6.81\n2026-08-01,6.79\n",
                 status=200, content_type="text/csv")
        with TestClient(build_app(BANXICO_TOKEN="token-de-prueba"), raise_server_exceptions=False) as http:
            mx = MxRatesResponse.model_validate(http.get("/v2/rates/mx").json())
            rf = RfSeriesResponse.model_validate(http.get("/v2/rates/rf?tenorDays=28").json())
    assert "cetes28" not in {item.id for item in mx.items}
    assert any("SF43936" in nota and "Mensual" in nota for nota in mx.meta.notes), mx.meta.notes
    assert rf.source == "fred_ir3tib" and rf.fallback is True


@pytest.mark.parametrize("tenor", [28, 91, 182, 364])
def test_el_respaldo_declara_el_plazo_que_sirve_y_no_el_pedido(client, tenor):
    """``tenorDays`` es lo único legible por máquina que nombra el plazo, y el cliente lo usa en
    ``rf_d = (1 + y * T / 360) ** (d / T) - 1``. Con T=28 o T=364 sobre la misma serie de 3 meses
    salen rf distintos a partir de datos idénticos; con 91 el número y la etiqueta dicen lo mismo.
    """
    body = RfSeriesResponse.model_validate(client.get(f"/v2/rates/rf?tenorDays={tenor}").json())
    assert body.source == "fred_ir3tib" and body.fallback is True
    assert body.tenorDays == rates_domain.FRED_RF_TENOR_DAYS == 91
    if tenor != 91:
        assert any(f"se pidió el plazo de {tenor} días" in n.lower() for n in body.meta.notes), body.meta.notes


# ─── banda de cordura ────────────────────────────────────────────────────────


def test_un_bono_m_fuera_de_rango_no_se_publica(client, monkeypatch):
    """Un precio de 102.5 multiplicado por 0.01 no es un rendimiento de 102.5 %: no se publica."""
    monkeypatch.setattr(rates_domain.fred, "fetch_series",
                        lambda *a, **k: {"dates": ["2026-07-01", "2026-08-01"], "values": [9.02, 102.5]})
    r = client.get("/v2/rates/mx")
    assert r.status_code == 503, r.text
    assert "bonoM10" not in r.text


def test_con_token_una_tasa_fuera_de_rango_del_sie_no_se_publica(cetes28_revisada, clean_state):
    datos = _datos()
    for serie in datos["bmx"]["series"]:
        if serie["idSerie"] == "SF43936":
            serie["datos"][-1]["dato"] = "745"
    with responses.RequestsMock(assert_all_requests_are_fired=False) as mock:
        mock.add(responses.GET, SIE_DATOS_RE, json=datos, status=200)
        mock.add(responses.GET, SIE_METADATOS_RE, json=_metadatos(), status=200)
        with TestClient(build_app(BANXICO_TOKEN="token-de-prueba"), raise_server_exceptions=False) as http:
            body = MxRatesResponse.model_validate(http.get("/v2/rates/mx").json())
    assert [item.id for item in body.items] == ["target", "fix"]
    assert any("cetes28" in nota.lower() or "CETES 28" in nota for nota in body.meta.notes), body.meta.notes
    assert any("rango" in nota for nota in body.meta.notes)
