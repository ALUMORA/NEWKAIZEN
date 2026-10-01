# Reglas de trabajo en paralelo

Este repo se está rehaciendo por streams que trabajan al mismo tiempo, cada uno en su propio
worktree (`05 NEWKAIZEN.wt/<stream>`, rama `ws/<stream>`). Para que los merges salgan limpios:

1. **Cada stream toca solo sus archivos.** Los globs están en `scripts/ownership.json`.
   Antes de terminar corre `node scripts/check-ownership.mjs <stream>`; si falla, no se mergea.
2. **Solo el orquestador (O) toca dependencias**: `package.json`, `package-lock.json`,
   `requirements*.txt`. Si te falta una dependencia, pídela en `docs/requests/<stream>.md`.
   La carpeta `docs/requests/` ya existe versionada, así que ese archivo se crea sin más.
3. **Primitivas congeladas.** Después del checkpoint C1, `src/components/ui/index.js` y
   `src/components/charts/index.js` no cambian de firma. Si una feature necesita algo nuevo,
   lo pide en `docs/requests/<stream>.md` con `{necesidad, por qué, API propuesta}` y mientras
   usa un componente local dentro de su carpeta.
4. **Contrato congelado.** Después de M1, `kaizen_api/schemas.py` y `docs/api-v2.md` solo
   cambian vía request al orquestador. Sus pruebas (`tests/contract/`) también son de O, y no hace
   falta tocarlas para implementar una ruta: se ajustan solas (ver más abajo).
5. **git** se corre siempre como `DEVELOPER_DIR=/Library/Developer/CommandLineTools git ...`
   (la licencia de Xcode no está aceptada en esta Mac).
6. **Puertos por stream** para no pisarse: web `5200+i`, API `8100+i` (i = índice del stream).
7. **Nada de BUY/SELL/COMPRAR/VENDER** como recomendación, y todo texto visible en español de
   México, natural, sin guiones largos (— ni –).
8. **Colores solo por token** (`var(--...)`), definidos en los dos temas. Nada de hex sueltos.
9. **Verificar en la página renderizada**, no leyendo código: errores de consola o requests
   ≥400 son defectos bloqueantes.

## Mapa de streams

| Stream | Qué hace |
| --- | --- |
| O | Orquestador: git, dependencias, merges, gates |
| Q0 | Configuración de Vitest, Playwright, ESLint y CI |
| R0 | Grabación y replay de proveedores (yfinance/HTTP) y goldens del backend viejo |
| S1 | Backend como paquete `kaizen_api/` con FastAPI, mismo comportamiento |
| S2 | Esqueleto del frontend: router, cliente API, sesión, formato, storage |
| M1 | Merge de fase 1 y los arreglos previos a fase 2: fixtures en capas, partición de routers, propiedad |
| A1 a A4 | Librería financiera `src/lib/finance/` con pruebas de respuesta conocida |
| A5 | Glosario y `docs/metodologia/` |
| B1 | Backend: seguridad y plataforma (auth, límites, CORS, códigos, `Cache-Control`, `/health`) |
| B2a | Precios, quotes, historia con fechas, panel alineado, FX, búsqueda, overview y calendario BMV/NYSE |
| B2b | Banxico, FRED, tasas MX, rf CETES 28, macro de EE. UU., noticias y tono |
| B3a | Fundamentales de la emisora, estados financieros, dividendos, eventos, insiders y beta |
| B3b | Valuación (múltiplos, DCF FCFF, P/VL justificado para bancos) y momentum 12-1 |
| B3c | Screener de factores, fórmula mágica y FIBRAs |
| C1 | Tokens y primitivas de UI |
| C2 | Gráficas |
| C3 | Shell, navegación y ⌘K |
| F1 a F5 | Features: portafolio, mercados, investigar, herramientas, aprender/watchlist/onboarding/auth/legal |

## Cómo se revisa la propiedad

```bash
node scripts/check-ownership.mjs <stream>              # un stream contra su diff (rama ws/<stream>)
node scripts/check-ownership.mjs --coverage A1,A2,A3,A4,A5,B1,B2a,B2b,B3a,B3b,B3c,C1,C2,C3
node scripts/check-ownership.mjs --coverage <lista> --table   # además, el dueño de cada archivo de kaizen_api/
```

El modo `--coverage` responde las dos preguntas que importan antes de arrancar streams en paralelo:

