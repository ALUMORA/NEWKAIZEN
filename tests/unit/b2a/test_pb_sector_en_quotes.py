"""``/v2/quotes`` trae el sector de cada emisora (pedido 1 de F1, lo implementa PB).

La concentración por sector de /portafolio/riesgo necesita el sector de todas las posiciones en una
sola llamada. Sale del mismo ``info`` de Yahoo que ya se pide para el precio: ni una llamada más.
"""

from __future__ import annotations

import pytest

from kaizen_api import schemas
from kaizen_api.routers import quotes as quotes_router


def test_quotes_trae_el_sector_en_espanol_y_la_industria(client) -> None:
    body = client.get("/v2/quotes?symbols=AAPL,WALMEX.MX,GFNORTEO.MX,FUNO11.MX").json()
    por_simbolo = {q["symbol"]: q for q in body["quotes"]}
    assert por_simbolo["AAPL"]["sector"] == "Tecnología"
    assert por_simbolo["AAPL"]["industry"] == "Consumer Electronics"
    assert por_simbolo["WALMEX.MX"]["sector"] == "Consumo básico"
    assert por_simbolo["GFNORTEO.MX"]["sector"] == "Servicios financieros"
    assert por_simbolo["FUNO11.MX"]["sector"] == "Bienes raíces"
    schemas.QuotesResponse.model_validate(body)


@pytest.mark.parametrize("symbol", ["%5EMXX", "NAFTRAC.MX"])
def test_sin_sector_de_yahoo_sale_null_y_no_se_inventa(client, symbol: str) -> None:
    """Un índice o un fondo no tienen sector en Yahoo: el campo va en null, nunca adivinado."""
    quote = client.get(f"/v2/quotes?symbols={symbol}").json()["quotes"][0]
    assert quote["sector"] is None
    assert quote["industry"] is None


def test_el_sector_sale_del_mismo_info_sin_otra_llamada(client, monkeypatch) -> None:
    llamadas: list[list[str]] = []

    def infos(symbols):
        llamadas.append(list(symbols))
        return {
            s: {
                "regularMarketPrice": 10.0,
                "regularMarketPreviousClose": 9.5,
                "currency": "USD",
                "quoteType": "EQUITY",
                "sector": "Financial Services",
                "industry": "  Banks - Regional ",
            }
            for s in symbols
        }

    def prohibido(*_args, **_kwargs):
        raise AssertionError("el sector no justifica otra llamada a Yahoo")

    monkeypatch.setattr(quotes_router.prices, "fetch_infos", infos)
    monkeypatch.setattr(quotes_router.prices, "fetch_info", prohibido)
    body = client.get("/v2/quotes?symbols=JPM,BAC").json()
    assert llamadas == [["JPM", "BAC"]]
    assert [q["sector"] for q in body["quotes"]] == ["Servicios financieros"] * 2
    assert [q["industry"] for q in body["quotes"]] == ["Banks - Regional"] * 2


def test_un_sector_vacio_o_desconocido_no_se_pierde_ni_se_inventa(client, monkeypatch) -> None:
    base = {"regularMarketPrice": 5.0, "currency": "MXN", "quoteType": "EQUITY"}
    monkeypatch.setattr(
        quotes_router.prices,
        "fetch_infos",
        lambda symbols: {
            "VACIO.MX": {**base, "sector": "", "industry": "   "},
            "RARO.MX": {**base, "sector": "Conglomerates"},
        },
    )
    body = client.get("/v2/quotes?symbols=VACIO.MX,RARO.MX").json()
    vacio, raro = body["quotes"]
    assert vacio["sector"] is None and vacio["industry"] is None
    assert raro["sector"] == "Conglomerates", "lo que no tiene traducción se muestra tal cual llegó"
    assert raro["industry"] is None


def test_sector_e_industry_son_opcionales_en_el_contrato() -> None:
    """Agregar un campo al contrato congelado solo se vale si es opcional: una respuesta vieja sigue valiendo."""
    for campo in ("sector", "industry"):
        assert not schemas.Quote.model_fields[campo].is_required()
    vieja = {
        "symbol": "AAPL", "name": "Apple", "price": 1.0, "previousClose": None, "change": None,
        "changePct": None, "currency": "USD", "exchange": None, "type": "equity", "marketState": None,
        "asOf": None,
    }
    quote = schemas.Quote.model_validate(vieja)
    assert quote.sector is None and quote.industry is None
