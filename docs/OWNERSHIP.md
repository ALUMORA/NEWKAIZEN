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
| Q0 | Configuración de Vitest, Playwright, ESLint; baseline visual del legado |
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
   excluye aunque otro glob del mismo stream lo incluya. Así se resolvió el único traslape que había:
   `src/features/dev-ui/ChartsGallery.jsx` es de C2 y C1 lo excluye con
   `"!src/features/dev-ui/ChartsGallery.jsx"`.

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
| `GET /v2/events` | `routers/events.py` | B3a |
| `GET /v2/insiders/{symbol}` | `routers/insiders.py` | B3a |
| `GET /v2/valuation/{symbol}`, `GET /v2/momentum/{symbol}` | `routers/valuation.py` | B3b |
| `GET /v2/screeners/factors`, `/magic`, `/fibras` | `routers/screeners.py` | B3c |
| Las rutas v1 del backend viejo | `routers/legacy_v1.py` | O, congelado |

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
| `routers/__init__.py` | Helpers que usan los doce routers: `ERROR_RESPONSES`, `Symbols`, `SymbolPath`, `IsoDateQuery`, `parse_symbols`, `check_date_range`. La caché HTTP ya no vive aquí: ver `http_cache.py` abajo |
| `routers/legacy_v1.py` | Rutas v1 con paridad probada contra los 122 goldens. Los defectos del backend viejo se corrigen en v2, no aquí |
| `domain/__init__.py` | Helpers compartidos `_log`, `pct`, `r2`, `safe` |
| `providers/yahoo/session.py` | La sesión y `yft` que usan B2a, B2b, B3a, B3b y B3c |
| `providers/replay.py` | El gancho que usan el replay y `scripts/run_replay_backend.py` |
| `__init__.py` de `kaizen_api`, `providers`, `providers/yahoo` y `domain/screeners` | Paquetes vacíos |
| `data/.gitkeep` | Solo mantiene la carpeta |

**Lo que NO quedó congelado, a propósito:** `kaizen_api/http_cache.py` es de **B1**. Ahí viven
`CACHE_SECONDS` (los segundos de `Cache-Control` por clase de dato), `cache_control()` y
`no_store()`. Salieron de `routers/__init__.py` en M1 porque la tabla de arriba le encarga a B1
"códigos y `Cache-Control`" y no se puede entregar eso desde un archivo congelado de otro. Los
routers lo siguen importando como siempre (`from kaizen_api.routers import cache_control`, que lo
reexporta), así que B1 puede cambiar tiempos o agregar una clase de dato sin abrir el archivo de
ningún otro stream, y nadie tiene que actualizar imports. El OpenAPI no cambió ni un byte con la
mudanza.

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
  tiene. Si de verdad necesitas otro valor para una llamada que ya está en la base, es un cambio al
  set base y se pide al orquestador; el orden de la lista es lo único que manda (`top,base` daría
  la precedencia contraria).
- Al **grabar**, lo que ya existe en una capa anterior se sirve de ahí **sin tocarla** (las capas de
  abajo son de solo lectura, ni con `--refresh` se reescriben) y lo nuevo se escribe **solo en la
  última**, que se crea con su propio `index.json` y **hereda el `frozen_at` de la base**, para que
  las llamadas que dependen de "hoy" den la misma llave grabando y reproduciendo.
- Un solo set se comporta exactamente igual que antes. Los espacios y las entradas vacías se
  ignoran, y un nombre desconocido o repetido da un error claro en español.
- **Tres guardas para que nadie escriba en el set base por accidente:**
  1. Un `--set` con coma que se quedó en **una sola capa** no graba. Es el caso de
     `--set "2026-09-22,$CAPA"` con `$CAPA` sin definir: como se graba siempre en la última capa,
     eso escribiría en el set común. Sale con error en español en vez de hacerlo. Leer (replay)
     sigue tolerante, porque leer no escribe nada.
  2. Grabar con el **set base como última capa** pide `--permitir-base` (o `allow_base=True`). Lo
     normal es grabar en tu capa; tocar la base es una decisión del orquestador.
  3. Una capa que **no grabó ninguna llamada no se crea**. Hoy las rutas de fase 2 responden 501,
     así que la primera corrida de cada stream no graba nada y no deja una carpeta con un
     `index.json` vacío para commitear. En cuanto graba algo, la capa aparece con su índice
     completo. Si pones en el spec una capa que todavía no existe, el error te lo dice.

Acepta capas: `replaying()`, `recording()`, `install_replay()`, la variable `KAIZEN_REPLAY_SET`,
`scripts/run_replay_backend.py --set` y `scripts/record_fixtures.py --set`.

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

## Las pruebas que fase 2 va a cruzarse

Tres archivos de pruebas afirmaban cosas que dejan de ser ciertas en cuanto un stream implementa su
primera ruta, y ninguno es de los streams de fase 2. En M1 se hicieron **auto ajustables**, así que
nadie tiene que abrir un archivo ajeno el día que implementa algo:

- `tests/contract/test_schemas.py` ya no da por hecho que las 22 rutas responden 501. Mira el código
  de cada función: mientras levante `not_implemented` le exige el cuerpo de error del contrato; en
  cuanto deja de hacerlo, le exige lo que sí aplica, que **su router anuncie su capacidad** en
  `CAPABILITIES` (que es lo que publica `/health`). Si implementas una ruta y olvidas la capacidad,
  la prueba te lo dice con el nombre del módulo. No se pide la ruta implementada: estas pruebas
  corren sin red.
- `tests/unit/test_app.py` afirmaba la lista de capacidades completa (`== ["auth", "legacy.v1"]`).
  Ahora afirma lo que depende del legado y deja que la lista crezca.
- `tests/unit/test_auth.py` y `tests/characterization/test_replay_server.py` usaban el 501 de
  `/v2/quotes` como prueba de que la sesión había pasado. Ahora piden esa ruta con símbolos
  inválidos a propósito: la respuesta (401 sin sesión, 422 con ella) no depende de si B2a ya la
  implementó y no ejecuta la ruta, así que tampoco sale a los proveedores.

`tests/contract/` y `tests/characterization/` son de **O**. `tests/unit/*.py` (las de la app, auth y
caché) pasaron a **B1**, que es quien es dueño de los archivos que prueban; cada stream de backend
escribe las suyas en `tests/unit/<stream>/`.
