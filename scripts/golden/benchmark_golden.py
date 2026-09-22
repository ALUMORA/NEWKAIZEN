"""Referencia en scipy para src/lib/finance/benchmark.js.

Escribe tests/golden/benchmark.json. La beta, la alfa y la R² salen de scipy.stats.linregress
sobre los rendimientos en EXCESO, que es la definición del CAPM; comparar rendimientos brutos da
otra beta y es uno de los errores que se están corrigiendo.

    "/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv-golden/bin/python" \
        scripts/golden/benchmark_golden.py
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


def build() -> list[dict]:
    cases: list[dict] = []

    for seed, n, k, beta_true in ((51, 104, 52, 1.2), (52, 200, 252, 0.75), (53, 60, 12, 1.45)):
        rng = np.random.default_rng(seed)
        bench = rng.normal(0.0007, 0.011, n)
        port = beta_true * bench + rng.normal(0.0003, 0.005, n)
        rf = 0.00015
        pe = port - rf
        be = bench - rf
        fit = sps.linregress(be, pe)
        residuals = pe - (fit.intercept + fit.slope * be)
        cases.append(
            {
                "name": f"regress/excesos-{seed}-k{k}",
                "fn": "regress",
                "input": {"portExcess": pe.tolist(), "benchExcess": be.tolist(), "k": k},
                "expected": {
                    "alpha": float(fit.intercept),
                    "alphaAnnual": float((1 + fit.intercept) ** k - 1),
                    "alphaAnnualArithmetic": float(fit.intercept * k),
                    "beta": float(fit.slope),
                    "r2": float(fit.rvalue**2),
                    "residualStd": float(np.sqrt(np.sum(residuals**2) / (n - 2))),
                    "n": n,
                },
                "tol": 1e-10,
            }
        )
        cases.append(
            {
                "name": f"jensenAlpha/anual-compuesta-{seed}",
                "fn": "jensenAlpha",
                "input": {"portReturns": port.tolist(), "benchReturns": bench.tolist(), "rfPerPeriod": rf, "k": k},
                "expected": float((1 + fit.intercept) ** k - 1),
                "tol": 1e-10,
            }
        )
        cases.append(
            {
                "name": f"blumeBeta/{seed}",
                "fn": "blumeBeta",
                "input": {"beta": float(fit.slope)},
                "expected": float(0.67 * fit.slope + 0.33),
                "tol": TOL,
            }
        )
        cases.append(
            {
                "name": f"treynor/{seed}-k{k}",
                "fn": "treynor",
                "input": {"portReturns": port.tolist(), "rfPerPeriod": rf, "beta": float(fit.slope), "k": k},
                "expected": float(np.mean(port - rf) * k / fit.slope),
                "tol": 1e-11,
            }
        )

        active = port - bench
        te = float(np.std(active, ddof=1) * math.sqrt(k))
        cases.append(
            {
                "name": f"trackingError/{seed}-k{k}",
                "fn": "trackingError",
                "input": {"active": active.tolist(), "k": k},
                "expected": te,
                "tol": TOL,
            }
        )
        cases.append(
            {
                "name": f"informationRatio/{seed}-k{k}",
                "fn": "informationRatio",
                "input": {"active": active.tolist(), "k": k},
                "expected": float(np.mean(active) * k / te),
                "tol": 1e-11,
            }
        )

        up = bench > 0
        down = bench < 0
        cases.append(
            {
                "name": f"captureRatios/{seed}",
                "fn": "captureRatios",
                "input": {"port": port.tolist(), "bench": bench.tolist()},
                "expected": {
                    "up": float((np.prod(1 + port[up]) - 1) / (np.prod(1 + bench[up]) - 1)),
                    "down": float((np.prod(1 + port[down]) - 1) / (np.prod(1 + bench[down]) - 1)),
                    "upPeriods": int(up.sum()),
                    "downPeriods": int(down.sum()),
                },
                "tol": 1e-11,
            }
        )
    return cases


if __name__ == "__main__":
    write("benchmark", build())
