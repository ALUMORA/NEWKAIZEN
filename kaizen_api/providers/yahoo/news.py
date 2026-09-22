"""Normalización de las noticias de Yahoo (``Ticker.news``, forma nueva ``{id, content}``).

Movido sin cambios desde backend.py (fase S1): los cuerpos son idénticos al legado y los
goldens de tests/goldens_legacy lo prueban. La versión v2 se escribe al lado, no encima.
"""


def _extract_news_item(item: dict) -> dict:
    content   = item.get("content") or {}
    title     = item.get("title") or content.get("title") or item.get("headline") or ""
    summary   = item.get("summary") or content.get("summary") or item.get("description") or content.get("description") or content.get("body") or ""
    url       = item.get("link") or item.get("url") or content.get("canonicalUrl", {}).get("url") or content.get("clickThroughUrl", {}).get("url") or ""
    publisher = item.get("publisher") or content.get("provider", {}).get("displayName") or item.get("source") or ""
    time_val  = item.get("providerPublishTime") or item.get("pubDate") or content.get("pubDate") or content.get("publishedAt") or 0
    if isinstance(time_val, str):
        try:
            from datetime import datetime
            time_val = int(datetime.fromisoformat(time_val.replace("Z", "+00:00")).timestamp())
        except Exception:
            time_val = 0
    return {"title": title, "summary": str(summary)[:250], "url": url, "publisher": publisher, "time": time_val}
