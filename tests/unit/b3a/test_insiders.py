"""Operaciones de consejeros: códigos reales de la Forma 4, plan 10b5-1 y resumen honesto."""

from __future__ import annotations

import pandas as pd

from kaizen_api.domain.screeners import insiders as mod

FORM4 = """<?xml version="1.0"?>
<ownershipDocument>
  <periodOfReport>2026-09-15</periodOfReport>
  <issuer><issuerTradingSymbol>AAPL</issuerTradingSymbol></issuer>
  <reportingOwner>
    <reportingOwnerId><rptOwnerName>PEREZ ANA</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship>
      <isDirector>0</isDirector><isOfficer>1</isOfficer>
      <officerTitle>Directora de Finanzas</officerTitle>
      <isTenPercentOwner>0</isTenPercentOwner>
    </reportingOwnerRelationship>
  </reportingOwner>
  <nonDerivativeTable>
    <nonDerivativeTransaction>
      <transactionDate><value>2026-09-15</value></transactionDate>
      <transactionCoding><transactionCode>P</transactionCode><aff10b5One>0</aff10b5One></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>1000</value></transactionShares>
        <transactionPricePerShare><value>310.50</value></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
    </nonDerivativeTransaction>
    <nonDerivativeTransaction>
      <transactionDate><value>2026-09-14</value></transactionDate>
      <transactionCoding><transactionCode>S</transactionCode><aff10b5One>1</aff10b5One></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>200</value></transactionShares>
        <transactionPricePerShare><value>300.00</value></transactionPricePerShare>
      </transactionAmounts>
    </nonDerivativeTransaction>
    <nonDerivativeTransaction>
      <transactionDate><value>2026-09-13</value></transactionDate>
      <transactionCoding><transactionCode>A</transactionCode></transactionCoding>
      <transactionAmounts><transactionShares><value>5000</value></transactionShares></transactionAmounts>
    </nonDerivativeTransaction>
    <nonDerivativeTransaction>
      <transactionDate><value>2026-09-12</value></transactionDate>
      <transactionCoding><transactionCode>F</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>1200</value></transactionShares>
        <transactionPricePerShare><value>305.00</value></transactionPricePerShare>
      </transactionAmounts>
    </nonDerivativeTransaction>
  </nonDerivativeTable>
  <derivativeTable>
    <derivativeTransaction>
      <transactionDate><value>2026-09-11</value></transactionDate>
      <transactionCoding><transactionCode>M</transactionCode></transactionCoding>
      <transactionAmounts><transactionShares><value>3000</value></transactionShares></transactionAmounts>
    </derivativeTransaction>
  </derivativeTable>
</ownershipDocument>
"""

FORM4_OLD_WITH_FOOTNOTE = """<?xml version="1.0"?>
<ownershipDocument>
  <reportingOwner>
    <reportingOwnerId><rptOwnerName>SOTO LUIS</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship><isDirector>1</isDirector></reportingOwnerRelationship>
  </reportingOwner>
  <nonDerivativeTable>
    <nonDerivativeTransaction>
      <transactionDate><value>2022-05-10</value></transactionDate>
      <transactionCoding><transactionCode>S</transactionCode><footnoteId id="F1"/></transactionCoding>
      <transactionAmounts><transactionShares><value>400</value></transactionShares></transactionAmounts>
    </nonDerivativeTransaction>
    <nonDerivativeTransaction>
      <transactionDate><value>2022-05-09</value></transactionDate>
      <transactionCoding><transactionCode>S</transactionCode></transactionCoding>
      <transactionAmounts><transactionShares><value>100</value></transactionShares></transactionAmounts>
    </nonDerivativeTransaction>
  </nonDerivativeTable>
  <footnotes>
    <footnote id="F1">Venta hecha conforme a un plan de negociación 10b5-1 adoptado el 1 de marzo.</footnote>
  </footnotes>
</ownershipDocument>
"""


def test_form4_codes_become_the_right_kinds():
    rows = mod.parse_form4(FORM4)
    kinds = [row["type"] for row in rows]
    assert kinds == ["compra", "venta", "otorgamiento", "otro", "ejercicio"]
    assert rows[0]["value"] == 1000 * 310.50
    assert rows[2]["value"] is None, "un otorgamiento sin precio no tiene valor de mercado"
    assert rows[0]["insider"] == "PEREZ ANA"
    assert rows[0]["role"] == "Directivo: Directora de Finanzas"


def test_the_10b5_1_checkbox_is_read_per_transaction():
    rows = mod.parse_form4(FORM4)
    assert rows[0]["planned10b5_1"] is False
    assert rows[1]["planned10b5_1"] is True
    assert rows[2]["planned10b5_1"] is None, "sin casilla es 'no sabemos', no 'no'"


