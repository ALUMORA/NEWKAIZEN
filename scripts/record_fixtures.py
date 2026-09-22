#!/usr/bin/env python3
"""Graba las respuestas de los proveedores (yfinance, FRED, CBOE, Stooq, SEC EDGAR, RSS) que usan
las funciones del legado (hoy en el paquete ``kaizen_api``) y genera los goldens de caracterización.

Las funciones se resuelven por su nombre del legado con ``kaizen_api.routers.legacy_v1.LEGACY_FUNCTIONS``
y el estado se limpia con ``kaizen_api.reset_state()`` antes de cada llamada.

Fase 1 (grabación): importa ``kaizen_api`` dentro de ``recording(...)`` y llama cada función de datos.
    Lo que ya está grabado se sirve del disco (reanudable); lo demás sale a la red con ~1 llamada
    por segundo y reintentos con espera si Yahoo limita la tasa.
Fase 2 (goldens): repite cada llamada en ``replaying(...)`` (red bloqueada, reloj congelado, caches
    limpias) y guarda la salida normalizada en ``tests/goldens_legacy/<función>__<args>.json``.
    Compara contra la salida en vivo de la fase 1 y lo anota en ``live_match``.

Uso:
    python scripts/record_fixtures.py                    # graba lo que falte y regenera goldens
    python scripts/record_fixtures.py --goldens-only     # solo fase 2, sin red
    python scripts/record_fixtures.py --only 'get_chart' # filtra por regex sobre el nombre del golden
    python scripts/record_fixtures.py --refresh          # vuelve a pedir todo a los proveedores
    python scripts/record_fixtures.py --goldens-only --goldens-dir /tmp/g   # regenera en otra carpeta
"""

from __future__ import annotations

import argparse
import re
import sys
import time
from collections import Counter
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from tests.replay import (  # noqa: E402
    DEFAULT_SET,
    GOLDENS_DIR,
    FixtureStore,
    call_captured,
    compare,
    find_volatile_paths,
    golden_name,
    load_golden,
    load_module,
    recording,
    replaying,
    reset_backend_state,
    write_golden,
)

SYMBOLS = ["AAPL", "AAPL.MX", "WALMEX.MX", "CEMEXCPO.MX", "FUNO11.MX", "SPY", "^MXX", "ZZZNOTREAL"]
CHART_PERIODS = ["1mo", "1y", "5y"]
CHART_CCYS = ["", "MXN"]


def build_specs() -> list[tuple[str, list, dict]]:
    specs: list[tuple[str, list, dict]] = []
    for sym in SYMBOLS:
        specs.append(("get_stock", [sym], {}))
        for period in CHART_PERIODS:
            for ccy in CHART_CCYS:
                specs.append(("get_chart", [sym], {"period": period, "ccy": ccy}))
        specs += [
            ("get_returns", [sym], {}),
            ("get_dcf", [sym], {}),
            ("get_momentum", [sym], {}),
            ("get_news", [sym], {}),
            ("get_insiders", [sym], {}),
            ("get_magic_one", [sym], {}),
            ("get_edgar_financials", [sym], {}),
        ]
    specs += [
        ("get_magic_one", ["MSFT"], {}),
        ("get_fibras", [], {}),
        ("get_fibras", ["FUNO11.MX"], {}),
        ("get_market", [], {}),
        ("get_worldmap", [], {}),
        ("get_macro", [], {}),
        ("get_market_news", [], {}),
        ("get_rf", [], {}),
        ("get_fx", [], {}),
        ("get_magic_formula", [], {}),
    ]
    return specs


def legacy_function(name: str) -> Any:
    """La implementación en kaizen_api de una función del legado (por su nombre en los goldens)."""
    from kaizen_api.routers.legacy_v1 import LEGACY_FUNCTIONS

    return LEGACY_FUNCTIONS[name]


def prewarm_magic(rec: Any) -> None:
    """Graba la Fórmula Mágica ticker por ticker (en paralelo Yahoo limita la tasa)."""
    from kaizen_api.domain.screeners.magic import _fetch_magic_ticker
    from kaizen_api.domain.universe import MAGIC_UNIVERSE

    universe = list(dict.fromkeys(MAGIC_UNIVERSE))
    _log(f"[record] precalentando Fórmula Mágica: {len(universe)} tickers, uno por uno")
    for j, ticker in enumerate(universe, 1):
        _fetch_magic_ticker(ticker)
        if j % 10 == 0:
            _log(f"[record]   magic {j}/{len(universe)} live={rec.stats['live']}")


def _log(msg: str) -> None:
    print(msg, flush=True)


def _provider_of(key: str) -> str:
    if key.startswith("http:"):
        host = key.split(" ", 1)[1].split("/")[2]
        return f"http:{host}"
    return key.split(":", 1)[0]


