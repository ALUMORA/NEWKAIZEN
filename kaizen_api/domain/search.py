"""Búsqueda de símbolos para ``/v2/search`` (stream B2a).

Fuentes, en este orden de preferencia:

1. ``kaizen_api/data/symbols_mx.json``: lista curada de BMV y SIC con alias en español. **No
   necesita red**: se lee de disco, así que buscar "walmart" o "bimbo" funciona aunque no haya
   internet ni token de nada. Es la parte que ningún proveedor gringo resuelve bien, porque nadie
   indexa "bodega aurrera" contra ``WALMEX.MX``.
2. ``INSTRUMENTOS_CONOCIDOS``: un puñado de ETF, índices, cripto y materias primas de EE. UU. que el
   índice de la SEC no distingue (ahí todo parece acción) o que ni siquiera aparecen.
3. ``company_tickers.json`` de la SEC: el índice oficial de emisoras que reportan en EE. UU., con
   su nombre. Se baja una vez y se guarda 24 horas en memoria. Si no se puede bajar, la búsqueda
   sigue trabajando solo con lo local y lo dice en ``meta.notes``.

El texto se compara sin acentos, sin mayúsculas y sin signos, porque nadie escribe "Wal-Mart de
México, S.A.B. de C.V." en una caja de búsqueda.
"""

from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import requests

from kaizen_api.cache import _cached, register_reset
from kaizen_api.domain import _log

DATA_FILE = Path(__file__).resolve().parent.parent / "data" / "symbols_mx.json"

SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
SEC_TTL = 86400
"""El índice de la SEC cambia poco; una vez al día es de sobra."""

_SEC_SESSION = requests.Session()
_SEC_SESSION.headers.update({
    # La SEC pide un User-Agent descriptivo con contacto (su política de acceso justo). Es un buzón
    # del proyecto, nunca el correo de quien usa la app.
    "User-Agent": "KAIZEN Investment Group research@kaizeninvestments.app",
    "Accept-Encoding": "gzip, deflate",
})

_PUNCT = re.compile(r"[^a-z0-9 ]+")
_SPACES = re.compile(r"\s+")


@dataclass(frozen=True)
class SymbolEntry:
    """Un candidato de búsqueda, con los mismos campos que ``schemas.SearchResult``."""

    symbol: str
    name: str
    exchange: str | None
    type: str
    currency: str | None
    aliases: tuple[str, ...]
    origin: str

    def as_contract(self) -> dict:
        return {
            "symbol": self.symbol,
            "name": self.name,
            "exchange": self.exchange,
            "type": self.type,
            "currency": self.currency,
            "aliases": list(self.aliases),
        }


INSTRUMENTOS_CONOCIDOS = (
    ("^GSPC", "S&P 500", "index", "USD", ("sp500", "s and p 500", "estados unidos", "indice gringo")),
    ("^IXIC", "Nasdaq Compuesto", "index", "USD", ("nasdaq", "tecnologicas")),
    ("^DJI", "Dow Jones Industrial", "index", "USD", ("dow jones", "dow")),
    ("^VIX", "VIX, volatilidad esperada del S&P 500", "index", None, ("vix", "volatilidad", "miedo")),
    ("SPY", "SPDR S&P 500 ETF Trust", "etf", "USD", ("spy", "etf del sp500", "sp500 etf")),
    ("VOO", "Vanguard S&P 500 ETF", "etf", "USD", ("voo", "vanguard sp500")),
    ("IVV", "iShares Core S&P 500 ETF", "etf", "USD", ("ivv", "ishares sp500")),
    ("QQQ", "Invesco QQQ Trust", "etf", "USD", ("qqq", "nasdaq etf", "etf del nasdaq")),
    ("VTI", "Vanguard Total Stock Market ETF", "etf", "USD", ("vti", "mercado total")),
    ("DIA", "SPDR Dow Jones Industrial Average ETF", "etf", "USD", ("dia", "etf del dow")),
    ("IWM", "iShares Russell 2000 ETF", "etf", "USD", ("iwm", "russell 2000", "empresas chicas")),
    ("AGG", "iShares Core U.S. Aggregate Bond ETF", "etf", "USD", ("agg", "bonos", "renta fija")),
    ("TLT", "iShares 20+ Year Treasury Bond ETF", "etf", "USD", ("tlt", "bonos largos", "tesoro")),
    ("GLD", "SPDR Gold Shares", "etf", "USD", ("gld", "oro etf", "etf de oro")),
    ("SLV", "iShares Silver Trust", "etf", "USD", ("slv", "plata etf")),
    ("EEM", "iShares MSCI Emerging Markets ETF", "etf", "USD", ("eem", "emergentes")),
    ("EWW", "iShares MSCI Mexico ETF", "etf", "USD", ("eww", "mexico etf", "etf de mexico")),
    ("VEA", "Vanguard FTSE Developed Markets ETF", "etf", "USD", ("vea", "desarrollados")),
    ("VWO", "Vanguard FTSE Emerging Markets ETF", "etf", "USD", ("vwo", "emergentes vanguard")),
    ("SCHD", "Schwab U.S. Dividend Equity ETF", "etf", "USD", ("schd", "dividendos")),
    ("BTC-USD", "Bitcoin frente al dólar", "crypto", "USD", ("bitcoin", "btc", "cripto")),
    ("ETH-USD", "Ether frente al dólar", "crypto", "USD", ("ethereum", "ether", "eth")),
    ("GC=F", "Futuro del oro", "commodity", "USD", ("oro", "gold", "futuro del oro")),
    ("SI=F", "Futuro de la plata", "commodity", "USD", ("plata", "silver")),
    ("CL=F", "Futuro del petróleo WTI", "commodity", "USD", ("petroleo", "wti", "crudo")),
)
"""Instrumentos de EE. UU. cuyo tipo real no sale del índice de la SEC (ahí todo parece acción)."""


