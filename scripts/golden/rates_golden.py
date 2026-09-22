"""Referencia para src/lib/finance/rates.js.

Escribe tests/golden/rates.json. La conversión de CETES se calcula aquí con la fórmula de
mercado (base 360 para la tasa, capitalización por plazo) y la serie alineada se arma con fechas
de verdad, incluyendo el caso de la tasa vencida por más de 45 días, que debe salir en null.

    "/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv-golden/bin/python" \
        scripts/golden/rates_golden.py
"""

from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
TOL = 1e-13
MAX_STALE_DAYS = 45


def clean(value):
    if isinstance(value, dict):
        return {k: clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, np.ndarray)):
        return [clean(v) for v in value]
    if isinstance(value, (np.floating, float)):
        return float(value)
    if isinstance(value, (np.integer, int)) and not isinstance(value, bool):
        return int(value)
    return value


def write(module: str, cases: list[dict]) -> None:
    out = ROOT / "tests" / "golden" / f"{module}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"cases": clean(cases)}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{out.relative_to(ROOT)}: {len(cases)} casos")


def cetes_per_period(annual_yield: float, days: float, tenor_days: int = 28) -> float:
    return (1 + annual_yield * tenor_days / 360) ** (days / tenor_days) - 1


def build() -> list[dict]:
    cases: list[dict] = []

    for y in (0.0425, 0.07, 0.09, 0.11, 0.1125, 0.15):
        for days in (1, 7, 28, 30, 91, 182, 365):
            cases.append(
                {
                    "name": f"cetesPerPeriod/y{y}-d{days}",
                    "fn": "cetesPerPeriod",
                    "input": {"annualYield": y, "days": days, "tenorDays": 28},
                    "expected": cetes_per_period(y, days),
                    "tol": TOL,
                }
            )
        cases.append(
            {
                "name": f"cetesEffectiveAnnual/y{y}",
                "fn": "cetesEffectiveAnnual",
                "input": {"annualYield": y, "tenorDays": 28},
                "expected": cetes_per_period(y, 365),
                "tol": TOL,
            }
        )
        for tenor in (91, 182, 364):
            cases.append(
                {
                    "name": f"cetesPerPeriod/plazo{tenor}-y{y}",
                    "fn": "cetesPerPeriod",
                    "input": {"annualYield": y, "days": 7, "tenorDays": tenor},
                    "expected": cetes_per_period(y, 7, tenor),
                    "tol": TOL,
                }
            )

    for annual in (0.05, 0.1174545668, 0.25):
        for k in (12, 52, 252):
            cases.append(
                {
                    "name": f"annualToPerPeriod/{annual}-k{k}",
                    "fn": "annualToPerPeriod",
                    "input": {"annualRate": annual, "k": k},
                    "expected": (1 + annual) ** (1 / k) - 1,
                    "tol": TOL,
                }
            )

    for a, b in ((0.08, 0.0825), (0.1125, 0.105), (0.0, 0.0001)):
        cases.append(
            {
                "name": f"changeInBp/{a}-a-{b}",
                "fn": "changeInBp",
                "input": {"from": a, "to": b},
                "expected": (b - a) * 10000,
                "tol": 1e-9,
            }
        )

    # Serie semanal de precios contra una serie de CETES que se publica cada jueves.
    first = date(2026, 1, 5)
    target_dates = [(first + timedelta(days=7 * i)).isoformat() for i in range(14)]
    rf_dates = [(date(2025, 12, 18) + timedelta(days=7 * i)).isoformat() for i in range(16)]
    rf_values = [round(0.1125 - 0.0005 * i, 6) for i in range(16)]
    expected = []
    for i in range(len(target_dates) - 1):
        start = date.fromisoformat(target_dates[i])
        in_force = None
        for d, v in zip(rf_dates, rf_values, strict=True):
            published = date.fromisoformat(d)
            if published <= start and (in_force is None or published > in_force[0]):
                in_force = (published, v)
        if in_force is None or (start - in_force[0]).days > MAX_STALE_DAYS:
            expected.append(None)
        else:
            days = (date.fromisoformat(target_dates[i + 1]) - start).days
            expected.append(cetes_per_period(in_force[1], days))
    cases.append(
        {
            "name": "rfSeriesForDates/semanal-con-publicacion-los-jueves",
            "fn": "rfSeriesForDates",
            "input": {
                "rfSeries": {"dates": rf_dates, "values": rf_values},
                "targetDates": target_dates,
                "interval": "1wk",
            },
            "expected": expected,
            "tol": TOL,
        }
    )

    # Serie que se corta: después de 45 días sin publicación nueva, los periodos salen en null.
    short_rf_dates = rf_dates[:4]
    short_rf_values = rf_values[:4]
    expected_short = []
    for i in range(len(target_dates) - 1):
        start = date.fromisoformat(target_dates[i])
        in_force = None
        for d, v in zip(short_rf_dates, short_rf_values, strict=True):
            published = date.fromisoformat(d)
            if published <= start and (in_force is None or published > in_force[0]):
                in_force = (published, v)
        if in_force is None or (start - in_force[0]).days > MAX_STALE_DAYS:
            expected_short.append(None)
        else:
            days = (date.fromisoformat(target_dates[i + 1]) - start).days
            expected_short.append(cetes_per_period(in_force[1], days))
    cases.append(
        {
            "name": "rfSeriesForDates/serie-que-se-corta-deja-nulos",
            "fn": "rfSeriesForDates",
            "input": {
                "rfSeries": {"dates": short_rf_dates, "values": short_rf_values},
                "targetDates": target_dates,
                "interval": "1wk",
            },
            "expected": expected_short,
            "tol": TOL,
        }
    )
    return cases


if __name__ == "__main__":
    write("rates", build())
