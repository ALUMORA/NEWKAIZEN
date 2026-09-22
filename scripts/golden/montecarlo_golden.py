"""Genera tests/golden/montecarlo.json: respuestas de referencia para src/lib/finance/montecarlo.js.

Se corre con el venv de referencia, que es aparte del de la app:

    "/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv-golden/bin/python" \
        scripts/golden/montecarlo_golden.py

Qué se compara y por qué es una referencia de verdad y no un calco del JS:

- Los parámetros lognormales salen de la fórmula cerrada con `math`.
- Las trayectorias sin volatilidad (sigma = 0) y las de bootstrap con historia constante se
  resuelven con la SUMA CERRADA de la anualidad, no repitiendo el ciclo del JS.
- Los cuantiles salen de `numpy.percentile` con interpolación lineal, que es el tipo 7.
- El generador xoshiro128** se reimplementa aquí con enteros de Python, que son exactos. Si el
  JS se equivoca en una rotación o en un Math.imul, las secuencias dejan de cuadrar.

`tol` es tolerancia RELATIVA: se cumple si |a − b| ≤ tol · max(1, |b|).
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

M32 = 0xFFFFFFFF
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "tests" / "golden" / "montecarlo.json"


# --------------------------------------------------------------------------- rng de referencia
def rotl(x: int, k: int) -> int:
    return ((x << k) | (x >> (32 - k))) & M32


def hash_seed(text: str) -> int:
    h = 2166136261
    for ch in text:
        h = (h ^ ord(ch)) & M32
        h = (h * 16777619) & M32
    h = (h ^ (h >> 16)) & M32
    h = (h * 2246822507) & M32
    h = (h ^ (h >> 13)) & M32
    h = (h * 3266489909) & M32
    return (h ^ (h >> 16)) & M32


def splitmix32(seed: int):
    a = seed & M32

    def nxt() -> int:
        nonlocal a
        a = (a + 0x9E3779B9) & M32
        t = (a ^ (a >> 16)) & M32
        t = (t * 0x21F0AAAD) & M32
        t = (t ^ (t >> 15)) & M32
        t = (t * 0x735A2D97) & M32
        t = (t ^ (t >> 15)) & M32
        return t & M32

    return nxt


class Xoshiro128ss:
    """xoshiro128** con el mismo sembrado que src/lib/rng.js."""

    def __init__(self, seed: str) -> None:
        mix = splitmix32(hash_seed(str(seed)))
        self.initial = [mix(), mix(), mix(), mix()]
        if (self.initial[0] | self.initial[1] | self.initial[2] | self.initial[3]) == 0:
            self.initial[0] = 1
        self.reset()

    def reset(self) -> None:
        self.s = list(self.initial)
        self.spare: float | None = None

    def next_uint32(self) -> int:
        s = self.s
        result = (rotl((s[1] * 5) & M32, 7) * 9) & M32
        t = (s[1] << 9) & M32
        s[2] ^= s[0]
        s[3] ^= s[1]
        s[1] ^= s[2]
        s[0] ^= s[3]
        s[2] ^= t
        s[3] = rotl(s[3], 11)
        return result

    def uniform(self) -> float:
        return self.next_uint32() / 4294967296.0

    def normal(self) -> float:
        if self.spare is not None:
            value = self.spare
            self.spare = None
            return value
        u1 = self.uniform()
        while u1 == 0.0:
            u1 = self.uniform()
        u2 = self.uniform()
        radius = math.sqrt(-2.0 * math.log(u1))
        theta = 2.0 * math.pi * u2
        self.spare = radius * math.sin(theta)
        return radius * math.cos(theta)

    def randint(self, max_exclusive: int) -> int:
        limit = 4294967296 - (4294967296 % max_exclusive)
        x = self.next_uint32()
        while x >= limit:
            x = self.next_uint32()
        return x % max_exclusive


# ------------------------------------------------------------------ trayectoria determinista
def deterministic_path(
    *,
    initial: float,
    contribution: float,
    steps: int,
    every: int,
    gross_step: float,
    growth_step: float,
) -> list[float]:
    """Saldo paso a paso con aportación al inicio del periodo, por suma cerrada.

    W_t = W0·R^t + Σ_{j aporta, j < t} C·g^j·R^(t−j)
    """
    out = []
    for t in range(steps + 1):
        value = initial * gross_step**t
        j = 0
        while j < t:
            value += contribution * (growth_step**j) * (gross_step ** (t - j))
            j += every
        out.append(value)
    return out


def case_deterministic(name: str, options: dict, tol: float = 1e-9) -> dict:
    steps_per_year = options.get("stepsPerYear", 12)
    steps = round(options["years"] * steps_per_year)
    per_year = 12 if options.get("contributionFrequency", "monthly") == "monthly" else 1
    every = steps_per_year // per_year
    inflation = options.get("inflation", 0.0)
    growth = options.get("contributionGrowth")
    if growth is None:
        growth = inflation
    growth_step = 1.0 if growth == 0 else (1.0 + growth) ** (1.0 / steps_per_year)

    if options.get("method", "lognormal") == "bootstrap":
        returns = list(options["history"])
        assert len(set(returns)) == 1, "la historia tiene que ser constante para ser determinista"
        gross_step = 1.0 + returns[0]
    else:
        mu = options.get("mu", 0.0)
        assert options.get("sigma", 0.0) == 0.0, "sigma tiene que ser 0 para ser determinista"
        gross_step = (1.0 + mu) ** (1.0 / steps_per_year)

    path = deterministic_path(
        initial=options.get("initial", 0.0),
        contribution=options.get("contribution", 0.0),
        steps=steps,
        every=every,
        gross_step=gross_step,
        growth_step=growth_step,
    )
    contributed = options.get("initial", 0.0) + sum(
        options.get("contribution", 0.0) * growth_step**t for t in range(0, steps, every)
    )
    deflator = (1.0 + inflation) ** (steps / steps_per_year)
    return {
        "name": name,
        "kind": "simulateDeterministic",
        "input": options,
        "expected": {
            "p50": path,
            "terminal": path[-1],
            "terminalReal": path[-1] / deflator,
            "contributedTotal": contributed,
        },
        "tol": tol,
    }


def main() -> None:
    cases: list[dict] = []

    # --- parámetros lognormales ------------------------------------------------
    for m, s in [(0.08, 0.15), (0.0, 0.0), (0.12, 0.25), (-0.02, 0.05), (0.08, 0.0)]:
        gross = 1.0 + m
        variance = math.log(1.0 + (s * s) / (gross * gross))
        cases.append(
            {
                "name": f"lognormalParams m={m} s={s}",
                "kind": "lognormalParams",
                "input": {"m": m, "s": s},
                "expected": {"mu": math.log(gross) - variance / 2.0, "sigma": math.sqrt(variance)},
                "tol": 1e-14,
            }
        )

    for m, s, k in [(0.08, 0.15, 12), (0.10, 0.20, 252), (0.08, 0.15, 1)]:
        gross = 1.0 + m
        variance = math.log(1.0 + (s * s) / (gross * gross))
        mu_l = math.log(gross) - variance / 2.0
        cases.append(
            {
                "name": f"perStepParams m={m} s={s} k={k}",
                "kind": "perStepParams",
                "input": {"m": m, "s": s, "stepsPerYear": k},
                "expected": {"mu": mu_l / k, "sigma": math.sqrt(variance) / math.sqrt(k)},
                "tol": 1e-14,
            }
        )

    # --- generador -------------------------------------------------------------
    for seed in ["kaizen", "", "meta-retiro-2026", "42"]:
        rng = Xoshiro128ss(seed)
        cases.append(
            {
                "name": f"rng uint32 seed={seed!r}",
                "kind": "rngUint32",
                "input": {"seed": seed, "n": 8},
                "expected": [rng.next_uint32() for _ in range(8)],
                "tol": 0.0,
            }
        )
        rng.reset()
        cases.append(
            {
                "name": f"rng uniform seed={seed!r}",
                "kind": "rngUniform",
                "input": {"seed": seed, "n": 6},
                "expected": [rng.uniform() for _ in range(6)],
                "tol": 0.0,
            }
        )
        rng.reset()
        cases.append(
            {
                "name": f"rng normal seed={seed!r}",
                "kind": "rngNormal",
                "input": {"seed": seed, "n": 8},
                # sin/cos pueden diferir un ulp entre libm de Python y de V8
                "expected": [rng.normal() for _ in range(8)],
                "tol": 1e-12,
            }
        )
        rng.reset()
        cases.append(
            {
                "name": f"rng int seed={seed!r}",
                "kind": "rngInt",
                "input": {"seed": seed, "n": 10, "max": 7},
                "expected": [rng.randint(7) for _ in range(10)],
                "tol": 0.0,
            }
        )

    # --- hash de la semilla ----------------------------------------------------
    cases.append(
        {
            "name": "hashSeed",
            "kind": "hashSeed",
            "input": {"seeds": ["kaizen", "", "a", "kaizen1", "kaizen2", "42"]},
            "expected": [hash_seed(s) for s in ["kaizen", "", "a", "kaizen1", "kaizen2", "42"]],
            "tol": 0.0,
        }
    )

    # --- cuantiles tipo 7 ------------------------------------------------------
    rng = Xoshiro128ss("cuantiles")
    samples = [
        [1.0],
        [2.0, 1.0],
        [5.0, 1.0, 4.0, 2.0, 3.0],
        [round(rng.uniform() * 1000, 6) for _ in range(37)],
        [round(rng.normal(), 9) for _ in range(500)],
    ]
    for i, values in enumerate(samples):
        arr = np.array(values, dtype=float)
        expected = {
            key: float(np.percentile(arr, q * 100.0, method="linear"))
            for key, q in [("p5", 0.05), ("p25", 0.25), ("p50", 0.5), ("p75", 0.75), ("p95", 0.95)]
        }
        cases.append(
            {
                "name": f"quantiles n={len(values)} (#{i})",
                "kind": "quantiles",
                "input": {"values": values},
                "expected": expected,
                "tol": 1e-12,
            }
        )

    # --- trayectorias deterministas -------------------------------------------
    monthly_1pct = 1.01**12 - 1.0
    cases.append(
        case_deterministic(
            "sigma=0 aportación constante (respuesta conocida 176,729.14)",
            {
                "initial": 100000,
                "contribution": 5000,
                "contributionFrequency": "monthly",
                "contributionGrowth": 0,
                "years": 1,
                "stepsPerYear": 12,
                "mu": monthly_1pct,
                "sigma": 0,
                "inflation": 0,
                "paths": 11,
                "seed": "golden",
            },
        )
    )
    cases.append(
        case_deterministic(
            "sigma=0 aportación creciente 1% mensual (respuesta conocida 180,292.00)",
            {
                "initial": 100000,
                "contribution": 5000,
                "contributionFrequency": "monthly",
                "contributionGrowth": monthly_1pct,
                "years": 1,
                "stepsPerYear": 12,
                "mu": monthly_1pct,
                "sigma": 0,
                "inflation": 0,
                "paths": 11,
                "seed": "golden",
            },
        )
    )
    cases.append(
        case_deterministic(
            "sigma=0 aportación anual con inflación",
            {
                "initial": 250000,
                "contribution": 60000,
                "contributionFrequency": "annual",
                "contributionGrowth": 0.05,
                "years": 10,
                "stepsPerYear": 12,
                "mu": 0.09,
                "sigma": 0,
                "inflation": 0.04,
                "paths": 25,
                "seed": "golden-anual",
            },
        )
    )
    cases.append(
        case_deterministic(
            "sigma=0 sin aportación, pasos anuales",
            {
                "initial": 1000,
                "contribution": 0,
                "years": 25,
                "stepsPerYear": 1,
                "contributionFrequency": "annual",
                "contributionGrowth": 0,
                "mu": 0.07,
                "sigma": 0,
                "inflation": 0,
                "paths": 3,
                "seed": "golden-simple",
            },
        )
    )
    cases.append(
        case_deterministic(
            "bootstrap con historia constante",
            {
                "initial": 50000,
                "contribution": 1000,
                "contributionFrequency": "monthly",
                "contributionGrowth": 0,
                "years": 2,
                "stepsPerYear": 12,
                "method": "bootstrap",
                "history": [0.006, 0.006, 0.006, 0.006, 0.006, 0.006, 0.006, 0.006],
                "blockSize": 3,
                "inflation": 0.035,
                "paths": 17,
                "seed": "golden-bootstrap",
            },
        )
    )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"cases": cases}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{OUT.relative_to(ROOT)}: {len(cases)} casos")


if __name__ == "__main__":
    main()
