"""Screener por factores de ``/v2/screeners/factors`` (stream B3c).

Cómo se calcula, en corto:

* Cada métrica se convierte a **puntaje z robusto relativo al sector**:
  ``z = (x menos la mediana) / (1.4826 por la MAD)``, recortado a más menos 3. La MAD (desviación
  absoluta mediana) por 1.4826 estima la desviación estándar cuando los datos son normales, y a
  diferencia de la desviación estándar no se la lleva un dato extremo.
* Los **múltiplos se convierten a rendimiento antes de puntuar** (P/U pasa a utilidad entre precio,
  P/VL a valor en libros entre precio, EV/EBITDA a EBITDA entre valor de empresa). Así una empresa
  que pierde dinero puntúa BAJO en valor, en vez de salir "barata" porque Yahoo le quita el P/U.
* Un **sector con menos de 5 emisoras** no da una mediana que signifique algo, así que esas
  emisoras se comparan contra todo el universo y el renglón lo dice en ``reason``.
* Una emisora con **menos de la mitad de las métricas** queda fuera, con el motivo escrito.
* Las **pruebas** (``checks``) son "cumple / no cumple" contra umbrales fijos y publicados. No hay
  comprar ni vender: esto no es recomendación de inversión.

Fuentes: ``info`` de Yahoo por emisora (una llamada) y dos descargas en lote de cierres
ajustados, semanales para la volatilidad y diarios para el momento. Pasan por
``domain/universe.py``. El momento 12-1 no se define aquí: se delega en
``momentum.momentum_12_1``, la misma función de ``/v2/momentum``, para que la app tenga una sola.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from kaizen_api.cache import _cached
from kaizen_api.domain import safe
from kaizen_api.domain.screeners.momentum import momentum_12_1
from kaizen_api.domain.universe import (
    SymbolData,
    Universe,
    fetch_closes,
    fetch_symbols,
    sector_label,
)

WINSOR = 3.0
"""Recorte del puntaje z, en desviaciones robustas."""

MIN_SECTOR = 5
"""Menos de esto en un sector y se compara contra todo el universo."""

MIN_COVERAGE = 0.5
"""Menos de esta fracción de métricas disponibles y la emisora sale del tablero."""

MIN_FACTORS = 3
"""Factores con puntaje que se necesitan para publicar un compuesto."""

HISTORY_PERIOD = "2y"
HISTORY_INTERVAL = "1wk"
PERIODS_PER_YEAR = 52
MIN_RETURNS = 30
"""Rendimientos semanales mínimos para publicar una volatilidad."""

MOMENTUM_PERIOD = "2y"
MOMENTUM_INTERVAL = "1d"
"""El momento pide cierres diarios: las barras semanales de Yahoo se fechan el lunes en que abren,
así que la que abre el lunes 31 de agosto trae el cierre del viernes 4 de septiembre y no sirve
como fin de agosto."""

CACHE_TTL = 43200
CACHE_FAIL_TTL = 300

FACTORS = ("value", "quality", "momentum", "lowVol", "growth")


@dataclass(frozen=True)
class MetricSpec:
    """Una métrica del tablero: a qué factor suma y si conviene que sea alta o baja."""

    id: str
    factor: str
    higher_is_better: bool
    needs_same_currency: bool = False


METRICS: tuple[MetricSpec, ...] = (
    # Valor: todo convertido a rendimiento, así que más alto es más barato.
    MetricSpec("earningsYield", "value", True, needs_same_currency=True),
    MetricSpec("fcfYield", "value", True, needs_same_currency=True),
    MetricSpec("ebitdaToEv", "value", True, needs_same_currency=True),
    MetricSpec("bookToPrice", "value", True, needs_same_currency=True),
    # Calidad: rentabilidad y qué tan apalancada está.
    MetricSpec("returnOnEquity", "quality", True),
    MetricSpec("returnOnAssets", "quality", True),
    MetricSpec("operatingMargin", "quality", True),
    MetricSpec("debtToEquity", "quality", False),
    # Momento y volatilidad: solo precio, no dependen de la moneda de los estados.
    MetricSpec("momentum12m1", "momentum", True),
    MetricSpec("volatility", "lowVol", False),
    # Crecimiento: lo que reporta Yahoo contra el mismo periodo del año pasado.
    MetricSpec("revenueGrowth", "growth", True),
    MetricSpec("earningsGrowth", "growth", True),
)

METRIC_IDS = tuple(m.id for m in METRICS)

CHECKS: tuple[tuple[str, str, str, str, float], ...] = (
    # (id, etiqueta, métrica, comparación, umbral)
    ("valor", "Rendimiento de utilidades de 6 % o más", "earningsYield", ">=", 0.06),
    ("calidad", "Rendimiento sobre capital de 15 % o más", "returnOnEquity", ">=", 0.15),
    ("margen", "Margen operativo de 10 % o más", "operatingMargin", ">=", 0.10),
    ("deuda", "Deuda entre capital de 1.0 o menos", "debtToEquity", "<=", 1.0),
    ("crecimiento", "Ingresos creciendo 5 % o más", "revenueGrowth", ">=", 0.05),
    ("momento", "Momento 12-1 positivo", "momentum12m1", ">=", 0.0),
)

METHOD = (
    "Puntaje z robusto relativo al sector: z = (x menos la mediana) entre 1.4826 por la MAD, "
    "recortado a más menos 3. Los múltiplos se convierten a rendimiento antes de puntuar, así que "
    "una utilidad negativa puntúa bajo en vez de salir barata. Un sector con menos de 5 emisoras se "
    "compara contra todo el universo y el renglón lo dice. Con menos de la mitad de las métricas "
    "disponibles la emisora queda fuera, con el motivo escrito. Las pruebas son cumple o no cumple "
    "contra umbrales fijos y no son recomendación de inversión."
)


# ─── estadística robusta ─────────────────────────────────────────────────────


def median(values: list[float]) -> float:
    """Mediana de una lista no vacía."""
    ordered = sorted(values)
    n = len(ordered)
    mid = n // 2
    if n % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2.0


def mad(values: list[float]) -> float:
    """Desviación absoluta mediana: la mediana de las distancias a la mediana."""
    med = median(values)
    return median([abs(v - med) for v in values])


@dataclass(frozen=True)
class Scaler:
    """Centro y escala robustos de una muestra, con el recorte ya incluido."""

    center: float
    scale: float
    n: int

    def z(self, value: float) -> float:
        """Puntaje z recortado a más menos ``WINSOR``. Sin escala, todo vale lo mismo: 0."""
        if self.scale <= 0:
            return 0.0
        return max(-WINSOR, min(WINSOR, (value - self.center) / self.scale))


def scaler(values: list[float]) -> Scaler:
    """Centro (mediana) y escala (1.4826 por la MAD) de la muestra.

    Si la MAD sale 0 pero la muestra no es constante (pasa cuando más de la mitad de los valores
    son idénticos) se usa la desviación estándar muestral, que sí distingue las colas. Si tampoco
    hay dispersión, la escala queda en 0 y todos los puntajes salen 0.
    """
    if not values:
        return Scaler(0.0, 0.0, 0)
    center = median(values)
    scale = 1.4826 * mad(values)
    if scale <= 0 and len(values) > 1:
        mean = sum(values) / len(values)
        var = sum((v - mean) ** 2 for v in values) / (len(values) - 1)
        scale = math.sqrt(var)
    return Scaler(center, scale if scale > 0 else 0.0, len(values))


def robust_z(sample: list[float], value: float) -> float:
    """Atajo para una sola cuenta: el puntaje z robusto de ``value`` dentro de ``sample``."""
    return scaler(sample).z(value)


# ─── métricas por emisora ────────────────────────────────────────────────────


def momentum_12m1(points: list[tuple[str, float]], as_of=None) -> float | None:
    """Momento 12-1 de ``[(YYYY-MM-DD, cierre)]`` diarios, con la definición de ``/v2/momentum``.

    Delega en ``momentum.momentum_12_1``: con t el último mes cerrado antes de ``as_of`` (hoy por
    omisión), es el cierre de t−1 entre el de t−12 menos 1, por fecha y no por posición, y ``None``
    si falta alguno de los dos meses.
    """
    if not points:
        return None
    return momentum_12_1(
        dates=[d for d, _ in points], closes=[c for _, c in points], as_of=as_of
    )


def annualized_volatility(points: list[tuple[str, float]]) -> float | None:
    """Volatilidad anualizada de los rendimientos simples del periodo (semanales por 52)."""
    closes = [c for _, c in points]
    returns = [
        closes[i] / closes[i - 1] - 1.0
        for i in range(1, len(closes))
        if closes[i - 1] > 0
    ]
    if len(returns) < MIN_RETURNS:
        return None
    mean = sum(returns) / len(returns)
    var = sum((r - mean) ** 2 for r in returns) / (len(returns) - 1)
    return math.sqrt(var) * math.sqrt(PERIODS_PER_YEAR)


def _price(info: dict) -> float | None:
    return safe(info.get("currentPrice") or info.get("regularMarketPrice"))


def metrics_of(
    data: SymbolData,
    points: list[tuple[str, float]] | None,
    daily: list[tuple[str, float]] | None = None,
) -> dict[str, float | None]:
    """Las doce métricas de una emisora. Lo que no se puede calcular honesto queda en ``None``.

    Las cuatro de valor mezclan precio (moneda de cotización) con cifras de los estados (moneda de
    reporte). Cuando no son la misma moneda se dejan en ``None`` en vez de publicar un número que
    divide pesos entre dólares, que es justo el error que este proyecto vino a quitar.
    """
    info = data.info if data.ok else {}
    out: dict[str, float | None] = dict.fromkeys(METRIC_IDS)
    if not info:
        return out

    price = _price(info)
    same_ccy = data.same_currency

    if same_ccy and price and price > 0:
        eps = safe(info.get("trailingEps"))
        if eps is not None:
            out["earningsYield"] = eps / price
        book = safe(info.get("bookValue"))
        if book is not None:
            out["bookToPrice"] = book / price

    if same_ccy:
        fcf = safe(info.get("freeCashflow"))
        cap = safe(info.get("marketCap"))
        if fcf is not None and cap and cap > 0:
            out["fcfYield"] = fcf / cap
        ev_ebitda = safe(info.get("enterpriseToEbitda"))
        if ev_ebitda is not None and ev_ebitda != 0:
            out["ebitdaToEv"] = 1.0 / ev_ebitda

    out["returnOnEquity"] = safe(info.get("returnOnEquity"))
    out["returnOnAssets"] = safe(info.get("returnOnAssets"))
    out["operatingMargin"] = safe(info.get("operatingMargins"))
    de = safe(info.get("debtToEquity"))
    if de is not None:
        out["debtToEquity"] = de / 100.0  # Yahoo lo da en porcentaje (78.4 = 0.784)
    out["revenueGrowth"] = safe(info.get("revenueGrowth"))
    out["earningsGrowth"] = safe(info.get("earningsGrowth"))

    if daily:
        out["momentum12m1"] = momentum_12m1(daily)
    if points:
        out["volatility"] = annualized_volatility(points)
    return out


def coverage_of(metrics: dict[str, float | None]) -> float:
    """Fracción de las doce métricas que sí se pudieron calcular."""
    have = sum(1 for mid in METRIC_IDS if metrics.get(mid) is not None)
    return have / len(METRIC_IDS)


def checks_of(metrics: dict[str, float | None]) -> list[dict]:
    """Las pruebas cumple / no cumple. Sin dato, ``pass`` va en ``null`` y no se inventa nada."""
    rows = []
    for cid, label, metric_id, op, threshold in CHECKS:
        value = metrics.get(metric_id)
        if value is None:
            passed = None
        elif op == ">=":
            passed = value >= threshold
        else:
            passed = value <= threshold
        rows.append({"id": cid, "label": label, "pass": passed, "value": value, "threshold": threshold})
    return rows


# ─── el tablero completo ─────────────────────────────────────────────────────


def _sector_of(symbol: str, universe: Universe, data: SymbolData | None) -> str | None:
    """Sector canónico: manda el curado del universo y si no hay, el que diga Yahoo."""
    member = universe.member(symbol)
    if member and member.sector:
        return member.sector
    if data and data.ok:
        return data.info.get("sector") or None
    return None


def _name_of(symbol: str, universe: Universe, data: SymbolData | None) -> str | None:
    member = universe.member(symbol)
    if member and member.name:
        return member.name
    if data and data.ok:
        return data.info.get("longName") or data.info.get("shortName") or None
    return None


def _build_rows(
    universe: Universe, fetched: dict[str, SymbolData], closes: dict, daily: dict | None = None
) -> list[dict]:
    daily = daily or {}
    rows = []
    for symbol in universe.symbols:
        data = fetched.get(symbol)
        if data is None:
            rows.append({
                "symbol": symbol,
                "name": _name_of(symbol, universe, None),
                "sector": sector_label(_sector_of(symbol, universe, None)),
                "sectorKey": _sector_of(symbol, universe, None),
                "scores": None,
                "coverage": 0.0,
                "excluded": True,
                "reason": "El proveedor no respondió para esta emisora.",
                "checks": checks_of(dict.fromkeys(METRIC_IDS)),
                "metrics": dict.fromkeys(METRIC_IDS),
            })
            continue
        metrics = metrics_of(data, closes.get(symbol), daily.get(symbol))
        coverage = coverage_of(metrics)
        excluded = coverage < MIN_COVERAGE
        reason = None
        if not data.ok:
            reason = "El proveedor no respondió para esta emisora."
        elif excluded:
            reason = (
                f"Cobertura de {round(coverage * 100)} %: hacen falta al menos "
                f"{round(MIN_COVERAGE * 100)} % de las métricas para compararla."
            )
        elif not data.same_currency:
            reason = (
                f"Reporta en {data.financial_currency} y cotiza en {data.currency}: las métricas de "
                "valor quedan en s/d hasta tener el tipo de cambio."
            )
        sector_key = _sector_of(symbol, universe, data)
        rows.append({
            "symbol": symbol,
            "name": _name_of(symbol, universe, data),
            "sector": sector_label(sector_key),
            "sectorKey": sector_key,
            "scores": None,
            "coverage": round(coverage, 4),
            "excluded": excluded,
            "reason": reason,
            "checks": checks_of(metrics),
            "metrics": {mid: metrics.get(mid) for mid in METRIC_IDS},
        })
    return rows


def _scalers(rows: list[dict]) -> tuple[dict[str, Scaler], dict[str, dict[str, Scaler]], set[str]]:
    """Escaladores del universo y por sector, más los sectores que no llegan a ``MIN_SECTOR``."""
    scored = [r for r in rows if not r["excluded"]]
    universe_scalers = {
        mid: scaler([r["metrics"][mid] for r in scored if r["metrics"].get(mid) is not None])
        for mid in METRIC_IDS
    }
    by_sector: dict[str, list[dict]] = {}
    for row in scored:
        by_sector.setdefault(row["sectorKey"] or "", []).append(row)
    small = {key for key, group in by_sector.items() if len(group) < MIN_SECTOR}
    sector_scalers: dict[str, dict[str, Scaler]] = {}
    for key, group in by_sector.items():
        if key in small:
            continue
        sector_scalers[key] = {
            mid: scaler([r["metrics"][mid] for r in group if r["metrics"].get(mid) is not None])
            for mid in METRIC_IDS
        }
    return universe_scalers, sector_scalers, small


def _score_rows(rows: list[dict]) -> set[str]:
    """Llena ``scores`` de cada renglón. Devuelve los sectores que se compararon contra el universo."""
    universe_scalers, sector_scalers, small = _scalers(rows)
    for row in rows:
        if row["excluded"]:
            continue
        key = row["sectorKey"] or ""
        scalers = sector_scalers.get(key, universe_scalers)
        per_factor: dict[str, list[float]] = {f: [] for f in FACTORS}
        for spec in METRICS:
            value = row["metrics"].get(spec.id)
            if value is None:
                continue
            z = scalers[spec.id].z(value)
            per_factor[spec.factor].append(z if spec.higher_is_better else -z)
        scores: dict[str, float | None] = {}
        for factor in FACTORS:
            zs = per_factor[factor]
            scores[factor] = round(sum(zs) / len(zs), 4) if zs else None
        have = [v for v in scores.values() if v is not None]
        scores["composite"] = round(sum(have) / len(have), 4) if len(have) >= MIN_FACTORS else None
        row["scores"] = scores
        if key in small and row["reason"] is None:
            row["reason"] = (
                f"Su sector tiene menos de {MIN_SECTOR} emisoras en este universo: se compara "
                "contra todo el universo."
            )
    return small


def _order(rows: list[dict]) -> list[dict]:
    """Primero las comparables por compuesto de mayor a menor; las excluidas al final, por símbolo."""
    def key(row):
        score = row["scores"]["composite"] if row["scores"] else None
        return (
            1 if row["excluded"] else 0,
            0 if score is not None else 1,
            -(score or 0.0),
            row["symbol"],
        )

    return sorted(rows, key=key)


def build(universe: Universe) -> dict:
    """Arma el tablero de factores de un universo ya resuelto. Sin caché ni HTTP."""
    fetched, pending = fetch_symbols(universe.symbols)
    closes = fetch_closes(universe.symbols, period=HISTORY_PERIOD, interval=HISTORY_INTERVAL)
    daily = fetch_closes(universe.symbols, period=MOMENTUM_PERIOD, interval=MOMENTUM_INTERVAL)
    rows = _build_rows(universe, fetched, closes, daily)
    small = _score_rows(rows)
    rows = _order(rows)

    notes: list[str] = []
    if small:
        labels = sorted(sector_label(s) or "Sin sector" for s in small)
        notes.append(
            f"Sectores con menos de {MIN_SECTOR} emisoras, comparados contra todo el universo: "
            + ", ".join(labels)
            + "."
        )
    excluded = [r for r in rows if r["excluded"]]
    if excluded:
        notes.append(f"{len(excluded)} de {len(rows)} emisoras quedaron fuera por falta de datos.")
    if pending:
        notes.append("Sin respuesta del proveedor para: " + ", ".join(sorted(pending)) + ".")
    if not closes and not daily:
        notes.append("No se pudo bajar el histórico de precios: momento y volatilidad van en s/d.")
    elif not closes:
        notes.append("No se pudo bajar el histórico semanal: la volatilidad va en s/d.")
    elif not daily:
        notes.append("No se pudo bajar el histórico diario: el momento va en s/d.")
    comparable = sum(1 for r in rows if not r["excluded"])
    if 0 < comparable < MIN_SECTOR:
        notes.append(
            f"Solo {comparable} emisoras tienen datos suficientes: los puntajes relativos dicen poco "
            "con tan pocas."
        )

    as_of = None
    dates = [points[-1][0] for points in closes.values() if points]
    if dates:
        as_of = max(dates)

    for row in rows:
        row.pop("sectorKey", None)
    return {
        "universe": {"id": universe.id, "name": universe.name, "size": universe.size},
        "method": METHOD,
        "rows": rows,
        "notes": notes,
        "asOf": as_of,
    }


def get_factors(universe: Universe) -> dict:
    """Tablero de factores, cacheado 12 h por universo (los fundamentales no cambian intradía)."""
    key = "v2:factors:" + universe.id
    if universe.id == "custom":
        key += ":" + ",".join(universe.symbols)
    return _cached(
        key,
        lambda: build(universe),
        ttl=CACHE_TTL,
        fail_ttl=CACHE_FAIL_TTL,
        ok=lambda r: any(not row["excluded"] for row in r["rows"]),
    )
