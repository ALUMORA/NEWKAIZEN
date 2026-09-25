"""El catálogo del SIE contra los metadatos REALES que devolvió Banxico el 25 de septiembre de 2026.

``sie_metadatos_2026-09-25.json`` es la respuesta de ``GET /series/<ids>`` (solo metadatos) tal cual
la mandó el SIE con el token del dueño, sin el token: título, periodicidad y unidad de las doce
series del catálogo y de las que se confundían con ellas. Así el candado se prueba sin red contra
lo que de verdad dice Banxico, no contra títulos inventados en la prueba.

Lo que fija:

* Las doce series del catálogo pasan el candado con sus metadatos reales.
* Los ids equivocados de antes (``SF43881`` era un BPA a 3 años en millones de pesos;
  ``SP74625`` y ``SP74626`` eran índices del INPC subyacente) y sus vecinos parecidos (la
  variación mensual del INPC, la inflación NO subyacente anual, el monto asignado del Bono M, el
  promedio mensual de CETES) NO pasan el candado de la serie que suplantaban.
* ``verified: true`` va solo en series que el SIE confirmó.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from kaizen_api.providers import banxico

FIXTURE = Path(__file__).with_name("sie_metadatos_2026-09-25.json")


def _metadatos_reales() -> dict[str, dict]:
    """Los metadatos grabados, pasados por el mismo parseo que ``banxico.fetch_metadata``."""
    crudo = json.loads(FIXTURE.read_text(encoding="utf-8"))
    out = {}
    for serie in crudo["bmx"]["series"]:
        sid = serie["idSerie"].upper()
        out[sid] = {
            "id": sid,
            "titulo": serie.get("titulo") or "",
            "unidad": serie.get("unidad") or "",
            "periodicidad": serie.get("periodicidad") or "",
        }
    return out


def test_el_fixture_no_trae_ningun_token():
    texto = FIXTURE.read_text(encoding="utf-8").lower()
    assert "bmx-token" not in texto.replace("cabecera bmx-token", "")
    assert "token\":" not in texto


def test_las_doce_series_del_catalogo_pasan_el_candado_con_los_metadatos_reales():
    resultado = banxico.classify(banxico.catalog(), _metadatos_reales())
    assert resultado["desconocidos"] == []
    assert resultado["distintos"] == [], resultado["distintos"]
    assert sorted(resultado["confirmados"]) == sorted(banxico.catalog())


def test_verified_true_solo_en_series_que_el_sie_confirmo():
    resultado = banxico.classify(banxico.catalog(), _metadatos_reales())
    marcadas = {sid for sid in banxico.catalog() if banxico.reviewed(sid)}
    assert marcadas <= set(resultado["confirmados"])
    # Y el resumen de arriba del archivo dice lo mismo que las banderas de cada serie.
    assert sorted(banxico.catalog_notes()["verificadas"]) == sorted(marcadas)


@pytest.mark.parametrize(
    "rate_id,sid_real",
    [
        ("bonoM10", "SF43881"),   # BPA a 1092 días, monto asignado en millones de pesos
        ("bonoM10", "SF44072"),   # Bono M 10 años, pero el monto asignado, no el rendimiento
        ("inflationYoY", "SP74625"),  # índice del INPC subyacente
        ("inflationYoY", "SP30577"),  # INPC, variación mensual
        ("inflationYoY", "SP74662"),  # subyacente anual: no es la general
        ("coreInflationYoY", "SP74625"),  # índice, no variación
        ("coreInflationYoY", "SP74626"),  # índice de mercancías
        ("coreInflationYoY", "SP74665"),  # NO subyacente anual
        ("coreInflationYoY", "SP30578"),  # general anual: no es la subyacente
        ("cetes28", "SF282"),     # promedio mensual, no la subasta
        ("cetes28", "SF60633"),   # la fecha de la subasta, no la tasa
        ("tiie28", "SF60633"),
    ],
)
def test_las_series_que_se_confundian_no_pasan_el_candado(rate_id, sid_real):
    meta = _metadatos_reales()[sid_real]
    item = banxico.catalog()[banxico.series_for(rate_id)]
    assert banxico.mismatches(meta, item), f"{sid_real} pasó como {rate_id}: {meta['titulo']}"


def test_cetes_de_mercado_secundario_no_pasan_por_los_de_subasta():
    """El SIE marca como "Diaria" la subasta semanal, así que el candado se apoya en "subasta"."""
    secundario = {"titulo": "Mercado secundario Cetes a 28 días Tasa de rendimiento",
                  "unidad": "Porcentajes", "periodicidad": "Diaria"}
    assert banxico.mismatches(secundario, banxico.catalog()["SF43936"])


def test_los_titulos_del_sie_con_espacios_dobles_no_rompen_las_palabras():
    """El SIE rellena los títulos con espacios: "Tasa de rendimiento  Bono tasa fija 10 años"."""
    meta = {"titulo": "Resultados de la subasta semanal Tasa de   rendimiento  Bono tasa   fija 10    años",
            "unidad": "Porcentajes", "periodicidad": "Diaria"}
    assert banxico.mismatches(meta, banxico.catalog()["SF44071"]) == []
