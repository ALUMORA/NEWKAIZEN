#!/usr/bin/env python
"""Respuestas conocidas de src/lib/finance/optimize.js, resueltas con scipy.

Escribe tests/golden/optimize.json con {cases: [{name, fn, input, expected, tol}]}, que recorre
optimize.test.js. Los mismos problemas se resuelven con dos métodos que no comparten una sola
línea de código:

- aquí, SLSQP de scipy (programación cuadrática secuencial) y, para paridad de riesgo, el sistema
  de primer orden resuelto con `scipy.optimize.root`;
- allá, FISTA con proyección exacta sobre símplex con caja, y descenso coordinado cíclico.

Si los dos caen en el mismo punto dentro de 1e-6 con 3 a 10 activos, cajas activas incluidas, el
optimizador está bien. Correr con el venv de referencia:

    "/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv-golden/bin/python" \
        scripts/golden/optimize_golden.py

Los datos salen de un congruencial lineal escrito aquí mismo, no de numpy.random, para que el JSON
sea idéntico corrida tras corrida.
"""

from __future__ import annotations

import json
import math
import pathlib

import numpy as np
from scipy.optimize import minimize, root

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "tests" / "golden" / "optimize.json"
TOL = 1e-6


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


def make_problem(n: int, seed: int) -> tuple[np.ndarray, np.ndarray]:
    """Covarianza anual definida positiva y bien condicionada, más rendimientos esperados.

    Se redondea a 12 decimales ANTES de resolver, porque el JSON guarda la versión redondeada y
    los dos lados tienen que estar viendo exactamente los mismos números.
    """
    rng = Lcg(seed)
    factors = 3
    loadings = np.array([[rng.normal() * 0.35 for _ in range(factors)] for _ in range(n)])
    idio = np.array([0.02 + 0.03 * abs(rng.normal()) for _ in range(n)])
    cov = loadings @ loadings.T * 0.05 + np.diag(idio)
    cov = np.round((cov + cov.T) / 2, 12)
    mu = np.round(np.array([0.05 + 0.02 * rng.normal() + 0.03 * abs(rng.normal()) for _ in range(n)]), 12)
    return cov, mu


def solve_slsqp(fun, jac, n, lo, hi, starts):
    """SLSQP desde varios arranques, con un pulido extra desde el mejor punto."""
    cons = [{"type": "eq", "fun": lambda w: float(np.sum(w) - 1.0), "jac": lambda w: np.ones_like(w)}]
    bounds = list(zip(lo, hi, strict=True))
    best = None
    for x0 in starts:
        res = minimize(
            fun, x0, jac=jac, method="SLSQP", bounds=bounds, constraints=cons,
            options={"ftol": 1e-14, "maxiter": 3000},
        )
        if not res.success:
            continue
        polished = minimize(
            fun, res.x, jac=jac, method="SLSQP", bounds=bounds, constraints=cons,
            options={"ftol": 1e-16, "maxiter": 3000},
        )
        candidate = polished.x if polished.success and polished.fun <= res.fun else res.x
        value = fun(candidate)
        if best is None or value < best[0]:
            best = (value, np.asarray(candidate, dtype=float))
    if best is None:
        raise RuntimeError(f"SLSQP no convergió con n = {n}")
    w = best[1]
    w = np.clip(w, lo, hi)
    return w / w.sum()


def starts_for(n: int, lo: np.ndarray, hi: np.ndarray, seed: int) -> list[np.ndarray]:
    rng = Lcg(seed)
    out = [np.clip(np.full(n, 1.0 / n), lo, hi)]
    for _ in range(4):
        raw = np.array([rng.uniform() + 0.05 for _ in range(n)])
        candidate = np.clip(raw / raw.sum(), lo, hi)
        out.append(candidate / candidate.sum())
    return out


def bounds_arrays(n: int, low, high) -> tuple[np.ndarray, np.ndarray]:
    lo = np.full(n, float(low)) if np.isscalar(low) else np.asarray(low, dtype=float)
    hi = np.full(n, float(high)) if np.isscalar(high) else np.asarray(high, dtype=float)
    return lo, hi