1. **Cobertura.** Todo archivo versionado bajo `kaizen_api/` tiene que tener dueño; si alguno se
   queda sin dueño, falla. El resto del repo (`src/`, `tests/`, `docs/`, `e2e/`, `scripts/`, la
   raíz) sale como información, árbol por árbol, distinguiendo lo que **no tiene dueño en ningún
   stream** de lo que sí lo tiene pero fuera de la lista pedida. Hoy no queda ni un archivo
   versionado sin dueño en `ownership.json`: lo de `src/` y `e2e/` es de Q0 y S2, y `docs/overhaul/`,
   `tests/contract/`, `tests/characterization/`, `tests/replay/`, los goldens y el set base de
   fixtures quedaron declarados en **O** en M1, porque son justo los árboles que dos streams
   editarían el mismo día.
2. **Traslapes.** Ningún archivo versionado, ninguna ruta declarada en `ownership.json` y ningún par
   de globs puede pertenecer a dos streams de la lista a la vez, porque eso es un conflicto de merge
   seguro. Para quitar un archivo de un glob amplio se usa una entrada con `!` al principio, que
   excluye aunque otro glob del mismo stream lo incluya. Así se resolvieron los dos traslapes que
   había, los dos en C1: `src/features/dev-ui/ChartsGallery.jsx` es de C2 y
   `public/manifest.webmanifest` es de F5, así que C1 los excluye con `"!..."`. El segundo solo
   aparece si pides los streams de fase 3 en la lista, y por eso conviene correrla completa:
   `--coverage A1,A2,A3,A4,A5,B1,B2a,B2b,B3a,B3b,B3c,C1,C2,C3,F1,F2,F3,F4,F5` (sale en 0 hoy).

## Cada ruta, su archivo y su dueño

Partido en M1: desde aquí **cada archivo de `kaizen_api/routers/` tiene rutas de un solo stream**,
así que ningún stream de fase 2 necesita abrir el archivo de otro ni tocar `kaizen_api/main.py`.
Los cuatro archivos nuevos (`macro.py`, `events.py`, `insiders.py` y `valuation.py`) salieron de
`rates.py`, `markets.py`, `screeners.py` y `research.py` moviendo el código tal cual: misma ruta,
mismos parámetros y validaciones, mismo `response_model`, mismo `Cache-Control` y la misma etiqueta
de OpenAPI. El OpenAPI resultante es idéntico byte por byte al de antes de partir, y el orden de
registro de las 25 operaciones tampoco cambió.

| Ruta | Archivo | Stream |
| --- | --- | --- |
| `GET /health` | `routers/health.py` | B1 |
| `POST /auth/login`, `GET /auth/me` | `routers/auth.py` | B1 |
| `GET /v2/quotes`, `GET /v2/fx` | `routers/quotes.py` | B2a |
| `GET /v2/history/{symbol}`, `GET /v2/panel`, `GET /v2/fx/history` | `routers/history.py` | B2a |
| `GET /v2/markets/overview`, `GET /v2/markets/world` | `routers/markets.py` | B2a |
| `GET /v2/search` | `routers/search.py` | B2a |
| `GET /v2/rates/mx`, `GET /v2/rates/rf` | `routers/rates.py` | B2b |
| `GET /v2/macro/us` | `routers/macro.py` | B2b |
| `GET /v2/news` | `routers/news.py` | B2b |
| `GET /v2/instrument/{symbol}` y sus `/statements` y `/dividends` | `routers/research.py` | B3a |
| `GET /v2/events` | `routers/events.py` | B3a (en la fase 5 pasa a V5PF) |
| `GET /v2/insiders/{symbol}` | `routers/insiders.py` | B3a |
| `GET /v2/valuation/{symbol}`, `GET /v2/momentum/{symbol}` | `routers/valuation.py` | B3b |
| `GET /v2/screeners/factors`, `/magic`, `/fibras` | `routers/screeners.py` | B3c |
| Las rutas v1 del backend viejo | `routers/legacy_v1.py` | O, congelado |

**Fase 5.** M5 registró el 1 de octubre de 2026 las 26 rutas nuevas de
`docs/overhaul/specs/fase5-spec.md` en ocho routers nuevos y en `events.py`, todas en `@stub`, con
su `response_model`, su clase de caché y sus parámetros ya validados, y las sumó a `V2_ROUTERS` en
`kaizen_api/main.py`. Cada stream solo edita su router: borra `@stub` y el
`raise not_implemented(...)` de la ruta que implementa y agrega la capacidad a `CAPABILITIES`.

