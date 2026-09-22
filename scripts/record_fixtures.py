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

Capas (fase 2): ``--set`` acepta varios sets separados por coma, en orden de búsqueda. Lo que ya
está en una capa anterior se sirve de ahí sin tocarla; lo nuevo se graba SOLO en la última capa, que
se crea con su propio ``index.json`` y hereda el reloj (``frozen_at``) de la base. Así cada stream
graba en su carpeta sin chocar con los demás en un mismo ``index.json``:

    # B2a graba las llamadas que hacen sus rutas v2 (TestClient sobre create_app, sin servidor)
    python scripts/record_fixtures.py --set 2026-09-22,2026-09-22-b2a \
        --get '/v2/history/WALMEX.MX?range=1y&ccy=MXN' --get '/v2/quotes?symbols=AAPL,WALMEX.MX'
    # lo mismo sin red: solo comprueba que esas rutas se reproducen completas desde las capas
    python scripts/record_fixtures.py --set 2026-09-22,2026-09-22-b2a --get '/v2/quotes?symbols=AAPL' --goldens-only

Con ``--get`` no se tocan los goldens del legado. Sin ``--get`` y con varias capas hay que pasar
``--goldens-dir``: los goldens de ``tests/goldens_legacy`` quedan fijos en el set base. Al terminar
se revisa que ningún token del entorno (BANXICO_TOKEN, FRED_API_KEY, EODHD_API_TOKEN) haya quedado
escrito en la capa grabada; si aparece, sale con error y hay que borrar esos archivos antes de commitear.
"""

from __future__ import annotations

import argparse
import os
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
    FixtureSetError,
    FixtureStore,
    call_captured,
    compare,
    find_volatile_paths,
    format_sets,
    golden_name,
    load_golden,
    load_module,
    open_sets,
    parse_sets,
    recording,
    replaying,
    reset_backend_state,
    write_golden,
)

SECRET_ENV_VARS = ("BANXICO_TOKEN", "FRED_API_KEY", "EODHD_API_TOKEN", "SECRET_KEY")
"""Variables cuyo valor nunca puede terminar en un fixture (el repo es público)."""
ROUTE_ENV_PASSTHROUGH = ("BANXICO_TOKEN", "FRED_API_KEY", "EODHD_API_TOKEN")
"""Llaves de proveedores que ``--get`` pasa a la app para que grabe el camino con token."""

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
    with recording(args.set, root=args.root, throttle=args.throttle, refresh=args.refresh, log=_log) as rec:
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
        rec.store.set_meta(summary=summarize(rec.store.top))
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
    with replaying(args.set, root=args.root) as rp:
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
            else:
                # Sin llamada en vivo se conserva el live_match anterior (del destino o del commiteado)
                previous = path if path.exists() else GOLDENS_DIR / name
                if previous.exists():
                    old = load_golden(previous)
                    if "live_match" in old:
                        golden["live_match"] = old["live_match"]
            write_golden(path, golden)
        _log(f"[golden] {len(specs)} goldens escritos en {args.goldens_dir}")
    return problems


def leaked_secrets(directory: Path) -> list[str]:
    """Archivos de ``directory`` que contienen el valor de algún token del entorno."""
    secrets = {var: os.environ[var] for var in SECRET_ENV_VARS if len(os.environ.get(var) or "") >= 8}
    if not secrets or not directory.is_dir():
        return []
    hits = []
    for path in sorted(directory.iterdir()):
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        hits += [f"{path.name}: contiene el valor de {var}" for var, value in secrets.items() if value in text]
    return hits


def _route_app() -> Any:
    """La app v2 en desarrollo, sin sesión obligatoria, con las llaves de proveedores del entorno."""
    from kaizen_api.main import create_app
    from kaizen_api.settings import Settings

    env = {"KAIZEN_ENV": "development", "AUTH_REQUIRED": "false", "KAIZEN_LEGACY_ROUTES": "1"}
    env.update({var: os.environ[var] for var in ROUTE_ENV_PASSTHROUGH if os.environ.get(var)})
    return create_app(Settings.from_env(env))


def _get_routes(session: Any, paths: list[str], tag: str) -> dict[str, dict]:
    """GET de cada ruta con TestClient (cachés limpias antes de cada una); status, cuerpo y llaves usadas."""
    from fastapi.testclient import TestClient

    from kaizen_api.settings import configure

    package = load_module("kaizen_api")
    out: dict[str, dict] = {}
    try:
        client = TestClient(_route_app(), raise_server_exceptions=False)
        for path in paths:
            reset_backend_state(package)
            with session.trace() as keys:
                resp = client.get(path)
            try:
                body = resp.json()
            except ValueError:
                body = resp.text
            out[path] = {"status": resp.status_code, "body": body, "keys": sorted(keys)}
            note = " (todavía 501: no llama a ningún proveedor)" if resp.status_code == 501 else ""
            _log(f"[{tag}] GET {path}: {resp.status_code}, {len(keys)} llamadas a proveedores{note}")
    finally:
        configure(None)
    return out


def run_routes(args: argparse.Namespace) -> int:
    """``--get``: graba en la última capa lo que piden las rutas v2 y luego verifica el replay."""
    paths = [p if p.startswith("/") else "/" + p for p in args.get]
    recorded: dict[str, dict] = {}
    if not args.goldens_only:
        with recording(args.set, root=args.root, throttle=args.throttle, refresh=args.refresh, log=_log) as rec:
            _log(
                f"[record] capas={rec.set_name} graba en={rec.store.top.name} "
                f"frozen_at={rec.store.frozen_at} run={rec.run_id}"
            )
            recorded = _get_routes(rec, paths, "record")
            rec.store.set_meta(summary=summarize(rec.store.top))
            _log(
                f"[record] en vivo: {rec.stats['live']}, desde disco: {rec.stats['hits']} "
                f"(de capas base: {rec.stats['base_hits']}), límite de tasa: {rec.stats['rate_limited']}"
            )
            for key, err in sorted(rec.failures.items()):
                _log(f"    con error o vacía: {key}: {err[:140]}")
    problems = 0
    FixtureStore.forget()
    with replaying(args.set, root=args.root) as rp:
        replayed = _get_routes(rp, paths, "replay")
        if rp.misses:
            problems += 1
            _log(f"[replay] FALTAN grabaciones en todas las capas: {sorted(set(rp.misses))[:20]}")
            rp.misses.clear()
    for path, got in replayed.items():
        want = recorded.get(path)
        if want is None:
            continue
        if want["status"] != got["status"] or compare(got["body"], want["body"]):
            problems += 1
            diffs = compare(got["body"], want["body"])[:3]
            _log(f"[replay] GET {path}: difiere de la grabación ({want['status']} vs {got['status']}) {diffs}")
    top = open_sets(args.set, args.root).top
    leaks = leaked_secrets(top.dir)
    if leaks:
        problems += 1
        _log(
            f"[secretos] {len(leaks)} archivo(s) de {top.dir} tienen un token; bórralos y manda el token en un header:"
        )
        for hit in leaks:
            _log(f"    {hit}")
    for layer in open_sets(args.set, args.root).layers:
        _log(f"[resumen] {layer.name}: {len(layer.keys())} llamadas grabadas")
    _log("[resultado] " + ("con problemas" if problems else "todas las rutas se reproducen completas desde las capas"))
    return 1 if problems else 0


def run_legacy(args: argparse.Namespace) -> int:
    """Las funciones del legado: graba lo que falte y regenera sus goldens."""
    specs = build_specs()
    if args.only:
        rx = re.compile(args.only)
        specs = [s for s in specs if rx.search(golden_name(*s))]
    live: dict[str, dict] = {}
    if not args.goldens_only:
        live = phase_record(args, specs)
    problems = phase_goldens(args, specs, live)
    stack = open_sets(args.set, args.root)
    if len(stack.layers) == 1:
        _log(f"[resumen] {summarize(stack.top)}")
    else:
        for layer in stack.layers:
            _log(f"[resumen] {layer.name}: {summarize(layer)}")
    if not args.goldens_only:
        leaks = leaked_secrets(stack.top.dir)
        for hit in leaks:
            _log(f"[secretos] {hit}")
        problems += len(leaks)
    return 1 if problems else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--set",
        default=DEFAULT_SET,
        help="set en tests/fixtures/recorded/, o varios separados por coma en orden de búsqueda; "
        "se graba solo en el último (p. ej. 2026-09-22,2026-09-22-b2a)",
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=None,
        help="carpeta que contiene los sets (por omisión tests/fixtures/recorded); sirve para grabar en borrador",
    )
    parser.add_argument("--module", default="kaizen_api", help="paquete cuyo reset_state() limpia el estado")
    parser.add_argument("--goldens-dir", type=Path, default=GOLDENS_DIR, help="carpeta donde escribir los goldens")
    parser.add_argument("--only", help="regex sobre el nombre del golden")
    parser.add_argument("--throttle", type=float, default=1.0, help="segundos mínimos entre llamadas en vivo")
    parser.add_argument("--refresh", action="store_true", help="volver a pedir lo ya grabado")
    parser.add_argument(
        "--goldens-only",
        action="store_true",
        help="no grabar (sin red): regenera los goldens del legado o, con --get, solo verifica las rutas en replay",
    )
    parser.add_argument(
        "--get",
        action="append",
        metavar="RUTA",
        help="ruta v2 a pedir con TestClient (repetible), p. ej. '/v2/quotes?symbols=AAPL'; no toca goldens",
    )
    args = parser.parse_args()
    try:
        layers = parse_sets(args.set)
    except FixtureSetError as exc:
        _log(f"[error] {exc}")
        return 2
    args.set = format_sets(layers)
    try:
        if args.get:
            return run_routes(args)
        if len(layers) > 1 and args.goldens_dir.resolve() == GOLDENS_DIR.resolve():
            _log(
                "[error] Con varias capas usa --get para grabar rutas v2, o --goldens-dir para regenerar goldens "
                "del legado en otra carpeta: los de tests/goldens_legacy quedan fijos en el set base."
            )
            return 2
        return run_legacy(args)
    except FileNotFoundError as exc:
        _log(f"[error] {exc}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
