"""Referencia independiente del XIRR (src/lib/finance/xirr.js).

Escribe tests/golden/xirr.json con {cases:[{name, input, expected, tol}]}.

La raiz se saca con scipy.optimize.brentq sobre el mismo VPN Actual/365, que es un metodo distinto
al de Newton con respaldo de biseccion que usa el modulo de JavaScript. Coincidir a 1e-9 con otro
algoritmo es la prueba de que la raiz es la correcta y no un punto donde Newton se quedo quieto.

Se corre con el venv de referencia:
    "/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv-golden/bin/python" \
        scripts/golden/xirr_golden.py
"""

from __future__ import annotations

import json
import random
from datetime import date, timedelta
from pathlib import Path

from scipy.optimize import brentq

OUT = Path(__file__).resolve().parents[2] / "tests" / "golden" / "xirr.json"
TOL = 1e-9
DAYS_PER_YEAR = 365.0


def parse(value: str) -> date:
    y, m, d = (int(part) for part in value.split("-"))
    return date(y, m, d)


def npv(rate: float, flows) -> float:
    first = parse(flows[0]["date"])
    total = 0.0
    for flow in flows:
        years = (parse(flow["date"]) - first).days / DAYS_PER_YEAR
        total += flow["amount"] / (1.0 + rate) ** years
    return total


def solve(flows):
    ordered = sorted(flows, key=lambda f: f["date"])
    lo, hi = -0.9999999, 1e6
    flo = npv(lo, ordered)
    prev_rate, prev_value = lo, flo
    grid = [-0.9999999]
    step = 0.001
    while step <= 1e6:
        grid.append(-step if step < 1 else None)
        step *= 2
    grid = [g for g in grid if g is not None]
    grid += [0.0]
    step = 0.001
    while step <= 1e6:
        grid.append(step)
        step *= 2
    grid = sorted(set(grid))
    for rate in grid:
        value = npv(rate, ordered)
        if prev_value * value < 0:
            lo, hi = prev_rate, rate
            break
        prev_rate, prev_value = rate, value
    else:
        return None
    return brentq(lambda r: npv(r, ordered), lo, hi, xtol=1e-15, rtol=8.9e-16, maxiter=400)


def random_case(name, seed):
    rng = random.Random(seed)
    start = date(2021, 3, 17)
    flows = [{"date": start.isoformat(), "amount": -round(rng.uniform(5000, 50000), 2)}]
    cursor = start
    for _ in range(rng.randint(4, 10)):
        cursor += timedelta(days=rng.randint(20, 400))
        amount = round(rng.uniform(-8000, 12000), 2)
        if amount == 0:
            amount = 1000.0
        flows.append({"date": cursor.isoformat(), "amount": amount})
    cursor += timedelta(days=rng.randint(30, 300))
    flows.append({"date": cursor.isoformat(), "amount": round(abs(sum(f["amount"] for f in flows)) * rng.uniform(1.1, 2.5), 2)})
    return {"name": name, "input": {"cashflows": flows}, "tol": TOL}


def build():
    cases = [
        {
            "name": "un-ano-exacto-diez-por-ciento",
            "input": {
                "cashflows": [
                    {"date": "2025-01-01", "amount": -1000},
                    {"date": "2026-01-01", "amount": 1100},
                ]
            },
            "tol": TOL,
        },
        {
            "name": "ejemplo-de-la-documentacion-de-microsoft",
            "input": {
                "cashflows": [
                    {"date": "2008-01-01", "amount": -10000},
                    {"date": "2008-03-01", "amount": 2750},
                    {"date": "2008-10-30", "amount": 4250},
                    {"date": "2009-02-15", "amount": 3250},
                    {"date": "2009-04-01", "amount": 2750},
                ]
            },
            "tol": TOL,
        },
        {
            "name": "medio-ano",
            "input": {
                "cashflows": [
                    {"date": "2026-01-01", "amount": -1000},
                    {"date": "2026-07-02", "amount": 1100},
                ]
            },
            "tol": TOL,
        },
        {
            "name": "perdida-fuerte",
            "input": {
                "cashflows": [
                    {"date": "2024-05-02", "amount": -25000},
                    {"date": "2026-05-02", "amount": 9000},
                ]
            },
            "tol": TOL,
        },
        {
            "name": "aportaciones-mensuales-un-ano",
            "input": {
                "cashflows": [
                    {"date": f"2025-{month:02d}-01", "amount": -1000}
                    for month in range(1, 13)
                ]
                + [{"date": "2026-01-01", "amount": 13200}]
            },
            "tol": TOL,
        },
        {
            "name": "varios-movimientos-el-mismo-dia",
            "input": {
                "cashflows": [
                    {"date": "2025-01-01", "amount": -5000},
                    {"date": "2025-01-01", "amount": -5000},
                    {"date": "2025-07-01", "amount": 2000},
                    {"date": "2026-01-01", "amount": 9500},
                ]
            },
            "tol": TOL,
        },
        {
            "name": "flujo-diario-corto",
            "input": {
                "cashflows": [
                    {"date": "2026-02-10", "amount": -3000},
                    {"date": "2026-02-24", "amount": 3050},
                ]
            },
            "tol": TOL,
        },
    ]
    for seed in (5, 19, 42, 101):
        cases.append(random_case(f"flujos-aleatorios-{seed}", seed))

    out = []
    for case in cases:
        rate = solve(case["input"]["cashflows"])
        if rate is None:
            raise SystemExit(f"sin raiz para {case['name']}")
        case["expected"] = {"rate": float(rate)}
        out.append(case)
    return {"cases": out}


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = build()
    OUT.write_text(json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")
    for case in payload["cases"]:
        print(f"{case['name']}: {case['expected']['rate']:.12f}")


if __name__ == "__main__":
    main()
