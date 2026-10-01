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
    `eodhd`, `computed`, `curated`, `damodaran`, `replay`, `treasury`, `frankfurter`, `cftc`,
    `bls`, `worldbank`, separadas por coma sin espacios (las cinco últimas llegaron en la fase 5).
  - `fallback: true` significa que se usó una fuente sustituta o un valor de referencia, y la UI
    tiene que decirlo. No existe un USD/MXN fijo de 17.5 ni una tasa libre de riesgo fija de 8.6 %
    en v2: si no hay dato real la ruta responde `503 UPSTREAM_UNAVAILABLE`.
  - En el código se arma con `kaizen_api.provenance.meta(source, as_of=None, delay_minutes=None,
    stale=False, fallback=False, notes=None)`.

## Sesión

- Con `AUTH_REQUIRED=true` todas las rutas exigen `Authorization: Bearer <token>` salvo
  `GET /health`, `POST /auth/login` y los `OPTIONS` de CORS. Con `AUTH_REQUIRED=false` (desarrollo)
  las rutas quedan abiertas; `GET /auth/me` siempre exige token. Sin la variable, el default es
  `true` en producción (`KAIZEN_ENV=production`) y `false` fuera de ella; apagarla en producción se
  puede, pero el arranque lo avisa.
- `SECRET_KEY` es obligatoria, de 32 caracteres o más y distinta de la llave de desarrollo (que
  está publicada en el repo) en producción y siempre que `AUTH_REQUIRED=true`, en cualquier
  entorno. Si no, el servidor no arranca. La llave de desarrollo solo se usa sin `AUTH_REQUIRED`.
- El token es un JWT HS256 firmado con `SECRET_KEY`, con `sub` (usuario en minúsculas), `iat`,
  `exp` (`TOKEN_TTL_HOURS`, 12 por omisión) y `ver` (`TOKEN_VERSION`). Subir `TOKEN_VERSION`
  revoca todos los tokens; quitar a alguien de `USERS` revoca los suyos.
- `USERS` es JSON `{"usuario": "scrypt$16384$8$1$<sal_hex>$<hash_hex>"}`. Se genera con
  `python scripts/hash_password.py --user <usuario> --json`, que imprime **solo** el objeto, así
  que `USERS="$(python scripts/hash_password.py --user ana --json)"` funciona tal cual. Sin
  `--json` la salida trae también el hash suelto y un encabezado, y el servidor no arranca con
  "USERS no es JSON válido". En producción cada hash se valida al arrancar: uno mal formado detiene
  el arranque en vez de dejar a ese usuario sin poder entrar nunca. Fuera de producción también se
  aceptan contraseñas en texto plano (con aviso al arrancar); en producción el servidor no arranca
  con ellas.
- Límite de tasa del login: 5 intentos por minuto por IP y 10 **fallidos** por hora por usuario
  **y por IP**. Un login correcto devuelve sus dos fichas, así que las cubetas cuentan fallas y una
  oficina detrás de una sola IP no se bloquea sola. Como las fallas se cuentan por usuario e IP,
  quien manda contraseñas malas agota solo la cubeta de su red: la dueña de la cuenta sigue
  entrando desde la suya. Desde la red que agotó la cubeta todo es 429, incluida la contraseña
  buena, para que el 429 no sirva de oráculo. Los dos valores se configuran con
  `LOGIN_RATE_LIMIT_IP_PER_MINUTE` y `LOGIN_RATE_LIMIT_USER_PER_HOUR`, y solo se pueden relajar
  fuera de producción. La llave por IP es el salto de `X-Forwarded-For` que escribió la
  infraestructura de confianza, contando desde la derecha según `TRUSTED_PROXY_HOPS` (1 por
  omisión, que es lo de Render); si la cabecera llega repetida, se unen en orden antes de contar, y
  con 0 se ignora y manda la IP del socket. Al pasarse: `429 RATE_LIMITED` con `Retry-After` en
  segundos. El `POST /login` v1 comparte el limitador pero un login correcto ahí no devuelve sus
  fichas; las rutas v1 no se montan en producción.
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
| `BAD_REQUEST` | 400 o 413 | Otra solicitud mal formada. 413 si el cuerpo pasa de 16 KB (`MAX_BODY_BYTES`), lo declare o no `Content-Length`. |
| `UNAUTHORIZED` | 401 | Falta el token, expiró o es inválido; credenciales incorrectas en el login. |
| `FORBIDDEN` | 403 | Reservado. |
| `NOT_FOUND` | 404 | Ruta inexistente o símbolo sin datos. |
| `METHOD_NOT_ALLOWED` | 405 | Método no aceptado; lleva `Allow`. |
| `RATE_LIMITED` | 429 o 503 | 429 por el límite de tasa del login; 503 si el servidor está saturado (más de `MAX_CONCURRENCY` requests en vuelo, 48 por omisión). Los dos llevan `Retry-After` y CORS. El `limit_concurrency` de uvicorn (64) queda como último recurso y ese sí contesta texto plano. |
| `UPSTREAM_UNAVAILABLE` | 502 o 503 | La fuente de datos no respondió o no hay dato real. |
| `NOT_CONFIGURED` | 503 | Falta configurar la fuente (por ejemplo `BANXICO_TOKEN`). |
| `NOT_IMPLEMENTED` | 501 | Ruta registrada que su stream todavía no implementa; `details.endpoint`. |
| `INTERNAL` | 500 | Error inesperado. El servidor lo registra con el id de request. |
| `INVALID_PARAM` | 400 | El parámetro tiene buena forma pero cae fuera del rango que admite el contrato (fase 5: plazo del forward de 0 o más de 365 días, intervalo intradía con un rango largo, ventana de fechas de más de lo permitido). `message` dice qué se admite y `details.fields` lista `{field, type}`. |

## Caché HTTP y cabeceras

`Cache-Control: private, max-age=<n>` en respuestas exitosas, por clase de dato:

| Clase | max-age (s) | Rutas |
| --- | --- | --- |
| quotes | 30 | `/v2/quotes`, `/v2/fx`, `/v2/markets/overview`, `/v2/markets/world`, `/v2/instrument/{symbol}` |
| history | 3600 | `/v2/history/{symbol}`, `/v2/panel`, `/v2/fx/history`, `/v2/momentum/{symbol}` |
| fundamentals | 21600 | `/v2/search`, `/v2/events`, `/v2/instrument/{symbol}/statements`, `/v2/instrument/{symbol}/dividends`, `/v2/valuation/{symbol}`, `/v2/insiders/{symbol}`, `/v2/assumptions` |
| macro | 3600 | `/v2/rates/mx`, `/v2/rates/mx/inpc`, `/v2/rates/rf`, `/v2/macro/us` |
| news | 600 | `/v2/news` |
| screeners | 43200 | `/v2/screeners/factors`, `/v2/screeners/magic`, `/v2/screeners/fibras` |
| reference | 86400 | Fase 5: `/v2/calendar/economic`, `/v2/macro/world`, `/v2/reference/mx`, `/v2/business/industries` |
| intraday | 60 | Fase 5: `/v2/ohlc/{symbol}` con `interval=5m` o `1h` (con 1d, 1wk o 1mo es history) |
| curves | 3600 | Fase 5: `/v2/curves`, `/v2/curves/spreads` |

Las demás rutas de la fase 5 usan las clases de siempre: macro (`/v2/money-market`,
`/v2/expectations`, `/v2/fxdesk/*`, `/v2/macro/indicators`, `/v2/reference/mx/update-factor`),
fundamentals (`/v2/events/season`, `/v2/earnings/{symbol}`, `/v2/holders/{symbol}`,
`/v2/shares/{symbol}`, `/v2/filings/{symbol}`, `/v2/funds/{symbol}`, `/v2/credit-health/{symbol}`)
y quotes (`/v2/movers`, `/v2/breadth`, `/v2/sectors`).

`/health` y `/auth/*` salen con `no-store`. Toda respuesta lleva `X-Request-ID` (se respeta el que
mande el cliente si es `[A-Za-z0-9._-]{1,64}`). Las respuestas de 1 KB o más salen con gzip si el
cliente lo acepta.

