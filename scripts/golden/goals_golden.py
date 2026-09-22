"""Genera tests/golden/goals.json: respuestas de referencia para src/lib/finance/goals.js.

Se corre con el venv de referencia:

    "/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv-golden/bin/python" \
        scripts/golden/goals_golden.py

La referencia no repite el algoritmo del JS:

- `requiredContribution` en el JS se resuelve por BISECCIÓN sobre simulaciones. Aquí se resuelve
  despejando la anualidad, que es la respuesta exacta cuando sigma = 0:
  C = (meta − W0·R^n) / Σ_{j aporta} g^j·R^(n−j). Si la bisección tuviera un sesgo, se vería.
- `retirementIncome` es la recurrencia del retiro indexado a la inflación, que es su definición.
- `probabilityOfGoal` con sigma = 0 solo puede dar 0 o 1, y ahí se ve si la comparación es con
  "mayor o igual" y si el caso real deflacta la meta en vez del saldo.

`tol` es tolerancia RELATIVA: se cumple si |a − b| ≤ tol · max(1, |b|).
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "tests" / "golden" / "goals.json"


def annuity_factor(*, steps: int, every: int, gross_step: float, growth_step: float) -> float:
    """Σ_{j = 0, every, 2·every, ... < steps} g^j · R^(steps − j)."""
    total = 0.0
    j = 0
    while j < steps:
        total += (growth_step**j) * (gross_step ** (steps - j))
        j += every
    return total


def required_contribution_case(name: str, options: dict, tol: float = 1e-8) -> dict:
    steps_per_year = options.get("stepsPerYear", 12)
    steps = round(options["years"] * steps_per_year)
    per_year = 12 if options.get("contributionFrequency", "monthly") == "monthly" else 1
    every = steps_per_year // per_year
    inflation = options.get("inflation", 0.0)
    growth = options.get("contributionGrowth")
    if growth is None:
        growth = inflation
    growth_step = 1.0 if growth == 0 else (1.0 + growth) ** (1.0 / steps_per_year)
    gross_step = (1.0 + options["mu"]) ** (1.0 / steps_per_year)
    assert options.get("sigma", 0.0) == 0.0, "sigma tiene que ser 0 para tener respuesta cerrada"

    target = options["target"]
    if options.get("real"):
        target = target * (1.0 + inflation) ** (steps / steps_per_year)
    initial = options.get("initial", 0.0)
    numerator = target - initial * gross_step**steps
    factor = annuity_factor(steps=steps, every=every, gross_step=gross_step, growth_step=growth_step)
    contribution = max(0.0, numerator / factor)
    return {
        "name": name,
        "kind": "requiredContribution",
        "input": options,
        "expected": {"contribution": contribution},
        "tol": tol,
    }


def retirement_case(name: str, options: dict, tol: float = 1e-12) -> dict:
    balance = options["balance"]
    rate = options.get("withdrawalRate", 0.04)
    nominal = options.get("nominalReturn", 0.0)
    inflation = options.get("inflation", 0.0)
    years = options.get("years", 30)

    planned = balance * rate
    current = balance
    balances = [balance]
    withdrawals = []
    total = 0.0
    depleted = None
    for year in range(1, years + 1):
        taken = min(planned, current)
        current = (current - taken) * (1.0 + nominal)
        if current <= 0:
            current = 0.0
            if depleted is None:
                depleted = year
        total += taken
        withdrawals.append(taken)
        balances.append(current)
        planned *= 1.0 + inflation

    return {
        "name": name,
        "kind": "retirementIncome",
        "input": options,
        "expected": {
            "firstYearWithdrawal": balance * rate,
            "firstMonthWithdrawal": balance * rate / 12.0,
            "withdrawals": withdrawals,
            "balances": balances,
            "depletedYear": depleted,
            "totalWithdrawn": total,
            "finalBalance": current,
            "finalBalanceReal": current / (1.0 + inflation) ** years,
        },
        "tol": tol,
    }


def main() -> None:
    cases: list[dict] = []
    monthly_1pct = 1.01**12 - 1.0

    # Respuesta conocida del plan: con 100,000 iniciales y 12 meses al 1 % mensual, llegar a
    # 176,729.14322984173 pide exactamente 5,000 al mes.
    cases.append(
        required_contribution_case(
            "aportación requerida = 5,000 (respuesta conocida del caso sigma=0)",
            {
                "target": 176729.14322984173,
                "years": 1,
                "initial": 100000,
                "mu": monthly_1pct,
                "sigma": 0,
                "inflation": 0,
                "contributionGrowth": 0,
                "stepsPerYear": 12,
                "contributionFrequency": "monthly",
                "probability": 0.5,
                "paths": 1,
                "seed": "golden-goals",
                "tolerance": 1e-7,
                "maxIterations": 300,
            },
        )
    )
    cases.append(
        required_contribution_case(
            "meta a 15 años con aportación indexada a la inflación",
            {
                "target": 3000000,
                "years": 15,
                "initial": 200000,
                "mu": 0.09,
                "sigma": 0,
                "inflation": 0.04,
                "contributionGrowth": None,
                "stepsPerYear": 12,
                "contributionFrequency": "monthly",
                "probability": 0.5,
                "paths": 1,
                "seed": "golden-goals",
                "tolerance": 1e-6,
                "maxIterations": 300,
            },
        )
    )
    cases.append(
        required_contribution_case(
            "meta en pesos de hoy (real) con aportación anual",
            {
                "target": 1500000,
                "years": 20,
                "initial": 0,
                "mu": 0.085,
                "sigma": 0,
                "inflation": 0.045,
                "contributionGrowth": 0.03,
                "stepsPerYear": 12,
                "contributionFrequency": "annual",
                "probability": 0.5,
                "paths": 1,
                "real": True,
                "seed": "golden-goals",
                "tolerance": 1e-6,
                "maxIterations": 300,
            },
        )
    )
    cases.append(
        required_contribution_case(
            "meta ya alcanzada con el saldo inicial: aportación 0",
            {
                "target": 100000,
                "years": 5,
                "initial": 500000,
                "mu": 0.06,
                "sigma": 0,
                "inflation": 0,
                "contributionGrowth": 0,
                "stepsPerYear": 12,
                "contributionFrequency": "monthly",
                "probability": 0.5,
                "paths": 1,
                "seed": "golden-goals",
                "tolerance": 1e-6,
                "maxIterations": 300,
            },
        )
    )

    cases.append(
        retirement_case(
            "retiro 4 % indexado, rendimiento 5 %, inflación 3 %, 3 años",
            {"balance": 1000000, "withdrawalRate": 0.04, "nominalReturn": 0.05, "inflation": 0.03, "years": 3},
        )
    )
    cases.append(
        retirement_case(
            "retiro 4 % indexado, 30 años, rendimiento real cero",
            {"balance": 2500000, "withdrawalRate": 0.04, "nominalReturn": 0.04, "inflation": 0.04, "years": 30},
        )
    )
    cases.append(
        retirement_case(
            "el saldo se agota: retiro 20 % sin rendimiento",
            {"balance": 100000, "withdrawalRate": 0.2, "nominalReturn": 0.0, "inflation": 0.0, "years": 8},
        )
    )

    # Probabilidad con sigma = 0: la trayectoria es una sola, así que solo puede ser 0 o 1.
    base_plan = {
        "initial": 100000,
        "contribution": 5000,
        "contributionFrequency": "monthly",
        "contributionGrowth": 0,
        "years": 1,
        "stepsPerYear": 12,
        "mu": monthly_1pct,
        "sigma": 0,
        "inflation": 0,
        "paths": 9,
        "seed": "golden-goals",
    }
    # Nada de metas pegadas al saldo exacto: ahí la respuesta depende del último bit y la prueba
    # dejaría de medir la comparación para medir el redondeo. El caso "la meta exacta cuenta como
    # alcanzada" vive en montecarlo.test.js, contra el propio saldo de la simulación.
    for target, expected in [(176000.0, 1.0), (176729.0, 1.0), (176730.0, 0.0), (177000.0, 0.0)]:
        cases.append(
            {
                "name": f"probabilityOfGoal nominal meta={target}",
                "kind": "probabilityOfGoal",
                "input": {"sim": base_plan, "target": target, "real": False},
                "expected": expected,
                "tol": 0.0,
            }
        )

    inflated_plan = dict(base_plan, inflation=0.05, contributionGrowth=0)
    # Con inflación 5 % anual y 12 pasos, el deflactor final es 1.05.
    real_terminal = 176729.14322984173 / 1.05
    for target, expected in [(real_terminal - 1.0, 1.0), (real_terminal + 1.0, 0.0)]:
        cases.append(
            {
                "name": f"probabilityOfGoal real meta={target}",
                "kind": "probabilityOfGoal",
                "input": {"sim": inflated_plan, "target": target, "real": True},
                "expected": expected,
                "tol": 0.0,
            }
        )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"cases": cases}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{OUT.relative_to(ROOT)}: {len(cases)} casos")


if __name__ == "__main__":
    main()
