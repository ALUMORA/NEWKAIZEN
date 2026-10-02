# Pedidos de V5PF (agenda y temporada de reportes, ETF por dentro y rayos X)

## 1. Prueba de B3a que fija las capacidades de `events.py`

- **Necesidad:** `tests/unit/b3a/test_routes.py::test_declared_capabilities_are_known_and_complete` exige que
  `research`, `events` e `insiders` declaren EXACTAMENTE `{instrument, statements.real, dividends, events, insiders}`.
- **Por qué:** `tests/contract/test_schemas.py::test_stub_returns_501_error_body` exige que el router de
  `/v2/events/season` (que M5 puso en `events.py`) anuncie `events.season` en cuanto deja de ser stub, y la spec pide
  `events.dividends` cuando `/v2/events` manda `dividendSummary`. Las dos pruebas no pueden pasar a la vez.
- **Cambio propuesto:** en esa prueba, `assert declared == {...}` pasa a
  `assert declared == {"instrument", "statements.real", "dividends", "events", "insiders", "events.dividends", "events.season"}`.

## 2. Prueba de M5 que exige capas de la fase 5 vacías

- **Necesidad:** `tests/unit/m5/test_fixture_layers.py::test_empty_layer_stacks_on_base_and_keeps_its_clock[v5pf]` exige
  `entries == {}` y que no haya `frozen_at` en `2026-10-01-v5pf/index.json`.
- **Por qué:** la spec pide grabar una vez en esa capa; `record_fixtures.py` escribe las 91 llamadas y el `frozen_at`
  heredado de la base (2026-09-22T14:51:31+00:00), como dice el docstring de la misma prueba. Va a fallar igual para
  cada stream que grabe.
- **Cambio propuesto:** que la prueba acepte una capa con entradas siempre que su `frozen_at`, si existe, sea el de la
  base, y que la pila conserve las llaves de la base (`base_keys <= session.store.keys()`).

## 3. Aviso legal y atribuciones

- **Necesidad:** en `src/features/legal/pages/Notice.jsx`, mencionar que la agenda, la temporada de reportes y la
  composición de ETF salen de Yahoo Finance vía yfinance, que según los términos de Yahoo es para uso personal, y que
  el mapeo de claves del SIC a ETF de EE. UU. (`kaizen_api/data/sic_etf_map.json`) es curado a mano con fuente y fecha.
- **Por qué:** regla común de la fase 5; las respuestas ya lo dicen en `meta.notes`.
- **Cambio propuesto:** un párrafo en la sección de fuentes de datos del aviso.

## 4. Notas para el integrador

- Total Net Assets: Yahoo dio 513,975.7 para SPY y la misma cifra en `Category Average` (copia). Se descarta
  `Category Average` siempre y la cifra del fondo se publica en millones de dólares porque la de SPY cae en la banda
  del AUM conocido (400 mil a 1.2 millones de millones). QQQ salió en 720,847.44, más que SPY: es lo que publica Yahoo;
  la nota de `meta` dice que puede traer rezago.
- La fecha de `lastPaidDate` es la fecha ex dividendo que trae la serie de Yahoo, y la nota lo dice.
- `equity_holdings['Price/Earnings']` es rendimiento de utilidades (P/U = 1/valor); el contrato de `FundResponse` no
  tiene campo de P/U, así que solo queda la función `earnings_yield_to_pe` con su prueba. Si se quiere en pantalla,
  pedir un campo aditivo `priceEarnings: Ratio | None`.
