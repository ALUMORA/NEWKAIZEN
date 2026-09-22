"""On-disk fixture store: ``tests/fixtures/recorded/<set>/index.json`` plus one file per key.

Sets can be stacked in layers with a comma-separated spec, e.g. ``"2026-09-22,2026-09-22-b2a"``
(:class:`LayeredStore`): lookups go layer by layer and the first hit wins; writes only ever go to
the LAST layer, which is created with its own ``index.json``. Earlier layers are read-only. A
single name keeps behaving exactly as before.
"""

from __future__ import annotations

import json
import os
import re
import threading
from collections.abc import Iterable, Sequence
from pathlib import Path
from typing import Any

from .keys import key_filename

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURES_ROOT = REPO_ROOT / "tests" / "fixtures" / "recorded"
DEFAULT_SET = "2026-09-22"
INDEX_NAME = "index.json"
SET_SEPARATOR = ","
_SET_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")

SetSpec = str | Sequence[str]
"""``"2026-09-22"``, ``"2026-09-22,2026-09-22-b2a"`` or ``["2026-09-22", "2026-09-22-b2a"]``."""


class FixtureSetError(ValueError):
    """A set spec that cannot be used (empty, bad name, repeated layer, layers with different clocks)."""


def parse_sets(spec: SetSpec) -> list[str]:
    """Ordered layer names of a spec. Blanks around names and empty entries are ignored.

    ``" 2026-09-22 , 2026-09-22-b2a,"`` gives ``["2026-09-22", "2026-09-22-b2a"]``. Raises
    :class:`FixtureSetError` (in Spanish) when nothing is left, a name is not a plain folder name
    (letters, digits, ``.``, ``-``, ``_``; never ``/`` or ``..``) or a layer is repeated.
    """
    parts: Iterable[Any] = spec.split(SET_SEPARATOR) if isinstance(spec, str) else spec
    names = [str(part).strip() for part in parts]
    names = [name for name in names if name]
    if not names:
        raise FixtureSetError(f"No se indicó ningún set de fixtures en {spec!r} (por ejemplo {DEFAULT_SET!r}).")
    for name in names:
        if not _SET_NAME_RE.fullmatch(name) or ".." in name:
            raise FixtureSetError(
                f"Nombre de set inválido: {name!r}. Usa solo letras, números, punto, guion y guion bajo, sin '/'."
            )
    repeated = sorted({name for name in names if names.count(name) > 1})
    if repeated:
        raise FixtureSetError(f"El set {repeated[0]!r} aparece más de una vez en {spec!r}: cada capa va una sola vez.")
    return names


def format_sets(spec: SetSpec) -> str:
    """Canonical text of a spec: ``"a,b"`` (no blanks, no empty entries)."""
    return SET_SEPARATOR.join(parse_sets(spec))


def available_sets(root: Path | None = None) -> list[str]:
    """Recorded sets (folders with an ``index.json``) under ``root``."""
    base = Path(root) if root else FIXTURES_ROOT
    if not base.is_dir():
        return []
    return sorted(p.name for p in base.iterdir() if (p / INDEX_NAME).is_file())


def _atomic_write_json(path: Path, data: Any) -> None:
    tmp = path.with_suffix(path.suffix + f".tmp{os.getpid()}.{threading.get_ident()}")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1, allow_nan=False)
        fh.write("\n")
    os.replace(tmp, path)


class FixtureStore:
    """Thread-safe access to one recorded set. Parsed records are cached; decoding happens per call."""

    _instances: dict[Path, FixtureStore] = {}
    _instances_lock = threading.Lock()

    def __init__(self, directory: Path):
        self.dir = Path(directory)
        self._lock = threading.RLock()
        self._records: dict[str, dict] = {}
        self.index: dict[str, Any] = {}
        self._load_index()

    @classmethod
    def open(cls, set_name: SetSpec = DEFAULT_SET, root: Path | None = None) -> FixtureStore | LayeredStore:
        """One set, or a :class:`LayeredStore` when ``set_name`` names several layers (``"a,b"``)."""
        names = parse_sets(set_name)
        if len(names) > 1:
            return LayeredStore.open(names, root)
        return cls._open_one(names[0], root)

    @classmethod
    def _open_one(cls, set_name: str, root: Path | None = None) -> FixtureStore:
        directory = (Path(root) if root else FIXTURES_ROOT) / set_name
        with cls._instances_lock:
            inst = cls._instances.get(directory)
            if inst is None or not inst.dir.exists():
                inst = cls(directory)
                cls._instances[directory] = inst
            return inst

    @classmethod
    def forget(cls) -> None:
        """Drop cached stores (used after re-recording in the same process)."""
        with cls._instances_lock:
            cls._instances.clear()

    # ─── index ───────────────────────────────────────────────────────────────
    def _load_index(self) -> None:
        path = self.dir / INDEX_NAME
        if path.exists():
            self.index = json.loads(path.read_text(encoding="utf-8"))
        else:
            self.index = {"set": self.dir.name, "entries": {}}
        self.index.setdefault("entries", {})

    @property
    def name(self) -> str:
        return self.dir.name

    @property
    def exists(self) -> bool:
        return (self.dir / INDEX_NAME).exists()

    @property
    def frozen_at(self) -> str | None:
        return self.index.get("frozen_at")

    def keys(self) -> list[str]:
        with self._lock:
            return sorted(self.index["entries"])

    def meta(self, key: str) -> dict | None:
        with self._lock:
            return self.index["entries"].get(key)

    def save_index(self) -> None:
        with self._lock:
            self.dir.mkdir(parents=True, exist_ok=True)
            self.index["entries"] = dict(sorted(self.index["entries"].items()))
            _atomic_write_json(self.dir / INDEX_NAME, self.index)

    def set_meta(self, **fields: Any) -> None:
        with self._lock:
            self.index.update(fields)

    # ─── records ─────────────────────────────────────────────────────────────
    def get(self, key: str) -> dict | None:
        with self._lock:
            rec = self._records.get(key)
            if rec is not None:
                return rec
            meta = self.index["entries"].get(key)
            if meta is None:
                return None
            path = self.dir / meta["file"]
            rec = json.loads(path.read_text(encoding="utf-8"))
            if rec.get("key") != key:
                raise RuntimeError(f"Fixture {path.name} no corresponde a la llave {key!r}")
            self._records[key] = rec
            return rec

    def put(self, key: str, record: dict, *, flush_index: bool = True) -> None:
        with self._lock:
            self.dir.mkdir(parents=True, exist_ok=True)
            fname = key_filename(key)
            record = {"key": key, **{k: v for k, v in record.items() if k != "key"}}
            _atomic_write_json(self.dir / fname, record)
            self._records[key] = record
            self.index["entries"][key] = {
                "file": fname,
                "provider": record.get("provider"),
                "kind": record.get("kind"),
                "soft_failure": bool(record.get("soft_failure")),
                "recorded_at": record.get("recorded_at"),
            }
            if flush_index:
                self.save_index()


