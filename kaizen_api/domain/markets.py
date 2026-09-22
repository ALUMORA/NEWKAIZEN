"""Mercados: índices, divisas, materias primas, cripto y el mapa mundial por ETF de país.

Movido sin cambios desde backend.py (fase S1): los cuerpos son idénticos al legado y los
goldens de tests/goldens_legacy lo prueban. La versión v2 se escribe al lado, no encima.
"""

from concurrent.futures import ThreadPoolExecutor

import yfinance as yf

from kaizen_api.cache import _cached
from kaizen_api.domain.history import _fetch_hist

_MARKET_SYMS = {
    "sp500":  "^GSPC",  "nasdaq": "^IXIC",  "dow":    "^DJI",
    "ipc":    "^MXX",   "nikkei": "^N225",   "ftse":   "^FTSE",
    "dax":    "^GDAXI", "cac":    "^FCHI",   "hsi":    "^HSI",
    "usdmxn": "USDMXN=X", "eurusd": "EURUSD=X", "eurmxn": "EURMXN=X",
    "gbpusd": "GBPUSD=X", "usdjpy": "USDJPY=X",
    "wti":    "CL=F",   "brent":  "BZ=F",    "gold":   "GC=F",
    "silver": "SI=F",   "copper": "HG=F",    "natgas": "NG=F",
    "btc":    "BTC-USD", "eth":   "ETH-USD",
    "vix":    "^VIX",   "dxy":   "DX-Y.NYB", "t10y":  "^TNX",
    "sb_lv": "IVE",  "sb_lb": "IVV",  "sb_lg": "IVW",
    "sb_mv": "IJJ",  "sb_mb": "IJH",  "sb_mg": "IJK",
    "sb_sv": "IJS",  "sb_sb": "IJR",  "sb_sg": "IJT",
}


def _bulk_download(sym_to_key: dict, period: str = "5d") -> dict:
    """
    Descarga todos los símbolos en UNA sola llamada yf.download().
    Mucho menos propenso a rate-limiting que múltiples requests individuales.
    """
    results = {}
    syms = list(sym_to_key.keys())
    try:
        raw = yf.download(
            syms, period=period, interval="1d",
            progress=False, auto_adjust=True,
        )
        if raw is None or raw.empty:
            raise ValueError("empty")
        # Con múltiples tickers, columns es MultiIndex (Price, Ticker)
        closes = raw["Close"] if "Close" in raw.columns.get_level_values(0) else raw
        for sym, key in sym_to_key.items():
            try:
                col = closes[sym].dropna()
                if len(col) >= 1:
                    val  = float(col.iloc[-1])
                    prev = float(col.iloc[-2]) if len(col) >= 2 else val
                    chg  = round(val - prev, 4)
                    pct_v = round((chg / prev) * 100, 2) if prev != 0 else 0
                    results[key] = {"value": round(val, 4), "change": chg, "change_pct": pct_v}
            except Exception:
                pass
    except Exception:
        pass

    # Fallback individual para símbolos que fallaron
    missing = {s: k for s, k in sym_to_key.items() if k not in results}
    if missing:
        def _fetch_one(args):
            sym, key = args
            try:
                hist = _fetch_hist(sym)
                if hist is not None and not hist.empty:
                    val  = float(hist["Close"].iloc[-1])
                    prev = float(hist["Close"].iloc[-2]) if len(hist) >= 2 else val
                    chg  = round(val - prev, 4)
                    pct_v = round((chg / prev) * 100, 2) if prev != 0 else 0
                    return key, {"value": round(val, 4), "change": chg, "change_pct": pct_v}
            except Exception:
                pass
            return key, None
        with ThreadPoolExecutor(max_workers=4) as ex:
            for key, val in ex.map(_fetch_one, missing.items()):
                if val is not None:
                    results[key] = val

    return results


def _get_market_fresh() -> dict:
    sym_to_key = {v: k for k, v in _MARKET_SYMS.items()}
    return _bulk_download(sym_to_key)

def get_market() -> dict:
    """Mercados globales: índices, divisas, commodities, crypto. Cacheado 2 min."""
    return _cached("market", _get_market_fresh, ttl=120, ok=bool)


