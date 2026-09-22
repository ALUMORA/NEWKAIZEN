"""FRED (Reserva Federal de St. Louis): series públicas por ``fredgraph.csv``, sin llave.

``fredgraph.csv?id=<serie>`` devuelve la serie completa en CSV y no pide API key, así que el backend
funciona sin configurar nada. ``FRED_API_KEY`` (settings) queda para la API oficial si algún día
hace falta más (vintages, metadatos); hoy no se usa.

**Ojo con el User-Agent.** Estas peticiones van con ``requests.get`` pelón, con el User-Agent que
trae requests de fábrica. FRED deja la conexión colgada con un User-Agent que imita a un navegador
y también con uno propio no reconocido, así que aquí NO se usa ``providers.yahoo.session._session``
(que sí manda cabeceras de navegador, porque CBOE y los RSS las necesitan). Cambiarlo rompe el
proveedor con un timeout, no con un error claro.

``_fred_rate`` es del legado y se queda igual (los goldens de v1 lo prueban). Lo de abajo es v2:
series con fechas, filtro por rango y caché.
"""

from __future__ import annotations

import requests

from kaizen_api.cache import _cached

FREDGRAPH_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv"
TIMEOUT = 12
CACHE_TTL = 3600
MISSING = (".", "", "NA", "N/A")
"""FRED escribe un punto en los días sin dato (festivos, series que aún no publican)."""


def _fred_rate(series_id: str):
    """Obtiene la tasa más reciente de FRED (API pública de la Reserva Federal)."""
    try:
        # Sin _session y con el User-Agent default de requests: FRED deja colgada la conexión
        # con uno que imita a un navegador, y también con uno propio no reconocido.
        resp = requests.get(
            f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}",
            timeout=8
        )
        for line in reversed(resp.text.strip().split("\n")[1:]):
            parts = line.split(",")
            if len(parts) == 2 and parts[1].strip() not in (".", ""):
                return float(parts[1].strip())
    except Exception:
        pass
    return None


# ─── v2: series con fechas ───────────────────────────────────────────────────


def parse_csv(text: str) -> dict[str, list]:
    """CSV de ``fredgraph`` a ``{"dates": [ISO...], "values": [float...]}``, sin los días sin dato.

    El encabezado es ``observation_date,<SERIE>``. Las filas vienen en orden cronológico y se
    respeta ese orden; las que traen ``.`` o texto no numérico se descartan.
    """
    dates: list[str] = []
    values: list[float] = []
    for line in (text or "").strip().splitlines()[1:]:
        date, _, raw = line.partition(",")
        date = date.strip()
        raw = raw.strip().strip('"')
        if len(date) != 10 or raw in MISSING:
            continue
        try:
            value = float(raw)
        except ValueError:
            continue
        if value != value:  # NaN
            continue
        dates.append(date)
        values.append(value)
    return {"dates": dates, "values": values}


def _fetch_fresh(series_id: str) -> dict[str, list]:
    try:
        resp = requests.get(FREDGRAPH_URL, params={"id": series_id}, timeout=TIMEOUT)
    except requests.RequestException:
        return {"dates": [], "values": []}
    if resp.status_code >= 400:
        return {"dates": [], "values": []}
    return parse_csv(resp.text)


def fetch_series(series_id: str, start: str | None = None, end: str | None = None) -> dict[str, list]:
    """Serie completa de FRED, recortada a ``[start, end]`` en el cliente.

    El recorte NO va en la URL a propósito: ``fredgraph.csv?id=X`` es una sola llave de caché y de
    fixture por serie, así que dos rangos distintos no salen dos veces a la red ni piden grabar dos
    llamadas casi iguales. Devuelve ``{"dates", "values"}`` vacíos si FRED no respondió.
    """
    sid = str(series_id).strip().upper()
    if not sid:
        return {"dates": [], "values": []}
    whole = _cached(f"fred:{sid}", lambda: _fetch_fresh(sid), ttl=CACHE_TTL, ok=lambda r: bool(r["dates"]))
    if start is None and end is None:
        return {"dates": list(whole["dates"]), "values": list(whole["values"])}
    dates: list[str] = []
    values: list[float] = []
    for date, value in zip(whole["dates"], whole["values"], strict=True):
        if start and date < start:
            continue
        if end and date > end:
            continue
        dates.append(date)
        values.append(value)
    return {"dates": dates, "values": values}


def last_points(series_id: str, count: int = 2) -> list[tuple[str, float]]:
    """Los últimos ``count`` puntos ``(fecha, valor)`` de una serie, del más viejo al más nuevo."""
    serie = fetch_series(series_id)
    pairs = list(zip(serie["dates"], serie["values"], strict=True))
    return pairs[-count:] if count > 0 else []


def latest(series_id: str) -> tuple[str, float] | None:
    """Último punto ``(fecha, valor)`` de la serie, o ``None`` si FRED no dio nada."""
    points = last_points(series_id, 1)
    return points[-1] if points else None
