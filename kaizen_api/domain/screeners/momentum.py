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

import datetime as _dt  # noqa: E402

from kaizen_api.domain import _log, safe  # noqa: E402
from kaizen_api.domain.history import get_series  # noqa: E402

MONTHS_NEEDED = 13
"""13 cierres de fin de mes: r12-1 = P11/P0 − 1, o sea 12 meses saltándose el último."""

BENCHMARK_BY_CURRENCY = {"MXN": "NAFTRAC.MX", "USD": "SPY"}
"""Referencia en la MISMA moneda que el activo. NAFTRAC replica al IPC y cotiza en pesos."""

DEFAULT_BENCHMARK = "SPY"


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


def _drop_current_month(dates: list[str], closes: list[float]) -> tuple[list[str], list[float]]:
    """Quita la barra del mes en curso: todavía no es un cierre de fin de mes."""
    if not dates:
        return dates, closes
    today = _dt.date.today()
    if dates[-1][:7] == today.isoformat()[:7]:
        return dates[:-1], closes[:-1]
    return dates, closes


def monthly_closes(symbol: str) -> tuple[list[str], list[float]]:
    """Cierres ajustados de fin de mes, sin el mes en curso, en orden cronológico.

    Usa la costura ``domain.history.get_series`` de B2a cuando exista; mientras responda
    ``NotImplementedError`` lee Yahoo directo con el mismo periodo e intervalo. El puente se quita
    en el merge de la fase 2 (ver ``docs/requests/B3b.md``).
    """
    dates: list[str] = []
    closes: list[float] = []
    try:
        series = get_series(symbol, range="2y", interval="1mo", ccy="native")
        dates, closes = list(series.dates), [float(c) for c in series.close]
    except NotImplementedError:
        from kaizen_api.providers.yahoo.session import yft

        try:
            hist = yft(symbol).history(period="2y", interval="1mo")
        except Exception as exc:
            _log(f"momentum: histórico de {symbol} falló: {exc}")
            raise NoHistory(symbol) from exc
        if hist is None or hist.empty or "Close" not in hist:
            raise NoHistory(symbol) from None
        serie = hist["Close"].dropna()
        dates = [str(idx)[:10] for idx in serie.index]
        closes = [float(v) for v in serie.tolist()]
    dates, closes = _drop_current_month(dates, closes)
    clean_dates: list[str] = []
    clean_closes: list[float] = []
    for date, close in zip(dates, closes, strict=False):
        value = safe(close)
        if value is not None and value > 0:
            clean_dates.append(date)
            clean_closes.append(value)
    if not clean_closes:
        raise NoHistory(symbol)
    return clean_dates, clean_closes


def _return_between(closes: list[float], back: int) -> float | None:
    """Rendimiento del último cierre contra el de ``back`` meses atrás."""
    if len(closes) < back + 1:
        return None
    start = closes[-(back + 1)]
    return (closes[-1] / start - 1.0) if start > 0 else None


def r12m1(closes: list[float]) -> float | None:
    """12-1: ``P_{t−1m} / P_{t−12m} − 1`` con 13 cierres de fin de mes (``P11/P0 − 1``)."""
    if len(closes) < MONTHS_NEEDED:
        return None
    window = closes[-MONTHS_NEEDED:]
    start = window[0]
    return (window[11] / start - 1.0) if start > 0 else None


def get_momentum_v2(symbol: str) -> dict:
    """Bloque completo de ``/v2/momentum/{symbol}``. Lanza ``NoHistory`` si no hay precios."""
    sym = symbol.upper()
    currency = _currency_of(sym)
    benchmark = BENCHMARK_BY_CURRENCY.get(currency, DEFAULT_BENCHMARK)
    dates, closes = monthly_closes(sym)

    notes: list[str] = []
    own = r12m1(closes)
    if own is None:
        notes.append(
            f"Solo hay {len(closes)} cierres de fin de mes y el 12-1 necesita {MONTHS_NEEDED}: "
            "el rendimiento 12-1 queda sin dato."
        )

    bench_value = None
    if sym == benchmark:
        notes.append("El símbolo ES la referencia, así que el rendimiento relativo es cero por definición.")
        bench_value = own
        bench_dates = dates
    else:
        try:
            bench_dates, bench_closes = monthly_closes(benchmark)
            bench_value = r12m1(bench_closes)
        except NoHistory:
            bench_dates = []
            notes.append(f"No hubo histórico mensual de la referencia {benchmark}: el relativo queda sin dato.")

    relative = None if (own is None or bench_value is None) else own - bench_value
    notes.append(
        f"Referencia {benchmark}, en {currency}, la misma moneda del activo: comparar un precio en "
        "pesos contra un índice en dólares mezcla rendimiento con tipo de cambio."
    )
    notes.append("Cierres ajustados de fin de mes; el mes en curso no cuenta porque todavía no cierra.")

    return {
        "symbol": sym,
        "currency": currency,
        "benchmark": benchmark,
        "r12m1": None if own is None else round(own, 6),
        "r6m": _rounded(_return_between(closes, 6)),
        "r3m": _rounded(_return_between(closes, 3)),
        "benchmarkR12m1": None if bench_value is None else round(bench_value, 6),
        "relative12m1": None if relative is None else round(relative, 6),
        "_asOf": _newest_date(dates, bench_dates),
        "_notes": notes,
    }


def _rounded(value: float | None) -> float | None:
    return None if value is None else round(value, 6)


def _newest_date(*series: list[str]) -> str | None:
    last = [s[-1] for s in series if s]
    return max(last) if last else None
