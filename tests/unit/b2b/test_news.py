"""``/v2/news``: normalización, duplicados, idioma, ligas y la ruta completa contra los fixtures."""

from __future__ import annotations

import json

import pytest

from kaizen_api.domain import news as N
from kaizen_api.schemas import NewsResponse

# ─── piezas ──────────────────────────────────────────────────────────────────


def test_normalize_title_junta_las_variantes_del_mismo_cable():
    a = N.normalize_title("Nasdaq marca récord, ¡otra vez!")
    b = N.normalize_title("  nasdaq  marca  record  otra  vez  ")
    assert a == b == "nasdaq marca record otra vez"


@pytest.mark.parametrize(
    "texto,esperado",
    [
        ("El peso se fortalece frente al dólar por la decisión de Banxico", "es"),
        ("Stocks climb as the Fed holds rates for a third meeting", "en"),
        ("Récord", "es"),
        ("Nasdaq", "en"),
    ],
)
def test_detect_lang(texto, esperado):
    assert N.detect_lang(texto) == esperado


def test_item_id_es_estable_y_distingue():
    uno = N.item_id("https://medio.example/a", "Título")
    otro = N.item_id("https://medio.example/a", "  titulo!  ")
    distinto = N.item_id("https://medio.example/b", "Título")
    assert uno == otro, "el mismo título normalizado y la misma liga dan el mismo id"
    assert uno != distinto
    assert len(uno) == 16


@pytest.mark.parametrize(
    "url,ok",
    [
        ("https://medio.example/n", True),
        ("http://medio.example/n", True),
        ("javascript:alert(1)", False),
        ("data:text/html,<script>", False),
        ("/economia/nota", False),
        ("", False),
        (None, False),
    ],
)
def test_is_public_link(url, ok):
    assert N.is_public_link(url) is ok


@pytest.mark.parametrize(
    "simbolo,raiz",
    [("WALMEX.MX", "WALMEX"), ("aapl", "AAPL"), ("^MXX", ""), ("USDMXN=X", ""), ("", ""), (None, "")],
)
def test_ticker_root(simbolo, raiz):
    assert N.ticker_root(simbolo) == raiz


def test_mentions_compara_palabra_completa():
    assert N._mentions("WALMEX reporta ventas de agosto", "WALMEX")
    assert N._mentions("Walmex reporta", "walmex")
    assert not N._mentions("WALMEXICO no existe", "WALMEX")
    assert not N._mentions("cualquier cosa", "")


# ─── armado de la lista ──────────────────────────────────────────────────────


def _crudo(**campos):
    base = {"title": "Titular", "url": "https://medio.example/n", "source": "Medio", "published": None,
            "summary": None, "provider": "rss"}
    base.update(campos)
    return base


def test_build_items_quita_duplicados_por_titulo_normalizado():
    crudos = [
        _crudo(title="Nasdaq marca récord", url="https://a.example/1", published="2026-09-22T10:00:00Z"),
        _crudo(title="NASDAQ  marca  record!", url="https://b.example/2", published="2026-09-22T09:00:00Z"),
    ]
    items = N.build_items(crudos)
    assert len(items) == 1
    assert items[0]["url"] == "https://a.example/1", "se queda el primero que llegó"


def test_build_items_descarta_ligas_que_no_son_http_y_titulares_vacios():
    crudos = [
        _crudo(title="Con javascript", url="javascript:alert(1)"),
        _crudo(title="Relativa", url="/economia/nota"),
        _crudo(title="   ", url="https://a.example/3"),
        _crudo(title="Buena", url="https://a.example/4"),
    ]
    items = N.build_items(crudos)
    assert [i["title"] for i in items] == ["Buena"]


def test_build_items_filtra_por_idioma():
    crudos = [
        _crudo(title="El peso se fortalece frente al dólar por la decisión de Banxico", lang=None),
        _crudo(title="Stocks climb as the Fed holds rates for a third meeting", url="https://a.example/5", lang=None),
    ]
    assert len(N.build_items(crudos, lang="all")) == 2
    assert [i["lang"] for i in N.build_items(crudos, lang="es")] == ["es"]
    assert [i["lang"] for i in N.build_items(crudos, lang="en")] == ["en"]


def test_build_items_ordena_de_mas_nuevo_a_mas_viejo_y_recorta():
    crudos = [
        _crudo(title="Vieja", url="https://a.example/6", published="2026-01-01T00:00:00Z"),
        _crudo(title="Nueva", url="https://a.example/7", published="2026-09-22T00:00:00Z"),
        _crudo(title="Sin fecha", url="https://a.example/8", published=None),
    ]
    items = N.build_items(crudos, limit=2)
    assert [i["title"] for i in items] == ["Nueva", "Vieja"]
    assert N.build_items(crudos, limit=0) == []


