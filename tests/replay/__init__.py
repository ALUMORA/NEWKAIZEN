"""Deterministic record/replay of every upstream provider used by the backend.

Patches the OUTERMOST I/O boundary the backend touches:

* ``yfinance.Ticker`` (every property and method, including ``fast_info`` attribute and
  dict-like access) and ``yfinance.download``;
* ``requests.Session.request``, which ``requests.get`` and every ``Session.get`` go through
  (FRED, CBOE, Stooq, SEC EDGAR, RSS).

Usage::

    from tests.replay import replaying, recording, install_replay

    with replaying("2026-09-22") as rp:   # network blocked, time frozen, ReplayMiss on gaps
        backend.get_stock("AAPL")

    with recording("2026-09-22") as rec:  # recorded keys served from disk, the rest fetched
        backend.get_stock("MSFT")

    session = install_replay("2026-09-22")  # process-wide, e.g. for a server
    ...
    session.uninstall()

Layers: every entry point takes an ordered comma-separated list of sets::

    with replaying("2026-09-22,2026-09-22-b2a"):   # key by key, the first layer that has it wins
        ...
    with recording("2026-09-22,2026-09-22-b2a"):   # new calls go ONLY to 2026-09-22-b2a
        ...

Recording guards the shared base set: a comma that collapsed into one layer is refused, writing
into ``DEFAULT_SET`` needs ``allow_base=True`` and a layer that records nothing is never created.
"""

from .golden import (
    GOLDENS_DIR,
    call_captured,
    compare,
    find_volatile_paths,
    golden_name,
    list_goldens,
    load_golden,
    load_module,
    normalize,
    reset_backend_state,
    write_golden,
)
from .guard import NetworkBlocked, block_network, no_network, unblock_network
from .serialize import decode, encode
from .session import (
    RecordedUpstreamError,
    ReplayMiss,
    ReplaySession,
    active_session,
    install_replay,
    ordered_as_completed,
    recording,
    replaying,
)
from .store import (
    DEFAULT_SET,
    FIXTURES_ROOT,
    FixtureSetError,
    FixtureStore,
    LayeredStore,
    available_sets,
    check_base_write,
    check_record_spec,
    format_sets,
    open_sets,
    parse_sets,
)

__all__ = [
    "DEFAULT_SET",
    "FIXTURES_ROOT",
    "GOLDENS_DIR",
    "FixtureSetError",
    "FixtureStore",
    "LayeredStore",
    "NetworkBlocked",
    "RecordedUpstreamError",
    "ReplayMiss",
    "ReplaySession",
    "active_session",
    "available_sets",
    "block_network",
    "call_captured",
    "check_base_write",
    "check_record_spec",
    "compare",
    "decode",
    "encode",
    "find_volatile_paths",
    "format_sets",
    "golden_name",
    "install_replay",
    "list_goldens",
    "load_golden",
    "load_module",
    "no_network",
    "normalize",
    "open_sets",
    "ordered_as_completed",
    "parse_sets",
    "recording",
    "replaying",
    "reset_backend_state",
    "unblock_network",
    "write_golden",
]
