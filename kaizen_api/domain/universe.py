"""Universos y listas de candidatos: Fórmula Mágica, FIBRAs y ETF sectoriales.

La primera mitad es del legado y se movió sin cambios desde backend.py (fase S1): los cuerpos son
idénticos y los goldens de tests/goldens_legacy lo prueban. ``SECTOR_ETF`` lo lee B3b para el
momento 12-1 por sector, así que su forma no cambia.

La segunda mitad es del v2 (stream B3c): los universos curados que usan ``/v2/screeners/factors``
y ``/v2/screeners/magic`` viven en ``kaizen_api/data/universe_*.json`` y las FIBRAs en
``kaizen_api/data/fibras_mx.json``. Son datos, no código: nombre, sector canónico (el de Yahoo,
para poder agrupar) y, en las FIBRAs, el tipo de activo. El sector que ve la persona se traduce
con ``SECTOR_ES``.
"""

from __future__ import annotations

import datetime as _dt
import json
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import yfinance as yf

from kaizen_api.domain import _log, safe
from kaizen_api.providers.yahoo.session import yft

SECTOR_ETF = {
    "Technology": "XLK", "Healthcare": "XLV", "Financial Services": "XLF",
    "Financials": "XLF", "Energy": "XLE", "Consumer Cyclical": "XLY",
    "Consumer Defensive": "XLP", "Industrials": "XLI", "Materials": "XLB",
    "Real Estate": "XLRE", "Utilities": "XLU", "Communication Services": "XLC",
    "Basic Materials": "XLB",
}


MAGIC_UNIVERSE = [
    # Technology
    "AAPL","MSFT","NVDA","GOOGL","META","AVGO","ORCL","ADBE","CRM","AMD",
    "INTC","QCOM","TXN","NOW","NFLX","IBM","ACN","CTSH","FTNT","CDNS",
    # Healthcare
    "LLY","UNH","JNJ","ABBV","MRK","TMO","ABT","BMY","AMGN","GILD",
    "VRTX","ISRG","MCK","CVS","CI",
    # Consumer Cyclical
    "AMZN","TSLA","HD","MCD","SBUX","NKE","BKNG","TJX","ROST","CMG",
    "LOW","F","GM","ORLY","AZO",
    # Consumer Defensive
    "WMT","COST","PG","KO","PEP","PM","TGT","MO","CL","MDLZ",
    # Industrials
    "CAT","DE","HON","RTX","GE","BA","FDX","UPS","UNP","LMT",
    # Energy
    "XOM","CVX","COP","SLB","OXY","MPC","EOG",
    # Materials
    "LIN","APD","NEM","FCX","SHW",
    # Communication Services
    "DIS","CMCSA","EA","FOXA",
]


EXCLUDED_SECTORS = {
    "Financial Services", "Financials", "Utilities",
    "Real Estate",  # REITs tienen estructura diferente
}


FIBRAS_LIST = [
    # FIBRAMQ y Storage cambiaron de símbolo; Terrafina (TERRA13) la absorbió Fibra Prologis
    # y LFPE ya no cotiza en Yahoo, así que se sustituyen por FNOVA y FSHOP.
    "FUNO11.MX", "FIBRAMQ12.MX", "FIBRAPL14.MX", "FNOVA17.MX",
    "FINN13.MX",  "DANHOS13.MX", "FMTY14.MX",    "FHIPO14.MX",
    "STORAGE18.MX", "FSHOP13.MX",
]


# ─── v2 (B3c): universos curados, sectores en español y tipos de FIBRA ───────

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

UNIVERSE_FILES = {"mx": "universe_mx.json", "us": "universe_us.json"}
"""Los universos con lista curada. ``custom`` se arma con los símbolos que manda quien pregunta."""

FIBRAS_FILE = "fibras_mx.json"

SECTOR_ES = {
    "Technology": "Tecnología",
    "Healthcare": "Salud",
    "Financial Services": "Servicios financieros",
    "Financials": "Servicios financieros",
    "Energy": "Energía",
    "Consumer Cyclical": "Consumo discrecional",
    "Consumer Defensive": "Consumo básico",
    "Industrials": "Industriales",
    "Materials": "Materiales",
    "Basic Materials": "Materiales",
    "Real Estate": "Bienes raíces",
    "Utilities": "Servicios públicos",
    "Communication Services": "Comunicaciones",
}
"""Sector de Yahoo a español de México. Lo que no esté aquí se muestra tal cual llegó."""

