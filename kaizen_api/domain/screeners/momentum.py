"""Momentum relativo contra el ETF del sector (legado, porcentajes).

Movido sin cambios desde backend.py (fase S1): los cuerpos son idénticos al legado y los
goldens de tests/goldens_legacy lo prueban. La versión v2 se escribe al lado, no encima.
"""

from kaizen_api.domain.universe import SECTOR_ETF
from kaizen_api.providers.yahoo.session import yft


def get_momentum(ticker: str) -> dict:
    """
    Momentum relativo vs sector (3m, 6m, 12m).
    Compara el retorno del activo contra el ETF de su sector.
    """
    try:
        t    = yft(ticker)
        info = t.info
        sector = info.get("sector")
        etf    = SECTOR_ETF.get(sector, "SPY")

        # 2y y no 1y: el retorno de 12m necesita 53 barras semanales y 1y a veces trae 52
        hist_stock = yft(ticker).history(period="2y", interval="1wk")
        hist_etf   = yft(etf).history(period="2y", interval="1wk")

        def ret(hist, weeks):
            # N semanas atrás es closes[-(N+1)]; closes[-N] solo cubría N-1
            if hist is None or hist.empty:
                return None
            closes = hist["Close"].dropna().tolist()
            if len(closes) < weeks + 1 or not closes[-(weeks + 1)]:
                return None
            return round((closes[-1] / closes[-(weeks + 1)] - 1) * 100, 2)

        stock_3m  = ret(hist_stock, 13)
        stock_6m  = ret(hist_stock, 26)
        stock_12m = ret(hist_stock, 52)
        etf_3m    = ret(hist_etf,   13)
        etf_6m    = ret(hist_etf,   26)
        etf_12m   = ret(hist_etf,   52)

        alpha_3m  = round(stock_3m  - etf_3m,  2) if (stock_3m  is not None and etf_3m  is not None) else None
        alpha_6m  = round(stock_6m  - etf_6m,  2) if (stock_6m  is not None and etf_6m  is not None) else None
        alpha_12m = round(stock_12m - etf_12m, 2) if (stock_12m is not None and etf_12m is not None) else None

        # Score de momentum: +1 por cada período donde supera al sector
        score = sum(1 for a in [alpha_3m, alpha_6m, alpha_12m] if a is not None and a > 0)

        return {
            "sector":    sector or "—",
            "benchmark": etf,
            "stock":     {"m3": stock_3m,  "m6": stock_6m,  "m12": stock_12m},
            "sector_r":  {"m3": etf_3m,    "m6": etf_6m,    "m12": etf_12m},
            "alpha":     {"m3": alpha_3m,  "m6": alpha_6m,  "m12": alpha_12m},
            "score":     score,   # 0-3
        }
    except Exception as e:
        return {"error": str(e)}


# ─── v2: momentum 12-1 contra una referencia en la MISMA moneda ──────────────
#
# Lo de arriba es el legado (porcentajes, ETF sectorial en dólares contra acciones en pesos) y se
# queda igual porque los goldens lo prueban. Lo de abajo es el v2 de /v2/momentum.
#
# Todo se cuenta por FECHA, nunca por posición: cada cierre se guarda bajo su mes (``AAAA-MM``) y
# la ventana se pide por mes. Contar posiciones hacía que un NaN de Yahoo recorriera la ventana un
# mes hacia atrás en la emisora y no en la referencia, y el relativo salía distinto de cero entre
# dos series idénticas.

import datetime as _dt  # noqa: E402
from collections.abc import Sequence  # noqa: E402

from kaizen_api.domain import _log, safe  # noqa: E402
from kaizen_api.domain import history as _history  # noqa: E402
from kaizen_api.domain.history import get_series  # noqa: E402
from kaizen_api.errors import ApiError  # noqa: E402

MONTHS_NEEDED = 13
"""Meses de calendario que abarca el 12-1: del mes t − 12 al mes t (``P11/P0 − 1``)."""

START_LAG = 12
END_LAG = 1
"""12-1: rendimiento del cierre del mes t − 12 al cierre del mes t − 1, con t el último mes cerrado."""

