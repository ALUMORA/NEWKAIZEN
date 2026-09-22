"""Shared pytest fixtures.

Every test runs with the network blocked (sockets, DNS and libcurl) unless it is marked
``@pytest.mark.live``; live tests are skipped unless ``KAIZEN_LIVE=1``.
"""

from __future__ import annotations

import datetime as _dt
import os
from collections.abc import Iterator

import pytest

from tests.replay import DEFAULT_SET, FixtureStore, ReplaySession, block_network, replaying, unblock_network
from tests.replay import guard as _guard


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    if os.environ.get("KAIZEN_LIVE") == "1":
        return
    skip_live = pytest.mark.skip(reason="necesita red: corre con KAIZEN_LIVE=1")
    for item in items:
        if item.get_closest_marker("live"):
            item.add_marker(skip_live)


@pytest.fixture(autouse=True)
def _offline_by_default(request: pytest.FixtureRequest) -> Iterator[None]:
    if request.node.get_closest_marker("live"):
        yield
        return
    before = len(_guard.violations)
    block_network()
    try:
        yield
    finally:
        unblock_network()
    new = _guard.violations[before:]
    assert not new, f"La prueba intentó salir a la red: {new}"


@pytest.fixture(scope="session")
def replay_set() -> str:
    """Name of the recorded fixture set (``tests/fixtures/recorded/<set>``)."""
    return os.environ.get("KAIZEN_REPLAY_SET", DEFAULT_SET)


@pytest.fixture
def frozen_time(replay_set: str) -> Iterator[_dt.datetime]:
    """Freeze the clock at the instant the set was recorded (``index.json`` → ``frozen_at``)."""
    import time_machine

    raw = FixtureStore.open(replay_set).frozen_at
    if not raw:
        pytest.skip(f"el set {replay_set} no tiene frozen_at")
    instant = _dt.datetime.fromisoformat(raw)
    with time_machine.travel(instant, tick=False):
        yield instant


@pytest.fixture
def no_network() -> Iterator[list[str]]:
    """Explicit network guard (already on by default); yields the list of violations."""
    block_network()
    try:
        yield _guard.violations
    finally:
        unblock_network()


@pytest.fixture
def replay(replay_set: str) -> Iterator[ReplaySession]:
    """Active replay session: fixtures only, network blocked, time frozen, sleeps skipped."""
    with replaying(replay_set) as session:
        yield session
    assert not session.misses, f"Llamadas sin grabar: {session.misses}"
