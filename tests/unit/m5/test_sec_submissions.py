"""``sec_edgar.submissions(cik)``: la envoltura pública que pidió la fase 5 para ``/v2/filings``.

Corre sin red sobre la capa de B3a, que ya grabó la lista de expedientes de Apple al leer sus
Formas 4. Lo que importa es que sea la MISMA llamada que ``_submissions`` (misma URL y misma caché),
no una segunda forma de pedirle a la SEC.
"""

from __future__ import annotations

import pytest

from kaizen_api.providers import sec_edgar
from tests.replay import replaying

B3A_SET = "2026-09-22,2026-09-22-b3a"
AAPL_CIK = "0000320193"


@pytest.fixture
def replay_sec():
    import kaizen_api

    kaizen_api.reset_state()
    with replaying(B3A_SET) as session:
        yield session
    assert not session.misses, f"Llamadas sin grabar: {session.misses}"
    kaizen_api.reset_state()


def test_submissions_is_the_same_call_as_the_private_one(replay_sec):
    with replay_sec.trace() as keys:
        data = sec_edgar.submissions(AAPL_CIK)
    assert keys == [f"http:GET https://data.sec.gov/submissions/CIK{AAPL_CIK}.json"]
    assert data is not None and data["cik"].lstrip("0") == "320193"
    assert data["filings"]["recent"]["form"], "la lista reciente trae tipos de documento"
    assert data == sec_edgar._submissions(AAPL_CIK)


@pytest.mark.parametrize("cik", [320193, "320193", " 0000320193 "])
def test_the_cik_goes_out_with_ten_digits(replay_sec, cik):
    with replay_sec.trace() as keys:
        data = sec_edgar.submissions(cik)
    assert keys == [f"http:GET https://data.sec.gov/submissions/CIK{AAPL_CIK}.json"]
    assert data is not None


@pytest.mark.parametrize("cik", ["", "CIK320193", "12345678901", "32-0193"])
def test_a_malformed_cik_is_the_callers_mistake(cik):
    with pytest.raises(ValueError):
        sec_edgar.submissions(cik)


def test_the_sec_not_answering_is_none_not_an_exception(monkeypatch):
    import kaizen_api

    kaizen_api.reset_state()

    class _Down:
        status_code = 503

        def json(self):
            raise ValueError("sin JSON")

    monkeypatch.setattr(sec_edgar._edgar_session, "get", lambda url, *a, **kw: _Down())
    assert sec_edgar.submissions(AAPL_CIK) is None
    kaizen_api.reset_state()
