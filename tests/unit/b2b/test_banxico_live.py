"""Verificación de los ids del SIE contra el endpoint de metadatos de Banxico. NECESITA TOKEN Y RED.

Es la prueba que decide qué series del catálogo llevan ``verified: true`` en
``kaizen_api/data/banxico_series.json``. La última corrida (25 de septiembre de 2026, con el token del
dueño) confirmó las doce; una serie en ``false`` no se publica en ``/v2/rates/mx`` aunque haya token.

Cómo correrla (el token es gratis en https://www.banxico.org.mx/SieAPIRest/service/v1/token y en
esta Mac vive en ``.env.local``, nunca en el repo)::

    cd "05 NEWKAIZEN"
    set -a; source .env.local; set +a
    KAIZEN_LIVE=1 .venv/bin/python -m pytest -q -p no:cacheprovider -o addopts="" \\
        tests/unit/b2b/test_banxico_live.py -s

Qué hace: pide ``GET /series/<ids>`` (solo metadatos, ningún dato) con los doce ids del catálogo y
los pasa por ``banxico.classify``, que es el mismo candado del servidor: el título tiene que traer
las palabras de ``tituloContiene`` y ninguna de ``tituloExcluye``, la periodicidad tiene que ser la
del catálogo y la unidad tiene que cuadrar con ``sieUnit``. Imprime tres listas: los que confirmó,
los que el SIE no conoce y los que no cuadran, con la razón exacta. Después hay que poner
``verified: true`` **nada más en los ids confirmados** y actualizar ``revisado`` con la fecha.

Sin ``KAIZEN_LIVE=1`` se salta, y sin ``BANXICO_TOKEN`` también: no falla la corrida normal.
"""

from __future__ import annotations

import os

import pytest

from kaizen_api.domain import rates as rates_domain
from kaizen_api.providers import banxico
from kaizen_api.settings import Settings, configure

pytestmark = pytest.mark.live


@pytest.fixture
def token() -> str:
    valor = os.environ.get("BANXICO_TOKEN")
    if not valor:
        pytest.skip("no hay BANXICO_TOKEN en el entorno")
    configure(Settings.from_env({"BANXICO_TOKEN": valor}))
    yield valor
    configure(None)


def test_cada_id_del_catalogo_es_la_serie_que_dice(token, capsys):
    catalogo = banxico.catalog()
    metadatos = banxico.fetch_metadata(list(catalogo))
    resultado = banxico.classify(catalogo, metadatos)
    confirmados = resultado["confirmados"]
    with capsys.disabled():
        print("\n── verificación del catálogo del SIE ──")
        for sid in confirmados:
            info = metadatos[sid]
            print(f'  OK   {sid} ({catalogo[sid]["rateId"]}): {info["titulo"][:90]}')
            print(f'         unidad="{info["unidad"]}" periodicidad="{info["periodicidad"]}" '
                  f'último={info["fechaFin"]}')
        for sid in resultado["desconocidos"]:
            print(f"  ???  {sid}: el SIE no devolvió esta serie. Busca el id correcto en el catálogo del SIE.")
        for sid, razones in resultado["distintos"]:
            print(f"  NO   {sid}: " + "; ".join(razones))
        print(f"\n  Pon verified: true solo en estos: {confirmados}")
        print("  Y actualiza el campo revisado de kaizen_api/data/banxico_series.json con la fecha de hoy.\n")
    # Las dos de siempre (FIX y objetivo) tienen que seguir pasando el candado completo.
    for sid in banxico.VERIFIED_IDS:
        assert sid in confirmados, f"{sid} venía marcada como verificada y el SIE ya no la confirma"
    # Y ninguna marcada verified: true puede estar fuera de los confirmados.
    marcadas = sorted(sid for sid in catalogo if banxico.reviewed(sid))
    assert set(marcadas) <= set(confirmados), f"marcadas sin pasar el candado: {set(marcadas) - set(confirmados)}"


def test_las_series_verificadas_devuelven_datos(token):
    """El FIX y la tasa objetivo traen dato reciente, en el rango que tiene sentido para cada una."""
    series = banxico.fetch_series(list(banxico.VERIFIED_IDS))
    for sid in banxico.VERIFIED_IDS:
        serie = series.get(sid)
        assert serie and serie["values"], f"{sid} no devolvió datos"
    fix = series[banxico.SERIES_FIX]["values"][-1]
    objetivo = series[banxico.SERIES_TARGET]["values"][-1]
    assert 10 < fix < 40, f"el FIX salió en {fix}, que no parece pesos por dólar"
    assert 0 < objetivo < 30, f"la tasa objetivo salió en {objetivo}, que no parece por ciento anual"


def test_cada_serie_verificada_trae_un_dato_creible(token):
    """El título no basta: un índice del INPC (~140) bajo el id de la inflación anual pasaría por
    "por ciento". Cada serie marcada ``verified: true`` tiene que traer su dato oportuno dentro de
    la banda de cordura que usa el servidor (``rates.PLAUSIBLE``)."""
    catalogo = banxico.catalog()
    marcadas = sorted(sid for sid in catalogo if banxico.reviewed(sid))
    series = banxico.fetch_series(marcadas)
    for sid in marcadas:
        item = catalogo[sid]
        serie = series.get(sid)
        assert serie and serie["values"], f"{sid} no devolvió datos"
        escala = 0.01 if item["sieUnit"] == "percent" else 1.0
        renglon = {"id": item["rateId"], "unit": item["unit"], "label": item["label"], "seriesId": sid,
                   "value": serie["values"][-1] * escala}
        assert rates_domain._implausible(renglon) is None, rates_domain._implausible(renglon)


def test_rates_mx_en_vivo_publica_todo_el_catalogo(token):
    """Con token, ``/v2/rates/mx`` publica las doce series del SIE, verificadas y sin respaldo."""
    cuerpo = rates_domain.get_mx_rates()
    publicados = {item["id"]: item for item in cuerpo["items"]}
    assert set(publicados) == set(rates_domain.RATE_ORDER), cuerpo["notes"]
    assert all(item["source"] == "banxico" and item["verified"] for item in publicados.values())
    assert cuerpo["fallback"] is False


def test_los_indices_del_catalogo_pasan_el_candado_en_vivo(token):
    """El INPC (``SP1``) de ``/v2/rates/mx/inpc`` pasa por el mismo candado que las tasas."""
    indices = banxico.index_catalog()
    resultado = banxico.classify(indices, banxico.fetch_metadata(list(indices)))
    assert resultado["distintos"] == [] and resultado["desconocidos"] == [], resultado
    data = rates_domain.get_inpc("2025-08-01", "2026-09-25")
    assert data["seriesId"] == "SP1" and 100 < data["monthly"]["2025-08"] < 200
