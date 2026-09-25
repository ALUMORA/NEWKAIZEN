"""Históricos de precios: el legado (``get_chart``, ``get_returns``, ``_fetch_hist``) y la costura v2.

La costura CONGELADA es ``get_series(symbol, range, interval, ccy) -> PriceSeries``. B2 la
implementa y todo lo que necesite precios (beta, momentum, panel, valuación) la consume en vez de
llamar a yfinance directo. Hasta entonces lanza ``NotImplementedError``.

Contrato de ``get_series``:

* Cierres AJUSTADOS por splits y dividendos (rendimiento total), en orden cronológico, una
  observación por fecha de mercado (``YYYY-MM-DD``, sin hora ni zona).
* ``range``: ``1mo 3mo 6mo 1y 2y 5y 10y max``; ``interval``: ``1d 1wk 1mo``.
* ``ccy``: ``native`` (moneda de cotización), ``MXN`` o ``USD``. La conversión usa el tipo de
  cambio de LA MISMA fecha, con relleno hacia adelante de a lo más 3 días en huecos del FX; cada
  relleno se anota en ``notes``. Sin FX para una fecha, esa observación se descarta y se anota.
* Nunca inventa datos: sin histórico lanza ``ApiError`` (``NOT_FOUND`` o ``UPSTREAM_UNAVAILABLE``).

Legado: ``_fetch_hist`` y ``get_chart`` quedan idénticos a backend.py; los goldens lo prueban.
"""

import time
from dataclasses import dataclass, field

import yfinance as yf

from kaizen_api.cache import _cached
from kaizen_api.domain import fx as fx_domain
from kaizen_api.errors import ApiError, invalid_param
from kaizen_api.providers.yahoo import prices
from kaizen_api.providers.yahoo.session import yft

