"""Proveedor del SIE de Banxico: catálogo, formatos, token en la cabecera y verificación de ids.

No hay token todavía, así que el SIE se simula con ``responses`` usando el formato de respuesta que
documenta la propia API (``{"bmx": {"series": [{"idSerie", "titulo", "datos": [{"fecha", "dato"}]}]}}``
con fechas ``dd/mm/aaaa`` y ``"N/E"`` en los días sin dato).
"""

from __future__ import annotations

import json

import pytest
import responses

from kaizen_api.errors import ApiError
from kaizen_api.providers import banxico
from kaizen_api.schemas import MxRateId
from kaizen_api.settings import Settings, configure

TOKEN = "token-de-prueba-que-no-existe"

SIE_DATOS = {
    "bmx": {
        "series": [
            {
                "idSerie": "SF43718",
                "titulo": "Tipo de cambio Pesos por dólar E.U.A. Tipo de cambio para solventar obligaciones "
                "denominadas en moneda extranjera Fecha de determinación (FIX)",
                "datos": [
                    {"fecha": "16/09/2026", "dato": "N/E"},
                    {"fecha": "17/09/2026", "dato": "17.2510"},
                    {"fecha": "18/09/2026", "dato": "17.3125"},
                ],
            },
            {
                "idSerie": "SF61745",
                "titulo": "Tasa objetivo",
                "datos": [
                    {"fecha": "17/09/2026", "dato": "7.50"},
                    {"fecha": "18/09/2026", "dato": "7.25"},
                ],
            },
        ]
    }
}

SIE_METADATOS = {
    "bmx": {
        "series": [
            {
                "idSerie": "SF43718",
                "titulo": "Tipo de cambio Pesos por dólar E.U.A. (FIX)",
                "unidad": "Pesos por Dólar",
                "periodicidad": "Diaria",
                "fechaInicio": "12/11/1991",
                "fechaFin": "18/09/2026",
            },
            {
                "idSerie": "SF43936",
                "titulo": "Valores gubernamentales, resultados de la subasta semanal, Cetes a 28 días, "
                "Tasa de rendimiento",
                "unidad": "Por ciento anual",
                "periodicidad": "Semanal",
                "fechaInicio": "16/01/1986",
                "fechaFin": "17/09/2026",
            },
        ]
    }
}


@pytest.fixture
def con_token(clean_state):
    configure(Settings.from_env({"BANXICO_TOKEN": TOKEN}))
    yield TOKEN
    configure(None)


@pytest.fixture
def sin_token(clean_state):
    configure(Settings.from_env({}))
    yield
    configure(None)


# ─── formatos del SIE ────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "raw,esperado",
    [
        ("17.2510", 17.251),
        ("7.50", 7.5),
        ("17,251.23", 17251.23),  # la coma es separador de miles, no decimal
        ("1,234", 1234.0),
        ("  8.123456  ", 8.123456),
        ("6.79%", 6.79),
        ("N/E", None),
        ("N/D", None),
        ("", None),
        ("-", None),
        ("no es un número", None),
        (None, None),
        (7.5, 7.5),
    ],
)
def test_parse_amount(raw, esperado):
    assert banxico.parse_amount(raw) == esperado


def test_parse_amount_no_confunde_miles_con_decimales():
    """``"1,234"`` son mil doscientos treinta y cuatro pesos, no 1.234. Es el error clásico del SIE."""
    assert banxico.parse_amount("1,234") == 1234.0
    assert banxico.parse_amount("1.234") == 1.234


@pytest.mark.parametrize(
    "raw,esperado",
    [("22/09/2026", "2026-09-22"), ("01/01/1995", "1995-01-01"), ("2026-09-22", "2026-09-22"), ("", None), ("x", None)],
)
def test_parse_date(raw, esperado):
    assert banxico.parse_date(raw) == esperado


# ─── configuración ───────────────────────────────────────────────────────────


def test_sin_token_no_esta_configurado_y_levanta_503(sin_token):
    assert banxico.configured() is False
    with pytest.raises(ApiError) as exc:
        banxico.require_token()
    assert exc.value.status == 503
    assert exc.value.code == "NOT_CONFIGURED"
    assert "Banxico" in exc.value.message


def test_sin_token_ninguna_consulta_sale_a_la_red(sin_token):
    """Sin token ni siquiera se intenta la llamada: quien llama cae a su respaldo."""
    with responses.RequestsMock(assert_all_requests_are_fired=False):
        for llamada in (lambda: banxico.fetch_series(["SF43718"]), lambda: banxico.fetch_metadata(["SF43718"])):
            with pytest.raises(ApiError) as exc:
                llamada()
            assert exc.value.code == "NOT_CONFIGURED"


def test_con_token_si_esta_configurado(con_token):
    assert banxico.configured() is True
    assert banxico.require_token() == TOKEN


# ─── consulta de datos ───────────────────────────────────────────────────────


