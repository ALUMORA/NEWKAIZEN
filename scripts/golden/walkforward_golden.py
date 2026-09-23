#!/usr/bin/env python
"""Respuestas conocidas de src/lib/finance/walkforward.js, reimplementadas con numpy y scipy.

Escribe tests/golden/walkforward.json con {cases: [{name, fn, input, expected, tol}]}, que recorre
walkforward.test.js. Esta es una reimplementación completa del barrido, no un atajo: recorta las
mismas ventanas, estima con PyPortfolioOpt o con pandas, optimiza con SLSQP y compone los
rendimientos fuera de muestra. Si los dos caminos dan la misma serie, el barrido está bien armado
y, lo más importante, no se coló ningún dato del futuro por ningún lado.

Correr con el venv de referencia:

    "/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv-golden/bin/python" \
        scripts/golden/walkforward_golden.py
"""

from __future__ import annotations

import datetime as dt
import json
import math
import pathlib

import numpy as np
import pandas as pd
from pypfopt.risk_models import CovarianceShrinkage
from scipy.optimize import minimize

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "tests" / "golden" / "walkforward.json"


class Lcg:
    """Congruencial lineal (Numerical Recipes). Determinista, sin dependencias, reproducible."""

    def __init__(self, seed: int) -> None:
        self.state = seed & 0xFFFFFFFF

    def next_u32(self) -> int:
        self.state = (1664525 * self.state + 1013904223) & 0xFFFFFFFF
        return self.state

    def uniform(self) -> float:
        return (self.next_u32() + 0.5) / 4294967296.0

    def normal(self) -> float:
        u1 = self.uniform()
        u2 = self.uniform()
        return math.sqrt(-2.0 * math.log(u1)) * math.cos(2.0 * math.pi * u2)


def weekly_panel(periods: int, assets: int, seed: int) -> tuple[list[list[float]], list[str]]:
    """Panel semanal T x N de dos factores, con fechas de viernes consecutivos."""
    rng = Lcg(seed)
    betas = [0.4 + 0.22 * ((i * 5) % 7) for i in range(assets)]
    sector = [1.0 if i % 2 == 0 else -0.8 for i in range(assets)]
    sigmas = [0.010 + 0.007 * ((i * 7) % 5) for i in range(assets)]
    mus = [0.0006 + 0.0003 * ((i * 3) % 4) for i in range(assets)]
    rows: list[list[float]] = []
    dates: list[str] = []
    day = dt.date(2019, 1, 4)
    for _ in range(periods):
        market = rng.normal() * 0.016
        sect = rng.normal() * 0.011
        rows.append(
            [
                round(mus[i] + betas[i] * market + sector[i] * sect + rng.normal() * sigmas[i], 12)
                for i in range(assets)
            ]
        )
        dates.append(day.isoformat())
        day += dt.timedelta(days=7)
    return rows, dates


def min_variance(cov: np.ndarray) -> np.ndarray:
    """Mínima varianza solo largos, con SLSQP."""
    n = cov.shape[0]
    cons = [{"type": "eq", "fun": lambda w: float(np.sum(w) - 1.0), "jac": lambda w: np.ones_like(w)}]
    res = minimize(
        lambda w: float(w @ cov @ w),
        np.full(n, 1.0 / n),
        jac=lambda w: 2.0 * (cov @ w),
        method="SLSQP",
        bounds=[(0.0, 1.0)] * n,
        constraints=cons,
        options={"ftol": 1e-16, "maxiter": 3000},
    )
    w = np.clip(res.x, 0.0, 1.0)
    return w / w.sum()


def estimate_cov(window: np.ndarray, kind: str) -> np.ndarray:
    frame = pd.DataFrame(window, columns=[f"A{i}" for i in range(window.shape[1])])
    if kind == "sample":
        return frame.cov().values
    shrink = CovarianceShrinkage(frame, returns_data=True, frequency=1)
    return shrink.ledoit_wolf(shrinkage_target="constant_correlation").values


