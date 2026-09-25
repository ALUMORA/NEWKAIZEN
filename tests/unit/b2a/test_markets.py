"""Panorama de mercados y mapa mundial: grupos sin repetidos, monedas correctas y DXY de Yahoo.

Dos defectos del backend viejo quedan fijados aquí como pruebas, para que no vuelvan:

* ``^MXX`` es el IPC y cotiza en PESOS. El legado lo publicaba en dólares.
* El DXY sale de Yahoo (``DX-Y.NYB``). El CSV de Stooq del legado falla siempre, tanto que el set
  base de fixtures lo tiene grabado como fallo.
"""

from __future__ import annotations

import pytest

from kaizen_api import schemas
from kaizen_api.domain import markets as markets_domain
from kaizen_api.providers.yahoo import prices


def test_cada_simbolo_esta_en_un_solo_grupo() -> None:
    simbolos = [s for _, _, miembros in markets_domain.OVERVIEW_GROUPS for s, _, _ in miembros]
    assert len(simbolos) == len(set(simbolos)), "hay un símbolo repetido entre los grupos"


def test_los_grupos_son_los_del_contrato_y_van_en_orden() -> None:
    ids = [gid for gid, _, _ in markets_domain.OVERVIEW_GROUPS]
    assert ids == ["mx", "us", "global", "fx", "commodities", "crypto"]
    assert set(ids) == set(schemas.MarketGroup.model_fields["id"].annotation.__args__)


def test_las_etiquetas_van_en_espaniol_y_sin_guiones_largos() -> None:
    for _, label, miembros in markets_domain.OVERVIEW_GROUPS:
        assert "—" not in label and "–" not in label
        for _, item_label, _ in miembros:
            assert "—" not in item_label and "–" not in item_label
    assert "—" not in markets_domain.WORLD_METHOD and "–" not in markets_domain.WORLD_METHOD


def test_todos_los_simbolos_del_panorama_se_piden_en_el_mismo_lote() -> None:
    """Si un símbolo del panorama no está en el lote del legado, se iría a una llamada suelta."""
    en_lote = set(_MARKET_VALUES := set(markets_domain._MARKET_SYMS.values()))
    for _, _, miembros in markets_domain.OVERVIEW_GROUPS:
        for symbol, _, _ in miembros:
            assert symbol in en_lote, symbol
    assert "DX-Y.NYB" in _MARKET_VALUES


def test_el_ipc_sale_en_pesos_y_el_dxy_de_yahoo(b2a_replay) -> None:
    groups, as_of, notes = markets_domain.overview_data()
    por_id = {g["id"]: g for g in groups}
    ipc = por_id["mx"]["items"][0]
    assert ipc["symbol"] == "^MXX" and ipc["currency"] == "MXN"
    dxy = next(i for i in por_id["fx"]["items"] if i["symbol"] == "DX-Y.NYB")
    assert dxy["price"] is not None and dxy["currency"] is None
    assert as_of == "2026-09-22"
    assert notes == []


def test_la_variacion_es_fraccion_y_sale_del_ultimo_par_de_cierres(monkeypatch) -> None:
    """Respuesta conocida: de 100 a 110 son 0.10, no 10."""
    monkeypatch.setattr(
        prices,
        "download_closes",
        lambda symbols, period="5d", interval="1d": {
            "^MXX": {"dates": ["2026-09-21", "2026-09-22"], "closes": [100.0, 110.0]},
            "DX-Y.NYB": {"dates": ["2026-09-21", "2026-09-22"], "closes": [98.0, 99.0]},
        },
    )
    groups, as_of, notes = markets_domain.overview_data()
    ipc = groups[0]["items"][0]
    assert ipc["price"] == 110.0
    assert ipc["change"] == 10.0
    assert ipc["changePct"] == pytest.approx(0.10)
    assert as_of == "2026-09-22"
    assert notes and notes[0].startswith("Sin dato en esta actualización de ")