def min_variance_case(name: str, cov: np.ndarray, low, high, seed: int) -> dict:
    n = cov.shape[0]
    lo, hi = bounds_arrays(n, low, high)
    w = solve_slsqp(
        lambda w: float(w @ cov @ w),
        lambda w: 2.0 * (cov @ w),
        n, lo, hi, starts_for(n, lo, hi, seed),
    )
    return {
        "name": name,
        "fn": "minVariance",
        "input": {"cov": cov.tolist(), "l": lo.tolist(), "u": hi.tolist()},
        "expected": {"weights": w.tolist(), "volatility": float(math.sqrt(w @ cov @ w))},
        "tol": TOL,
    }


def mean_variance_case(name: str, cov: np.ndarray, mu: np.ndarray, tau: float, low, high, seed: int) -> dict:
    n = cov.shape[0]
    lo, hi = bounds_arrays(n, low, high)
    w = solve_slsqp(
        lambda w: float(0.5 * w @ cov @ w - tau * (mu @ w)),
        lambda w: cov @ w - tau * mu,
        n, lo, hi, starts_for(n, lo, hi, seed),
    )
    return {
        "name": name,
        "fn": "meanVariance",
        "input": {"cov": cov.tolist(), "mu": mu.tolist(), "tau": tau, "l": lo.tolist(), "u": hi.tolist()},
        "expected": {"weights": w.tolist(), "expectedReturn": float(mu @ w)},
        "tol": TOL,
    }


def max_sharpe_case(name: str, cov: np.ndarray, mu: np.ndarray, rf: float, low, high, seed: int) -> dict:
    n = cov.shape[0]
    lo, hi = bounds_arrays(n, low, high)

    def neg_sharpe(w):
        vol = math.sqrt(max(1e-300, w @ cov @ w))
        return -float((mu @ w - rf) / vol)

    def grad(w):
        var = max(1e-300, float(w @ cov @ w))
        vol = math.sqrt(var)
        excess = float(mu @ w - rf)
        return -(mu / vol - excess * (cov @ w) / (vol * var))

    w = solve_slsqp(neg_sharpe, grad, n, lo, hi, starts_for(n, lo, hi, seed))
    vol = float(math.sqrt(w @ cov @ w))
    return {
        "name": name,
        "fn": "maxSharpe",
        "input": {"cov": cov.tolist(), "mu": mu.tolist(), "rf": rf, "l": lo.tolist(), "u": hi.tolist()},
        "expected": {"weights": w.tolist(), "sharpe": float((mu @ w - rf) / vol), "volatility": vol},
        "tol": TOL,
    }


def risk_parity_case(name: str, cov: np.ndarray) -> dict:
    """Paridad de riesgo por el sistema de primer orden, no por descenso coordinado.

    Con y sin normalizar, la condición de contribuciones iguales es (Sy)_i = b_i / y_i. Eso es un
    sistema de n ecuaciones que `root` resuelve a precisión de máquina, y es un camino distinto al
    del JS (descenso coordinado cíclico).
    """
    n = cov.shape[0]
    b = np.full(n, 1.0 / n)

    def equations(y):
        return cov @ y - b / y

    y0 = np.sqrt(b / np.diag(cov))
    res = root(equations, y0, jac=lambda y: cov + np.diag(b / (y * y)), method="hybr", options={"xtol": 1e-13})
    residual = float(np.max(np.abs(equations(res.x))))
    # `hybr` marca success=False cuando ya no puede mejorar xtol aunque el residuo sea de máquina:
    # lo que importa es el residuo, no la bandera.
    if residual > 1e-14 * max(1.0, float(np.max(np.abs(cov @ res.x)))):
        raise RuntimeError(f"root no convergió con n = {n}: residuo {residual:.3e}")
    w = res.x / res.x.sum()
    portfolio_var = float(w @ cov @ w)
    contributions = (w * (cov @ w) / portfolio_var).tolist()
    return {
        "name": name,
        "fn": "riskParity",
        "input": {"cov": cov.tolist()},
        "expected": {"weights": w.tolist(), "riskContributions": contributions},
        "tol": TOL,
    }