def walk_forward(
    panel: list[list[float]],
    dates: list[str],
    estimation_window: int,
    hold_periods: int,
    method: str,
    covariance: str,
    rebalance: str,
    window: str,
    k: int,
) -> dict:
    X = np.asarray(panel, dtype=float)
    periods, assets = X.shape
    if periods < estimation_window + 1:
        raise RuntimeError("no alcanza para un solo periodo fuera de muestra")

    oos_returns: list[float] = []
    oos_dates: list[str] = []
    rebalances: list[dict] = []

    fold = 0
    hold_start = estimation_window
    while hold_start < periods:
        hold_end = min(hold_start + hold_periods, periods)
        estimation_start = 0 if window == "expanding" else max(0, hold_start - estimation_window)
        chunk = X[estimation_start:hold_start]

        if method == "equalWeight":
            weights = np.full(assets, 1.0 / assets)
        elif method == "minVariance":
            weights = min_variance(estimate_cov(chunk, covariance))
        else:
            raise RuntimeError(f"método no soportado en el golden: {method}")

        rebalances.append(
            {
                "fold": fold,
                "date": dates[hold_start],
                "holdStart": hold_start,
                "holdEnd": hold_end,
                "estimationStart": estimation_start,
                "estimationEnd": hold_start,
                "weights": weights.tolist(),
            }
        )

        live = weights.copy()
        for t in range(hold_start, hold_end):
            r = float(live @ X[t])
            oos_returns.append(r)
            oos_dates.append(dates[t])
            if rebalance == "hold":
                growth = 1.0 + r
                live = weights.copy() if abs(growth) < 1e-12 else live * (1.0 + X[t]) / growth
            else:
                live = weights.copy()
        fold += 1
        hold_start += hold_periods

    values = np.cumprod(1.0 + np.asarray(oos_returns))
    # El pico arranca en 1, la riqueza inicial: una caída en el primer periodo también cuenta.
    running_peak = np.maximum.accumulate(np.concatenate([[1.0], values]))[1:]
    max_drawdown = float(np.min(values / running_peak - 1.0))
    wealth = float(values[-1])
    n_oos = len(oos_returns)
    mean = float(np.mean(oos_returns))
    sd = float(np.std(oos_returns, ddof=1)) if n_oos >= 2 else None

    return {
        "dates": oos_dates,
        "returns": [float(r) for r in oos_returns],
        "rebalances": rebalances,
        "folds": fold,
        "summary": {
            "periods": n_oos,
            "meanPerPeriod": mean,
            "volPerPeriod": sd,
            "annualizedReturn": wealth ** (k / n_oos) - 1.0,
            "annualizedVol": None if sd is None else sd * math.sqrt(k),
            "cumulative": wealth - 1.0,
            "maxDrawdown": min(0.0, max_drawdown),
        },
    }


def case(name: str, panel, dates, tol: float, **options) -> dict:
    settings = {
        "estimationWindow": options.get("estimation_window", 104),
        "holdPeriods": options.get("hold_periods", 13),
        "method": options.get("method", "minVariance"),
        "covariance": options.get("covariance", "ledoitWolf"),
        "rebalance": options.get("rebalance", "hold"),
        "window": options.get("window", "rolling"),
        "k": options.get("k", 52),
    }
    expected = walk_forward(
        panel,
        dates,
        settings["estimationWindow"],
        settings["holdPeriods"],
        settings["method"],
        settings["covariance"],
        settings["rebalance"],
        settings["window"],
        settings["k"],
    )
    return {
        "name": name,
        "fn": "walkForward",
        "input": {"returns": panel, "dates": dates, "options": settings},
        "expected": expected,
        "tol": tol,
    }


def main() -> None:
    panel, dates = weekly_panel(300, 5, seed=20260922)
    small, small_dates = weekly_panel(70, 3, seed=31415)
    # Mismo panel chico con un desplome justo en el primer periodo fuera de muestra (renglón 52):
    # la caída máxima tiene que medirse contra la riqueza inicial, 1, no contra el primer valor.
    crash = [row[:] for row in small]
    crash[52] = [-0.30, -0.25, -0.20]

    cases = [
        case("equal weight, pesos fijos cada periodo, 300x5", panel, dates, 1e-12, method="equalWeight", rebalance="period"),
        case("equal weight dejando correr los pesos, 300x5", panel, dates, 1e-12, method="equalWeight"),
        case("minima varianza con covarianza muestral, 300x5", panel, dates, 1e-7, covariance="sample"),
        case("minima varianza con Ledoit-Wolf, 300x5", panel, dates, 1e-7),
        case("minima varianza con ventana creciente, 300x5", panel, dates, 1e-7, window="expanding"),
        case(
            "minima varianza semanal con ventana de 52 y tramos de 4, 70x3",
            small,
            small_dates,
            1e-7,
            estimation_window=52,
            hold_periods=4,
        ),
        case(
            "equal weight con desplome en el primer periodo fuera de muestra, 70x3",
            crash,
            small_dates,
            1e-12,
            method="equalWeight",
            estimation_window=52,
            hold_periods=4,
        ),
    ]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"cases": cases}, indent=2) + "\n", encoding="utf-8")
    print(f"{OUT.relative_to(ROOT)}: {len(cases)} casos")
    for item in cases:
        summary = item["expected"]["summary"]
        print(
            f"  {item['name']}: {item['expected']['folds']} cortes, "
            f"{summary['periods']} periodos fuera de muestra, acumulado {summary['cumulative']:+.6f}"
        )


if __name__ == "__main__":
    main()
