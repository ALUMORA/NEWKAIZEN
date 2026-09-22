"""Las rutas v2 de B2a nunca pasan por los caminos que inventaban dato en el backend viejo.

Son tres defectos concretos del legado, y aquí quedan cerrados con candado en vez de con una nota:

* ``domain.fx.get_fx()`` devuelve ``{"USDMXN": 17.5, "fallback": True}`` cuando Yahoo falla. Esa
  función sigue existiendo porque las rutas v1 la usan y los 122 goldens la prueban, pero ninguna
  ruta v2 la puede tocar.
* ``domain.macro._stooq_dxy()`` pide un CSV a Stooq que falla siempre desde aquí.
* ``/health`` solo anuncia capacidades que de verdad responden.
"""

from __future__ import annotations

import pytest

from kaizen_api.domain import fx as fx_domain
from kaizen_api.domain import macro as macro_domain
from kaizen_api.providers.yahoo import session as yahoo_session

RUTAS_V2 = [
    "/v2/quotes?symbols=AAPL,WALMEX.MX",
    "/v2/fx?pair=USDMXN",
    "/v2/fx/history?start=2026-09-14&end=2026-09-22",
    "/v2/history/AAPL?range=1y&interval=1d&ccy=MXN",
    "/v2/history/WALMEX.MX?range=1y&interval=1d&ccy=USD",
    "/v2/panel?symbols=WALMEX.MX,AAPL&range=1y&interval=1d&ccy=MXN",
    "/v2/markets/overview",
    "/v2/markets/world",
    "/v2/search?q=walmart",
]


@pytest.fixture
def sin_referencia_fija(monkeypatch):
    """Hace explotar el 17.5 del legado: si alguna ruta v2 lo usara, la prueba lo diría."""

    def _prohibido():
        raise AssertionError("una ruta v2 llamó a get_fx(), que devuelve la referencia fija de 17.5")

    monkeypatch.setattr(fx_domain, "get_fx", _prohibido)


@pytest.fixture
def sin_stooq(monkeypatch):
    """Hace explotar cualquier petición a Stooq, la fuente del DXY que siempre falla."""
    original = yahoo_session._session.get

    def _get(url, *args, **kwargs):
        if "stooq" in str(url):
            raise AssertionError(f"una ruta v2 pidió {url} a Stooq")
        return original(url, *args, **kwargs)

    monkeypatch.setattr(yahoo_session._session, "get", _get)


@pytest.mark.parametrize("ruta", RUTAS_V2)
def test_ninguna_ruta_v2_usa_la_referencia_fija_ni_stooq(client, sin_referencia_fija, sin_stooq, ruta: str) -> None:
    r = client.get(ruta)
    assert r.status_code == 200, r.text


def test_el_legado_si_conserva_su_referencia_fija(monkeypatch) -> None:
    """Paridad v1: el defecto se corrige en v2, no en v1, porque los goldens lo fijaron."""

    def _falla(symbol):
        raise RuntimeError("Yahoo caído")

    monkeypatch.setattr(fx_domain, "yft", _falla)
    assert fx_domain.get_fx() == {"USDMXN": 17.5, "fallback": True}


def test_el_dxy_del_legado_sigue_saliendo_de_stooq() -> None:
    """La función del legado existe; lo que se prueba arriba es que v2 no la llama."""
    assert "stooq" in macro_domain._stooq_dxy.__doc__.lower()


def test_health_anuncia_exactamente_lo_que_b2a_ya_entrega(client) -> None:
    capacidades = set(client.get("/health").json()["capabilities"])
    assert {"quotes", "fx", "history", "panel", "fx.history", "markets.overview", "markets.world", "search"} <= capacidades
    # Todavía no hay FIX de Banxico ni rango por fechas en el histórico: no se anuncian.
    assert "fx.fix" not in capacidades
    assert "history.dates" not in capacidades


def test_toda_respuesta_de_b2a_trae_meta_completa(client) -> None:
    for ruta in RUTAS_V2:
        meta = client.get(ruta).json()["meta"]
        assert set(meta) == {"asOf", "source", "delayMinutes", "stale", "fallback", "generatedAt", "notes"}, ruta
        assert isinstance(meta["stale"], bool) and isinstance(meta["fallback"], bool), ruta
        assert meta["generatedAt"].endswith("Z"), ruta
        for nota in meta["notes"]:
            assert "—" not in nota and "–" not in nota, (ruta, nota)