class LayeredStore:
    """Several recorded sets stacked in order: the first layer that has a key answers for it.

    Reads (``get``, ``meta``, ``keys``, ``frozen_at``) look through every layer; writes (``put``,
    ``set_meta``, ``save_index``) only touch the LAST layer (``top``). ``dir`` and ``index`` are the
    top layer's, so code written for a single :class:`FixtureStore` keeps working. With one layer it
    behaves exactly like that layer.
    """

    def __init__(self, layers: Sequence[FixtureStore]):
        if not layers:
            raise FixtureSetError("Un LayeredStore necesita al menos una capa.")
        self.layers: list[FixtureStore] = list(layers)

    @classmethod
    def open(cls, spec: SetSpec = DEFAULT_SET, root: Path | None = None) -> LayeredStore:
        return cls([FixtureStore._open_one(name, root) for name in parse_sets(spec)])

    # ─── layers ──────────────────────────────────────────────────────────────
    @property
    def names(self) -> list[str]:
        return [layer.name for layer in self.layers]

    @property
    def spec(self) -> str:
        return SET_SEPARATOR.join(self.names)

    @property
    def top(self) -> FixtureStore:
        """The layer that receives new recordings."""
        return self.layers[-1]

    @property
    def bases(self) -> list[FixtureStore]:
        """Read-only layers under the top one."""
        return self.layers[:-1]

    @property
    def dir(self) -> Path:
        return self.top.dir

    @property
    def index(self) -> dict[str, Any]:
        return self.top.index

    @property
    def exists(self) -> bool:
        return all(layer.exists for layer in self.layers)

    def missing(self) -> list[FixtureStore]:
        return [layer for layer in self.layers if not layer.exists]

    @property
    def frozen_at(self) -> str | None:
        """The session clock: the first layer's ``frozen_at`` (upper layers inherit it)."""
        for layer in self.layers:
            if layer.frozen_at:
                return layer.frozen_at
        return None

    def check_clock(self) -> None:
        """Every layer that has a clock must share it, or replay would mix two different "nows"."""
        clocks = {layer.name: layer.frozen_at for layer in self.layers if layer.frozen_at}
        if len(set(clocks.values())) > 1:
            detail = ", ".join(f"{name}={at}" for name, at in clocks.items())
            raise FixtureSetError(
                f"Las capas {self.spec!r} no comparten reloj (frozen_at): {detail}. Una capa nueva hereda "
                "el frozen_at de su base; grábala de nuevo encima del set correcto."
            )

    # ─── reads: first hit wins ───────────────────────────────────────────────
    def locate(self, key: str) -> tuple[FixtureStore | None, dict | None]:
        for layer in self.layers:
            if layer.meta(key) is not None:
                return layer, layer.get(key)
        return None, None

    def get(self, key: str) -> dict | None:
        return self.locate(key)[1]

    def meta(self, key: str) -> dict | None:
        for layer in self.layers:
            found = layer.meta(key)
            if found is not None:
                return found
        return None

    def keys(self) -> list[str]:
        return sorted({key for layer in self.layers for key in layer.keys()})

    # ─── writes: only the top layer ──────────────────────────────────────────
    def put(self, key: str, record: dict, *, flush_index: bool = True) -> None:
        self.top.put(key, record, flush_index=flush_index)

    def set_meta(self, **fields: Any) -> None:
        self.top.set_meta(**fields)

    def save_index(self) -> None:
        self.top.save_index()


def open_sets(spec: SetSpec = DEFAULT_SET, root: Path | None = None) -> LayeredStore:
    """A :class:`LayeredStore` for any spec (one name or several)."""
    return LayeredStore.open(spec, root)
