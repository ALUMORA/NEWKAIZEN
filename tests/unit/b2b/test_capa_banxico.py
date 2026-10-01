"""La capa de fixtures ``2026-10-01-banxico`` se apila sobre el set base y sirve el SIE sin red.

La grabó M5 el 1 de octubre de 2026 con el token real, llamando directo a ``providers/banxico.py``
dentro de ``recording("2026-09-22,2026-10-01-banxico", record_layer="2026-10-01-banxico")``. El reloj
es el del set base (``2026-09-22``), así que las ventanas terminan ese día. La receta exacta y las
llamadas que trae están en ``docs/overhaul/notas/sie-catalogo.md`` ("Capa 2026-10-01-banxico"): el
replay busca por URL exacta, así que solo se reproduce la llamada con los mismos ids, en el mismo
orden y con las mismas fechas.

Aquí se usa un token falso: el token va en la cabecera ``Bmx-Token`` y no forma parte de la llave.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest

from kaizen_api.domain import fx, rates
from kaizen_api.providers import banxico
from kaizen_api.settings import Settings, configure
from tests.replay import load_module, open_sets, replaying, reset_backend_state

CAPA = "2026-10-01-banxico"
SETS = f"2026-09-22,{CAPA}"
DESDE, HASTA = "2016-09-22", "2026-09-22"
GRUPOS = ("curva", "mercadoDeDinero", "cruces", "macro", "encuesta")


@pytest.fixture
def capa() -> Iterator[object]:
    package = load_module("kaizen_api")
    with replaying(SETS) as session:
        reset_backend_state(package)
        configure(Settings.from_env({"BANXICO_TOKEN": "token-falso-de-replay"}))
        yield session
    configure(None)
    reset_backend_state(package)
    assert not session.misses, f"Llamadas sin grabar: {session.misses}"


def test_la_capa_hereda_el_reloj_del_set_base():
    assert open_sets(SETS).frozen_at == open_sets("2026-09-22").frozen_at


def test_las_26_pasan_el_candado_desde_la_capa(capa):
    razones = banxico.verification(list(banxico.extra_catalog()))
    assert razones == dict.fromkeys(banxico.extra_catalog(), [])


@pytest.mark.parametrize("grupo", GRUPOS)
def test_cada_grupo_trae_su_historia_y_su_dato_oportuno(capa, grupo):
    ids = list(banxico.extra_group(grupo))
    historia = banxico.fetch_series(ids, DESDE, HASTA)
    oportuno = banxico.fetch_series(ids)
    for sid in ids:
        serie = historia[sid]
        assert serie["values"], sid
        assert serie["dates"][-1] <= HASTA and serie["dates"] == sorted(serie["dates"]), sid
        bajo, alto = banxico.extra_catalog()[sid]["rangoCreible"]
        assert bajo < serie["values"][-1] < alto, (sid, serie["values"][-1])
        assert sid in oportuno, sid


def test_un_cero_real_se_conserva_y_un_n_e_no_se_vuelve_cero(capa):
    """La mediana del PIB de noviembre de 2019 fue ``0.00`` de verdad: se publica 0. El dólar
    canadiense trae ``N/E`` en días sin cotización: esos días no existen, ni 0 ni el dato vecino."""
    pib = banxico.fetch_series(["SR14448"], DESDE, HASTA)["SR14448"]
    assert dict(zip(pib["dates"], pib["values"], strict=True))["2019-11-01"] == 0.0
    cad = banxico.fetch_series(["SF60632"], DESDE, HASTA)["SF60632"]
    assert min(cad["values"]) > 5, "un N/E del dólar canadiense se habría colado como 0"


@pytest.mark.parametrize("sid", ["SF45384", "SF46410", "SR14146", "SE27803", "SF43707", "SF43878"])
def test_una_serie_de_cada_grupo_por_id(capa, sid):
    """La forma más predecible para un stream: un id por llamada, con la ventana canónica."""
    serie = banxico.fetch_series([sid], DESDE, HASTA)[sid]
    assert serie["values"] and serie["dates"][-1] <= HASTA
    assert banxico.fetch_series([sid])[sid]["values"]


def test_rates_mx_sale_del_sie_con_la_capa(capa):
    cuerpo = rates.get_mx_rates()
    publicados = {item["id"]: item for item in cuerpo["items"]}
    assert set(publicados) == set(rates.RATE_ORDER), cuerpo["notes"]
    assert all(item["source"] == "banxico" for item in publicados.values())
    assert cuerpo["fallback"] is False


def test_el_fix_del_ultimo_ano_sale_de_banxico_con_la_capa(capa):
    serie = fx.daily_range(None, None)
    assert serie.source == fx.BANXICO_FIX_SOURCE and serie.fallback is False
    assert serie.dates[-1] <= HASTA and 10 < serie.values[-1] < 40
