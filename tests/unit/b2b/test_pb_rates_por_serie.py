"""``/v2/rates/mx`` por serie: ``verified``, ``stale`` y ``tenorDays`` (pedidos 2 y 3 de F2, los implementa PB).

Antes, una serie vieja solo se podía avisar con el ``meta.stale`` de toda la respuesta y el plazo de
los CETES se adivinaba del id o de la etiqueta. Ahora cada renglón dice si es del SIE confirmado, si
su último dato ya tiene más días de lo que se tolera para su periodicidad y, en los CETES, su plazo.
"""

from __future__ import annotations

import datetime as _dt
import re
from pathlib import Path

import pytest
import responses
from fastapi.testclient import TestClient

from kaizen_api.domain import rates as rates_domain
from kaizen_api.providers import banxico
from kaizen_api.routers import rates as rates_router
from kaizen_api.schemas import MxRateItem, MxRatesResponse, RfSeriesResponse

from .conftest import build_app
from .test_rates import SIE_DATOS_RE, SIE_METADATOS_RE, _datos, _metadatos

FRED_RE = re.compile(r"https://fred\.stlouisfed\.org/graph/fredgraph\.csv.*")


def _con_token(monkeypatch, hoy: _dt.date) -> MxRatesResponse:
    """``/v2/rates/mx`` con token, CETES 28 revisada, el SIE simulado y el reloj en ``hoy``."""
    monkeypatch.setitem(banxico.catalog()["SF43936"], "verified", True)
    monkeypatch.setattr(rates_domain, "_today", lambda: hoy)
    with responses.RequestsMock(assert_all_requests_are_fired=False) as mock:
        mock.add(responses.GET, SIE_DATOS_RE, json=_datos(), status=200)
        mock.add(responses.GET, SIE_METADATOS_RE, json=_metadatos(), status=200)
        with TestClient(build_app(BANXICO_TOKEN="token-de-prueba"), raise_server_exceptions=False) as http:
            r = http.get("/v2/rates/mx")
    assert r.status_code == 200, r.text
    return MxRatesResponse.model_validate(r.json())


# ─── verified ────────────────────────────────────────────────────────────────


def test_sin_token_el_respaldo_de_fred_no_va_como_verificado(client):
    body = MxRatesResponse.model_validate(client.get("/v2/rates/mx").json())
    (bono,) = body.items
    assert bono.id == "bonoM10" and bono.source == "fred"
    assert bono.verified is False, "la serie de la OCDE en FRED nunca pasó por el candado del SIE"
    assert bono.tenorDays is None


def test_con_token_lo_que_confirma_el_sie_va_como_verificado(clean_state, monkeypatch):
    body = _con_token(monkeypatch, _dt.date(2026, 9, 22))
    por_id = {item.id: item for item in body.items}
    assert set(por_id) == {"target", "cetes28", "fix"}
    assert all(item.verified for item in body.items), "solo se publica lo que pasó la revisión humana y el SIE"


# ─── stale por serie ─────────────────────────────────────────────────────────


def test_con_token_cada_serie_dice_si_ya_es_vieja(clean_state, monkeypatch):
    """Siete días después del último dato: la tasa objetivo y el FIX (5 días) ya son viejos, CETES 28 (14) no."""
    body = _con_token(monkeypatch, _dt.date(2026, 9, 25))
    por_id = {item.id: item for item in body.items}
    assert por_id["target"].stale is True
    assert por_id["fix"].stale is True
    assert por_id["cetes28"].stale is False
    assert body.meta.stale is True


def test_con_token_y_datos_al_dia_ninguna_serie_es_vieja(clean_state, monkeypatch):
    body = _con_token(monkeypatch, _dt.date(2026, 9, 22))
    assert [item.stale for item in body.items] == [False, False, False]
    assert body.meta.stale is False


def test_sin_token_la_frescura_del_respaldo_usa_su_propia_tolerancia(client):
    """El Bono M de FRED es mensual: el dato del 1 de agosto aguanta 70 días, así que el 22 de septiembre no es viejo."""
    body = MxRatesResponse.model_validate(client.get("/v2/rates/mx").json())
    assert body.items[0].asOf == "2026-08-01"
    assert body.items[0].stale is False
    assert body.meta.stale is any(item.stale for item in body.items)