MAGIC_EXCLUDED_SECTORS = frozenset({"Financial Services", "Financials", "Utilities", "Real Estate"})
"""Greenblatt deja fuera bancos, aseguradoras, servicios públicos y bienes raíces (las FIBRAs).

Su balance no se compara con el de una empresa operativa: en una FIBRA la utilidad de operación
incluye rentas de inmuebles a valor razonable y el capital empleado es casi todo propiedad de
inversión, así que el rendimiento sobre capital no mide lo mismo. Las FIBRAs tienen su propio
screener (``/v2/screeners/fibras``).
"""

FIBRA_TYPES = ("propiedades", "hipotecaria", "energia", "otro")
"""Los valores que acepta ``schemas.FibraRow.type``."""


def sector_label(sector: str | None) -> str | None:
    """Sector como lo lee una persona en español. ``None`` se queda en ``None``."""
    if not sector:
        return None
    return SECTOR_ES.get(sector, sector)


@dataclass(frozen=True)
class Member:
    """Una emisora del universo: símbolo, nombre y sector canónico (el de Yahoo)."""

    symbol: str
    name: str | None = None
    sector: str | None = None
    type: str | None = None
    segment: str | None = None


@dataclass(frozen=True)
class Universe:
    """Un universo curado o armado al vuelo. ``members`` conserva el orden del archivo."""

    id: str
    name: str
    currency: str | None
    members: tuple[Member, ...]
    source: str = "curated"
    as_of: str | None = None
    note: str | None = None

    @property
    def symbols(self) -> list[str]:
        return [m.symbol for m in self.members]

    @property
    def size(self) -> int:
        return len(self.members)

    def member(self, symbol: str) -> Member | None:
        """La emisora con ese símbolo, o ``None``. Los universos son de decenas, no de miles."""
        wanted = symbol.upper()
        for m in self.members:
            if m.symbol.upper() == wanted:
                return m
        return None


def _load(filename: str) -> dict:
    with open(DATA_DIR / filename, encoding="utf-8") as fh:
        return json.load(fh)


@lru_cache(maxsize=4)
def get_universe(universe_id: str) -> Universe:
    """Universo curado (``mx`` o ``us``) leído de ``kaizen_api/data/universe_<id>.json``.

    Un id desconocido levanta ``KeyError``: la ruta ya lo validó con ``Literal`` antes de llegar.
    """
    raw = _load(UNIVERSE_FILES[universe_id])
    members = tuple(
        Member(symbol=m["symbol"].upper(), name=m.get("name"), sector=m.get("sector"))
        for m in raw["members"]
    )
    return Universe(
        id=raw["id"],
        name=raw["name"],
        currency=raw.get("currency"),
        members=members,
        source=raw.get("source", "curated"),
        as_of=raw.get("asOf"),
        note=raw.get("note"),
    )


def custom_universe(symbols: list[str]) -> Universe:
    """Universo armado con los símbolos que mandó quien pregunta: sin nombre ni sector curado."""
    members = tuple(Member(symbol=s.upper()) for s in symbols)
    return Universe(
        id="custom",
        name="Lista propia",
        currency=None,
        members=members,
        source="curated",
        note="Los símbolos los eligió quien hizo la consulta, no hay lista curada detrás.",
    )


@lru_cache(maxsize=1)
def get_fibras_universe() -> Universe:
    """Las FIBRAs curadas de ``kaizen_api/data/fibras_mx.json``, con su tipo de activo."""
    raw = _load(FIBRAS_FILE)
    members = tuple(
        Member(
            symbol=m["symbol"].upper(),
            name=m.get("name"),
            sector="Real Estate",
            type=m.get("type") if m.get("type") in FIBRA_TYPES else "otro",
            segment=m.get("segment"),
        )
        for m in raw["members"]
    )
    return Universe(
        id="fibras-mx",
        name=raw["name"],
        currency=raw.get("currency"),
        members=members,
        source=raw.get("source", "curated"),
        as_of=raw.get("asOf"),
        note=raw.get("note"),
    )


