"""Feeds RSS públicos (Yahoo, MarketWatch, CNBC, etc.).

Movido sin cambios desde backend.py (fase S1): los cuerpos son idénticos al legado y los
goldens de tests/goldens_legacy lo prueban. La versión v2 se escribe al lado, no encima.
"""

from kaizen_api.providers.yahoo.session import _session


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
