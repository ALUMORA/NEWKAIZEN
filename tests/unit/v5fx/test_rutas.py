"""Las cinco rutas de V5FX servidas desde las capas grabadas (reloj del replay: 2026-09-22)."""

from __future__ import annotations

import datetime as _dt

import pytest

from kaizen_api import schemas
from kaizen_api.domain import dof_rule, fx, fxdesk
from kaizen_api.errors import ApiError
from kaizen_api.providers import cftc, frankfurter
from kaizen_api.routers import fxdesk as router

D = _dt.date.fromisoformat


def test_el_router_anuncia_sus_cuatro_capacidades():
    assert set(router.CAPABILITIES) == {"fxdesk", "fxdesk.crosses", "fxdesk.fix", "fxdesk.forward"}
    assert set(router.CAPABILITIES) <= set(schemas.KNOWN_CAPABILITIES)


@pytest.mark.parametrize("years", [1, 10])
def test_monitor_desde_el_replay(replay_client, years):
    r = replay_client.get(f"/v2/fxdesk/monitor?years={years}")
    assert r.status_code == 200, r.text
    body = schemas.FxMonitorResponse.model_validate(r.json())
    assert body.spot.source == "banxico" and body.meta.fallback is False
    assert body.series.dates[-1] == body.spot.asOf
    assert body.range52w.low <= body.spot.value <= body.range52w.high
    assert 0 < body.range52w.percentile <= 1
    assert body.cot is not None and body.cot.nonCommercialNet == 75167
    assert sum(b.count for b in body.histogram) == len(body.series.values) - 1
    first = D(body.series.dates[0])
    assert (D(body.spot.asOf) - first).days <= years * 366


def test_cruces_desde_el_replay(replay_client):
    body = schemas.FxCrossesResponse.model_validate(replay_client.get("/v2/fxdesk/crosses").json())
    pairs = [r.pair for r in body.rows]
    assert pairs == ["EURMXN", "JPYMXN", "GBPMXN", "CNYMXN", "CADMXN", "BRLMXN", "COPMXN", "CLPMXN", "ARSMXN", "PENMXN"]
    for row in body.rows:
        assert row.value and row.value > 0
        if row.pair in ("BRLMXN", "COPMXN", "CLPMXN", "ARSMXN", "PENMXN"):
            assert (row.source, row.provider, row.fallback) == ("frankfurter", "mezcla", False)
        else:
            assert (row.source, row.provider) == ("banxico", "banxico")
    assert any("bancos centrales" in n for n in body.meta.notes)


def test_fix_por_fecha_y_por_dof_desde_el_replay(replay_client):
    por_fecha = schemas.FixLookupResponse.model_validate(
        replay_client.get("/v2/fxdesk/fix?date=2026-09-20&rule=fecha").json()
    )
    assert por_fecha.fixDate == "2026-09-18" and "no fue día hábil" in por_fecha.explanation
    por_dof = schemas.FixLookupResponse.model_validate(
        replay_client.get("/v2/fxdesk/fix?date=2026-09-22&rule=dof").json()
    )
    assert (por_dof.dofPublicationDate, por_dof.fixDate) == ("2026-09-21", "2026-09-18")
    assert "art. 20" in por_dof.explanation


def test_fecha_futura_no_es_error(replay_client):
    for rule in ("fecha", "dof"):
        body = replay_client.get(f"/v2/fxdesk/fix?date=2026-09-30&rule={rule}").json()
        assert body["fixDate"] is None and body["value"] is None
        assert "todavía no llega" in body["explanation"]


def test_tabla_con_cierres_de_mes(replay_client):
    url = "/v2/fxdesk/fix-table?start=2025-09-22&end=2026-09-22&rule=dof"
    todo = schemas.FixTableResponse.model_validate(replay_client.get(url).json())
    cierres = schemas.FixTableResponse.model_validate(replay_client.get(url + "&monthEnd=true").json())
    assert len(todo.rows) == 366
    assert [r.date for r in cierres.rows] == [
        f"{m.month}-{r.date[8:]}" for m, r in zip(cierres.monthEnds, cierres.rows, strict=True)
    ]
    assert all((D(r.date) + _dt.timedelta(days=1)).day == 1 for r in cierres.rows)
    assert todo.monthEnds == cierres.monthEnds
    agosto = next(m for m in cierres.monthEnds if m.month == "2026-08")
    assert agosto.fixDate == "2026-08-27"  # 31/08 lunes: DOF del viernes 28, FIX del jueves 27
    assert agosto.average and 16 < agosto.average < 19


@pytest.mark.parametrize("mxn", ["tiie", "cetes", "fondeo"])
@pytest.mark.parametrize("usd", ["ust", "sofr"])
def test_forward_desde_el_replay(replay_client, mxn, usd):
    r = replay_client.get(f"/v2/fxdesk/forward?mxn={mxn}&usd={usd}")
    assert r.status_code == 200, r.text
    body = schemas.FxForwardResponse.model_validate(r.json())
    assert [row.days for row in body.rows] == [30, 91, 182, 365]
    for row in body.rows:
        assert row.forward and row.forward > body.spot.value  # tasas en pesos mayores que en dólares
        assert row.iMxnConvention == ("overnight plano" if mxn == "fondeo" else "act/360 simple")
        assert row.iUsdConvention == ("overnight plano" if usd == "sofr" else "cmt convertida x360/365")
    assert body.meta.notes[0].startswith("Precio teórico sin margen bancario")
    assert body.meta.source == "banxico,fred"