| Ruta | Archivo | Stream |
| --- | --- | --- |
| `GET /v2/curves`, `GET /v2/curves/spreads`, `GET /v2/money-market`, `GET /v2/expectations` | `routers/curves.py` | V5TS |
| `GET /v2/fxdesk/monitor`, `/crosses`, `/fix`, `/fix-table`, `/forward` | `routers/fxdesk.py` | V5FX |
| `GET /v2/calendar/economic`, `GET /v2/macro/indicators`, `GET /v2/macro/world` | `routers/economy.py` | V5EC |
| `GET /v2/earnings/{symbol}`, `GET /v2/holders/{symbol}`, `GET /v2/shares/{symbol}`, `GET /v2/filings/{symbol}` | `routers/company.py` | V5FI |
| `GET /v2/ohlc/{symbol}` | `routers/ohlc.py` | V5TC |
| `GET /v2/movers`, `GET /v2/breadth`, `GET /v2/sectors` | `routers/movers.py` | V5MK |
| `GET /v2/events` (aditivos `estimateLow`, `estimateHigh` y `dividendSummary`), `GET /v2/events/season` | `routers/events.py` | V5PF |
| `GET /v2/funds/{symbol}` | `routers/funds.py` | V5PF |
| `GET /v2/reference/mx`, `GET /v2/reference/mx/update-factor`, `GET /v2/business/industries`, `GET /v2/credit-health/{symbol}` | `routers/business.py` | V5EM |

`kaizen_api/main.py` es de **B1**, y ahí vive `V2_ROUTERS`. Ya están registrados los doce routers
v2, así que un stream de fase 2 solo edita su propio archivo. Si de verdad hace falta un router
nuevo, se pide en `docs/requests/<stream>.md` y lo registra B1; no se edita `main.py` desde otro
stream.

## Archivos congelados de `kaizen_api/`

Estos son de O porque son costuras que leen varios streams, o paridad v1 que no se toca. Cambiarlos
se pide en `docs/requests/<stream>.md`:

| Archivo | Por qué |
| --- | --- |
| `schemas.py` | El contrato v2. S1 lo congeló y va junto con `docs/api-v2.md` (regla 4) |
| `routers/__init__.py` | Helpers que usan los doce routers: `Symbols`, `SymbolPath`, `IsoDateQuery`, `parse_symbols`, `check_date_range` y el decorador `@stub`. La caché HTTP y las respuestas de error ya no viven aquí: ver `http_cache.py` y `http_responses.py` abajo |
| `routers/legacy_v1.py` | Rutas v1 con paridad probada contra los 122 goldens. Los defectos del backend viejo se corrigen en v2, no aquí |
| `domain/__init__.py` | Helpers compartidos `_log`, `pct`, `r2`, `safe` |
| `providers/yahoo/session.py` | La sesión y `yft` que usan B2a, B2b, B3a, B3b y B3c |
| `providers/replay.py` | El gancho que usan el replay y `scripts/run_replay_backend.py` |
| `__init__.py` de `kaizen_api`, `providers`, `providers/yahoo` y `domain/screeners` | Paquetes vacíos |
| `data/.gitkeep` | Solo mantiene la carpeta |

**Lo que NO quedó congelado, a propósito:** dos archivos de **B1**, que salieron de
`routers/__init__.py` en M1 porque la tabla de arriba le encarga a B1 "códigos, `Cache-Control` y
límites de tasa" y eso no se puede entregar desde un archivo congelado de otro:

| Archivo | Qué tiene | Para qué lo necesita B1 |
| --- | --- | --- |
| `kaizen_api/http_cache.py` | `CACHE_SECONDS` (segundos por clase de dato), `cache_control()`, `no_store()` | Afinar tiempos o agregar una clase de dato |
| `kaizen_api/http_responses.py` | `ERROR_RESPONSES`: los códigos que cada ruta de datos anuncia en OpenAPI (400, 401, 422, 500, 501, 503) | Anunciar el **429 `RATE_LIMITED`** que documenta `docs/api-v2.md` cuando ponga el limitador de tasa, sin editar los doce routers |

