"""Referencia independiente del rebalanceo en acciones enteras (src/lib/finance/rebalance.js).

Escribe tests/golden/rebalance.json con {cases:[{name, input, expected, tol}]}.

Dos comprobaciones distintas:
1. Una implementacion del metodo del spec (piso y luego compra codiciosa) escrita de cero aqui.
2. Para los casos chicos, una busqueda exhaustiva sobre TODAS las combinaciones enteras que caben
   en el valor total. Sirve para medir que tan lejos queda el metodo codicioso del optimo, y el
   resultado se guarda en `expected.optimal` para que quede por escrito en vez de suponerse.

Se corre con el venv de referencia:
    "/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv-golden/bin/python" \
        scripts/golden/rebalance_golden.py
"""

from __future__ import annotations

import itertools
import json
import math
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / "tests" / "golden" / "rebalance.json"
TOL = 1e-9
EPS = 1e-9


def deviation(qty, prices, targets, value):
    return sum(abs(qty[s] * prices[s] / value - targets[s]) for s in targets)


def plan(holdings, prices, targets, cash, allow_sell=True):
    symbols = sorted(set(list(targets) + list(holdings)))
    current = {s: holdings.get(s, 0) for s in symbols}
    value = cash + sum(current[s] * prices[s] for s in symbols)
    total = sum(targets.get(s, 0) for s in symbols)
    target = {s: (targets.get(s, 0) / total if total > 0 else 0.0) for s in symbols}

    qty = {}
    for s in symbols:
        base = int(target[s] * value / prices[s] + EPS) if allow_sell else current[s]
        # el delta va en enteros: la cola fraccionaria de lo que ya se tiene se queda quieta
        qty[s] = current[s] + math.trunc(base - current[s])
    left = value - sum(qty[s] * prices[s] for s in symbols)

    while True:
        best, best_gain = None, 1e-12
        for s in symbols:
            if prices[s] > left + EPS:
                continue
            w = qty[s] * prices[s] / value
            gain = abs(w - target[s]) - abs(w + prices[s] / value - target[s])
            if gain > best_gain + 1e-15:
                best, best_gain = s, gain
        if best is None:
            break
        qty[best] += 1
        left -= prices[best]

    # mejora local por pares: vender uno de y para comprar uno de x
    def pair_gain(s, delta):
        w = qty[s] * prices[s] / value
        return abs(w - target[s]) - abs(w + delta * prices[s] / value - target[s])

    if allow_sell:
        while True:
            pair, best_gain = None, 1e-12
            units = 0
            for x in symbols:
                for y in symbols:
                    if x == y:
                        continue
                    k = math.ceil((prices[x] - left - EPS) / prices[y])
                    if k < 1 or qty[y] < k - EPS:
                        continue
                    gain = pair_gain(x, 1) + pair_gain(y, -k)
                    if gain > best_gain + 1e-15:
                        pair, best_gain, units = (x, y), gain, k
            if pair is None:
                break
            qty[pair[0]] += 1
            qty[pair[1]] -= units
            left += units * prices[pair[1]] - prices[pair[0]]

    return {
        "holdings": qty,
        "cash": left,
        "weights": {s: qty[s] * prices[s] / value for s in symbols},
        "value": value,
        "deviation": {"before": deviation(current, prices, target, value), "after": deviation(qty, prices, target, value)},
        "targets": target,
    }


def brute_force(prices, targets, value, cap=400_000):
    symbols = sorted(targets)
    ranges = [range(0, int(value / prices[s]) + 1) for s in symbols]
    size = 1
    for r in ranges:
        size *= len(r)
    if size > cap:
        return None
    best, best_dev = None, float("inf")
    for combo in itertools.product(*ranges):
        spend = sum(combo[i] * prices[symbols[i]] for i in range(len(symbols)))
        if spend > value + EPS:
            continue
        qty = dict(zip(symbols, combo, strict=True))
        d = deviation(qty, prices, targets, value)
        if d < best_dev - 1e-12:
            best, best_dev = qty, d
    return {"holdings": best, "deviation": best_dev}


CASES = [
    {
        "name": "caso-conocido-50-50-precios-300-700",
        "input": {"holdings": {}, "prices": {"A": 300, "B": 700}, "targets": {"A": 0.5, "B": 0.5}, "cash": 10000, "allowSell": True},
    },
    {
        "name": "tres-activos-con-efectivo",
        "input": {
            "holdings": {},
            "prices": {"AAPL": 137, "WALMEX.MX": 51.2, "FUNO11.MX": 23.4},
            "targets": {"AAPL": 0.4, "WALMEX.MX": 0.35, "FUNO11.MX": 0.25},
            "cash": 50000,
            "allowSell": True,
        },
    },
    {
        "name": "ya-tiene-posiciones-y-hay-que-vender",
        "input": {
            "holdings": {"A": 40, "B": 5},
            "prices": {"A": 120, "B": 900},
            "targets": {"A": 0.5, "B": 0.5},
            "cash": 500,
            "allowSell": True,
        },
    },
    {
        "name": "sin-vender-solo-invierte-el-efectivo",
        "input": {
            "holdings": {"A": 40, "B": 5},
            "prices": {"A": 120, "B": 900},
            "targets": {"A": 0.5, "B": 0.5},
            "cash": 4000,
            "allowSell": False,
        },
    },
    {
        "name": "objetivo-cero-vende-todo",
        "input": {
            "holdings": {"A": 12, "B": 3},
            "prices": {"A": 250, "B": 1000},
            "targets": {"A": 1.0, "B": 0.0},
            "cash": 0,
            "allowSell": True,
        },
    },
    {
        "name": "objetivos-que-no-suman-uno",
        "input": {
            "holdings": {},
            "prices": {"A": 95, "B": 310},
            "targets": {"A": 30, "B": 70},
            "cash": 20000,
            "allowSell": True,
        },
    },
    {
        "name": "greedy-vs-optimo",
        "input": {
            "holdings": {"A": 10, "B": 2},
            "prices": {"A": 250, "B": 1500},
            "targets": {"A": 0.6, "B": 0.4},
            "cash": 1200,
            "allowSell": True,
        },
    },
    {
        "name": "precio-caro-que-no-alcanza",
        "input": {
            "holdings": {},
            "prices": {"A": 9000, "B": 40},
            "targets": {"A": 0.5, "B": 0.5},
            "cash": 5000,
            "allowSell": True,
        },
    },
]


def build():
    cases = []
    for case in CASES:
        data = case["input"]
        result = plan(data["holdings"], data["prices"], data["targets"], data["cash"], data["allowSell"])
        optimal = brute_force(data["prices"], result["targets"], result["value"])
        expected = {
            "holdings": result["holdings"],
            "cash": result["cash"],
            "weights": result["weights"],
            "value": result["value"],
            "deviation": result["deviation"],
        }
        if optimal is not None:
            expected["optimal"] = {"holdings": optimal["holdings"], "deviation": optimal["deviation"]}
            expected["matchesOptimal"] = abs(optimal["deviation"] - result["deviation"]["after"]) < 1e-12
        cases.append({"name": case["name"], "input": data, "expected": expected, "tol": TOL})
    return {"cases": cases}


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = build()
    OUT.write_text(json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")
    for case in payload["cases"]:
        exp = case["expected"]
        mark = "" if exp.get("matchesOptimal", True) else "  (el codicioso no llega al optimo)"
        print(f"{case['name']}: {exp['holdings']} efectivo={exp['cash']:.2f} desv={exp['deviation']['after']:.6f}{mark}")


if __name__ == "__main__":
    main()
