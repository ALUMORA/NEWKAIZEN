"""BLS (Oficina de Estadísticas Laborales de EE. UU.): calendario de publicaciones en ICS.

``https://www.bls.gov/schedule/news_release/bls.ics`` responde 403 sin User-Agent o con el de
python-requests; con uno descriptivo que trae un correo de contacto responde 200 (probado el 1 de
octubre de 2026). Las horas vienen en hora del este de EE. UU. (``TZID=US-Eastern``): aquí se
convierten a instantes UTC con ``America/New_York``, así que el cambio de horario sale solo.

Se guarda un día en caché: el BLS publica el calendario del año completo y casi no cambia.
Información pública del gobierno de EE. UU. (dominio público).
"""

from __future__ import annotations

import datetime as _dt
import re
from zoneinfo import ZoneInfo

import requests

from kaizen_api.cache import _cached

ICS_URL = "https://www.bls.gov/schedule/news_release/bls.ics"
USER_AGENT = "KAIZEN research research@kaizeninvestments.app"
TIMEOUT = 15
CACHE_TTL = 24 * 3600
EASTERN = ZoneInfo("America/New_York")


def _unfold(text: str) -> list[str]:
    """RFC 5545: una línea que empieza con espacio o tabulador continúa la anterior."""
    lines: list[str] = []
    for raw in (text or "").replace("\r\n", "\n").split("\n"):
        if raw[:1] in (" ", "\t") and lines:
            lines[-1] += raw[1:]
        else:
            lines.append(raw)
    return lines


def _parse_dt(prop: str, value: str) -> _dt.datetime | None:
    """``DTSTART;TZID=US-Eastern:20261014T083000`` a instante con zona. Sin hora: 00:00 del este."""
    value = value.strip()
    try:
        if value.endswith("Z"):
            return _dt.datetime.strptime(value, "%Y%m%dT%H%M%SZ").replace(tzinfo=_dt.UTC)
        if "T" in value:
            return _dt.datetime.strptime(value, "%Y%m%dT%H%M%S").replace(tzinfo=EASTERN)
        return _dt.datetime.strptime(value, "%Y%m%d").replace(tzinfo=EASTERN)
    except ValueError:
        return None


def parse_ics(text: str) -> list[dict]:
    """Cada ``VEVENT`` a ``{"summary", "start"}`` (``start`` con zona), ordenados por inicio."""
    events: list[dict] = []
    current: dict | None = None
    for line in _unfold(text):
        if line == "BEGIN:VEVENT":
            current = {}
            continue
        if line == "END:VEVENT":
            if current and current.get("summary") and current.get("start"):
                events.append(current)
            current = None
            continue
        if current is None or ":" not in line:
            continue
        head, _, value = line.partition(":")
        name = head.split(";", 1)[0].upper()
        if name == "SUMMARY":
            current["summary"] = re.sub(r"\\([,;\\])", r"\1", value).strip()
        elif name == "DTSTART":
            current["start"] = _parse_dt(head, value)
    events.sort(key=lambda e: e["start"])
    return events


def _fetch_fresh() -> list[dict]:
    try:
        resp = requests.get(ICS_URL, headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT)
    except requests.RequestException:
        return []
    if resp.status_code >= 400:
        return []
    return parse_ics(resp.text)


def releases() -> list[dict]:
    """Publicaciones del BLS del calendario vigente; lista vacía si el BLS no respondió."""
    return _cached("bls:ics", _fetch_fresh, ttl=CACHE_TTL, ok=bool, fail_ttl=600)
