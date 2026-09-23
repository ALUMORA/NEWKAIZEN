"""Tipo de cambio: ``get_fx`` del legado y la costura v2 ``convert``.

Costura CONGELADA: ``convert(amount_or_series, from_ccy, to_ccy, on=None)``.

* ``amount_or_series``: un número (monto en ``from_ccy``) o una ``pandas.Series`` indexada por
  fecha. Con una serie, cada punto se convierte con el tipo de cambio de SU fecha (FIX de Banxico
  cuando hay token, si no Yahoo, marcado como sustituto), rellenando hacia adelante a lo más 3 días.
* ``on``: fecha (``date`` o ``YYYY-MM-DD``) del tipo de cambio para un número; ``None`` es el
  más reciente.
* Misma moneda: devuelve la entrada tal cual (ya implementado).
* Sin tipo de cambio real lanza ``ApiError`` 503 ``UPSTREAM_UNAVAILABLE``. Nunca usa 17.5 fijo.

Implementado por B2a en la fase 2. El ``get_fx`` legado (con su referencia fija marcada
``fallback``) solo lo usan las rutas v1, y el v2 jamás lo llama.

Fuentes, en este orden:

1. **FIX de Banxico** (serie ``SF43718`` del SIE) cuando ``BANXICO_TOKEN`` está configurado. Es el
   tipo de cambio para solventar obligaciones en moneda extranjera y el que usa el SAT, así que es
   el bueno para valuar un portafolio en pesos. Entra por la costura
   ``providers.banxico.fetch_series``, que implementa B2b; mientras no exista, esta capa lo detecta
   y se va al respaldo sin romperse.
2. **Yahoo ``MXN=X``**, marcado ``fallback=true`` y con fuente ``yahoo``. Es una cotización de
   mercado, no el FIX, y por eso la UI está obligada a decirlo.
3. Si ninguna de las dos trae dato: ``ApiError`` 503 ``UPSTREAM_UNAVAILABLE``. No hay valor fijo.

Solo se maneja el par USD/MXN, que es el que necesita un inversionista mexicano para medir en
pesos lo que cotiza en dólares. Cualquier otro par sale con 400 y un mensaje que lo explica.
"""

from __future__ import annotations

import datetime as _dt
import re
from dataclasses import dataclass, field

from kaizen_api.cache import _cached
from kaizen_api.domain import _log
from kaizen_api.errors import ApiError, invalid_param
from kaizen_api.providers.yahoo.session import yft

USD = "USD"
MXN = "MXN"
PAIR = "USDMXN"
"""Único par soportado: cuántos pesos cuesta un dólar."""

YAHOO_SYMBOL = "MXN=X"
"""Símbolo de Yahoo para USD/MXN. Es el mismo que usa la conversión de históricos."""

BANXICO_FIX_SOURCE = "banxico_fix"
YAHOO_SOURCE = "yahoo"

MAX_FORWARD_FILL_DAYS = 3
"""Días naturales que se permite arrastrar hacia adelante un tipo de cambio en un hueco."""

STALE_AFTER_DAYS = 4
"""Un FIX de más de 4 días naturales se marca ``stale`` (cubre un puente largo)."""

FX_TTL = 300


@dataclass(frozen=True)
class FxQuote:
    """Tipo de cambio puntual ya listo para ``FxResponse``."""

    rate: float
    as_of: str
    source: str
    stale: bool
    fallback: bool
    notes: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class FxSeries:
    """Serie diaria del tipo de cambio, en orden cronológico y sin duplicados."""

    dates: list[str]
    values: list[float]
    source: str
    fallback: bool
    notes: list[str] = field(default_factory=list)

    def as_map(self) -> dict[str, float]:
        return dict(zip(self.dates, self.values, strict=True))


def _today() -> _dt.date:
    return _dt.datetime.now(_dt.UTC).date()


def _iso(value: _dt.date | str) -> str:
    return value.isoformat() if isinstance(value, _dt.date) else str(value)


def unsupported_pair(pair: str) -> ApiError:
    """400 para un par que no sea USD/MXN, con un mensaje que dice qué sí hay."""
    return ApiError(
        400,
        "BAD_REQUEST",
        f"Por ahora solo publicamos el tipo de cambio {PAIR} (dólar frente a peso), no {pair.upper()}.",
    )


def no_fx() -> ApiError:
    """503 cuando ninguna fuente real contestó. Nunca se devuelve un valor fijo en su lugar."""
    return ApiError(
        503,
        "UPSTREAM_UNAVAILABLE",
        "No pudimos obtener el tipo de cambio del dólar. Intenta más tarde.",
    )


# ─── Banxico (costura de B2b) ────────────────────────────────────────────────