# ─── v2 (B3c): lectura en lote de los datos crudos del universo ──────────────
#
# Las tres pantallas de screener (factores, fórmula mágica y FIBRAs) leen lo mismo de Yahoo para
# una lista de símbolos: el ``info``, los estados financieros y una tanda de cierres ajustados.
# Ese código vive aquí y no en un archivo nuevo de ``domain/screeners/`` porque B3c solo es dueño
# de ``factors.py``, ``magic.py`` y ``fibras.py`` dentro de esa carpeta (ver ``scripts/ownership.json``),
# y las tres tendrían que copiárselo. Todo acceso a Yahoo pasa por la costura congelada ``yft()``
# o por ``yfinance.download``, que es lo que graba y reproduce el replay de las pruebas.

BATCH_WORKERS = 8
"""Hilos para pedir varios símbolos a la vez. Yahoo tolera mal más que esto."""

BATCH_TIMEOUT = 40.0
"""Segundos para toda la tanda. Lo que no llegó se reporta como parcial, no se pierde lo demás."""


@dataclass
class SymbolData:
    """Lo crudo de una emisora: ``info`` de Yahoo y, si se pidieron, sus estados financieros."""

    symbol: str
    info: dict
    income: object | None = None
    balance: object | None = None
    cashflow: object | None = None
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.error is None and bool(self.info)

    @property
    def currency(self) -> str | None:
        cur = self.info.get("currency")
        return str(cur).upper() if cur else None

    @property
    def financial_currency(self) -> str | None:
        """Moneda de los estados financieros. Si Yahoo no la dice, se asume la de cotización."""
        cur = self.info.get("financialCurrency") or self.info.get("currency")
        return str(cur).upper() if cur else None

    @property
    def same_currency(self) -> bool:
        """¿Los estados y la cotización están en la misma moneda? Si no, no se pueden mezclar."""
        return bool(self.currency) and self.currency == self.financial_currency

    @property
    def not_found(self) -> bool:
        """¿Yahoo contestó que no conoce el símbolo? (``info`` vacío, no una caída)."""
        return self.error == EMPTY_INFO

    @property
    def quote_date(self) -> str | None:
        """Fecha (UTC, ``YYYY-MM-DD``) del precio que trae el ``info``, o ``None`` si no la dice."""
        stamp = safe(self.info.get("regularMarketTime")) if self.info else None
        if stamp is None or stamp <= 0:
            return None
        try:
            return _dt.datetime.fromtimestamp(stamp, tz=_dt.UTC).date().isoformat()
        except (OverflowError, OSError, ValueError):
            return None


EMPTY_INFO = "Yahoo devolvió un info vacío"
"""El error de una emisora cuyo ``info`` llegó casi vacío. Así contesta Yahoo a un símbolo que no
existe: sin excepción y con uno o dos campos. Una caída del proveedor, en cambio, sí levanta."""


def _read_info(symbol: str) -> dict:
    """``Ticker.info`` con las guardas del legado: Yahoo a veces devuelve un dict casi vacío."""
    try:
        raw = yft(symbol).info
    except Exception as exc:
        raise RuntimeError(str(exc)[:200]) from exc
    if not raw or not isinstance(raw, dict) or len(raw) <= 5:
        raise RuntimeError(EMPTY_INFO)
    return raw


def _read_statements(symbol: str, want: tuple[str, ...]) -> dict:
    """Estados financieros anuales. Lo que falle queda en ``None``, no tumba a la emisora."""
    out: dict[str, object | None] = {}
    t = yft(symbol)
    for attr in want:
        try:
            df = getattr(t, attr)
            out[attr] = df if (df is not None and not df.empty) else None
        except Exception as exc:
            _log(f"screeners: {symbol}.{attr} falló ({str(exc)[:120]})")
            out[attr] = None
    return out


def _fetch_one(symbol: str, statements: tuple[str, ...]) -> SymbolData:
    try:
        info = _read_info(symbol)
    except Exception as exc:
        return SymbolData(symbol=symbol, info={}, error=str(exc)[:200])
    data = SymbolData(symbol=symbol, info=info)
    if statements:
        got = _read_statements(symbol, statements)
        data.income = got.get("income_stmt")
        data.balance = got.get("balance_sheet")
        data.cashflow = got.get("cashflow")
    return data