Los routers los siguen importando como siempre (`from kaizen_api.routers import cache_control,
ERROR_RESPONSES`, que los reexporta), así que nadie tiene que actualizar imports. El OpenAPI no
cambió ni un byte con la mudanza. Ojo, B1: agregar o quitar una entrada de `ERROR_RESPONSES` **sí**
cambia el OpenAPI de las 22 rutas de datos, que es justamente el punto. La forma del cuerpo de error
sigue congelada en `schemas.ErrorBody` (regla 4): aquí se decide qué códigos se anuncian, no cómo se
ven.

## Costuras entre streams (quién lee a quién)

Una costura es una lectura entre streams: **el que la ofrece mantiene la firma estable durante toda
la fase 2, y el que la usa solo importa, nunca edita el archivo del otro**. Si una firma tiene que
cambiar, se pide en `docs/requests/<stream>.md` del dueño antes de tocarla.

| Usa | Del stream | Qué lee | Para qué |
| --- | --- | --- | --- |
| B3a `domain/fundamentals.py` | B2a | `domain/history.py::_fetch_hist` | Beta contra el benchmark local, en la misma moneda |
| B2b `domain/macro.py` | B2a | `domain/markets.py::_bulk_download`, `get_market` | VIX y DXY salen del mismo bajado en lote |
| B3c `domain/screeners/fibras.py` | B3a | `domain/fundamentals.py::_div_yield_pct` | Rendimiento por dividendo de cada FIBRA |
| B3c `domain/screeners/fibras.py` | B2a | `domain/history.py::_fetch_hist` | Precios de las FIBRAs |
| B3b `domain/screeners/momentum.py` | B3c | `domain/universe.py::SECTOR_ETF` | Referencia por sector del 12-1 |
| B3b `domain/valuation/**` | B3a | `domain/fundamentals.py` | FCFF, deuda, acciones y el sector para los múltiplos |
| B3b `domain/valuation/**` | B2b | `domain/rates.py`, rf CETES 28 | Tasa libre de riesgo del CAPM y del DCF |
| B3c `domain/screeners/factors.py` | B3a | `domain/fundamentals.py` | Factores relativos al sector |
| B3c `domain/screeners/fibras.py` | B2b | `domain/rates.py`, rf CETES 28 | Diferencial de la FIBRA contra CETES |
| B2a `domain/markets.py` | B2a | `domain/market_calendar.py` | `marketStatus` de BMV y NYSE (mismo stream) |
| Todos | B1 | `cache.py`, `http_cache.py`, `errors.py`, `provenance.py`, `settings.py` | Caché single flight, `Cache-Control` por clase de dato, errores del contrato, procedencia y configuración |
| Todos | O | `schemas.py`, `routers/__init__.py`, `domain/__init__.py`, `providers/yahoo/session.py` | Contrato y helpers congelados |

Las primeras cinco ya existen en el código de hoy (son imports reales que S1 trajo al paquete); las
demás las estrena fase 2 y están aquí para que nadie las descubra a mitad del merge.

## Fixtures en capas, una capa por stream

`tests/replay` sirve las llamadas a proveedores desde `tests/fixtures/recorded/<set>/`, y cada set
tiene su propio `index.json`. Si los cinco streams de backend grabaran en el mismo set, ese
`index.json` sería un conflicto de merge en cada corrida. Por eso **cada entrada acepta varios sets
separados por coma, en orden de búsqueda**:

- Al **reproducir**, la llamada se busca capa por capa y **gana la primera que la tenga**; solo es
  un fallo cuando no está en ninguna. Ojo con la dirección: en `2026-09-22,2026-09-22-b2a` la
  primera capa es la **base**, así que si una llamada está en las dos, **manda la base**, no la
  capa del stream. Es a propósito: el set base es el dato común y revisado, y así ningún stream
  cambia por su cuenta lo que los demás ven. Tu capa sirve para **agregar** llamadas que la base no
  tiene. Lo único que manda es el orden de la lista, y se puede invertir a propósito: ver
  "Corregir una llamada que la base ya tiene" más abajo.
- Al **grabar**, lo que ya existe en una capa que contesta **antes** se sirve de ahí **sin tocarla**
  (es de solo lectura, ni con `--refresh` se reescribe: escribirla arriba no cambiaría nada al
  reproducir) y lo nuevo se escribe en **una sola capa**, la última salvo que `--grabar-en` nombre
  otra. Esa capa se crea con su propio `index.json` y **hereda el `frozen_at` de la base**, para que
  las llamadas que dependen de "hoy" den la misma llave grabando y reproduciendo.
