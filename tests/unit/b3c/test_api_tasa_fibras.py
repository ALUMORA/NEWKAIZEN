"""``FibrasResponse.rate``: la tasa del diferencial con su fecha, fuente, respaldo y plazo (F3c-3).

La tarjeta de la tasa tomaba la fecha del texto "la tasa de referencia, del AAAA-MM-DD" de
``meta.notes`` y la fuente de ``meta.source``, porque ``meta.asOf`` es la fecha de los precios.
``cetes28`` se conserva: el frontend todavía lo lee.
"""

from __future__ import annotations

import pytest

from kaizen_api import schemas
from kaizen_api.domain import rates
from kaizen_api.domain.screeners import fibras as FB
from tests.unit.b3c.test_fibras import fibra
from tests.unit.b3c.test_routes import _clean_cache, _sin_costura_rf  # noqa: F401  (fixtures autouse)


@pytest.fixture
def api():
    from fastapi.testclient import TestClient

    from kaizen_api.main import create_app
    from kaizen_api.settings import Settings

    app = create_app(Settings.from_env({"KAIZEN_ENV": "development", "AUTH_REQUIRED": "false"}))
    return TestClient(app, raise_server_exceptions=False)


def _con_tasa(monkeypatch, fn):
    monkeypatch.setattr(FB, "fetch_symbols", lambda syms, **kw: ({s: fibra(s) for s in syms}, []))
    if fn is not None:
        monkeypatch.setattr(rates, "get_cetes28", fn, raising=False)


def test_cetes_de_banxico_traen_fecha_fuente_y_plazo(api, monkeypatch):
    serie = {"tenorDays": 28, "dates": ["2026-09-10", "2026-09-17"], "values": [0.0712, 0.0705],
             "source": "banxico", "fallback": False}
    _con_tasa(monkeypatch, lambda: serie)
    r = api.get("/v2/screeners/fibras")
    assert r.status_code == 200, r.text
    body = schemas.FibrasResponse.model_validate(r.json())
    assert body.cetes28 == pytest.approx(0.0705)
    assert body.rate is not None
    assert body.rate.model_dump() == {
        "value": pytest.approx(0.0705), "asOf": "2026-09-17", "source": "banxico", "fallback": False, "tenorDays": 28,
    }


def test_el_respaldo_de_fred_dice_su_plazo_real_y_que_es_sustituto(api, monkeypatch):
    serie = {"tenorDays": 91, "dates": ["2026-08-01"], "values": [0.0731], "source": "fred_ir3tib", "fallback": True}
    _con_tasa(monkeypatch, lambda: serie)
    body = schemas.FibrasResponse.model_validate(api.get("/v2/screeners/fibras").json())
    assert body.rate.source == "fred"
    assert body.rate.fallback is True and body.meta.fallback is True
    assert body.rate.tenorDays == 91
    assert body.rate.asOf == "2026-08-01"
    assert body.rate.value == body.cetes28


def test_sin_tasa_rate_va_en_null_igual_que_cetes28(api, monkeypatch):
    _con_tasa(monkeypatch, None)
    body = schemas.FibrasResponse.model_validate(api.get("/v2/screeners/fibras").json())
    assert body.cetes28 is None and body.rate is None


def test_una_tasa_sin_plazo_ni_fuente_no_inventa_ninguno(api, monkeypatch):
    _con_tasa(monkeypatch, lambda: {"rate": 0.0975, "asOf": "2026-09-18"})
    body = schemas.FibrasResponse.model_validate(api.get("/v2/screeners/fibras").json())
    assert body.rate.tenorDays is None and body.rate.source is None
    assert body.rate.fallback is True, "sin fuente declarada no se puede afirmar que sean CETES"


def test_rate_es_opcional_para_un_api_anterior():
    viejo = {"rows": [], "cetes28": 0.07, "meta": {
        "asOf": None, "source": "yahoo", "delayMinutes": None, "stale": False, "fallback": False,
        "generatedAt": "2026-09-22T14:51:31Z", "notes": []}}
    assert schemas.FibrasResponse.model_validate(viejo).rate is None