RANGES = ("1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "max")
INTERVALS = ("1d", "1wk", "1mo")
CURRENCIES = ("native", "MXN", "USD")

CURRENCY_BY_SUFFIX = (
    (".MX", "MXN"),
    ("-USD", "USD"),
    ("=F", "USD"),
)
"""Moneda de cotización cuando Yahoo no la trae: sufijos que sí son inequívocos."""

CURRENCY_BY_SYMBOL = {"^MXX": "MXN", "^GSPC": "USD", "^IXIC": "USD", "^DJI": "USD"}
"""Índices que se usan de referencia y cuya moneda se conoce de fijo."""


@dataclass(frozen=True)
class PriceSeries:
    """Serie de cierres ajustados lista para ``HistoryResponse`` (mismos nombres de campo)."""

    symbol: str
    currency: str
    interval: str
    dates: list[str]
    close: list[float]
    source: str
    as_of: str | None = None
    fx_pair: str | None = None
    fx_source: str | None = None
    notes: list[str] = field(default_factory=list)
    adjusted: bool = True

    def __post_init__(self) -> None:
        if len(self.dates) != len(self.close):
            raise ValueError("dates y close deben tener la misma longitud")


def native_currency(symbol: str) -> tuple[str, bool]:
    """``(moneda de cotización, se infirió)`` de un símbolo.

    Lo normal es que Yahoo la diga en ``info.currency``; ahí es donde se arregla el defecto del
    backend viejo, que etiquetaba ``^MXX`` en dólares por adivinar la moneda a partir del sufijo.
    Si Yahoo no la trae se cae a sufijos inequívocos y, en último caso, a dólares avisando que fue
    una inferencia, que es lo que la UI tiene que poder decir.
    """
    up = symbol.upper()
    reported = (prices.fetch_info(up).get("currency") or "").strip().upper()
    if len(reported) == 3 and reported.isalpha():
        return reported, False
    if up in CURRENCY_BY_SYMBOL:
        return CURRENCY_BY_SYMBOL[up], False
    for suffix, currency in CURRENCY_BY_SUFFIX:
        if up.endswith(suffix):
            return currency, True
    return "USD", True


EXCHANGE_BY_SUFFIX = ((".MX", "bmv"),)
"""Bolsa de la que sale el calendario de un símbolo, cuando el sufijo la dice sin ambigüedad."""

EXCHANGE_BY_SYMBOL = {"^MXX": "bmv", "^GSPC": "nyse", "^IXIC": "nyse", "^DJI": "nyse"}

GENERIC_STALE_DAYS = {"1d": 4, "1wk": 11, "1mo": 45}
"""Días naturales que puede tener el punto más nuevo antes de marcarse viejo, sin calendario."""


def exchange_for(symbol: str) -> str | None:
    """Bolsa cuyo calendario aplica al símbolo, o ``None`` si no es una de las dos que publicamos.

    Solo se afirma lo que se sabe: tenemos calendario de la BMV y de la NYSE. Un índice de Tokio o
    una cripto no se miden contra ninguno de los dos, así que caen a la regla por días naturales.
    """
    up = symbol.upper()
    if up in EXCHANGE_BY_SYMBOL:
        return EXCHANGE_BY_SYMBOL[up]
    for suffix, exchange in EXCHANGE_BY_SUFFIX:
        if up.endswith(suffix):
            return exchange
    if up.endswith("-USD") or up.endswith("=X") or up.endswith("=F") or up.startswith("^"):
        return None
    if up.isalpha():
        return "nyse"
    # Las clases de acción de EE. UU. llevan guion en Yahoo (BRK-B, BF-B). Sin esto caían a la
    # tolerancia genérica de días naturales y una serie a la que le faltaban jornadas salía fresca.
    # El punto NO se trata igual: ahí un sufijo es la plaza (.L, .JO, .TO), no la clase.
    head, sep, tail = up.partition("-")
    if sep and head.isalpha() and tail.isalpha() and len(tail) <= 2:
        return "nyse"
    return None


def is_stale(symbol: str, last_date: str | None, interval: str = "1d", now=None) -> bool:
    """¿El punto más nuevo de la serie viene atrasado?

    Con calendario de la bolsa (BMV o NYSE) y barras diarias, la serie está vieja si le falta una
    jornada que ya cerró. Sin calendario, o con barras semanales o mensuales, se usa una tolerancia
    en días naturales. Devolver siempre ``False`` sería el valor fijo silencioso que el contrato
    prohíbe: ``stale`` dice que el dato es más viejo de lo esperado para su clase.
    """
    import datetime as _dt

    from kaizen_api.domain import market_calendar

    if not last_date:
        return False
    newest = _dt.date.fromisoformat(str(last_date)[:10])
    exchange = exchange_for(symbol) if interval == "1d" else None
    if exchange is not None:
        closed = market_calendar.last_completed_session(exchange, now)
        return closed is not None and newest < closed
    today = (now or _dt.datetime.now(_dt.UTC)).astimezone(_dt.UTC).date()
    return (today - newest).days > GENERIC_STALE_DAYS.get(interval, 4)


def _only_trading_sessions(
    symbol: str, dates: list[str], closes: list[float], notes: list[str]
) -> tuple[list[str], list[float], list[str]]:
    """Quita las barras diarias fechadas en días en que esa bolsa no operó.

    Yahoo arrastra el cierre anterior a algunos días inhábiles: en la serie de un año de
    ``NAFTRAC.MX`` el 16 de septiembre (Independencia) trae el mismo cierre, bit a bit, que el 15.
    Publicarlo como observación real mete rendimientos diarios de 0.00% que nadie operó, y eso baja
    la volatilidad medida y sesga beta y Sharpe. El contrato pide fechas REALES: un cierre repetido
    en día cerrado es relleno, solo que hecho río arriba.

    Solo se descarta lo que se puede afirmar: si no tenemos calendario de esa bolsa, o si la fecha
    cae fuera de los años que cubre el archivo, la barra se queda y se anota el límite.
    """
    import datetime as _dt

    from kaizen_api.domain import market_calendar

    exchange = exchange_for(symbol)
    if exchange is None:
        return dates, closes, notes
    calendar = market_calendar.load_calendar(exchange)
    years = set(calendar["years"])
    kept_dates: list[str] = []
    kept_closes: list[float] = []
    removed: list[str] = []
    for date, value in zip(dates, closes, strict=True):
        day = _dt.date.fromisoformat(date)
        if day.year in years and market_calendar.session(calendar, day) is None:
            removed.append(date)
            continue
        kept_dates.append(date)
        kept_closes.append(value)
    if removed:
        notes.append(
            f"Se descartaron {len(removed)} barras fechadas en días en que {calendar['label']} no "
            "operó; el proveedor las trae con el cierre anterior repetido y no son observaciones reales."
        )
    if kept_dates and _dt.date.fromisoformat(kept_dates[0]).year < min(years):
        notes.append(
            f"El calendario de {calendar['label']} cubre de {min(years)} a {max(years)}: antes de "
            f"{min(years)} solo se verificaron fines de semana, no días inhábiles."
        )
    return kept_dates, kept_closes, notes


def get_series(symbol: str, range: str = "1y", interval: str = "1d", ccy: str = "native") -> PriceSeries:
    """Costura CONGELADA de históricos v2 (ver el docstring del módulo). La implementa B2."""
    sym = str(symbol).upper()
    if range not in RANGES:
        raise invalid_param("query.range", "literal_error", f"El periodo tiene que ser uno de: {', '.join(RANGES)}.")
    if interval not in INTERVALS:
        raise invalid_param(
            "query.interval", "literal_error", f"El intervalo tiene que ser uno de: {', '.join(INTERVALS)}."
        )
    if ccy not in CURRENCIES:
        raise invalid_param("query.ccy", "literal_error", f"La moneda tiene que ser una de: {', '.join(CURRENCIES)}.")

    dates, closes = prices.fetch_series(sym, range, interval)
    if not dates:
        raise ApiError(404, "NOT_FOUND", f"No encontramos histórico de {sym}. Revisa el símbolo.")

    currency, inferred = native_currency(sym)
    notes: list[str] = []
    if inferred:
        notes.append(f"Yahoo no reporta la moneda de {sym}; se tomó {currency} por el tipo de símbolo.")

    # Solo las plazas con unidad menor (Londres, Johannesburgo) obligan a mirar el divisor; para
    # todo lo demás ni siquiera se consulta el ``info``, que es el camino de esta app.
    divisor = prices.minor_unit_divisor(sym) if currency in prices.MAJOR_WITH_MINOR else 1.0
    if divisor != 1.0:
        # Los cierres vienen en la misma unidad menor que el precio puntual (peniques, centavos).
        closes = [value / divisor for value in closes]
        notes.append(
            f"Yahoo publica {sym} en unidad menor; los cierres se dividieron entre "
            f"{divisor:g} para dejarlos en {currency}."
        )

    if interval == "1d":
        dates, closes, notes = _only_trading_sessions(sym, dates, closes, notes)
        if not dates:
            raise ApiError(404, "NOT_FOUND", f"No encontramos histórico de {sym}. Revisa el símbolo.")

    target = currency if ccy == "native" else ccy
    if target == currency:
        return PriceSeries(
            symbol=sym,
            currency=currency,
            interval=interval,
            dates=dates,
            close=closes,
            source="yahoo",
            as_of=dates[-1],
            notes=notes,
        )

    fx_domain.check_pair(currency, target)
    fx = fx_domain.series_for(range, interval)
    rates = fx.as_map()
    conv_dates: list[str] = []
    conv_closes: list[float] = []
    filled = 0
    for date, value in zip(dates, closes, strict=True):
        rate, back = fx_domain.rate_on(rates, date)
        if rate is None:
            continue
        filled += 1 if back else 0
        conv_dates.append(date)
        conv_closes.append(fx_domain.apply_rate(value, rate, currency, target))
    dropped = len(dates) - len(conv_dates)
    if not conv_dates:
        raise fx_domain.no_fx()

    notes.extend(fx.notes)
    notes.append(f"Cada cierre se convirtió de {currency} a {target} con el tipo de cambio de su misma fecha.")
    if filled:
        notes.append(
            f"En {filled} fechas el tipo de cambio venía del día hábil anterior "
            f"(relleno de a lo más {fx_domain.MAX_FORWARD_FILL_DAYS} días)."
        )
    if dropped:
        notes.append(f"Se omitieron {dropped} fechas porque no había tipo de cambio cercano para convertirlas.")

    return PriceSeries(
        symbol=sym,
        currency=target,
        interval=interval,
        dates=conv_dates,
        close=conv_closes,
        source="yahoo" if fx.source == fx_domain.YAHOO_SOURCE else "yahoo,banxico",
        as_of=conv_dates[-1],
        fx_pair=fx_domain.PAIR,
        fx_source=fx.source,
        notes=notes,
    )


def _fetch_hist(sym: str, period: str = "5d", interval: str = "1d"):
    """Intenta obtener histórico con múltiples estrategias."""
    # Estrategia 1: yft().history() con sesión custom (2 intentos)
    for attempt in range(2):
        try:
            hist = yft(sym).history(period=period, interval=interval)
            if hist is not None and not hist.empty:
                return hist
        except Exception:
            pass
        if attempt == 0:
            time.sleep(1.5)
    # Estrategia 2: yf.download() usa endpoint distinto de Yahoo
    try:
        hist = yf.download(
            sym, period=period, interval=interval,
            progress=False, auto_adjust=True,
        )
        if hist is not None and not hist.empty:
            # Aplanar MultiIndex si lo hay (ocurre con múltiples tickers)
            if hasattr(hist.columns, "levels"):
                hist.columns = hist.columns.get_level_values(0)
            return hist
    except Exception:
        pass
    return None


def get_returns(ticker: str) -> dict:
    """Retorna el rendimiento (%) para cada período estándar usando datos semanales de 5 años."""
    try:
        hist = yft(ticker.upper()).history(period="5y", interval="1wk")
        closes = hist["Close"].dropna()
        n = len(closes)
        last = float(closes.iloc[-1]) if n >= 1 else None

        period_weeks = [("1mo", 4), ("3mo", 13), ("6mo", 26), ("1y", 52), ("2y", 104), ("5y", 260)]
        result = {}
        for pid, weeks in period_weeks:
            # N períodos atrás es la barra -(N+1): iloc[-N] solo cubría N-1 semanas
            if last and n >= weeks + 1:
                first = float(closes.iloc[-(weeks + 1)])
                result[pid] = round((last / first - 1) * 100, 2) if first > 0 else None
            else:
                result[pid] = None
        return result
    except Exception as e:
        return {pid: None for pid in ["1mo", "3mo", "6mo", "1y", "2y", "5y"]}


def _is_mxn(ticker: str) -> bool:
    return ticker.upper().endswith(".MX") or ticker == "$MXN"


def get_chart(ticker: str, period: str = "5y", ccy: str = "") -> dict:
    """Cierres por periodo. Con ccy=MXN los activos en USD se convierten con el USD/MXN
    de la misma fecha, para que Sharpe, backtest y Monte Carlo midan en pesos contra la
    tasa libre de riesgo mexicana (antes se restaba la tasa MX a retornos en dólares)."""
    period_interval = {
        "1mo": ("1mo", "1d"),
        "3mo": ("3mo", "1d"),
        "6mo": ("6mo", "1wk"),
        "1y":  ("1y",  "1wk"),
        "2y":  ("2y",  "1wk"),
        "5y":  ("5y",  "1wk"),
        "10y": ("10y", "1wk"),
    }
    yf_period, interval = period_interval.get(period, ("1y", "1wk"))
    hist = yft(ticker).history(period=yf_period, interval=interval)
    close = hist["Close"].dropna()
    currency = "MXN" if _is_mxn(ticker) else "USD"
    if ccy.upper() == "MXN" and currency == "USD" and not close.empty:
        # El FX se cachea por periodo: sin esto cada gráfica en USD pedía a Yahoo dos series
        fx = _cached(f"fx_hist:{yf_period}:{interval}",
                     lambda: yft("MXN=X").history(period=yf_period, interval=interval)["Close"].dropna(),
                     ttl=3600, ok=lambda v: not v.empty)
        if fx.empty:
            return {"error": "Sin histórico USD/MXN para convertir", "closes": [], "period": period, "bars": 0}
        # Las zonas horarias difieren entre series; se alinea por fecha con el último FX disponible
        close.index = close.index.tz_localize(None).normalize()
        fx = fx.copy()   # la serie cacheada es compartida entre hilos: no se muta
        fx.index = fx.index.tz_localize(None).normalize()
        fx = fx[~fx.index.duplicated(keep="last")]
        close = close[~close.index.duplicated(keep="last")]
        fx_aligned = fx.reindex(close.index, method="ffill").bfill()
        close = (close * fx_aligned).dropna()
        currency = "MXN"
    closes = [round(float(v), 4) for v in close.tolist()]
    return {"closes": closes, "period": period, "bars": len(closes), "currency": currency}
