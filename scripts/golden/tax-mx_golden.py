"""Referencia independiente del ISR por ganancias en bolsa (src/lib/finance/tax-mx.js).

Escribe tests/golden/tax-mx.json con {cases:[{name, input, expected, tol}]}.

La referencia lleva la aritmetica en Decimal con 28 digitos, o sea sin el error de punto flotante
del modulo de JavaScript, y el recorrido esta escrito desde el texto del art. 129 de la LISR: 10 %
sobre la ganancia neta del ejercicio, costo actualizado por INPC del mes anterior a la venta entre
INPC del mes de compra, y perdidas que restan a las ganancias del mismo ejercicio y se arrastran.

Se corre con el venv de referencia:
    "/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv-golden/bin/python" \
        scripts/golden/tax-mx_golden.py
"""

from __future__ import annotations

import json
from decimal import Decimal, getcontext
from pathlib import Path

getcontext().prec = 28

OUT = Path(__file__).resolve().parents[2] / "tests" / "golden" / "tax-mx.json"
TOL = 1e-9
LOSS_CARRY_YEARS = 10
NO_YEAR = "sin fecha"


def D(value):
    return Decimal(str(value))


def previous_month(month: str) -> str:
    year, m = int(month[:4]), int(month[5:7])
    return f"{year - 1}-12" if m == 1 else f"{year}-{m - 1:02d}"


def factor_for(sale, inpc):
    if sale.get("factor") is not None and D(sale["factor"]) > 0:
        return D(sale["factor"]), True
    cost_date, sale_date = sale.get("costDate"), sale.get("saleDate")
    if not cost_date or not sale_date:
        return Decimal(1), False
    a_key, b_key = cost_date[:7], previous_month(sale_date[:7])
    a, b = inpc.get(a_key), inpc.get(b_key)
    if a is None or b is None or D(a) <= 0:
        return Decimal(1), False
    if b_key < a_key:
        return Decimal(1), False
    return D(b) / D(a), True


def isr(sales, inpc=None, rate=0.1, loss_carry_in=0):
    inpc = inpc or {}
    rate = D(rate)
    by_year = {}
    detail = []
    for sale in sales:
        year = sale["saleDate"][:4] if sale.get("saleDate") else NO_YEAR
        factor, indexed = factor_for(sale, inpc)
        indexed_cost = D(sale["cost"]) * factor
        gain = D(sale["proceeds"]) - indexed_cost
        detail.append(
            {
                "year": year,
                "factor": float(factor),
                "indexedCost": float(indexed_cost),
                "gain": float(gain),
                "indexed": indexed,
            }
        )
        by_year[year] = by_year.get(year, Decimal(0)) + gain

    keys = sorted(by_year, key=lambda k: (k == NO_YEAR, k))
    # el arrastre se guarda por ejercicio de origen: caduca a los LOSS_CARRY_YEARS ejercicios.
    # Lo que entra por loss_carry_in no trae ejercicio, asi que se toma como vigente.
    carry_lots = []
    if D(loss_carry_in) > 0:
        carry_lots.append([NO_YEAR, D(loss_carry_in)])
    years, total_gain, total_taxable, total_tax = [], Decimal(0), Decimal(0), Decimal(0)
    for year in keys:
        if year != NO_YEAR:
            for lot in carry_lots:
                if lot[0] != NO_YEAR and lot[1] > 0 and int(year) - int(lot[0]) > LOSS_CARRY_YEARS:
                    lot[1] = Decimal(0)
        gain = by_year[year]
        used = Decimal(0)
        taxable = Decimal(0)
        if gain > 0:
            pending = gain
            for lot in carry_lots:
                if pending <= 0:
                    break
                take = min(lot[1], pending)
                if take <= 0:
                    continue
                lot[1] -= take
                pending -= take
                used += take
            taxable = gain - used
        elif gain < 0:
            carry_lots.append([year, -gain])
        carry = sum((lot[1] for lot in carry_lots), Decimal(0))
        tax = taxable * rate
        years.append(
            {
                "year": year,
                "gain": float(gain),
                "taxableGain": float(taxable),
                "tax": float(tax),
                "lossUsed": float(used),
                "lossCarry": float(carry),
            }
        )
        total_gain += gain
        total_taxable += taxable
        total_tax += tax

    return {
        "gain": float(total_gain),
        "taxableGain": float(total_taxable),
        "tax": float(total_tax),
        "lossCarry": float(carry),
        "years": years,
        "detail": detail,
    }