_WORLDMAP_SYMS = {
    "SPY":  "840", "EWC": "124", "EWW": "484", "EWZ": "076",
    "ECH":  "152", "EWU": "826", "EWG": "276", "EWQ": "250",
    "EWI":  "380", "EWP": "724", "EWN": "528", "EWL": "756",
    "EWD":  "752", "EWO": "040", "EWJ": "392", "FXI": "156",
    "EWA":  "036", "INDA":"356", "EWY": "410", "EWT": "158",
    "EWH":  "344", "EWS": "702", "EZA": "710", "KSA": "682",
    "TUR":  "792", "EPOL":"616",
}

def _get_worldmap_fresh() -> dict:
    sym_to_key = _WORLDMAP_SYMS
    raw = _bulk_download(sym_to_key)
    # _bulk_download retorna {key: {...}} donde key es el valor del mapa (country_id)
    return raw

def get_worldmap() -> dict:
    """ETFs de países para el mapa mundial de desempeño. Cacheado 5 min."""
    return _cached("worldmap", _get_worldmap_fresh, ttl=300, ok=bool)


# ─── v2: panorama de mercados y mapa mundial ────────────────────────────────
#
# Se escribe al lado del legado, no encima: ``get_market`` y ``_bulk_download`` siguen igual porque
# los goldens del backend viejo los prueban y ``domain/macro.py`` (B2b) los consume.
#
# Dos defectos del legado que aquí quedan corregidos:
#
# * ``^MXX`` es el IPC y cotiza en PESOS. El backend viejo lo publicaba en dólares porque deducía la
#   moneda del sufijo del símbolo, y el IPC no tiene sufijo ``.MX``.
# * El DXY sale de Yahoo (``DX-Y.NYB``), no de Stooq. El CSV de Stooq falla siempre desde aquí y el
#   set base de fixtures lo tiene grabado como fallo; pedirlo otra vez solo gasta tiempo.

OVERVIEW_GROUPS = (
    ("mx", "México", (("^MXX", "S&P/BMV IPC", "MXN"),)),
    (
        "us",
        "Estados Unidos",
        (
            ("^GSPC", "S&P 500", "USD"),
            ("^IXIC", "Nasdaq Compuesto", "USD"),
            ("^DJI", "Dow Jones Industrial", "USD"),
            ("^VIX", "VIX, volatilidad esperada del S&P 500", None),
        ),
    ),
    (
        "global",
        "Resto del mundo",
        (
            ("^N225", "Nikkei 225", "JPY"),
            ("^FTSE", "FTSE 100", "GBP"),
            ("^GDAXI", "DAX", "EUR"),
            ("^FCHI", "CAC 40", "EUR"),
            ("^HSI", "Hang Seng", "HKD"),
        ),
    ),
    (
        "fx",
        "Divisas",
        (
            ("USDMXN=X", "Dólar frente al peso", "MXN"),
            ("EURMXN=X", "Euro frente al peso", "MXN"),
            ("EURUSD=X", "Euro frente al dólar", "USD"),
            ("GBPUSD=X", "Libra frente al dólar", "USD"),
            ("USDJPY=X", "Dólar frente al yen", "JPY"),
            ("DX-Y.NYB", "Índice del dólar (DXY)", None),
        ),
    ),
    (
        "commodities",
        "Materias primas",
        (
            ("CL=F", "Petróleo WTI", "USD"),
            ("BZ=F", "Petróleo Brent", "USD"),
            ("GC=F", "Oro", "USD"),
            ("SI=F", "Plata", "USD"),
            ("HG=F", "Cobre", "USD"),
            ("NG=F", "Gas natural", "USD"),
        ),
    ),
    ("crypto", "Cripto", (("BTC-USD", "Bitcoin", "USD"), ("ETH-USD", "Ether", "USD"))),
)
"""Grupos de ``/v2/markets/overview``: cada símbolo aparece en UNO solo. El id y el orden son los
que ve la UI; la moneda es dato curado (``None`` = índice sin moneda, como el VIX o el DXY)."""

WORLD_COUNTRIES = {
    "840": "Estados Unidos", "124": "Canadá", "484": "México", "076": "Brasil",
    "152": "Chile", "826": "Reino Unido", "276": "Alemania", "250": "Francia",
    "380": "Italia", "724": "España", "528": "Países Bajos", "756": "Suiza",
    "752": "Suecia", "040": "Austria", "392": "Japón", "156": "China",
    "036": "Australia", "356": "India", "410": "Corea del Sur", "158": "Taiwán",
    "344": "Hong Kong", "702": "Singapur", "710": "Sudáfrica", "682": "Arabia Saudita",
    "792": "Turquía", "616": "Polonia",
}
"""ISO 3166-1 numérico a nombre en español, para el mapa mundial."""

