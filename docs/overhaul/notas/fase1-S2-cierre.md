# Fase 1, S2 (resultado final, cierre del 22 de septiembre de 2026)

## Resumen

Cerré los tres defectos menores que sí son míos con 4 commits nuevos encima de los 10 que ya estaban (14 en total sobre d1ef9e1, ningún commit wip, nada empujado, nada anterior a 464cd79 reescrito). Los tres los reproduje primero, cada uno con prueba que falla antes y pasa después: con git stash de src/lib/format.js y src/lib/storage.js quedan 7 failed | 148 passed en esos dos archivos, y con el arreglo 155 de 155.

DEFECTO 1 (falso positivo de legacyChangedSinceMigration). Reproducido con el storage vacío: load() guarda la foto con momentum_screener: null y, en cuanto el Workspace legado se monta, escribe "AAPL, MSFT, GOOGL, AMZN, META, NVDA, TSLA, JPM, V, WMT, CEMEXCPO.MX, WALMEX.MX, AMXL.MX, FEMSAUBD.MX" (App.legacy.jsx linea 1078, efecto que vive en el Workspace y no en la tab del screener), así que changed quedaba ['momentum_screener'] para siempre. Arreglo en src/lib/storage.js: isLegacyDefaultValue(key, value) y, en legacyChangedSinceMigration(), una llave cuya huella guardada es null y cuyo valor de hoy es exactamente el del legado por defecto ya no cuenta. Cubre el screener (lo compara ya normalizado, así que da igual que el legado lo escriba con espacios después de la coma) y el portafolio de ejemplo (misma firma que usa legacyExample). Lo comprobé además en el navegador de verdad, no solo en node: en /portafolio/riesgo importé src/lib/storage.js, llamé load() (foto con los tres nulls), navegué de cliente a /mercados para que se montara el legado, y ahí quedó escrito el screener por defecto con legacyChangedSinceMigration() devolviendo changed: []. Cuatro pruebas nuevas, incluyendo las dos que vigilan que una lista que la persona sí cambió siga contando y que el filtro solo aplique a una llave que no existía al migrar.

DEFECTO 2 (fmtDateTime y fmtRelative corrían un día las fechas sin hora). Reproducido: fmtDate('2024-02-29') daba '29 feb 2024' pero fmtDateTime('2024-02-29') daba '28 feb 2024, 18:00' y fmtRelative daba '28 feb 2024'; igual con 2026-09-19, 2026-01-01 y 2025-12-31. Arreglo en src/lib/format.js: asDateOnly() reconoce la cadena YYYY-MM-DD sin hora; fmtDateTime la dibuja como fecha de calendario (no tiene hora que mostrar y así los tres formateadores coinciden) y fmtRelative la ancla a las 00:00 de CDMX con cdmxStartOfDay(), que arma el instante en UTC y lo corrige con el desfase que reporta la zona. Ahora fmtRelative('2026-09-22', now 20:00Z) da 'hace 14 h' en vez de 'hace 20 h'. Los instantes completos no cambian (fmtDateTime('2026-09-19T14:05:00Z') sigue dando '19 sep 2026, 08:05') y la validación estricta sigue igual ('2026-02-31' es s/d en los tres). Corregí de paso una aserción vieja que codificaba el error ('2026-02-28' esperaba '27 feb 2026, 18:00').

DEFECTO 3 (exportJSON entregaba un respaldo vacío en modo solo lectura). Reproducido con kaizen:v2 = {v:3,...}: exportJSON() devolvía el sobre con v: 2 y data vacío, 0 portafolios, sin rastro de los datos reales. Arreglo: en modo solo lectura exportJSON() ya no exporta el estado en memoria, sino el texto que de verdad está guardado, con su propia versión en el sobre (v: 3). Esta build lo rechaza al importarlo, que es lo correcto, y una más nueva sí lo entiende. Si los datos de la versión nueva desaparecieran entre la carga y la exportación, lanza con el mensaje de FUTURE_VERSION_ERROR en vez de inventar un respaldo. Dos pruebas nuevas.

DEFECTO 4 (dist-e2e y eslint, de Q0). Confirmado otra vez en este árbol: con dist-e2e presente el lint da 158 problems (155 errors, 3 warnings); con rm -rf dist-e2e antes, 3 problems (0 errors). No es mío (eslint.config.js es de Q0) y sigue escrito en docs/requests/S2.md punto 8.

DEFECTO 5 (MSFT y AMZN en el set de replay, de R0). Afiné el diagnóstico y con eso corrijo lo que yo mismo había escrito antes: no es que los símbolos falten, están a medias. En tests/fixtures/recorded/2026-09-22/index.json, AAPL, WALMEX.MX y CEMEXCPO.MX tienen de 9 a 12 llamadas grabadas, mientras que MSFT, AMZN y GOOGL solo tienen tres (balance_sheet, income_stmt e info): les falta financials, cashflow, history y news, que es exactamente lo que pide /stock/<sym> y /chart/<sym>. Quedó escrito con nombres de llave en docs/requests/S2.md punto 11 para que R0 lo grabe sin adivinar.

DEFECTO 6 (guiones largos del legado). De acuerdo con el reviewer en las dos partes: es real y no se toca en esta fase porque mueve píxeles y rompe la compuerta visual. Sigue escrito en docs/requests/S2.md punto 10.