def test_build_items_respeta_el_idioma_declarado_del_feed():
    """Un feed mexicano declara ``es`` en feeds_es.json y eso manda sobre la adivinanza."""
    crudos = [_crudo(title="Nasdaq, Dow, S&P", lang="es")]
    assert N.build_items(crudos, lang="es")[0]["lang"] == "es"


def test_los_feeds_del_catalogo_estan_bien_formados():
    datos = json.loads(N.FEEDS_PATH.read_text(encoding="utf-8"))
    assert datos["feeds"], "tiene que haber al menos una fuente en español"
    urls = set()
    for feed in datos["feeds"]:
        assert feed["url"].startswith("https://")
        assert feed["url"] not in urls
        urls.add(feed["url"])
        assert feed["lang"] == "es" and feed["nombre"] and feed["id"]
    assert datos["queSePublica"] and datos["comoSeEligieron"] and datos["atribucion"]
    for descartado in datos["descartados"]:
        assert descartado["porQue"], f"{descartado['url']} no dice por qué se descartó"


# ─── la ruta ─────────────────────────────────────────────────────────────────


def test_news_de_mercado(client):
    r = client.get("/v2/news?limit=20")
    assert r.status_code == 200, r.text
    body = NewsResponse.model_validate(r.json())
    assert 10 <= len(body.items) <= 20
    titulos = [N.normalize_title(i.title) for i in body.items]
    assert len(titulos) == len(set(titulos)), "no puede haber dos veces el mismo titular"
    assert all(i.url.startswith("https://") for i in body.items)
    assert all(i.tone.method == "heuristic" for i in body.items)
    assert {"rss", "yahoo"} == set(body.meta.source.split(",")), "salen las dos familias de fuentes"
    assert body.meta.delayMinutes == 15
    assert body.meta.fallback is False
    assert r.headers["cache-control"] == "private, max-age=600"


def test_news_mezcla_medios_mexicanos_y_yahoo(client):
    body = NewsResponse.model_validate(client.get("/v2/news?limit=60").json())
    fuentes = {i.source for i in body.items}
    assert "Expansion" in fuentes and "El Financiero" in fuentes
    assert any(i.lang == "es" for i in body.items) and any(i.lang == "en" for i in body.items)


def test_news_filtra_por_idioma(client):
    solo_es = NewsResponse.model_validate(client.get("/v2/news?lang=es&limit=30").json())
    assert solo_es.items and all(i.lang == "es" for i in solo_es.items)


def test_news_de_una_emisora(client):
    body = NewsResponse.model_validate(client.get("/v2/news?symbol=walmex.mx&limit=10").json())
    assert body.items, "WALMEX.MX tiene noticias grabadas"
    assert any("WALMEX" in i.title.upper() or "WAL" in i.title.upper() for i in body.items)
    assert "WALMEX" in " ".join(body.meta.notes)


def test_news_de_un_indice_no_lee_los_medios_generales(client):
    """``^MXX`` no tiene nombre que buscar en un titular, así que ahí los feeds no se leen."""
    body = NewsResponse.model_validate(client.get("/v2/news?symbol=%5EMXX&limit=5").json())
    assert body.meta.source == "yahoo"
    assert body.meta.stale is True, "lo último que Yahoo tiene del IPC es de hace meses"


def test_symbol_vacio_se_trata_como_si_no_viniera(client):
    """Es lo que manda un formulario sin llenar: no puede ser un 400."""
    con_vacio = client.get("/v2/news?symbol=&limit=5")
    sin_symbol = client.get("/v2/news?limit=5")
    assert con_vacio.status_code == 200
    assert [i["id"] for i in con_vacio.json()["items"]] == [i["id"] for i in sin_symbol.json()["items"]]


@pytest.mark.parametrize("url", ["/v2/news?symbol=%25", "/v2/news?symbol=AAPL%20X", "/v2/news?symbol=<x>"])
def test_symbol_mal_formado_es_400(client, url):
    r = client.get(url)
    assert r.status_code == 400, r.text
    body = r.json()
    assert body["error"]["code"] == "INVALID_SYMBOL"
    assert body["error"]["details"]["fields"] == [{"field": "query.symbol", "type": "string_pattern_mismatch"}]


@pytest.mark.parametrize("url", ["/v2/news?limit=0", "/v2/news?limit=101", "/v2/news?lang=fr"])
def test_parametros_invalidos_son_422(client, url):
    r = client.get(url)
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"


def test_symbol_demasiado_largo_es_400(client):
    r = client.get("/v2/news?symbol=" + "A" * 21)
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "INVALID_SYMBOL"
