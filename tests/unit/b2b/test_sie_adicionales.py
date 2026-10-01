"""Las series adicionales del SIE (fase 5) contra lo que de verdad devolvió Banxico el 1 de octubre de 2026.

``sie_metadatos_2026-10-01.json`` es la respuesta real de ``GET /series/<ids>`` (solo metadatos, sin el
token) de las 26 series de la llave ``adicionales`` de ``kaizen_api/data/banxico_series.json`` más
``SF60691``, la vecina que trae el mismo Bono M a 30 años con otra fecha. ``sie_oportuno_2026-10-01.json``
es el último dato que publicó cada una ese día (``/datos/oportuno``).

Lo que fija:

* Las 26 pasan el candado (título, periodicidad y unidad) con sus metadatos reales, y ``verified: true``
  solo va en las que el SIE confirmó.
* Ninguna pasa por otra: la media no pasa por la mediana, el año en curso no pasa por el siguiente, el
  euro no pasa por la libra y ``SF60691`` no pasa por el Bono M a 30 años.
* El candado de unidades se amplió solo por serie: "Millones de Dólares" entra con ``unidadExacta`` en
  remesas y reserva, y no relaja a ninguna otra.
* El SIE no acepta más de 20 ids por consulta (413); el proveedor parte la lista en tandas.
* Las series adicionales no se cuelan como renglones de ``/v2/rates/mx``.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
import responses

from kaizen_api.providers import banxico
from kaizen_api.settings import Settings, configure

AQUI = Path(__file__).parent
METADATOS = AQUI / "sie_metadatos_2026-10-01.json"
OPORTUNO = AQUI / "sie_oportuno_2026-10-01.json"
TOKEN = "token-de-prueba-que-no-existe"

PEDIDAS = {
    # curva de Bonos M y Udibonos
    "SF43883", "SF43886", "SF45384", "SF60696", "SF61592", "SF46958", "SF46961",
    # TIIE a 91 y 182 días
    "SF43878", "SF111916",
    # cruces del peso
    "SF46410", "SF46406", "SF46407", "SF60632", "SF290383",
    # remesas y reserva internacional
    "SE27803", "SF43707",
    # encuesta de especialistas
    "SR14138", "SR14139", "SR14145", "SR14146", "SR14447", "SR14448", "SR14769", "SR14770", "SR14776", "SR14777",
}
"""Las que pide la spec de la fase 5 (sección "Preparación del orquestador (M5)")."""

GRUPOS = {"curva", "mercadoDeDinero", "cruces", "macro", "encuesta"}


def _metadatos() -> dict[str, dict]:
    datos = json.loads(METADATOS.read_text(encoding="utf-8"))
    return {
        s["idSerie"]: {"id": s["idSerie"], "titulo": s["titulo"], "unidad": s["unidad"], "periodicidad": s["periodicidad"]}
        for s in datos["bmx"]["series"]
    }


def _ultimos() -> dict[str, tuple[str, str]]:
    datos = json.loads(OPORTUNO.read_text(encoding="utf-8"))
    return {s["idSerie"]: (s["datos"][-1]["fecha"], s["datos"][-1]["dato"]) for s in datos["bmx"]["series"]}


@pytest.fixture
def con_token(clean_state):
    configure(Settings.from_env({"BANXICO_TOKEN": TOKEN}))
    yield TOKEN
    configure(None)


# ─── forma del catálogo ──────────────────────────────────────────────────────


def test_estan_las_26_que_pide_la_spec_y_ninguna_mas():
    assert set(banxico.extra_catalog()) == PEDIDAS


def test_cada_serie_adicional_esta_bien_formada():
    claves = set()
    for sid, item in banxico.extra_catalog().items():
        assert sid.startswith(("SF", "SE", "SR")), sid
        assert item["group"] in GRUPOS, sid
        assert item["key"] and item["key"] not in claves, f"{item['key']} está en dos series"
        claves.add(item["key"])
        assert item["unit"] in ("fraction", "mxn", "mxnPerUsd", "usdMillions"), sid
        assert item["sieUnit"] in ("percent", "mxn", "usdMillions"), sid
        assert item["periodicidad"] in ("Diaria", "Mensual"), sid
        assert isinstance(item["maxAgeDays"], int) and item["maxAgeDays"] > 0, sid
        bajo, alto = item["rangoCreible"]
        assert bajo < alto, sid
        assert item["label"] and item["tituloContiene"] and item["nota"], sid
        assert isinstance(item["verified"], bool), sid
        # Lo que el SIE da en por ciento se publica como fracción, y nada más.
        assert (item["sieUnit"] == "percent") == (item["unit"] == "fraction"), sid


def test_los_campos_de_cada_grupo_son_los_que_usan_los_contratos():
    for sid, item in banxico.extra_catalog().items():
        grupo = item["group"]
        if grupo == "curva":
            assert item["instrument"] in ("bonoM", "udibono") and item["tenorYears"] in (3, 5, 20, 30), sid
            assert item["key"] == f"{item['instrument']}{item['tenorYears']}", sid
        elif grupo == "mercadoDeDinero":
            assert item["key"] == f"tiie{item['tenorDays']}", sid
        elif grupo == "cruces":
            assert re.fullmatch(r"[A-Z]{3}MXN", item["pair"]) and item["key"] == item["pair"], sid
        elif grupo == "macro":
            assert item["key"] in ("remittances", "reserves"), sid
        else:
            assert item["item"] in ("inflationT", "inflationT1", "gdpT", "fxT", "fxT1"), sid
            assert item["stat"] in ("mean", "median") and item["key"] == f"{item['item']}.{item['stat']}", sid
    encuesta = banxico.extra_group("encuesta")
    assert len(encuesta) == 10, "media y mediana de los cinco renglones de /v2/expectations"


def test_las_etiquetas_llevan_acentos():
    sin_acento = ("dias", "dia", "anos", "ano", "Inflacion", "japones", "Dolar", "dolar")
    for sid, item in banxico.extra_catalog().items():
        for palabra in sin_acento:
            assert not re.search(rf"\b{palabra}\b", item["label"]), f"{sid} publica '{item['label']}' sin acentos"


def test_las_adicionales_no_son_renglones_de_rates_mx():
    """``/v2/rates/mx`` arma sus renglones con ``catalog()``: si una adicional se colara ahí, su ``rateId``
    no existiría en el contrato y la respuesta dejaría de validar."""
    adicionales = set(banxico.extra_catalog())
    assert not adicionales & set(banxico.catalog())
    assert not adicionales & set(banxico.index_catalog())
    assert "adicionales" not in banxico.catalog_notes()


def test_la_lista_de_verificadas_cuadra_con_las_marcas():
    datos = json.loads(banxico.CATALOG_PATH.read_text(encoding="utf-8"))
    assert datos["adicionalesVerificadas"] == sorted(x["id"] for x in datos["adicionales"] if x["verified"])
    assert datos["adicionalesRevisado"] == "2026-10-01"


def test_extra_for_y_extra_group():
    assert banxico.extra_for("bonoM20") == "SF45384"
    assert banxico.extra_for("tiie91") == "SF43878"
    assert banxico.extra_for("EURMXN") == "SF46410"
    assert banxico.extra_for("inflationT1.median") == "SR14146"
    assert banxico.extra_for("fxT.mean") == "SR14769"
    assert banxico.extra_for("no-existe") is None
    assert set(banxico.extra_group("cruces")) == {"SF46410", "SF46406", "SF46407", "SF60632", "SF290383"}
    assert set(banxico.extra_group("macro")) == {"SE27803", "SF43707"}
    assert banxico.extra_group("no-existe") == {}


# ─── el candado contra los metadatos reales ──────────────────────────────────


def test_las_26_pasan_el_candado_con_sus_metadatos_reales():
    resultado = banxico.classify(banxico.extra_catalog(), _metadatos())
    assert resultado["distintos"] == [] and resultado["desconocidos"] == [], resultado
    assert sorted(resultado["confirmados"]) == sorted(PEDIDAS)


def test_verified_solo_en_las_que_el_sie_confirmo():
    resultado = banxico.classify(banxico.extra_catalog(), _metadatos())
    marcadas = {sid for sid in banxico.extra_catalog() if banxico.reviewed(sid)}
    assert marcadas <= set(resultado["confirmados"])


@pytest.mark.parametrize("sid", ["SR14146", "SR14448", "SR14769"])
def test_las_inferidas_se_confirmaron_por_su_titulo(sid):
    """Se infirieron por secuencia; el 1 de octubre de 2026 su título real dijo lo que la spec suponía."""
    item = banxico.extra_catalog()[sid]
    titulo = banxico._fold(_metadatos()[sid]["titulo"])
    assert banxico.mismatches(_metadatos()[sid], item) == []
    esperado = {"SR14146": ("inflacion general", "siguiente ano", "mediana"),
                "SR14448": ("pib", "ano en curso", "mediana"),
                "SR14769": ("tipo de cambio", "ano en curso", "media")}[sid]
    assert all(palabra in titulo for palabra in esperado), titulo
    if sid == "SR14769":
        assert "mediana" not in titulo


def test_sf60691_no_pasa_por_el_bono_m_a_30_anos():
    meta = _metadatos()["SF60691"]
    assert banxico.mismatches(meta, banxico.extra_catalog()["SF60696"])


def test_ninguna_serie_pasa_por_otra_del_catalogo():
    """Media contra mediana, año en curso contra el siguiente, una moneda contra otra, un plazo contra otro."""
    meta = _metadatos()
    todas = {**banxico.catalog(), **banxico.extra_catalog()}
    colados = [
        (real, suplantada)
        for real in banxico.extra_catalog()
        for suplantada, item in todas.items()
        if real != suplantada and not banxico.mismatches(meta[real], item)
    ]
    assert colados == []


# ─── unidades: se amplió por serie, sin relajar a las demás ──────────────────


@pytest.mark.parametrize("sid", ["SE27803", "SF43707"])
def test_millones_de_dolares_entra_por_unidad_exacta(sid):
    meta = dict(_metadatos()[sid])
    item = banxico.extra_catalog()[sid]
    assert item["unidadExacta"] == ["Millones de Dólares"]
    assert banxico.mismatches(meta, item) == []
    for otra in ("Millones de Pesos", "Miles de Operaciones", "Dólares", "Sin Unidad", "Porcentajes"):
        meta["unidad"] = otra
        razones = banxico.mismatches(meta, item)
        assert any("millones de dólares" in r for r in razones), (otra, razones)


def test_sin_unidad_exacta_millones_de_dolares_no_pasa():
    """``usdMillions`` no tiene palabras en ``UNIT_WORDS``: sin ``unidadExacta`` nada pasa."""
    assert "usdMillions" not in banxico.UNIT_WORDS
    item = {k: v for k, v in banxico.extra_catalog()["SE27803"].items() if k != "unidadExacta"}
    assert banxico.mismatches(_metadatos()["SE27803"], item)


@pytest.mark.parametrize("sid", ["SF43718", "SF61745", "SF43936", "SP30578", "SP68257"])
def test_millones_de_dolares_no_relaja_las_series_de_siempre(sid):
    item = banxico.catalog()[sid]
    meta = {"titulo": " ".join(item["tituloContiene"]), "periodicidad": item["periodicidad"],
            "unidad": "Millones de Dólares"}
    razones = banxico.mismatches(meta, item)
    assert any("la unidad es" in r for r in razones), razones


def test_las_unidades_reales_de_cada_grupo():
    """Lo que de verdad reporta el SIE: no hay "Pesos por divisa" ni "Sin Unidad" en estas 26."""
    meta = _metadatos()
    unidades = {sid: meta[sid]["unidad"] for sid in banxico.extra_catalog()}
    assert {unidades[s] for s in banxico.extra_group("curva")} == {"Porcentajes"}
    assert {unidades[s] for s in banxico.extra_group("mercadoDeDinero")} == {"Porcentajes"}
    assert {unidades[s] for s in banxico.extra_group("cruces")} == {"Pesos"}
    assert {unidades[s] for s in banxico.extra_group("macro")} == {"Millones de Dólares"}
    encuesta = banxico.extra_group("encuesta")
    assert {unidades[s] for s, i in encuesta.items() if i["sieUnit"] == "percent"} == {"Porcentajes"}
    assert {unidades[s] for s, i in encuesta.items() if i["sieUnit"] == "mxn"} == {"Pesos por Dólar"}


# ─── los datos reales caen en su banda y se escalan bien ─────────────────────


def test_el_ultimo_dato_real_cae_en_su_rango_creible():
    ultimos = _ultimos()
    for sid, item in banxico.extra_catalog().items():
        fecha, dato = ultimos[sid]
        valor = banxico.parse_amount(dato)
        if valor is None:
            # El dólar canadiense trajo N/E el 1 de octubre: nunca se publica como 0.
            assert sid == "SF60632" and dato == "N/E", (sid, dato)
            continue
        bajo, alto = item["rangoCreible"]
        assert bajo < valor < alto, f"{sid} trajo {valor} el {fecha}, fuera de {item['rangoCreible']}"


def test_scale_for_lleva_por_ciento_a_fraccion_y_deja_lo_demas():
    ultimos = _ultimos()
    assert banxico.scale_for("SR14139") == 0.01
    assert banxico.parse_amount(ultimos["SR14139"][1]) * banxico.scale_for("SR14139") == pytest.approx(0.0387)
    assert banxico.parse_amount(ultimos["SF45384"][1]) * banxico.scale_for("SF45384") == pytest.approx(0.0964)
    assert banxico.scale_for("SF46410") == 1.0
    assert banxico.scale_for("SR14770") == 1.0
    assert banxico.parse_amount(ultimos["SE27803"][1]) * banxico.scale_for("SE27803") == pytest.approx(5452.3367)
    assert banxico.scale_for("SF43936") == 0.01, "también sirve para las de /v2/rates/mx"
    assert banxico.scale_for("NO-EXISTE") == 1.0


def test_la_encuesta_se_fecha_el_dia_1():
    ultimos = _ultimos()
    for sid in banxico.extra_group("encuesta"):
        assert banxico.parse_date(ultimos[sid][0]) == "2026-09-01", sid


# ─── el SIE no acepta más de 20 ids por consulta ─────────────────────────────


def _sie_que_rechaza_mas_de_20(cuerpo_por_id):
    pedidas: list[list[str]] = []

    def responder(request):
        ruta = request.path_url.split("/series/", 1)[1]
        ids = ruta.split("/", 1)[0].split(",")
        pedidas.append(ids)
        if len(ids) > banxico.MAX_IDS_PER_REQUEST:
            return 413, {}, ""
        assert request.headers["Bmx-Token"] == TOKEN
        series = [cuerpo_por_id[i] for i in ids if i in cuerpo_por_id]
        return 200, {"Content-Type": "application/json"}, json.dumps({"bmx": {"series": series}})

    responses.add_callback(responses.GET, re.compile(re.escape(banxico.SIE_BASE_URL) + r"/series/.*"),
                           callback=responder)
    return pedidas


@responses.activate
def test_fetch_metadata_parte_en_tandas_de_20(con_token):
    crudo = json.loads(METADATOS.read_text(encoding="utf-8"))["bmx"]["series"]
    pedidas = _sie_que_rechaza_mas_de_20({s["idSerie"]: s for s in crudo})
    ids = sorted(PEDIDAS)
    meta = banxico.fetch_metadata(ids)
    assert set(meta) == PEDIDAS
    assert [len(p) for p in pedidas] == [20, 6]
    assert meta["SR14146"]["periodicidad"] == "Mensual"


@responses.activate
def test_fetch_series_parte_en_tandas_de_20(con_token):
    crudo = json.loads(OPORTUNO.read_text(encoding="utf-8"))["bmx"]["series"]
    pedidas = _sie_que_rechaza_mas_de_20({s["idSerie"]: s for s in crudo})
    series = banxico.fetch_series(sorted(PEDIDAS))
    assert [len(p) for p in pedidas] == [20, 6]
    assert series["SE27803"]["values"] == [5452.3367]
    assert series["SF60632"]["values"] == [], "el N/E del dólar canadiense no se vuelve 0"


@responses.activate
def test_verified_ids_conoce_las_adicionales(con_token):
    """Con token, el servidor confirma las 26 contra el SIE en una sola pasada (dos consultas)."""
    crudo = json.loads(METADATOS.read_text(encoding="utf-8"))["bmx"]["series"]
    pedidas = _sie_que_rechaza_mas_de_20({s["idSerie"]: s for s in crudo})
    verificadas = banxico.verified_ids(sorted(PEDIDAS))
    assert verificadas == dict.fromkeys(sorted(PEDIDAS), True)
    assert all(banxico.reviewed(sid) for sid in PEDIDAS)
    assert len(pedidas) == 2


# ─── tandas en las fronteras: 20, 21 y 40 ids ───────────────────────────────


def _ids_falsos(n: int) -> list[str]:
    return [f"SF{90000 + i}" for i in range(n)]


@pytest.mark.parametrize(("n", "tamanos"), [(1, [1]), (20, [20]), (21, [20, 1]), (40, [20, 20]), (41, [20, 20, 1])])
def test_batches_parte_justo_en_20(n, tamanos):
    ids = _ids_falsos(n)
    tandas = banxico._batches(ids)
    assert [len(t.split(",")) for t in tandas] == tamanos
    assert ",".join(tandas).split(",") == ids, "las tandas conservan el orden y no pierden ni repiten ids"


def test_batches_cuenta_los_repetidos_una_vez():
    """21 ids con uno repetido (y en minúsculas) son 20 distintos: una sola consulta, no dos."""
    ids = _ids_falsos(20) + [_ids_falsos(1)[0].lower()]
    assert banxico._batches(ids) == [",".join(_ids_falsos(20))]


@responses.activate
@pytest.mark.parametrize(("n", "tamanos"), [(20, [20]), (21, [20, 1]), (40, [20, 20])])
def test_fetch_metadata_en_las_fronteras(con_token, n, tamanos):
    ids = _ids_falsos(n)
    cuerpo = {i: {"idSerie": i, "titulo": f"serie {i}", "periodicidad": "Diaria", "unidad": "Porcentajes"} for i in ids}
    pedidas = _sie_que_rechaza_mas_de_20(cuerpo)
    meta = banxico.fetch_metadata(ids)
    assert [len(p) for p in pedidas] == tamanos
    assert list(meta) == ids


@responses.activate
@pytest.mark.parametrize(("n", "tamanos"), [(20, [20]), (21, [20, 1]), (40, [20, 20])])
def test_fetch_series_en_las_fronteras_y_n_e_nunca_es_cero(con_token, n, tamanos):
    """Cada tanda se une a las demás, y un ``N/E`` a media serie se salta: ni 0 ni el dato vecino."""
    ids = _ids_falsos(n)
    datos = [{"fecha": "29/09/2026", "dato": "9.35"}, {"fecha": "30/09/2026", "dato": "N/E"},
             {"fecha": "01/10/2026", "dato": "1,234.50"}]
    cuerpo = {i: {"idSerie": i, "titulo": f"serie {i}", "datos": datos} for i in ids}
    pedidas = _sie_que_rechaza_mas_de_20(cuerpo)
    series = banxico.fetch_series(ids, "2026-09-29", "2026-10-01")
    assert [len(p) for p in pedidas] == tamanos
    assert set(series) == set(ids)
    for sid in (ids[0], ids[-1]):
        assert series[sid]["dates"] == ["2026-09-29", "2026-10-01"]
        assert series[sid]["values"] == [9.35, 1234.5]
        assert 0 not in series[sid]["values"]
    assert banxico.parse_amount("N/E") is None and banxico.parse_amount("N/D") is None