MIRADA EN VIVO (backend de replay en 8102 + vite en 5202, Playwright a 1440x900 y 390x844, abrí las 4 capturas). /mercados dibuja el Panorama de Mercados con datos reales del set: S&P 500 7,765.82 (+0.01%), NASDAQ 27,235.91 (+0.42%), DJIA 51,835.06 (−0.41%), IPC MX 63,688.67 (+0.24%), USD/MXN 17.2970, oro 4,357.10/oz, WTI 91.28/bbl, bitcoin 86,047, Resumen Mañanero del martes 22 de septiembre de 2026 con sentimiento Cauteloso, "Backend OK" y Bono M 10Y 9.16% en la barra lateral. Clic en Sharpe Optimizer: URL a /herramientas/optimizador, título a "Optimizador · Kaizen", history sube exactamente 1, la tarjeta se dibuja bien (Principal (5), 1A/5A/10A con 5A activo, Ejecutar Optimización), recargar conserva la tab y Atrás regresa a /mercados con el título de Mercados. Lo mismo en móvil con las pastillas de abajo. Una cosa que me llamó la atención en las capturas y que fui a verificar en vez de reportarla de oído: /mercados se ve oscuro y el optimizador claro, pero NO es un cambio de tema. Medí data-theme en las cuatro situaciones (carga directa de cada ruta, después del clic y después de Atrás) y siempre es "light", y muestreando píxeles de los dos PNG la barra lateral es el mismo verde oscuro (17,37,28) en ambos; lo que cambia es el fondo del contenido (7,16,11 en el panel de Noticias contra 243,242,236 en el optimizador), que es diseño del legado. Los únicos requests con error son los 4 HTTP 500 de R0 (/stock/MSFT, /stock/AMZN, /chart/MSFT, /chart/AMZN) con sus 14 console.error por ancho. Maté los dos servidores: 8102, 5202 y 5203 quedaron libres y dist-e2e borrado.

## Commits

- `7543cae fix: la app legada manda el token de la sesión en todos sus requests de datos y un 401 cierra la sesión`
- `594a28a fix: safeNext rechaza caracteres de control, diagonales invertidas y destinos de otro origen`
- `b3cea6c feat: la URL sigue a la tab del legado con un solo mapeo ruta ↔ tab en src/app`
- `67ca29b fix: Query ya no reintenta encima del arranque en frío del cliente`
- `46224b8 fix: una fecha de calendario imposible se muestra como s/d en vez de correrse de mes`
- `c4d481d fix: unos datos de versión más nueva no se pisan y la migración deja su huella para detectar divergencia`
- `42e1d00 docs: pedido a F1 sobre la divergencia entre las llaves viejas y el estado v2`
- `7746029 fix: safeNext también rechaza el destino de otro sitio que aparece al normalizar los segmentos de punto`
- `97e58fd fix: un instante ISO con fecha de calendario imposible también se muestra como s/d`
- `2ce3256 docs: queda escrito que el legado dibuja guiones largos y por qué no se corrige en esta fase`
- `d9dbfea fix: una fecha sola se dibuja igual con o sin hora y ya no se corre un día`
- `c15c69a fix: lo que el legado escribe al montarse ya no se reporta como divergencia`
- `d686c68 fix: el respaldo con datos de una versión más nueva trae los datos reales, no un archivo vacío`
- `df3756e docs: pedido a R0 con las llamadas que le faltan al set de replay para MSFT, AMZN y GOOGL`

## Compuertas

- **npm run lint (con rm -rf dist-e2e antes)**
  ✖ 3 problems (0 errors, 3 warnings). Los 3 son react-hooks/exhaustive-deps heredados de src/legacy/App.legacy.jsx (líneas 1128, 1196 y 1879) y ya estaban en el App.jsx original. Con dist-e2e presente da ✖ 158 problems (155 errors, 3 warnings): confirmado en este árbol, es el defecto de eslint.config.js que le toca a Q0.
- **npm run typecheck**
  tsc -p jsconfig.check.json, exit 0, sin salida.
- **npm run test**
  18 archivos, 373 pruebas en verde (venía de 365). Las 8 nuevas son 2 de fechas solas en format.test.js y 6 en storage.test.js (2 de exportar en solo lectura, 4 del ruido del legado). Comprobación de que fallan antes: con git stash de src/lib/format.js y src/lib/storage.js, vitest sobre esos dos archivos da 7 failed | 148 passed, con estos errores reales: expected '27 feb 2026, 18:00' to be '28 feb 2026', expected '28 feb 2024, 18:00' to be '29 feb 2024', expected 'hace 20 h' to be 'hace 14 h', expected 2 to be 3 (la v del respaldo), expected [Function] to throw an error, expected ['momentum_screener'] to deeply equal [] y expected ['momentum_portfolios'] to deeply equal [].
- **npm run build && npm run bundle**
  Build en 185 ms. Primera carga JS 106.63 kB gzip (index-TLc0SSHu.js, 338,450 bytes) contra un presupuesto de 180 kB, 59 % usado. CSS inicial 14.80 kB gzip. Diferidos 47.86 kB gzip: App.legacy 45.41, LoginPage 2.28, chart-line 0.17. Sin .map. El hash del entry no cambió porque format.js y storage.js todavía no los importa ninguna página y el bundler los sacude.
