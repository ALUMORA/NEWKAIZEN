"""Búsqueda de símbolos: la lista curada de México manda y no necesita red.

Ningún proveedor de EE. UU. resuelve "bodega aurrera" o "fibra uno", así que esa parte se cura a
mano en ``kaizen_api/data/symbols_mx.json`` y se lee de disco. El índice de la SEC agrega las
emisoras gringas y, si no se puede bajar, la búsqueda sigue funcionando y lo dice.
"""

from __future__ import annotations

import re

import pytest
import requests

from kaizen_api import schemas
from kaizen_api.domain import search as search_domain

SYMBOL_RE = re.compile(schemas.SYMBOL_PATTERN)
TYPES = set(schemas.InstrumentType.__args__)


def test_la_lista_curada_cumple_el_contrato() -> None:
    entries = search_domain.curated_entries()
    assert len(entries) >= 40
    simbolos = [e.symbol for e in entries]
    assert len(set(simbolos)) == len(simbolos), "hay un símbolo repetido en symbols_mx.json"
    for entry in entries:
        assert SYMBOL_RE.fullmatch(entry.symbol), entry.symbol
        assert entry.type in TYPES, entry
        assert entry.currency is None or re.fullmatch(r"^[A-Z]{3}$", entry.currency), entry
        assert entry.name and "—" not in entry.name and "–" not in entry.name
        assert entry.aliases, f"{entry.symbol} sin alias no se puede buscar por nombre"
        assert all(alias == alias.lower() and search_domain.fold(alias) for alias in entry.aliases), (
            f"los alias de {entry.symbol} van en minúsculas y tienen que dejar texto al normalizarse"
        )


def test_los_instrumentos_conocidos_tambien_cumplen_el_contrato() -> None:
    for symbol, name, kind, currency, aliases in search_domain.INSTRUMENTOS_CONOCIDOS:
        assert SYMBOL_RE.fullmatch(symbol), symbol
        assert kind in TYPES and name
        assert currency is None or re.fullmatch(r"^[A-Z]{3}$", currency)
        assert all(alias == alias.lower() and search_domain.fold(alias) for alias in aliases), symbol


def test_hay_fibras_y_un_etf_del_ipc_en_la_lista() -> None:
    entries = {e.symbol: e for e in search_domain.curated_entries()}
    assert entries["NAFTRAC.MX"].type == "etf"
    assert entries["FUNO11.MX"].type == "fibra"
    assert sum(1 for e in entries.values() if e.type == "fibra") >= 8


@pytest.mark.parametrize(
    "consulta,esperado",
    [
        ("walmart", "WALMEX.MX"),
        ("bodega aurrera", "WALMEX.MX"),
        ("bimbo", "BIMBOA.MX"),
        ("marinela", "BIMBOA.MX"),
        ("oxxo", "FEMSAUBD.MX"),
        ("fibra uno", "FUNO11.MX"),
        ("naftrac", "NAFTRAC.MX"),
        ("ipc", "^MXX"),
        ("cemex", "CEMEXCPO.MX"),
        ("banorte", "GFNORTEO.MX"),
        ("tequila", "CUERVO.MX"),
        ("dolar", "MXN=X"),
        ("tipo de cambio", "MXN=X"),
    ],
)
def test_los_alias_en_espaniol_llevan_al_simbolo_correcto(b2a_replay, consulta: str, esperado: str) -> None:
    resultados, _, _ = search_domain.search(consulta, limit=5)
    assert resultados, consulta
    assert resultados[0]["symbol"] == esperado, [r["symbol"] for r in resultados]


def test_la_busqueda_ignora_acentos_y_mayusculas(b2a_replay) -> None:
    con, _, _ = search_domain.search("MÉXICO", limit=10)
    sin, _, _ = search_domain.search("mexico", limit=10)
    assert con == sin
    assert con, "buscar México tiene que traer algo"


def test_buscar_por_simbolo_exacto_gana(b2a_replay) -> None:
    resultados, _, fuente = search_domain.search("aapl", limit=5)
    assert resultados[0]["symbol"] in ("AAPL.MX", "AAPL")
    assert "sec" in fuente


def test_el_indice_de_la_sec_agrega_emisoras_gringas(b2a_replay) -> None:
    resultados, notas, fuente = search_domain.search("walmart", limit=5)
    simbolos = [r["symbol"] for r in resultados]
    assert simbolos[0] == "WALMEX.MX"
    assert "WMT" in simbolos
    assert fuente == "curated,sec"
    assert notas == []


def test_lo_curado_le_gana_a_la_sec_en_el_tipo_de_instrumento(b2a_replay) -> None:
    """En ``company_tickers.json`` todo parece acción; SPY es un ETF y así tiene que salir."""
    resultados, _, _ = search_domain.search("spy", limit=3)
    assert resultados[0] == {
        "symbol": "SPY",
        "name": "SPDR S&P 500 ETF Trust",
        "exchange": None,
        "type": "etf",
        "currency": "USD",
        "aliases": ["spy", "etf del sp500", "sp500 etf"],
    }


def test_sin_red_la_parte_de_mexico_sigue_sirviendo_y_se_avisa(monkeypatch) -> None:
    """Con la SEC caída (lo que en producción llega como ConnectionError) la búsqueda no se cae."""

    def _sin_red(*args, **kwargs):
        raise requests.ConnectionError("sin red")

    monkeypatch.setattr(search_domain._SEC_SESSION, "get", _sin_red)
    resultados, notas, fuente = search_domain.search("bimbo", limit=5)
    assert resultados[0]["symbol"] == "BIMBOA.MX"
    assert fuente == "curated"
    assert notas and "índice de la SEC" in notas[0]


def test_la_ruta_valida_contra_el_contrato(client) -> None:
    r = client.get("/v2/search?q=walmart&limit=5")
    assert r.status_code == 200, r.text
    body = schemas.SearchResponse.model_validate(r.json())
    assert body.results[0].symbol == "WALMEX.MX"
    assert body.meta.source == "curated,sec"
    assert body.meta.asOf == "2026-09-22"
    assert body.meta.fallback is False
    assert r.headers["cache-control"] == "private, max-age=21600"


def test_la_ruta_lo_dice_cuando_no_encuentra_nada(client) -> None:
    body = client.get("/v2/search?q=xyzzyqwerty").json()
    assert body["results"] == []
    assert any("No encontramos nada" in nota for nota in body["meta"]["notes"])


def test_el_limite_se_respeta(client) -> None:
    body = client.get("/v2/search?q=a&limit=3").json()
    assert len(body["results"]) <= 3