WORLD_METHOD = (
    "Variación del ETF de cada país cotizado en dólares (iShares, salvo Estados Unidos con SPY), "
    "así que incluye el movimiento de la moneda local frente al dólar."
)


def _last_change(point: dict) -> dict | None:
    """``{"price", "change", "changePct", "asOf"}`` de una serie de cierres. ``changePct`` es FRACCIÓN."""
    closes = point.get("closes") or []
    dates = point.get("dates") or []
    if not closes:
        return None
    price = closes[-1]
    previous = closes[-2] if len(closes) >= 2 else None
    change = price - previous if previous is not None else None
    change_pct = (change / previous) if (change is not None and previous) else None
    return {"price": price, "change": change, "changePct": change_pct, "asOf": dates[-1] if dates else None}


def overview_data() -> tuple[list[dict], str | None, list[str]]:
    """``(grupos, fecha del dato más nuevo, avisos)`` de ``/v2/markets/overview``.

    Una sola llamada en lote a Yahoo para los treinta y tantos símbolos: es la misma petición que
    hace el legado, así que no gasta cuota extra ni pide nada dos veces.
    """
    from kaizen_api.providers.yahoo import prices

    quotes = prices.download_closes(list(_MARKET_SYMS.values()), period="5d")
    groups: list[dict] = []
    as_of: str | None = None
    missing: list[str] = []
    for group_id, label, members in OVERVIEW_GROUPS:
        items = []
        for symbol, item_label, currency in members:
            point = _last_change(quotes.get(symbol) or {})
            if point is None:
                missing.append(symbol)
                items.append({
                    "symbol": symbol, "label": item_label, "price": None, "change": None,
                    "changePct": None, "currency": currency, "asOf": None,
                })
                continue
            if point["asOf"] and (as_of is None or point["asOf"] > as_of):
                as_of = point["asOf"]
            items.append({
                "symbol": symbol, "label": item_label, "price": round(point["price"], 4),
                "change": round(point["change"], 4) if point["change"] is not None else None,
                "changePct": point["changePct"], "currency": currency, "asOf": point["asOf"],
            })
        groups.append({"id": group_id, "label": label, "items": items})
    notes: list[str] = []
    if missing:
        notes.append("Sin dato de " + ", ".join(missing) + " en esta corrida; se muestran sin valor.")
    return groups, as_of, notes


BASKET_STALE_DAYS = 4
"""Días naturales que puede tener la canasta antes de marcarse vieja (cubre un puente largo)."""


def basket_is_stale(as_of: str | None, now=None) -> bool:
    """¿La canasta viene atrasada? Regla por días naturales, porque mezcla bolsas de varios países.

    No se mide contra el calendario de la BMV ni el de la NYSE: la canasta trae Tokio, Londres,
    Fráncfort y cripto, que abren en días distintos. Devolver siempre ``False`` sería afirmar
    frescura sin haberla comprobado.
    """
    import datetime as _dt

    if not as_of:
        return True
    today = (now or _dt.datetime.now(_dt.UTC)).astimezone(_dt.UTC).date()
    return (today - _dt.date.fromisoformat(str(as_of)[:10])).days > BASKET_STALE_DAYS


def world_data() -> tuple[list[dict], str | None, list[str]]:
    """``(renglones por país, fecha del dato más nuevo, avisos)`` de ``/v2/markets/world``."""
    from kaizen_api.providers.yahoo import prices

    quotes = prices.download_closes(list(_WORLDMAP_SYMS.keys()), period="5d")
    items: list[dict] = []
    as_of: str | None = None
    missing: list[str] = []
    for symbol, country in _WORLDMAP_SYMS.items():
        point = _last_change(quotes.get(symbol) or {})
        if point is None:
            missing.append(symbol)
            continue
        if point["asOf"] and (as_of is None or point["asOf"] > as_of):
            as_of = point["asOf"]
        items.append({
            "country": country,
            "symbol": symbol,
            "label": WORLD_COUNTRIES.get(country, country),
            "changePct": point["changePct"],
            "currency": "USD",
            "asOf": point["asOf"],
        })
    notes: list[str] = []
    if missing:
        notes.append("Sin dato de " + ", ".join(missing) + " en esta corrida; esos países no salen en la lista.")
    return items, as_of, notes