- **grep -c Investments dist/assets/*.js**
  0 en los 4 archivos (index, App.legacy, LoginPage, chart-line). kaizen_authed y AUTH_QUOTES también dan 0 en los 4.
- **E2E_BASELINE_PORT=5202 npm run e2e:baseline**
  16 passed (35.0 s), sin actualizar capturas. git status --short quedó vacío después de correrlo: el legado sigue pixel a pixel igual, ninguna de las 16 referencias se regeneró.
- **E2E_PORT=5203 npm run e2e**
  75 passed, 1 skipped (1.5 min), igual que en la ronda anterior. El skip es el de siempre: cerrar sesión desde el legado en móvil, donde el legado esconde su barra lateral abajo de 768 px.
- **node scripts/check-ownership.mjs S2**
  ✓ S2 (ws/S2): 77 archivo(s), todos dentro de su propiedad. exit 0
- **Mirada en vivo: .venv/bin/python scripts/run_replay_backend.py --port 8102 + VITE_API_URL=http://127.0.0.1:8102 VITE_SKIP_LOGIN=true npm run dev -- --port 5202 --strictPort, capturas con Playwright a 1440x900 y 390x844**
  4 capturas abiertas y descritas. Datos reales del set 2026-09-22. URL, título, history +1, recarga y Atrás correctos en los dos anchos. Sonda del defecto 1 en el navegador: en /portafolio/riesgo, load() deja la foto en {portfolios:null, portfolio:null, screener:null}; tras navegar de cliente a /mercados el legado escribe momentum_screener con su lista por defecto y legacyChangedSinceMigration() devuelve {known:true, changed:[]}. Tema verificado con data-theme y con muestreo de píxeles: 'light' en las cuatro situaciones, barra lateral (17,37,28) en las dos rutas. Únicos errores: 4 HTTP 500 del set (ReplayMiss, pendiente de R0) con 14 console.error por ancho. Los dos servidores muertos, 8102/5202/5203 libres.

## Pendientes

- R0: al set de replay 2026-09-22 le faltan llamadas de MSFT, AMZN y GOOGL. No es que los símbolos no estén: tienen solo balance_sheet, income_stmt e info, mientras que AAPL, WALMEX.MX y CEMEXCPO.MX tienen de 9 a 12 llamadas. Falta financials, cashflow, history y news, que es justo lo que piden /stock/<sym> y /chart/<sym>: por eso salen 4 HTTP 500 (ReplayMiss yf:MSFT:financials, yf:MSFT:history y compañía) y 14 console.error por ancho en cualquier revisión en vivo, y el portafolio de ejemplo del legado se queda en Cargando. Grabarlas con scripts/record_fixtures.py deja limpia toda revisión; no hay que tocar el legado. Detalle con nombres de llave en docs/requests/S2.md punto 11.
- C3: el legado dibuja 85 guiones em (76 en texto visible) y usa '—' como marcador de dato faltante donde el contrato pide 's/d'. No se corrige en esta fase porque mueve píxeles y rompe la compuerta visual; va cuando C3 reemplace el Resumen Mañanero y la barra superior. Escrito en docs/requests/S2.md punto 10. El código nuevo cumple: 0 guiones em en src/app, src/features, src/lib, src/components e index.html.
- Q0: eslint.config.js no ignora dist-e2e, así que después de npm run e2e el lint revisa código minificado y da 155 errores. Mientras otro track no lo agregue, hay que correr rm -rf dist-e2e antes de npm run lint, o lint antes de e2e. Escrito en docs/requests/S2.md punto 8.
- O: .gitignore atrapa .env.example con el patrón .env.*; sigue hecho con git add -f. Falta agregar !.env.example (docs/requests/S2.md punto 1).
- Q0: la sonda del webServer del baseline en playwright.config.js todavía pide /src/App.jsx, que ya no existe. Vite contesta 200 con index.html y el baseline funciona, pero la sonda ya no precalienta el módulo legado. Propuesta: /src/legacy/App.legacy.jsx.
- Despliegue: el build ya no trae la contraseña fija. No publicar el frontend en Vercel antes de que Render tenga el backend v2 con POST /auth/login, porque contra el backend viejo nadie puede entrar.
- C1: siguen vivas dos instancias de useTheme (ThemeSync en AppRoot y el Workspace legado). Coinciden al cargar (medí data-theme='light' en las cuatro situaciones de la revisión en vivo) pero no comparten el estado del botón de tema. UiProvider debería ser el dueño único.
- El legado en móvil no tiene control para cerrar sesión (esconde la barra lateral abajo de 768 px). Es de antes de S2 y por eso el e2e de logout se salta en móvil.
- En móvil (390x844) el ticker de la barra superior del legado se encima con la pastilla de la tab actual (se ve 'Noticias25' en /mercados y 'DXY' tapado por 'Sharpe' en el optimizador). Es del legado, no es regresión: el baseline quedó idéntico píxel a píxel. Se arregla cuando C3 reemplace la barra superior.
- Nada de la app llama todavía a storage.load(), así que la migración a kaizen:v2 recién correrá cuando F1 o F5 usen useStore o usePortfolios. Hasta entonces el legado sigue escribiendo momentum_* y esas llaves nunca se borran. Se nota en el build: el hash del chunk de entrada no cambió aunque storage.js y format.js sí, porque todavía nadie los importa.
- F1 tiene que decidir qué hacer cuando legacyChangedSinceMigration() reporte cambios: volver a importar de la app vieja o retirar las tabs legadas que leen esas llaves. Está en docs/requests/S2.md punto 9, junto con la advertencia de que si el valor por defecto del legado cambia hay que mover LEGACY_DEFAULT_SCREENER y LEGACY_DEFAULT_POSITIONS con él o vuelve el falso positivo.
- Sobre el defecto 7 del review original: S2 no re-migra automáticamente, a propósito. Solo deja cómo detectar la divergencia.
- exportJSON() ahora puede lanzar, en un solo caso: modo solo lectura y los datos de la versión nueva desaparecidos entre la carga y la exportación. Quien ponga el botón de 'Descargar respaldo' (F5) tiene que envolverlo en try/catch y mostrar el mensaje de getStorageError().

## Notas para los siguientes streams

# Entrega completa de S2 (esqueleto del frontend), rama ws/S2

El legado se ve exactamente igual que antes: pasa el baseline sin actualizar ninguna captura (16 de 16).

## RUTAS Y FEATURES

- Cada área tiene `src/features/<área>/routes.jsx` que exporta
  `routes = [{ path: route(PATHS.x), element, handle: { title, public?, legacy?, description? } }]`.
- `src/app/router.jsx` las importa estáticamente. No edites router.jsx.
- `path` es relativo. Siempre usa las constantes y helpers de `src/app/paths.js`: `PATHS`, `route()`,
  `pathInstrument(symbol)`, `pathCompare(symbols)`, `pathLearnTerm(term)`, `pathLogin(next)`, `safeNext(next)`.
- `handle.title` pone el título de la pestaña ("Riesgo · Kaizen"). `handle.public: true` saca la ruta de
  RequireAuth. `handle.legacy: true` marca una ruta que monta el legado y esconde ahí el aviso de
  "Servidor sin actualizar".
- Páginas lazy dentro de un objeto, si no falla react-refresh en lint:
  `const Pages = { Risk: lazy(() => import('./pages/RiskPage.jsx')) }` y luego `element: <Pages.Risk />`.
  RootLayout pone el Suspense.
- Rutas nuevas sin feature todavía usan `<ComingSoon/>`, que lee `handle.title` y `handle.description`.
- dev-ui (C1): `src/features/dev-ui/routes.jsx` existe con `routes = []`; el router lo registra solo con `import.meta.env.DEV`.
- Shell (C3): `src/app/shell/AppShell.jsx` es un `<Outlet/>` de paso alrededor de toda ruta privada. Reemplázalo en su lugar.

### Rutas que todavía montan el legado

Ya NO se escribe `<LegacyPage tab="..."/>` a mano en los routes.jsx. Se usa:

    import { legacyRoute } from '../../app/legacyRoute.jsx'
    legacyRoute(PATHS.portfolio, { title: 'Mi portafolio' })

`legacyRoute(path, handle)` saca la tab del mapeo único de `src/app/legacyTabs.js` y marca `legacy: true`.
Si la ruta no tiene tab en ese mapeo, truena al construir el router (es a propósito).

`src/app/legacyTabs.js` es la ÚNICA fuente del mapeo, en los dos sentidos:

    news → /mercados            portfolio → /portafolio
    analytics → /herramientas/backtest    optimize → /herramientas/optimizador
    screener → /screener        analisis → /investigar
    fibras → /screener/fibras   magic → /screener/formula-magica

Exporta `LEGACY_TAB_PATHS`, `LEGACY_TABS`, `legacyPathForTab(tab)` y `legacyTabForPath(path)`.

**Para migrar una ruta**: cambia `legacyRoute(PATHS.x, { title })` por
`{ path: route(PATHS.x), element: <Pages.X />, handle: { title } }` (sin `legacy: true`). Deja la entrada
en `LEGACY_TAB_PATHS`: así, mientras el legado siga montado en otras rutas, su barra lateral sigue
llevando a la ruta correcta y ahora cae en tu página nueva. El mapeo completo se borra junto con
`src/legacy` en M3.

**La URL sigue a la tab.** Si la persona cambia de tab dentro del legado, `LegacyPage` navega con push a la
ruta de esa tab: cambia la URL y el título, recargar conserva la tab y Atrás regresa. El legado solo tiene
una prop nueva, `onTabChange(tab)`, junto a `initialTab`. No hay ciclos: si la tab que avisa el legado ya es
la de la ruta actual, no se navega, y el Workspace no se vuelve a montar al cambiar de ruta (mismo
componente en la misma posición, solo cambia de tab). Comprobado en vivo: history.length sube exactamente 1
por cambio de tab, en los dos anchos.

- API del host legado: `LegacyWorkspaceHost({ tab, apiBase, onLogout, onTabChange })` en `src/legacy/App.legacy.jsx`.

## API Y SESIÓN

- Usa `import { getQuotes, getHistory, … } from 'src/lib/api/endpoints.js'` (todo async, todo acepta `{ signal }`).
- Con TanStack Query: `useQuery(quotesQuery(['AAPL','WALMEX.MX']))`,
  `useQuery(historyQuery('NAFTRAC.MX', { range:'5y', interval:'1wk', ccy:'MXN' }))`. Las queryKeys y STALE_TIME
  están en `queries.js`.
- **Reintentos.** `shouldRetry` de `queries.js` devuelve false para cancelaciones (AbortError), 4xx,
  LEGACY_SERVER, `isColdStartError(error)` y cualquier `status === 0`. Motivo: `apiFetch` ya reintenta el
  arranque en frío 5 veces durante 67 s (COLD_START_DELAYS_MS suma 67000), y antes Query volvía a correr todo
  el ciclo, o sea unos 140 s de spinner antes del error. Queda un solo reintento para un 5xx del API ya
  despierto. No le pongas `retry` propio a una query salvo que sepas por qué.
- Errores: `ApiError { status, code, message (en español, se puede mostrar tal cual), details, retryAfter, fromApi }`.
  `status 0` es red o timeout (code NETWORK_ERROR / TIMEOUT). LEGACY_SERVER significa que el servidor todavía
  sirve el API v1.
- Los endpoints esperan al sondeo de `/health`. Contra un servidor viejo lanzan LEGACY_SERVER, salvo history,
  quotes, FX y rf cuando `VITE_ALLOW_LEGACY=true` (adaptadores en `legacy.js`: history regresa con `dates:null` y
  `meta.notes ['alineación aproximada']`, rf regresa como serie constante con `fallback:true`).
- Bajo nivel: `apiFetch(path, { method, body, query, signal, timeoutMs, auth, retryColdStart })`.
- Estado del servidor: `useCapabilities()` → `{ status: 'probing'|'waking'|'ready'|'legacy'|'down', apiVersion,
  authRequired, capabilities:Set, providers }`, y `hasCapability('history.dates')`.
- Siempre dibuja `meta.asOf`, `meta.source`, `meta.fallback` y `meta.notes`: el contrato obliga a decir de dónde
  salió el dato.

### authorizedFetch (para código que necesita la Response cruda)

`authorizedFetch(input, init)` en `src/lib/api/client.js` es `fetch()` con la misma política de sesión que
`apiFetch`, pero devuelve la Response tal cual, sin lanzar por status y sin reintentar. Es lo que usa la app
legada, que lee sus respuestas a su manera. Reglas:

- Solo actúa sobre URLs del API. `isApiUrl(url)` compara contra `API_BASE` más `/` o `?`, así que un host tipo
  `https://api.example.com.otro.net` NO pasa. Cualquier otra URL va directo a `fetch`, sin token y sin tocar la sesión.
- Agrega `Authorization: Bearer <token>` si hay token y el servidor no dijo `authRequired: false`. Si ya venía un
  header Authorization, no lo toca.
- `/health` NUNCA lleva token: es pública en v2 y el backend viejo contesta el preflight con
  `Access-Control-Allow-Headers: *`, que según la especificación de fetch no cubre Authorization. Si /health
  pidiera sesión, el legado dejaría de detectar el backend.
- Si todavía no contestó el primer sondeo de /health y hay token, espera al sondeo antes de mandar el header,
  para que un backend viejo nunca lo reciba. Respeta la cancelación por signal.
- Un 401 cierra la sesión y emite `kaizen:unauthorized`, igual que apiFetch; RequireAuth manda a `/login?next=<ruta>`.

`src/legacy/legacy-fetch.test.js` vigila por código fuente que la app legada no vuelva a llamar a `fetch` directo
ni a XMLHttpRequest, EventSource, sendBeacon o WebSocket. Si tocas el legado y agregas una llamada de red, tiene
que ser con authorizedFetch o esa prueba falla.

### Sesión

- Guardada en `sessionStorage['kaizen.session'] = { token, expiresAt ISO, user: { username, displayName } }`.
- `src/lib/auth/session.js`: `useSession()`, `getSession()`, `login(u,p)`, `logout()`, `isAuthenticated()`,
  `getToken()`, `peekEndReason()` / `consumeEndReason()` ('expired' | 'unauthorized' | 'logout').
- Con `VITE_SKIP_LOGIN=true`, `npm run dev` arma una sesión sintética de 12 horas con token null. Se compila
  fuera de cualquier build.
- Un 401 limpia la sesión y RequireAuth manda a `/login?next=…`; después de cerrar sesión a propósito va a
  `/login` pelón.
- F5 puede reestilar `src/features/auth/pages/LoginPage.jsx` pero tiene que conservar las etiquetas: los e2e
  buscan los campos por label ('Usuario', 'Contraseña'), el botón por nombre 'Entrar' y el error por role=alert.

### safeNext (endurecido dos veces: usa esta versión)

`safeNext(next, fallback = '/mercados')` de `src/app/paths.js` rechaza, crudo o ya decodificado con %XX:
caracteres de control ASCII (U+0000 a U+001F y U+007F), diagonal invertida, `//otro-sitio`, esquemas
(`https:`, `javascript:`, `data:`), %XX mal formado, la propia `/login` y cualquier cosa cuyo
`new URL(next, location.origin).origin` no sea el origen de la página.

**Y además lo que se vuelve `//otro-sitio` al normalizar los segmentos de punto.** Esta es la parte que
costó dos rondas: el chequeo del origen NO alcanza, porque el parser resuelve `/..` dentro del mismo
origen, así que `/..//example.com` deja `url.origin` igual al nuestro y `url.pathname` en `//example.com`.
Devolver esa cadena es entregar un destino relativo al protocolo. Por eso ahora se revisa el RESULTADO
(`url.pathname` no puede empezar con `//`, y la cadena final tiene que empezar con `/` y no con `//`), no
solo la entrada. Rechazados: `/..//example.com`, `/%2e%2e//example.com`, `/.%2e//example.com`,
`/a/../..//example.com`, con o sin `?query` y `#hash`. Lo que sí sigue funcionando es normalizar de más
sin salirse: `/investigar/../portafolio?x=1#y` → `/portafolio?x=1#y`, `/../portafolio` → `/portafolio`.

Si tocas safeNext, la regla es: **valida siempre la cadena que vas a devolver, no la que recibiste**, porque
el parser de URL reescribe. Devuelve la ruta normalizada (pathname + search + hash) o `fallback`.

## STORAGE (src/lib/storage.js)

Llave `localStorage['kaizen:v2']`. Forma:

    { v: 2, updatedAt, portfolios: [{ id, name, baseCurrency:'MXN', createdAt, transactions, targets:{SYM:fracción}, notes }],
      activePortfolioId, watchlists: [{ id, name, symbols }],
      settings: { benchmark:'NAFTRAC.MX', riskProfile, onboardingDone },
      migrationReport, legacyHashes }

Movimiento: `{ id, type: buy|sell|dividend|deposit|withdrawal|split|fee, date: 'YYYY-MM-DD'|null, symbol,
quantity, price, currency: MXN|USD, fxRate (pesos por dólar), fees, amount, ratio, note }`.

API: `load()`, `save(state)`, `update(fn)`, `subscribe`, `useStore(selector)`, `exportJSON()`,
`importJSON(text)` (lanza ImportError; respalda el estado actual antes), `validateTransaction(raw)`,
`getStorageError()`, `isReadOnly()`, `legacyChangedSinceMigration()`, `hashLegacyValue(value)` y
la constante `FUTURE_VERSION_ERROR`.

**Versión más nueva.** Si `kaizen:v2` trae un `v` numérico mayor que 2, o sea que una build más nueva
escribió ahí, no se toca NADA: no se respalda, no se re-migra y no se sobrescribe. `load()` sirve un estado
vacío de solo lectura, `save()` y `update()` no hacen nada (devuelven el estado tal cual, avisan a los
suscriptores y dejan el error), `importJSON()` lanza ImportError, `isReadOnly()` da true y `getStorageError()`
devuelve `{ code: 'FUTURE_VERSION', message: 'Tus datos se guardaron con una versión más nueva de Kaizen.
Recarga la página para usarla.' }`. Quien dibuje datos del storage debería mirar `getStorageError()` y mostrar
ese mensaje: los dos códigos posibles son WRITE_FAILED y FUTURE_VERSION. Un `v` que no es número (por ejemplo
`"tres"`) sigue contando como dañado y se respalda como antes.

**exportJSON() en modo solo lectura entrega los datos guardados, no el estado vacío.** Exportar el estado en
memoria daba un respaldo vacío con nombre de respaldo bueno, y si después alguien lo importaba en una build sin
versión futura borraba sus datos reales. Ahora, con `isReadOnly()` en true, exportJSON() lee el texto tal como
está en `kaizen:v2` y lo entrega con su propia versión en el sobre (`{ app, kind: 'kaizen-backup', v: 3,
exportedAt, data }`). Esta build lo rechaza al importarlo, porque `normalizeState` solo acepta v: 2, y eso es lo
correcto: un respaldo de la versión nueva no se restaura hacia atrás. Único caso en que exportJSON() lanza
(Error con el mensaje de FUTURE_VERSION_ERROR): que los datos de la versión nueva desaparezcan entre la carga y
la exportación. F5, al poner el botón de "Descargar respaldo", tiene que envolverlo en try/catch y mostrar
`getStorageError()`.

**La migración v1 → v2 es una foto de un solo momento (documentado en el encabezado del archivo).** Corre una
sola vez, en el primer `load()` sin `kaizen:v2`. `momentum_portfolios` le gana a `momentum_portfolio`. `$MXN` se
vuelve depósito; las demás posiciones, compras con fecha null y nota 'Saldo inicial migrado'; `momentum_screener`
se vuelve la lista 'Mi lista'. Cada llave vieja se respalda a `kaizen:backup:<ISO>:<llave>` y las llaves viejas
NUNCA se borran. `migrationReport` trae `legacyExample: true` cuando detecta el portafolio de ejemplo de antes;
F5 puede usarlo para decidir si muestra la bienvenida, y `onboardingDone` se queda en false después de migrar.
Storage vacío significa cero portafolios: el portafolio EJEMPLO es trabajo de F5.

**Metadata de la migración, para detectar divergencia.** Al crear el estado v2 se guarda en `legacyHashes` la
huella de las tres llaves viejas (`momentum_portfolios`, `momentum_portfolio`, `momentum_screener`), null cuando
la llave no existía. La huella es largo más FNV-1a de 32 bits: no es criptográfica, solo tiene que cambiar cuando
el texto cambia, y no guarda copia del contenido. `legacyChangedSinceMigration()` devuelve
`{ known, changed, hashes }`: `known: false` si el estado no trae la foto (datos de antes de este cambio, o
estado de solo lectura), y `changed` son las llaves viejas que ya no coinciden con la migración. **No re-migra
nada y no debe re-migrar automáticamente**: mientras `src/legacy` siga montado, la app vieja sigue escribiendo
esas llaves y la nueva escribe `kaizen:v2`, y volver a migrar pisaría lo que la persona haya hecho en la app
nueva. F1, cuando tenga la página nueva de portafolio, decide qué ofrecerle a la persona (volver a importar, o
retirar las tabs legadas que leen esas llaves). Está escrito en `docs/requests/S2.md` punto 9. `save()` conserva
`legacyHashes` aunque el estado que le pasen no lo traiga.

**Ojo: lo que el legado escribe solo por montarse NO cuenta como divergencia.** El efecto "Persistir screener"
de `App.legacy.jsx` (línea 1078) vive en el Workspace, no en la tab del screener, así que escribe
`momentum_screener` con su lista por defecto en CADA montaje de CUALQUIER ruta legada. Para quien estrena la app
nueva, la foto guarda `momentum_screener: null` y el primer paso por `/mercados` dejaba `changed:
['momentum_screener']` para siempre, o sea que F1 habría ofrecido "re-importar tus datos viejos" por ruido.
Ahora `legacyChangedSinceMigration()` ignora una llave cuya huella guardada es `null` y cuyo valor de hoy es
exactamente el del legado por defecto: la lista por defecto del screener (comparada ya normalizada, así que da
igual que el legado la escriba con espacios después de la coma) o el portafolio de ejemplo (misma firma que usa
`legacyExample`). El filtro solo aplica cuando la huella guardada era null: si la llave existía al migrar y hoy
quedó en el valor por defecto, eso sí lo hizo la persona y sigue contando. Si alguna vez cambia el valor por
defecto del legado, hay que mover `LEGACY_DEFAULT_SCREENER` y `LEGACY_DEFAULT_POSITIONS` junto con él o vuelve
el falso positivo.

Hooks en `src/lib/portfolio/usePortfolios.js`: `usePortfolios({ asOf })` → `{ portfolios, active, activeId,
positions, actions }`, más `useWatchlists()` y `useSettings()`. Las operaciones puras de `portfolios.js` lanzan
`PortfolioError` con mensajes en español. `derivePositions(transactions, { asOf })` de
`src/lib/finance/ledger.js` es un stub de costo promedio (una compra sin precio deja costBasis null): el stream A
reemplaza las entrañas y tiene que dejar pasando `src/lib/portfolio/ledger.contract.test.js`.

## FORMATO (src/lib/format.js)

- `fmtMoney(v, 'MXN', { decimals, compact, sign })` → '$1,234.56 MXN' o '−$1,141.00 USD'.
- `fmtNumber(v, { compact })` → '153.9 mil', '1.2 M', '3.4 mil M', '2.5 B'; `fmtInt`.
- `fmtPct(fracción, { sign })` → '+1.23%'. `fmtPp` → '+0.35 pp'. `fmtBp` → '+12 pb'.
- `fmtMultiple` → '15.6x', o 'n/s' si es negativo; `describeMultiple()` también da el texto del title.
- `fmtDate` → '19 sep 2026'; `fmtDateTime` → '19 sep 2026, 14:05' (America/Mexico_City);
  `fmtRelative(iso, now)` → 'hace 5 min'.
- **Fechas estrictas, también con hora.** Cualquier cadena que empiece con YYYY-MM-DD tiene que ser una fecha
  que exista de verdad: `toDate()` saca ese prefijo y lo valida con vuelta completa en UTC, la misma idea que
  `isIsoDate` de storage.js. Da 's/d', no el mes corrido, tanto con fecha sola (`fmtDate('2026-02-31')`) como
  con instante completo (`fmtDateTime('2026-02-31T10:00:00Z')`). Los bisiestos de verdad pasan ('2024-02-29',
  '2000-02-29'); 1900 no.
- **Una fecha sola se dibuja igual en los tres formateadores.** `fmtDate`, `fmtDateTime` y `fmtRelative`
  reconocen la cadena `YYYY-MM-DD` sin hora y la tratan como fecha de calendario: `fmtDateTime('2024-02-29')`
  devuelve '29 feb 2024' (sin hora, porque no hay hora que mostrar) y no '28 feb 2024, 18:00' como antes, que
  era lo que salía de construir `new Date('2024-02-29')`, medianoche UTC, y bajarla a CDMX. Importa porque los
  movimientos del storage guardan `date: 'YYYY-MM-DD'`: una tabla con `fmtDate` y una tarjeta con `fmtRelative`
  tienen que decir el mismo día. `fmtRelative` con fecha sola cuenta desde las 00:00 de ese día en CDMX
  (`cdmxStartOfDay`, que arma el instante en UTC y lo corrige con el desfase que reporta la zona), así que
  '2026-09-22' a las 20:00Z da 'hace 14 h', no 'hace 20 h'. Si le pasas un instante completo, todo sigue igual
  que antes: '19 sep 2026, 08:05' para '2026-09-19T14:05:00Z'.
- `signOf(v, eps)` → 'up' | 'down' | 'flat'.
- Los faltantes siempre se dibujan 's/d'. El signo menos es U+2212. Los meses son de tres letras fijas
  ('sep', nunca 'sept').
- CSV en `src/lib/csv.js`: `toCSV` (BOM, CRLF, guarda contra inyección de fórmulas que se puede revertir),
  `parseCSV({ unguard })`, `rowsToObjects`, `objectsToCSV`, `downloadCSV`.

## E2E

- `import { test, expect } from './support/guards.js'` y
  `setupApp(page, { baseURL, health, healthDelayMs, legacyApi, legacyAuth, session, routes })` de
  `e2e/support/app.js`. Bloquea hosts externos, mockea `/health` y tus rutas, puede reproducir respuestas v1 del
  HAR `e2e/fixtures/app/legacy-api.har`, sembrar sesión y congelar el reloj.
- **legacyAuth.** Con `legacyApi`, las rutas v1 exigen `Authorization: Bearer <token>` igual que el backend v2
  (`require_user` en `kaizen_api/routers/legacy_v1.py`). `'auto'` (el default) la prende cuando `/health` dice
  que hay sesiones y acepta el token de la sesión sembrada; un string es el token que acepta el servidor;
  `false` la apaga. Sin el header correcto la ruta contesta 401 y las guardas lo marcan.
  `api.legacyAuth.requests` guarda `{ method, path, authorization }` de cada request v1, que es como se
  comprueba que el legado sí manda el token. `/health`, `/auth/*` y `/v2/*` no pasan por la compuerta.
- Para mockear datos v2: `routes: { 'GET /v2/quotes': { json: {...} } }`.
- Para un 4xx o 5xx a propósito, usa el `test` pelón de Playwright, engancha las guardas tú con
  `attachGuards(page, { allow: expectedHttpError(401, 'POST', '/auth/login', 'motivo') })` y llama `assertClean()`
  al final. Ojo: Chromium imprime cada 401 o 500 provocado como console.error, así que también hay que permitir
  ese patrón.
- Para esperar al legado: `trackNetwork(page, API_URL_RE)` + `waitForSettled`. Para cambiar de tab como lo haría
  la persona: `openLegacyTab(page, tab, isMobile)` con las entradas de `LEGACY_TABS` de `e2e/support/legacy.js`
  (barra lateral `.app-sidebar .app-nav` en escritorio, pastillas `.bottom-nav-mobile` en móvil; ojo que las
  etiquetas móviles son cortas: 'Sharpe', no 'Sharpe Optimizer').
- Puertos propios: `E2E_PORT=<puerto> npm run e2e`, `E2E_BASELINE_PORT=<puerto> npm run e2e:baseline`.
- axe: `new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa'])`.
- Orden de compuertas: corre lint ANTES de e2e, o borra `dist-e2e` antes de lint, mientras Q0 no lo agregue a
  los ignores de ESLint (medido: con dist-e2e presente el lint da 155 errores de código minificado; sin él, 0).

## C / C1 / C3

- `src/index.css` declara el alias de JetBrains Mono limitado a pesos 300 a 700 y redefine `--font-sans` y
  `--font-mono` después de importar `theme.css`. Déjalo así hasta que se retire el legado, o el baseline se rompe.
- `src/app/app.css` tiene las clases `.kz-*` de avisos, páginas de mensaje y el campo del login, solo con tokens.
- `UiProvider` es un stub de paso, montado dentro de los providers de sesión y capabilities y arriba del router.
- El CSP de `vercel.json` permite solo 'self' más `https://*.onrender.com` en connect-src, y fuentes solo de
  'self'. Nunca agregues fuentes ni scripts externos.
- Dato para no confundirse al revisar en vivo: el panel de Noticias del legado pinta su propio fondo oscuro
  (7,16,11) mientras el resto de las tabs usa el fondo claro de la app (243,242,236). NO es un cambio de tema:
  `data-theme` es 'light' en las dos rutas y la barra lateral es el mismo verde oscuro (17,37,28) en ambas.
- **Cuando reemplaces el Resumen Mañanero y la barra superior, limpia el texto del legado.** Ver limitaciones.

## LIMITACIONES CONOCIDAS

- **El legado escribe guiones largos y usa '—' como dato faltante.** `src/legacy/App.legacy.jsx` tiene 85 líneas
  con `—` (9 en comentarios, 76 en texto que se dibuja), en dos clases: como raya de frase en el Resumen
  Mañanero y los avisos de la barra superior ('Peso se debilita 0.40% — dólar en $17.2970 MXN' línea 647,
  'VIX 14.87 — ambiente de calma, risk-on' línea 653), y como marcador de dato faltante donde el contrato pide
  's/d' (líneas 419, 554 y 611). El texto lo arma el frontend, no el backend: el JSON de `/market` del backend
  de replay trae 0 guiones em. **No se corrige en esta fase a propósito**: cambiar esas cadenas mueve píxeles y
  rompe la compuerta visual del legado, que es el guardarraíl de la fase 1. El arreglo va cuando C3 reemplace
  esos componentes, que ya nacen con `fmtMoney`, `fmtPct` y el 's/d' de `src/lib/format.js`. El código nuevo sí
  cumple la regla: 0 guiones em en `src/app`, `src/features`, `src/lib`, `src/components` e `index.html`.
  Detalle en `docs/requests/S2.md` punto 10.
- **Al set de replay 2026-09-22 le faltan llamadas de MSFT, AMZN y GOOGL**, y por eso toda revisión en vivo
  arranca con 4 HTTP 500 (`/stock/MSFT`, `/stock/AMZN`, `/chart/MSFT`, `/chart/AMZN`) y 14 console.error por
  ancho, con el portafolio de ejemplo del legado en 'Cargando'. No es que los símbolos no estén: tienen solo
  `balance_sheet`, `income_stmt` e `info`, mientras que AAPL, WALMEX.MX y CEMEXCPO.MX tienen de 9 a 12 llamadas.
  Falta `financials`, `cashflow`, `history` y `news`. Es de R0, no del código; está en `docs/requests/S2.md`
  punto 11 con los nombres de llave exactos.
- Nada de la app llama todavía a `storage.load()`: la migración corre cuando F1 o F5 usen `useStore` o
  `usePortfolios`. Se nota en el build, donde el hash del chunk de entrada no cambia aunque cambien storage.js y
  format.js, porque todavía nadie los importa.
- Dos instancias de `useTheme()` vivas (ThemeSync y el Workspace legado); no comparten el estado del botón.
- El legado en móvil no tiene control para cerrar sesión (esconde la barra lateral abajo de 768 px), y por eso
  el e2e de logout se salta en móvil.
- En móvil el ticker de la barra superior del legado se encima con la pastilla de la tab actual ('Noticias25' en
  /mercados, 'DXY' tapado por 'Sharpe' en el optimizador). Es del legado y no es regresión.
- Contra el backend viejo nadie puede iniciar sesión: la pantalla de login solo puede decir 'El servidor todavía
  no tiene el nuevo inicio de sesión'.
