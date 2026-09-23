# API v2 de KAIZEN

Contrato del backend (`kaizen_api`, FastAPI) para el frontend nuevo. **Congelado después de M1**:
este documento y `kaizen_api/schemas.py` solo cambian con una solicitud al orquestador
(`docs/requests/<stream>.md`). La fuente de verdad es `kaizen_api/schemas.py`; la sección
[Referencia de modelos](#referencia-de-modelos) se genera de ahí y `pytest` falla si se desfasa.

Estado hoy: están implementadas `GET /health`, `POST /auth/login`, `GET /auth/me` y las rutas v1
del backend viejo. Todas las demás rutas v2 ya están registradas, validan sus parámetros y
responden `501 NOT_IMPLEMENTED` hasta que su stream (B2a, B2b, B3a, B3b o B3c) las implemente.
`/health` anuncia en `capabilities` solo lo que ya funciona.

## Convenciones

- **Formato**: JSON UTF-8, nombres de campo en camelCase. Los modelos no aceptan campos extra: un
  campo nuevo es un cambio de contrato.
- **Unidades**:
  - Tasas, rendimientos, márgenes, crecimientos, pesos y probabilidades son **fracciones
    decimales**: `0.0123` es 1.23 %. En la referencia aparecen como `fraction`.
  - Múltiplos (P/E, EV/EBITDA, P/B, P/NAV, D/E) son **razones simples** (`ratio`). `debtToEquity`
    es razón: Yahoo lo reporta en porcentaje y se divide entre 100.
  - Los cambios de tasas van en **puntos base** en campos que terminan en `Bp`.
  - Los montos (`money`) están en la moneda del campo `currency` más cercano. En la ficha de
    emisora las razones que mezclan precio con estados financieros convierten primero los estados
    de `financialCurrency` a `priceCurrency`.
  - Fechas `YYYY-MM-DD` (`date`); instantes ISO 8601 con zona, UTC con `Z` (`instant`).
- **Datos faltantes**: cualquier métrica numérica puede venir `null` si la fuente no la tiene. La UI
  muestra "s/d". En la referencia, "Requerido: sí" significa que la llave siempre viene, aunque su
  valor pueda ser `null` si el tipo lo permite.
- **Símbolos**: `^[A-Za-z0-9.\-\^=$]{1,20}$`, se pasan a mayúsculas en el servidor. `.MX` es
  BMV/SIC en MXN. Los pares de divisas van sin separador: `USDMXN`.
- **Procedencia (`meta`)**: toda respuesta de datos lleva `meta` con `asOf` (fecha o instante del
  dato más nuevo), `source`, `delayMinutes`, `stale`, `fallback`, `generatedAt` y `notes`.
  - `source` es una o varias de `yahoo`, `banxico`, `fred`, `sec`, `cboe`, `stooq`, `rss`,
    `eodhd`, `computed`, `curated`, `damodaran`, `replay`, separadas por coma sin espacios.
  - `fallback: true` significa que se usó una fuente sustituta o un valor de referencia, y la UI
    tiene que decirlo. No existe un USD/MXN fijo de 17.5 ni una tasa libre de riesgo fija de 8.6 %
    en v2: si no hay dato real la ruta responde `503 UPSTREAM_UNAVAILABLE`.
  - En el código se arma con `kaizen_api.provenance.meta(source, as_of=None, delay_minutes=None,
    stale=False, fallback=False, notes=None)`.

## Sesión

- Con `AUTH_REQUIRED=true` todas las rutas exigen `Authorization: Bearer <token>` salvo
  `GET /health`, `POST /auth/login` y los `OPTIONS` de CORS. Con `AUTH_REQUIRED=false` (desarrollo)
  las rutas quedan abiertas; `GET /auth/me` siempre exige token.
- `SECRET_KEY` es obligatoria, de 32 caracteres o más y distinta de la llave de desarrollo (que
  está publicada en el repo) en producción y siempre que `AUTH_REQUIRED=true`, en cualquier
  entorno. Si no, el servidor no arranca. La llave de desarrollo solo se usa sin `AUTH_REQUIRED`.
- El token es un JWT HS256 firmado con `SECRET_KEY`, con `sub` (usuario en minúsculas), `iat`,
  `exp` (`TOKEN_TTL_HOURS`, 12 por omisión) y `ver` (`TOKEN_VERSION`). Subir `TOKEN_VERSION`
  revoca todos los tokens; quitar a alguien de `USERS` revoca los suyos.
- `USERS` es JSON `{"usuario": "scrypt$16384$8$1$<sal_hex>$<hash_hex>"}`. Se genera con
  `python scripts/hash_password.py --user <usuario>`. Fuera de producción también se aceptan
  contraseñas en texto plano (con aviso al arrancar); en producción el servidor no arranca con ellas.
- Límite de tasa del login (compartido con el `POST /login` v1): 5 intentos por minuto por IP
  (primer salto de `X-Forwarded-For`, si no la IP de la conexión) y 10 por hora por usuario. Se
  cuentan todos los intentos. Al pasarse: `429 RATE_LIMITED` con `Retry-After` en segundos.
  El primer salto de `X-Forwarded-For` lo escribe el cliente; por eso existe también el límite
  por usuario.
- Un 401 lleva `WWW-Authenticate: Bearer` y `details.reason`: `missing_token`, `token_expired`,
  `token_invalid`, `token_revoked` o `user_unknown`. El login fallido no da `details`.

## Errores

Todo error lleva el status HTTP real, `Cache-Control: no-store` y el cuerpo
`{"error": {"code": "...", "message": "...", "details": {...}}}`. `message` está en español y se
puede mostrar al usuario; nunca incluye texto de excepciones ni trazas. `details` es opcional y no
repite lo que mandó el cliente.

| Código | Status | Cuándo |
| --- | --- | --- |
| `VALIDATION_ERROR` | 422 | Parámetro o cuerpo inválido (rango, fecha inexistente, lista vacía o de más de 50). `details.fields` lista `{field, type}`. |
| `INVALID_SYMBOL` | 400 | Un símbolo no cumple el patrón. `details.fields` como en `VALIDATION_ERROR`. |
| `BAD_REQUEST` | 400 | Otra solicitud mal formada. |
| `UNAUTHORIZED` | 401 | Falta el token, expiró o es inválido; credenciales incorrectas en el login. |
| `FORBIDDEN` | 403 | Reservado. |
| `NOT_FOUND` | 404 | Ruta inexistente o símbolo sin datos. |
| `METHOD_NOT_ALLOWED` | 405 | Método no aceptado; lleva `Allow`. |
| `RATE_LIMITED` | 429 | Límite de tasa; lleva `Retry-After`. |
| `UPSTREAM_UNAVAILABLE` | 502 o 503 | La fuente de datos no respondió o no hay dato real. |
| `NOT_CONFIGURED` | 503 | Falta configurar la fuente (por ejemplo `BANXICO_TOKEN`). |
| `NOT_IMPLEMENTED` | 501 | Ruta registrada que su stream todavía no implementa; `details.endpoint`. |
| `INTERNAL` | 500 | Error inesperado. El servidor lo registra con el id de request. |

## Caché HTTP y cabeceras

`Cache-Control: private, max-age=<n>` en respuestas exitosas, por clase de dato:

| Clase | max-age (s) | Rutas |
| --- | --- | --- |
| quotes | 30 | `/v2/quotes`, `/v2/fx`, `/v2/markets/overview`, `/v2/markets/world`, `/v2/instrument/{symbol}` |
| history | 3600 | `/v2/history/{symbol}`, `/v2/panel`, `/v2/fx/history`, `/v2/momentum/{symbol}` |
| fundamentals | 21600 | `/v2/search`, `/v2/events`, `/v2/instrument/{symbol}/statements`, `/v2/instrument/{symbol}/dividends`, `/v2/valuation/{symbol}`, `/v2/insiders/{symbol}` |
| macro | 3600 | `/v2/rates/mx`, `/v2/rates/rf`, `/v2/macro/us` |
| news | 600 | `/v2/news` |
| screeners | 43200 | `/v2/screeners/factors`, `/v2/screeners/magic`, `/v2/screeners/fibras` |

`/health` y `/auth/*` salen con `no-store`. Toda respuesta lleva `X-Request-ID` (se respeta el que
mande el cliente si es `[A-Za-z0-9._-]{1,64}`). Las respuestas de 1 KB o más salen con gzip si el
cliente lo acepta.

CORS: orígenes exactos de `ALLOWED_ORIGINS` más la regex `ALLOWED_ORIGIN_REGEX` (por omisión
`^https://newkaizen(-[a-z0-9-]+)?\.vercel\.app$`; fuera de producción se suman
`http://localhost:*` y `http://127.0.0.1:*`). Métodos `GET, POST, OPTIONS`; cabeceras de
entrada `Authorization, Content-Type, X-Request-ID`; cabeceras expuestas al JS de otro origen
`Retry-After, X-Request-ID` (`Access-Control-Expose-Headers`); `max-age` 600; sin credenciales de
navegador (el token va en la cabecera).

## Endpoints

Cada ruta indica su modelo de respuesta (ver la referencia), su clase de caché y quién la implementa.
Desde M1 cada archivo de `kaizen_api/routers/` tiene rutas de un solo stream de fase 2; el título
de cada sección dice cuál y en qué archivo viven (la tabla completa y las dependencias entre streams
están en `docs/OWNERSHIP.md`).

### Plataforma (B1: `routers/health.py` y `routers/auth.py`)

- `GET /health` (pública) → `HealthResponse`. `capabilities` es un subconjunto de
  `schemas.KNOWN_CAPABILITIES` y solo lista lo que ya funciona: hoy `auth` y, con las rutas v1
  montadas, `legacy.v1`. `providers.*.configured` indica si hay token; `ok` es `null` mientras no se
  compruebe la fuente. Implementada (S1; dueño en adelante: B1).
- `POST /auth/login` (pública) con cuerpo `LoginRequest` `{username, password}` → `LoginResponse`
  `{token, expiresAt, user: {username, displayName}}`. Errores: `401 UNAUTHORIZED`,
  `422 VALIDATION_ERROR`, `429 RATE_LIMITED`. Implementada (dueño: B1).
- `GET /auth/me` → `MeResponse` `{user, expiresAt}`. Siempre exige token. Implementada (dueño: B1).

### Datos de mercado (B2a: `routers/quotes.py`, `routers/history.py` y `routers/search.py`)

- `GET /v2/quotes?symbols=A,B` (hasta 50) → `QuotesResponse`. Los símbolos sin cotización van en
  `missing`, no como error. Cada `Quote` trae `sector` e `industry` (fase 3, pedido de F1 para la
  concentración por sector de /portafolio/riesgo), tomados del mismo `info` de Yahoo que da el
  precio, así que pedirlos no cuesta otra llamada. `sector` va en español de México con la misma
  tabla que los screeners (`domain/universe.py`, `SECTOR_ES`: `Technology` sale como `Tecnología`,
  `Financial Services` y `Financials` salen los dos como `Servicios financieros`); un sector sin
  traducción sale tal cual lo manda Yahoo. `industry` no tiene catálogo de traducción y sale en
  inglés, así que para agrupar y para mostrar conviene `sector`. Índices, fondos, ETF, divisas y
  cripto no traen sector en Yahoo y salen con los dos en `null`: la UI los muestra como "s/d" o los
  agrupa por `type`, nunca les adivina un sector. Ojo: `InstrumentResponse.sector` todavía sale
  crudo, en inglés. El servidor siempre manda los dos campos; son opcionales en el contrato solo
  para que un cliente tolere un API desplegado antes de este cambio.
- `GET /v2/search?q=&limit=10` (`q` de 1 a 64 caracteres, `limit` de 1 a 50) → `SearchResponse`.
  Fuentes: `company_tickers.json` de la SEC y la lista curada `kaizen_api/data/symbols_mx.json` con
  alias en español (sin red para México).
- `GET /v2/history/{symbol}?range=1y&interval=1d&ccy=native` → `HistoryResponse`.
  `range`: `1mo 3mo 6mo 1y 2y 5y 10y max`; `interval`: `1d 1wk 1mo`; `ccy`: `native MXN USD`.
  Cierres ajustados por splits y dividendos (rendimiento total). La conversión usa el tipo de cambio
  de la MISMA fecha, con relleno hacia adelante de a lo más 3 días en huecos del FX, anotado en
  `meta.notes`.
- `GET /v2/panel?symbols=A,B&range=1y&interval=1d&ccy=MXN` → `PanelResponse`. INNER JOIN por fecha,
  sin rellenar precios; los símbolos que no se pudieron alinear van en `dropped` con su motivo. Los
  rendimientos se calculan en el cliente. Para separar efecto precio y efecto tipo de cambio, ver
  "Panel en moneda nativa y en MXN" en las recetas para el cliente, más abajo.
- `GET /v2/fx?pair=USDMXN` → `FxResponse`. FIX de Banxico (`banxico_fix`) si hay token, si no Yahoo
  marcado en `meta`.
- `GET /v2/fx/history?pair=USDMXN&start=&end=` → `FxHistoryResponse`. Banxico FIX SF43718 con token,
  si no Yahoo `MXN=X` marcado. `start` y `end` son fechas reales con `start <= end`.

### Tasas y macro (B2b: `routers/rates.py` y `routers/macro.py`)

- `GET /v2/rates/mx` → `MxRatesResponse`. Ids: `target` (objetivo, SF61745), `tiie28`,
  `tiieFondeo`, `cetes28`, `cetes91`, `cetes182`, `cetes364`, `bonoM10` (si existe), `inflationYoY`,
  `coreInflationYoY`, `udi`, `fix`. Cualquier serie del SIE distinta de SF43718 y SF61745 se verifica
  contra el endpoint de metadatos del SIE en una prueba antes de usarse. Desde la fase 3 (pedidos 2
  y 3 de F2) cada renglón dice tres cosas por serie:
  - `verified`: `true` solo si la serie viene del SIE, tiene revisión humana en el catálogo
    (`verified: true` en `kaizen_api/data/banxico_series.json`) y el SIE la confirmó hoy con su
    título, periodicidad y unidad. Una serie del SIE que no pase ese candado no se publica (su id y
    la razón quedan en `meta.notes`), así que hoy `verified: false` solo lo lleva el respaldo de FRED
    (`bonoM10` con `source: "fred"`), que nunca pasa por el SIE. La UI lo marca como no verificado.
  - `stale`: el último dato de ESA serie es más viejo de lo que se tolera para su periodicidad
    (`maxAgeDays` del catálogo: 5 días naturales para objetivo, TIIE, FIX y UDI; 14 a 35 para los
    CETES; 7 para el Bono M del SIE; 45 para la inflación quincenal; y 70 para el Bono M mensual de
    FRED, en `FRED_MX_FALLBACK` de `domain/rates.py`). `meta.stale` es exactamente que alguna serie
    tenga `stale: true`.
  - `tenorDays`: plazo en días de los CETES (`cetes28` 28, `cetes91` 91, `cetes182` 182,
    `cetes364` 364), el mismo que acepta `/v2/rates/rf`; `null` en todas las demás series, incluida
    la TIIE. Ya no hace falta sacarlo del id ni de la etiqueta.

  El servidor siempre manda los tres campos; son opcionales en el contrato solo para que un cliente
  tolere un API desplegado antes de este cambio (ahí, sin `verified`, la serie no se da por
  verificada, y sin `stale` se usa `meta.stale`).
- `GET /v2/rates/rf?start=&end=&tenorDays=28` (`tenorDays`: 28, 91, 182 o 364) →
  `RfSeriesResponse`. Rendimientos anualizados simples act/360 como fracción. El cliente convierte a
  tasa por periodo: `rf_d = (1 + y * 28 / 360)^(d / 28) - 1`. Fuente `banxico`, o `fred_ir3tib`
  marcada como `fallback`.
- `GET /v2/macro/us` → `UsMacroResponse`. Ids: `ust3m`, `ust2y`, `ust10y`, `spread10y2y`,
  `spread10y3m`, `vix`, `dxy`, `fedFunds`.

### Mercados (B2a: `routers/markets.py`)

- `GET /v2/markets/overview` → `MarketsOverviewResponse`. Grupos `mx`, `us`, `global`, `fx`,
  `commodities`, `crypto`, más `marketStatus` de BMV y NYSE (calendario de B2a en
  `domain/market_calendar.py`).
- `GET /v2/markets/world` → `WorldResponse`. Variación por país con ETF de iShares en USD;
  `country` es ISO 3166-1 numérico de 3 dígitos (484 = México).

### Noticias (B2b: `routers/news.py`)

- `GET /v2/news?symbol=&lang=all&limit=30` (`lang`: `es en all`; `limit` de 1 a 100) →
  `NewsResponse`. Solo titular y liga, entidades HTML decodificadas, sin duplicados por título
  normalizado; tono heurístico `positivo`, `negativo` o `neutral`.

### Investigación (B3a: `routers/research.py`, `routers/events.py` y `routers/insiders.py`)

- `GET /v2/instrument/{symbol}` → `InstrumentResponse`: cotización, fundamentales en la moneda del
  precio, beta (calculada o de Yahoo, con ventana y observaciones), `sectorMedians` y cobertura.
  `sectorMedians` hoy siempre sale en `null`; qué llaves tiene y dónde está la referencia del sector
  que sí existe, en "Referencias del sector", más abajo.
- `GET /v2/instrument/{symbol}/statements?freq=annual` (`annual` o `quarterly`) →
  `StatementsResponse`. Solo renglones reales (SEC para emisores de EE. UU., Yahoo para el resto),
  nunca sintetizados; sin datos, `periods` vacío.
- `GET /v2/instrument/{symbol}/dividends` → `DividendsResponse`.
- `GET /v2/events?symbols=A,B` → `EventsResponse`. Reportes (`earnings`), fecha ex dividendo
  (`exDividend`) y de pago (`dividendPay`).
- `GET /v2/insiders/{symbol}` → `InsidersResponse`. Tipos `compra`, `venta`, `otorgamiento`,
  `ejercicio` y `otro`; `summary` cuenta solo compras y ventas en mercado abierto.

### Valuación y momentum (B3b: `routers/valuation.py`)

- `GET /v2/valuation/{symbol}?erp=&crp=&terminalGrowth=&years=&growth=` → `ValuationResponse`.
  Límites: `erp` y `crp` de 0 a 0.2, `terminalGrowth` de -0.02 a 0.06, `years` de 1 a 15, `growth`
  de -0.5 a 1.0. Múltiplos contra el sector (mercado `US` o `EM`), DCF de flujo a la empresa con
  sensibilidad WACC por crecimiento, y P/B justificado para bancos. Cómo leer `benchmark` contra
  `current` en `multiples.methods`, en "Referencias del sector", más abajo.
- `GET /v2/momentum/{symbol}` → `MomentumResponse`. `r12m1` es el rendimiento de 12 meses sin el
  último mes; `relative12m1` contra `benchmark`.

### Screeners (B3c: `routers/screeners.py`)

- `GET /v2/screeners/factors?universe=mx` (`mx`, `us` o `custom`; con `custom` se exige
  `symbols=A,B`, hasta 50, y sin `custom` no se acepta `symbols`) → `FactorsResponse`.
- `GET /v2/screeners/magic?universe=us` (`us` o `mx`) → `MagicResponse`. Solo EBIT reportado, nunca
  estimado; `partial: true` si no respondieron todas las emisoras.
- `GET /v2/screeners/fibras?extra=A,B` (hasta 20 extra) → `FibrasResponse`. `signal` es
  `descuento`, `en_linea`, `prima` o `sin_datos` (descripción del precio contra el NAV, no una
  recomendación). `ltv` es deuda entre activos totales.

## Recetas y referencias para el cliente

Respuestas a pedidos de los streams de la fase 3 que no cambian el contrato: dicen qué trae cada
campo y cómo combinar rutas que ya existen. Las pruebas `tests/contract/test_pb_docs_referencias.py`,
`tests/unit/b3b/test_pb_referencia_sectorial.py` y `tests/unit/b2a/test_pb_panel_nativo_y_mxn.py`
comprueban contra el servidor lo que dice esta sección.

### Referencias del sector: `sectorMedians` y `multiples.methods`

Pedido 3 de F3. Hay dos lugares que hablan del sector y no son lo mismo.

**`sectorMedians` vive en `GET /v2/instrument/{symbol}`, no en `GET /v2/valuation/{symbol}`.** Es un
objeto cuyas llaves son un subconjunto de `FundamentalKey`, las mismas 22 de `fundamentals`: `pe`,
`forwardPe`, `pb`, `ps`, `evEbitda`, `pfcf`, `earningsYield`, `fcfYield`, `dividendYield`,
`payoutRatio`, `roe`, `roa`, `grossMargin`, `operatingMargin`, `netMargin`, `revenueGrowthYoY`,
`epsGrowthYoY`, `debtToEquity`, `netDebtToEbitda`, `currentRatio`, `enterpriseValue` y
`sharesOutstanding`. Cada valor iría en la misma unidad que su gemelo de `fundamentals` (fracción,
razón o monto) o en `null`. **Hoy el servidor siempre lo manda en `null`**: la ficha no arma un
universo de emisoras comparables, así que no hay mediana que publicar, y no se rellena con otra
cosa. La UI lo trata como "sin referencia del sector" y no la inventa.

**La referencia del sector que sí existe está en `GET /v2/valuation/{symbol}`, en
`multiples.methods`.** Siempre son cuatro renglones, en este orden:

| `id` | Múltiplo | Gemelo en `fundamentals` | `benchmark` |
| --- | --- | --- | --- |
| `pe` | Precio / utilidad | `pe` | Mediana del sector |
| `pb` | Precio / valor en libros | `pb` | Mediana del sector |
| `evEbitda` | Valor empresa / EBITDA | `evEbitda` | Mediana del sector |
| `pfcf` | Precio / flujo libre | `pfcf` | Siempre `null`: Damodaran no publica P/FCF por industria, y la razón va en `meta.notes` |

- `benchmark` es la mediana, solo de valores positivos, de los múltiplos de las industrias de
  Damodaran (datos de enero 2026) que caen en el sector de Yahoo de la emisora, en el mercado
  `multiples.market`: `US` si la emisora es de Estados Unidos y `EM` para cualquier otro país,
  México incluido. Es una mediana de industrias, no de emisoras comparables. Si el sector de Yahoo
  no se reconoce, la referencia es el total del mercado sin financieras. Fecha y fuente de la tabla:
  `multiples.asOf` y `multiples.source`.
- Cuál de las dos fue (sector o total del mercado) hoy solo se dice en texto, en `meta.notes`
  ("Mediana de N industrias de Damodaran del sector ..." o "Total del mercado ..."), y solo cuando
  `multiples.applicable` es `true`. No hay un campo que lo diga.
- `current` es el múltiplo de la emisora calculado por la propia valuación, en la moneda del precio.
  Compara `benchmark` contra `current` de la misma respuesta, no contra `fundamentals` de la ficha:
  los dos cálculos no usan las mismas definiciones de valor empresa y de flujo libre. Con las
  grabaciones del 22 de septiembre de 2026, el EV/EBITDA de AAPL sale 34.73 en la valuación y 29.80
  en la ficha; el P/U sí coincide.
- `applicable` de cada renglón es `true` solo si hubo precio implícito. En bancos, aseguradoras,
  FIBRAs, fondos y con utilidades negativas todo el bloque sale con `multiples.applicable: false` y
  su `reason`; `current` y `benchmark` se siguen publicando como contexto, sin precio implícito.

### Panel en moneda nativa y en MXN: efecto precio y efecto tipo de cambio

Pedido 2 de F1. No hay una ruta que devuelva las dos monedas juntas y no hace falta: con dos
llamadas, casi siempre, el cliente tiene todo, y el tipo de cambio le sale exacto, el mismo que usó
el servidor para convertir.

1. La moneda de cada posición sale del `currency` de `/v2/quotes`.
2. `GET /v2/panel?symbols=<todas>&ccy=MXN` da los precios en pesos, que es lo que ya usa el riesgo.
3. `GET /v2/panel?symbols=<las de una moneda>&ccy=native`, una llamada por cada moneda distinta del
   peso (en la práctica, una con las emisoras en dólares). Pedir `ccy=native` con monedas mezcladas
   responde `400 BAD_REQUEST` a propósito, porque un panel tiene un solo `currency`. Las emisoras en
   pesos no necesitan el panel nativo: en MXN su precio es el mismo.
4. Cruza por fecha y usa solo las fechas que estén en los dos paneles. No coinciden: cada panel es
   un INNER JOIN de sus propios símbolos, y la conversión omite las fechas sin tipo de cambio
   cercano.
5. El tipo de cambio de cada fecha es `X = precio en MXN / precio nativo`. Es exactamente el que usó
   el servidor (FIX de Banxico o Yahoo, con el mismo relleno de hasta 3 días), así que para esto no
   hace falta `/v2/fx/history`, que sirve para mostrar la serie del tipo de cambio pero no reproduce
   la conversión fecha por fecha.
6. La separación la hace `pnlDecomposition` de `src/lib/finance/fx.js`: `price0` y `price1` del panel
   nativo, `fx0` y `fx1` del paso 5 (en 1 para las posiciones en pesos). El efecto precio va a tipo
   de cambio inicial y el efecto cambiario a precio final, y suman exactamente el resultado en pesos.

Procedencia: el efecto cambiario hereda el `meta` del panel en MXN. Si ahí `meta.fallback` es
`true`, el tipo de cambio vino de Yahoo y no del FIX, y la UI lo dice junto al efecto cambiario; el
panel nativo no convierte nada y su `meta` habla solo de precios. Pide los dos paneles con el mismo
`range` e `interval`. El segundo casi nunca vuelve a salir a Yahoo por los precios, porque el
servidor guarda la serie de cada símbolo una hora.

## Rutas v1 (legado)

Se montan con `KAIZEN_LEGACY_ROUTES` (encendido por omisión fuera de producción) para la UI vieja,
con las respuestas idénticas a `backend.py` (lo prueban los 122 goldens de `tests/goldens_legacy`):
`GET /stock/{t}`, `/chart/{t}?period=&ccy=`, `/rf`, `/news/market`, `/news/{t}`, `/macro`, `/market`,
`/worldmap`, `/dcf/{t}`, `/edgar/{t}`, `/fibras`, `/fibras/{extra}`, `/magic`, `/magic_one/{t}`,
`/insiders/{t}`, `/momentum/{t}`, `/returns/{t}`, `/fx` y `POST /login`.

- Semántica vieja: status 200 con `{"error": "..."}` en fallas y cuerpo `json.dumps(result,
  default=str)` byte por byte. Unidades viejas (porcentajes). Mismo `Ticker inválido` para símbolos
  fuera del patrón.
- Con `AUTH_REQUIRED` también exigen token (401 con el cuerpo de error v2).
- Diferencias deliberadas: `/health` es el nuevo (la UI vieja solo revisa `status == "ok"`); se
  quitaron `/debug/macro` y el precalentamiento de la Fórmula Mágica al arrancar; una ruta
  desconocida da `404 NOT_FOUND` v2; `POST /login` verifica contra `USERS` con scrypt, comparte el
  límite de tasa (429 con `{"ok": false, "error": ...}`) y no emite token; CORS sale de la
  configuración y ya no es `*`.
- No aparecen en `/openapi.json`.

## Correr el API

```bash
# Con datos grabados (sin red, reloj congelado en el set 2026-09-22):
.venv/bin/python scripts/run_replay_backend.py --port 8101
USERS='{"demo":"demo"}' .venv/bin/python scripts/run_replay_backend.py --port 8101   # con login
# Con la capa de un stream encima de la base (se busca en orden; gana la primera que tenga la llamada):
.venv/bin/python scripts/run_replay_backend.py --port 8101 --set 2026-09-22,2026-09-22-b2a

# En vivo (red real), como en Render:
PORT=8101 .venv/bin/python backend.py

# Pruebas y lint (sin red):
.venv/bin/python -m pytest -q
.venv/bin/ruff check .
```

Variables de entorno: ver el docstring de `kaizen_api/settings.py`. En producción
(`KAIZEN_ENV=production`) el servidor no arranca sin `SECRET_KEY` propia de 32 caracteres o más, ni
con contraseñas en texto plano en `USERS`; además se apagan `/docs`, `/openapi.json` y las rutas v1.
Con `AUTH_REQUIRED=true` la regla de `SECRET_KEY` aplica también en desarrollo: para probar la
sesión en local, define una (por ejemplo `SECRET_KEY=$(openssl rand -hex 32)`).

## Referencia de modelos

Generada de `kaizen_api/schemas.py`. Tipos: `fraction` (fracción decimal), `ratio` (múltiplo),
`money` (monto en la moneda del `currency` más cercano), `date`, `instant`, `currency` (ISO 4217),
`symbol`, `pair` (par de divisas) y `source` (lista de fuentes de `meta`).

<!-- BEGIN REFERENCIA GENERADA: no editar a mano, ver tests/contract/docs_reference.py -->

#### Meta

Procedencia de una respuesta. ``fallback=true`` obliga a la UI a decir que es sustituto.

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `asOf` | date o instant \| null | sí | Fecha o instante del dato más nuevo |
| `source` | source | sí | Fuente o lista separada por comas |
| `delayMinutes` | integer \| null | sí | Retraso típico de la fuente en minutos; mín 0 |
| `stale` | boolean | sí | El dato es más viejo de lo esperado para su clase |
| `fallback` | boolean | sí | Se usó una fuente sustituta o un valor de referencia |
| `generatedAt` | instant | sí | Instante en que el servidor armó la respuesta |
| `notes` | string[] | sí | Avisos en español para la UI (rellenos, ajustes, huecos) |

#### ErrorBody

Cuerpo de todo error: ``{"error": {"code", "message", "details"?}}`` con el status HTTP real.

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `error` | ErrorDetail | sí |  |

#### ErrorDetail

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `code` | "VALIDATION_ERROR" \| "INVALID_SYMBOL" \| "BAD_REQUEST" \| "UNAUTHORIZED" \| "FORBIDDEN" \| "NOT_FOUND" \| "METHOD_NOT_ALLOWED" \| "RATE_LIMITED" \| "UPSTREAM_UNAVAILABLE" \| "NOT_CONFIGURED" \| "NOT_IMPLEMENTED" \| "INTERNAL" | sí |  |
| `message` | string | sí | Mensaje en español, apto para mostrarse al usuario |
| `details` | {string: any} \| null | no |  |

#### LoginRequest

Cuerpo de ``POST /auth/login``. Acepta y descarta campos extra.

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `username` | string | sí | largo mín 1; largo máx 64 |
| `password` | string | sí | largo mín 1; largo máx 256 |

#### HealthResponse

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `status` | "ok" | sí |  |
| `apiVersion` | 2 | sí |  |
| `version` | string | sí |  |
| `commit` | string \| null | sí |  |
| `authRequired` | boolean | sí |  |
| `capabilities` | string[] | sí | Subconjunto de KNOWN_CAPABILITIES |
| `providers` | HealthProviders | sí |  |
| `serverTime` | instant | sí |  |

#### HealthProviders

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `yahoo` | ProviderOk | sí |  |
| `banxico` | ProviderConfigured | sí |  |
| `fred` | ProviderConfigured | sí |  |
| `sec` | ProviderOk | sí |  |
| `eodhd` | ProviderConfigured | sí |  |

#### ProviderOk

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `ok` | boolean \| null | sí | null = no se ha comprobado |

#### ProviderConfigured

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `configured` | boolean | sí |  |

#### LoginResponse

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `token` | string | sí | JWT HS256; mándalo como Authorization: Bearer <token> |
| `expiresAt` | instant | sí |  |
| `user` | AuthUser | sí |  |

#### AuthUser

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `username` | string | sí |  |
| `displayName` | string | sí |  |

#### MeResponse

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `user` | AuthUser | sí |  |
| `expiresAt` | instant | sí |  |

#### QuotesResponse

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `quotes` | Quote[] | sí |  |
| `missing` | string[] | sí | Símbolos pedidos sin cotización |
| `meta` | Meta | sí |  |

#### Quote

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `symbol` | symbol | sí |  |
| `name` | string | sí |  |
| `price` | money | sí |  |
| `previousClose` | money \| null | sí |  |
| `change` | money \| null | sí |  |
| `changePct` | fraction \| null | sí |  |
| `currency` | currency | sí |  |
| `exchange` | string \| null | sí |  |
| `type` | "equity" \| "etf" \| "fibra" \| "index" \| "fx" \| "crypto" \| "commodity" \| "fund" \| null | sí |  |
| `marketState` | string \| null | sí |  |
| `asOf` | date o instant \| null | sí |  |
| `sector` | string \| null | no | Sector de Yahoo en español de México (el mismo que usan los screeners); null si Yahoo no lo trae |
| `industry` | string \| null | no | Industria tal como la publica Yahoo, en inglés; null si no viene |

#### SearchResponse

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `results` | SearchResult[] | sí |  |
| `meta` | Meta | sí |  |

#### SearchResult

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `symbol` | symbol | sí |  |
| `name` | string | sí |  |
| `exchange` | string \| null | sí |  |
| `type` | "equity" \| "etf" \| "fibra" \| "index" \| "fx" \| "crypto" \| "commodity" \| "fund" | sí |  |
| `currency` | currency \| null | sí |  |
| `aliases` | string[] | sí | Nombres alternos en español (FEMSA, Walmart de México...) |

#### HistoryResponse

Cierres ajustados (rendimiento total). ``dates`` y ``close`` tienen la misma longitud.

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `symbol` | symbol | sí |  |
| `currency` | currency | sí |  |
| `interval` | "1d" \| "1wk" \| "1mo" | sí |  |
| `adjusted` | true | sí |  |
| `dates` | date[] | sí |  |
| `close` | number[] | sí |  |
| `fx` | FxSource \| null | sí | Tipo de cambio usado si ccy convirtió la serie |
| `meta` | Meta | sí |  |

#### FxSource

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `pair` | "USDMXN" | sí |  |
| `source` | string | sí |  |

#### PanelResponse

Precios alineados por fecha (INNER JOIN, sin rellenar precios).

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `currency` | currency | sí |  |
| `interval` | "1d" \| "1wk" \| "1mo" | sí |  |
| `dates` | date[] | sí |  |
| `prices` | {string: number[]} | sí |  |
| `dropped` | DroppedSymbol[] | sí |  |
| `meta` | Meta | sí |  |

#### DroppedSymbol

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `symbol` | string | sí |  |
| `reason` | string | sí |  |

#### FxResponse

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `pair` | pair | sí |  |
| `rate` | number | sí |  |
| `asOf` | date o instant | sí |  |
| `source` | "banxico_fix" \| "yahoo" | sí |  |
| `stale` | boolean | sí |  |
| `meta` | Meta | sí |  |

#### FxHistoryResponse

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `pair` | pair | sí |  |
| `dates` | date[] | sí |  |
| `values` | number[] | sí |  |
| `source` | "banxico_fix" \| "yahoo" | sí |  |
| `meta` | Meta | sí |  |

#### MxRatesResponse

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `items` | MxRateItem[] | sí |  |
| `meta` | Meta | sí |  |

#### MxRateItem

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `id` | "target" \| "tiie28" \| "tiieFondeo" \| "cetes28" \| "cetes91" \| "cetes182" \| "cetes364" \| "bonoM10" \| "inflationYoY" \| "coreInflationYoY" \| "udi" \| "fix" | sí |  |
| `label` | string | sí |  |
| `value` | number | sí | Fracción si unit=fraction; nivel si index o mxn |
| `unit` | "fraction" \| "index" \| "mxn" | sí |  |
| `asOf` | date | sí |  |
| `seriesId` | string | sí | Id de la serie en el SIE de Banxico (p. ej. SF61745) |
| `source` | string | sí |  |
| `previous` | number \| null | sí |  |
| `changeBp` | number \| null | sí |  |
| `verified` | boolean | no | true solo si la serie es del SIE, tiene revisión humana en el catálogo y el SIE la confirmó hoy; los respaldos de FRED van en false |
| `stale` | boolean | no | El último dato de ESTA serie es más viejo de lo que se tolera para su periodicidad |
| `tenorDays` | 28 \| 91 \| 182 \| 364 \| null | no | Plazo en días de los CETES (el mismo de /v2/rates/rf); null en las demás series |

#### RfSeriesResponse

Rendimientos anualizados simples act/360 como fracción. El cliente convierte por periodo.

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `tenorDays` | 28 \| 91 \| 182 \| 364 | sí |  |
| `convention` | "simple_act360" | sí |  |
| `dates` | date[] | sí |  |
| `values` | fraction[] | sí |  |
| `source` | "banxico" \| "fred_ir3tib" | sí |  |
| `fallback` | boolean | sí |  |
| `meta` | Meta | sí |  |

#### UsMacroResponse

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `items` | UsMacroItem[] | sí |  |
| `meta` | Meta | sí |  |

#### UsMacroItem

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `id` | "ust3m" \| "ust2y" \| "ust10y" \| "spread10y2y" \| "spread10y3m" \| "vix" \| "dxy" \| "fedFunds" | sí |  |
| `label` | string | sí |  |
| `value` | number | sí |  |
| `previous` | number \| null | sí |  |
| `change` | number \| null | sí | En la unidad de value |
| `changeBp` | number \| null | sí | Solo para tasas y diferenciales |
| `unit` | "fraction" \| "bp" \| "index" | sí |  |
| `asOf` | date o instant | sí |  |
| `source` | string | sí |  |

#### MarketsOverviewResponse

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `groups` | MarketGroup[] | sí |  |
| `marketStatus` | MarketStatus | sí |  |
| `meta` | Meta | sí |  |

#### MarketGroup

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `id` | "mx" \| "us" \| "global" \| "fx" \| "commodities" \| "crypto" | sí |  |
| `label` | string | sí |  |
| `items` | MarketItem[] | sí |  |

#### MarketItem

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `symbol` | symbol | sí |  |
| `label` | string | sí |  |
| `price` | number \| null | sí |  |
| `change` | number \| null | sí |  |
| `changePct` | fraction \| null | sí |  |
| `currency` | currency \| null | sí |  |
| `asOf` | date o instant \| null | sí |  |

#### MarketStatus

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `bmv` | ExchangeStatus | sí |  |
| `nyse` | ExchangeStatus | sí |  |

#### ExchangeStatus

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `open` | boolean | sí |  |
| `label` | string | sí |  |
| `nextOpen` | instant \| null | sí |  |
| `nextClose` | instant \| null | sí |  |

#### WorldResponse

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `items` | WorldItem[] | sí |  |
| `method` | string | sí |  |
| `meta` | Meta | sí |  |

#### WorldItem

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `country` | string de 3 dígitos | sí | ISO 3166-1 numérico (484 = México) |
| `symbol` | symbol | sí |  |
| `label` | string | sí |  |
| `changePct` | fraction \| null | sí |  |
| `currency` | "USD" | sí |  |
| `asOf` | date o instant \| null | sí |  |

#### NewsResponse

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `items` | NewsItem[] | sí |  |
| `meta` | Meta | sí |  |

#### NewsItem

Titular y liga, nada más: entidades HTML decodificadas, sin duplicados por título.

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `id` | string | sí |  |
| `title` | string | sí |  |
| `url` | string /^https?:/// | sí |  |
| `source` | string | sí |  |
| `publishedAt` | instant \| null | sí |  |
| `summary` | string \| null | sí |  |
| `lang` | "es" \| "en" | sí |  |
| `tone` | NewsTone \| null | sí |  |

#### NewsTone

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `label` | "positivo" \| "negativo" \| "neutral" | sí |  |
| `score` | number | sí | mín -1; máx 1 |
| `method` | "heuristic" | sí |  |

#### EventsResponse

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `items` | EventItem[] | sí |  |
| `meta` | Meta | sí |  |

#### EventItem

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `symbol` | symbol | sí |  |
| `type` | "earnings" \| "exDividend" \| "dividendPay" | sí |  |
| `date` | date | sí |  |
| `estimate` | number \| null | sí |  |
| `amount` | money \| null | sí |  |
| `currency` | currency \| null | sí |  |

#### InstrumentResponse

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `symbol` | symbol | sí |  |
| `name` | string | sí |  |
| `exchange` | string \| null | sí |  |
| `type` | "equity" \| "etf" \| "fibra" \| "index" \| "fx" \| "crypto" \| "commodity" \| "fund" \| null | sí |  |
| `sector` | string \| null | sí |  |
| `industry` | string \| null | sí |  |
| `country` | string \| null | sí |  |
| `description` | string \| null | sí |  |
| `website` | string /^https?:/// \| null | sí |  |
| `priceCurrency` | currency | sí |  |
| `financialCurrency` | currency \| null | sí |  |
| `fxUsed` | FxRateUsed \| null | sí |  |
| `quote` | InstrumentQuote | sí |  |
| `fundamentals` | Fundamentals | sí |  |
| `beta` | Beta \| null | sí |  |
| `sectorMedians` | {"pe" \| "forwardPe" \| "pb" \| "ps" \| "evEbitda" \| "pfcf" \| "earningsYield" \| "fcfYield" \| "dividendYield" \| "payoutRatio" \| "roe" \| "roa" \| "grossMargin" \| "operatingMargin" \| "netMargin" \| "revenueGrowthYoY" \| "epsGrowthYoY" \| "debtToEquity" \| "netDebtToEbitda" \| "currentRatio" \| "enterpriseValue" \| "sharesOutstanding": number \| null} \| null | sí |  |
| `coverage` | Coverage | sí |  |
| `meta` | Meta | sí |  |

#### FxRateUsed

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `pair` | pair | sí |  |
| `rate` | number | sí |  |
| `asOf` | date o instant \| null | sí |  |

#### InstrumentQuote

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `price` | money \| null | sí |  |
| `previousClose` | money \| null | sí |  |
| `change` | money \| null | sí |  |
| `changePct` | fraction \| null | sí |  |
| `dayLow` | money \| null | sí |  |
| `dayHigh` | money \| null | sí |  |
| `low52w` | money \| null | sí |  |
| `high52w` | money \| null | sí |  |
| `volume` | number \| null | sí |  |
| `avgVolume` | number \| null | sí |  |
| `marketCap` | money \| null | sí |  |
| `asOf` | date o instant \| null | sí |  |

#### Fundamentals

Razones en priceCurrency: los estados se convierten de financialCurrency antes de mezclar.

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `pe` | ratio \| null | sí |  |
| `forwardPe` | ratio \| null | sí |  |
| `pb` | ratio \| null | sí |  |
| `ps` | ratio \| null | sí |  |
| `evEbitda` | ratio \| null | sí |  |
| `pfcf` | ratio \| null | sí |  |
| `earningsYield` | fraction \| null | sí |  |
| `fcfYield` | fraction \| null | sí |  |
| `dividendYield` | fraction \| null | sí |  |
| `payoutRatio` | fraction \| null | sí |  |
| `roe` | fraction \| null | sí |  |
| `roa` | fraction \| null | sí |  |
| `grossMargin` | fraction \| null | sí |  |
| `operatingMargin` | fraction \| null | sí |  |
| `netMargin` | fraction \| null | sí |  |
| `revenueGrowthYoY` | fraction \| null | sí |  |
| `epsGrowthYoY` | fraction \| null | sí |  |
| `debtToEquity` | ratio \| null | sí | Razón; Yahoo lo da en %, se divide entre 100 |
| `netDebtToEbitda` | ratio \| null | sí |  |
| `currentRatio` | ratio \| null | sí |  |
| `enterpriseValue` | money \| null | sí |  |
| `sharesOutstanding` | number \| null | sí |  |

#### Beta

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `value` | number | sí |  |
| `adjusted` | number \| null | sí | Beta de Blume: 0.67 x beta + 0.33 |
| `benchmark` | string | sí |  |
| `currency` | currency | sí |  |
| `window` | string | sí | Ventana y frecuencia, por ejemplo 2y semanal |
| `observations` | integer | sí | mín 0 |
| `source` | "computed" \| "yahoo" | sí |  |

#### Coverage

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `available` | integer | sí | mín 0 |
| `total` | integer | sí | mín 0 |

#### StatementsResponse

Solo renglones reales, nunca sintetizados. Sin datos: periods vacío.

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `symbol` | symbol | sí |  |
| `currency` | currency \| null | sí |  |
| `freq` | "annual" \| "quarterly" | sí |  |
| `source` | "sec" \| "yahoo" | sí |  |
| `periods` | StatementPeriod[] | sí |  |
| `rows` | StatementRow[] | sí |  |
| `meta` | Meta | sí |  |

#### StatementPeriod

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `end` | date | sí |  |
| `fiscalYear` | integer | sí |  |
| `fiscalQuarter` | integer \| null | sí | mín 1; máx 4 |
| `form` | string \| null | sí | 10-K, 10-Q o null si la fuente no lo dice |

#### StatementRow

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `id` | "revenue" \| "grossProfit" \| "operatingIncome" \| "netIncome" \| "eps" \| "totalAssets" \| "totalDebt" \| "cash" \| "equity" \| "operatingCashFlow" \| "capex" \| "freeCashFlow" \| "dividendsPaid" | sí |  |
| `label` | string | sí |  |
| `values` | (number \| null)[] | sí |  |

#### DividendsResponse

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `symbol` | symbol | sí |  |
| `currency` | currency \| null | sí |  |
| `ttm` | money \| null | sí | Suma de los últimos 12 meses por acción |
| `yield` | fraction \| null | sí |  |
| `history` | DividendPoint[] | sí |  |
| `meta` | Meta | sí |  |

#### DividendPoint

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `date` | date | sí |  |
| `amount` | money | sí |  |

#### ValuationResponse

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `symbol` | symbol | sí |  |
| `currency` | currency | sí |  |
| `assumptions` | ValuationAssumptions | sí |  |
| `multiples` | MultiplesValuation | sí |  |
| `dcf` | DcfValuation | sí |  |
| `bank` | BankValuation \| null | sí |  |
| `meta` | Meta | sí |  |

#### ValuationAssumptions

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `rf` | fraction | sí |  |
| `erp` | fraction | sí |  |
| `crp` | fraction | sí |  |
| `lambda` | number | sí | Exposición al riesgo país (Damodaran) |
| `taxRate` | fraction | sí |  |
| `terminalGrowth` | fraction | sí |  |
| `source` | string | sí |  |
| `asOf` | date o instant \| null | sí |  |

#### MultiplesValuation

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `applicable` | boolean | sí |  |
| `reason` | string \| null | sí |  |
| `market` | "US" \| "EM" | sí |  |
| `source` | string | sí |  |
| `asOf` | date o instant \| null | sí |  |
| `methods` | MultipleMethod[] | sí |  |
| `fairValueRange` | FairValueRange \| null | sí |  |

#### MultipleMethod

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `id` | "pe" \| "pb" \| "evEbitda" \| "pfcf" | sí |  |
| `label` | string | sí |  |
| `current` | ratio \| null | sí |  |
| `benchmark` | ratio \| null | sí |  |
| `impliedPrice` | money \| null | sí |  |
| `applicable` | boolean | sí |  |

#### FairValueRange

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `low` | money | sí |  |
| `mid` | money | sí |  |
| `high` | money | sí |  |

#### DcfValuation

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `applicable` | boolean | sí |  |
| `reason` | string \| null | sí |  |
| `inputs` | DcfInputs | sí |  |
| `projection` | DcfProjectionYear[] | sí |  |
| `terminalValue` | money \| null | sí |  |
| `pvTerminal` | money \| null | sí |  |
| `tvShare` | fraction \| null | sí | Peso del valor terminal en el valor empresa |
| `enterpriseValue` | money \| null | sí |  |
| `netDebt` | money \| null | sí |  |
| `minorityInterest` | money \| null | sí |  |
| `equityValue` | money \| null | sí |  |
| `sharesOutstanding` | number \| null | sí |  |
| `perShare` | money \| null | sí |  |
| `sensitivity` | Sensitivity \| null | sí |  |
| `warnings` | string[] | sí |  |

#### DcfInputs

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `fcff0` | money \| null | sí |  |
| `growth` | fraction \| null | sí |  |
| `years` | integer \| null | sí | mín 1; máx 30 |
| `terminalGrowth` | fraction \| null | sí |  |
| `betaU` | number \| null | sí |  |
| `betaL` | number \| null | sí |  |
| `debtToEquity` | ratio \| null | sí |  |
| `taxRate` | fraction \| null | sí |  |
| `costOfEquity` | fraction \| null | sí |  |
| `costOfDebt` | fraction \| null | sí |  |
| `wacc` | fraction \| null | sí |  |
| `currency` | currency | sí |  |

#### DcfProjectionYear

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `year` | integer | sí | mín 1 |
| `fcff` | money | sí |  |
| `discountFactor` | number | sí |  |
| `pv` | money | sí |  |

#### Sensitivity

``grid[i][j]`` es el valor por acción con ``waccs[i]`` y ``growths[j]``.

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `waccs` | fraction[] | sí |  |
| `growths` | fraction[] | sí |  |
| `grid` | ((number \| null)[])[] | sí |  |

#### BankValuation

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `applicable` | boolean | sí |  |
| `justifiedPB` | ratio \| null | sí |  |
| `roe` | fraction \| null | sí |  |
| `costOfEquity` | fraction \| null | sí |  |
| `growth` | fraction \| null | sí |  |
| `impliedPrice` | money \| null | sí |  |

#### MomentumResponse

Rendimientos como fracción; r12m1 = 12 meses excluyendo el último.

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `symbol` | symbol | sí |  |
| `currency` | currency | sí |  |
| `benchmark` | string | sí |  |
| `r12m1` | fraction \| null | sí |  |
| `r6m` | fraction \| null | sí |  |
| `r3m` | fraction \| null | sí |  |
| `benchmarkR12m1` | fraction \| null | sí |  |
| `relative12m1` | fraction \| null | sí |  |
| `meta` | Meta | sí |  |

#### FactorsResponse

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `universe` | FactorUniverse | sí |  |
| `method` | string | sí |  |
| `rows` | FactorRow[] | sí |  |
| `meta` | Meta | sí |  |

#### FactorUniverse

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `id` | "mx" \| "us" \| "custom" | sí |  |
| `name` | string | sí |  |
| `size` | integer | sí | mín 0 |

#### FactorRow

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `symbol` | symbol | sí |  |
| `name` | string \| null | sí |  |
| `sector` | string \| null | sí |  |
| `scores` | FactorScores \| null | sí |  |
| `coverage` | number | sí | Fracción de métricas disponibles; mín 0; máx 1 |
| `excluded` | boolean | sí |  |
| `reason` | string \| null | sí |  |
| `checks` | FactorCheck[] | sí |  |
| `metrics` | {string: number \| null} | sí |  |

#### FactorScores

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `value` | number \| null | sí |  |
| `quality` | number \| null | sí |  |
| `momentum` | number \| null | sí |  |
| `lowVol` | number \| null | sí |  |
| `growth` | number \| null | sí |  |
| `composite` | number \| null | sí |  |

#### FactorCheck

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `id` | string | sí |  |
| `label` | string | sí |  |
| `pass` | boolean \| null | sí |  |
| `value` | number \| string \| null | sí |  |
| `threshold` | number \| string \| null | sí |  |

#### MagicResponse

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `universe` | MagicUniverse | sí |  |
| `rows` | MagicRow[] | sí |  |
| `excluded` | ExcludedSymbol[] | sí |  |
| `partial` | boolean | sí |  |
| `meta` | Meta | sí |  |

#### MagicUniverse

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `id` | "us" \| "mx" | sí |  |
| `name` | string | sí |  |
| `size` | integer | sí | mín 0 |
| `description` | string | sí |  |

#### MagicRow

Solo EBIT reportado (nunca estimado); earningsYield y returnOnCapital como fracción.

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `symbol` | symbol | sí |  |
| `name` | string \| null | sí |  |
| `sector` | string \| null | sí |  |
| `ebit` | money | sí |  |
| `enterpriseValue` | money | sí |  |
| `earningsYield` | fraction | sí |  |
| `returnOnCapital` | fraction | sí |  |
| `rankEY` | integer | sí | mín 1 |
| `rankROC` | integer | sí | mín 1 |
| `rank` | integer | sí | mín 1 |
| `currency` | currency | sí |  |
| `fiscalPeriodEnd` | date \| null | sí |  |

#### ExcludedSymbol

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `symbol` | string | sí |  |
| `reason` | string | sí |  |

#### FibrasResponse

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `rows` | FibraRow[] | sí |  |
| `cetes28` | fraction \| null | sí |  |
| `meta` | Meta | sí |  |

#### FibraRow

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `symbol` | symbol | sí |  |
| `name` | string \| null | sí |  |
| `price` | money \| null | sí |  |
| `currency` | currency | sí |  |
| `financialCurrency` | currency \| null | sí |  |
| `marketCap` | money \| null | sí |  |
| `distributionYield` | fraction \| null | sí |  |
| `capRate` | fraction \| null | sí |  |
| `navPerCbfi` | money \| null | sí |  |
| `pNav` | ratio \| null | sí |  |
| `ltv` | fraction \| null | sí | Deuda / activos totales |
| `debtToMarketCap` | ratio \| null | sí |  |
| `cashFlowYield` | fraction \| null | sí |  |
| `cashFlowBasis` | "ffo_approx" \| "ocf" \| "fcf" \| null | sí |  |
| `spreadVsCetes` | fraction \| null | sí |  |
| `signal` | "descuento" \| "en_linea" \| "prima" \| "sin_datos" | sí |  |
| `type` | "propiedades" \| "hipotecaria" \| "energia" \| "otro" | sí |  |

#### InsidersResponse

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `items` | InsiderTransaction[] | sí |  |
| `summary` | InsiderSummary | sí |  |
| `meta` | Meta | sí |  |

#### InsiderTransaction

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `date` | date \| null | sí |  |
| `insider` | string | sí |  |
| `role` | string \| null | sí |  |
| `type` | "compra" \| "venta" \| "otorgamiento" \| "ejercicio" \| "otro" | sí |  |
| `shares` | number \| null | sí |  |
| `value` | money \| null | sí |  |
| `planned10b5_1` | boolean \| null | sí |  |

#### InsiderSummary

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `openMarketBuys` | integer | sí | mín 0 |
| `openMarketSells` | integer | sí | mín 0 |

<!-- END REFERENCIA GENERADA -->