- Un solo set se comporta exactamente igual que antes. Los espacios y las entradas vacías se
  ignoran, y un nombre desconocido o repetido da un error claro en español.
- **Tres guardas para que nadie escriba en el set base por accidente:**
  1. Un `--set` con coma que se quedó en **una sola capa** no graba. Es el caso de
     `--set "2026-09-22,$CAPA"` con `$CAPA` sin definir: como se graba en la última capa, eso
     escribiría en el set común. Sale con error en español en vez de hacerlo. Leer (replay) sigue
     tolerante, porque leer no escribe nada.
  2. Grabar con el **set base como capa de destino** pide `--permitir-base` (o `allow_base=True`),
     vaya al final o al principio del orden. Lo normal es grabar en tu capa; tocar la base es una
     decisión del orquestador.
  3. Una capa que **no grabó ninguna llamada no se crea**. Hoy las rutas de fase 2 responden 501,
     así que la primera corrida de cada stream no graba nada y no deja una carpeta con un
     `index.json` vacío para commitear. En cuanto graba algo, la capa aparece con su índice
     completo. Si pones en el spec una capa que todavía no existe, el error te lo dice.

Acepta capas: `replaying()`, `recording()`, `install_replay()`, la variable `KAIZEN_REPLAY_SET`,
`scripts/run_replay_backend.py --set` y `scripts/record_fixtures.py --set`.

### Corregir una llamada que la base ya tiene

`--set` mezclaba dos decisiones: el **orden de búsqueda** y a qué capa se **graba**. `--grabar-en`
(o `record_layer=` en la API) las separa, así que un stream puede poner su capa primero y grabar ahí
mismo, sin pedirle nada a nadie y sin tocar el set base:

```bash
python scripts/record_fixtures.py --set 2026-09-22-b3a,2026-09-22 --grabar-en 2026-09-22-b3a \
    --get '/v2/insiders/WALMEX.MX'
KAIZEN_REPLAY_SET=2026-09-22-b3a,2026-09-22 .venv/bin/python -m pytest -q
```

Al grabar así, una llamada que la base tiene **con valor bueno** se sigue sirviendo de la base (no
se vuelve a pedir sin `--refresh`, que para eso está); una que la base tiene **vacía o con error**
sí sale al proveedor y se graba en tu capa, que a partir de ahí gana. La capa nombrada tiene que
estar en `--set`, y si es el set base sigue pidiendo `--permitir-base`.

**Esto importa porque el set base trae 35 llamadas así**: 34 vacías (`soft_failure`) y 1 excepción,
de 432. Las que le van a estorbar a alguien de fase 2:

| Llaves | A quién le pegan |
| --- | --- |
| `yf:WALMEX.MX:insider_transactions`, `yf:CEMEXCPO.MX:insider_transactions`, `yf:FUNO11.MX:insider_transactions`, `yf:SPY:insider_transactions`, `yf:^MXX:insider_transactions` | B3a, `/v2/insiders` |
| `yf:STORAGE18.MX:balance_sheet`, `cashflow`, `income_stmt` | B3a (estados) y B3c (FIBRAs) |
| `yf:SPY:balance_sheet`, `cashflow`, `financials`, `income_stmt`, `yf:^MXX:balance_sheet`, `cashflow`, `financials`, `income_stmt` | B3a: son índices/ETF, no tienen estados. Probablemente esté bien que sigan vacías |
| `yf:CEMEXCPO.MX:institutional_holders`, `yf:SPY:institutional_holders`, `yf:^MXX:institutional_holders` | B3a |
| `http:GET https://data.sec.gov/api/xbrl/companyfacts/CIK0000884394.json` | B3a, EDGAR |
| `yf:USDMXN=X:news` | B2b |
| Las 11 de `ZZZNOTREAL` (y `yf:ZZZNOTREAL:fast_info.last_price`, la única excepción) | Nadie: el símbolo inexistente a propósito, tiene que seguir fallando |

Sácala tú mismo cuando la necesites:

```bash
.venv/bin/python -c "import json;d=json.load(open('tests/fixtures/recorded/2026-09-22/index.json'))['entries'];\
print('\n'.join(k for k,v in sorted(d.items()) if v.get('kind')!='value' or v.get('soft_failure')))"
```

**Receta por stream.** Cada stream de backend graba en su propia capa, encima del set base
`2026-09-22`, y commitea solo su carpeta (ya está en su glob de `ownership.json`):

