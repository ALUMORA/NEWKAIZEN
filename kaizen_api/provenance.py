"""Procedencia de los datos: arma el objeto ``meta`` de cada respuesta v2. Firma CONGELADA.

Ejemplo::

    from kaizen_api.provenance import meta

    return {"quotes": quotes, "missing": [], "meta": meta("yahoo", as_of="2026-09-22T14:30:00Z", delay_minutes=15)}

``fallback=True`` significa que se usó una fuente sustituta o un valor de referencia, y la UI está
obligada a decirlo. No existe un valor fijo silencioso: si no hay dato real, la ruta responde 503
``UPSTREAM_UNAVAILABLE``.
"""

from __future__ import annotations

import datetime as _dt
import re

from kaizen_api.schemas import SOURCE_PATTERN

_SOURCE_RE = re.compile(SOURCE_PATTERN)


def utc_now() -> _dt.datetime:
    """Instante actual en UTC (respeta el reloj congelado de las pruebas)."""
    return _dt.datetime.now(_dt.UTC)


def iso_instant(value: _dt.datetime) -> str:
    """ISO 8601 en UTC con ``Z`` y precisión de segundos. Un datetime sin zona se toma como UTC."""
    if value.tzinfo is None:
        value = value.replace(tzinfo=_dt.UTC)
    return value.astimezone(_dt.UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _as_of(value: str | _dt.date | _dt.datetime | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, _dt.datetime):
        return iso_instant(value)
    if isinstance(value, _dt.date):
        return value.isoformat()
    return str(value)


def meta(
    source: str,
    as_of: str | _dt.date | _dt.datetime | None = None,
    delay_minutes: int | None = None,
    stale: bool = False,
    fallback: bool = False,
    notes: list[str] | None = None,
) -> dict:
    """Devuelve el dict ``meta`` del contrato (``schemas.Meta``) con ``generatedAt`` = ahora en UTC.

    ``source`` es una de ``schemas.SOURCE_TOKENS`` o varias separadas por coma (``"yahoo,banxico"``).
    ``as_of`` acepta ``date``, ``datetime`` (se pasa a UTC) o un texto ISO ya formateado.
    """
    if not isinstance(source, str) or not _SOURCE_RE.match(source):
        raise ValueError(f"meta: fuente desconocida {source!r}")
    if delay_minutes is not None and delay_minutes < 0:
        raise ValueError("meta: delay_minutes no puede ser negativo")
    return {
        "asOf": _as_of(as_of),
        "source": source,
        "delayMinutes": delay_minutes,
        "stale": bool(stale),
        "fallback": bool(fallback),
        "generatedAt": iso_instant(utc_now()),
        "notes": list(notes or []),
    }
