"""Tesoro de EE. UU.: CSV de la Daily Treasury Par Yield Curve y de la Real Yield Curve (stream V5TS).

Las dos curvas se descargan por año desde ``home.treasury.gov`` en CSV, sin llave. Son dominio
público. La curva real sustituye a ``T10YIE`` de FRED para la inflación implícita de EE. UU.

**User-Agent.** Este proveedor manda ``Mozilla/5.0``: sin un User-Agent de navegador el CSV tarda
unos 18 segundos en responder (probado el 1 de octubre de 2026). FRED es al revés: falla con uno de
navegador, por eso ``providers/fred.py`` usa el de fábrica de requests. Cada proveedor con el suyo.

Formato del CSV: ``Date,"1 Mo",...,"30 Yr"`` con fechas ``MM/DD/YYYY`` en orden DESCENDENTE y los
rendimientos en por ciento. :func:`parse_csv` lo normaliza a fechas ISO en orden ascendente y a
fracciones; una celda vacía o ``N/A`` queda en ``None`` (nunca 0).
"""

from __future__ import annotations

import datetime as _dt
from typing import Literal

import requests

from kaizen_api.cache import _cached

BASE_URL = "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv"
USER_AGENT = "Mozilla/5.0"
TIMEOUT = 30
CACHE_TTL = 24 * 3600
"""Caché diaria: el Tesoro publica una vez al día, al cierre."""

CurveKind = Literal["par", "real"]
TYPES: dict[str, str] = {"par": "daily_treasury_yield_curve", "real": "daily_treasury_real_yield_curve"}
MISSING = ("", "N/A", "NA", ".")


def url_for(kind: CurveKind, year: int) -> str:
    """URL del CSV de un año. Se arma completa (y siempre igual) porque es la llave de los fixtures."""
    tipo = TYPES[kind]
    return f"{BASE_URL}/{int(year)}/all?type={tipo}&field_tdr_date_value={int(year)}&page&_format=csv"


def parse_date(raw: str) -> str | None:
    """``"09/30/2026"`` a ``"2026-09-30"``; ``None`` si no es una fecha."""
    text = str(raw or "").strip().strip('"')
    for fmt in ("%m/%d/%Y", "%Y-%m-%d"):
        try:
            return _dt.datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def _cells(line: str) -> list[str]:
    return [cell.strip().strip('"').strip() for cell in line.split(",")]


def parse_csv(text: str) -> dict:
    """CSV del Tesoro a ``{"dates": [ISO ascendente], "columns": {"10 Yr": [fracción | None, ...]}}``.

    Los nombres de columna se conservan tal cual los escribe el Tesoro ("10 Yr" en la nominal, "10 YR"
    en la real). Las filas con fecha ilegible se descartan; una celda sin dato queda en ``None``.
    """
    lines = [ln for ln in (text or "").strip().splitlines() if ln.strip()]
    if not lines:
        return {"dates": [], "columns": {}}
    header = _cells(lines[0])[1:]
    rows: list[tuple[str, list[float | None]]] = []
    for line in lines[1:]:
        cells = _cells(line)
        date = parse_date(cells[0]) if cells else None
        if date is None:
            continue
        values: list[float | None] = []
        for raw in cells[1 : len(header) + 1]:
            if raw.upper() in MISSING:
                values.append(None)
                continue
            try:
                number = float(raw)
            except ValueError:
                values.append(None)
                continue
            values.append(round(number / 100, 8) if number == number else None)
        values += [None] * (len(header) - len(values))
        rows.append((date, values))
    rows.sort(key=lambda row: row[0])
    dates = [d for d, _ in rows]
    columns = {name: [vals[i] for _, vals in rows] for i, name in enumerate(header)}
    return {"dates": dates, "columns": columns}


def _fetch_fresh(kind: CurveKind, year: int) -> dict:
    try:
        resp = requests.get(url_for(kind, year), headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT)
    except requests.RequestException:
        return {"dates": [], "columns": {}}
    if resp.status_code >= 400:
        return {"dates": [], "columns": {}}
    return parse_csv(resp.text)


def fetch_year(kind: CurveKind, year: int) -> dict:
    """Curva ``par`` (nominal) o ``real`` de un año completo; vacía si el Tesoro no respondió."""
    if kind not in TYPES:
        raise ValueError(f"treasury: curva desconocida {kind!r}")
    return _cached(
        f"treasury:{kind}:{int(year)}",
        lambda: _fetch_fresh(kind, int(year)),
        ttl=CACHE_TTL,
        ok=lambda r: bool(r["dates"]),
    )


def series(kind: CurveKind, column: str, years: list[int] | tuple[int, ...], end: str | None = None) -> dict:
    """Una columna (``"20 Yr"``) de varios años unida en ``{"dates", "values"}`` ascendente.

    Se quitan los días sin dato y, con ``end``, los posteriores a esa fecha (el reloj del servidor).
    """
    pairs: dict[str, float] = {}
    for year in sorted(set(int(y) for y in years)):
        data = fetch_year(kind, year)
        values = data["columns"].get(column) or []
        for date, value in zip(data["dates"], values, strict=False):
            if value is None or (end and date > end):
                continue
            pairs[date] = value
    dates = sorted(pairs)
    return {"dates": dates, "values": [pairs[d] for d in dates]}