def fold(text: str) -> str:
    """Texto comparable: sin acentos, en minúsculas, sin signos y con un solo espacio entre palabras."""
    plain = unicodedata.normalize("NFD", str(text or "").lower())
    plain = "".join(ch for ch in plain if unicodedata.category(ch) != "Mn")
    return _SPACES.sub(" ", _PUNCT.sub(" ", plain)).strip()


@lru_cache(maxsize=1)
def _curated() -> tuple[dict, tuple[SymbolEntry, ...]]:
    """Lista curada de México: ``(encabezado del archivo, entradas)``."""
    with DATA_FILE.open(encoding="utf-8") as handle:
        raw = json.load(handle)
    entries = tuple(
        SymbolEntry(
            symbol=row["symbol"],
            name=row["name"],
            exchange=row.get("exchange"),
            type=row["type"],
            currency=row.get("currency"),
            aliases=tuple(row.get("aliases") or ()),
            origin="curated",
        )
        for row in raw["symbols"]
    )
    return raw, entries


def curated_entries() -> tuple[SymbolEntry, ...]:
    return _curated()[1]


def curated_as_of() -> str:
    return _curated()[0]["updatedAt"]


@lru_cache(maxsize=1)
def _known_us() -> tuple[SymbolEntry, ...]:
    return tuple(
        SymbolEntry(symbol=s, name=n, exchange=None, type=t, currency=c, aliases=a, origin="curated")
        for s, n, t, c, a in INSTRUMENTOS_CONOCIDOS
    )


def _fetch_sec_index() -> list[SymbolEntry]:
    """Índice de emisoras de la SEC. Lista vacía si no se pudo bajar (nunca inventa nombres)."""
    try:
        response = _SEC_SESSION.get(SEC_TICKERS_URL, timeout=10)
        raw = response.json()
    except Exception as exc:
        _log(f"search: no se pudo leer el índice de la SEC ({exc})")
        return []
    if not isinstance(raw, dict):
        return []
    out: list[SymbolEntry] = []
    for row in raw.values():
        ticker = str((row or {}).get("ticker") or "").strip().upper()
        title = str((row or {}).get("title") or "").strip()
        if not ticker or not title:
            continue
        out.append(
            SymbolEntry(
                symbol=ticker,
                name=title,
                exchange=None,
                type="equity",
                currency="USD",
                aliases=(),
                origin="sec",
            )
        )
    return out


def sec_entries() -> list[SymbolEntry]:
    """Índice de la SEC, cacheado 24 horas en memoria."""
    return _cached("v2:search:sec", _fetch_sec_index, ttl=SEC_TTL, ok=bool)


@register_reset
def _reset_search_caches() -> None:
    """``reset_state()`` también olvida los archivos leídos, para que las pruebas partan de cero."""
    _curated.cache_clear()
    _known_us.cache_clear()


def _base_symbol(symbol: str) -> str:
    return fold(symbol.split(".")[0])


def _score(entry: SymbolEntry, query: str) -> int | None:
    """Qué tan bien cae una entrada en la búsqueda. Menor es mejor; ``None`` es que no cae."""
    symbol = fold(entry.symbol)
    base = _base_symbol(entry.symbol)
    haystack = [fold(entry.name), *(fold(a) for a in entry.aliases)]
    if query in (symbol, base):
        return 0
    if query in haystack:
        return 1
    if symbol.startswith(query) or base.startswith(query):
        return 2
    if any(text.startswith(query) for text in haystack):
        return 3
    if any(f" {query}" in f" {text}" for text in haystack):
        return 4
    return None


def search(query: str, limit: int = 10) -> tuple[list[dict], list[str], str]:
    """``(resultados, avisos, fuentes)`` para ``/v2/search``.

    Primero la lista curada de México y los instrumentos conocidos, después el índice de la SEC.
    Empata por puntaje: gana lo curado, y entre iguales el nombre más corto, que suele ser la
    emisora principal y no una subsidiaria.
    """
    needle = fold(query)
    notes: list[str] = []
    if not needle:
        return [], ["La búsqueda quedó vacía después de quitar signos y acentos."], "curated"

    local = [*curated_entries(), *_known_us()]
    index = sec_entries()
    sources = ["curated"]
    if index:
        sources.append("sec")
    else:
        notes.append("No pudimos leer el índice de la SEC, así que solo se buscó en la lista de México.")

    # Lo local manda sobre la SEC aunque no haya caído en la búsqueda: el índice de la SEC no
    # distingue un ETF de una acción, así que un símbolo que ya describimos aquí no se duplica allá.
    local_symbols = {entry.symbol for entry in local}
    seen: set[str] = set()
    scored: list[tuple[int, int, int, str, SymbolEntry]] = []
    for rank, entries in ((0, local), (1, index)):
        for entry in entries:
            if entry.symbol in seen or (rank == 1 and entry.symbol in local_symbols):
                continue
            score = _score(entry, needle)
            if score is None:
                continue
            seen.add(entry.symbol)
            scored.append((score, rank, len(entry.name), entry.symbol, entry))

    scored.sort(key=lambda row: row[:4])
    return [entry.as_contract() for *_, entry in scored[:limit]], notes, ",".join(sources)
