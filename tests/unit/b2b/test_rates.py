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
    "SF43936": "Cetes a 28 días, tasa de rendimiento",
}
"""Solo tres series se dan por buenas en la simulación: las demás no las confirma el SIE."""


def _metadatos(ids=None) -> dict:
    return {"bmx": {"series": [{"idSerie": sid, "titulo": titulo, "unidad": "n/a", "periodicidad": "Diaria",
                                "fechaInicio": "01/01/2000", "fechaFin": "18/09/2026"}
                               for sid, titulo in TITULOS.items() if ids is None or sid in ids]}}


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
def cliente_con_token(clean_state):
    """Cliente de la app con BANXICO_TOKEN puesto y el SIE simulado; sin replay, porque no hay token real."""
    with responses.RequestsMock(assert_all_requests_are_fired=False) as mock:
        mock.add(responses.GET, SIE_DATOS_RE, json=_datos(), status=200)
        mock.add(responses.GET, SIE_METADATOS_RE, json=_metadatos(), status=200)
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
    assert body.tenorDays == 28
    assert len(body.dates) == len(body.values) > 12
    assert body.dates == sorted(body.dates)
    assert all(0 < v < 0.5 for v in body.values), "rendimientos anualizados como fracción"
    assert body.values[-1] == pytest.approx(0.0679)
    assert any("no son cetes" in nota.lower() for nota in body.meta.notes)


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


def test_rates_mx_con_token_publica_solo_lo_que_el_sie_confirma(cliente_con_token):
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


def test_rates_rf_con_token_usa_cetes_de_banxico(cliente_con_token):
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


def test_las_dos_rutas_comparten_una_sola_consulta_de_metadatos(cliente_con_token):
    """Verificar ids cuesta una llamada al SIE, no una por ruta: la caché es del catálogo completo."""
    http, mock = cliente_con_token
    assert http.get("/v2/rates/mx").status_code == 200
    assert http.get("/v2/rates/rf?tenorDays=28").status_code == 200
    metadatos = [llamada for llamada in mock.calls if SIE_METADATOS_RE.match(llamada.request.url)]
    assert len(metadatos) == 1, [llamada.request.url for llamada in metadatos]
