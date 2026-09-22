"""Referencia en numpy para src/lib/finance/backtest.js.

Escribe tests/golden/backtest.json. La estrategia de comprar y no mover se calcula con
participaciones fijas (shares), y la mezcla constante con el bucle de pesos que se van de lado y
regresan al objetivo, para que el golden mida la diferencia entre las dos y no las asuma iguales.

    "/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv-golden/bin/python" \
        scripts/golden/backtest_golden.py
"""

from __future__ import annotations

import json
from datetime import date, timedelta
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


def panel(seed: int, symbols: list[str], n: int) -> dict[str, np.ndarray]:
    rng = np.random.default_rng(seed)
    return {s: 100.0 * np.exp(np.cumsum(np.concatenate([[0.0], rng.normal(0.0006, 0.014, n - 1)]))) for s in symbols}


def constant_mix(returns: np.ndarray, target: np.ndarray, every: int | None) -> dict:
    """returns: matriz periodos x activos. every=None es dejar correr sin rebalancear."""
    w = target.copy()
    values = [1.0]
    period_returns = []
    turnover = 0.0
    rebalances = 0
    since = 0
    for t in range(returns.shape[0]):
        period = float(w @ returns[t])
        period_returns.append(period)
        values.append(values[-1] * (1 + period))
        w = w * (1 + returns[t]) / (1 + period)
        since += 1
        if every is not None and t < returns.shape[0] - 1 and since >= every:
            turnover += float(np.sum(np.abs(target - w)) / 2)
            w = target.copy()
            rebalances += 1
            since = 0
    return {
        "values": values,
        "returns": period_returns,
        "turnover": turnover,
        "rebalances": rebalances,
        "weights": w.tolist(),
    }


def build() -> list[dict]:
    cases: list[dict] = []
    first = date(2026, 1, 5)

    for seed, symbols, n, weights in ((71, ["A", "B"], 52, [0.5, 0.5]), (72, ["A", "B", "C"], 78, [0.5, 0.3, 0.2])):
        prices = panel(seed, symbols, n)
        dates = [(first + timedelta(days=7 * i)).isoformat() for i in range(n)]
        matrix = np.column_stack([prices[s] for s in symbols])
        target = np.array(weights)

        shares = target / matrix[0]
        values = matrix @ shares
        cases.append(
            {
                "name": f"buyAndHold/{seed}-{len(symbols)}-activos",
                "fn": "buyAndHold",
                "input": {
                    "pricePanel": {"dates": dates, "values": {s: prices[s].tolist() for s in symbols}},
                    "initialWeights": dict(zip(symbols, weights, strict=True)),
                },
                "expected": {
                    "values": values.tolist(),
                    "returns": (values[1:] / values[:-1] - 1).tolist(),
                    "turnover": 0.0,
                    "rebalances": 0,
                    "weights": dict(zip(symbols, (shares * matrix[-1] / values[-1]).tolist(), strict=True)),
                },
                "tol": TOL,
            }
        )

        returns = matrix[1:] / matrix[:-1] - 1
        return_dates = dates[1:]
        for label, every in (("cada-periodo", 1), ("cada-4", 4), ("nunca", None)):
            reference = constant_mix(returns, target, every)
            cases.append(
                {
                    "name": f"constantMix/{seed}-{label}",
                    "fn": "constantMix",
                    "input": {
                        "returnPanel": {
                            "dates": return_dates,
                            "values": {s: returns[:, i].tolist() for i, s in enumerate(symbols)},
                        },
                        "weights": dict(zip(symbols, weights, strict=True)),
                        "rebalanceEvery": every if every is not None else "never",
                    },
                    "expected": {
                        "values": reference["values"],
                        "returns": reference["returns"],
                        "turnover": reference["turnover"],
                        "rebalances": reference["rebalances"],
                        "weights": dict(zip(symbols, reference["weights"], strict=True)),
                    },
                    "tol": TOL,
                }
            )

        # Dejar correr sin rebalancear tiene que dar exactamente lo mismo que comprar y no mover.
        drift = constant_mix(returns, target, None)
        assert abs(drift["values"][-1] - values[-1] / values[0]) < 1e-12

    # Comparación contra un índice.
    rng = np.random.default_rng(73)
    port = 100.0 * np.cumprod(1 + np.concatenate([[0.0], rng.normal(0.001, 0.012, 103)]))
    bench = 100.0 * np.cumprod(1 + np.concatenate([[0.0], rng.normal(0.0008, 0.010, 103)]))
    pr = port[1:] / port[:-1] - 1
    br = bench[1:] / bench[:-1] - 1
    active = pr - br
    te = float(np.std(active, ddof=1) * np.sqrt(52))
    cases.append(
        {
            "name": "withBenchmark/semanal-k52",
            "fn": "withBenchmark",
            "input": {"values": port.tolist(), "benchValues": bench.tolist(), "k": 52},
            "expected": {
                "totalPort": float(port[-1] / port[0] - 1),
                "totalBench": float(bench[-1] / bench[0] - 1),
                "excess": float(port[-1] / port[0] - bench[-1] / bench[0]),
                "trackingError": te,
                "informationRatio": float(np.mean(active) * 52 / te),
                "n": int(active.size),
            },
            "tol": 1e-11,
        }
    )
    return cases


if __name__ == "__main__":
    write("backtest", build())
