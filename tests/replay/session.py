"""Record/replay sessions: install the stand-ins, freeze time, block the network.

A session takes one recorded set or several stacked layers (``"2026-09-22,2026-09-22-b2a"``):
replay looks each key up layer by layer (first hit wins, a miss only after every layer); recording
serves keys found in earlier layers from those layers as they are and writes new calls ONLY to the
last layer. The clock is the first layer's ``frozen_at`` and a new top layer inherits it.

Recording never touches the shared base set by accident: a spec whose comma collapsed into a single
layer is refused (``check_record_spec``), writing into ``DEFAULT_SET`` needs ``allow_base=True``
(``check_base_write``) and the top layer is only created on disk when something is actually written.
"""

from __future__ import annotations

import concurrent.futures
import datetime as _dt
import importlib
import logging
import threading
import time
import uuid
from collections import Counter
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from . import guard
from .proxies import (
    default_decoder,
    default_encoder,
    make_download,
    make_session_request,
    make_ticker_class,
)
from .serialize import SerializationError, decode, encode
from .store import (
    DEFAULT_SET,
    FIXTURES_ROOT,
    FixtureStore,
    LayeredStore,
    SetSpec,
    available_sets,
    check_base_write,
    check_record_spec,
    parse_sets,
)

_real_sleep = time.sleep
_RATE_LIMIT_MARKERS = ("too many requests", "rate limited", "yfratelimiterror")


class ReplayMiss(BaseException):  # noqa: N818 - public name fixed by the task contract
    """An upstream call had no recording. BaseException so ``except Exception`` cannot hide it."""

    def __init__(self, key: str, set_name: str = ""):
        super().__init__(key)
        self.key = key
        self.set_name = set_name

    def __str__(self) -> str:
        names = [n for n in self.set_name.split(",") if n]
        if len(names) > 1:
            listed = ", ".join(repr(n) for n in names)
            return f"Llamada no grabada en ninguno de los sets {listed}: {self.key}"
        return f"Llamada no grabada en el set {self.set_name!r}: {self.key}"


class RecordedUpstreamError(Exception):
    """Fallback for a recorded exception whose original class cannot be rebuilt."""

    def __init__(self, type_name: str, message: str):
        super().__init__(message)
        self.type_name = type_name


# ─── exceptions ⇄ records ────────────────────────────────────────────────────


def exception_to_record(exc: BaseException) -> dict:
    cls = type(exc)
    try:
        args = encode(list(exc.args))
    except SerializationError:
        args = [str(a) for a in exc.args]
    return {"type": f"{cls.__module__}.{cls.__qualname__}", "args": args, "str": str(exc)}


def _import_qualname(path: str) -> Any:
    # "pkg.mod.Outer.Inner": import the longest importable module prefix, then walk attributes
    parts = path.split(".")
    for i in range(len(parts) - 1, 0, -1):
        try:
            obj: Any = importlib.import_module(".".join(parts[:i]))
        except Exception:
            continue
        for attr in parts[i:]:
            obj = getattr(obj, attr)
        return obj
    raise ImportError(path)


def exception_from_record(rec: dict) -> Exception:
    message = rec.get("str", "")
    args = decode(rec.get("args") or [])
    try:
        cls = _import_qualname(rec["type"])
    except Exception:
        cls = None
    if isinstance(cls, type) and issubclass(cls, Exception):
        try:
            exc = cls(*args)
            if str(exc) == message:
                return exc
        except Exception:
            pass
        try:
            sub = type(
                cls.__name__,
                (cls,),
                {
                    "__init__": lambda self, *a: Exception.__init__(self, *a),
                    "__str__": lambda self, _m=message: _m,
                    "__module__": cls.__module__,
                },
            )
            return sub(*args)
        except Exception:
            pass
    return RecordedUpstreamError(rec.get("type", "?"), message)


