"""Referencia independiente del libro de movimientos (src/lib/finance/ledger.js).

Escribe tests/golden/ledger.json con {cases:[{name, input, expected, tol}]}.

Es una segunda implementacion, a proposito distinta: aqui la aritmetica va en Fraction (racionales
exactos, sin error de punto flotante) y el recorrido esta escrito de cero a partir del spec, no
traducido del JavaScript. Si las dos coinciden a 1e-9 sobre los mismos movimientos, el metodo de
costo promedio esta bien implementado en las dos.

Se corre con el venv de referencia:
    "/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv-golden/bin/python" \
        scripts/golden/ledger_golden.py
"""

from __future__ import annotations

import json
import random
from fractions import Fraction
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / "tests" / "golden" / "ledger.json"
TOL = 1e-9


def F(value):
    """Fraccion exacta a partir de un numero de JSON."""
    return Fraction(str(value))


def run(transactions, as_of=None):
    """Motor de costo promedio en aritmetica exacta."""
    rows = [
        (tx.get("date"), i, tx)
        for i, tx in enumerate(transactions)
        if as_of is None or tx.get("date") is None or tx["date"] <= as_of
    ]
    rows.sort(key=lambda row: (row[0] or "", row[1]))

    book = {}
    cash = {"MXN": Fraction(0), "USD": Fraction(0)}
    sales = []

    def lot_for(symbol, currency):
        if symbol not in book:
            book[symbol] = {
                "quantity": Fraction(0),
                "cost": Fraction(0),
                "currency": currency,
                "realized": Fraction(0),
                "first_buy": None,
                "fx_qty": Fraction(0),
                "fx_sum": Fraction(0),
                "fx_known": True,
            }
        return book[symbol]

    for date, _i, tx in rows:
        kind = tx["type"]
        ccy = tx.get("currency") if tx.get("currency") in ("MXN", "USD") else "MXN"
        fees = F(tx.get("fees") or 0)
        if fees < 0:
            fees = Fraction(0)

        if kind in ("deposit", "dividend"):
            cash[ccy] += F(tx.get("amount") or 0) - fees
            continue
        if kind == "withdrawal":
            cash[ccy] -= F(tx.get("amount") or 0) + fees
            continue
        if kind == "fee":
            cash[ccy] -= F(tx["amount"]) if tx.get("amount") is not None else fees
            continue

        symbol = tx.get("symbol")
        if not symbol:
            continue
        lot = lot_for(symbol, ccy)

        if kind == "buy":
            qty = F(tx.get("quantity") or 0)
            if qty <= 0:
                continue
            if lot["quantity"] == 0:
                lot.update(
                    cost=Fraction(0),
                    currency=ccy,
                    realized=Fraction(0),
                    first_buy=None,
                    fx_qty=Fraction(0),
                    fx_sum=Fraction(0),
                    fx_known=True,
                )
            price = None if tx.get("price") is None else F(tx["price"])
            amount = None if price is None else qty * price + fees
            lot["quantity"] += qty
            lot["cost"] = None if lot["cost"] is None or amount is None else lot["cost"] + amount
            if date is not None and (lot["first_buy"] is None or date < lot["first_buy"]):
                lot["first_buy"] = date
            fx = tx.get("fxRate")
            if fx is not None and F(fx) > 0:
                lot["fx_qty"] += qty
                lot["fx_sum"] += qty * F(fx)
            else:
                lot["fx_known"] = False
            if amount is not None:
                cash[ccy] -= amount
            continue

        if kind == "sell":
            qty = min(F(tx.get("quantity") or 0), lot["quantity"])
            if qty <= 0:
                continue
            avg = None if lot["cost"] is None else lot["cost"] / lot["quantity"]
            price = None if tx.get("price") is None else F(tx["price"])
            proceeds = None if price is None else qty * price - fees
            cost = None if avg is None else avg * qty
            gain = None if proceeds is None or cost is None else proceeds - cost
            sales.append(
                {
                    "symbol": symbol,
                    "saleDate": date,
                    "quantity": qty,
                    "proceeds": proceeds,
                    "cost": cost,
                    "costDate": lot["first_buy"],
                    "gain": gain,
                    "currency": lot["currency"],
                }
            )
            lot["realized"] = None if lot["realized"] is None or gain is None else lot["realized"] + gain
            lot["quantity"] -= qty
            if lot["quantity"] == 0:
                lot["cost"] = Fraction(0)
            elif avg is not None and lot["cost"] is not None:
                lot["cost"] -= avg * qty
            if proceeds is not None:
                cash[lot["currency"]] += proceeds
            continue

        if kind == "split":
            ratio = F(tx.get("ratio") or 0)
            if ratio <= 0:
                continue
            lot["quantity"] *= ratio
            if fees > 0:
                cash[lot["currency"]] -= fees
            continue

    positions = []
    for symbol in sorted(book):
        lot = book[symbol]
        if lot["quantity"] <= 0:
            continue
        positions.append(
            {
                "symbol": symbol,
                "quantity": float(lot["quantity"]),
                "avgCost": None if lot["cost"] is None else float(lot["cost"] / lot["quantity"]),
                "currency": lot["currency"],
                "costBasis": None if lot["cost"] is None else float(lot["cost"]),
                "realizedPnl": None if lot["realized"] is None else float(lot["realized"]),
                "firstBuyDate": lot["first_buy"],
                "avgFx": float(lot["fx_sum"] / lot["fx_qty"]) if lot["fx_known"] and lot["fx_qty"] > 0 else None,
            }
        )
    return {
        "positions": positions,
        "cash": {k: float(v) for k, v in cash.items()},
        "sales": [
            {
                **sale,
                "quantity": float(sale["quantity"]),
                "proceeds": None if sale["proceeds"] is None else float(sale["proceeds"]),
                "cost": None if sale["cost"] is None else float(sale["cost"]),
                "gain": None if sale["gain"] is None else float(sale["gain"]),
            }
            for sale in sales
        ],
    }


