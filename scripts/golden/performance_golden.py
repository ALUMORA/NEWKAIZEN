"""Referencia en numpy y scipy para src/lib/finance/performance.js.

Escribe tests/golden/performance.json. El VaR y el CVaR paramétricos salen de scipy.stats.norm,
no de la aproximación de Acklam que usa el JS, así que el golden también mide qué tan buena es esa
aproximación.

    "/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv-golden/bin/python" \
        scripts/golden/performance_golden.py
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
from scipy import stats as sps

ROOT = Path(__file__).resolve().parents[2]
TOL = 1e-12


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


def max_drawdown(values: np.ndarray) -> dict:
    peaks = np.maximum.accumulate(values)
    series = values / peaks - 1
    trough = int(np.argmin(series))
    peak = int(np.argmax(values[: trough + 1]))
    recovery = None
    after = np.nonzero(values[trough + 1 :] >= values[peak])[0]
    if after.size:
        recovery = int(after[0]) + trough + 1
    return {
        "maxDrawdown": float(series[trough]),
        "peakIndex": peak,
        "troughIndex": trough,
        "recoveryIndex": recovery,
        "durationPeriods": (recovery if recovery is not None else len(values) - 1) - peak,
    }


def build() -> list[dict]:
    cases: list[dict] = []

    for seed, n, k in ((41, 52, 52), (42, 130, 52), (43, 252, 252)):
        rng = np.random.default_rng(seed)
        r = rng.normal(0.0009, 0.013, n)
        values = np.concatenate([[1.0], np.cumprod(1 + r)])
        growth = float(np.prod(1 + r))
        rf = 0.0002

        cases += [
            {
                "name": f"cagrFromReturns/{seed}-k{k}",
                "fn": "cagrFromReturns",
                "input": {"returns": r.tolist(), "k": k},
                "expected": growth ** (k / n) - 1,
                "tol": TOL,
            },
            {
                "name": f"annualizedVol/{seed}-k{k}",
                "fn": "annualizedVol",
                "input": {"returns": r.tolist(), "k": k},
                "expected": float(np.std(r, ddof=1) * math.sqrt(k)),
                "tol": TOL,
            },
            {
                "name": f"sharpe/{seed}-k{k}",
                "fn": "sharpe",
                "input": {"returns": r.tolist(), "rfPerPeriod": rf, "k": k},
                "expected": float(np.mean(r - rf) / np.std(r - rf, ddof=1) * math.sqrt(k)),
                "tol": TOL,
            },
            {
                "name": f"sortino/{seed}-k{k}",
                "fn": "sortino",
                "input": {"returns": r.tolist(), "rfPerPeriod": rf, "k": k},
                "expected": float(np.mean(r - rf) * k / (math.sqrt(np.sum(np.minimum(0, r - rf) ** 2) / n) * math.sqrt(k))),
                "tol": TOL,
            },
            {
                "name": f"drawdowns/{seed}",
                "fn": "drawdowns",
                "input": {"values": values.tolist()},
                "expected": max_drawdown(values),
                "tol": TOL,
            },
        ]

        for alpha in (0.9, 0.95, 0.99):
            # Mismo redondeo que el JS: n·(1−α) en punto flotante roza el entero por arriba.
            tail = max(1, math.ceil(float(f"{n * (1 - alpha):.12g}")))
            worst = np.sort(r)[:tail]
            cases += [
                {
                    "name": f"historicalVaR/{seed}-alpha{alpha}",
                    "fn": "historicalVaR",
                    "input": {"returns": r.tolist(), "alpha": alpha},
                    "expected": float(-worst[-1]),
                    "tol": TOL,
                },
                {
                    "name": f"historicalCVaR/{seed}-alpha{alpha}",
                    "fn": "historicalCVaR",
                    "input": {"returns": r.tolist(), "alpha": alpha},
                    "expected": float(-np.mean(worst)),
                    "tol": TOL,
                },
            ]

    for mu, sigma in ((0.0, 0.01), (0.045, 0.05916079783099616), (-0.002, 0.03)):
        for alpha in (0.9, 0.95, 0.99):
            z = float(sps.norm.ppf(1 - alpha))
            cases += [
                {
                    "name": f"parametricVaR/mu{mu}-sigma{sigma}-alpha{alpha}",
                    "fn": "parametricVaR",
                    "input": {"mu": mu, "sigma": sigma, "alpha": alpha},
                    "expected": -(mu + sigma * z),
                    "tol": 1e-11,
                },
                {
                    "name": f"parametricCVaR/mu{mu}-sigma{sigma}-alpha{alpha}",
                    "fn": "parametricCVaR",
                    "input": {"mu": mu, "sigma": sigma, "alpha": alpha},
                    "expected": -(mu - sigma * float(sps.norm.pdf(z)) / (1 - alpha)),
                    "tol": 1e-11,
                },
            ]

    for start, end, years in ((100.0, 200.0, 3.0), (1_000_000.0, 1_432_500.0, 7.5), (250.0, 180.0, 4.0)):
        cases.append(
            {
                "name": f"cagr/{start}-a-{end}-en-{years}",
                "fn": "cagr",
                "input": {"startValue": start, "endValue": end, "years": years},
                "expected": (end / start) ** (1 / years) - 1,
                "tol": TOL,
            }
        )
    return cases


if __name__ == "__main__":
    write("performance", build())