CORS: orígenes exactos de `ALLOWED_ORIGINS` más la regex `ALLOWED_ORIGIN_REGEX`. En producción,
sin configurar nada, la regex acepta solo `https://newkaizen.vercel.app`: los previews de Vercel
(`newkaizen-<rama>-<equipo>.vercel.app`) se abren con `VERCEL_TEAM_SLUG` o con una
`ALLOWED_ORIGIN_REGEX` explícita, porque la regex ancha `newkaizen-*.vercel.app` la podía cumplir
un proyecto registrado por un tercero. Fuera de producción la regex por omisión es
`^https://newkaizen(-[a-z0-9-]+)?\.vercel\.app$` y se suman `http://localhost:*` y
`http://127.0.0.1:*`. Métodos `GET, POST, OPTIONS`; cabeceras de
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
  `schemas.KNOWN_CAPABILITIES` y solo lista lo que ya funciona: con el backend v2 completo son
  más de veinte (`auth`, `quotes`, `fx`, `history`, `panel`, `panel.splits`, `rates.mx`, ...), una
  ruta con `@stub` no anuncia la suya y, con las rutas v1 montadas, se suma `legacy.v1`. El
  frontend consulta esta lista antes de pedir una ruta que el servidor quizá todavía no tiene. `providers.*.configured` indica si hay token; `ok` es `null` mientras no se
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
  `Financial Services` y `Financials` salen los dos como `Servicios financieros`, y `Materials` y
  `Basic Materials` los dos como `Materiales`); un sector sin traducción sale tal cual lo manda
  Yahoo. Como la traducción junta sectores distintos, `sector` es para mostrar y `sectorKey`, el
  sector crudo de Yahoo en inglés, es la llave para agrupar y para cruzar: es el mismo texto que
  `InstrumentResponse.sector`, que todavía sale crudo en la ficha. `industry` no tiene catálogo de
  traducción y sale en inglés. Índices, fondos, ETF, divisas y cripto no traen sector en Yahoo y
  salen con los tres en `null`: la UI los muestra como "s/d" o los agrupa por `type`, nunca les
  adivina un sector. El servidor siempre manda los tres campos; son opcionales en el contrato solo
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
  sin rellenar precios; los símbolos que no se pudieron alinear van en `dropped` con su motivo.
  Mismos cierres ajustados que `/v2/history`: un cierre anterior a un dividendo no sirve como precio
  de compra. Los rendimientos se calculan en el cliente. Para separar efecto precio y efecto tipo de
  cambio, ver "Panel en moneda nativa y en MXN" en las recetas para el cliente, más abajo.
  - `adjust` (opcional, aditivo de la fase 3, pedido F1-4; capacidad `panel.splits`): `total` por
    omisión (lo de siempre) o `splits`, cierres ajustados SOLO por splits, para quien suma el
    efectivo de los dividendos por su cuenta (el TWR del libro). El servidor deshace el ajuste por
    dividendos con la columna `Dividends` de la misma descarga de Yahoo, sin otra llamada: recorre la
    serie hacia atrás y en cada fecha ex recupera el cierre previo como `C = A / F + D` (el método de
    Yahoo es multiplicar lo anterior por `1 - D / C`). En barras diarias es exacto; en `1wk` y `1mo`
    el cierre previo es el de la barra anterior y `meta.notes` avisa que es aproximado. La respuesta
    trae `adjustment` con el ajuste aplicado (`total` o `splits`; ausente en un API anterior, que es
    `total`). `/v2/history` sigue siendo siempre `adjusted: true`.
- `GET /v2/fx?pair=USDMXN` → `FxResponse`. FIX de Banxico (`banxico_fix`) si hay token, si no Yahoo
  marcado en `meta`.
- `GET /v2/fx/history?pair=USDMXN&start=&end=` → `FxHistoryResponse`. Banxico FIX SF43718 con token,
  si no Yahoo `MXN=X` marcado. `start` y `end` son fechas reales con `start <= end`.

### Tasas y macro (B2b: `routers/rates.py` y `routers/macro.py`)

- `GET /v2/rates/mx` → `MxRatesResponse`. Ids: `target` (objetivo, SF61745), `tiie28`,
  `tiieFondeo`, `cetes28`, `cetes91`, `cetes182`, `cetes364`, `bonoM10` (si existe), `inflationYoY`,
  `coreInflationYoY`, `udi`, `fix`. Cada serie del SIE se verifica contra el endpoint de metadatos
  del SIE en una prueba antes de usarse; el 25 de septiembre de 2026 la prueba en vivo confirmó las
  doce: objetivo `SF61745`, TIIE 28 `SF43783`, TIIE de fondeo `SF331451`, CETES de la subasta
  semanal `SF43936`, `SF43939`, `SF43942` y `SF43945`, Bono M 10 años de la subasta `SF44071`,
  inflación anual del INPC `SP30578`, subyacente anual `SP74662`, UDI `SP68257` y FIX `SF43718`. Desde la fase 3 (pedidos 2
  y 3 de F2) cada renglón dice tres cosas por serie:
  - `verified`: `true` solo si la serie viene del SIE, tiene revisión humana en el catálogo
    (`verified: true` en `kaizen_api/data/banxico_series.json`) y el SIE la confirmó en las
    últimas 24 horas con su título, periodicidad y unidad. No es "hoy": la verificación se guarda un
    día, así que una serie confirmada ayer a las 10:00 cuenta como confirmada hasta hoy a las 10:00.
    Una serie del SIE que no pase ese candado no se publica (su id y la razón quedan en
    `meta.notes`), así que en la práctica `verified` equivale a `source: "banxico"` y hoy
    `verified: false` solo lo lleva el respaldo de FRED (`bonoM10` con `source: "fred"`), que nunca
    pasa por el SIE. La UI lo marca como no verificado.
  - `stale`: el último dato de ESA serie es más viejo de lo que se tolera para su periodicidad
    (`maxAgeDays` del catálogo: 5 días naturales para objetivo, TIIE, FIX y UDI; 14 a 35 para los
    CETES; 60 para el Bono M del SIE, que se subasta cada 5 a 8 semanas; 75 para la inflación, que
    es mensual y se fecha el día 1; y 70 para el Bono M mensual de FRED, en `FRED_MX_FALLBACK` de
    `domain/rates.py`). `meta.stale` es exactamente que alguna serie
    tenga `stale: true`.
  - `tenorDays`: plazo en días de los CETES (`cetes28` 28, `cetes91` 91, `cetes182` 182,
    `cetes364` 364), el mismo que acepta `/v2/rates/rf`; `null` en todas las demás series, incluida
    la TIIE. Ya no hace falta sacarlo del id ni de la etiqueta.

  El servidor siempre manda los tres campos; son opcionales en el contrato solo para que un cliente
  tolere un API desplegado antes de este cambio (ahí, sin `verified`, la serie no se da por
  verificada, y sin `stale` se usa `meta.stale`). Por eso `stale` es `boolean | null` con `null` por
  omisión: la ausencia es "sin dato", nunca "fresca".
- `GET /v2/rates/mx/inpc?start=&end=` → `InpcResponse` (ruta nueva de la fase 3, pedido F1-3;
  capacidad `rates.inpc`). Nivel mensual del INPC general, serie `SP1` del SIE (base segunda
  quincena de julio de 2018 = 100), en `monthly` como `{"AAAA-MM": nivel}` en orden cronológico.
  `start` por omisión es `2000-01-01` y `end` hoy; el mes se toma del dato que el SIE fecha el día 1.
  `meta.asOf` es el día 1 del último mes publicado y `meta.stale` se prende si tiene más de 75 días.
  Va en ruta propia y no como campo de `/v2/rates/mx` porque son cientos de meses que solo pide el
  cálculo del ISR, y `/v2/rates/mx` lo lee cada pantalla de tasas. Sin respaldo: sin token de
  Banxico responde `503 NOT_CONFIGURED`, y si el SIE no confirma la serie con el candado del
  catálogo (título, periodicidad, unidad y `verified`, en la llave `indices` de
  `kaizen_api/data/banxico_series.json`), `503 UPSTREAM_UNAVAILABLE`. Para actualizar un costo por
  inflación: factor = INPC del mes anterior a la venta entre INPC del mes de la compra.
- `GET /v2/rates/rf?start=&end=&tenorDays=28` (`tenorDays`: 28, 91, 182 o 364) →
  `RfSeriesResponse`. Rendimientos anualizados simples act/360 como fracción. El cliente convierte a
  tasa por periodo con el `tenorDays` de la RESPUESTA, no el pedido:
  `rf_d = (1 + y * T / 360)^(d / T) - 1` con `T = tenorDays`. Con Banxico es el plazo pedido; con el
  respaldo de FRED es 91, porque esa serie es a tres meses. Fuente `banxico`, o `fred_ir3tib`
  marcada como `fallback`.
- `GET /v2/macro/us` → `UsMacroResponse`. Ids: `ust3m`, `ust2y`, `ust10y`, `spread10y2y`,
  `spread10y3m`, `vix`, `dxy`, `fedFunds`.

### Mercados (B2a: `routers/markets.py`)

