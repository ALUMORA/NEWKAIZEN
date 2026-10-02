"""Frankfurter: tipos de cambio de referencia sin llave (stream V5FX).

Dos versiones del mismo servicio, con fuentes distintas, y por eso se citan distinto:

* **v1** (``https://api.frankfurter.dev/v1``) publica la referencia diaria del Banco Central Europeo
  (BCE). Aquí solo sirve de **respaldo marcado** de los cruces que publica el SIE de Banxico
  (euro, yen, libra, yuan y dólar canadiense contra el peso).
* **v2** (``https://api.frankfurter.dev/v2/rates``) junta datos de varios bancos centrales. Es la
  fuente de los cruces latinoamericanos (real, peso colombiano, chileno y argentino, sol), que el
  SIE no publica, y se cita como mezcla de bancos centrales.

Ninguna de las dos es el FIX. v2 trae renglones de sábado y domingo (repite el viernes): se
descartan aquí, en el proveedor, para que un fin de semana no cuente como día de mercado.

Todo sale por ``requests`` para que el replay lo grabe y lo reproduzca. Si el servicio no responde,
las funciones devuelven ``{}`` y quien llama decide qué publicar; nunca se inventa un valor.
"""

from __future__ import annotations

import datetime as _dt

import requests

from kaizen_api.cache import _cached

V1_URL = "https://api.frankfurter.dev/v1"
V2_URL = "https://api.frankfurter.dev/v2/rates"
TIMEOUT = 12
CACHE_TTL = 3600
USER_AGENT = "Kaizen/2 (+https://newkaizen.vercel.app)"

Points = dict[str, list[tuple[str, float]]]
"""``{código: [(YYYY-MM-DD, tasa)]}`` en orden cronológico; la tasa es unidades de ``código`` por 1 de la base."""


def _number(value) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def _is_weekday(date: str) -> bool:
    try:
        return _dt.date.fromisoformat(date).weekday() < 5
    except ValueError:
        return False


def _get_json(url: str, params: dict) -> object | None:
    try:
        resp = requests.get(url, params=params, timeout=TIMEOUT, headers={"User-Agent": USER_AGENT})
    except requests.RequestException:
        return None
    if resp.status_code >= 400:
        return None
    try:
        return resp.json()
    except ValueError:
        return None


def parse_v1(body: object) -> Points:
    """Serie de tiempo de v1: ``{"rates": {"YYYY-MM-DD": {"EUR": 0.05}}}``."""
    out: Points = {}
    rates = body.get("rates") if isinstance(body, dict) else None
    if not isinstance(rates, dict):
        return out
    for date in sorted(rates):
        row = rates[date]
        if not isinstance(row, dict) or not _is_weekday(str(date)):
            continue
        for code, raw in row.items():
            value = _number(raw)
            if value is not None:
                out.setdefault(str(code).upper(), []).append((str(date), value))
    return out


def parse_v2(body: object) -> Points:
    """Renglones de v2: ``[{"date", "base", "quote", "rate"}]``, sin sábados ni domingos."""
    out: Points = {}
    if not isinstance(body, list):
        return out
    for row in body:
        if not isinstance(row, dict):
            continue
        date = str(row.get("date") or "")[:10]
        code = str(row.get("quote") or "").upper()
        value = _number(row.get("rate"))
        if not code or value is None or not _is_weekday(date):
            continue
        out.setdefault(code, []).append((date, value))
    for code in out:
        out[code] = sorted(dict(out[code]).items())
    return out


def v1_series(base: str, symbols: list[str], start: str, end: str) -> Points:
    """Referencia del BCE de ``symbols`` por cada unidad de ``base`` entre dos fechas."""
    params = {"base": base, "symbols": ",".join(symbols)}
    url = f"{V1_URL}/{start}..{end}"
    key = f"frankfurter:v1:{base}:{params['symbols']}:{start}:{end}"
    return _cached(key, lambda: parse_v1(_get_json(url, params)), ttl=CACHE_TTL, ok=bool)


def v2_series(base: str, quotes: list[str], start: str, end: str) -> Points:
    """Mezcla de bancos centrales: ``quotes`` por cada unidad de ``base`` entre dos fechas."""
    params = {"base": base, "quotes": ",".join(quotes), "from": start, "to": end}
    key = f"frankfurter:v2:{base}:{params['quotes']}:{start}:{end}"
    return _cached(key, lambda: parse_v2(_get_json(V2_URL, params)), ttl=CACHE_TTL, ok=bool)
