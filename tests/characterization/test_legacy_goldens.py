"""Integridad de los goldens del backend viejo (``tests/goldens_legacy``).

Los goldens se grabaron contra backend.py antes de moverlo al paquete ``kaizen_api``. La reproducción
de cada uno contra el código actual vive en ``test_package_parity.py``; aquí se cuida que el
material de referencia siga completo y coherente: que estén todos, que cada llamada a proveedor que
usan esté grabada y que cada función tenga implementación en el paquete.
"""

from __future__ import annotations

import pytest

from kaizen_api.routers.legacy_v1 import LEGACY_FUNCTIONS
from tests.replay import FixtureStore, golden_name, list_goldens, load_golden

GOLDENS = list_goldens()
MIN_GOLDENS = 122  # 8 símbolos x 14 llamadas + mercado, macro, fibras, magic... (no se borran goldens)
REQUIRED_KEYS = {"function", "args", "kwargs", "module", "fixture_set", "frozen_at", "volatile_paths", "fixtures_used"}


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
def test_golden_is_well_formed(golden_path):
    golden = load_golden(golden_path)
    assert REQUIRED_KEYS <= set(golden), sorted(REQUIRED_KEYS - set(golden))
    assert ("output" in golden) != ("raises" in golden)
    assert golden_path.name == golden_name(golden["function"], golden["args"], golden["kwargs"])
    assert golden["function"] in LEGACY_FUNCTIONS
    assert golden["frozen_at"] == FixtureStore.open(golden["fixture_set"]).frozen_at
    assert golden["fixtures_used"] == sorted(golden["fixtures_used"])
