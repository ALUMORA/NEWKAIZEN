"""Noticias por emisora y de mercado, con el clasificador de tono heurístico del legado.

El tono v2 (``positivo``/``negativo``/``neutral`` con score) vivirá en ``domain/tone.py``.

Movido sin cambios desde backend.py (fase S1): los cuerpos son idénticos al legado y los
goldens de tests/goldens_legacy lo prueban. La versión v2 se escribe al lado, no encima.
"""

import datetime as _dt
import hashlib
import json
import re
import unicodedata
from functools import lru_cache
from pathlib import Path

from kaizen_api.cache import _cached, register_reset
from kaizen_api.domain.tone import tone as tone_of
from kaizen_api.provenance import utc_now
from kaizen_api.providers import rss as rss_provider
from kaizen_api.providers.rss import _rss_news
from kaizen_api.providers.yahoo import news as yahoo_news
from kaizen_api.providers.yahoo.news import _extract_news_item
from kaizen_api.providers.yahoo.session import yft


def get_market_news() -> dict:
    """Noticias de mercados: intenta yfinance y luego RSS como fallback."""
    seen, all_news = set(), []

    # Primario: yfinance .news (puede fallar en cloud)
    tickers = ["^MXX", "^GSPC", "USDMXN=X", "GC=F", "CL=F", "BTC-USD"]
    for ticker in tickers:
        try:
            raw = yft(ticker).news or []
            for item in raw[:10]:
                parsed = _extract_news_item(item)
                if not parsed["title"] or parsed["url"] in seen:
                    continue
                seen.add(parsed["url"])
                parsed["sentiment"] = classify_sentiment(parsed["title"] + " " + parsed["summary"])
                all_news.append(parsed)
        except Exception:
            pass

    # Fallback: RSS feeds públicos si yfinance no dio noticias
    if len(all_news) < 5:
        rss_feeds = [
            # Yahoo Finance
            "https://feeds.finance.yahoo.com/rss/2.0/headline?s=%5EGSPC&region=US&lang=en-US",
            "https://feeds.finance.yahoo.com/rss/2.0/headline?s=USDMXN%3DX&region=US&lang=en-US",
            "https://feeds.finance.yahoo.com/rss/2.0/headline?s=GC%3DF&region=US&lang=en-US",
            # MarketWatch
            "https://feeds.content.dowjones.io/public/rss/mw_topstories",
            "https://feeds.content.dowjones.io/public/rss/mw_marketpulse",
            # CNBC
            "https://www.cnbc.com/id/100003114/device/rss/rss.html",
            "https://www.cnbc.com/id/10000664/device/rss/rss.html",
            # Seeking Alpha
            "https://seekingalpha.com/market_currents.xml",
            # Investing.com
            "https://www.investing.com/rss/news.rss",
        ]
        for feed in rss_feeds:
            if len(all_news) >= 20:
                break
            for item in _rss_news(feed):
                if item["url"] not in seen:
                    seen.add(item["url"])
                    item["sentiment"] = classify_sentiment(item["title"] + " " + item["summary"])
                    all_news.append(item)

    all_news.sort(key=lambda x: x.get("time", 0), reverse=True)
    return {"news": all_news[:30]}


POSITIVE_WORDS = {
    "beat","beats","record","surge","surges","rally","rallies","gain","gains",
    "profit","profits","growth","grows","upgrade","upgrades","buy","outperform",
    "strong","stronger","raise","raised","rises","rose","jump","jumps","boost",
    "positive","exceed","exceeds","expansion","dividend","buyback","upside",
    "revenue","milestone","breakthrough","partnership","deal","approved","approval",
    "gana","sube","alza","récord","supera","crecimiento","dividendo","compra",
    "acuerdo","positivo","mejora","impulso","expansión","aprobación",
}
NEGATIVE_WORDS = {
    "miss","misses","loss","losses","decline","declines","fall","falls","drop",
    "drops","cut","cuts","downgrade","downgrades","sell","underperform","weak",
    "weaker","lower","lowered","plunge","plunges","crash","crashes","warning",
    "risk","risks","lawsuit","fraud","investigation","fine","penalty","recall",
    "layoff","layoffs","bankruptcy","debt","crisis","concern","concerns","negative",
    "pierde","baja","caída","pérdida","recorte","demanda","fraude","multa",
    "débil","riesgo","crisis","preocupación","negativo","reducción",
}

def classify_sentiment(text: str) -> str:
    words = text.lower().split()
    pos = sum(1 for w in words if any(p in w for p in POSITIVE_WORDS))
    neg = sum(1 for w in words if any(n in w for n in NEGATIVE_WORDS))
    if pos > neg: return "positive"
    elif neg > pos: return "negative"
    return "neutral"