def fetch_symbols(
    symbols: list[str],
    *,
    statements: tuple[str, ...] = (),
    workers: int = BATCH_WORKERS,
    timeout: float = BATCH_TIMEOUT,
) -> tuple[dict[str, SymbolData], list[str]]:
    """Pide ``info`` (y los estados que se pidan) de varios símbolos en paralelo.

    Devuelve ``({símbolo: SymbolData}, [símbolos que no llegaron a tiempo])``. Recorre los futuros
    en el orden en que se enviaron, así que el resultado no depende de cómo los acomode el sistema
    operativo: dos corridas con los mismos datos dan lo mismo.
    """
    out: dict[str, SymbolData] = {}
    pending: list[str] = []
    if not symbols:
        return out, pending
    pool = ThreadPoolExecutor(max_workers=max(1, min(workers, len(symbols))))
    futures = [(sym, pool.submit(_fetch_one, sym, statements)) for sym in symbols]
    deadline = time.monotonic() + timeout
    try:
        for sym, fut in futures:
            left = max(0.0, deadline - time.monotonic())
            try:
                out[sym] = fut.result(timeout=left)
            except Exception as exc:
                pending.append(sym)
                _log(f"screeners: {sym} no llegó a tiempo ({type(exc).__name__})")
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    return out, pending


def fetch_closes(symbols: list[str], period: str = "2y", interval: str = "1wk") -> dict[str, list[tuple[str, float]]]:
    """Cierres AJUSTADOS de varios símbolos en UNA sola llamada (``yfinance.download``).

    Devuelve ``{símbolo: [(YYYY-MM-DD, cierre), ...]}`` en orden cronológico y sin huecos. Una
    sola petición en vez de una por símbolo: es lo que Yahoo tolera y lo que el replay graba como
    una sola llamada. Si la descarga falla, devuelve ``{}`` y quien llama deja esas métricas en
    ``None`` en vez de inventarlas.
    """
    if not symbols:
        return {}
    try:
        raw = yf.download(
            list(symbols), period=period, interval=interval,
            progress=False, auto_adjust=True,
        )
    except Exception as exc:
        _log(f"screeners: la descarga en lote falló ({str(exc)[:160]})")
        return {}
    if raw is None or raw.empty:
        _log("screeners: la descarga en lote vino vacía")
        return {}
    try:
        levels = raw.columns.get_level_values(0) if hasattr(raw.columns, "levels") else raw.columns
        closes = raw["Close"] if "Close" in list(levels) else raw
    except Exception:
        return {}
    out: dict[str, list[tuple[str, float]]] = {}
    for sym in symbols:
        try:
            col = closes[sym] if sym in getattr(closes, "columns", []) else None
            if col is None and len(symbols) == 1:
                col = closes.iloc[:, 0]
            if col is None:
                continue
            col = col.dropna()
            points = [
                (idx.date().isoformat() if hasattr(idx, "date") else str(idx)[:10], float(val))
                for idx, val in col.items()
                if safe(val) is not None
            ]
            if points:
                out[sym] = points
        except Exception:
            continue
    return out


def row_pick(frame, labels: tuple[str, ...], column: int = 0) -> tuple[float | None, str | None]:
    """``(valor, renglón)`` del primer renglón de ``labels`` que exista y traiga número.

    Un renglón que existe pero viene en NaN no cuenta: se sigue con el siguiente. yfinance deja
    renglones en NaN cuando el emisor no reporta ese concepto en ese año, y quedarse con el primero
    tiraba un dato que sí estaba en el renglón de al lado.
    """
    if frame is None:
        return None, None
    try:
        if column >= len(frame.columns):
            return None, None
        for label in labels:
            if label in frame.index:
                value = safe(frame.loc[label].iloc[column])
                if value is not None:
                    return value, label
    except Exception:
        return None, None
    return None, None


def row_value(frame, labels: tuple[str, ...], column: int = 0) -> float | None:
    """Valor del primer renglón de ``labels`` que exista y traiga número, en la columna pedida."""
    return row_pick(frame, labels, column)[0]


def column_date(frame, column: int = 0) -> str | None:
    """Fecha de cierre del periodo de esa columna (``YYYY-MM-DD``), o ``None``."""
    if frame is None:
        return None
    try:
        if column >= len(frame.columns):
            return None
        col = frame.columns[column]
        if hasattr(col, "date"):
            return col.date().isoformat()
        text = str(col)[:10]
        return text if len(text) == 10 and text[4] == "-" else None
    except Exception:
        return None
