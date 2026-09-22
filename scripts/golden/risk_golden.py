"""Referencia en numpy para src/lib/finance/risk.js.

Escribe tests/golden/risk.json. Las contribuciones al riesgo se calculan con álgebra de matrices
de numpy y se verifica aquí mismo que suman la volatilidad del portafolio, que es la propiedad que
las hace útiles.

    "/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv-golden/bin/python" \
        scripts/golden/risk_golden.py
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

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


def random_cov(seed: int, n: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    panel = rng.normal(0.0005, 0.013, (180, n))
    return np.cov(panel, rowvar=False, ddof=1)


def build() -> list[dict]:
    cases: list[dict] = []

    weight_sets = [
        [0.5, 0.3, 0.2],
        [0.25, 0.25, 0.25, 0.25],
        [0.6, 0.15, 0.1, 0.1, 0.05],
        [0.9, 0.04, 0.03, 0.02, 0.01],
    ]
    for weights in weight_sets:
        w = np.array(weights)
        cases += [
            {
                "name": f"hhi/{len(weights)}-posiciones",
                "fn": "hhi",
                "input": {"weights": weights},
                "expected": float(np.sum(w**2)),
                "tol": TOL,
            },
            {
                "name": f"effectiveN/{len(weights)}-posiciones",
                "fn": "effectiveN",
                "input": {"weights": weights},
                "expected": float(1 / np.sum(w**2)),
                "tol": TOL,
            },
        ]

    for seed, weights, k in ((61, [0.5, 0.3, 0.2], 252), (62, [0.25, 0.25, 0.25, 0.25], 52), (63, [0.6, 0.15, 0.1, 0.1, 0.05], 12)):
        cov = random_cov(seed, len(weights))
        w = np.array(weights)
        cw = cov @ w
        var = float(w @ cw)
        vol = math.sqrt(var)
        contribution = w * (cw / vol)
        assert abs(contribution.sum() - vol) < 1e-14, "las contribuciones deben sumar la volatilidad"
        cases += [
            {
                "name": f"portfolioVol/{seed}-k{k}",
                "fn": "portfolioVol",
                "input": {"weights": weights, "cov": cov.tolist(), "k": k},
                "expected": vol * math.sqrt(k),
                "tol": TOL,
            },
            {
                "name": f"riskContributions/{seed}",
                "fn": "riskContributions",
                "input": {"weights": weights, "cov": cov.tolist()},
                "expected": {
                    "marginal": (cw / vol).tolist(),
                    "contribution": contribution.tolist(),
                    "percent": (contribution / vol).tolist(),
                    "volatility": vol,
                },
                "tol": TOL,
            },
        ]
    return cases


if __name__ == "__main__":
    write("risk", build())