def get_news(ticker: str) -> dict:
    try:
        raw  = yft(ticker).news or []
        news = []
        for item in raw[:20]:
            parsed = _extract_news_item(item)
            if not parsed["title"]: continue
            parsed["sentiment"] = classify_sentiment(parsed["title"] + " " + parsed["summary"])
            news.append(parsed)
        return {"news": news}
    except Exception as e:
        return {"news": [], "error": str(e)}


# ─── v2: titular y liga, sin duplicados, con tono heurístico ─────────────────
#
# Lo de arriba es el legado (subcadenas, inglés, resumen largo) y se queda para las rutas v1.
# Esto es lo que sirve /v2/news: fuentes en español para México además de Yahoo, entidades HTML
# decodificadas, ligas que no sean http descartadas, duplicados quitados por título normalizado y
# el tono de domain/tone.py, que es un campo aparte y opcional. ``summary`` va siempre en ``null``:
# el contrato es titular y liga, y nunca se reproduce texto de la nota.

FEEDS_PATH = Path(__file__).resolve().parents[1] / "data" / "feeds_es.json"

MARKET_SYMBOLS = ("^MXX", "^GSPC", "USDMXN=X", "GC=F", "CL=F", "BTC-USD")
"""Símbolos de los que se piden noticias de mercado cuando no se pidió ninguna emisora."""

NEWS_TTL = 600
MAX_PER_SOURCE = 20
STALE_AFTER_HOURS = 48
"""Si el titular más nuevo tiene más de dos días, la respuesta va marcada ``stale``: pasa cuando
Yahoo no tiene nada reciente de un símbolo y lo último que devuelve es del año pasado."""

_ES_STOPWORDS = frozenset(
    "el la los las un una unos unas de del en y que para por con su sus se al no mas como sobre"
    " tras desde entre hasta pero cuando donde ya solo tambien este esta estos estas".split()
)
_EN_STOPWORDS = frozenset(
    "the of in and to for on with a an is are as at by from after over its new be was were this"
    " that these those will not but up down about".split()
)
_ES_ONLY_CHARS = frozenset("áéíóúüñ¿¡")
_PUNCT_RE = re.compile(r"[^0-9a-z ]+")
_SPACES_RE = re.compile(r"\s+")


@lru_cache(maxsize=1)
def feeds() -> list[dict]:
    """Feeds en español de ``kaizen_api/data/feeds_es.json`` (id, nombre, url, lang)."""
    return list(json.loads(FEEDS_PATH.read_text(encoding="utf-8"))["feeds"])


@register_reset
def _forget_feeds() -> None:
    feeds.cache_clear()


def _fold(text: str) -> str:
    norm = unicodedata.normalize("NFD", str(text or "").lower())
    return "".join(ch for ch in norm if unicodedata.category(ch) != "Mn")


def normalize_title(title: str) -> str:
    """Título a su forma para comparar: minúsculas, sin acentos, sin puntuación, sin espacios de más.

    Dos medios que publican el mismo cable con comillas distintas dan el mismo resultado, y por eso
    se puede quitar el duplicado sin comparar ligas (que casi nunca coinciden).
    """
    return _SPACES_RE.sub(" ", _PUNCT_RE.sub(" ", _fold(title))).strip()


def detect_lang(text: str) -> str:
    """``"es"`` o ``"en"`` por palabras vacías; si empatan, deciden los acentos y la ñ."""
    words = _PUNCT_RE.sub(" ", _fold(text)).split()
    spanish = sum(1 for w in words if w in _ES_STOPWORDS)
    english = sum(1 for w in words if w in _EN_STOPWORDS)
    if spanish != english:
        return "es" if spanish > english else "en"
    return "es" if any(ch in _ES_ONLY_CHARS for ch in str(text or "").lower()) else "en"


def item_id(url: str, title: str) -> str:
    """Id estable del titular: hash corto de la liga más el título normalizado."""
    raw = f"{str(url or '').strip()}|{normalize_title(title)}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]  # noqa: S324 - id, no es seguridad


def is_public_link(url: str) -> bool:
    """Solo ``http`` y ``https``: algunos feeds mandan ``javascript:`` o ligas relativas."""
    return str(url or "").strip().lower().startswith(("http://", "https://"))


def _mentions(text: str, needle: str) -> bool:
    """¿El titular menciona la emisora como palabra completa? (``WALMEX`` sí, ``WAL`` dentro de otra no)."""
    if not needle:
        return False
    return re.search(rf"(?<![0-9a-z]){re.escape(_fold(needle))}(?![0-9a-z])", _fold(text)) is not None


def ticker_root(symbol: str) -> str:
    """``WALMEX.MX`` a ``WALMEX``; ``^MXX`` y ``USDMXN=X`` no tienen raíz que buscar en un titular."""
    sym = str(symbol or "").strip().upper()
    if not sym or sym.startswith("^") or "=" in sym:
        return ""
    return sym.split(".")[0]


