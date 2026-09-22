"""Goldens: JSON-normalize backend outputs, find volatile fields, compare with tolerance.

Path syntax for volatile fields: dotted keys, ``[*]`` for every list element, e.g.
``news[*].time`` or ``asOf``. A volatile field must still EXIST on both sides with a value of
the same JSON type; only its value is ignored.
"""

from __future__ import annotations

import importlib
import json
import math
import re
import sys
from pathlib import Path
from typing import Any

from .store import REPO_ROOT

GOLDENS_DIR = REPO_ROOT / "tests" / "goldens_legacy"

# Replay congela el reloj y sirve datos grabados, así que ningún campo es volátil por defecto:
# enmascarar "time" o "asOf" escondía regresiones reales (fechas de noticias, fecha de la rf).
# Un golden puede declarar volatile_paths a mano si de verdad depende de algo no controlado.
VOLATILE_KEYS: frozenset[str] = frozenset()
NONFINITE_TAG = "__nonfinite__"


# ─── normalization ───────────────────────────────────────────────────────────


def _tag_nonfinite(obj: Any) -> Any:
    if isinstance(obj, float) and not math.isfinite(obj):
        return {NONFINITE_TAG: "nan" if math.isnan(obj) else ("inf" if obj > 0 else "-inf")}
    if isinstance(obj, dict):
        return {k: _tag_nonfinite(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_tag_nonfinite(v) for v in obj]
    return obj


def normalize(result: Any) -> Any:
    """What the legacy HTTP handler would put on the wire (``json.dumps(default=str)``), parsed back.

    NaN/inf (which the legacy handler emits as invalid JSON tokens) are tagged so goldens stay
    strict JSON and the fact is visible.
    """
    return _tag_nonfinite(json.loads(json.dumps(result, default=str)))


def find_volatile_paths(obj: Any, prefix: str = "") -> list[str]:
    found: set[str] = set()

    def walk(node: Any, path: str) -> None:
        if isinstance(node, dict):
            for k, v in node.items():
                p = f"{path}.{k}" if path else k
                if k in VOLATILE_KEYS:
                    found.add(p)
                walk(v, p)
        elif isinstance(node, list):
            for v in node:
                walk(v, f"{path}[*]")

    walk(obj, prefix)
    return sorted(found)


def _path_matches(path: str, patterns: list[str]) -> bool:
    for pat in patterns:
        rx = "^" + re.escape(pat).replace(r"\[\*\]", r"\[\d+\]") + "$"
        if re.match(rx, path):
            return True
    return False


# ─── comparison ──────────────────────────────────────────────────────────────


def _json_type(v: Any) -> str:
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "bool"
    if isinstance(v, (int, float)):
        return "number"
    if isinstance(v, str):
        return "string"
    if isinstance(v, list):
        return "list"
    return "object"


def compare(
    actual: Any,
    expected: Any,
    *,
    volatile: list[str] | tuple[str, ...] = (),
    rel: float = 1e-9,
    abs_tol: float = 1e-12,
    limit: int = 20,
) -> list[str]:
    """Return a list of human-readable differences (empty when equal)."""
    diffs: list[str] = []
    volatile = list(volatile)

    def add(msg: str) -> None:
        if len(diffs) < limit:
            diffs.append(msg)

    def walk(a: Any, e: Any, path: str) -> None:
        if path and _path_matches(path, volatile):
            if _json_type(a) != _json_type(e):
                add(f"{path}: tipo {_json_type(a)} != {_json_type(e)} (campo volátil)")
            return
        if isinstance(e, dict) and isinstance(a, dict):
            for k in sorted(set(e) - set(a)):
                add((f"{path}.{k}" if path else k) + ": falta en el resultado")
            for k in sorted(set(a) - set(e)):
                add((f"{path}.{k}" if path else k) + ": sobra en el resultado")
            for k in e:
                if k in a:
                    walk(a[k], e[k], f"{path}.{k}" if path else k)
            return
        if isinstance(e, list) and isinstance(a, list):
            if len(a) != len(e):
                add(f"{path}: longitud {len(a)} != {len(e)}")
            for i, (x, y) in enumerate(zip(a, e, strict=False)):
                walk(x, y, f"{path}[{i}]")
            return
        if isinstance(e, bool) or isinstance(a, bool):
            if a is not e:
                add(f"{path}: {a!r} != {e!r}")
            return
        if isinstance(e, (int, float)) and isinstance(a, (int, float)):
            if not math.isclose(a, e, rel_tol=rel, abs_tol=abs_tol):
                add(f"{path}: {a!r} != {e!r}")
            return
        if a != e:
            add(f"{path or '<raíz>'}: {a!r} != {e!r}")

    walk(actual, expected, "")
    return diffs


# ─── golden files ────────────────────────────────────────────────────────────


def slug(value: Any) -> str:
    s = str(value)
    if s == "":
        return "empty"
    s = s.replace("^", "idx-").replace("=", "-eq")
    return re.sub(r"[^A-Za-z0-9.\-]+", "_", s).strip("_") or "x"


def golden_name(function: str, args: list, kwargs: dict) -> str:
    parts = [slug(a) for a in args] + [f"{k}-{slug(v)}" for k, v in sorted(kwargs.items())]
    return f"{function}__{'__'.join(parts) if parts else 'noargs'}.json"


def list_goldens(directory: Path = GOLDENS_DIR) -> list[Path]:
    return sorted(p for p in directory.glob("*.json") if not p.name.startswith("_"))


def load_golden(path: Path) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_golden(path: Path, data: dict) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def call_captured(fn: Any, args: list, kwargs: dict) -> dict:
    """Call ``fn`` and return ``{"output": normalized}`` or ``{"raises": {type, str}}``.

    ReplayMiss / NetworkBlocked (BaseException) are NOT captured: they must fail loudly.
    """
    try:
        result = fn(*args, **kwargs)
    except Exception as exc:
        return {"raises": {"type": type(exc).__name__, "str": str(exc)}}
    return {"output": normalize(result)}


# ─── legacy module helpers ───────────────────────────────────────────────────


def load_module(name: str = "backend") -> Any:
    """Import the backend module from the repo root (``backend`` today, ``kaizen_api...`` later)."""
    root = str(REPO_ROOT)
    if root not in sys.path:
        sys.path.insert(0, root)
    return importlib.import_module(name)


def reset_backend_state(module: Any) -> None:
    """Clear in-memory caches so every call exercises the providers.

    Uses ``module.reset_state()`` when the module provides one (new package), otherwise the
    legacy globals: ``_cache``, ``_key_locks`` and ``_edgar_ticker_cache``.
    """
    hook = getattr(module, "reset_state", None)
    if callable(hook):
        hook()
        return
    for name in ("_cache", "_key_locks"):
        obj = getattr(module, name, None)
        if hasattr(obj, "clear"):
            obj.clear()
    edgar = getattr(module, "_edgar_ticker_cache", None)
    if isinstance(edgar, dict):
        edgar.update({"data": None, "ts": 0})
