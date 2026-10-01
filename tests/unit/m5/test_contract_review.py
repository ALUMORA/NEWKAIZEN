"""Diferencias con la spec que encontró la revisión adversaria de M5, cada una con su prueba."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from kaizen_api import schemas


def test_fx_monitor_spot_is_only_banxico():
    # Spec: spot:{value, asOf, source:'banxico'}. El monitor sale del FIX (SF43718); no hay respaldo
    # de Yahoo en esta función, y un sustituto se marcaría con meta.fallback, no con otra fuente.
    schemas.FxSpot(value=18.3, asOf="2026-09-30", source="banxico")
    with pytest.raises(ValidationError):
        schemas.FxSpot(value=18.3, asOf="2026-09-30", source="yahoo")