def tx(kind, **kw):
    row = {
        "id": kw.pop("id", f"{kind}-{len(kw)}"),
        "type": kind,
        "date": kw.pop("date", None),
        "symbol": kw.pop("symbol", None),
        "quantity": kw.pop("quantity", None),
        "price": kw.pop("price", None),
        "currency": kw.pop("currency", "MXN"),
        "fxRate": kw.pop("fxRate", None),
        "fees": kw.pop("fees", 0),
        "amount": kw.pop("amount", None),
        "ratio": kw.pop("ratio", None),
        "note": kw.pop("note", ""),
    }
    assert not kw, kw
    return row


def random_case(name, seed):
    rng = random.Random(seed)
    symbols = ["AAPL", "WALMEX.MX", "FUNO11.MX"]
    rows = [tx("deposit", date="2025-01-02", amount=500000, currency="MXN")]
    held = {s: 0 for s in symbols}
    for i in range(40):
        date = f"2025-{(i // 4) + 1:02d}-{(i % 4) * 7 + 1:02d}"
        symbol = rng.choice(symbols)
        ccy = "USD" if symbol == "AAPL" else "MXN"
        roll = rng.random()
        if roll < 0.55 or held[symbol] == 0:
            qty = rng.randint(1, 30)
            rows.append(
                tx(
                    "buy",
                    date=date,
                    symbol=symbol,
                    quantity=qty,
                    price=round(rng.uniform(20, 300), 2),
                    currency=ccy,
                    fees=round(rng.uniform(0, 40), 2),
                    fxRate=round(rng.uniform(16.5, 19.5), 4) if ccy == "USD" else None,
                )
            )
            held[symbol] += qty
        elif roll < 0.9:
            qty = rng.randint(1, held[symbol])
            rows.append(
                tx(
                    "sell",
                    date=date,
                    symbol=symbol,
                    quantity=qty,
                    price=round(rng.uniform(20, 300), 2),
                    currency=ccy,
                    fees=round(rng.uniform(0, 40), 2),
                )
            )
            held[symbol] -= qty
        else:
            ratio = rng.choice([2, 3, 4])
            rows.append(tx("split", date=date, symbol=symbol, ratio=ratio, currency=ccy))
            held[symbol] *= ratio
    rows.append(tx("dividend", date="2025-11-15", symbol="FUNO11.MX", amount=1234.56, currency="MXN"))
    rows.append(tx("fee", date="2025-12-01", amount=150, currency="MXN"))
    return {"name": name, "input": {"transactions": rows, "asOf": None}, "tol": TOL}


