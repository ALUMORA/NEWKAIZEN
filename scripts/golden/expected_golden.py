#!/usr/bin/env python
"""Respuestas conocidas de src/lib/finance/expected.js, calculadas con numpy.

Escribe tests/golden/expected.json con {cases: [{name, fn, input, expected, tol}]}, que recorre
expected.test.js. Lo que de verdad se compara aquí es el camino numérico: el JS invierte Σ con
Cholesky propio y numpy lo hace con LU (`np.linalg.solve`). Si los dos dan la misma contracción de
James-Stein a 1e-12, ni la factorización ni la fórmula están chuecas.

Correr con el venv de referencia:

    "/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv-golden/bin/python" \
        scripts/golden/expected_golden.py
"""

from __future__ import annotations

import json
import math
import pathlib

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "tests" / "golden" / "expected.json"
TOL = 1e-12


class Lcg:
    """Congruencial lineal (Numerical Recipes). Determinista, sin dependencias, reproducible."""

    def __init__(self, seed: int) -> None:
        self.state = seed & 0xFFFFFFFF

    def next_u32(self) -> int:
        self.state = (1664525 * self.state + 1013904223) & 0xFFFFFFFF
        return self.state

    def uniform(self) -> float:
        return (self.next_u32() + 0.5) / 4294967296.0

    def normal(self) -> float:
        u1 = self.uniform()
        u2 = self.uniform()
        return math.sqrt(-2.0 * math.log(u1)) * math.cos(2.0 * math.pi * u2)


def make_cov(n: int, seed: int) -> np.ndarray:
    rng = Lcg(seed)
    loadings = np.array([[rng.normal() * 0.3 for _ in range(3)] for _ in range(n)])
    idio = np.array([0.02 + 0.03 * abs(rng.normal()) for _ in range(n)])
    cov = loadings @ loadings.T * 0.05 + np.diag(idio)
    return np.round((cov + cov.T) / 2, 12)


def capm_case(name: str, betas: list[float], rf: float, erp: float) -> dict:
    mu = [rf + b * erp for b in betas]
    return {
        "name": name,
        "fn": "capmExpected",
        "input": {"betas": betas, "rfAnnual": rf, "erp": erp},
        "expected": {"mu": mu},
        "tol": TOL,
    }


def historical_case(name: str, panel: list[list[float]], k: int) -> dict:
    arr = np.asarray(panel, dtype=float)
    per_period = arr.mean(axis=0)
    return {
        "name": name,
        "fn": "historicalMean",
        "input": {"returns": panel, "k": k},
        "expected": {"mu": (per_period * k).tolist(), "perPeriod": per_period.tolist()},
        "tol": TOL,
    }


def james_stein_case(
    name: str, means: list[float], cov: np.ndarray, periods: int, target: str, k: int = 1
) -> dict:
    """James-Stein con medias y covarianza en unidades de k periodos (k=1: por periodo)."""
    mu = np.asarray(means, dtype=float)
    n = len(mu)
    ones = np.ones(n)
    if target == "average":
        mu0 = float(mu.mean())
    else:
        mu0 = float((ones @ np.linalg.solve(cov, mu)) / (ones @ np.linalg.solve(cov, ones)))
    diff = mu - mu0
    # d se calcula en la unidad de entrada y se regresa a la de los T dividiendo entre k.
    d = float(diff @ np.linalg.solve(cov, diff)) / k
    lam = (n + 2) / d if d > 0 else math.inf
    w = 1.0 if math.isinf(lam) else lam / (periods + lam)
    shrunk = (1 - w) * mu + w * mu0
    case_input: dict = {"means": means, "cov": cov.tolist(), "T": periods, "target": target}
    if k != 1:
        case_input["k"] = k
    return {
        "name": name,
        "fn": "jamesStein",
        "input": case_input,
        "expected": {"mu": shrunk.tolist(), "shrinkage": w, "target": mu0},
        "tol": TOL,
    }


def main() -> None:
    rng = Lcg(424242)
    panel = [[round(0.001 + rng.normal() * 0.02, 12) for _ in range(4)] for _ in range(80)]

    cov5 = make_cov(5, 501)
    cov8 = make_cov(8, 801)
    means5 = [round(0.04 + 0.03 * i, 12) for i in range(5)]
    means8 = [round(0.09 - 0.012 * i, 12) for i in range(8)]

    cases = [
        capm_case("CAPM con rf de CETES y ERP de 5.5 %", [0.7, 1.0, 1.35, 1.8], 0.0925, 0.055),
        capm_case("CAPM con beta negativa (cobertura)", [-0.35, 0.0, 1.0], 0.0925, 0.055),
        historical_case("promedio historico semanal 80x4", panel, 52),
        historical_case("promedio historico mensual 80x4", panel, 12),
        james_stein_case("James-Stein hacia minima varianza, 5 activos, T=156", means5, cov5, 156, "minVariance"),
        james_stein_case("James-Stein hacia el promedio simple, 5 activos, T=156", means5, cov5, 156, "average"),
        james_stein_case("James-Stein hacia minima varianza, 8 activos, T=520", means8, cov8, 520, "minVariance"),
        james_stein_case("James-Stein con pocos periodos (T=24) encoge mucho mas", means8, cov8, 24, "minVariance"),
        # Las mismas medias y covarianza del caso de 5 activos, anualizadas con k=52: la contraccion
        # tiene que salir IGUAL que por periodo, y mu y el objetivo, 52 veces mas grandes.
        james_stein_case(
            "James-Stein anualizado con k=52 da la misma contraccion que por periodo",
            [m * 52 for m in means5],
            cov5 * 52,
            156,
            "average",
            k=52,
        ),
    ]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"cases": cases}, indent=2) + "\n", encoding="utf-8")
    print(f"{OUT.relative_to(ROOT)}: {len(cases)} casos")
    for case in cases:
        if case["fn"] == "jamesStein":
            print(f"  {case['name']}: w = {case['expected']['shrinkage']:.12f}")


if __name__ == "__main__":
    main()