def _is_empty(value: Any) -> bool:
    empty = getattr(value, "empty", None)
    if isinstance(empty, bool):
        return empty
    if isinstance(value, (list, dict, tuple)):
        return len(value) == 0
    return False


def _missing_sets_message(missing: list[FixtureStore], root: Path | None, *, what: str, hint: str = "") -> str:
    base = Path(root) if root else FIXTURES_ROOT
    names = ", ".join(repr(layer.name) for layer in missing)
    known = ", ".join(available_sets(root)) or "ninguno"
    where = ", ".join(str(layer.dir) for layer in missing)
    return f"No existe el set grabado {names} ({where}){what}. Sets disponibles en {base}: {known}.{hint}"


def _rank(rec: dict | None) -> int:
    if rec is None:
        return -1
    if rec.get("kind") != "value":
        return 0
    return 1 if rec.get("soft_failure") else 2


# ─── deterministic scheduling ────────────────────────────────────────────────


def ordered_as_completed(fs: Any, timeout: float | None = None) -> Iterator[concurrent.futures.Future]:
    """``as_completed`` that yields in SUBMISSION order (same timeout contract).

    The legacy Magic Formula appends candidates in completion order and then does stable sorts
    on rounded ratios, so ties are broken by thread scheduling. Yielding in submission order
    (the universe order) is one legal schedule of the legacy code and makes it reproducible.
    """
    futures = list(fs)
    end = None if timeout is None else time.monotonic() + timeout
    for i, fut in enumerate(futures):
        remaining = None if end is None else max(0.0, end - time.monotonic())
        concurrent.futures.wait([fut], timeout=remaining)
        if not fut.done():
            pending = sum(1 for f in futures[i:] if not f.done())
            raise concurrent.futures.TimeoutError(f"{pending} (of {len(futures)}) futures unfinished")
        yield fut


class _YFLogCapture(logging.Handler):
    """Collects yfinance log lines per thread so hidden rate-limit errors can be detected."""

    def __init__(self) -> None:
        super().__init__(level=logging.DEBUG)
        self.local = threading.local()

    def emit(self, record: logging.LogRecord) -> None:
        buf = getattr(self.local, "buf", None)
        if buf is not None:
            try:
                buf.append(record.getMessage())
            except Exception:
                buf.append(str(record.msg))


# ─── the session ─────────────────────────────────────────────────────────────

_active_lock = threading.Lock()
_active: ReplaySession | None = None


