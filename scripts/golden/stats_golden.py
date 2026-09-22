"""Referencia en numpy y scipy para src/lib/finance/stats.js.

Escribe tests/golden/stats.json. La gracia de este archivo es que numpy y scipy son la segunda
opinión: la varianza va con ddof=1, el cuantil con method="linear" (tipo 7) y la regresión con
scipy.stats.linregress, no con una transliteración del mismo código de JS.

    "/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv-golden/bin/python" \
        scripts/golden/stats_golden.py
"""

from __future__ import annotations

import json
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
    rng = np.random.default_rng(20260922)

    for seed, n in ((21, 8), (22, 40), (23, 150)):
        r = np.random.default_rng(seed).normal(0.0008, 0.014, n)
        cases += [
            {"name": f"mean/n{n}", "fn": "mean", "input": {"values": r.tolist()}, "expected": float(np.mean(r)), "tol": TOL},
            {
                "name": f"variance/muestra-n1-n{n}",
                "fn": "variance",
                "input": {"values": r.tolist()},
                "expected": float(np.var(r, ddof=1)),
                "tol": TOL,
            },
            {
                "name": f"stdev/muestra-n1-n{n}",
                "fn": "stdev",
                "input": {"values": r.tolist()},
                "expected": float(np.std(r, ddof=1)),
                "tol": TOL,
            },
        ]

    for seed in (31, 32):
        x = np.random.default_rng(seed).normal(0.001, 0.02, 90)
        y = 1.3 * x + np.random.default_rng(seed + 100).normal(0.0002, 0.006, 90)
        cases += [
            {
                "name": f"covariance/muestra-n1-{seed}",
                "fn": "covariance",
                "input": {"x": x.tolist(), "y": y.tolist()},
                "expected": float(np.cov(x, y, ddof=1)[0, 1]),
                "tol": TOL,
            },
            {
                "name": f"correlation/pearson-{seed}",
                "fn": "correlation",
                "input": {"x": x.tolist(), "y": y.tolist()},
                "expected": float(np.corrcoef(x, y)[0, 1]),
                "tol": TOL,
            },
        ]
        fit = sps.linregress(x, y)
        n = len(x)
        residuals = y - (fit.intercept + fit.slope * x)
        cases.append(
            {
                "name": f"ols/scipy-linregress-{seed}",
                "fn": "ols",
                "input": {"y": y.tolist(), "x": x.tolist()},
                "expected": {
                    "alpha": float(fit.intercept),
                    "beta": float(fit.slope),
                    "r2": float(fit.rvalue**2),
                    "residualStd": float(np.sqrt(np.sum(residuals**2) / (n - 2))),
                    "n": n,
                },
                "tol": 1e-10,
            }
        )

    sample = np.sort(rng.normal(0.0, 0.03, 37))
    for q in (0.0, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 1.0):
        cases.append(
            {
                "name": f"quantile/tipo7-q{q}",
                "fn": "quantile",
                "input": {"sorted": sample.tolist(), "q": q},
                "expected": float(np.quantile(sample, q, method="linear")),
                "tol": TOL,
            }
        )

    for z in (-4.0, -2.5, -1.959963984540054, -1.0, -0.25, 0.0, 0.25, 1.0, 1.6448536269514722, 2.5, 4.0):
        cases += [
            {"name": f"normalPdf/z{z}", "fn": "normalPdf", "input": {"z": z}, "expected": float(sps.norm.pdf(z)), "tol": 1e-14},
            {"name": f"normalCdf/z{z}", "fn": "normalCdf", "input": {"z": z}, "expected": float(sps.norm.cdf(z)), "tol": 1e-13},
        ]

    for p in (0.001, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.975, 0.99, 0.999):
        cases.append(
            {
                "name": f"normalInvCdf/p{p}",
                "fn": "normalInvCdf",
                "input": {"p": p},
                "expected": float(sps.norm.ppf(p)),
                "tol": 1e-11,
            }
        )

    # Colas extremas, con la tolerancia floja que de verdad cumple Acklam sin refinar (~1e-9
    # relativo). Van aparte justamente para que la promesa del JSDoc quede amarrada a una prueba:
    # antes los casos solo llegaban a p = .001 y .999, así que nada detectaba que el paso de
    # Halley EMPEORABA la cola (en p = 1 − 1e−12 el error llegaba a 6.6e−6).
    for p in (1e-8, 1e-6, 1 - 1e-6, 1 - 1e-8):
        cases.append(
            {
                "name": f"normalInvCdf/cola p{p!r}",
                "fn": "normalInvCdf",
                "input": {"p": p},
                "expected": float(sps.norm.ppf(p)),
                "tol": 2e-9,
            }
        )
    return cases


if __name__ == "__main__":
    write("stats", build())
