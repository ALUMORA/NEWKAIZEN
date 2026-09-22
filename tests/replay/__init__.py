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
from .store import DEFAULT_SET, FIXTURES_ROOT, FixtureStore

__all__ = [
    "DEFAULT_SET",
    "FIXTURES_ROOT",
    "GOLDENS_DIR",
    "FixtureStore",
    "NetworkBlocked",
    "RecordedUpstreamError",
    "ReplayMiss",
    "ReplaySession",
    "active_session",
    "block_network",
    "call_captured",
    "compare",
    "decode",
    "encode",
    "find_volatile_paths",
    "golden_name",
    "install_replay",
    "list_goldens",
    "load_golden",
    "load_module",
    "no_network",
    "normalize",
    "ordered_as_completed",
    "recording",
    "replaying",
    "reset_backend_state",
    "unblock_network",
    "write_golden",
]
