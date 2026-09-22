"""Noticias por emisora y de mercado, con el clasificador de tono heurístico del legado.

El tono v2 (``positivo``/``negativo``/``neutral`` con score) vivirá en ``domain/tone.py``.

Movido sin cambios desde backend.py (fase S1): los cuerpos son idénticos al legado y los
goldens de tests/goldens_legacy lo prueban. La versión v2 se escribe al lado, no encima.
"""

from kaizen_api.providers.rss import _rss_news
from kaizen_api.providers.yahoo.news import _extract_news_item
from kaizen_api.providers.yahoo.session import yft


def get_market_news() -> dict:
    """Noticias de mercados — intenta yfinance y luego RSS como fallback."""
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