def test_un_simbolo_sin_dato_sale_en_blanco_y_no_se_inventa(monkeypatch) -> None:
    monkeypatch.setattr(prices, "download_closes", lambda *a, **k: {})
    groups, as_of, notes = markets_domain.overview_data()
    valores = [i["price"] for g in groups for i in g["items"]]
    assert valores and all(v is None for v in valores)
    assert as_of is None
    # con todo caído el aviso cuenta los faltantes en vez de listar treinta y tantos
    assert notes and notes[0] == f"Sin dato en esta actualización de {len(valores)} instrumentos; salen como s/d."


def test_la_ruta_del_panorama_cumple_el_contrato(client) -> None:
    r = client.get("/v2/markets/overview")
    assert r.status_code == 200, r.text
    body = schemas.MarketsOverviewResponse.model_validate(r.json())
    assert [g.id for g in body.groups] == ["mx", "us", "global", "fx", "commodities", "crypto"]
    assert body.marketStatus.bmv.open is True and body.marketStatus.nyse.open is True
    assert body.marketStatus.bmv.nextClose == "2026-09-22T21:00:00Z"
    assert body.meta.source == "yahoo" and body.meta.delayMinutes == 15
    assert body.meta.fallback is False
    for group in body.groups:
        for item in group.items:
            assert item.changePct is None or abs(item.changePct) < 1.0
    assert r.headers["cache-control"] == "private, max-age=30"


def test_el_mapa_mundial_sale_en_dolares_con_pais_iso(client) -> None:
    r = client.get("/v2/markets/world")
    assert r.status_code == 200, r.text
    body = schemas.WorldResponse.model_validate(r.json())
    assert len(body.items) == 26
    paises = {i.country for i in body.items}
    assert "484" in paises and "840" in paises
    assert all(i.currency == "USD" for i in body.items)
    assert all(len(i.country) == 3 and i.country.isdigit() for i in body.items)
    mexico = next(i for i in body.items if i.country == "484")
    assert mexico.symbol == "EWW" and mexico.label == "México"
    assert "tipo de cambio" not in body.method
    assert "moneda local frente al dólar" in body.method


def test_cada_pais_del_mapa_tiene_nombre_en_espaniol() -> None:
    faltan = set(markets_domain._WORLDMAP_SYMS.values()) - set(markets_domain.WORLD_COUNTRIES)
    assert faltan == set(), faltan


def test_avisos_de_datos_faltantes_en_espanol_con_nombre_y_plural(monkeypatch) -> None:
    """Un solo faltante va en singular; varios se unen con "y"; nunca la clave de Yahoo sola."""
    assert markets_domain._join_es(["A"]) == "A"
    assert markets_domain._join_es(["A", "B", "C"]) == "A, B y C"
    world = dict(markets_domain._WORLDMAP_SYMS)
    first = next(iter(world))
    closes = {"dates": ["2026-09-21", "2026-09-22"], "closes": [100.0, 101.0]}
    monkeypatch.setattr(prices, "download_closes", lambda *a, **k: {s: closes for s in world if s != first})
    # panorama con un solo faltante: se nombra como lo lee una persona, con la clave entre paréntesis
    syms = list(markets_domain._MARKET_SYMS.values())
    monkeypatch.setattr(prices, "download_closes", lambda *a, **k: {s: closes for s in syms if s != "^HSI"})
    _, _, overview_notes = markets_domain.overview_data()
    assert overview_notes == ["Sin dato en esta actualización de Hang Seng (^HSI); sale como s/d."]
    monkeypatch.setattr(prices, "download_closes", lambda *a, **k: {s: closes for s in world if s != first})
    items, _, notes = markets_domain.world_data()
    assert len(items) == len(world) - 1
    label = markets_domain.WORLD_COUNTRIES.get(world[first], world[first])
    assert notes == [f"Sin dato en esta actualización de {label} ({first}); ese país no sale en la lista."]