def projection_case(name: str, v: list[float], low, high, seed: int) -> dict:
    n = len(v)
    lo, hi = bounds_arrays(n, low, high)
    target = np.asarray(v, dtype=float)
    w = solve_slsqp(
        lambda w: float(0.5 * np.sum((w - target) ** 2)),
        lambda w: w - target,
        n, lo, hi, starts_for(n, lo, hi, seed),
    )
    return {
        "name": name,
        "fn": "projectBoxSimplex",
        "input": {"v": v, "l": lo.tolist(), "u": hi.tolist()},
        "expected": {"weights": w.tolist()},
        "tol": TOL,
    }


def main() -> None:
    cases: list[dict] = []

    for n in range(3, 11):
        cov, mu = make_problem(n, seed=1000 + n)
        cases.append(min_variance_case(f"minima varianza, {n} activos, solo largos", cov, 0.0, 1.0, 2000 + n))
        cases.append(max_sharpe_case(f"tangente, {n} activos, rf 4 %", cov, mu, 0.04, 0.0, 1.0, 3000 + n))
        cases.append(risk_parity_case(f"paridad de riesgo, {n} activos", cov))

    cov5, mu5 = make_problem(5, seed=1005)
    cases.append(min_variance_case("minima varianza con tope de 30 % por activo, 5 activos", cov5, 0.0, 0.30, 4005))
    cases.append(min_variance_case("minima varianza con piso de 5 % por activo, 5 activos", cov5, 0.05, 1.0, 4105))
    cases.append(max_sharpe_case("tangente con tope de 25 %, 5 activos", cov5, mu5, 0.04, 0.0, 0.25, 4205))

    cov8, mu8 = make_problem(8, seed=1008)
    cases.append(min_variance_case("minima varianza con tope de 20 %, 8 activos", cov8, 0.0, 0.20, 4008))
    cases.append(mean_variance_case("media-varianza tau = 0.5, 8 activos", cov8, mu8, 0.5, 0.0, 1.0, 4108))
    cases.append(mean_variance_case("media-varianza tau = 3, 8 activos con tope de 25 %", cov8, mu8, 3.0, 0.0, 0.25, 4208))

    cov6, mu6 = make_problem(6, seed=1006)
    cases.append(
        min_variance_case(
            "minima varianza con caja distinta por activo, 6 activos",
            cov6,
            [0.0, 0.05, 0.0, 0.10, 0.0, 0.0],
            [0.40, 0.25, 0.50, 0.30, 0.35, 0.20],
            4006,
        )
    )
    cases.append(mean_variance_case("media-varianza tau = 1.5, 6 activos", cov6, mu6, 1.5, 0.0, 1.0, 4106))

    cases.append(projection_case("proyeccion del spec: v=[.5,.3,.2] con tope .4", [0.5, 0.3, 0.2], 0.0, 0.4, 5001))
    cases.append(projection_case("proyeccion de un punto negativo", [-0.4, 0.9, 0.7, 0.1], 0.0, 1.0, 5002))
    cases.append(
        projection_case(
            "proyeccion con piso y techo por activo",
            [0.9, -0.2, 0.15, 0.4, 0.05],
            [0.05, 0.05, 0.0, 0.0, 0.10],
            [0.40, 0.40, 0.30, 0.50, 0.30],
            5003,
        )
    )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"cases": cases}, indent=2) + "\n", encoding="utf-8")
    print(f"{OUT.relative_to(ROOT)}: {len(cases)} casos")
    for case in cases:
        weights = case["expected"]["weights"]
        print(f"  {case['fn']:>18}  n={len(weights):>2}  {case['name']}")


if __name__ == "__main__":
    main()