@responses.activate
def test_fetch_series_dato_oportuno_manda_el_token_en_la_cabecera(con_token):
    responses.add(
        responses.GET,
        f"{banxico.SIE_BASE_URL}/series/SF43718,SF61745/datos/oportuno",
        json=SIE_DATOS,
        status=200,
    )
    series = banxico.fetch_series(["sf43718", "SF61745"])
    peticion = responses.calls[0].request
    assert peticion.headers["Bmx-Token"] == TOKEN
    assert TOKEN not in peticion.url, "el token nunca va en la URL: la URL sí se graba en los fixtures"
    assert set(series) == {"SF43718", "SF61745"}
    # El día con "N/E" no entra, y los que sí entran quedan en orden cronológico.
    assert series["SF43718"]["dates"] == ["2026-09-17", "2026-09-18"]
    assert series["SF43718"]["values"] == [17.251, 17.3125]
    assert series["SF61745"]["values"] == [7.5, 7.25]
    assert "FIX" in series["SF43718"]["titulo"]


@responses.activate
def test_fetch_series_con_rango_usa_la_ruta_de_fechas(con_token):
    responses.add(
        responses.GET,
        f"{banxico.SIE_BASE_URL}/series/SF43936/datos/2026-01-01/2026-09-22",
        json={"bmx": {"series": [{"idSerie": "SF43936", "titulo": "Cetes 28", "datos": [
            {"fecha": "22/09/2026", "dato": "7.45"}]}]}},
        status=200,
    )
    series = banxico.fetch_series(["SF43936"], "2026-01-01", "2026-09-22")
    assert series["SF43936"]["dates"] == ["2026-09-22"]
    assert series["SF43936"]["values"] == [7.45]


def test_fetch_series_pide_las_dos_fechas_o_ninguna(con_token):
    with pytest.raises(ValueError):
        banxico.fetch_series(["SF43718"], "2026-01-01", None)
    with pytest.raises(ValueError):
        banxico.fetch_series([])


@responses.activate
def test_fetch_series_ordena_aunque_el_sie_devuelva_al_reves(con_token):
    responses.add(
        responses.GET,
        f"{banxico.SIE_BASE_URL}/series/SF43718/datos/oportuno",
        json={"bmx": {"series": [{"idSerie": "SF43718", "titulo": "FIX", "datos": [
            {"fecha": "18/09/2026", "dato": "17.31"},
            {"fecha": "17/09/2026", "dato": "17.25"}]}]}},
        status=200,
    )
    serie = banxico.fetch_series(["SF43718"])["SF43718"]
    assert serie["dates"] == ["2026-09-17", "2026-09-18"]
    assert serie["values"] == [17.25, 17.31]


@responses.activate
@pytest.mark.parametrize("status,code", [(401, "NOT_CONFIGURED"), (403, "NOT_CONFIGURED"),
                                         (500, "UPSTREAM_UNAVAILABLE"), (429, "UPSTREAM_UNAVAILABLE")])
def test_errores_http_del_sie(con_token, status, code):
    responses.add(responses.GET, f"{banxico.SIE_BASE_URL}/series/SF43718/datos/oportuno", status=status, json={})
    with pytest.raises(ApiError) as exc:
        banxico.fetch_series(["SF43718"])
    assert exc.value.status == 503
    assert exc.value.code == code


@responses.activate
def test_respuesta_que_no_es_json_es_upstream(con_token):
    responses.add(responses.GET, f"{banxico.SIE_BASE_URL}/series/SF43718/datos/oportuno",
                  body="<html>mantenimiento</html>", status=200)
    with pytest.raises(ApiError) as exc:
        banxico.fetch_series(["SF43718"])
    assert exc.value.code == "UPSTREAM_UNAVAILABLE"


@responses.activate
def test_cuerpo_sin_series_devuelve_vacio_sin_reventar(con_token):
    responses.add(responses.GET, f"{banxico.SIE_BASE_URL}/series/SF43718/datos/oportuno",
                  json={"bmx": {}}, status=200)
    assert banxico.fetch_series(["SF43718"]) == {}


# ─── metadatos y verificación ────────────────────────────────────────────────


@responses.activate
def test_fetch_metadata(con_token):
    responses.add(responses.GET, f"{banxico.SIE_BASE_URL}/series/SF43718,SF43936", json=SIE_METADATOS, status=200)
    meta = banxico.fetch_metadata(["SF43718", "SF43936"])
    assert meta["SF43936"]["periodicidad"] == "Semanal"
    assert meta["SF43936"]["unidad"] == "Por ciento anual"
    assert meta["SF43718"]["fechaFin"] == "2026-09-18"


def test_title_matches_ignora_acentos_y_mayusculas():
    assert banxico.title_matches("Cetes a 28 días, Tasa de rendimiento", ["cetes", "28"])
    assert banxico.title_matches("CETES A 28 DÍAS", ["cetes", "28"])
    assert not banxico.title_matches("Cetes a 91 días", ["cetes", "28"])
    assert not banxico.title_matches("", ["cetes"])
    assert not banxico.title_matches("Cetes a 28 días", [])