| Stream | Su capa | Cómo graba |
| --- | --- | --- |
| B2a | `2026-09-22-b2a` | `python scripts/record_fixtures.py --set 2026-09-22,2026-09-22-b2a --get '/v2/quotes?symbols=AAPL'` |
| B2b | `2026-09-22-b2b` | `python scripts/record_fixtures.py --set 2026-09-22,2026-09-22-b2b --get '/v2/rates/mx'` |
| B3a | `2026-09-22-b3a` | `python scripts/record_fixtures.py --set 2026-09-22,2026-09-22-b3a --get '/v2/instrument/WALMEX.MX'` |
| B3b | `2026-09-22-b3b` | `python scripts/record_fixtures.py --set 2026-09-22,2026-09-22-b3b --get '/v2/valuation/AAPL'` |
| B3c | `2026-09-22-b3c` | `python scripts/record_fixtures.py --set 2026-09-22,2026-09-22-b3c --get '/v2/screeners/magic'` |

`--get` se puede repetir, pide la ruta con `TestClient` y luego vuelve a correrla en replay para
comprobar que se reproduce completa desde las capas. Mientras tu ruta responda 501 no hay nada que
grabar y la corrida te lo dice (`no grabó ninguna llamada, la capa no se creó`): eso está bien, no
es un fallo. Al terminar revisa que ningún token del entorno
(`BANXICO_TOKEN`, `FRED_API_KEY`, `EODHD_API_TOKEN`, `SECRET_KEY`) haya quedado escrito en la capa;
si aparece, sale con error y esos archivos no se commitean.

Para correr las pruebas o el servidor contra su capa:

```bash
KAIZEN_REPLAY_SET=2026-09-22,2026-09-22-b2a .venv/bin/python -m pytest -q
.venv/bin/python scripts/run_replay_backend.py --module kaizen_api.main --port 8102 --set 2026-09-22,2026-09-22-b2a
```

Los goldens del legado (`tests/goldens_legacy/`) se quedan fijos en el set base: con varias capas,
`record_fixtures.py` sin `--get` pide `--goldens-dir` para no regenerarlos por accidente.

## Fase 5: lo que el replay cubre y lo que está vetado

M5 extendió `tests/replay` para lo que la fase 5 le pide a Yahoo, y lo probó dos veces: sin red con
objetos falsos (`tests/replay/test_fase5_coverage.py`) y con una grabación real mínima en una raíz
temporal que no se commiteó (14 llamadas reales a Yahoo grabadas y reproducidas sin red idénticas).

**Cubierto, con su llave:**

- `yf.Ticker(...)`: `calendar`, `earnings_history`, `earnings_estimate`, `revenue_estimate`,
  `eps_trend`, `eps_revisions`, `get_earnings_dates(limit=...)`, `major_holders`,
  `institutional_holders`, `mutualfund_holders`, `get_shares_full(start=...)`, `splits` e
  `history(...)` con `interval` 5m, 1h, 1d, 1wk y 1mo (`yf:<SÍMBOLO>:<atributo>[?args]`).
- `Ticker.funds_data` (y `get_funds_data()`): es un objeto perezoso, no un dato, así que cada
  propiedad se graba por separado como `yf:SPY:funds_data.top_holdings`, igual con
  `sector_weightings`, `asset_classes`, `fund_overview`, `fund_operations`, `equity_holdings`,
  `bond_holdings`, `bond_ratings`, `description` y el método `quote_type()`. Un símbolo que no es
  fondo lanza su excepción al grabar y la misma al reproducir.
- `yf.screen(...)`: con un predefinido por nombre (`yf.screen:day_gainers?count=25`) o con un
  `EquityQuery` (`yf.screen:EquityQuery{...}?size=50&sortField=...`, con el `to_dict()` de la
  consulta como JSON ordenado). Hay que llamarlo como `yf.screen(...)`: un
  `from yfinance import screen` se queda con el original antes de que el replay se instale y sale a
  la red.

**Vetado en la fase 5, porque no pasa por el replay:** `yf.Sector`, `yf.Industry`, `yf.Calendars`
y `YfData().get_raw_json`. Usan la sesión curl_cffi de yfinance por dentro, sin pasar por
`Ticker`, `download` ni `screen`, así que una prueba que los toque sale a la red (y el guardia de
red la tumba). Además traen columnas de calificaciones y precios objetivo que la regla del producto
prohíbe.

