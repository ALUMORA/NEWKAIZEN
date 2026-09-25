# Fase 3, stream API: pedidos de F1, F2, F3 y F4 al backend v2

Rama `ws/API`, 25 de septiembre de 2026. Solo backend (más los JSDoc de `src/lib/api/types.js`).
Todo cambio al contrato es aditivo: ningún campo se quitó ni se renombró, cada campo nuevo tiene
valor por omisión y está documentado en `docs/api-v2.md` (prosa y referencia generada). No se
regrabó ningún fixture: todo lo nuevo sale de datos que ya se descargaban (o de archivos del repo),
y el replay falla si una prueba pidiera una llamada sin grabar.

## Veredicto por pedido

| Pedido | Veredicto | Commit |
| --- | --- | --- |
| F2-2 y F2-3: `verified`, `stale` y `tenorDays` por `RateItem` | pass (ya estaba hecho) | `825e005`, `00d7b0f` |
| F2-7a: `marketStatus.<bolsa>.lastClose` | pass | `0d87f10` |
| F3c-2: `FibraRow.notes` y `MagicRow.ebitSource` | pass | `9f0ee43` |
| F3c-3: `FibrasResponse.rate` | pass | `4dd09da` |
| F4: `GET /v2/assumptions` | pass | `08bfdba` |
| F1-3: serie mensual del INPC | pass | `2bcf6d3` |
| F1-4: cierres sin ajustar por dividendos | pass_with_issues | `be4f3f7` |
| JSDoc de todo lo anterior (y F3c-4) | pass | `c924aac` |
| Pedidos marcados en `docs/requests/F1..F4.md` | pass | `43c37f9` |

## Detalle y hallazgos

### F2-2 y F2-3 (ya resueltos antes de este stream)

- [minor] Revalidado contra el código: `kaizen_api/domain/rates.py` (`_item`, `get_mx_rates`) ya
  publicaba `verified`, `stale` y `tenorDays` por renglón y `kaizen_api/schemas.py` (`MxRateItem`)
  los declara opcionales. Pruebas en `tests/unit/b2b/test_pb_rates_por_serie.py`. Lo único que
  faltaba era marcarlo en `docs/requests/F2.md`; hecho en `43c37f9`. Con el catálogo corregido hoy
  (las 12 series en `verified: true`) no hubo nada que cambiar.

### F2-7a: `lastClose`

- `kaizen_api/domain/market_calendar.py:202`: `market_status()` agrega `lastClose` con
  `last_completed_session()`, que ya existía. El cambio se limitó a esa función, sin tocar
  `status()` ni las etiquetas, para que el merge con el agente que pone "Abierta/Cerrada" en
  femenino sea trivial. Único roce: `tests/unit/b2a/test_market_calendar.py:177` exige el juego
  exacto de llaves y ahora incluye `lastClose` (una línea).
- Repro: `tests/unit/b2a/test_api_last_close.py` fija el martes 22 con las dos abiertas (lunes 21),
  viernes después del cierre (el mismo viernes), sábado y lunes antes de abrir (viernes 18), el 16
  de septiembre (BMV 15, NYSE 16) y Acción de Gracias (BMV 26, NYSE 25), más la ruta en replay.

### F3c-2: motivo por renglón

- `kaizen_api/domain/screeners/fibras.py:841`: cada `FibraRow` trae `notes`, una oración por
  motivo, sin el símbolo, que nombra solo las cifras en `null` de ese renglón (estados ajenos,
  deuda que no cuadra, otra moneda, pagos ilegibles o ausentes, sin tasa, sin precio, sin NAV,
  proveedor sin respuesta). Lo que ningún motivo explica cae en "Yahoo no publica el dato con que se
  calcula", así que no queda una s/d sin motivo: la prueba lo exige para cada caso.
- `kaizen_api/domain/screeners/magic.py:547`: `ebitSource` es `operating_income` o `ebit_row`.
- Las `meta.notes` de siempre no cambiaron (la prueba comprueba la nota "FMTY14.MX: LTV, ..." y la
  lista de emisoras con EBIT de respaldo). Repro: `tests/unit/b3c/test_api_notas_por_renglon.py`.

### F3c-3: `rate`

- `kaizen_api/domain/screeners/fibras.py:918` y `kaizen_api/schemas.py` (`FibrasRate`):
  `{ value, asOf, source, fallback, tenorDays }`. `source` es `banxico` o `fred` (o `null` si la
  costura no lo dijo, y entonces `fallback` es `true`); `tenorDays` es el plazo de la serie que de
  verdad se usó (91 con el respaldo de FRED). `cetes28` se conserva. Repro:
  `tests/unit/b3c/test_api_tasa_fibras.py`.

### F4: `GET /v2/assumptions`

- `kaizen_api/routers/valuation.py:109` y `kaizen_api/domain/valuation/params.py:287`. Decisión:
  la ruta vive en el router de B3b (a quien iba dirigido el pedido) para no crear un archivo sin
  dueño en `scripts/ownership.json`. `erp` es por construcción la misma que usa `/v2/valuation` sin
  `?erp=` (`CountryRisk.mature_erp`, hoy 0.0423); `crp` va por país (`MX`, `US`). Sin red, sesión
  obligatoria como el resto de v2, `Cache-Control` de `fundamentals`, capacidad `assumptions`.
