"""Las ocho capas de la fase 5 se apilan sobre el set base y cargan sin red.

M5 las deja creadas para que cada stream pueda reproducir ``--set 2026-09-22,2026-10-01-<stream>``
desde el primer día. Ninguna trae ``frozen_at``: heredan el reloj del set base, y al grabar la
primera llamada la sesión les escribe ``frozen_at``, ``layered_on`` y ``lookup_order`` con el orden
real de la pila (por ejemplo con la capa ``2026-10-01-banxico`` en medio). Ya grabada, la capa
conserva el reloj de la base y se apila en el orden que anotó.
"""

from __future__ import annotations

import datetime as _dt
import json

import pytest

from tests.replay import DEFAULT_SET, FIXTURES_ROOT, FixtureStore, replaying

PHASE5_LAYERS = ("v5ts", "v5fx", "v5ec", "v5fi", "v5tc", "v5mk", "v5pf", "v5em")
BASE_CLOCK = "2026-09-22T14:51:31+00:00"


@pytest.mark.parametrize("stream", PHASE5_LAYERS)
def test_layer_stacks_on_base_and_keeps_its_clock(stream):
    layer = f"2026-10-01-{stream}"
    index = json.loads((FIXTURES_ROOT / layer / "index.json").read_text(encoding="utf-8"))
    assert index["set"] == layer
    if index["entries"]:
        assert index.get("frozen_at") == BASE_CLOCK, "una capa grabada conserva el reloj de la base"
        stack = [*index.get("layered_on", [DEFAULT_SET]), layer]
    else:
        assert "frozen_at" not in index, "la capa vacía hereda el reloj de la base; uno propio rompe check_clock"
        stack = [DEFAULT_SET, layer]
    assert stack[0] == DEFAULT_SET

    base_keys = FixtureStore.open(DEFAULT_SET).keys()
    with replaying(",".join(stack)) as session:
        assert session.store.names == stack
        assert session.store.frozen_at == BASE_CLOCK
        assert base_keys <= session.store.keys()
        assert _dt.datetime.now(_dt.UTC).isoformat(timespec="seconds") == BASE_CLOCK
