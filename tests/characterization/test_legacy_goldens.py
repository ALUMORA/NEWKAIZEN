"""Characterization of the OLD backend.py: replayed offline it must reproduce every golden.

Each golden in ``tests/goldens_legacy/`` names a function, its arguments and the fixture set it
was recorded against. The call runs with the network blocked, the clock frozen at the set's
``frozen_at`` and the legacy caches cleared. Values under ``volatile_paths`` must exist with the
same JSON type but may differ; numbers compare with a relative tolerance of 1e-9.
"""

from __future__ import annotations

import pytest

from tests.replay import (
    FixtureStore,
    call_captured,
    compare,
    list_goldens,
    load_golden,
    load_module,
    replaying,
    reset_backend_state,
)

GOLDENS = list_goldens()
MIN_GOLDENS = 100  # 8 símbolos x 13 llamadas + mercado, macro, fibras, magic...


@pytest.fixture(scope="module")
def legacy():
    return load_module("backend")


def test_goldens_present():
    assert len(GOLDENS) >= MIN_GOLDENS, f"solo hay {len(GOLDENS)} goldens; corre scripts/record_fixtures.py"


def test_every_golden_fixture_is_recorded():
    missing = []
    for path in GOLDENS:
        golden = load_golden(path)
        store = FixtureStore.open(golden["fixture_set"])
        missing += [f"{path.name}: {k}" for k in golden["fixtures_used"] if store.meta(k) is None]
    assert not missing, missing[:10]


@pytest.mark.parametrize("golden_path", GOLDENS, ids=[p.stem for p in GOLDENS])
def test_legacy_golden(golden_path, legacy):
    golden = load_golden(golden_path)
    fn = getattr(legacy, golden["function"])
    with replaying(golden["fixture_set"]) as rp:
        reset_backend_state(legacy)
        result = call_captured(fn, golden["args"], golden["kwargs"])
    assert rp.misses == [], f"llamadas sin grabar: {rp.misses}"
    if "raises" in golden:
        assert result.get("raises") == golden["raises"], result
        return
    assert "output" in result, f"lanzó {result.get('raises')}"
    diffs = compare(result["output"], golden["output"], volatile=golden["volatile_paths"])
    assert not diffs, "\n".join(diffs)