def _banxico_points(start: str | None, end: str | None) -> list[tuple[str, float]]:
    """Observaciones del FIX desde el SIE, o lista vacía si no hay token o la costura no está lista.

    Lee la costura ``providers.banxico.fetch_series`` sin importarla en tiempo de módulo, para que
    B2b pueda cambiarle el cuerpo mientras esto corre. Acepta las dos formas razonables de
    respuesta: el sobre crudo del SIE (``{"bmx": {"series": [{"datos": [...]}]}}``) y un mapa ya
    normalizado ``{"SF43718": [(fecha, valor), ...]}``.
    """
    from kaizen_api.providers import banxico

    try:
        raw = banxico.fetch_series([banxico.SERIES_FIX], start, end)
    except NotImplementedError:
        return []
    except ApiError:
        return []
    except Exception as exc:
        _log(f"fx: el SIE de Banxico falló ({exc}); se usa el respaldo de Yahoo")
        return []
    return _parse_banxico(raw)


def _parse_banxico(raw) -> list[tuple[str, float]]:
    """Normaliza la respuesta del SIE a ``[(YYYY-MM-DD, valor)]`` ordenada y sin huecos falsos."""
    rows: list = []
    if isinstance(raw, dict):
        series = (raw.get("bmx") or {}).get("series") if "bmx" in raw else None
        if isinstance(series, list):
            for item in series:
                rows.extend((item or {}).get("datos") or [])
        else:
            for key in ("datos", "SF43718", "sf43718"):
                if isinstance(raw.get(key), list):
                    rows.extend(raw[key])
                    break
    elif isinstance(raw, list):
        rows = raw
    points: list[tuple[str, float]] = []
    for row in rows:
        date_raw, value_raw = _banxico_row(row)
        date = _banxico_date(date_raw)
        value = _banxico_value(value_raw)
        if date and value is not None:
            points.append((date, value))
    points.sort()
    return points


def _banxico_row(row) -> tuple[object, object]:
    if isinstance(row, dict):
        return row.get("fecha"), row.get("dato")
    if isinstance(row, (list, tuple)) and len(row) >= 2:
        return row[0], row[1]
    return None, None


def _banxico_date(value) -> str | None:
    if isinstance(value, _dt.date):
        return value.isoformat()
    text = str(value or "").strip()
    for fmt in ("%d/%m/%Y", "%Y-%m-%d"):
        try:
            return _dt.datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    return None


_THOUSANDS = re.compile(r"^\d{1,3}(,\d{3})+(\.\d+)?$")


def _banxico_value(value) -> float | None:
    """Número de una observación del SIE. ``N/E`` (no existe) es un hueco de verdad, no un cero.

    La coma se lee según cómo venga: en ``1,234.56`` separa miles y en ``18,3500`` es el decimal.
    Quitarla siempre convertía 18.35 en 183500, que es un tipo de cambio absurdo pero numérico, o
    sea justo la clase de dato que se cuela sin que nadie lo note.
    """
    text = str(value or "").strip()
    if not text or text.upper() in ("N/E", "N/A", "ND"):
        return None
    text = text.replace(",", "") if _THOUSANDS.match(text) else text.replace(",", ".")
    try:
        number = float(text)
    except ValueError:
        return None
    return number if number > 0 else None


# ─── Yahoo (respaldo marcado) ────────────────────────────────────────────────


def _yahoo_points(period: str, interval: str = "1d") -> list[tuple[str, float]]:
    """Serie de ``MXN=X`` como ``[(fecha, valor)]``. Lista vacía si Yahoo no contesta."""
    from kaizen_api.providers.yahoo import prices

    dates, values = prices.fetch_series(YAHOO_SYMBOL, period, interval)
    return list(zip(dates, values, strict=True))


def _period_for_span(days: int) -> str:
    """El periodo de Yahoo más corto que cubre ``days`` días naturales."""
    for period, covered in (("1mo", 31), ("3mo", 93), ("6mo", 186), ("1y", 372), ("2y", 744), ("5y", 1860)):
        if days <= covered:
            return period
    return "10y" if days <= 3720 else "max"


# ─── API del dominio ─────────────────────────────────────────────────────────


def spot(pair: str = PAIR) -> FxQuote:
    """Tipo de cambio más reciente del par. FIX de Banxico si hay token, si no Yahoo marcado."""
    if pair.upper() != PAIR:
        raise unsupported_pair(pair)
    return _cached("v2:fx:spot", _spot_fresh, ttl=FX_TTL, ok=lambda q: q is not None)