class ReplaySession:
    """One installed record or replay context. Patches are process-global; one at a time."""

    def __init__(
        self,
        set_name: SetSpec = DEFAULT_SET,
        *,
        mode: str = "replay",
        root: Path | None = None,
        freeze_time: bool = True,
        block_network: bool | None = None,
        fast_sleep: bool | None = None,
        deterministic_futures: bool = True,
        throttle: float = 1.0,
        refresh: bool = False,
        allow_base: bool = False,
        max_retries: int = 4,
        backoff: float = 20.0,
        log: Callable[[str], None] | None = None,
    ):
        if mode not in ("replay", "record"):
            raise ValueError(f"modo inválido: {mode}")
        # Al grabar, una coma que se quedó en una sola capa es un error: escribiría en esa capa.
        self.set_names = check_record_spec(set_name) if mode == "record" else parse_sets(set_name)
        self.set_name = ",".join(self.set_names)
        self.mode = mode
        self.store = LayeredStore.open(self.set_names, root)
        if mode == "replay" and self.store.missing():
            hint = (
                " Una capa que no grabó ninguna llamada no se crea: quítala del spec o graba algo en ella."
                if len(self.store.layers) > 1
                else ""
            )
            raise FileNotFoundError(_missing_sets_message(self.store.missing(), root, what="", hint=hint))
        if mode == "record":
            check_base_write(self.store.top.name, allow_base=allow_base)
            missing_bases = [layer for layer in self.store.bases if not layer.exists]
            if missing_bases:
                raise FileNotFoundError(
                    _missing_sets_message(
                        missing_bases,
                        root,
                        what=": las capas base tienen que existir, al grabar solo se crea la última",
                    )
                )
        self.store.check_clock()
        self.freeze_time = freeze_time
        self.block_network = (mode == "replay") if block_network is None else block_network
        self.fast_sleep = (mode == "replay") if fast_sleep is None else fast_sleep
        self.deterministic_futures = deterministic_futures
        self.throttle = throttle
        self.refresh = refresh
        self.allow_base = allow_base
        self.max_retries = max_retries
        self.backoff = backoff
        self.log = log or (lambda msg: None)

        self.run_id = uuid.uuid4().hex[:12]
        self.orig: dict[str, Any] = {}
        self.misses: list[str] = []
        self.failures: dict[str, str] = {}
        self.stats: Counter = Counter()
        self.provider_stats: Counter = Counter()
        self._trace: list[str] | None = None
        self._lock = threading.RLock()
        self._key_locks: dict[str, threading.Lock] = {}
        self._seen: set[str] = set()
        self._tl = threading.local()
        self._throttle_lock = threading.Lock()
        self._last_live = 0.0
        self._traveller: Any = None
        self._logcap: _YFLogCapture | None = None
        self._installed = False

    # ─── time ────────────────────────────────────────────────────────────────
    @property
    def frozen_at(self) -> _dt.datetime | None:
        raw = self.store.frozen_at
        return _dt.datetime.fromisoformat(raw) if raw else None

    @staticmethod
    def real_now() -> _dt.datetime:
        try:
            import time_machine

            ts = time_machine.escape_hatch.time.time()
        except Exception:  # pragma: no cover
            ts = time.time()
        return _dt.datetime.fromtimestamp(ts, _dt.UTC)

    # ─── install / uninstall ─────────────────────────────────────────────────
    def install(self) -> ReplaySession:
        global _active
        with _active_lock:
            if _active is not None:
                raise RuntimeError("Ya hay una sesión de replay/grabación instalada")
            _active = self
        import requests
        import yfinance

        # Only the public names: yfinance's own modules bind Ticker at import time and its
        # classes call super(Ticker, self), so patching yfinance.ticker.Ticker breaks them.
        self.orig = {
            "Ticker": yfinance.Ticker,
            "download": yfinance.download,
            "Session.request": requests.Session.request,
            "as_completed": concurrent.futures.as_completed,
            "sleep": time.sleep,
        }
        top = self.store.top
        if self.mode == "record" and not top.frozen_at:
            # A new layer inherits the clock of the layers under it, so keys that depend on "now"
            # (date ranges in URLs) are the same when recording and when replaying the stack.
            # Only in memory: the folder and its index.json are written by the first put(), so a
            # layer that records nothing (everything served by the base) is never materialized.
            now = self.real_now().replace(microsecond=0)
            fields: dict[str, Any] = {
                "set": top.name,
                "frozen_at": self.store.frozen_at or now.isoformat(),
                "created_at": now.isoformat(),
                "yfinance_version": getattr(yfinance, "__version__", "?"),
            }
            if self.store.bases:
                fields["layered_on"] = [layer.name for layer in self.store.bases]
            top.set_meta(**fields)

        ticker_cls = make_ticker_class(self)
        download = make_download(self)
        yfinance.Ticker = ticker_cls
        yfinance.download = download
        requests.Session.request = make_session_request(self)
        if self.deterministic_futures:
            concurrent.futures.as_completed = ordered_as_completed
        if self.fast_sleep:
            time.sleep = lambda seconds=0: _real_sleep(0)
        if self.block_network:
            guard.block_network()
        if self.mode == "record":
            self._logcap = _YFLogCapture()
            logging.getLogger("yfinance").addHandler(self._logcap)
        if self.freeze_time and self.frozen_at is not None:
            import time_machine

            self._traveller = time_machine.travel(self.frozen_at, tick=False)
            self._traveller.start()
        self._installed = True
        return self

    def uninstall(self) -> None:
        global _active
        if not self._installed:
            return
        import requests
        import yfinance

        if self._traveller is not None:
            self._traveller.stop()
            self._traveller = None
        if self._logcap is not None:
            logging.getLogger("yfinance").removeHandler(self._logcap)
            self._logcap = None
        if self.block_network:
            guard.unblock_network()
        yfinance.Ticker = self.orig["Ticker"]
        yfinance.download = self.orig["download"]
        requests.Session.request = self.orig["Session.request"]
        concurrent.futures.as_completed = self.orig["as_completed"]
        time.sleep = self.orig["sleep"]
        if self.mode == "record":
            top = self.store.top
            if top.index["entries"] or top.exists:
                self.store.set_meta(updated_at=self.real_now().replace(microsecond=0).isoformat())
                self.store.save_index()
            else:
                # Nada nuevo que guardar: la capa no se crea vacía (si no, cada stream commitearía
                # una carpeta con un index.json sin entradas).
                self.log(f"[record] la capa {top.name!r} no grabó ninguna llamada: no se crea {top.dir}")
        self._installed = False
        with _active_lock:
            _active = None

    def __enter__(self) -> ReplaySession:
        return self.install()

    def __exit__(self, *exc: Any) -> None:
        self.uninstall()

    # ─── tracing (which keys a call touched) ────────────────────────────────
    @contextmanager
    def trace(self) -> Iterator[list[str]]:
        keys: list[str] = []
        self._trace = keys
        try:
            yield keys
        finally:
            self._trace = None

    def passthrough_http(self) -> bool:
        return self.mode == "record" and getattr(self._tl, "in_yf", 0) > 0

    # ─── the single entry point used by every stand-in ───────────────────────
    def call(
        self,
        key: str,
        live_fn: Callable[[], Any],
        *,
        provider: str,
        meta: dict,
        encoder: Callable[[Any], Any] = default_encoder,
        decoder: Callable[[Any], Any] = default_decoder,
    ) -> Any:
        trace = self._trace
        if trace is not None:
            with self._lock:
                if key not in trace:
                    trace.append(key)
        if self.mode == "replay":
            rec = self.store.get(key)
            if rec is None:
                with self._lock:
                    self.misses.append(key)
                raise ReplayMiss(key, self.set_name)
            self.stats["hits"] += 1
            return self._materialize(rec, decoder)

        with self._lock:
            key_lock = self._key_locks.setdefault(key, threading.Lock())
        with key_lock:
            layer, rec = self.store.locate(key)
            if rec is not None and layer is not self.store.top:
                # An earlier layer is read-only and shadows the top one: served as recorded, even a
                # recorded failure and even with refresh. Re-record it in its own set, never here.
                self.stats["hits"] += 1
                self.stats["base_hits"] += 1
                return self._materialize(rec, decoder)
            if rec is not None and (key in self._seen or (not self.refresh and _rank(rec) == 2)):
                self.stats["hits"] += 1
                return self._materialize(rec, decoder)
            new = self._live(key, live_fn, provider, encoder)
            self._seen.add(key)
            if _rank(new) >= _rank(rec):
                record = {
                    "provider": provider,
                    **meta,
                    **new,
                    "recorded_at": self.real_now().replace(microsecond=0).isoformat(),
                    "frozen_at": self.store.frozen_at,
                    "run_id": self.run_id,
                }
                self.store.put(key, record)
                rec = self.store.top.get(key)
            else:
                self.stats["kept_previous"] += 1
            if rec.get("kind") != "value":
                self.failures[key] = rec["exception"]["str"]
            elif rec.get("soft_failure"):
                self.failures[key] = "respuesta vacía"
            else:
                self.failures.pop(key, None)
            return self._materialize(rec, decoder)

    def _materialize(self, rec: dict, decoder: Callable[[Any], Any]) -> Any:
        if rec.get("kind") == "exception":
            raise exception_from_record(rec["exception"])
        return decoder(rec["payload"])

    def _throttle_wait(self) -> None:
        with self._throttle_lock:
            wait = self._last_live + self.throttle - time.monotonic()
            if wait > 0:
                _real_sleep(wait)
            self._last_live = time.monotonic()

    def _live(self, key: str, live_fn: Callable[[], Any], provider: str, encoder: Callable[[Any], Any]) -> dict:
        is_yf = provider != "http"
        attempt = 0
        while True:
            self._throttle_wait()
            self.stats["live"] += 1
            self.provider_stats[provider] += 1
            if self._logcap is not None:
                self._logcap.local.buf = []
            if is_yf:
                self._tl.in_yf = getattr(self._tl, "in_yf", 0) + 1
            error: Exception | None = None
            value: Any = None
            try:
                value = live_fn()
            except Exception as exc:  # recorded, the backend decides what to do with it
                error = exc
            finally:
                if is_yf:
                    self._tl.in_yf -= 1
            logs = []
            if self._logcap is not None:
                logs = self._logcap.local.buf or []
                self._logcap.local.buf = None
            text = " ".join([str(error) if error else "", type(error).__name__ if error else "", *logs]).lower()
            rate_limited = any(m in text for m in _RATE_LIMIT_MARKERS) or (
                provider == "http" and error is None and getattr(value, "status_code", 0) == 429
            )
            if rate_limited and attempt < self.max_retries:
                delay = self.backoff * (2**attempt)
                self.stats["rate_limited"] += 1
                self.log(f"[rate-limit] {key}: reintento {attempt + 1}/{self.max_retries} en {delay:.0f}s")
                _real_sleep(delay)
                attempt += 1
                continue
            if error is not None:
                self.log(f"[upstream-error] {key}: {type(error).__name__}: {str(error)[:160]}")
                return {"kind": "exception", "exception": exception_to_record(error), "logs": logs[:5]}
            payload = encoder(value)
            soft = _is_empty(value) or (provider == "http" and getattr(value, "status_code", 200) >= 400)
            out = {"kind": "value", "payload": payload, "soft_failure": soft}
            if logs:
                out["logs"] = logs[:5]
            return out