def build():
    cases = []

    cases.append(
        {
            "name": "costo-promedio-venta-y-split",
            "input": {
                "transactions": [
                    tx("buy", id="b1", date="2026-01-05", symbol="AAPL", quantity=10, price=100, currency="USD"),
                    tx("buy", id="b2", date="2026-02-05", symbol="AAPL", quantity=10, price=120, currency="USD"),
                    tx("sell", id="s1", date="2026-03-05", symbol="AAPL", quantity=5, price=130, currency="USD"),
                    tx("split", id="sp1", date="2026-04-05", symbol="AAPL", ratio=2, currency="USD"),
                ],
                "asOf": None,
            },
            "tol": TOL,
        }
    )
    cases.append(
        {
            "name": "comisiones-al-costo-y-al-producto",
            "input": {
                "transactions": [
                    tx("deposit", id="d1", date="2026-01-01", amount=100000, currency="MXN"),
                    tx("buy", id="b1", date="2026-01-05", symbol="WALMEX.MX", quantity=100, price=62.5, fees=180),
                    tx("buy", id="b2", date="2026-03-05", symbol="WALMEX.MX", quantity=50, price=71.2, fees=95.5),
                    tx("sell", id="s1", date="2026-06-05", symbol="WALMEX.MX", quantity=40, price=80, fees=120),
                ],
                "asOf": None,
            },
            "tol": TOL,
        }
    )
    cases.append(
        {
            "name": "cierra-y-reabre-la-posicion",
            "input": {
                "transactions": [
                    tx("buy", id="b1", date="2026-01-05", symbol="CEMEXCPO.MX", quantity=100, price=12),
                    tx("sell", id="s1", date="2026-02-05", symbol="CEMEXCPO.MX", quantity=100, price=15),
                    tx("buy", id="b2", date="2026-03-05", symbol="CEMEXCPO.MX", quantity=40, price=14),
                ],
                "asOf": None,
            },
            "tol": TOL,
        }
    )
    cases.append(
        {
            "name": "dos-monedas-con-tipo-de-cambio",
            "input": {
                "transactions": [
                    tx("deposit", id="d1", date="2026-01-01", amount=50000, currency="MXN"),
                    tx("deposit", id="d2", date="2026-01-01", amount=3000, currency="USD"),
                    tx("buy", id="b1", date="2026-01-10", symbol="AAPL", quantity=10, price=150, currency="USD", fxRate=17.1),
                    tx("buy", id="b2", date="2026-02-10", symbol="AAPL", quantity=5, price=180, currency="USD", fxRate=18.4),
                    tx("buy", id="b3", date="2026-02-11", symbol="FUNO11.MX", quantity=200, price=23.4, currency="MXN"),
                    tx("dividend", id="dv1", date="2026-03-01", symbol="FUNO11.MX", amount=800, currency="MXN"),
                ],
                "asOf": None,
            },
            "tol": TOL,
        }
    )
    cases.append(
        {
            "name": "corte-con-asOf",
            "input": {
                "transactions": [
                    tx("buy", id="b0", symbol="AAPL", quantity=5, price=200, currency="USD"),
                    tx("buy", id="b1", date="2026-03-01", symbol="AAPL", quantity=5, price=100, currency="USD"),
                    tx("sell", id="s1", date="2026-06-01", symbol="AAPL", quantity=2, price=300, currency="USD"),
                ],
                "asOf": "2026-04-01",
            },
            "tol": TOL,
        }
    )
    cases.append(
        {
            "name": "compra-sin-precio-deja-el-costo-desconocido",
            "input": {
                "transactions": [
                    tx("buy", id="b1", symbol="MSFT", quantity=2, price=None, currency="USD"),
                    tx("buy", id="b2", date="2026-01-05", symbol="MSFT", quantity=1, price=300, currency="USD"),
                    tx("sell", id="s1", date="2026-02-05", symbol="MSFT", quantity=1, price=400, currency="USD"),
                ],
                "asOf": None,
            },
            "tol": TOL,
        }
    )
    for seed in (11, 23, 57):
        cases.append(random_case(f"secuencia-aleatoria-{seed}", seed))

    for case in cases:
        case["expected"] = run(case["input"]["transactions"], case["input"]["asOf"])
    return {"cases": cases}


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = build()
    OUT.write_text(json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{OUT.relative_to(OUT.parents[1])}: {len(payload['cases'])} casos")


if __name__ == "__main__":
    main()