def test_forward_por_fecha(replay_client):
    body = replay_client.get("/v2/fxdesk/forward?date=2026-12-21").json()
    assert [r["days"] for r in body["rows"]] == [90]
    assert body["rows"][0]["date"] == "2026-12-21"


def test_sin_fix_de_banxico_el_monitor_no_usa_yahoo(monkeypatch, client):
    yahoo = fx.FxSeries(dates=["2026-09-22"], values=[17.3], source=fx.YAHOO_SOURCE, fallback=True)
    monkeypatch.setattr(fx, "daily_range", lambda *a, **k: yahoo)
    for url in (
        "/v2/fxdesk/monitor",
        "/v2/fxdesk/fix?date=2026-09-01",
        "/v2/fxdesk/fix-table?start=2026-09-01&end=2026-09-10",
    ):
        r = client.get(url)
        assert r.status_code == 503, url
        assert r.json()["error"]["code"] == "UPSTREAM_UNAVAILABLE"


def test_el_forward_si_acepta_el_respaldo_marcado(monkeypatch):
    from kaizen_api.domain import forward

    yahoo = fx.FxSeries(dates=["2026-09-22"], values=[17.3], source=fx.YAHOO_SOURCE, fallback=True, notes=["respaldo"])
    monkeypatch.setattr(fxdesk, "fix_history", lambda today, start=None: yahoo)
    monkeypatch.setattr(forward, "_banxico_last", lambda sid, today: ("2026-09-22", 0.07))
    monkeypatch.setattr(forward, "_fred_last", lambda sid, today: ("2026-09-22", 0.04))
    body = forward.build_forward([30], "tiie", "ust", D("2026-09-22"))
    assert body["meta"]["fallback"] is True and "yahoo" in body["meta"]["source"]
    assert "respaldo" in body["meta"]["notes"]


def test_cftc_caido_deja_cot_en_null(monkeypatch):
    monkeypatch.setattr(cftc, "legacy_rows", lambda today: [])
    monkeypatch.setattr(cftc, "tff_rows", lambda today: [])
    series = fx.FxSeries(
        dates=[f"2026-09-{d:02d}" for d in range(1, 23)],
        values=[17.0 + d / 100 for d in range(1, 23)],
        source=fx.BANXICO_FIX_SOURCE,
        fallback=False,
    )
    monkeypatch.setattr(fxdesk, "fix_history", lambda today, start=None: series)
    body = fxdesk.build_monitor(1, D("2026-09-22"))
    assert body["cot"] is None and body["meta"]["source"] == "banxico"
    assert any("CFTC s/d" in n for n in body["meta"]["notes"])
    schemas.FxMonitorResponse.model_validate(body)


def test_cftc_normaliza_texto_y_fecha_flotante():
    rows = cftc.normalize(
        [
            {
                "report_date_as_yyyy_mm_dd": "2026-09-15T00:00:00.000",
                "open_interest_all": " 1,234 ",
                "noncomm_positions_long_all": "",
            }
        ],
        cftc.LEGACY_FIELDS,
    )
    assert rows == [
        {
            "reportDate": "2026-09-15",
            "open_interest_all": 1234.0,
            "noncomm_positions_long_all": None,
            "noncomm_positions_short_all": None,
        }
    ]


def test_frankfurter_v1_descarta_fin_de_semana():
    points = frankfurter.parse_v1({"rates": {"2026-09-26": {"CAD": 0.08}, "2026-09-28": {"CAD": 0.0797, "EUR": "x"}}})
    assert points == {"CAD": [("2026-09-28", 0.0797)]}


def test_dia_desconocido_despues_del_ultimo_fix():
    fixes = {"2026-09-21": 17.2, "2026-09-22": 17.3}
    res = dof_rule.resolve(fixes, D("2026-09-24"), "fecha", D("2026-09-25"))
    assert res.fix_date is None and "Aún no hay FIX" in res.explanation
    sabado = dof_rule.resolve(fixes, D("2026-09-26"), "fecha", D("2026-09-28"))
    assert sabado.fix_date is None  # el jueves 24 y el viernes 25 son desconocidos


def test_explicaciones_sin_guiones_largos():
    for date in ("2026-10-05", "2026-10-07", "2026-09-30", "2026-10-03", "2026-10-20"):
        for rule in ("fecha", "dof"):
            text = dof_rule.resolve(
                {
                    "2026-10-01": 18.3,
                    "2026-10-02": 18.31,
                    "2026-10-05": 18.33,
                    "2026-10-06": 18.35,
                    "2026-09-28": 18.25,
                    "2026-09-29": 18.27,
                    "2026-09-30": 18.29,
                },
                D(date),
                rule,
                D("2026-10-08"),
            ).explanation
            assert "—" not in text and "–" not in text


def test_no_fix_es_503():
    err = fxdesk.no_fix()
    assert isinstance(err, ApiError) and err.status == 503