BENCHMARK_BY_CURRENCY = {"MXN": "NAFTRAC.MX", "USD": "SPY"}
"""Referencia en la MISMA moneda que el activo. NAFTRAC replica al IPC y cotiza en pesos."""

NO_BENCHMARK = ""
"""``benchmark`` cuando la moneda no tiene referencia. El contrato congelado lo pide como texto y
no admite ``null``; la petición para volverlo opcional está en ``docs/requests/B3b.md``."""

MONTHS_ES = (
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
)


class NoHistory(LookupError):
    """No hay histórico mensual suficiente para ese símbolo."""


def _currency_of(symbol: str) -> str:
    sym = symbol.upper()
    if sym.endswith(".MX") or sym == "^MXX":
        return "MXN"
    try:
        from kaizen_api.providers.yahoo.session import yft

        info = yft(sym).info or {}
        currency = (info.get("currency") or "").upper()
        if len(currency) == 3:
            return currency
    except Exception as exc:
        _log(f"momentum: sin moneda para {sym}: {exc}")
    return "USD"


# ─── calendario de meses ─────────────────────────────────────────────────────


def _as_date(value: _dt.date | str | None) -> _dt.date:
    if value is None:
        return _dt.date.today()
    if isinstance(value, str):
        return _dt.date.fromisoformat(value[:10])
    return value


def _shift(month: str, delta: int) -> str:
    """``AAAA-MM`` movido ``delta`` meses (negativo hacia atrás)."""
    year, mon = int(month[:4]), int(month[5:7])
    index = year * 12 + (mon - 1) + delta
    return f"{index // 12:04d}-{index % 12 + 1:02d}"


def reference_month(as_of: _dt.date | str | None = None) -> str:
    """Mes t del 12-1: el último mes que ya cerró antes de ``as_of`` (por omisión, hoy)."""
    day = _as_date(as_of)
    return _shift(f"{day.year:04d}-{day.month:02d}", -1)


def _month_label(month: str) -> str:
    return f"{MONTHS_ES[int(month[5:7]) - 1]} de {month[:4]}"


