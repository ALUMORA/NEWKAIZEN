"""Referencia para src/lib/finance/fx.js.

Escribe tests/golden/fx.json. Cada caso de pnlDecomposition trae además el total calculado por el
camino largo (q·P₁·X₁ − q·P₀·X₀), así que el golden comprueba que la separación en efecto precio y
efecto tipo de cambio no se come ni inventa nada.

    "/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv-golden/bin/python" \
        scripts/golden/fx_golden.py
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
TOL = 1e-9


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

    scenarios = [
        (10.0, 150.0, 180.0, 17.0, 19.0),
        (25.0, 200.0, 170.0, 20.5, 18.25),
        (3.0, 1_250.0, 1_250.0, 16.75, 18.9),
        (120.0, 42.5, 47.8, 18.0, 18.0),
    ]
    scenarios += [
        (
            float(round(rng.uniform(1, 500), 4)),
            float(round(rng.uniform(5, 900), 4)),
            float(round(rng.uniform(5, 900), 4)),
            float(round(rng.uniform(15, 22), 4)),
            float(round(rng.uniform(15, 22), 4)),
        )
        for _ in range(8)
    ]

    for i, (q, p0, p1, x0, x1) in enumerate(scenarios):
        price_effect = q * (p1 - p0) * x0
        fx_effect = q * p1 * (x1 - x0)
        direct = q * p1 * x1 - q * p0 * x0
        assert abs(price_effect + fx_effect - direct) < 1e-6
        cases.append(
            {
                "name": f"pnlDecomposition/escenario-{i}",
                "fn": "pnlDecomposition",
                "input": {"quantity": q, "price0": p0, "price1": p1, "fx0": x0, "fx1": x1},
                "expected": {"total": direct, "priceEffect": price_effect, "fxEffect": fx_effect, "cross": 0.0},
                "tol": TOL,
            }
        )

    for amount, fx in ((1_000.0, 18.4321), (2_500.75, 17.0), (0.0, 19.5)):
        cases += [
            {
                "name": f"toCurrency/usd-a-mxn-{amount}",
                "fn": "toCurrency",
                "input": {"amount": amount, "from": "USD", "to": "MXN", "usdmxn": fx},
                "expected": amount * fx,
                "tol": TOL,
            },
            {
                "name": f"toCurrency/mxn-a-usd-{amount}",
                "fn": "toCurrency",
                "input": {"amount": amount, "from": "MXN", "to": "USD", "usdmxn": fx},
                "expected": amount / fx,
                "tol": TOL,
            },
        ]

    for local, x0, x1 in ((0.05, 17.0, 18.0), (-0.12, 20.0, 18.5), (0.0, 18.0, 18.0)):
        cases.append(
            {
                "name": f"returnInBaseCurrency/{local}-{x0}-{x1}",
                "fn": "returnInBaseCurrency",
                "input": {"localReturn": local, "fx0": x0, "fx1": x1},
                "expected": (1 + local) * (x1 / x0) - 1,
                "tol": 1e-12,
            }
        )
    return cases


if __name__ == "__main__":
    write("fx", build())
