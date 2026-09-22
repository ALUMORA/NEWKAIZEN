"""Verificación de los ids del SIE contra el endpoint de metadatos de Banxico. NECESITA TOKEN Y RED.

Esta es la prueba que cierra la deuda: hoy solo ``SF43718`` (FIX) y ``SF61745`` (tasa objetivo)
están marcadas ``verified: true`` en ``kaizen_api/data/banxico_series.json``, y las demás no se
publican en ``/v2/rates/mx`` hasta que el SIE confirme que cada id es la serie que decimos.

Cómo correrla, cuando el dueño saque su token (es gratis y sale al instante en
https://www.banxico.org.mx/SieAPIRest/service/v1/token)::

    cd "05 NEWKAIZEN"
    export BANXICO_TOKEN='...el token...'
    KAIZEN_LIVE=1 .venv/bin/python -m pytest -q -p no:cacheprovider -o addopts="" \\
        tests/unit/b2b/test_banxico_live.py -s

Qué hace: pide ``GET /series/<ids>`` (solo metadatos, ningún dato) con los doce ids del catálogo,
compara el título que devuelve el SIE contra ``tituloContiene`` de cada uno e imprime tres listas:
los que confirmó, los que el SIE no conoce y los que devolvió con otro título. Después hay que
poner ``verified: true`` **nada más en los ids confirmados** y actualizar ``revisado`` con la fecha.

Sin ``KAIZEN_LIVE=1`` se salta, y sin ``BANXICO_TOKEN`` también: no falla la corrida normal.
"""

from __future__ import annotations

import os

import pytest

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
    confirmados: list[str] = []
    desconocidos: list[str] = []
    distintos: list[tuple[str, str]] = []
    for sid, item in sorted(catalogo.items()):
        info = metadatos.get(sid)
        if info is None:
            desconocidos.append(sid)
        elif banxico.title_matches(info["titulo"], item["tituloContiene"]):
            confirmados.append(sid)
        else:
            distintos.append((sid, info["titulo"]))
    with capsys.disabled():
        print("\n── verificación del catálogo del SIE ──")
        for sid in confirmados:
            info = metadatos[sid]
            print(f'  OK   {sid} ({catalogo[sid]["rateId"]}): {info["titulo"][:90]}')
            print(f'         unidad="{info["unidad"]}" periodicidad="{info["periodicidad"]}" '
                  f'último={info["fechaFin"]}')
        for sid in desconocidos:
            print(f"  ???  {sid}: el SIE no devolvió esta serie. Busca el id correcto en el catálogo del SIE.")
        for sid, titulo in distintos:
            print(f'  NO   {sid}: el SIE dice "{titulo[:90]}", y esperábamos {catalogo[sid]["tituloContiene"]}')
        print(f"\n  Pon verified: true solo en estos: {confirmados}")
        print("  Y actualiza el campo revisado de kaizen_api/data/banxico_series.json con la fecha de hoy.\n")
    # Las dos que ya están marcadas verificadas tienen que seguir siéndolo; el resto es informativo.
    for sid in banxico.VERIFIED_IDS:
        assert sid in confirmados, f"{sid} venía marcada como verificada y el SIE ya no la confirma"


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
