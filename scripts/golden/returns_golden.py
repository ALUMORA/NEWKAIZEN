"""Referencia en numpy para src/lib/finance/returns.js.

Escribe tests/golden/returns.json con la forma {cases: [{name, fn, input, expected, tol}]}, que
src/lib/finance/returns.test.js recorre. Es determinista: la misma semilla da el mismo archivo, así
que volver a correrlo no debe dejar nada que commitear.

    "/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv-golden/bin/python" \
        scripts/golden/returns_golden.py
"""

from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
TOL = 1e-12


def clean(value):
    """numpy -> tipos de Python, para que json.dump sea estable entre corridas."""
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


def price_path(seed: int, n: int, start: float = 100.0, mu: float = 0.0004, sigma: float = 0.012) -> np.ndarray:
    rng = np.random.default_rng(seed)
    shocks = rng.normal(mu, sigma, n - 1)
    return start * np.exp(np.concatenate([[0.0], np.cumsum(shocks)]))


def iso_days(start: str, n: int, step: int) -> list[str]:
    first = date.fromisoformat(start)
    return [(first + timedelta(days=step * i)).isoformat() for i in range(n)]


def build() -> list[dict]:
    cases: list[dict] = []

    for seed, n in ((1, 12), (2, 60), (3, 150)):
        prices = price_path(seed, n)
        cases.append(
            {
                "name": f"simpleReturns/camino-{seed}-n{n}",
                "fn": "simpleReturns",
                "input": {"prices": prices.tolist()},
                "expected": (prices[1:] / prices[:-1] - 1).tolist(),
                "tol": TOL,
            }
        )
        cases.append(
            {
                "name": f"logReturns/camino-{seed}-n{n}",
                "fn": "logReturns",
                "input": {"prices": prices.tolist()},
                "expected": np.diff(np.log(prices)).tolist(),
                "tol": TOL,
            }
        )
        simple = prices[1:] / prices[:-1] - 1
        cases.append(
            {
                "name": f"cumulative/camino-{seed}-n{n}",
                "fn": "cumulative",
                "input": {"returns": simple.tolist()},
                "expected": np.concatenate([[1.0], np.cumprod(1 + simple)]).tolist(),
                "tol": TOL,
            }
        )
        cases.append(
            {
                "name": f"totalReturn/camino-{seed}-n{n}",
                "fn": "totalReturn",
                "input": {"returns": simple.tolist()},
                "expected": float(np.prod(1 + simple) - 1),
                "tol": TOL,
            }
        )

    # La identidad que amarra las dos formas de medir: exp(suma de logs) = producto de (1+simple).
    prices = price_path(7, 40)
    cases.append(
        {
            "name": "totalReturn/coincide-con-la-suma-de-logaritmos",
            "fn": "totalReturn",
            "input": {"returns": (prices[1:] / prices[:-1] - 1).tolist()},
            "expected": float(np.exp(np.sum(np.diff(np.log(prices)))) - 1),
            "tol": 1e-12,
        }
    )

    # Intervalo deducido por la mediana de los huecos.
    for step, expected in ((1, "1d"), (3, "1d"), (7, "1wk"), (30, "1mo")):
        cases.append(
            {
                "name": f"inferInterval/cada-{step}-dias",
                "fn": "inferInterval",
                "input": {"dates": iso_days("2026-01-05", 20, step)},
                "expected": expected,
                "tol": 0,
            }
        )

    # Panel: inner join por fecha, sin rellenar hacia adelante.
    a_dates = iso_days("2026-01-05", 30, 1)
    b_dates = [d for i, d in enumerate(a_dates) if i % 3 != 1]
    a_values = price_path(11, len(a_dates))
    b_values = price_path(12, len(b_dates), start=42.0)
    shared = [d for d in a_dates if d in set(b_dates)]
    a_map = dict(zip(a_dates, a_values.tolist(), strict=True))
    b_map = dict(zip(b_dates, b_values.tolist(), strict=True))
    cases.append(
        {
            "name": "alignPanel/dos-series-con-huecos",
            "fn": "alignPanel",
            "input": {
                "seriesBySymbol": {
                    "A": {"dates": a_dates, "values": a_values.tolist()},
                    "B": {"dates": b_dates, "values": b_values.tolist()},
                }
            },
            "expected": {
                "dates": shared,
                "values": {"A": [a_map[d] for d in shared], "B": [b_map[d] for d in shared]},
                "dropped": [],
            },
            "tol": TOL,
        }
    )
    cases.append(
        {
            "name": "panelReturns/se-calculan-despues-de-alinear",
            "fn": "panelReturns",
            "input": {
                "panel": {
                    "dates": shared,
                    "values": {"A": [a_map[d] for d in shared], "B": [b_map[d] for d in shared]},
                }
            },
            "expected": {
                "dates": shared[1:],
                "values": {
                    "A": (np.array([a_map[d] for d in shared])[1:] / np.array([a_map[d] for d in shared])[:-1] - 1).tolist(),
                    "B": (np.array([b_map[d] for d in shared])[1:] / np.array([b_map[d] for d in shared])[:-1] - 1).tolist(),
                },
            },
            "tol": TOL,
        }
    )
    return cases


if __name__ == "__main__":
    write("returns", build())