def test_a_footnote_mentioning_the_plan_counts_when_there_is_no_checkbox():
    rows = mod.parse_form4(FORM4_OLD_WITH_FOOTNOTE)
    assert rows[0]["planned10b5_1"] is True
    assert rows[1]["planned10b5_1"] is None
    assert rows[0]["role"] == "Consejero"


def test_broken_xml_gives_nothing_instead_of_exploding():
    assert mod.parse_form4("<ownershipDocument><sin cerrar") == []


def test_yahoo_text_never_defaults_to_a_purchase():
    """El defecto del legado: un renglón sin texto contaba como BUY."""
    assert mod._yahoo_type("") == "otro"
    assert mod._yahoo_type("nan") == "otro"
    assert mod._yahoo_type("Sale at price 330.19 per share.") == "venta"
    assert mod._yahoo_type("Purchase at price 12.00 per share.") == "compra"
    assert mod._yahoo_type("Stock Award(Grant)") == "otorgamiento"
    assert mod._yahoo_type("Conversion of Exercise of derivative security") == "ejercicio"
    assert mod._yahoo_type("Stock Gift") == "otro"
    assert mod._yahoo_type("Disposition to the issuer") == "otro"


def test_yahoo_rows_are_classified_and_never_counted_as_open_market_by_default(monkeypatch):
    frame = pd.DataFrame({
        "Shares": [100, 200, 300],
        "Text": ["", "Sale at price 10.00 per share.", "Stock Award(Grant)"],
        "Insider": ["A", "B", "C"],
        "Position": ["Officer", "Officer", "Director"],
        "Start Date": pd.to_datetime(["2026-09-01", "2026-08-01", "2026-07-01"]),
        "Value": [None, 2000.0, None],
    })
    monkeypatch.setattr(mod, "cik_for", lambda symbol: None)
    monkeypatch.setattr(mod._yahoo, "get_insider_transactions", lambda symbol: frame)
    data = mod.get_insiders_v2("XYZ")
    assert [row["type"] for row in data["items"]] == ["otro", "venta", "otorgamiento"]
    assert data["summary"] == {"openMarketBuys": 0, "openMarketSells": 1}
    assert all(row["planned10b5_1"] is None for row in data["items"])
    assert data["sources"] == ["yahoo"]
    assert any("plan" in note for note in data["notes"])


def test_the_summary_ignores_compensation(monkeypatch):
    monkeypatch.setattr(mod, "cik_for", lambda symbol: "0000000001")
    monkeypatch.setattr(mod, "get_form4_documents", lambda symbol, limit=20: [{"xml": FORM4}])
    data = mod.get_insiders_v2("AAPL")
    assert data["summary"] == {"openMarketBuys": 1, "openMarketSells": 1}
    assert len(data["items"]) == 5, "el otorgamiento y el ejercicio se muestran, pero no cuentan"
    assert data["sources"] == ["sec"]
    assert data["as_of"] == "2026-09-15"


def test_real_apple_form4s_replay_with_codes_and_plans(replay_b3a):
    data = mod.get_insiders_v2("AAPL")
    assert data["sources"] == ["sec"]
    assert data["items"], "la SEC sí tiene Formas 4 de Apple"
    assert all(row["type"] in ("compra", "venta", "otorgamiento", "ejercicio", "otro") for row in data["items"])
    assert any(row["planned10b5_1"] is True for row in data["items"])
    assert data["summary"]["openMarketSells"] >= 1
    assert any("Forma 4" in note for note in data["notes"])
    dates = [row["date"] for row in data["items"] if row["date"]]
    assert dates == sorted(dates, reverse=True)


def test_bmv_issuers_have_no_form4_and_the_answer_says_why(replay_b3a):
    data = mod.get_insiders_v2("WALMEX.MX")
    assert data["items"] == []
    assert data["summary"] == {"openMarketBuys": 0, "openMarketSells": 0}
    assert data["sources"] == ["yahoo"]
    assert data["notes"] == [
        "La Forma 4 solo existe en EE. UU., así que no hay operaciones de consejeros para "
        "emisoras de la BMV."
    ]


def test_the_rendered_form4_url_is_turned_into_the_raw_xml():
    from kaizen_api.providers.sec_edgar import raw_document_name

    assert raw_document_name("xslF345X06/form4.xml") == "form4.xml"
    assert raw_document_name("xslF345X05/wk-form4_177.xml") == "wk-form4_177.xml"
    assert raw_document_name("form4.xml") == "form4.xml"