- `GET /v2/markets/overview` → `MarketsOverviewResponse`. Grupos `mx`, `us`, `global`, `fx`,
  `commodities`, `crypto`, más `marketStatus` de BMV y NYSE (calendario de B2a en
  `domain/market_calendar.py`).
  - `lastClose` (opcional, aditivo de la fase 3, pedido F2-7a): fecha `AAAA-MM-DD`, en la zona de
    cada bolsa, de la última jornada que ya cerró según el calendario. Con la bolsa abierta es la
    jornada anterior a hoy; en fin de semana o feriado, la última hábil. No depende de que el grupo
    traiga datos. `null` solo si no hubo jornada en los 30 días previos; ausente en un API anterior.
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
- `GET /v2/assumptions` → `AssumptionsResponse` (ruta nueva de la fase 3, pedido F4; capacidad
  `assumptions`; exige sesión como las demás rutas v2). Supuestos de mercado del archivo de
  Damodaran (`kaizen_api/data/damodaran_2026.json`), sin salir a la red: `erp` es la prima de
  riesgo de mercado que usa `/v2/valuation` cuando no se pasa `?erp=` (hoy la de mercado maduro,
  4.23 % en el vintage de enero de 2026), `matureMarketErp` la misma cifra con su nombre, `crp` la
  prima de riesgo país por país (`MX`, `US`), `source` y `sourceUrl` quién la publica y dónde,
  `vintage` (`AAAA-MM`) y `asOf` la fecha de actualización del autor. `meta.stale` se prende si el
  archivo tiene más de 400 días (ya habría un vintage nuevo). Si cambia el vintage, el optimizador y
  la valuación leen la misma cifra.

### Screeners (B3c: `routers/screeners.py`)

- `GET /v2/screeners/factors?universe=mx` (`mx`, `us` o `custom`; con `custom` se exige
  `symbols=A,B`, hasta 50, y sin `custom` no se acepta `symbols`) → `FactorsResponse`.
- `GET /v2/screeners/magic?universe=us` (`us` o `mx`) → `MagicResponse`. Solo EBIT reportado, nunca
  estimado; `partial: true` si no respondieron todas las emisoras.
  - `ebitSource` por renglón (opcional, aditivo de la fase 3, pedido F3c-2): `operating_income`
    si el EBIT es la utilidad de operación reportada, `ebit_row` si se usó el renglón "EBIT" de
    Yahoo como respaldo (puede traer partidas no operativas). La nota de `meta.notes` que lista las
    emisoras de respaldo se conserva igual. Ausente o `null` en un API anterior.
- `GET /v2/screeners/fibras?extra=A,B` (hasta 20 extra) → `FibrasResponse`. `signal` es
  `descuento`, `en_linea`, `prima` o `sin_datos` (descripción del precio contra el NAV, no una
  recomendación). `ltv` es deuda entre activos totales.
  - `notes` por renglón (opcional, aditivo de la fase 3, pedido F3c-2): una oración por motivo,
    sin el símbolo, que nombra las cifras de ESE renglón que van en `null` y por qué (estados
    ajenos o viejos, deuda que no cuadra, otra moneda de reporte, historia de pagos ilegible o sin
    pagos, sin tasa de referencia, sin precio, sin NAV, o el proveedor no respondió). Toda cifra en
    `null` queda nombrada en alguna nota; lo que ningún motivo explica sale como "Yahoo no publica
    el dato con que se calcula". Vacía si no falta nada. `meta.notes` conserva los mismos avisos con
    la clave de la FIBRA al frente.
  - `rate` (opcional, aditivo de la fase 3, pedido F3c-3): `{ value, asOf, source, fallback,
    tenorDays }`, la misma tasa de `cetes28` con la fecha de SU dato (`meta.asOf` es la de los
    precios), `source` `banxico` o `fred`, `fallback: true` si no son CETES de Banxico y
    `tenorDays` con el plazo de la serie que de verdad se usó (91 con el respaldo de FRED, aunque el
    campo se llame `cetes28`). `null` cuando `cetes28` es `null`. `cetes28` se conserva.

### Fase 5 (M5): rutas registradas en `@stub`

Las registró M5 el 1 de octubre de 2026 con su modelo, su clase de caché y sus parámetros ya
validados: un parámetro con forma o valor fuera de la lista responde 422 `VALIDATION_ERROR`, una
regla de rango del contrato responde 400 `INVALID_PARAM` y un símbolo mal formado 400
`INVALID_SYMBOL`, todo **antes** del `501 NOT_IMPLEMENTED`. Cada stream borra `@stub` al
implementar su ruta y anuncia la capacidad indicada. La spec de cada una (fuentes, pruebas de
respuesta conocida y riesgos) está en `docs/overhaul/specs/fase5-spec.md`.

Centro de tasas (V5TS: `routers/curves.py`):

- `GET /v2/curves?country=mx|us&compare=1w,1m,1y` → `CurvesResponse` (curves; capacidad `curves`).
  `country` es obligatorio. Cada nodo trae su propia fecha (`asOf`) porque en México cada plazo
  cambia solo el día de su subasta; un `N/E` del SIE sale `value: null`, nunca 0.
- `GET /v2/curves/spreads?history=1y|5y` → `CurveSpreadsResponse` (curves; `curves`). `spreadBp` en
  pb y `asOfMismatch` si las dos tasas están a más de 7 días de distancia.
- `GET /v2/money-market` → `MoneyMarketResponse` (macro; `moneyMarket`). Solo las series que no
  trae `/v2/rates/mx`; los cambios semanal y mensual de las de México van en `mxChanges` por id.
- `GET /v2/expectations` → `ExpectationsResponse` (macro; `expectations`). Encuesta de Banxico
  (`median: null` y `verified: false` si la serie no está verificada), tasa real y forwards.

Tipo de cambio (V5FX: `routers/fxdesk.py`):

- `GET /v2/fxdesk/monitor?years=1|3|5|10` → `FxMonitorResponse` (macro; `fxdesk`). Cambios en
  fracción y en centavos, volatilidad realizada anualizada y posicionamiento CFTC o `null`.
- `GET /v2/fxdesk/crosses` → `FxCrossesResponse` (macro; `fxdesk.crosses`). Cada renglón dice su
  fuente, quién publica (`banxico`, `ecb` o `mezcla`) y si es respaldo.
- `GET /v2/fxdesk/fix?date=YYYY-MM-DD&rule=fecha|dof` → `FixLookupResponse` (macro; `fxdesk.fix`).
  `date` es obligatoria; antes del 12 de noviembre de 1991 responde 400 `INVALID_PARAM`. Una fecha
  futura no es error: `fixDate` y `value` salen `null` y `explanation` lo dice.
- `GET /v2/fxdesk/fix-table?start&end&rule&monthEnd=true|false` → `FixTableResponse` (macro;
  `fxdesk.fix`). `start` y `end` son obligatorias; más de 3 años responde 400 `INVALID_PARAM`.
  Con `monthEnd=true` (por omisión `false`), `rows` trae solo el cierre de cada mes; `monthEnds`
  (cierre y promedio de cada mes) viene siempre.
- `GET /v2/fxdesk/forward?days=30,91,182,365|date=YYYY-MM-DD&mxn=tiie|cetes|fondeo&usd=ust|sofr`
  → `FxForwardResponse` (macro; `fxdesk.forward`). Un plazo de 0 días o de más de 365, o una fecha
  que no caiga entre mañana y 365 días, responde 400 `INVALID_PARAM`; `days` y `date` juntos, 422.

Economía (V5EC: `routers/economy.py`):

- `GET /v2/calendar/economic?start&end&country=mx,us` → `EconomicCalendarResponse` (reference;
  `calendar.economic`). Una ventana de más de 90 días responde 400 `INVALID_PARAM`. `consensus`
  siempre es `null` y `coverage` dice hasta dónde llega cada calendario.
- `GET /v2/macro/indicators?country=mx|us&years=5|10|max` → `MacroIndicatorsResponse` (macro;
  `macro.indicators`). `kind: rate` cambia en pb (`changeYoYBp`) y `kind: level` en fracción
  (`changeYoY`); el modelo rechaza la combinación contraria. Cada indicador trae su `unit`.
- `GET /v2/macro/world?countries=MEX,USA,BRA&indicators=gdpUsd,gdpGrowth,inflation,debt` →
  `MacroWorldResponse` (reference; `macro.world`). Hasta 10 países ISO alfa-3; Banco Mundial
  CC BY 4.0.

Agenda y fondos (V5PF: `routers/events.py` y `routers/funds.py`):

- `GET /v2/events` gana dos aditivos opcionales: `EventItem.estimateLow` y `estimateHigh`, y
  `EventsResponse.dividendSummary` (capacidad `events.dividends` cuando lo mande). `amount` conserva
  su significado. Lo que responde hoy sigue siendo válido.
