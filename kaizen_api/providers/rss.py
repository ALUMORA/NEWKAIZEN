"""Feeds RSS y Atom públicos. El legado (``_rss_news``) se queda igual; abajo va el lector v2.

El lector v2 parsea **los bytes**, no ``resp.text``: varios feeds mexicanos salen como
``text/xml`` sin ``charset``, y ahí ``requests`` asume ISO-8859-1 y "económico" se lee
"econÃ³mico". ``ElementTree`` respeta la declaración del XML, así que los acentos llegan bien.

Solo se saca **titular, liga, fuente y fecha**. El resumen se guarda aparte y ``/v2/news`` lo
publica recortado; nunca se reproduce el cuerpo de la nota.
"""

from __future__ import annotations

import datetime as _dt
import html
import re
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime

from kaizen_api.providers.yahoo.session import _session

TIMEOUT = 10
MAX_ITEMS = 30


def _rss_news(url: str) -> list:
    """Obtiene noticias de un feed RSS público (no requiere auth)."""
    items = []
    try:
        resp = _session.get(url, timeout=6)
        text = resp.text
        import re as _re
        entries = _re.findall(r"<item>(.*?)</item>", text, _re.DOTALL)
        for entry in entries[:8]:
            def _tag(tag, s=entry):
                m = _re.search(rf"<{tag}[^>]*>(.*?)</{tag}>", s, _re.DOTALL)
                return (m.group(1).strip().replace("<![CDATA[","").replace("]]>","") if m else "")
            title = _tag("title")
            link  = _tag("link") or _tag("guid")
            desc  = _tag("description")[:250]
            pub   = _tag("pubDate")
            try:
                from email.utils import parsedate_to_datetime
                ts = int(parsedate_to_datetime(pub).timestamp())
            except Exception:
                ts = 0
            if title:
                items.append({"title": title, "summary": desc, "url": link, "publisher": "Yahoo Finance", "time": ts})
    except Exception:
        pass
    return items


# ─── v2: lector de RSS y Atom ────────────────────────────────────────────────

_TAG_RE = re.compile(r"<[^>]+>")
_SPACE_RE = re.compile(r"\s+")


def strip_html(raw: str, limit: int = 280) -> str:
    """Quita etiquetas, decodifica entidades y recorta. ``&amp;quot;`` doble también se resuelve."""
    text = html.unescape(html.unescape(str(raw or "")))
    text = text.replace("<![CDATA[", "").replace("]]>", "")
    text = _TAG_RE.sub(" ", text)
    text = _SPACE_RE.sub(" ", text).strip()
    return text[:limit].strip()


def parse_instant(raw: str) -> str | None:
    """Fecha de un feed (RFC 822 o ISO 8601) a instante ISO en UTC con ``Z``; ``None`` si no se pudo."""
    text = str(raw or "").strip()
    if not text:
        return None
    parsed: _dt.datetime | None = None
    try:
        parsed = parsedate_to_datetime(text)
    except (TypeError, ValueError, IndexError):
        parsed = None
    if parsed is None:
        try:
            parsed = _dt.datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=_dt.UTC)
    return parsed.astimezone(_dt.UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _local(tag: str) -> str:
    """``{http://www.w3.org/2005/Atom}entry`` a ``entry``: los feeds usan espacios de nombres distintos."""
    return tag.rsplit("}", 1)[-1].lower()


def _first(node: ET.Element, names: tuple[str, ...]) -> str:
    for child in node:
        if _local(child.tag) in names:
            value = (child.text or "").strip()
            if value:
                return value
    return ""


def _link_of(node: ET.Element) -> str:
    """Liga del elemento: texto de ``<link>`` (RSS) o ``href`` del ``<link rel="alternate">`` (Atom)."""
    alternate = ""
    for child in node:
        if _local(child.tag) != "link":
            continue
        text = (child.text or "").strip()
        if text:
            return text
        href = (child.attrib.get("href") or "").strip()
        rel = (child.attrib.get("rel") or "alternate").lower()
        if href and rel == "alternate":
            return href
        alternate = alternate or href
    if alternate:
        return alternate
    guid = _first(node, ("guid", "id"))
    return guid if guid.lower().startswith(("http://", "https://")) else ""


def parse_feed(payload: bytes | str) -> dict:
    """XML de un feed a ``{"source": str, "items": [{title, url, summary, published}]}``.

    Acepta RSS 2.0 (``channel/item``) y Atom (``feed/entry``). Un XML roto devuelve cero elementos
    en vez de reventar: un feed caído no puede tumbar ``/v2/news``.
    """
    data = payload.encode("utf-8") if isinstance(payload, str) else payload
    try:
        root = ET.fromstring(data)
    except ET.ParseError:
        return {"source": "", "items": []}
    channel = root
    for child in root:
        if _local(child.tag) == "channel":
            channel = child
            break
    source = strip_html(_first(channel, ("title",)), 80)
    items: list[dict] = []
    for node in channel.iter():
        if _local(node.tag) not in ("item", "entry"):
            continue
        title = strip_html(_first(node, ("title",)), 300)
        url = strip_html(_link_of(node), 1000)
        if not title or not url:
            continue
        items.append(
            {
                "title": title,
                "url": url,
                "summary": strip_html(_first(node, ("description", "summary", "subtitle")), 280) or None,
                "published": parse_instant(_first(node, ("pubdate", "published", "updated", "date"))),
            }
        )
        if len(items) >= MAX_ITEMS:
            break
    return {"source": source, "items": items}


def fetch_feed(url: str) -> dict:
    """Descarga y parsea un feed. Si falla la red o el XML, devuelve cero elementos, nunca excepción."""
    try:
        resp = _session.get(url, timeout=TIMEOUT)
    except Exception:
        return {"source": "", "items": []}
    if getattr(resp, "status_code", 500) >= 400:
        return {"source": "", "items": []}
    return parse_feed(resp.content)