def test_el_meta_stale_es_exactamente_que_alguna_serie_sea_vieja(clean_state, monkeypatch):
    for hoy in (_dt.date(2026, 9, 22), _dt.date(2026, 9, 25), _dt.date(2026, 10, 30)):
        body = _con_token(monkeypatch, hoy)
        assert body.meta.stale is any(item.stale for item in body.items), hoy


# ─── tenorDays ───────────────────────────────────────────────────────────────


def test_con_token_cetes_28_trae_su_plazo_y_lo_demas_no(clean_state, monkeypatch):
    body = _con_token(monkeypatch, _dt.date(2026, 9, 22))
    por_id = {item.id: item for item in body.items}
    assert por_id["cetes28"].tenorDays == 28
    assert por_id["target"].tenorDays is None
    assert por_id["fix"].tenorDays is None


@pytest.mark.parametrize(
    "rate_id,plazo",
    [("cetes28", 28), ("cetes91", 91), ("cetes182", 182), ("cetes364", 364),
     ("tiie28", None), ("tiieFondeo", None), ("bonoM10", None), ("target", None), ("fix", None), ("udi", None)],
)
def test_solo_los_cetes_traen_tenor_days(rate_id, plazo):
    item = rates_domain._item(rate_id, "x", "fraction", "SF0", "banxico", ["2026-09-18"], [7.0], 0.01, verified=True)
    assert item["tenorDays"] == plazo


def test_los_plazos_de_los_cetes_son_los_mismos_que_acepta_rates_rf():
    plazos = {rates_domain._item(i, "x", "fraction", "SF0", "banxico", ["2026-09-18"], [7.0], 0.01, verified=True)["tenorDays"]
              for i in rates_domain.CETES_SERIES.values()}
    assert plazos == set(RfSeriesResponse.model_fields["tenorDays"].annotation.__args__)


# ─── contrato ────────────────────────────────────────────────────────────────


def test_el_dominio_llena_los_tres_campos_y_no_deja_nada_al_valor_por_omision(client, monkeypatch):
    """Los campos son opcionales en el contrato; el servidor no debe depender de su valor por omisión."""
    vistos: list[dict] = []
    original = rates_router.get_mx_rates

    def espia():
        data = original()
        vistos.extend(data["items"])
        return data

    monkeypatch.setattr(rates_router, "get_mx_rates", espia)
    assert client.get("/v2/rates/mx").status_code == 200
    assert vistos
    for item in vistos:
        assert {"verified", "stale", "tenorDays"} <= set(item), item


def test_los_campos_nuevos_son_opcionales_y_una_respuesta_vieja_sigue_valiendo():
    for campo in ("verified", "stale", "tenorDays"):
        assert not MxRateItem.model_fields[campo].is_required()
    vieja = {"id": "cetes28", "label": "CETES 28 días", "value": 0.0745, "unit": "fraction", "asOf": "2026-09-18",
             "seriesId": "SF43936", "source": "banxico", "previous": None, "changeBp": None}
    item = MxRateItem.model_validate(vieja)
    assert item.verified is False, "sin el dato, una serie no se da por verificada"
    assert item.tenorDays is None


def test_verified_promete_solo_lo_que_dura_la_verificacion_del_sie(monkeypatch):
    """Revisión de PB: la confirmación del SIE se guarda 24 horas. Una serie confirmada ayer a las
    10:00 sigue como confirmada hasta hoy a las 10:00, así que "el SIE la confirmó hoy" no es cierto."""
    capturado: dict = {}

    def cache(key, fn, ttl, **kwargs):
        capturado["ttl"] = ttl
        return {}

    monkeypatch.setattr(banxico, "_cached", cache)
    banxico.verification(["SF43936"])
    assert capturado["ttl"] == 24 * 3600
    raiz = Path(__file__).resolve().parents[3]
    textos = {
        "schemas.py": MxRateItem.model_fields["verified"].description,
        "docs/api-v2.md": (raiz / "docs" / "api-v2.md").read_text(encoding="utf-8"),
        "src/lib/api/types.js": (raiz / "src" / "lib" / "api" / "types.js").read_text(encoding="utf-8"),
    }
    for nombre, texto in textos.items():
        plano = " ".join(re.sub(r"\n\s*\*\s", " ", texto).split())
        assert "la confirmó hoy" not in plano, nombre
        assert "la confirmó en las últimas 24 horas" in plano, nombre