- `GET /v2/events/season?universe=mx|us&days=30|60|90` → `EventsSeasonResponse` (fundamentals;
  `events.season`). `missing` lista las emisoras de la muestra que no respondieron.
- `GET /v2/funds/{symbol}` → `FundResponse` (fundamentals; `funds`). Fondo sin datos: 404
  `NOT_FOUND` con `details.reason`.

Ficha de la emisora (V5FI: `routers/company.py`):

- `GET /v2/earnings/{symbol}` → `EarningsResponse` (fundamentals; `earnings`). Sin precios objetivo
  ni calificaciones de analistas.
- `GET /v2/holders/{symbol}` → `HoldersResponse` (fundamentals; `holders`).
- `GET /v2/shares/{symbol}?start=YYYY-MM-DD` → `SharesResponse` (fundamentals; `shares`). Un
  `start` futuro responde 400 `INVALID_PARAM`.
- `GET /v2/filings/{symbol}?forms=10-K,10-Q,8-K,20-F,6-K&limit=1..50` → `FilingsResponse`
  (fundamentals; `filings`). Los tipos válidos son `10-K`, `10-Q`, `8-K`, `20-F`, `6-K`, `SC 13D`,
  `SC 13G` y `DEF 14A`. Emisora sin CIK ni ADR: 404 `NOT_FOUND` con `details.reason`.

Gráfica técnica (V5TC: `routers/ohlc.py`):

- `GET /v2/ohlc/{symbol}?range=1d|5d|1mo|6mo|1y|5y|max&interval=5m|1h|1d|1wk|1mo&compare=^MXX|^GSPC|SPY`
  → `OhlcResponse` (intraday con 5m o 1h, history con lo demás; `ohlc`, y `ohlc.intraday` cuando
  sirva 5m y 1h). Rangos por intervalo: 5m con 1d, 5d o 1mo; 1h hasta 1y; 1d con todos; 1wk desde
  1mo; 1mo desde 6mo. Otra combinación responde 400 `INVALID_PARAM`. `t` es fecha con 1d, 1wk y
  1mo e instante con zona con 5m y 1h, y el modelo lo revisa. `adjustment` siempre es `splits`.

Movimientos (V5MK: `routers/movers.py`):

- `GET /v2/movers?market=mx|us&kind=gainers|losers|active&limit=10..50` → `MoversResponse`
  (quotes; `movers`).
- `GET /v2/breadth?market=mx|us` → `BreadthResponse` (quotes; `breadth`). Sobre una muestra curada.
- `GET /v2/sectors?market=mx|us` → `SectorsResponse` (quotes; `sectors`).

Empresas (V5EM: `routers/business.py`):

- `GET /v2/reference/mx` → `ReferenceMxResponse` (reference; `reference.mx`).
- `GET /v2/reference/mx/update-factor?from=AAAA-MM&to=AAAA-MM` → `UpdateFactorResponse` (macro;
  `reference.mx`). Los dos meses son obligatorios y `from` no puede ser posterior a `to` (422). Mes
  sin INPC publicado: 404 `NOT_FOUND` con `details.reason`.
- `GET /v2/business/industries?market=US|EM` → `IndustriesResponse` (reference;
  `business.industries`). La prima de mercado y la prima país siguen en `/v2/assumptions`.
- `GET /v2/credit-health/{symbol}?years=3|5` → `CreditHealthResponse` (fundamentals;
  `creditHealth`). `applicable: false` lleva `reason` y `years` vacío. Sin letras de calificación.

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

Antes de la receta, lo que el panel NO da: sus cierres están ajustados por splits y dividendos
(rendimiento total), igual que `/v2/history`. Todo cierre anterior a una fecha ex dividendo queda
por debajo del precio al que de verdad cotizó la emisora. Con las grabaciones del 22 de septiembre
de 2026, el primer cierre de AAPL en la ventana de un año sale 255.14 dólares en el panel contra
256.08 de mercado, por los 1.06 dólares de dividendos que pagó en esa ventana. El último cierre no
tiene ajuste por delante y ese sí es el de mercado. De ahí salen dos usos distintos:

- **Una posición desde su compra.** `price0` y `fx0` son el precio y el tipo de cambio del
  movimiento, como dice `docs/metodologia/portafolio.md`, nunca los del panel: el cierre ajustado
  metería los dividendos al efecto precio, y el tipo de cambio del movimiento es el FIX de esa
  fecha que la persona pudo corregir. Si el movimiento no trae tipo de cambio, la separación sale
  `s/d`; el panel no lo suple. Del panel salen solo `price1` y `fx1`, de la última fecha común. Los
  dividendos cobrados son efectivo aparte, como en la metodología.
- **Una ventana de fechas** (el último año, por ejemplo). Ahí `price0` y `price1` salen del panel
  nativo, y el efecto "precio" es rendimiento total en la moneda original: ya trae los dividendos
  de la ventana como si se hubieran reinvertido. La UI lo nombra así, y no le suma los dividendos
  cobrados en esas fechas, porque los contaría dos veces.

La receta:

1. La moneda de cada posición sale del `currency` de `/v2/quotes`.
2. `GET /v2/panel?symbols=<todas>&ccy=MXN` da los precios en pesos, que es lo que ya usa el riesgo.
   Revisa `dropped`: hoy el servidor solo publica el tipo de cambio USDMXN, así que una emisora en
   euros, libras, dólares canadienses o cualquier otra moneda que no sea peso ni dólar sale ahí,
   con su motivo, y no en `prices`. Esa posición queda con la separación en `s/d` y el motivo del
   servidor a la vista, y no se pide su panel nativo: sin precio en pesos no hay tipo de cambio que
   sacar.
3. `GET /v2/panel?symbols=<las emisoras en dólares>&ccy=native`, una sola llamada con las emisoras
   en dólares. Pedir `ccy=native` con monedas mezcladas responde `400 BAD_REQUEST` a propósito,
   porque un panel tiene un solo `currency`. Las emisoras en pesos no necesitan el panel nativo: en
   MXN su precio es el mismo.
4. Cruza por fecha y usa solo las fechas que estén en los dos paneles. No coinciden: cada panel es
   un INNER JOIN de sus propios símbolos, y la conversión omite las fechas sin tipo de cambio
   cercano.
5. El tipo de cambio de cada fecha es `X = precio en MXN / precio nativo`. Es exactamente el que usó
   el servidor (FIX de Banxico o Yahoo, con el mismo relleno de hasta 3 días), así que para esto no
   hace falta `/v2/fx/history`, que sirve para mostrar la serie del tipo de cambio pero no reproduce
   la conversión fecha por fecha. Como el ajuste por dividendos multiplica igual el precio nativo y
   el precio en pesos, el cociente no se ve afectado.
6. La separación la hace `pnlDecomposition` de `src/lib/finance/fx.js`. `price1` es el cierre del
   panel nativo en la última fecha común y `fx1` el del paso 5 en esa fecha. `price0` y `fx0` son
   los del movimiento para una posición, o los de la primera fecha común para una ventana. Para las
   posiciones en pesos, `fx0` y `fx1` van en 1. El efecto precio va a tipo de cambio inicial y el
   efecto cambiario a precio final, y los dos suman exactamente `q × P₁ × X₁ − q × P₀ × X₀` con esos
   mismos cuatro datos.

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
| `code` | "VALIDATION_ERROR" \| "INVALID_SYMBOL" \| "BAD_REQUEST" \| "UNAUTHORIZED" \| "FORBIDDEN" \| "NOT_FOUND" \| "METHOD_NOT_ALLOWED" \| "RATE_LIMITED" \| "UPSTREAM_UNAVAILABLE" \| "NOT_CONFIGURED" \| "NOT_IMPLEMENTED" \| "INTERNAL" \| "INVALID_PARAM" | sí |  |
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
| `sector` | string \| null | no | Sector de Yahoo en español de México (el mismo que usan los screeners), para mostrar; null si Yahoo no lo trae. Para agrupar o cruzar usa sectorKey: la traducción junta sectores distintos |
| `sectorKey` | string \| null | no | Sector crudo de Yahoo, en inglés y sin traducir (el mismo texto que InstrumentResponse.sector); null si Yahoo no lo trae |
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
| `adjustment` | "total" \| "splits" | no | total = cierres ajustados por splits y dividendos (rendimiento total, lo de siempre); splits = solo por splits, pedido con ?adjust=splits. Ausente en un API anterior a la fase 3: total |
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
| `seriesId` | string | sí | Id de la serie en su fuente: el SIE de Banxico (p. ej. SF61745) o FRED cuando el renglón es un respaldo |
| `source` | string | sí |  |
| `previous` | number \| null | sí |  |
| `changeBp` | number \| null | sí |  |
| `verified` | boolean | no | true solo si la serie es del SIE, tiene revisión humana en el catálogo y el SIE la confirmó en las últimas 24 horas (la verificación se guarda un día); los respaldos de FRED van en false |
| `stale` | boolean \| null | no | El último dato de ESTA serie es más viejo de lo que se tolera para su periodicidad. El servidor siempre lo manda; null o ausente es un API anterior a la fase 3 y el cliente usa meta.stale |
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
| `lastClose` | date \| null | no | Fecha, en la zona de la bolsa, de la última jornada que ya cerró (con la bolsa abierta es la anterior a hoy). Sale del calendario; null si no hay jornada en los últimos 30 días o el API es anterior a la fase 3 |

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
| `dividendSummary` | DividendSummaryItem[] \| null | no | Resumen de dividendos por símbolo (fase 5); null o ausente en un API anterior |
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
| `estimateLow` | number \| null | no | Estimado más bajo de UPA de los analistas (solo earnings); null o ausente si no viene |
| `estimateHigh` | number \| null | no | Estimado más alto de UPA de los analistas (solo earnings); null o ausente si no viene |