- Repro: `tests/contract/test_api_supuestos.py` (contrato, igualdad con la valuación, `stale` a los
  400 días, 401 sin sesión, capacidad en `/health`).
- Roces con archivos de otros: `tests/contract/test_schemas.py` (fila nueva en `SPEC`, archivo
  congelado bajo O: una ruta nueva no pasa sin esa fila), `tests/unit/b1/test_cache_headers.py`
  (clase de caché de las dos rutas nuevas) y `tests/unit/b3b/test_routes.py:264` (lista de
  capacidades del router).

### F1-3: INPC

- Decisión: ruta propia `GET /v2/rates/mx/inpc?start=&end=` (`kaizen_api/routers/rates.py:87`,
  `kaizen_api/domain/rates.py:429`), no campo de `/v2/rates/mx`: son unos 320 meses que solo pide el
  ISR y `/v2/rates/mx` lo lee cada pantalla de tasas. Respuesta `{ seriesId, base, monthly:
  {"AAAA-MM": nivel}, meta }`, `start` por omisión `2000-01-01`, capacidad `rates.inpc`.
- Serie `SP1` del SIE, verificada en vivo con el token del dueño: el título ("IPC Por objeto del
  gasto Nacional Índice General"), periodicidad mensual y unidad pasan el candado, y agosto 2026
  entre agosto 2025 da 3.26 %, lo mismo que `SP30578` (inflación anual) ese mes. Vive en la llave
  `indices` de `kaizen_api/data/banxico_series.json` (`banxico.index_catalog()`,
  `kaizen_api/providers/banxico.py:79`) para que no se cuele como renglón de `/v2/rates/mx`, con el
  mismo candado (`verification` y `reviewed`).
- Los metadatos reales del día quedaron en `tests/unit/b2b/sie_metadatos_inpc_2026-09-25.json`, sin
  token. `git diff --cached | grep -c <token>` dio 0 antes del commit.
- [minor] Sin respaldo: sin `BANXICO_TOKEN` la ruta es `503 NOT_CONFIGURED` (no hay INPC honesto en
  FRED con la misma base). Producción necesita el token configurado para que F1 la use.
- Repro: `tests/unit/b2b/test_api_inpc.py` y `test_los_indices_del_catalogo_pasan_el_candado_en_vivo`
  en `tests/unit/b2b/test_banxico_live.py` (con token: 1 passed).

### F1-4: `adjust=splits` en `/v2/panel`

- `kaizen_api/domain/history.py:195` (`undo_dividend_adjustment`), `get_series(..., adjust=)` y
  `kaizen_api/providers/yahoo/prices.py:189` (`fetch_dividends`). yfinance ya trae la columna
  `Dividends` en la MISMA descarga (misma llave de caché y de replay), así que no hay llamada nueva.
  El ajuste de Yahoo se deshace recorriendo hacia atrás con `C = A / F + D`; la prueba de respuesta
  conocida recupera los cierres crudos con error relativo de 1e-12. `/v2/panel` responde
  `adjustment` y anuncia la capacidad `panel.splits`; `/v2/history` no cambia (`adjusted: true`
  sigue siendo `Literal[True]` en el contrato).
- [minor, abierto] En `1wk` y `1mo` el cierre previo al pago es el de la barra anterior, no el del
  día antes de la fecha ex: es aproximado y `meta.notes` lo dice. Para exactitud el cliente puede
  pedir `1d`.
- [minor, abierto] El método supone que `Close` viene ajustado por dividendos (`auto_adjust=True`,
  lo que el módulo de precios ya documenta). Si Yahoo no trajera `adjclose` para algún símbolo, el
  deshacer inflaría los cierres viejos y no se puede detectar sin el cierre crudo. No lo vi en los
  fixtures.
- Repro: `tests/unit/b2a/test_api_panel_splits.py` (respuesta conocida y AAPL a un año en replay).

## Abierto para otros

- F1, A4 y F4 tienen que consumir lo nuevo (`/v2/rates/mx/inpc`, `adjust=splits`,
  `/v2/assumptions` en lugar de `DEFAULT_ERP`); no toqué `src/features/**`.
- [minor] `docs/api-v2.md:120` todavía dice que `/health` anuncia "hoy `auth` y `legacy.v1`": texto
  viejo, anterior a este stream; no lo cambié.
- No existe entrada `API` en `scripts/ownership.json`; no corrí `check-ownership.mjs`. Los archivos
  nuevos de pruebas viven en las carpetas de sus streams (`b2a`, `b2b`, `b3c`, `contract`).

## Compuertas (números reales de la última corrida)

- `.venv/bin/python -m pytest -q -o addopts=""`: 1501 passed, 6 skipped (antes del stream: 1459
  passed, 5 skipped). Sin red.
- `.venv/bin/python -m ruff check .`: All checks passed.
- `npm run check` (por tocar `src/lib/api/types.js`): 75 archivos, 2009 pruebas de Vitest en verde,
  build y bundle dentro del presupuesto (JS inicial 133.66 kB gzip de 180, 74 %).
- En vivo con token: `KAIZEN_LIVE=1 ... tests/unit/b2b/test_banxico_live.py -k indices`, 1 passed.