**Proveedores nuevos de HTTP** (Tesoro, Frankfurter, CFTC, BLS, Banco Mundial, SEC): siempre con
`requests` (una `requests.Session` propia con su User-Agent, o `requests.get`), que el replay
intercepta en `requests.Session.request`. Nunca `urllib`, `http.client`, `httpx` ni `curl_cffi`
directo: no se graban, en replay revientan contra el guardia de red y en Render saldrían sin caché
de pruebas.

**Lo que enseñó la grabación real** (yfinance 1.7.0, 1 de octubre de 2026):

- `history(..., auto_adjust=False)` trae `Adj Close` entre `Close` y `Volume`: no leas columnas
  por posición.
- `get_earnings_dates(limit=4)` devolvió 25 renglones: recorta tú.
- `Ticker("WALMEX.MX").history(period="5d", interval="5m")` dio 371 velas con zona
  `America/Mexico_City`.
- `yf.screen` con `EquityQuery` de `region` mx devuelve claves de toda la BMV y del SIC: el filtro
  contra `universe_mx.json`, `fibras_mx.json` y `symbols_mx.json` lo hace el proveedor de V5MK.

**Capas de la fase 5.** Cada stream graba una sola vez en `2026-10-01-<stream en minúsculas>`,
encima del set base y de la capa de Banxico de M5:
`--set 2026-09-22,2026-10-01-banxico,2026-10-01-<stream> --grabar-en 2026-10-01-<stream>` (si la
capa de Banxico todavía no existe en tu worktree, quítala del `--set`). Las grabaciones a Yahoo van
por el cupo `yahoo` del semáforo.

## Las pruebas que fase 2 va a cruzarse

Cuatro archivos de pruebas afirmaban cosas que dejan de ser ciertas en cuanto un stream implementa
su primera ruta, y ninguno es de los streams de fase 2. En M1 se hicieron **auto ajustables**, así
que nadie tiene que abrir un archivo ajeno el día que implementa algo:

- `tests/contract/test_schemas.py` ya no da por hecho que las 22 rutas responden 501. Lo decide por
  **dato, no por el texto del código**: cada función que todavía es stub lleva `@stub` debajo del
  decorador de su router (el decorador vive en el congelado `routers/__init__.py` y devuelve la
  misma función, así que no cambia nada del OpenAPI). Mientras esté esa marca, la prueba le exige el
  cuerpo de error 501 del contrato; en cuanto la borras, le exige lo que sí aplica: que **tu router
  anuncie LA capacidad de esa ruta** en `CAPABILITIES`, no cualquiera. Son las dos líneas que se
  tocan al implementar, y están juntas:

  ```python
  @router.get("/fx", response_model=FxResponse, dependencies=[cache_control("quotes")], summary="...")
  @stub                                   # ← se borra al implementar
  def fx(pair: FxPairQuery = "USDMXN") -> FxResponse:
      raise not_implemented("GET /v2/fx")  # ← y este también
  ```

  Si dejas el `@stub` puesto y ya anunciaste la capacidad, la prueba te lo dice por nombre en vez de
  llamar a la ruta; si lo quitas y olvidas la capacidad, te dice cuál falta y en qué módulo. Nunca
  llama a una ruta ya implementada, porque estas pruebas corren sin red. La capacidad que espera
  cada ruta está en la quinta columna de `SPEC`, y una prueba nueva comprueba que esa columna y
  `schemas.KNOWN_CAPABILITIES` no se vayan por su lado.
- `tests/unit/test_app.py` afirmaba la lista de capacidades completa (`== ["auth", "legacy.v1"]`).
  Ahora afirma lo que depende del legado y deja que la lista crezca.
- `tests/unit/test_auth.py` y `tests/characterization/test_replay_server.py` usaban el 501 de
  `/v2/quotes` como prueba de que la sesión había pasado. Ahora piden esa ruta con símbolos
  inválidos a propósito: la respuesta (401 sin sesión, 422 con ella) no depende de si B2a ya la
  implementó y no ejecuta la ruta, así que tampoco sale a los proveedores.

`tests/contract/` y `tests/characterization/` son de **O**. `tests/unit/*.py` (las de la app, auth y
caché) pasaron a **B1**, que es quien es dueño de los archivos que prueban; cada stream de backend
escribe las suyas en `tests/unit/<stream>/`.