#### DividendSummaryItem

Lo último que pagó la emisora. El monto futuro no se conoce: la UI lo etiqueta "último pagado".

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `symbol` | symbol | sí |  |
| `currency` | currency \| null | sí |  |
| `lastPaidAmount` | money \| null | sí | Monto por acción del último dividendo pagado |
| `lastPaidDate` | date \| null | sí |  |
| `frequency` | "mensual" \| "trimestral" \| "semestral" \| "anual" \| "irregular" \| null | sí |  |
| `paidMonths` | integer[] | sí | Meses (1 a 12) en que suele pagar |

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
| `ebitSource` | "operating_income" \| "ebit_row" \| null | no | De dónde salió el EBIT: operating_income es la utilidad de operación reportada (lo normal); ebit_row es el renglón EBIT de Yahoo, de respaldo, que puede traer partidas no operativas. null o ausente es un API anterior a la fase 3 |

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
| `rate` | FibrasRate \| null | no | cetes28 con su fecha, fuente, si es sustituta y su plazo. null si no hay tasa (el diferencial va en s/d) o si el API es anterior a la fase 3 |
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
| `notes` | string[] | no | Motivo de cada cifra en s/d de este renglón, en español y sin el símbolo; vacía si no falta nada. meta.notes conserva los mismos avisos por FIBRA con su clave |

#### FibrasRate

La tasa de referencia del diferencial, con su procedencia (``cetes28`` es solo el número).

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `value` | number | sí | El mismo número que cetes28 |
| `asOf` | date \| null | sí | Fecha del dato de la tasa; meta.asOf es la de los precios |
| `source` | "banxico" \| "fred" \| null | sí | banxico = CETES del SIE; fred = serie interbancaria de la OCDE en FRED (respaldo); null si el servidor no lo dijo |
| `fallback` | boolean | sí | true si no son CETES de Banxico: la tasa es sustituta y hay que decirlo |
| `tenorDays` | integer \| null | sí | Plazo en días de la serie que de verdad se usó (91 con el respaldo de FRED), no el pedido; mín 1 |

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

#### AssumptionsResponse

Supuestos de mercado del API (Damodaran), para que el cliente no copie constantes.

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `erp` | number | sí | Prima de riesgo de mercado por omisión del CAPM del API: la misma que usa /v2/valuation sin ?erp=. Hoy es la de mercado maduro |
| `matureMarketErp` | number | sí | Prima de mercado maduro de Damodaran: la implícita de EE. UU. menos su prima país |
| `crp` | {"MX" \| "US": fraction} | sí | Prima de riesgo país por país del archivo (MX, US). /v2/valuation la suma a erp con lambda 1 |
| `source` | string | sí | Quién publica los datos y de qué vintage, en texto para la UI |
| `sourceUrl` | string /^https?:/// | sí | Página de donde se descargó el archivo |
| `vintage` | string /^\d{4}-\d{2}$/ | sí | Vintage del archivo, AAAA-MM |
| `asOf` | date | sí | Fecha de actualización de los datos según el autor |
| `meta` | Meta | sí |  |

#### InpcResponse

Nivel mensual del INPC general (SIE ``SP1``), para actualizar costos fiscales.

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `seriesId` | string | sí | Id de la serie en el SIE de Banxico (SP1) |
| `base` | string \| null | sí | Periodo base del índice (= 100) |
| `monthly` | {string: number} | sí | {"AAAA-MM": nivel}, en orden cronológico; un mes sin dato publicado no aparece |
| `meta` | Meta | sí |  |

#### CurvesResponse

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `country` | "mx" \| "us" | sí |  |
| `nodes` | CurveNode[] | sí |  |
| `compare` | {"1w" \| "1m" \| "1y": CurvePoint[]} | sí | La curva de hace 1 semana, 1 mes o 1 año, si se pidió |
| `real` | RealCurveNode[] | sí |  |
| `breakeven` | BreakevenNode[] | sí |  |
| `meta` | Meta | sí |  |

#### CurveNode

Un plazo de la curva. En México cada plazo cambia solo en su subasta: por eso trae su fecha.

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `tenorDays` | integer | sí | Plazo en días al vencimiento; mín 1 |
| `label` | string | sí | Plazo legible: '28 días', '10 años' |
| `value` | fraction \| null | sí | Rendimiento; null si la fuente no publicó (N/E), la UI dice s/d |
| `asOf` | date \| null | sí |  |
| `seriesId` | string | sí |  |
| `instrument` | "cetes" \| "bonoM" \| "udibono" \| "ust" | sí |  |

#### CurvePoint

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `tenorDays` | integer | sí | mín 1 |
| `value` | fraction \| null | sí |  |
| `asOf` | date \| null | sí |  |

#### RealCurveNode

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `tenorDays` | integer | sí | mín 1 |
| `value` | fraction \| null | sí | Rendimiento real (Udibono o curva real del Tesoro) |
| `asOf` | date \| null | sí |  |
| `seriesId` | string | sí |  |

#### BreakevenNode

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `tenorDays` | integer | sí | mín 1 |
| `value` | fraction \| null | sí | Inflación implícita de Fisher: (1 + nominal)/(1 + real) - 1 |
| `simpleBp` | number \| null | sí | Diferencia simple nominal menos real, en pb |
| `nominalAsOf` | date \| null | sí |  |
| `realAsOf` | date \| null | sí |  |
| `dateGapDays` | integer \| null | sí | Días entre la fecha del nominal y la del real; mín 0 |

#### CurveSpreadsResponse

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `rows` | CurveSpreadRow[] | sí |  |
| `history10y` | SpreadHistory | sí |  |
| `meta` | Meta | sí |  |

#### CurveSpreadRow

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `tenorYears` | integer | sí | mín 1 |
| `mxSeriesId` | string | sí |  |
| `usSeriesId` | string | sí |  |
| `mx` | fraction \| null | sí |  |
| `us` | fraction \| null | sí |  |
| `spreadBp` | number \| null | sí | México menos EE. UU. en pb |
| `mxAsOf` | date \| null | sí |  |
| `usAsOf` | date \| null | sí |  |
| `dateGapDays` | integer \| null | sí | mín 0 |
| `asOfMismatch` | boolean | sí | true si dateGapDays > 7: las dos tasas no son del mismo día |

#### SpreadHistory

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `dates` | date[] | sí |  |
| `valuesBp` | (number \| null)[] | sí | Diferencial a 10 años en pb; null si falta un lado |

#### MoneyMarketResponse

Solo las series que /v2/rates/mx no trae, más los cambios semanal y mensual de las que sí.

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `rows` | MoneyMarketRow[] | sí |  |
| `mxChanges` | MxRateChange[] | sí |  |
| `meta` | Meta | sí |  |

#### MoneyMarketRow

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `id` | "tiie91" \| "tiie182" \| "dff" \| "sofr" \| "ust1m" \| "ust3m" \| "ust6m" \| "ust1y" | sí |  |
| `label` | string | sí |  |
| `country` | "MX" \| "US" | sí |  |
| `value` | fraction \| null | sí |  |
| `convention` | "act/360 simple" \| "overnight" \| "cmt base bono" | sí |  |
| `asOf` | date \| null | sí |  |
| `change1dBp` | number \| null | sí |  |
| `change1wBp` | number \| null | sí |  |
| `change1mBp` | number \| null | sí |  |
| `seriesId` | string | sí |  |
| `source` | source | sí | Fuente o lista separada por comas |
| `stale` | boolean | sí |  |

#### MxRateChange

