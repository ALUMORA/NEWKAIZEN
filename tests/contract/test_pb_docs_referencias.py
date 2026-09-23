"""docs/api-v2.md documenta las referencias del sector y la receta del panel en dos monedas (PB).

F3 pidió las llaves reales de ``sectorMedians`` y F1 la forma preferida de separar efecto precio y
efecto tipo de cambio con ``/v2/panel``. Estas pruebas amarran el texto al contrato: si una llave
cambia en ``schemas.py`` o la función del cliente desaparece, el documento se tiene que corregir.
"""

from __future__ import annotations

from pathlib import Path
from typing import get_args

from kaizen_api import schemas

ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / "docs" / "api-v2.md"
SECTOR = "### Referencias del sector: `sectorMedians` y `multiples.methods`"
PANEL = "### Panel en moneda nativa y en MXN: efecto precio y efecto tipo de cambio"


def _seccion(titulo: str) -> str:
    texto = DOCS.read_text(encoding="utf-8")
    assert titulo in texto, f"falta la sección {titulo!r} en docs/api-v2.md"
    resto = texto.split(titulo, 1)[1]
    fin = min((i for i in (resto.find("\n### "), resto.find("\n## ")) if i >= 0), default=len(resto))
    return resto[:fin]


def test_sector_medians_documenta_sus_llaves_reales_y_donde_vive():
    texto = _seccion(SECTOR)
    for llave in get_args(schemas.FundamentalKey):
        assert f"`{llave}`" in texto, llave
    assert "sectorMedians" in schemas.InstrumentResponse.model_fields
    assert "sectorMedians" not in schemas.ValuationResponse.model_fields
    assert "`GET /v2/instrument/{symbol}`" in texto
    assert "`GET /v2/valuation/{symbol}`" in texto


def test_la_referencia_de_valuacion_documenta_sus_ids_reales():
    texto = _seccion(SECTOR)
    for metodo in get_args(schemas.MultipleMethod.model_fields["id"].annotation):
        assert f"`{metodo}`" in texto, metodo
    for campo in ("benchmark", "current", "applicable"):
        assert f"`{campo}`" in texto, campo
    for campo in ("market", "asOf", "source", "applicable"):
        assert campo in schemas.MultiplesValuation.model_fields
        assert f"`multiples.{campo}`" in texto, campo


def test_el_panel_en_dos_monedas_tiene_su_receta_escrita():
    texto = _seccion(PANEL)
    for frase in ("ccy=native", "ccy=MXN", "`400 BAD_REQUEST`", "`pnlDecomposition`", "`/v2/quotes`", "`meta.fallback`"):
        assert frase in texto, frase
    fx_js = (ROOT / "src" / "lib" / "finance" / "fx.js").read_text(encoding="utf-8")
    assert "export function pnlDecomposition(" in fx_js, "la receta apunta a una función que ya no existe"


def test_las_secciones_nuevas_no_traen_guiones_largos():
    for titulo in (SECTOR, PANEL):
        texto = _seccion(titulo)
        assert "—" not in texto and "–" not in texto


def test_la_receta_del_panel_avisa_que_sus_cierres_estan_ajustados_y_no_dan_el_costo():
    """Revisión de PB: la receta decía sacar ``price0`` del panel nativo, que viene ajustado por
    dividendos. Eso metía los dividendos al efecto precio y cambiaba el precio y el FIX del
    movimiento por los del panel, contra lo que dice docs/metodologia/portafolio.md."""
    texto = " ".join(_seccion(PANEL).split())
    assert "`price0` y `price1` del panel nativo" not in texto, "la receta vieja tomaba P0 del panel"
    for frase in ("ajustados por splits y dividendos", "rendimiento total", "del movimiento",
                  "docs/metodologia/portafolio.md", "dos veces", "s/d"):
        assert frase in texto, frase
    metodologia = " ".join((ROOT / "docs" / "metodologia" / "portafolio.md").read_text(encoding="utf-8").split())
    assert "el precio en la moneda original" in metodologia
    assert "Suma efectivo en la moneda del pago, sin tocar el costo" in metodologia


def test_la_receta_del_panel_dice_que_hacer_con_lo_que_sale_en_dropped():
    """El servidor solo convierte USDMXN: una emisora en EUR sale en ``dropped`` del panel en pesos."""
    texto = " ".join(_seccion(PANEL).split())
    assert "una llamada por cada moneda distinta del" not in texto
    for frase in ("`dropped`", "USDMXN", "una sola llamada con las emisoras en dólares"):
        assert frase in texto, frase