def build():
    inpc_2026 = {
        "2025-06": 132.373,
        "2025-11": 134.101,
        "2026-01": 135.402,
        "2026-03": 136.211,
        "2026-05": 137.004,
        "2026-08": 138.199,
        "2026-11": 139.512,
        "2027-02": 140.883,
    }
    cases = [
        {
            "name": "caso-conocido-factor-1.05",
            "input": {
                "sales": [
                    {"symbol": "WALMEX.MX", "proceeds": 650, "cost": 550, "costDate": "2026-01-15", "saleDate": "2026-09-20"}
                ],
                "inpc": {"2026-01": 100, "2026-08": 105},
                "rate": 0.1,
                "lossCarryIn": 0,
            },
            "tol": TOL,
        },
        {
            "name": "factor-explicito",
            "input": {
                "sales": [{"proceeds": 650, "cost": 550, "factor": 1.05, "saleDate": "2026-09-20"}],
                "inpc": {},
                "rate": 0.1,
                "lossCarryIn": 0,
            },
            "tol": TOL,
        },
        {
            "name": "sin-inpc-no-se-actualiza",
            "input": {
                "sales": [
                    {"proceeds": 650, "cost": 550, "costDate": "2026-01-15", "saleDate": "2026-09-20"}
                ],
                "inpc": {},
                "rate": 0.1,
                "lossCarryIn": 0,
            },
            "tol": TOL,
        },
        {
            "name": "perdidas-contra-ganancias-del-mismo-ano",
            "input": {
                "sales": [
                    {"symbol": "A", "proceeds": 20000, "cost": 12000, "costDate": "2025-06-10", "saleDate": "2026-03-10"},
                    {"symbol": "B", "proceeds": 4000, "cost": 9000, "costDate": "2025-11-02", "saleDate": "2026-09-30"},
                ],
                "inpc": inpc_2026,
                "rate": 0.1,
                "lossCarryIn": 0,
            },
            "tol": TOL,
        },
        {
            "name": "dos-ejercicios-con-arrastre",
            "input": {
                "sales": [
                    {"symbol": "A", "proceeds": 5000, "cost": 14000, "costDate": "2025-06-10", "saleDate": "2026-04-10"},
                    {"symbol": "B", "proceeds": 31000, "cost": 20000, "costDate": "2026-03-01", "saleDate": "2027-03-15"},
                ],
                "inpc": inpc_2026,
                "rate": 0.1,
                "lossCarryIn": 0,
            },
            "tol": TOL,
        },
        {
            "name": "perdida-que-caduca-a-los-diez-ejercicios",
            "input": {
                # una perdida de 2012 ya no puede amortizar una ganancia de 2026
                "sales": [
                    {"symbol": "A", "proceeds": 300, "cost": 1000, "costDate": "2012-01-15", "saleDate": "2012-06-10"},
                    {"symbol": "B", "proceeds": 1500, "cost": 1000, "costDate": "2026-01-15", "saleDate": "2026-06-10"},
                ],
                "inpc": {},
                "rate": 0.1,
                "lossCarryIn": 0,
            },
            "tol": TOL,
        },
        {
            "name": "perdida-que-todavia-no-caduca",
            "input": {
                "sales": [
                    {"symbol": "A", "proceeds": 300, "cost": 1000, "costDate": "2020-01-15", "saleDate": "2020-06-10"},
                    {"symbol": "B", "proceeds": 1500, "cost": 1000, "costDate": "2026-01-15", "saleDate": "2026-06-10"},
                ],
                "inpc": {},
                "rate": 0.1,
                "lossCarryIn": 0,
            },
            "tol": TOL,
        },
        {
            "name": "perdida-previa-que-entra-como-carry",
            "input": {
                "sales": [
                    {"symbol": "A", "proceeds": 90000, "cost": 60000, "costDate": "2026-01-20", "saleDate": "2026-12-15"}
                ],
                "inpc": inpc_2026,
                "rate": 0.1,
                "lossCarryIn": 12000,
            },
            "tol": TOL,
        },
        {
            "name": "venta-el-mismo-mes-de-la-compra",
            "input": {
                "sales": [
                    {"proceeds": 1200, "cost": 1000, "costDate": "2026-05-04", "saleDate": "2026-05-28"}
                ],
                "inpc": inpc_2026,
                "rate": 0.1,
                "lossCarryIn": 0,
            },
            "tol": TOL,
        },
        {
            "name": "venta-sin-fecha",
            "input": {
                "sales": [
                    {"proceeds": 3000, "cost": 2500, "costDate": None, "saleDate": None},
                    {"symbol": "B", "proceeds": 8000, "cost": 5000, "costDate": "2026-01-20", "saleDate": "2026-11-11"},
                ],
                "inpc": inpc_2026,
                "rate": 0.1,
                "lossCarryIn": 0,
            },
            "tol": TOL,
        },
    ]
    for case in cases:
        data = case["input"]
        case["expected"] = isr(data["sales"], data["inpc"], data["rate"], data["lossCarryIn"])
    return {"cases": cases}


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = build()
    OUT.write_text(json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")
    for case in payload["cases"]:
        print(f"{case['name']}: gain={case['expected']['gain']:.6f} tax={case['expected']['tax']:.6f}")


if __name__ == "__main__":
    main()