def _spot_fresh() -> FxQuote:
    points = _banxico_points(None, None)
    source, fallback, notes = BANXICO_FIX_SOURCE, False, []
    if not points:
        points = _yahoo_points("5d")
        source, fallback = YAHOO_SOURCE, True
        notes = ["El FIX de Banxico no está disponible, así que este dato viene del mercado en Yahoo."]
    if not points:
        raise no_fx()
    date, rate = points[-1]
    age = (_today() - _dt.date.fromisoformat(date)).days
    return FxQuote(rate=rate, as_of=date, source=source, stale=age > STALE_AFTER_DAYS, fallback=fallback, notes=notes)


def daily_range(start: _dt.date | None, end: _dt.date | None, pair: str = PAIR) -> FxSeries:
    """Serie diaria del tipo de cambio entre dos fechas (ambas incluidas)."""
    if pair.upper() != PAIR:
        raise unsupported_pair(pair)
    today = _today()
    last = end or today
    first = start or (last - _dt.timedelta(days=365))
    if first > today:
        # Culpar al proveedor de una fecha que todavía no ocurre manda al usuario a "intenta más
        # tarde", que nunca va a funcionar. El 503 se queda para cuando la fuente sí falló.
        raise invalid_param(
            "query.start",
            "date_future",
            f"La fecha inicial ({_iso(first)}) todavía no ocurre, así que no hay tipo de cambio que dar.",
        )
    points = _banxico_points(_iso(first), _iso(last))
    source, fallback, notes = BANXICO_FIX_SOURCE, False, []
    if not points:
        span = max((today - first).days, 1)
        points = _yahoo_points(_period_for_span(span))
        source, fallback = YAHOO_SOURCE, True
        notes = ["El FIX de Banxico no está disponible, así que esta serie viene del mercado en Yahoo."]
    inside = [(d, v) for d, v in points if _iso(first) <= d <= _iso(last)]
    if not inside:
        raise no_fx()
    dates = [d for d, _ in inside]
    return FxSeries(
        dates=dates,
        values=[v for _, v in inside],
        source=source,
        fallback=fallback,
        notes=notes + _forming_bar_note(dates, source),
    )


def _forming_bar_note(dates: list[str], source: str) -> list[str]:
    """Aviso cuando el último punto es la barra de HOY, que todavía se mueve.

    Yahoo sirve la barra del día en curso y su valor cambia con el mercado abierto, así que dos
    ventanas distintas de la misma serie pueden traer números distintos para hoy. El FIX de Banxico
    no tiene ese problema: se publica una vez y ya no se mueve.
    """
    if source != YAHOO_SOURCE or not dates or dates[-1] != _iso(_today()):
        return []
    return [
        "El último punto es la barra de hoy, que todavía se está formando: su valor puede cambiar "
        "mientras el mercado siga abierto."
    ]


def series_for(period: str, interval: str = "1d", pair: str = PAIR) -> FxSeries:
    """Serie del tipo de cambio con el MISMO periodo e intervalo que una serie de precios.

    Pedir las dos series con la misma frecuencia es lo que hace que las fechas se puedan cruzar
    punto por punto: una barra semanal de precios y una barra semanal del tipo de cambio traen
    ambas el cierre de esa semana, etiquetado con el mismo día.
    """
    if pair.upper() != PAIR:
        raise unsupported_pair(pair)
    if interval == "1d":
        # Margen antes del inicio: si la primera barra de precio cae en un día sin FX, ``rate_on``
        # necesita días hábiles anteriores hacia dónde mirar.
        first = _today() - _dt.timedelta(days=_period_days(period) + MAX_FORWARD_FILL_DAYS + 7)
        points = _banxico_points(_iso(first), _iso(_today()))
        if points:
            return FxSeries([d for d, _ in points], [v for _, v in points], BANXICO_FIX_SOURCE, False, [])
    points = _yahoo_points(period, interval)
    if not points:
        raise no_fx()
    return FxSeries(
        dates=[d for d, _ in points],
        values=[v for _, v in points],
        source=YAHOO_SOURCE,
        fallback=True,
        notes=["El tipo de cambio de la conversión viene del mercado en Yahoo, no del FIX de Banxico."],
    )


def _period_days(period: str) -> int:
    return {"1mo": 31, "3mo": 93, "6mo": 186, "1y": 372, "2y": 744, "5y": 1860, "10y": 3720}.get(period, 3720 * 3)


def series_is_stale(series: FxSeries, now: _dt.date | None = None) -> bool:
    """¿La serie del tipo de cambio viene atrasada? Misma tolerancia que el dato puntual.

    El FIX se publica en días hábiles bancarios, así que ``STALE_AFTER_DAYS`` días naturales cubren
    un fin de semana largo sin marcar como vieja una serie que solo está esperando al lunes.
    """
    if not series.dates:
        return True
    today = now or _today()
    return (today - _dt.date.fromisoformat(series.dates[-1])).days > STALE_AFTER_DAYS