@responses.activate
def test_verified_ids_confirma_contra_los_metadatos(con_token):
    responses.add(responses.GET, f"{banxico.SIE_BASE_URL}/series/SF43718,SF43936,SF43939",
                  json=SIE_METADATOS, status=200)
    verificadas = banxico.verified_ids(["SF43718", "SF43936", "SF43939"])
    assert verificadas["SF43718"] is True
    assert verificadas["SF43936"] is True
    # SF43939 (Cetes 91) no vino en los metadatos: no se da por buena.
    assert verificadas["SF43939"] is False


@responses.activate
def test_verified_ids_rechaza_un_titulo_que_no_corresponde(con_token):
    responses.add(
        responses.GET,
        f"{banxico.SIE_BASE_URL}/series/SF43936",
        json={"bmx": {"series": [{"idSerie": "SF43936", "titulo": "Cetes a 91 días", "unidad": "Por ciento anual"}]}},
        status=200,
    )
    assert banxico.verified_ids(["SF43936"]) == {"SF43936": False}


@responses.activate
def test_verified_ids_se_cachea(con_token):
    responses.add(responses.GET, f"{banxico.SIE_BASE_URL}/series/SF43718", json=SIE_METADATOS, status=200)
    banxico.verified_ids(["SF43718"])
    banxico.verified_ids(["SF43718"])
    assert len(responses.calls) == 1, "la verificación se cachea 24 h, no se pregunta en cada request"


def test_verified_ids_vacio(con_token):
    assert banxico.verified_ids([]) == {}


# ─── el catálogo ─────────────────────────────────────────────────────────────


def test_catalogo_solo_tiene_dos_series_verificadas():
    """Solo el FIX y la tasa objetivo están confirmadas a mano; el resto espera un token real."""
    verificadas = sorted(sid for sid, item in banxico.catalog().items() if item["verified"])
    assert verificadas == ["SF43718", "SF61745"]
    assert set(banxico.VERIFIED_IDS) == set(verificadas)


def test_catalogo_esta_completo_y_bien_formado():
    catalogo = banxico.catalog()
    ids_contrato = set(MxRateId.__args__)
    vistos = set()
    for sid, item in catalogo.items():
        assert sid.startswith(("SF", "SP")), sid
        assert item["rateId"] in ids_contrato, f"{sid} usa un id que el contrato no conoce"
        assert item["rateId"] not in vistos, f"{item['rateId']} está en dos series"
        vistos.add(item["rateId"])
        assert item["unit"] in ("fraction", "index", "mxn")
        assert item["sieUnit"] in ("percent", "mxn")
        assert item["label"] and item["tituloContiene"]
        assert isinstance(item["maxAgeDays"], int) and item["maxAgeDays"] > 0
    assert vistos == ids_contrato, f"faltan ids del contrato en el catálogo: {sorted(ids_contrato - vistos)}"


def test_las_etiquetas_del_catalogo_llevan_acentos():
    """Las etiquetas del cat\u00e1logo se publican tal cual en ``MxRateItem.label``.

    Sin token ninguna de estas sale, as\u00ed que el defecto ser\u00eda invisible hasta que el due\u00f1o consiga
    uno: de ah\u00ed la prueba. Se revisa por palabra completa para no cazar "dia" dentro de otra cosa.
    """
    import re

    sin_acento = ("dias", "dia", "anos", "Inflacion", "numero", "periodicidad")
    for sid, item in banxico.catalog().items():
        etiqueta = item["label"]
        for palabra in sin_acento:
            assert not re.search(rf"\b{palabra}\b", etiqueta), (
                f"{sid} publica '{etiqueta}' sin acentos y eso se ve en la app"
            )


def test_series_for_resuelve_el_id_del_contrato():
    assert banxico.series_for("cetes28") == "SF43936"
    assert banxico.series_for("fix") == banxico.SERIES_FIX
    assert banxico.series_for("target") == banxico.SERIES_TARGET
    assert banxico.series_for("no-existe") is None


def test_el_catalogo_documenta_como_verificarlo():
    """Si el dueño consigue el token, el archivo tiene que decirle exactamente qué correr."""
    notas = banxico.catalog_notes()["comoVerificar"]
    assert "pytest" in notas["comando"] and "BANXICO_TOKEN" in notas["comando"]
    assert "test_banxico_live.py" in notas["comando"]
    assert notas["queHace"] and notas["despues"]


def test_el_catalogo_es_json_valido_en_disco():
    datos = json.loads(banxico.CATALOG_PATH.read_text(encoding="utf-8"))
    assert datos["verificadas"] == ["SF43718", "SF61745"]
    assert len(datos["series"]) == len(MxRateId.__args__)