def _yahoo_items(symbol: str) -> list[dict]:
    raw = _cached(f"news:yf:{symbol}", lambda: yahoo_news.fetch_news(symbol, MAX_PER_SOURCE), ttl=NEWS_TTL, ok=bool)
    return [dict(item, provider="yahoo") for item in raw]


def _feed_items(feed: dict) -> list[dict]:
    parsed = _cached(f"news:rss:{feed['url']}", lambda: rss_provider.fetch_feed(feed["url"]), ttl=NEWS_TTL,
                     ok=lambda r: bool(r["items"]))
    out = []
    for item in parsed["items"][:MAX_PER_SOURCE]:
        out.append(dict(item, provider="rss", source=feed.get("nombre") or parsed["source"], lang=feed.get("lang")))
    return out


def collect(symbol: str | None = None, lang: str = "all") -> tuple[list[dict], list[str], list[str]]:
    """Titulares crudos de Yahoo y de los medios en español, los avisos y qué proveedores se pidieron.

    Con símbolo: noticias de Yahoo de esa emisora, más los titulares de los medios en español que
    **la mencionan por nombre**, porque esos feeds son de mercados en general y mezclarlos completos
    sería presentar como noticias de la emisora lo que no lo es. Un índice o un par de divisas
    (``^MXX``, ``USDMXN=X``) no tiene nombre que buscar en un titular, así que ahí no se leen.
    """
    notes: list[str] = []
    raw: list[dict] = []
    queried: list[str] = []
    symbols = [symbol] if symbol else list(MARKET_SYMBOLS)
    for sym in symbols:
        raw += _yahoo_items(sym)
    queried.append("yahoo")
    root = ticker_root(symbol) if symbol else ""
    read_feeds = lang != "en" and (root or not symbol)
    if not read_feeds:
        return raw, notes, queried
    queried.append("rss")
    down: list[str] = []
    for feed in feeds():
        items = _feed_items(feed)
        if not items:
            down.append(feed.get("nombre") or feed["id"])
            continue
        if symbol:
            items = [i for i in items if _mentions(i["title"], root)]
        raw += items
    if down:
        notes.append("Estos medios no respondieron y no aparecen: " + ", ".join(sorted(set(down))) + ".")
    if symbol:
        notes.append(f"De los medios en español solo se muestran los titulares que mencionan {root}.")
    return raw, notes, queried


def build_items(raw: list[dict], lang: str = "all", limit: int = 30) -> list[dict]:
    """Normaliza, filtra por idioma, quita duplicados por título y ordena de más nuevo a más viejo."""
    seen: set[str] = set()
    items: list[dict] = []
    for entry in raw:
        title = str(entry.get("title") or "").strip()
        url = str(entry.get("url") or "").strip()
        if not title or not is_public_link(url):
            continue
        key = normalize_title(title)
        if not key or key in seen:
            continue
        seen.add(key)
        item_lang = entry.get("lang") or detect_lang(f"{title} {entry.get('summary') or ''}")
        if item_lang not in ("es", "en"):
            item_lang = detect_lang(title)
        if lang in ("es", "en") and item_lang != lang:
            continue
        items.append(
            {
                "id": item_id(url, title),
                "title": title,
                "url": url,
                "source": str(entry.get("source") or "").strip() or "Yahoo Finanzas",
                "publishedAt": entry.get("published"),
                # Titular y liga, nada más (contrato de /v2/news): el resumen de la fuente solo se
                # usa arriba para adivinar el idioma y no se publica.
                "summary": None,
                "lang": item_lang,
                "tone": tone_of(title),
                "provider": entry.get("provider") or "yahoo",
            }
        )
    items.sort(key=lambda i: (i["publishedAt"] or "", i["title"]), reverse=True)
    return items[: max(0, limit)]


def get_news_v2(symbol: str | None = None, lang: str = "all", limit: int = 30) -> dict:
    """``/v2/news``: ``{"items", "sources", "asOf", "notes"}``. Nunca levanta por un feed caído."""
    raw, notes, queried = collect(symbol, lang=lang)
    items = build_items(raw, lang=lang, limit=limit)
    providers = sorted({item.pop("provider") for item in items})
    dates = [item["publishedAt"] for item in items if item["publishedAt"]]
    if not items:
        notes.append("Ninguna fuente devolvió titulares para esta consulta.")
    as_of = max(dates) if dates else None
    return {
        "items": items,
        "sources": providers or sorted(queried),
        "asOf": as_of,
        "stale": _is_stale(as_of),
        "notes": notes,
    }


def _is_stale(as_of: str | None) -> bool:
    """¿El titular más nuevo ya pasó de ``STALE_AFTER_HOURS``? Sin fecha, se asume que sí."""
    if not as_of:
        return True
    try:
        moment = _dt.datetime.fromisoformat(str(as_of).replace("Z", "+00:00"))
    except ValueError:
        return True
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=_dt.UTC)
    return (utc_now() - moment).total_seconds() > STALE_AFTER_HOURS * 3600
