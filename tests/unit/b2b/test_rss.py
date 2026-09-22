"""Lector de RSS y Atom: entidades, CDATA, codificación declarada en el XML, fechas y ligas."""

from __future__ import annotations

import pytest
import responses

from kaizen_api.providers import rss

RSS_XML = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>El Financiero</title>
  <item>
    <title><![CDATA[Peso &amp; d&oacute;lar: el tipo de cambio cede a 17.31]]></title>
    <link>https://www.elfinanciero.com.mx/mercados/nota-1</link>
    <description>&lt;p&gt;El peso cerr&oacute; la sesi&oacute;n con ganancias.&lt;/p&gt;</description>
    <pubDate>Tue, 22 Sep 2026 16:49:59 -0600</pubDate>
  </item>
  <item>
    <title>Nota sin liga</title>
    <description>x</description>
  </item>
  <item>
    <title></title>
    <link>https://www.elfinanciero.com.mx/mercados/nota-2</link>
  </item>
</channel></rss>
"""

ATOM_XML = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Expansion</title>
  <entry>
    <title>Fitch mejora el crecimiento de M&#233;xico</title>
    <link rel="edit" href="https://expansion.mx/editar/1"/>
    <link rel="alternate" href="https://expansion.mx/economia/nota-1"/>
    <summary>La calificadora elev&#243; su pron&#243;stico.</summary>
    <published>2026-09-22T18:51:04Z</published>
  </entry>
</feed>
"""

LATIN1_XML = b"""<?xml version="1.0" encoding="ISO-8859-1"?>
<rss version="2.0"><channel><title>La Jornada</title>
<item><title>Revisan el paquete econ\xf3mico 2027</title>
<link>https://www.jornada.com.mx/economia/nota</link></item>
</channel></rss>
"""


def test_rss_decodifica_entidades_y_cdata():
    feed = rss.parse_feed(RSS_XML)
    assert feed["source"] == "El Financiero"
    assert len(feed["items"]) == 1, "sin título o sin liga no se publica"
    item = feed["items"][0]
    assert item["title"] == "Peso & dólar: el tipo de cambio cede a 17.31"
    assert item["url"] == "https://www.elfinanciero.com.mx/mercados/nota-1"
    assert item["summary"] == "El peso cerró la sesión con ganancias."
    assert item["published"] == "2026-09-22T22:49:59Z", "la hora se pasa a UTC"


def test_atom_usa_la_liga_alternate():
    feed = rss.parse_feed(ATOM_XML)
    assert feed["source"] == "Expansion"
    item = feed["items"][0]
    assert item["title"] == "Fitch mejora el crecimiento de México"
    assert item["url"] == "https://expansion.mx/economia/nota-1", "no la de editar"
    assert item["published"] == "2026-09-22T18:51:04Z"


def test_respeta_la_codificacion_declarada_en_el_xml():
    """Varios feeds salen como text/xml sin charset; ahí requests asume ISO-8859-1 y sale mojibake."""
    feed = rss.parse_feed(LATIN1_XML)
    assert feed["items"][0]["title"] == "Revisan el paquete económico 2027"


@pytest.mark.parametrize("payload", ["", "no es xml", "<rss><channel>", b"\x00\x01"])
def test_xml_roto_no_tumba_la_ruta(payload):
    assert rss.parse_feed(payload) == {"source": "", "items": []}


@pytest.mark.parametrize(
    "raw,esperado",
    [
        ("Tue, 22 Sep 2026 16:49:59 -0600", "2026-09-22T22:49:59Z"),
        ("2026-09-22T18:51:04Z", "2026-09-22T18:51:04Z"),
        ("2026-09-22T12:00:00", "2026-09-22T12:00:00Z"),
        ("", None),
        ("ayer", None),
    ],
)
def test_parse_instant(raw, esperado):
    assert rss.parse_instant(raw) == esperado


def test_strip_html_quita_etiquetas_y_recorta():
    assert rss.strip_html("<p>Hola   <b>mundo</b></p>") == "Hola mundo"
    assert rss.strip_html("&amp;quot;comillas&amp;quot;") == '"comillas"'
    assert len(rss.strip_html("x" * 500)) == 280


@responses.activate
def test_fetch_feed_devuelve_vacio_si_el_medio_falla():
    responses.add(responses.GET, "https://medio.example/rss", status=503)
    assert rss.fetch_feed("https://medio.example/rss") == {"source": "", "items": []}


@responses.activate
def test_fetch_feed_parsea_bytes():
    responses.add(responses.GET, "https://medio.example/rss", body=LATIN1_XML, status=200,
                  content_type="text/xml")
    feed = rss.fetch_feed("https://medio.example/rss")
    assert feed["items"][0]["title"] == "Revisan el paquete económico 2027"


@responses.activate
def test_fetch_feed_sin_conexion_no_revienta():
    """Un feed caído no puede tumbar /v2/news: devuelve cero elementos, nunca excepción."""
    responses.add(responses.GET, "https://medio.example/rss", body=ConnectionError("sin red"))
    assert rss.fetch_feed("https://medio.example/rss") == {"source": "", "items": []}


def test_entidades_con_nombre_de_html_no_rompen_el_feed():
    """Un solo &nbsp; en un titular rompía el XML entero y desaparecía al medio de la lista."""
    xml = ("<rss><channel><title>Medio</title><item>"
           "<title>Caf&eacute;&nbsp;y bolsa</title><link>https://medio.example/n</link>"
           "</item></channel></rss>")
    feed = rss.parse_feed(xml)
    assert feed["items"][0]["title"].startswith("Café")
    assert rss.numeric_entities(b"&oacute; &amp; &noexiste;") == b"&#243; &amp; &noexiste;"