Cambios semanal y mensual de una serie que ya publica /v2/rates/mx (la UI une por id).

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `id` | "target" \| "tiie28" \| "tiieFondeo" \| "cetes28" \| "cetes91" \| "cetes182" \| "cetes364" \| "bonoM10" \| "inflationYoY" \| "coreInflationYoY" \| "udi" \| "fix" | sí |  |
| `change1wBp` | number \| null | sí |  |
| `change1mBp` | number \| null | sí |  |

#### ExpectationsResponse

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `survey` | ExpectationsSurvey | sí |  |
| `realRates` | RealRates | sí |  |
| `impliedForwards` | ImpliedForwards | sí |  |
| `meta` | Meta | sí |  |

#### ExpectationsSurvey

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `surveyDate` | date \| null | sí | Fecha del periodo en el SIE, siempre día 01 |
| `yearT` | integer \| null | sí | Año de surveyDate |
| `items` | SurveyItem[] | sí |  |

#### SurveyItem

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `id` | "inflationT" \| "inflationT1" \| "gdpT" \| "fxT" \| "fxT1" | sí |  |
| `label` | string | sí |  |
| `year` | integer \| null | sí | Año al que se refiere la expectativa |
| `mean` | number \| null | sí | Fracción si unit=fraction; pesos por dólar si unit=mxnPerUsd |
| `median` | number \| null | sí | null si su serie no está verificada (la UI dice s/d) |
| `unit` | "fraction" \| "mxnPerUsd" | sí |  |
| `seriesIdMean` | string \| null | sí |  |
| `seriesIdMedian` | string \| null | sí |  |
| `verified` | boolean | sí |  |

#### RealRates

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `cetes28` | fraction \| null | sí |  |
| `observedInflation` | fraction \| null | sí | Inflación anual observada (SIE SP30578) |
| `exPost` | fraction \| null | sí | (1 + cetes28)/(1 + observedInflation) - 1 |
| `expectedInflation` | fraction \| null | sí | Mediana de la encuesta para el año en curso |
| `exAnte` | fraction \| null | sí |  |

#### ImpliedForwards

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `mx` | MxForward[] | sí |  |
| `us` | UsForward[] | sí |  |

#### MxForward

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `fromDays` | integer | sí | mín 0 |
| `toDays` | integer | sí | mín 1 |
| `rate` | fraction \| null | sí | Forward implícito act/360 simple |
| `vsTargetBp` | number \| null | sí | Contra la tasa objetivo de Banxico, en pb |

#### UsForward

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `fromDays` | integer | sí | mín 0 |
| `toDays` | integer | sí | mín 1 |
| `rate` | fraction \| null | sí |  |
| `vsDffBp` | number \| null | sí | Contra la tasa de fondos federales efectiva, en pb |
| `note` | string | sí |  |

#### FxMonitorResponse

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `pair` | "USDMXN" | sí |  |
| `spot` | FxSpot | sí |  |
| `range52w` | FxRange52w | sí |  |
| `changes` | PeriodChanges | sí |  |
| `changesCents` | FxChangesCents | sí |  |
| `realizedVol` | RealizedVol | sí |  |
| `monthly` | FxMonthly[] | sí |  |
| `histogram` | HistogramBin[] | sí |  |
| `series` | DatedSeries | sí |  |
| `cot` | CotPosition \| null | sí |  |
| `meta` | Meta | sí |  |

#### FxSpot

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `value` | number | sí | Pesos por dólar |
| `asOf` | date | sí |  |
| `source` | "banxico" | sí | Siempre el FIX de Banxico (SF43718) |

#### FxRange52w

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `low` | number \| null | sí |  |
| `high` | number \| null | sí |  |
| `percentile` | fraction \| null | sí | Fracción de observaciones menores o iguales al actual |

#### PeriodChanges

Cambios como fracción en día, semana, mes, año corrido y 12 meses; null si no hay base.

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `d1` | fraction \| null | sí |  |
| `w1` | fraction \| null | sí |  |
| `m1` | fraction \| null | sí |  |
| `ytd` | fraction \| null | sí |  |
| `y1` | fraction \| null | sí |  |

#### FxChangesCents

Los mismos cambios que ``PeriodChanges`` pero en centavos de peso.

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `d1` | number \| null | sí |  |
| `w1` | number \| null | sí |  |
| `m1` | number \| null | sí |  |
| `ytd` | number \| null | sí |  |
| `y1` | number \| null | sí |  |

#### RealizedVol

Volatilidad realizada anualizada (raíz de 252) como fracción.

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `d20` | fraction \| null | sí |  |
| `d60` | fraction \| null | sí |  |
| `d250` | fraction \| null | sí |  |

#### FxMonthly

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `month` | string /^\d{4}-(0[1-9]\|1[0-2])$/ | sí |  |
| `average` | number \| null | sí |  |
| `min` | number \| null | sí |  |
| `max` | number \| null | sí |  |
| `last` | number \| null | sí |  |

#### HistogramBin

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `low` | fraction | sí |  |
| `high` | fraction | sí |  |
| `count` | integer | sí | mín 0 |

#### DatedSeries

Serie por fecha: ``dates`` y ``values`` con la misma longitud; un hueco va como null.

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `dates` | date[] | sí |  |
| `values` | (number \| null)[] | sí |  |

#### CotPosition

Posicionamiento CFTC del peso en CME (contrato 095741), en contratos.

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `reportDate` | date | sí |  |
| `openInterest` | number \| null | sí |  |
| `nonCommercialNet` | number \| null | sí |  |
| `nonCommercialNetChange` | number \| null | sí |  |
| `leveragedNet` | number \| null | sí |  |
| `assetManagerNet` | number \| null | sí |  |

#### FxCrossesResponse

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `rows` | FxCrossRow[] | sí |  |
| `meta` | Meta | sí |  |

#### FxCrossRow

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `pair` | "EURMXN" \| "JPYMXN" \| "GBPMXN" \| "CNYMXN" \| "CADMXN" \| "BRLMXN" \| "COPMXN" \| "CLPMXN" \| "ARSMXN" \| "PENMXN" | sí |  |
| `value` | number \| null | sí | Pesos por unidad de la otra moneda |
| `asOf` | date \| null | sí |  |
| `change1d` | fraction \| null | sí |  |
| `change1y` | fraction \| null | sí |  |
| `source` | "banxico" \| "frankfurter" | sí |  |
| `provider` | "banxico" \| "ecb" \| "mezcla" | sí | Quién publica el dato: Banxico, el BCE o una mezcla de bancos centrales |
| `fallback` | boolean | sí |  |

#### FixLookupResponse

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `date` | date | sí | La fecha pedida |
| `rule` | "fecha" \| "dof" | sí |  |
| `fixDate` | date \| null | sí | Fecha en que se determinó el FIX usado; null si aún no hay FIX |
| `value` | number \| null | sí |  |
| `dofPublicationDate` | date \| null | sí | Solo con rule=dof: fecha del DOF que lo publicó |
| `explanation` | string | sí | Qué FIX se usó y por qué, en español |
| `meta` | Meta | sí |  |

#### FixTableResponse

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `rule` | "fecha" \| "dof" | sí |  |
| `rows` | FixRow[] | sí |  |
| `monthEnds` | FixMonthEnd[] | sí |  |
| `meta` | Meta | sí |  |

#### FixRow

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `date` | date | sí |  |
| `fixDate` | date \| null | sí |  |
| `value` | number \| null | sí |  |

#### FixMonthEnd

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `month` | string /^\d{4}-(0[1-9]\|1[0-2])$/ | sí |  |
| `fixDate` | date \| null | sí |  |
| `value` | number \| null | sí |  |
| `average` | number \| null | sí | Promedio del FIX del mes |

#### FxForwardResponse

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `spot` | ForwardSpot | sí |  |
| `rows` | ForwardRow[] | sí |  |
| `meta` | Meta | sí |  |

#### ForwardSpot

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `value` | number | sí |  |
| `asOf` | date | sí |  |

#### ForwardRow

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `days` | integer | sí | mín 1; máx 365 |
| `date` | date | sí |  |
| `iMxn` | fraction \| null | sí |  |
| `iUsd` | fraction \| null | sí |  |
| `iMxnSeries` | string | sí |  |
| `iUsdSeries` | string | sí |  |
| `iMxnConvention` | "act/360 simple" \| "overnight plano" | sí |  |
| `iUsdConvention` | "cmt convertida x360/365" \| "overnight plano" | sí |  |
| `forward` | number \| null | sí | Precio teórico por paridad de tasas, sin margen bancario |
| `pointsPips` | number \| null | sí |  |
| `carryAnnual` | fraction \| null | sí | (forward/spot - 1) x 360/días |

#### EconomicCalendarResponse

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `events` | EconomicEvent[] | sí |  |
| `coverage` | CalendarCoverage | sí |  |
| `nextDecisions` | NextDecisions | sí |  |
| `meta` | Meta | sí |  |