def summarize(store: FixtureStore) -> dict:
    by_provider: Counter = Counter()
    failed: Counter = Counter()
    soft: Counter = Counter()
    failed_symbols: dict[str, list[str]] = {}
    for key, meta in store.index["entries"].items():
        prov = _provider_of(key)
        by_provider[prov] += 1
        if meta.get("kind") != "value":
            failed[prov] += 1
        elif meta.get("soft_failure"):
            soft[prov] += 1
        if meta.get("kind") != "value" or meta.get("soft_failure"):
            if key.startswith("yf:"):
                sym = key.split(":")[1]
                failed_symbols.setdefault(sym, []).append(key.split(":", 2)[2])
    return {
        "keys_total": sum(by_provider.values()),
        "keys_by_provider": dict(sorted(by_provider.items())),
        "exceptions_by_provider": dict(sorted(failed.items())),
        "empty_by_provider": dict(sorted(soft.items())),
        "symbols_with_failed_or_empty_calls": dict(sorted(failed_symbols.items())),
    }


def phase_record(args: argparse.Namespace, specs: list[tuple[str, list, dict]]) -> dict[str, dict]:
    live: dict[str, dict] = {}
    with recording(args.set, throttle=args.throttle, refresh=args.refresh, log=_log) as rec:
        package = load_module(args.module)
        _log(f"[record] set={args.set} frozen_at={rec.store.frozen_at} run={rec.run_id}")
        for i, (fn_name, fargs, fkwargs) in enumerate(specs, 1):
            name = golden_name(fn_name, fargs, fkwargs)
            if fn_name == "get_magic_formula":
                prewarm_magic(rec)
            t0 = time.monotonic()
            reset_backend_state(package)
            with rec.trace() as keys:
                result = call_captured(legacy_function(fn_name), fargs, fkwargs)
            live[name] = result
            status = "raises " + result["raises"]["type"] if "raises" in result else "ok"
            _log(
                f"[record] {i}/{len(specs)} {name}: {status} keys={len(keys)} "
                f"live_total={rec.stats['live']} {time.monotonic() - t0:.1f}s"
            )
        rec.store.set_meta(summary=summarize(rec.store))
        _log(f"[record] llamadas en vivo: {rec.stats['live']} ({dict(rec.provider_stats)})")
        _log(f"[record] desde disco: {rec.stats['hits']}, límite de tasa: {rec.stats['rate_limited']}")
        if rec.failures:
            _log(f"[record] {len(rec.failures)} llamadas con error o vacías en esta corrida:")
            for key, err in sorted(rec.failures.items()):
                _log(f"    {key}: {err[:140]}")
    return live


def phase_goldens(args: argparse.Namespace, specs: list[tuple[str, list, dict]], live: dict[str, dict]) -> int:
    problems = 0
    FixtureStore.forget()
    with replaying(args.set) as rp:
        package = load_module(args.module)
        for fn_name, fargs, fkwargs in specs:
            name = golden_name(fn_name, fargs, fkwargs)
            path = args.goldens_dir / name
            reset_backend_state(package)
            with rp.trace() as keys:
                result = call_captured(legacy_function(fn_name), fargs, fkwargs)
            if rp.misses:
                _log(f"[golden] {name}: FALTAN grabaciones {rp.misses}")
                rp.misses.clear()
                problems += 1
                continue
            golden = {
                "function": fn_name,
                "args": fargs,
                "kwargs": fkwargs,
                "module": args.module,
                "fixture_set": args.set,
                "frozen_at": rp.store.frozen_at,
                "volatile_paths": find_volatile_paths(result.get("output")),
                **result,
                "fixtures_used": sorted(keys),
            }
            if name in live:
                diffs = compare(result, live[name])
                golden["live_match"] = not diffs
                if diffs:
                    golden["live_diff"] = diffs
                    _log(f"[golden] {name}: la repetición difiere de la llamada en vivo: {diffs[:3]}")
            elif path.exists():
                old = load_golden(path)
                if "live_match" in old:
                    golden["live_match"] = old["live_match"]
            write_golden(path, golden)
        _log(f"[golden] {len(specs)} goldens escritos en {args.goldens_dir}")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--set", default=DEFAULT_SET, help="nombre del set en tests/fixtures/recorded/")
    parser.add_argument("--module", default="kaizen_api", help="paquete cuyo reset_state() limpia el estado")
    parser.add_argument("--goldens-dir", type=Path, default=GOLDENS_DIR, help="carpeta donde escribir los goldens")
    parser.add_argument("--only", help="regex sobre el nombre del golden")
    parser.add_argument("--throttle", type=float, default=1.0, help="segundos mínimos entre llamadas en vivo")
    parser.add_argument("--refresh", action="store_true", help="volver a pedir lo ya grabado")
    parser.add_argument("--goldens-only", action="store_true", help="no grabar, solo regenerar goldens (sin red)")
    args = parser.parse_args()

    specs = build_specs()
    if args.only:
        rx = re.compile(args.only)
        specs = [s for s in specs if rx.search(golden_name(*s))]
    live: dict[str, dict] = {}
    if not args.goldens_only:
        live = phase_record(args, specs)
    problems = phase_goldens(args, specs, live)
    store = FixtureStore.open(args.set)
    summary = summarize(store)
    _log(f"[resumen] {summary}")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
