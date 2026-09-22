#!/usr/bin/env python
"""Respuestas conocidas de src/lib/finance/covariance.js, sacadas de PyPortfolioOpt y pandas.

Escribe tests/golden/covariance.json con {cases: [{name, fn, input, expected, tol}]}, que
covariance.test.js recorre. La referencia de la contracción es

    CovarianceShrinkage(X, returns_data=True, frequency=1).ledoit_wolf("constant_correlation")

con frequency=1 para que la covarianza salga por periodo, sin anualizar: anualizar es una
multiplicación aparte (annualize(cov, k)) y mezclarlas escondería un error de factor.

Correr con el venv de referencia, que es el único que tiene PyPortfolioOpt:

    "/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv-golden/bin/python" \
        scripts/golden/covariance_golden.py

El generador de datos es un congruencial lineal escrito aquí mismo, no numpy.random: así el JSON
sale idéntico corrida tras corrida y en cualquier máquina, que es lo que hace que "git status
limpio" signifique algo.
"""

from __future__ import annotations

import json
import math
import pathlib

import pandas as pd
from pypfopt.risk_models import CovarianceShrinkage

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "tests" / "golden" / "covariance.json"


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


def factor_panel(periods: int, assets: int, seed: int, extra_correlated: bool = False) -> list[list[float]]:
    """Panel T x N de un modelo de dos factores, redondeado a 12 decimales para que el JSON sea corto.

    Dos factores y no uno a propósito: con un solo factor las correlaciones salen casi todas
    iguales, el objetivo de correlación constante queda perfecto y delta se pega en 1, que es el
    caso recortado y no prueba nada de la fórmula. Con un factor de mercado y otro sectorial las
    correlaciones son heterogéneas y delta cae adentro de (0, 1), que es lo que hay que comparar.
    """
    rng = Lcg(seed)
    betas = [0.4 + 0.22 * ((i * 5) % 7) for i in range(assets)]
    sector = [1.0 if i % 2 == 0 else -0.8 for i in range(assets)]
    sigmas = [0.010 + 0.007 * ((i * 7) % 5) for i in range(assets)]
    mus = [0.0004 + 0.0002 * ((i * 3) % 4) for i in range(assets)]
    rows: list[list[float]] = []
    for _ in range(periods):
        market = rng.normal() * 0.016
        sect = rng.normal() * 0.011
        row = [
            round(mus[i] + betas[i] * market + sector[i] * sect + rng.normal() * sigmas[i], 12)
            for i in range(assets)
        ]
        if extra_correlated and assets >= 2:
            # Un par casi colineal: es el caso donde la covarianza muestral se porta peor.
            row[1] = round(0.97 * row[0] + 0.03 * row[1], 12)
        rows.append(row)
    return rows


def ledoit_wolf_case(name: str, panel: list[list[float]], tol: float) -> dict:
    frame = pd.DataFrame(panel, columns=[f"A{i}" for i in range(len(panel[0]))])
    shrinkage = CovarianceShrinkage(frame, returns_data=True, frequency=1)
    cov = shrinkage.ledoit_wolf(shrinkage_target="constant_correlation")
    return {
        "name": name,
        "fn": "ledoitWolfConstantCorrelation",
        "input": {"returns": panel},
        "expected": {"cov": cov.values.tolist(), "shrinkage": float(shrinkage.delta)},
        "tol": tol,
    }


def sample_cov_case(name: str, panel: list[list[float]], tol: float) -> dict:
    frame = pd.DataFrame(panel, columns=[f"A{i}" for i in range(len(panel[0]))])
    return {
        "name": name,
        "fn": "sampleCov",
        "input": {"returns": panel},
        "expected": {"cov": frame.cov().values.tolist()},
        "tol": tol,
    }


def main() -> None:
    panel_60x5 = factor_panel(60, 5, seed=20260922)
    panel_120x8 = factor_panel(120, 8, seed=777)
    panel_near_singular = factor_panel(48, 4, seed=13, extra_correlated=True)
    # Con N = 2 el objetivo de correlación constante ES la covarianza muestral (solo hay una
    # correlación que promediar), así que gamma = 0, delta queda 0/0 y no se puede comparar.
    # PyPortfolioOpt saca 1 por la división entre cero; covariance.js saca 0. La matriz es la
    # misma en los dos casos, y eso se prueba aparte en covariance.test.js. Por eso el panel chico
    # del golden es de 3 activos.
    panel_small = [
        [0.010, -0.020, 0.004],
        [-0.005, 0.030, -0.011],
        [0.020, 0.010, 0.018],
        [0.000, -0.010, 0.007],
        [0.014, 0.006, -0.003],
        [-0.009, -0.004, 0.012],
    ]
    panel_pair = [[0.01, -0.02], [-0.005, 0.03], [0.02, 0.01], [0.0, -0.01]]

    cases = [
        ledoit_wolf_case("panel fijo 60x5, el del spec", panel_60x5, 1e-10),
        ledoit_wolf_case("panel 120x8", panel_120x8, 1e-10),
        ledoit_wolf_case("panel 48x4 con un par casi colineal", panel_near_singular, 1e-10),
        ledoit_wolf_case("panel chico 6x3 escrito a mano", panel_small, 1e-12),
        sample_cov_case("covarianza muestral 60x5", panel_60x5, 1e-12),
        sample_cov_case("covarianza muestral 4x2 a mano", panel_pair, 1e-14),
    ]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"cases": cases}, indent=2) + "\n", encoding="utf-8")
    print(f"{OUT.relative_to(ROOT)}: {len(cases)} casos")
    for case in cases:
        if case["fn"] == "ledoitWolfConstantCorrelation":
            print(f"  {case['name']}: delta = {case['expected']['shrinkage']:.12f}")


if __name__ == "__main__":
    main()
