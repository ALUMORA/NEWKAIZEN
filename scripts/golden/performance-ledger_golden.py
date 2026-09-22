"""Referencia independiente del TWR encadenado (src/lib/finance/performance-ledger.js).

Escribe tests/golden/performance-ledger.json con {cases:[{name, input, expected, tol}]}.

La referencia NO encadena rendimientos: usa el metodo del valor de la unidad, que es la otra forma
clasica de calcular el TWR. Se arranca con una unidad, cada flujo externo compra o vende unidades
al precio de la unidad del corte anterior, y el rendimiento es el cambio del precio de la unidad.
Que las dos formas den el mismo numero es justo lo que se quiere comprobar.

La serie de valor (`valueSeries`) no se replica aqui: reimplementar el libro de movimientos en
Python seria copiar el golden de ledger. Esa funcion va con casos a mano en el archivo de pruebas
de JavaScript, armados para que su salida sea exactamente el caso `deposito-a-media-serie`.

Se corre con el venv de referencia:
    "/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv-golden/bin/python" \
        scripts/golden/performance-ledger_golden.py
"""

from __future__ import annotations

import json
import random
from pathlib import Path

import numpy as np

OUT = Path(__file__).resolve().parents[2] / "tests" / "golden" / "performance-ledger.json"
TOL = 1e-9


def twr_by_units(values, flows):
    """TWR por valor de la unidad. flows[i] entra al inicio del periodo i."""
    values = np.asarray(values, dtype=float)
    flows = np.asarray(flows, dtype=float)
    if values.size < 2 or values[0] <= 0:
        return None, None
    units = 1.0
    unit_price = values[0] / units
    prices = [unit_price]
    for i in range(1, values.size):
        flow = float(flows[i]) if i < flows.size else 0.0
        if flow != 0.0:
            units += flow / unit_price
        if units <= 0:
            return None, None
        unit_price = float(values[i]) / units
        prices.append(unit_price)
    total = prices[-1] / prices[0] - 1.0
    returns = [prices[i] / prices[i - 1] - 1.0 for i in range(1, len(prices))]
    return total, returns


def random_case(name, seed):
    rng = random.Random(seed)
    n = rng.randint(8, 20)
    values = [round(rng.uniform(50_000, 150_000), 2)]
    flows = [0.0]
    for _ in range(1, n):
        flow = 0.0
        if rng.random() < 0.35:
            flow = round(rng.uniform(-20_000, 40_000), 2)
        base = values[-1] + flow
        if base <= 1000:
            flow = 0.0
            base = values[-1]
        values.append(round(base * (1 + rng.uniform(-0.09, 0.11)), 2))
        flows.append(flow)
    return {"name": name, "input": {"values": values, "flows": flows}, "tol": TOL}


def build():
    cases = [
        {
            "name": "deposito-a-media-serie",
            "input": {"values": [100, 110, 160, 144], "flows": [0, 0, 50, 0]},
            "tol": TOL,
        },
        {
            "name": "sin-flujos",
            "input": {"values": [100, 105, 99, 120], "flows": [0, 0, 0, 0]},
            "tol": TOL,
        },
        {
            "name": "retiro-a-media-serie",
            "input": {"values": [200_000, 215_000, 170_000, 181_000], "flows": [0, 0, -50_000, 0]},
            "tol": TOL,
        },
        {
            "name": "aportacion-mensual",
            "input": {
                "values": [10_000, 15_100, 20_400, 25_300, 30_900, 36_200],
                "flows": [0, 5_000, 5_000, 5_000, 5_000, 5_000],
            },
            "tol": TOL,
        },
        {
            "name": "flujo-en-el-primer-corte-no-cuenta",
            "input": {"values": [100, 110], "flows": [999, 0]},
            "tol": TOL,
        },
    ]
    for seed in (7, 13, 31, 64):
        cases.append(random_case(f"serie-aleatoria-{seed}", seed))

    for case in cases:
        total, returns = twr_by_units(case["input"]["values"], case["input"]["flows"])
        if total is None:
            raise SystemExit(f"caso sin TWR: {case['name']}")
        case["expected"] = {"twr": total, "returns": returns}
    return {"cases": cases}


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = build()
    OUT.write_text(json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")
    for case in payload["cases"]:
        print(f"{case['name']}: twr={case['expected']['twr']:.12f}")


if __name__ == "__main__":
    main()