#### EconomicEvent

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `id` | string | sí |  |
| `country` | "MX" \| "US" | sí |  |
| `kind` | "decision" \| "minutes" \| "release" \| "report" | sí |  |
| `title` | string | sí |  |
| `period` | string \| null | sí | Periodo que reporta: 'sep 2026' |
| `date` | date | sí |  |
| `timeLocal` | string \| null | sí | HH:MM en America/Mexico_City |
| `datetimeUtc` | instant \| null | sí |  |
| `source` | "curated" \| "bls" | sí |  |
| `seriesId` | string \| null | sí |  |
| `unit` | "fraction" \| "index" \| "thousandsPersons" \| null | sí |  |
| `previous` | number \| null | sí |  |
| `actual` | number \| null | sí |  |
| `consensus` | null | sí | Siempre null: las fuentes de consenso son de pago |

#### CalendarCoverage

Hasta qué fecha cubre cada calendario; nada se inventa después de ella.

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `banxicoUntil` | date \| null | sí |  |
| `fomcUntil` | date \| null | sí |  |
| `inegiUntil` | date \| null | sí |  |
| `blsUntil` | date \| null | sí |  |

#### NextDecisions

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `banxico` | NextDecision \| null | sí |  |
| `fed` | NextDecision \| null | sí |  |

#### NextDecision

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `date` | date | sí |  |
| `daysLeft` | integer | sí | mín 0 |

#### MacroIndicatorsResponse

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `country` | "mx" \| "us" | sí |  |
| `indicators` | MacroIndicator[] | sí |  |
| `meta` | Meta | sí |  |

#### MacroIndicator

Un indicador. ``kind`` rate cambia en pb (``changeYoYBp``); level cambia en fracción (``changeYoY``).

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `id` | "inflation" \| "coreInflation" \| "pceCore" \| "unemployment" \| "payrolls" \| "gdpReal" \| "gdpGrowth" \| "remittances" \| "reserves" \| "wti" | sí |  |
| `label` | string | sí |  |
| `kind` | "rate" \| "level" | sí |  |
| `unit` | "fraction" \| "index" \| "thousandsPersons" \| "usdMillions" \| "mxnMillions2018" \| "usdBillionsChained2017" \| "usdPerBarrel" | sí |  |
| `frequency` | "monthly" \| "quarterly" \| "weekly" \| "daily" | sí |  |
| `last` | MacroObservation \| null | sí |  |
| `previous` | MacroObservation \| null | sí |  |
| `changeYoY` | fraction \| null | sí | Solo kind level: cambio anual como fracción |
| `changeYoYBp` | number \| null | sí | Solo kind rate: cambio anual en pb |
| `history` | DatedSeries | sí |  |
| `seriesId` | string | sí |  |
| `source` | source | sí | Fuente o lista separada por comas |
| `fallback` | boolean | sí |  |
| `stale` | boolean | sí |  |
| `nextRelease` | date \| null | sí |  |

#### MacroObservation

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `date` | date | sí |  |
| `value` | number | sí |  |

#### MacroWorldResponse

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `rows` | MacroWorldRow[] | sí |  |
| `meta` | Meta | sí |  |

#### MacroWorldRow

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `country` | currency | sí | ISO 3166-1 alfa-3 (MEX, USA, BRA) |
| `name` | string | sí |  |
| `indicator` | "gdpUsd" \| "gdpGrowth" \| "inflation" \| "debt" | sí |  |
| `unit` | "usd" \| "fraction" | sí |  |
| `year` | integer \| null | sí |  |
| `value` | number \| null | sí |  |

#### EventsSeasonResponse

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `universe` | "mx" \| "us" | sí |  |
| `events` | SeasonEvent[] | sí |  |
| `missing` | DroppedSymbol[] | sí | Emisoras de la muestra que no respondieron, con su motivo |
| `universeSize` | integer | sí | mín 0 |
| `meta` | Meta | sí |  |

#### SeasonEvent

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `symbol` | symbol | sí |  |
| `name` | string \| null | sí |  |
| `date` | date | sí |  |
| `kind` | "earnings" | sí |  |
| `estimateAvg` | number \| null | sí |  |
| `estimateLow` | number \| null | sí |  |
| `estimateHigh` | number \| null | sí |  |
| `currency` | currency \| null | sí |  |

#### EarningsResponse

Resultados contra estimado. Sin precios objetivo ni calificaciones de analistas.

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `symbol` | symbol | sí |  |
| `currency` | currency \| null | sí |  |
| `history` | EarningsQuarter[] | sí |  |
| `estimates` | EarningsEstimate[] | sí |  |
| `trend` | EpsTrend[] | sí |  |
| `revisions` | EpsRevisions[] | sí |  |
| `nextReport` | NextReport \| null | sí |  |
| `meta` | Meta | sí |  |

#### EarningsQuarter

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `quarterEnd` | date | sí |  |
| `reportDate` | date \| null | sí |  |
| `epsActual` | number \| null | sí |  |
| `epsEstimate` | number \| null | sí |  |
| `surprise` | fraction \| null | sí | (real - estimado)/\|estimado\| |
| `reactionNextDay` | fraction \| null | sí | Cierre del día hábil siguiente contra el previo al reporte |

#### EarningsEstimate

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `period` | "0q" \| "+1q" \| "0y" \| "+1y" | sí |  |
| `epsAvg` | number \| null | sí |  |
| `epsLow` | number \| null | sí |  |
| `epsHigh` | number \| null | sí |  |
| `analysts` | integer \| null | sí | mín 0 |
| `revenueAvg` | number \| null | sí |  |
| `growth` | fraction \| null | sí |  |

#### EpsTrend

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `period` | "0q" \| "+1q" \| "0y" \| "+1y" | sí |  |
| `current` | number \| null | sí |  |
| `d7` | number \| null | sí |  |
| `d30` | number \| null | sí |  |
| `d60` | number \| null | sí |  |
| `d90` | number \| null | sí |  |

#### EpsRevisions

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `period` | "0q" \| "+1q" \| "0y" \| "+1y" | sí |  |
| `up7` | integer \| null | sí | mín 0 |
| `down7` | integer \| null | sí | mín 0 |
| `up30` | integer \| null | sí | mín 0 |
| `down30` | integer \| null | sí | mín 0 |

#### NextReport

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `date` | date | sí |  |
| `epsAvg` | number \| null | sí |  |
| `analysts` | integer \| null | sí | mín 0 |

#### HoldersResponse

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `insidersPct` | fraction \| null | sí |  |
| `institutionsPct` | fraction \| null | sí |  |
| `institutionsFloatPct` | fraction \| null | sí |  |
| `institutionsCount` | integer \| null | sí | mín 0 |
| `institutions` | Holder[] | sí |  |
| `funds` | Holder[] | sí |  |
| `coverageNote` | string \| null | sí | Qué cuenta y qué no la tenencia (p. ej. emisoras de la BMV) |
| `meta` | Meta | sí |  |

#### Holder

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `holder` | string | sí |  |
| `pct` | fraction \| null | sí |  |
| `shares` | number \| null | sí |  |
| `value` | money \| null | sí |  |
| `currency` | currency \| null | sí |  |
| `dateReported` | date \| null | sí |  |
| `pctChange` | fraction \| null | sí |  |

#### SharesResponse

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `symbol` | symbol | sí |  |
| `sharesOutstanding` | DatedSeries | sí |  |
| `change` | fraction \| null | sí | Último contra primero de la serie |
| `splits` | SplitEvent[] | sí |  |
| `meta` | Meta | sí |  |

#### SplitEvent

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `date` | date | sí |  |
| `ratio` | number | sí | Acciones nuevas por cada vieja: 4.0 es un split de 4 a 1; mayor que 0 |

#### FilingsResponse

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `symbol` | symbol | sí |  |
| `cik` | string /^\d{10}$/ | sí | CIK de la SEC con 10 dígitos |
| `viaAdr` | string \| null | sí | Ticker del ADR por el que se encontró a la emisora mexicana |
| `filings` | Filing[] | sí |  |
| `meta` | Meta | sí |  |

#### Filing

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `form` | string | sí |  |
| `formLabel` | string | sí | Qué es ese documento, en español |
| `filedAt` | date | sí |  |
| `reportDate` | date \| null | sí |  |
| `items` | FilingItem[] | sí |  |
| `url` | string /^https:/// | sí |  |

#### FilingItem

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `code` | string | sí | Código del evento del 8-K, por ejemplo 2.02 |
| `label` | string | sí | Su nombre en español; s/d si el código no se conoce |

#### OhlcResponse

