"""Noticias de Yahoo (``Ticker.news``). El normalizador del legado se queda igual; abajo va el v2.

``Ticker.news`` cambió de forma entre versiones de yfinance: antes traía ``title``/``link``/
``providerPublishTime`` planos y ahora casi todo cuelga de ``content`` (``canonicalUrl.url``,
``provider.displayName``, ``pubDate`` en ISO). El normalizador v2 acepta las dos y devuelve la
fecha como instante ISO en UTC, no como epoch.
"""

from __future__ import annotations

import datetime as _dt

from kaizen_api.providers.yahoo.session import yft


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


# ─── v2 ──────────────────────────────────────────────────────────────────────


def _instant(raw) -> str | None:
    """Epoch o texto ISO a instante ISO en UTC con ``Z``; ``None`` si no hay fecha utilizable."""
    if raw in (None, "", 0):
        return None
    moment: _dt.datetime | None = None
    if isinstance(raw, (int, float)):
        try:
            moment = _dt.datetime.fromtimestamp(float(raw), _dt.UTC)
        except (OverflowError, OSError, ValueError):
            return None
    else:
        try:
            moment = _dt.datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        except ValueError:
            return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=_dt.UTC)
    return moment.astimezone(_dt.UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _dek(item: dict) -> str | None:
    """El sumario que declara la fuente, nunca ``content.body``: eso es el arranque del artículo.

    Solo sirve adentro (para adivinar el idioma); ``/v2/news`` no lo publica.
    """
    content = item.get("content") or {}
    for raw in (item.get("summary"), content.get("summary"), item.get("description"), content.get("description")):
        text = str(raw or "").strip()
        if text:
            return text
    return None


def normalize(item: dict) -> dict:
    """Un elemento de ``Ticker.news`` (forma vieja o nueva) a ``{title, url, summary, published, source}``."""
    item = item if isinstance(item, dict) else {}
    base = _extract_news_item(item)
    return {
        "title": str(base["title"] or "").strip(),
        "url": str(base["url"] or "").strip(),
        "summary": _dek(item),
        "published": _instant(base["time"]),
        "source": str(base["publisher"] or "").strip() or "Yahoo Finanzas",
    }


def fetch_news(symbol: str, limit: int = 20) -> list[dict]:
    """Noticias normalizadas de un símbolo. Si Yahoo falla o no trae nada, devuelve una lista vacía."""
    try:
        raw = yft(symbol).news or []
    except Exception:
        return []
    items = []
    for entry in list(raw)[: max(0, limit)]:
        parsed = normalize(entry)
        if parsed["title"] and parsed["url"]:
            items.append(parsed)
    return items