def rate_on(rates: dict[str, float], date: str) -> tuple[float | None, int]:
    """Tipo de cambio de ``date``, o el del día hábil anterior hasta 3 días naturales atrás.

    Devuelve ``(valor, días arrastrados)``; ``(None, 0)`` si el hueco es más grande que el permitido.
    """
    value = rates.get(date)
    if value is not None:
        return value, 0
    day = _dt.date.fromisoformat(date)
    for back in range(1, MAX_FORWARD_FILL_DAYS + 1):
        value = rates.get((day - _dt.timedelta(days=back)).isoformat())
        if value is not None:
            return value, back
    return None, 0


def apply_rate(value: float, rate: float, from_ccy: str, to_ccy: str) -> float:
    """Convierte un monto con un tipo de cambio USD/MXN ya elegido."""
    if from_ccy == USD and to_ccy == MXN:
        return value * rate
    if from_ccy == MXN and to_ccy == USD:
        return value / rate
    raise unsupported_pair(f"{from_ccy}{to_ccy}")


def check_pair(from_ccy: str, to_ccy: str) -> tuple[str, str]:
    """Normaliza el par y exige que sea USD/MXN (en cualquier dirección)."""
    origin, target = str(from_ccy).upper(), str(to_ccy).upper()
    if {origin, target} != {USD, MXN}:
        raise unsupported_pair(f"{origin}{target}")
    return origin, target


def convert(amount_or_series, from_ccy: str, to_ccy: str, on: _dt.date | str | None = None):
    """Convierte montos o series entre monedas (ver el docstring del módulo)."""
    if str(from_ccy).upper() == str(to_ccy).upper():
        return amount_or_series
    origin, target = check_pair(from_ccy, to_ccy)
    if hasattr(amount_or_series, "index") and hasattr(amount_or_series, "items"):
        return _convert_series(amount_or_series, origin, target)
    rate = _rate_for_date(on)
    return apply_rate(float(amount_or_series), rate, origin, target)


def _rate_for_date(on: _dt.date | str | None) -> float:
    if on is None:
        return spot().rate
    date = _iso(on if isinstance(on, _dt.date) else _dt.date.fromisoformat(str(on)))
    day = _dt.date.fromisoformat(date)
    fx = daily_range(day - _dt.timedelta(days=MAX_FORWARD_FILL_DAYS + 7), day)
    rate, _ = rate_on(fx.as_map(), date)
    if rate is None:
        raise no_fx()
    return rate


def _convert_series(series, origin: str, target: str):
    """Convierte una ``pandas.Series`` indexada por fecha, punto por punto y con su propio FX."""
    import pandas as pd

    dates = [_index_date(key) for key in series.index]
    first = _dt.date.fromisoformat(min(dates)) if dates else None
    last = _dt.date.fromisoformat(max(dates)) if dates else None
    # El FX se pide con margen ANTES del primer punto: pedirlo recortado al rango de la serie
    # dejaba a ``rate_on`` sin días hábiles previos hacia dónde mirar, así que la primera fecha sin
    # barra de tipo de cambio se caía en silencio en vez de rellenarse como dice el contrato. Es el
    # mismo margen que ``_rate_for_date`` ya usa para el caso escalar.
    window = first - _dt.timedelta(days=MAX_FORWARD_FILL_DAYS + 7) if first else None
    rates = daily_range(window, last).as_map()
    keys, values = [], []
    filled = dropped = 0
    for key, date, value in zip(series.index, dates, series.tolist(), strict=True):
        rate, back = rate_on(rates, date)
        if rate is None:
            dropped += 1
            continue
        filled += 1 if back else 0
        keys.append(key)
        values.append(apply_rate(float(value), rate, origin, target))
    if filled or dropped:
        _log(
            f"fx: convert() arrastró el tipo de cambio en {filled} fechas "
            f"(a lo más {MAX_FORWARD_FILL_DAYS} días) y omitió {dropped} por no tener uno cercano"
        )
    return pd.Series(values, index=pd.Index(keys, name=series.index.name), name=series.name)


def _index_date(key) -> str:
    if isinstance(key, _dt.datetime):
        return key.date().isoformat()
    if isinstance(key, _dt.date):
        return key.isoformat()
    return str(key)[:10]


def get_fx() -> dict:
    """Retorna tipo de cambio USD/MXN actual desde Yahoo Finance."""
    try:
        hist = yft("USDMXN=X").history(period="2d")
        if not hist.empty:
            return {"USDMXN": round(float(hist["Close"].iloc[-1]), 4)}
    except Exception as e:
        _log(f"fx: USDMXN=X falló ({e}), se devuelve la referencia fija")
    # Referencia fija: el flag avisa que no es cotización en vivo
    return {"USDMXN": 17.5, "fallback": True}
