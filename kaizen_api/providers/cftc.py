"""CFTC Commitments of Traders (Socrata, sin llave): posicionamiento en el peso del CME (stream V5FX).

Dos conjuntos públicos de ``publicreporting.cftc.gov``, los dos de solo futuros:

* ``6dca-aqww`` (legado): interés abierto y posiciones de los no comerciales.
* ``gpe5-46if`` (TFF, traders in financial futures): fondos apalancados y administradores de activos.

El contrato del peso mexicano en el CME es el ``095741``. Socrata devuelve TODOS los números como
texto (``"127595"``) y la fecha como instante flotante sin zona (``"2026-09-22T00:00:00.000"``):
aquí se normalizan a ``float`` y ``YYYY-MM-DD`` antes de que lleguen al dominio. Un campo que no
se pueda leer queda en ``None``, nunca en 0.

La consulta pide solo reportes con fecha menor o igual a ``today``, para que el dato no dependa del
día en que se grabó. Si la CFTC no responde, las funciones devuelven ``[]``.
"""

from __future__ import annotations

import datetime as _dt

import requests

from kaizen_api.cache import _cached

BASE_URL = "https://publicreporting.cftc.gov/resource"
LEGACY_DATASET = "6dca-aqww"
TFF_DATASET = "gpe5-46if"
MXN_CONTRACT = "095741"
TIMEOUT = 15
CACHE_TTL = 6 * 3600
USER_AGENT = "Kaizen/2 (+https://newkaizen.vercel.app)"
DATE_FIELD = "report_date_as_yyyy_mm_dd"

LEGACY_FIELDS = ("open_interest_all", "noncomm_positions_long_all", "noncomm_positions_short_all")
TFF_FIELDS = (
    "lev_money_positions_long",
    "lev_money_positions_short",
    "asset_mgr_positions_long",
    "asset_mgr_positions_short",
)


def to_number(raw) -> float | None:
    """``"127595"`` o ``"1,234"`` a número; vacío o basura a ``None``."""
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        return float(raw)
    text = str(raw).strip().replace(",", "")
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def to_date(raw) -> str | None:
    """``"2026-09-22T00:00:00.000"`` (fecha flotante de Socrata) a ``"2026-09-22"``."""
    text = str(raw or "").strip()[:10]
    try:
        return _dt.date.fromisoformat(text).isoformat()
    except ValueError:
        return None


def normalize(rows: object, fields: tuple[str, ...]) -> list[dict]:
    """Renglones de Socrata a ``{"reportDate", campo: float|None}``, del más nuevo al más viejo."""
    out: list[dict] = []
    if not isinstance(rows, list):
        return out
    for row in rows:
        if not isinstance(row, dict):
            continue
        date = to_date(row.get(DATE_FIELD))
        if date is None:
            continue
        item = {"reportDate": date}
        for name in fields:
            item[name] = to_number(row.get(name))
        out.append(item)
    out.sort(key=lambda r: r["reportDate"], reverse=True)
    return out


def _query(dataset: str, fields: tuple[str, ...], today: _dt.date, limit: int) -> list[dict]:
    params = {
        "$select": ",".join((DATE_FIELD, *fields)),
        "$where": f"cftc_contract_market_code='{MXN_CONTRACT}' AND {DATE_FIELD} <= '{today.isoformat()}T00:00:00'",
        "$order": f"{DATE_FIELD} DESC",
        "$limit": str(limit),
    }
    try:
        resp = requests.get(
            f"{BASE_URL}/{dataset}.json", params=params, timeout=TIMEOUT, headers={"User-Agent": USER_AGENT}
        )
    except requests.RequestException:
        return []
    if resp.status_code >= 400:
        return []
    try:
        body = resp.json()
    except ValueError:
        return []
    return normalize(body, fields)


def legacy_rows(today: _dt.date, limit: int = 2) -> list[dict]:
    """Los últimos ``limit`` reportes del legado (interés abierto y no comerciales)."""
    key = f"cftc:legacy:{today.isoformat()}:{limit}"
    return _cached(key, lambda: _query(LEGACY_DATASET, LEGACY_FIELDS, today, limit), ttl=CACHE_TTL, ok=bool)


def tff_rows(today: _dt.date, limit: int = 1) -> list[dict]:
    """Los últimos ``limit`` reportes TFF (apalancados y administradores de activos)."""
    key = f"cftc:tff:{today.isoformat()}:{limit}"
    return _cached(key, lambda: _query(TFF_DATASET, TFF_FIELDS, today, limit), ttl=CACHE_TTL, ok=bool)
