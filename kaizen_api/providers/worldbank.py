"""Banco Mundial, API v2 de indicadores, sin llave. Datos bajo licencia CC BY 4.0 (citar la fuente).

``/v2/country/MEX;USA;BRA/indicator/<código>?format=json&mrv=5&per_page=100`` devuelve un arreglo
``[metadatos, filas]`` con una fila por país y año, y ``value`` en ``null`` cuando el dato no existe
(la inflación de EE. UU. de 2025 venía en null el 1 de octubre de 2026). Se guarda un día en caché.
"""

from __future__ import annotations

import requests

from kaizen_api.cache import _cached

BASE_URL = "https://api.worldbank.org/v2"
TIMEOUT = 15
CACHE_TTL = 24 * 3600
MRV = 5


def parse_rows(body) -> list[dict]:
    """``[meta, filas]`` a ``[{"country", "name", "year", "value"}]``; ``value`` puede ser None."""
    if not isinstance(body, list) or len(body) < 2 or not isinstance(body[1], list):
        return []
    out: list[dict] = []
    for row in body[1]:
        if not isinstance(row, dict):
            continue
        code = str(row.get("countryiso3code") or "").upper()
        try:
            year = int(str(row.get("date") or ""))
        except ValueError:
            continue
        raw = row.get("value")
        try:
            value = float(raw) if raw is not None else None
        except (TypeError, ValueError):
            value = None
        if value is not None and value != value:
            value = None
        name = (row.get("country") or {}).get("value") if isinstance(row.get("country"), dict) else None
        if len(code) == 3:
            out.append({"country": code, "name": name or code, "year": year, "value": value})
    return out


def _fetch_fresh(countries: tuple[str, ...], code: str) -> list[dict]:
    url = f"{BASE_URL}/country/{';'.join(countries)}/indicator/{code}"
    try:
        resp = requests.get(url, params={"format": "json", "mrv": MRV, "per_page": 100}, timeout=TIMEOUT)
    except requests.RequestException:
        return []
    if resp.status_code >= 400:
        return []
    try:
        return parse_rows(resp.json())
    except ValueError:
        return []


def indicator(countries: list[str], code: str) -> list[dict]:
    """Últimos ``MRV`` años de un indicador para esos países (ISO alfa-3); vacía si no respondió."""
    key = tuple(countries)
    return _cached(f"worldbank:{code}:{','.join(key)}", lambda: _fetch_fresh(key, code), ttl=CACHE_TTL, ok=bool, fail_ttl=600)