# ─── public helpers ──────────────────────────────────────────────────────────


@contextmanager
def replaying(set_name: SetSpec = DEFAULT_SET, **kwargs: Any) -> Iterator[ReplaySession]:
    """Serve every yfinance/HTTP call from fixtures. Network blocked, time frozen, sleeps skipped.

    ``set_name`` may stack layers (``"2026-09-22,2026-09-22-b2a"``): first hit wins.
    """
    session = ReplaySession(set_name, mode="replay", **kwargs)
    with session:
        yield session


@contextmanager
def recording(set_name: SetSpec = DEFAULT_SET, **kwargs: Any) -> Iterator[ReplaySession]:
    """Serve recorded calls from fixtures and fetch (throttled) + store everything else.

    With several layers, keys found in earlier layers come from them untouched and every new call
    is written to the LAST layer only (created with its own ``index.json`` at the first write; a
    layer that records nothing is not created). Two guards protect the shared base set: a spec with
    a comma that collapsed into one layer is refused, and writing into ``DEFAULT_SET`` needs
    ``allow_base=True``.
    """
    session = ReplaySession(set_name, mode="record", **kwargs)
    with session:
        yield session


def install_replay(set_name: SetSpec = DEFAULT_SET, **kwargs: Any) -> ReplaySession:
    """Install replay process-wide (for servers/scripts). Call ``.uninstall()`` to undo.

    Accepts the same one-or-several-layers spec as :func:`replaying`.
    """
    return ReplaySession(set_name, mode="replay", **kwargs).install()


def active_session() -> ReplaySession | None:
    return _active
