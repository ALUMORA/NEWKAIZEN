"""ETF por dentro: comisión, clases de activo, sectores en español y 10 principales posiciones.

Sale de ``providers/yahoo/funds.py`` (``Ticker.funds_data``). Las claves de la BMV y del SIC se
mapean al ETF de Estados Unidos con ``data/sic_etf_map.json`` (curado, con fuente y fecha); los
ETF de la BMV que Yahoo no cubre (NAFTRAC) responden 404 ``NOT_FOUND`` con
``details.reason = 'sin datos de fondo'`` sin salir al proveedor.

Total Net Assets no trae unidad en Yahoo. Solo se publica si la escala se verificó contra el AUM
conocido de SPY (entre 400 mil y 1.2 millones de millones de dólares): se prueba qué divisor deja
el dato de SPY en esa banda y se aplica al fondo pedido. Si ninguno cuadra, sale ``null``. El
``Category Average`` de Total Net Assets se descarta siempre: Yahoo lo llena con una copia del dato
del fondo (en SPY los dos dicen 513,975.7), así que no es un promedio de nada.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from kaizen_api.domain.events import YAHOO_PERSONAL_USE
from kaizen_api.errors import ApiError
from kaizen_api.providers.yahoo import fundamentals as _info
from kaizen_api.providers.yahoo import funds as _yahoo

DATA = Path(__file__).resolve().parent.parent / "data" / "sic_etf_map.json"

NO_FUND_REASON = "sin datos de fondo"

SPY_AUM_BAND_USD_MILLIONS = (400_000.0, 1_200_000.0)
"""Banda del AUM de SPY en millones de dólares. Yahoo dio 513,975.7 al grabar (1 oct 2026), que en
millones de dólares son unos 514 mil millones: el orden de magnitud del AUM publicado del fondo."""

TNA_DIVISORS = (1.0, 1_000.0, 1_000_000.0)
"""Escalas posibles del dato de Yahoo: ya en millones, en miles o en dólares."""

SECTORS_ES: dict[str, str] = {
    "technology": "Tecnología",
    "financial_services": "Servicios financieros",
    "healthcare": "Salud",
    "consumer_cyclical": "Consumo discrecional",
    "consumer_defensive": "Consumo básico",
    "communication_services": "Comunicaciones",
    "industrials": "Industria",
    "energy": "Energía",
    "utilities": "Servicios públicos",
    "realestate": "Bienes raíces",
    "basic_materials": "Materiales",
}
"""Llaves de ``sector_weightings`` de Yahoo a su nombre en español."""


@lru_cache(maxsize=1)
def sic_map() -> dict:
    return json.loads(DATA.read_text(encoding="utf-8"))


def resolve(symbol: str) -> tuple[str, str | None]:
    """``(símbolo de Yahoo, clave mapeada o None)``. Lanza 404 para un ETF de la BMV sin datos."""
    key = symbol.upper()
    data = sic_map()
    if key in data.get("bmvWithoutData", {}):
        raise not_a_fund(key, data["bmvWithoutData"][key])
    entry = data.get("map", {}).get(key)
    if entry:
        return entry["target"].upper(), key
    return key, None


def not_a_fund(symbol: str, detail: str | None = None) -> ApiError:
    details = {"reason": NO_FUND_REASON, "symbol": symbol}
    if detail:
        details["detail"] = detail
    return ApiError(404, "NOT_FOUND", f"Yahoo no publica la composición de {symbol}.", details=details)


def earnings_yield_to_pe(value: float | None) -> float | None:
    """``equity_holdings['Price/Earnings']`` de Yahoo es rendimiento de utilidades: P/U = 1/valor."""
    if value is None or value <= 0:
        return None
    return round(1.0 / value, 2)


def tna_divisor(spy_tna: float | None) -> float | None:
    """El divisor que deja el Total Net Assets de SPY dentro de su AUM conocido, o ``None``."""
    if spy_tna is None or spy_tna <= 0:
        return None
    low, high = SPY_AUM_BAND_USD_MILLIONS
    for divisor in TNA_DIVISORS:
        if low <= spy_tna / divisor <= high:
            return divisor
    return None


def total_net_assets(own: float | None, divisor: float | None) -> float | None:
    """Total Net Assets en millones de dólares, o ``None`` si la unidad no se verificó."""
    if own is None or own <= 0 or divisor is None:
        return None
    return round(own / divisor, 2)


def _frac(value: float | None) -> float | None:
    if value is None or value < 0:
        return None
    return min(round(value, 6), 1.0)


def asset_classes(raw: dict) -> dict:
    other_parts = [raw.get(k) for k in ("otherPosition", "preferredPosition", "convertiblePosition")]
    other = sum(v for v in other_parts if v is not None) if any(v is not None for v in other_parts) else None
    return {
        "stock": _frac(raw.get("stockPosition")),
        "bond": _frac(raw.get("bondPosition")),
        "cash": _frac(raw.get("cashPosition")) if (raw.get("cashPosition") or 0) >= 0 else None,
        "other": _frac(other),
    }


def sectors(raw: dict) -> list[dict]:
    rows = [
        {"sector": SECTORS_ES.get(key, key.replace("_", " ").capitalize()), "weight": round(weight, 6)}
        for key, weight in raw.items()
        if weight is not None and weight > 0
    ]
    rows.sort(key=lambda r: (-r["weight"], r["sector"]))
    return rows


def get_fund(symbol: str, today: str) -> dict:
    """Respuesta de ``GET /v2/funds/{symbol}`` sin ``meta`` (la arma el router con ``notes``)."""
    target, mapped_from = resolve(symbol)
    data = _yahoo.get_fund_data(target)
    if data is None:
        raise not_a_fund(symbol.upper())
    notes: list[str] = [YAHOO_PERSONAL_USE]
    if mapped_from:
        entry = sic_map()["map"][mapped_from]
        notes.append(f"{mapped_from} se muestra con la composición de {target}: {entry['source']} (mapeo revisado el {entry['asOf']}).")

    holdings = [
        {"symbol": h["symbol"], "name": h["name"], "weight": round(min(max(h["weight"], 0.0), 1.0), 6)}
        for h in data["holdings"]
    ]
    covered = round(sum(h["weight"] for h in holdings), 6) if holdings else None
    if holdings:
        notes.append(
            f"Yahoo publica solo las {len(holdings)} posiciones principales, que suman {covered * 100:.1f}% del fondo."
        )

    ops = data["operations"]
    spy = data if target == "SPY" else _yahoo.get_fund_data("SPY")
    divisor = tna_divisor((spy or {}).get("operations", {}).get("totalNetAssets"))
    tna = total_net_assets(ops.get("totalNetAssets"), divisor)
    if tna is None:
        notes.append("Yahoo no deja clara la unidad de los activos netos de este fondo, así que salen s/d.")
    else:
        notes.append("Activos netos en millones de dólares según Yahoo (unidad verificada contra SPY); pueden traer semanas de rezago.")

    info = _info.get_info(target)
    name = info.get("longName") or info.get("shortName")
    overview = data["overview"]
    return {
        "symbol": target,
        "mappedFrom": mapped_from,
        "name": str(name) if name else None,
        "family": overview.get("family") or None,
        "category": overview.get("categoryName") or None,
        "legalType": overview.get("legalType") or None,
        "expenseRatio": _frac(ops.get("expenseRatio")),
        "totalNetAssets": tna,
        "totalNetAssetsUnit": "usdMillions" if tna is not None else None,
        "turnover": round(ops["turnover"], 6) if ops.get("turnover") is not None and ops["turnover"] >= 0 else None,
        "assetClasses": asset_classes(data["assetClasses"]),
        "sectors": sectors(data["sectors"]),
        "topHoldings": holdings,
        "coverage": {"topHoldingsWeight": _frac(covered)},
        "notes": notes,
        "as_of": today,
    }