Velas ajustadas solo por splits (como ``PanelResponse`` con adjustment=splits).

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `symbol` | symbol | sí |  |
| `currency` | currency \| null | sí |  |
| `interval` | "5m" \| "1h" \| "1d" \| "1wk" \| "1mo" | sí |  |
| `timezone` | string \| null | sí | Zona de la bolsa, por ejemplo America/Mexico_City |
| `adjustment` | "splits" | sí | Siempre splits: las velas no se ajustan por dividendos |
| `bars` | OhlcBar[] | sí |  |
| `compare` | OhlcCompare \| null | sí |  |
| `high52w` | number \| null | sí |  |
| `low52w` | number \| null | sí |  |
| `meta` | Meta | sí |  |

#### OhlcBar

Una vela. ``t`` es fecha en 1d, 1wk y 1mo, e instante con zona en 5m y 1h.

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `t` | date o instant | sí |  |
| `o` | number | sí |  |
| `h` | number | sí |  |
| `l` | number | sí |  |
| `c` | number | sí |  |
| `v` | number \| null | sí | Volumen; null si la fuente no lo trae (índices) |

#### OhlcCompare

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `symbol` | "^MXX" \| "^GSPC" \| "SPY" | sí |  |
| `points` | OhlcPoint[] | sí |  |

#### OhlcPoint

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `t` | date o instant | sí |  |
| `c` | number | sí |  |

#### MoversResponse

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `market` | "us" \| "mx" | sí |  |
| `kind` | "gainers" \| "losers" \| "active" | sí |  |
| `rows` | MoverRow[] | sí |  |
| `excluded` | ExcludedSymbol[] | sí |  |
| `meta` | Meta | sí |  |

#### MoverRow

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `symbol` | symbol | sí |  |
| `name` | string \| null | sí |  |
| `price` | money \| null | sí |  |
| `currency` | currency \| null | sí |  |
| `change` | money \| null | sí |  |
| `changePct` | fraction \| null | sí |  |
| `volume` | number \| null | sí |  |
| `avgVolume3m` | number \| null | sí |  |
| `relVolume` | number \| null | sí | Volumen del día entre el promedio de 3 meses |
| `marketCap` | money \| null | sí |  |
| `high52w` | money \| null | sí |  |
| `low52w` | money \| null | sí |  |
| `note` | string \| null | sí | Aviso descriptivo, por ejemplo un cambio atípico |

#### BreadthResponse

Amplitud de una muestra curada de emisoras, no de todo el mercado.

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `market` | "us" \| "mx" | sí |  |
| `universe` | "curado" | sí |  |
| `universeSize` | integer | sí | mín 0 |
| `up` | integer | sí | mín 0 |
| `down` | integer | sí | mín 0 |
| `unchanged` | integer | sí | mín 0 |
| `upDownRatio` | number \| null | sí |  |
| `pctAbove200d` | fraction \| null | sí |  |
| `newHighs52w` | integer | sí | mín 0 |
| `newLows52w` | integer | sí | mín 0 |
| `meta` | Meta | sí |  |

#### SectorsResponse

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `market` | "us" \| "mx" | sí |  |
| `rows` | SectorRow[] | sí |  |
| `meta` | Meta | sí |  |

#### SectorRow

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `sector` | string | sí | Nombre del sector en español |
| `etf` | symbol \| null | sí | ETF sectorial SPDR en EE. UU.; null en México |
| `changes` | PeriodChanges | sí |  |
| `members` | SectorMember[] \| null | sí | En México, las emisoras que promedia el sector |

#### SectorMember

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `symbol` | symbol | sí |  |
| `name` | string \| null | sí |  |
| `changes` | PeriodChanges | sí |  |

#### FundResponse

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `symbol` | symbol | sí |  |
| `mappedFrom` | string \| null | sí | Clave del SIC que se mapeó a este fondo (IVVPESO.MX a IVV) |
| `name` | string \| null | sí |  |
| `family` | string \| null | sí |  |
| `category` | string \| null | sí |  |
| `legalType` | string \| null | sí |  |
| `expenseRatio` | fraction \| null | sí |  |
| `totalNetAssets` | number \| null | sí |  |
| `totalNetAssetsUnit` | "usdMillions" \| null | sí |  |
| `turnover` | fraction \| null | sí |  |
| `assetClasses` | FundAssetClasses | sí |  |
| `sectors` | FundSector[] | sí |  |
| `topHoldings` | FundHolding[] | sí |  |
| `coverage` | FundCoverage | sí |  |
| `meta` | Meta | sí |  |

#### FundAssetClasses

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `stock` | fraction \| null | sí |  |
| `bond` | fraction \| null | sí |  |
| `cash` | fraction \| null | sí |  |
| `other` | fraction \| null | sí |  |

#### FundSector

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `sector` | string | sí | Sector en español |
| `weight` | fraction | sí |  |

#### FundHolding

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `symbol` | string \| null | sí |  |
| `name` | string \| null | sí |  |
| `weight` | fraction | sí |  |

#### FundCoverage

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `topHoldingsWeight` | fraction \| null | sí | Cuánto del fondo suman las posiciones publicadas |

#### ReferenceMxResponse

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `uma` | UmaValue[] | sí |  |
| `minimumWage` | MinimumWage[] | sí |  |
| `surchargeMonthly` | SurchargeRate[] | sí |  |
| `udi` | UdiValue \| null | sí |  |
| `meta` | Meta | sí |  |

#### UmaValue

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `year` | integer | sí |  |
| `daily` | money | sí |  |
| `monthly` | money | sí |  |
| `annual` | money | sí |  |
| `validFrom` | date | sí |  |
| `sourceUrl` | string /^https?:/// | sí |  |

#### MinimumWage

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `year` | integer | sí |  |
| `general` | money | sí |  |
| `border` | number | sí | Zona Libre de la Frontera Norte |
| `validFrom` | date | sí |  |
| `sourceUrl` | string /^https?:/// | sí |  |

#### SurchargeRate

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `year` | integer | sí |  |
| `rate` | number | sí | Tasa mensual de recargos |
| `law` | string | sí | Ley de Ingresos que la fija |
| `sourceUrl` | string /^https?:/// | sí |  |

#### UdiValue

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `value` | number | sí |  |
| `asOf` | date | sí |  |

#### UpdateFactorResponse

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `inpcFrom` | InpcPoint | sí |  |
| `inpcTo` | InpcPoint | sí |  |
| `factorRaw` | number | sí | INPC final entre INPC inicial, sin truncar |
| `factor` | number | sí | Truncado al diezmilésimo y nunca menor a 1; mín 1 |
| `floorApplied` | boolean | sí | true si factorRaw era menor a 1 y se publicó 1 |
| `meta` | Meta | sí |  |

#### InpcPoint

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `month` | string /^\d{4}-(0[1-9]\|1[0-2])$/ | sí |  |
| `value` | number | sí |  |

#### IndustriesResponse

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `market` | "US" \| "EM" | sí |  |
| `vintage` | string | sí | Vintage del archivo de Damodaran |
| `statutoryTaxRate` | {"MX" \| "US": fraction} | sí |  |
| `industries` | Industry[] | sí |  |
| `meta` | Meta | sí |  |

#### Industry

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `sector` | string \| null | sí |  |
| `industry` | string | sí |  |
| `betaU` | number \| null | sí | Beta desapalancada |
| `evEbitda` | ratio \| null | sí |  |
| `roic` | fraction \| null | sí |  |
| `costOfDebtUsd` | fraction \| null | sí |  |
| `waccUsd` | fraction \| null | sí |  |
| `de` | ratio \| null | sí | Deuda entre capital |

#### CreditHealthResponse

Razones de salud financiera, sin letras de calificación.

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `symbol` | symbol | sí |  |
| `currency` | currency \| null | sí |  |
| `applicable` | boolean | sí |  |
| `reason` | string \| null | sí | Por qué no aplica (bancos y aseguradoras) |
| `years` | CreditHealthYear[] | sí |  |
| `inputsMissing` | MissingInput[] | sí |  |
| `meta` | Meta | sí |  |

#### CreditHealthYear

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `fiscalYear` | integer | sí |  |
| `altmanZEm` | number \| null | sí | Z de Altman para emergentes; null si falta un insumo |
| `netDebtToEbitda` | ratio \| null | sí |  |
| `interestCoverage` | ratio \| null | sí |  |
| `currentRatio` | ratio \| null | sí |  |
| `quickRatio` | ratio \| null | sí |  |
| `dso` | number \| null | sí | Días de cobro |
| `dpo` | number \| null | sí | Días de pago |

#### MissingInput

| Campo | Tipo | Requerido | Notas |
| --- | --- | --- | --- |
| `fiscalYear` | integer | sí |  |
| `field` | string | sí |  |

<!-- END REFERENCIA GENERADA -->
