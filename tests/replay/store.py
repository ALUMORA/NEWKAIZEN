"""On-disk fixture store: ``tests/fixtures/recorded/<set>/index.json`` plus one file per key."""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any

from .keys import key_filename

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURES_ROOT = REPO_ROOT / "tests" / "fixtures" / "recorded"
DEFAULT_SET = "2026-09-22"
INDEX_NAME = "index.json"


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
    def open(cls, set_name: str = DEFAULT_SET, root: Path | None = None) -> FixtureStore:
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