def last_session_of_month(symbol: str, month: str) -> tuple[str, bool]:
    """Último día hábil de ``month`` en la bolsa de ``symbol``: ``(fecha ISO, se verificó feriado)``.

    Con calendario de la bolsa (BMV o NYSE, ``kaizen_api/data/holidays_*.json``) y un año que el
    archivo cubre, es la última jornada de verdad. Fuera de eso es el último día entre semana y el
    segundo valor sale ``False`` para que quien llame lo diga.
    """
    from kaizen_api.domain import market_calendar

    year, mon = int(month[:4]), int(month[5:7])
    first_next = _dt.date(year + (mon // 12), mon % 12 + 1, 1)
    day = first_next - _dt.timedelta(days=1)
    exchange = _history.exchange_for(symbol)
    calendar = market_calendar.load_calendar(exchange) if exchange else None
    verified = bool(calendar and year in calendar["years"])
    while day.month == mon:
        if verified and market_calendar.session(calendar, day) is not None:
            return day.isoformat(), True
        if not verified and day.weekday() < 5:
            return day.isoformat(), False
        day -= _dt.timedelta(days=1)
    return f"{month}-01", False  # pragma: no cover - un mes entero sin jornadas


def _by_month(dates: Sequence[str], closes: Sequence[float | None]) -> dict[str, float]:
    """``{AAAA-MM: cierre}`` con el ÚLTIMO cierre válido de cada mes.

    Un cierre inválido (``None``, NaN, cero o negativo) no ocupa lugar: ese mes simplemente no está,
    y quien pida ese mes recibe ``None`` en vez del mes de al lado.
    """
    if len(dates) != len(closes):
        raise ValueError("dates y closes deben tener la misma longitud")
    out: dict[str, float] = {}
    for date, close in sorted(zip(dates, closes, strict=True), key=lambda pair: str(pair[0])):
        value = safe(close)
        if value is not None and value > 0:
            out[str(date)[:7]] = value
    return out


def _window(by_month: dict[str, float], end: str, start: str) -> float | None:
    """Rendimiento del cierre de ``start`` al de ``end``; ``None`` si falta cualquiera de los dos."""
    first = by_month.get(start)
    last = by_month.get(end)
    if first is None or last is None:
        return None
    return last / first - 1.0


# ─── datos ───────────────────────────────────────────────────────────────────


def monthly_closes(symbol: str) -> tuple[list[str], list[float]]:
    """Cierres ajustados de fin de mes, sin el mes en curso, en orden cronológico.

    Lee la costura ``domain.history.get_series(symbol, "2y", "1mo", "native")``. Yahoo fecha cada
    barra mensual el día 1 aunque su cierre es el del último día hábil, así que la fecha que sale de
    aquí es la de ese cierre (``last_session_of_month``), no la del arranque de la barra. Un mes cuyo
    cierre viene vacío no aparece, en vez de correr a los demás.
    """
    series = get_series(symbol, range="2y", interval="1mo", ccy="native")
    by_month = _by_month(list(series.dates), [safe(c) for c in series.close])
    current = _shift(reference_month(), 1)
    months = [m for m in by_month if m < current]
    if not months:
        raise NoHistory(symbol)
    return [last_session_of_month(symbol, m)[0] for m in months], [by_month[m] for m in months]


def momentum_12_1(
    symbol: str | None = None,
    *,
    dates: Sequence[str] | None = None,
    closes: Sequence[float | None] | None = None,
    as_of: _dt.date | str | None = None,
) -> float | None:
    """Momentum 12-1 como FRACCIÓN, o ``None`` si falta alguno de los dos cierres que pide.

    Es la función pública para quien necesite el 12-1 fuera de ``/v2/momentum`` (el screener de
    factores de B3c). Se llama de una de dos formas:

    * ``momentum_12_1("WALMEX.MX")``: lee los cierres mensuales ajustados de la costura de B2a.
      Un símbolo sin histórico da ``None``; un proveedor caído (``ApiError`` 5xx) se propaga,
      porque "no hay dato" y "no pudimos preguntar" no son lo mismo.
    * ``momentum_12_1(dates=[...], closes=[...])``: con fechas ISO (``AAAA-MM-DD``) y cierres
      ajustados en la misma moneda. Sirven cierres diarios o mensuales: de cada mes cuenta el
      ÚLTIMO cierre válido. La fecha tiene que ser la del cierre; una barra semanal de Yahoo va
      fechada el lunes en que abre, así que su cierre puede caer en el mes siguiente.

    Definición: con t el último mes que ya cerró antes de ``as_of`` (por omisión hoy), es
    ``P(t − 1) / P(t − 12) − 1``. Los meses se buscan por calendario: si falta el cierre de
    t − 1 o el de t − 12, el resultado es ``None``, nunca el del mes de al lado.
    """
    if symbol is not None and (dates is not None or closes is not None):
        raise ValueError("Pasa un símbolo o fechas y cierres, no las dos cosas.")
    if symbol is not None:
        try:
            dates, closes = monthly_closes(symbol)
        except NoHistory:
            return None
        except ApiError as exc:
            if exc.status == 404:
                return None
            raise
    if dates is None or closes is None:
        raise ValueError("Faltan las fechas o los cierres.")
    t = reference_month(as_of)
    return _window(_by_month(dates, closes), _shift(t, -END_LAG), _shift(t, -START_LAG))


def is_stale_month_end(last_date: str | None, as_of: _dt.date | str | None = None) -> bool:
    """¿El último cierre mensual es anterior al mes t, el último que ya cerró?"""
    if not last_date:
        return False
    return str(last_date)[:7] < reference_month(as_of)


def _calendar_note(symbol: str, dates: Sequence[str]) -> str | None:
    """Aviso cuando alguna fecha de fin de mes no se pudo revisar contra feriados."""
    unverified = [d for d in dates if not last_session_of_month(symbol, d[:7])[1]]
    if not unverified:
        return None
    exchange = _history.exchange_for(symbol)
    if exchange is None:
        return (
            f"No tenemos calendario de la bolsa de {symbol}: cada cierre mensual se fechó en el "
            "último día entre semana del mes, sin revisar feriados."
        )
    from kaizen_api.domain import market_calendar

    calendar = market_calendar.load_calendar(exchange)
    years = calendar["years"]
    return (
        f"El calendario de {calendar['label']} cubre {min(years)} y {max(years)}: "
        f"{len(unverified)} cierres mensuales de otros años se fecharon en el último día entre "
        "semana del mes, sin revisar feriados. El cálculo no cambia, porque se hace por mes."
    )


def get_momentum_v2(symbol: str, as_of: _dt.date | str | None = None) -> dict:
    """Bloque completo de ``/v2/momentum/{symbol}``. Lanza ``NoHistory`` si no hay precios."""
    sym = symbol.upper()
    currency = _currency_of(sym)
    benchmark = BENCHMARK_BY_CURRENCY.get(currency)
    dates, closes = monthly_closes(sym)
    t = reference_month(as_of)
    start, end = _shift(t, -START_LAG), _shift(t, -END_LAG)

    notes: list[str] = []
    own_months = _by_month(dates, closes)
    own = _window(own_months, end, start)
    if own is None:
        faltan = [_month_label(m) for m in (start, end) if m not in own_months]
        notes.append(
            f"El 12-1 necesita los cierres de {_month_label(start)} y {_month_label(end)} y falta "
            f"el de {' y '.join(faltan)}: el rendimiento 12-1 queda sin dato."
        )

    bench_value = None
    bench_dates: list[str] = []
    if benchmark is None:
        notes.append(
            f"No tenemos una referencia que cotice en {currency}: SPY va en dólares y NAFTRAC en "
            "pesos, y comparar contra otra moneda mezclaría el rendimiento con el tipo de cambio. "
            "El rendimiento relativo queda sin dato."
        )
    elif sym == benchmark:
        notes.append("El símbolo ES la referencia, así que el rendimiento relativo es cero por definición.")
        bench_value = own
        bench_dates = dates
    else:
        try:
            bench_dates, bench_closes = monthly_closes(benchmark)
            bench_value = _window(_by_month(bench_dates, bench_closes), end, start)
            if bench_value is None:
                notes.append(f"A la referencia {benchmark} le falta un cierre de la ventana: el relativo queda sin dato.")
        except (NoHistory, ApiError):
            notes.append(f"No hubo histórico mensual de la referencia {benchmark}: el relativo queda sin dato.")

    relative = None if (own is None or bench_value is None) else own - bench_value
    if benchmark is not None:
        notes.append(
            f"Referencia {benchmark}, en {currency}, la misma moneda del activo: comparar contra un "
            "índice en otra moneda mezclaría el rendimiento con el tipo de cambio."
        )
    notes.append(
        f"Cierres ajustados de fin de mes; el 12-1 va de {_month_label(start)} a {_month_label(end)} "
        "y el mes en curso no cuenta porque todavía no cierra."
    )
    calendar_note = _calendar_note(sym, dates)
    if calendar_note:
        notes.append(calendar_note)
    last = dates[-1] if dates else None
    stale = is_stale_month_end(last, as_of)
    if stale:
        notes.append(
            f"El último cierre disponible es del {last} y el último mes cerrado es "
            f"{_month_label(t)}: la serie viene atrasada."
        )

    return {
        "symbol": sym,
        "currency": currency,
        "benchmark": benchmark if benchmark is not None else NO_BENCHMARK,
        "r12m1": _rounded(own),
        "r6m": _rounded(_window(own_months, t, _shift(t, -6))),
        "r3m": _rounded(_window(own_months, t, _shift(t, -3))),
        "benchmarkR12m1": _rounded(bench_value),
        "relative12m1": _rounded(relative),
        "_asOf": _newest_date(dates, bench_dates),
        "_stale": stale,
        "_notes": notes,
    }


def _rounded(value: float | None) -> float | None:
    return None if value is None else round(value, 6)


def _newest_date(*series: Sequence[str]) -> str | None:
    last = [s[-1] for s in series if s]
    return max(last) if last else None
