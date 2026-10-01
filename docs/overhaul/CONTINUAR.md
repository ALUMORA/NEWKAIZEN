# CONTINUAR: rehacer NEWKAIZEN como "Bloomberg-lite"

Actualizado el **1 de octubre de 2026**: fases 0 a 4 cerradas y la ronda de pendientes que no
dependían del dueño (tandas T1 y T2, del 29 de septiembre al 1 de octubre) integrada y recorrida. Este
archivo es el punto de entrada para la siguiente sesión. Todo lo que hace falta está en `docs/overhaul/`.

## Qué es esto

El usuario pidió revisar el repo `ALUMORA/NEWKAIZEN` y mejorarlo todo (UI, UX, finanzas bien hechas,
funciones nuevas) para que sea un "Bloomberg barato" para inversionistas de a pie en México y EE.UU. y
para empresas chicas que se lo den a sus empleados. Se hizo una auditoría (113 hallazgos verificados)
y se aprobó un plan por fases con agentes en paralelo.

- Plan aprobado, completo: [PLAN.md](PLAN.md)
- Auditoría: [auditoria/indice-hallazgos.txt](auditoria/indice-hallazgos.txt) (una línea por hallazgo) y
  [auditoria/audit.json](auditoria/audit.json) (evidencia, por qué y corrección de cada uno; si el
  veredicto es "partially", usar `corrected_fix` en vez de `fix`).
- Specs que alimentan a los agentes (autoritativas):
  - [specs/api-v2-spec.md](specs/api-v2-spec.md): contrato del API v2 (unidades, errores, endpoints)
  - [specs/frontend-spec.md](specs/frontend-spec.md): rutas, providers, cliente API, sesión, formato, storage
  - [specs/finance-spec.md](specs/finance-spec.md): librería financiera con respuestas conocidas, y al
    final las respuestas conocidas del backend (DCF, factores, fórmula mágica, momentum)
  - [specs/design-brief.md](specs/design-brief.md): dirección visual, tokens, componentes, shell e IA
- Notas de entrega de cada stream: [notas/](notas/)
- Scripts de workflow usados (sirven de plantilla): [workflows/](workflows/)
- Reglas de trabajo en paralelo: [../OWNERSHIP.md](../OWNERSHIP.md) y `scripts/ownership.json`

## Estado exacto

### Fases 0 y 1 terminadas y publicadas en `analizavende`

| Commit | Qué |
| --- | --- |
| 641cc1b, 50a9d2b | Dependencias fijadas (react-router 7, TanStack Query 5, fuentes locales, Vitest 4, Playwright **1.62.1** por los navegadores en caché, FastAPI, PyJWT, pytest...), scripts npm, reglas de propiedad |
| 47ba83a (merge Q0) | Vitest, Playwright con familias `baseline-*` y `desktop/mobile`, guardas, reloj fijo, mock del API, **baseline visual del legado** (16 capturas), presupuesto de bundle, CI en `.github/workflows/check.yml` |
| e6424d0 (merge R0) | Grabación y replay de proveedores, fixtures del 22 sep, **122 goldens** del backend viejo, servidor de replay |
| 614714f (merge S1) | `backend.py` pasa a ser un shim del paquete `kaizen_api/` con FastAPI: rutas v1 idénticas probadas contra los 122 goldens, contrato v2 en `schemas.py` con rutas registradas (501 hasta la fase 2), `/health` v2, login con scrypt y JWT, límite de tasa, CORS por allowlist y el servicio nuevo en `render.yaml` |
| 3d58608 (merge S2) | Esqueleto del frontend: router, `RequireAuth`, `ErrorBoundary`, avisos del servidor, `lib/api` con arranque en frío, sesión, `format.js`, `storage.js` v2 con migración, `csv.js`, `vercel.json` con CSP. El legado vive en `src/legacy/App.legacy.jsx` **sin la contraseña fija "Investments"**, montado por `LegacyPage`, manda el token de la sesión en todos sus requests y la URL sigue a su tab |
| d6117c0 (merge M1) | Fixtures en capas, un router por stream de fase 2, cobertura y traslapes en `check-ownership.mjs`, ignores de ESLint |
| 7c1cc41 | El contrato solo acepta ligas `http(s)` y documenta cómo se normalizan GBp y ZAc |

Compuerta **G1 en verde**, verificada por el orquestador después de los merges:

- `npm run lint` (0 errores, 3 avisos heredados del legado), `npm run typecheck`, `npm run test`
  (373), `npm run build`, `npm run bundle` (106.61 KB gzip contra 180 de presupuesto, 59 %).
- `pytest` 482 pruebas sin red, 1 omitida (la que necesita red), `ruff check .` limpio.
- `npm run e2e:baseline` 16 de 16 **sin actualizar capturas**, `npm run e2e` 75 de 75 con 1 omitida.
- `node scripts/check-ownership.mjs --coverage <los 14 streams de fase 2>`: `kaizen_api/` con dueño
  único para cada archivo y sin traslapes.
- `/health` servido con `preview_start` (entrada `newkaizen-replay` del `launch.json`) responde
  `apiVersion: 2`, y la app en 1440x900 y 390x844 dibuja datos reales, sin errores de consola, sin
  requests fallidos y sin scroll horizontal. Al hacer clic en una tab del legado la URL y el título
  la siguen, y Atrás regresa.

### Fase 2 entregada y mergeada (M2), con recorte deliberado

Se cerró el 22 de septiembre de 2026 aplicando Pareto, porque la sesión iba al 78 % de su cuota. Se
entregó todo el backend v2 y toda la librería financiera, y se dejaron fuera los tres streams de
diseño. Lo que entró, con sus commits en `analizavende`:

| Stream | Qué entregó |
| --- | --- |
| A1 | returns, stats, performance, benchmark, rates, risk, backtest, fx y el barril, con 456 pruebas y 277 casos golden contra numpy y scipy |
| A2 | álgebra, covarianza Ledoit-Wolf, rendimientos esperados, optimización y walk-forward |
| A3 | generador con semilla, Monte Carlo y metas |
| A4 | ledger de costo promedio, rendimiento del ledger, XIRR, ISR de México y rebalanceo en acciones enteras |
| A5 | glosario de 95 términos y las diez páginas de metodología |
| B1 | seguridad y plataforma: límite de tasa que ya no bloquea al usuario, validación de USERS, Cache-Control por clase de dato |
| B2a | quotes, búsqueda, historia con fechas reales, panel alineado, FX, panorama y calendario BMV/NYSE |
| B2b | Banxico, FRED sin llave, tasas de México, rf CETES 28 como serie, macro de EE.UU. en pb, noticias y tono |
| B3a | ficha de emisora con monedas correctas, estados financieros reales, dividendos, insiders y beta local |
| B3b | valuación con múltiplos de Damodaran y DCF FCFF de dos etapas, y momentum 12-1 |
| B3c | screener de factores, fórmula mágica honesta y FIBRAs con métricas correctas |

Compuerta **G2 verificada por el orquestador después de mergear los once**:

- `npm run lint` (0 errores), `typecheck`, **1,455 pruebas** de Vitest, `build`, presupuesto en 59 %.
- **1,250 pruebas** de pytest sin red y 3 omitidas, `ruff` limpio.
- `npm run e2e:baseline` 16 de 16 sin actualizar capturas, `npm run e2e` 75 de 75.
- `/health` anuncia **25 capacidades** reales y `/v2/rates/rf` devuelve la serie de CETES con fechas
  y en fracciones, servido con `preview_start`.

Lo que costó integrarlos, y conviene saberlo para la próxima fase: los streams se probaron cada uno
con las costuras de los demás simuladas, así que al juntarlos varias pruebas salían a la red o
afirmaban cosas que dejaron de ser ciertas (por ejemplo "sin la costura de históricos la beta va
vacía", cuando ya existe). Se arreglaron las pruebas, no el código, y las capas de fixtures de los
cinco streams de backend se consolidaron en el set base, que pasó de 432 a 566 llamadas.

### Revisión de la fase 2 cerrada (23 de septiembre de 2026)

Todos los defectos blocker y major de la revisión independiente quedaron cerrados, cada uno con una
prueba que falló antes y pasa después. Detalle por stream en
[notas/fase2-correcciones.md](notas/fase2-correcciones.md) (A1, A4 y B2a, ronda del 22) y en los
commits `merge: correcciones de la revisión, stream X` de esta ronda:

- **A2**: 13 de 13 (caída máxima del walk-forward, James y Stein invariante a la periodicidad y por
  omisión hacia el promedio como pide el spec, maxSharpe en null si nada le gana a rf, paridad de
  riesgo con Newton, covarianza asimétrica rechazada).
- **A5**: los abiertos de la lista más unas 45 diferencias entre la metodología y el código.
- **B1**: bloqueo de cuenta ajena, X-Forwarded-For repetida, NAT, CORS de producción cerrado a
  `newkaizen.vercel.app` (los previews necesitan `VERCEL_TEAM_SLUG` en Render).
- **B2b**: candado del SIE por título, periodicidad, unidad y flag `verified`; noticias sin cuerpo;
  `tenorDays` real del respaldo de rf; bandas de cordura.
- **B3a**: `fxUsed.asOf` lleno, año fiscal de la SEC, SEC caída marcada como respaldo, insiders sin
  duplicados, beta por intervalos completos, `stale` real en la ficha.
- **B3b y B3c** se revisaron por primera vez ([notas/fase2-revision-b3.md](notas/fase2-revision-b3.md),
  B3c salió **fail**) y se corrigieron: FIBRAs sin el balance del fiduciario, distribuciones pagadas,
  tasa sustituta declarada, fórmula mágica con utilidad de operación y sin EBIT negativo ni FIBRAs,
  momentum por fechas, supuestos del DCF anclados a inflación con desvanecimiento y aviso de valor
  terminal, caché de insumos. El 12-1 del screener de factores ahora delega en
  `momentum.momentum_12_1`: una sola definición en la app.
- La metodología (`docs/metodologia/`) se sincronizó con todos esos cambios.

Compuerta después de integrar todo: `npm run check` 1,547 pruebas, pytest 1,366 y 3 omitidas, ruff
limpio, `e2e:baseline` 16 de 16 sin actualizar capturas, `e2e` 75 de 75.

Pendientes que dejó esta ronda y NO bloquean la fase 3:

- **Decisiones del dueño**: en B1, un ataque repartido entre muchas IPs ya no tiene tope global por
  usuario (10 fallas por hora por IP); en B3b, el contrato congelado necesita `dcf.currency`,
  `benchmark: str | None` y supuestos opcionales sin tasa (`docs/requests/B3b.md` §5).
- **Con red**: confirmar contra el SIE real las palabras nuevas del candado de B2b ("bancari",
  "rendimiento") y marcar `verified: true`; leer los términos de uso de Expansión y El Financiero.
- **Criterio fiscal**: la retención de FIBRAs al 30 por ciento sobre la parte del resultado fiscal.
- Calendarios BMV y NYSE solo cubren 2026 y 2027; hay que agregar 2025 desde la fuente oficial.
- Para la fase 3: quien calcule rf diaria tiene que usar el `tenorDays` de la respuesta, no el pedido.
- A3 sigue con 6 minors sin tocar.

### Sistema de diseño cerrado: C1, C2 y C3 (23 de septiembre de 2026)

- **C1**: tokens en los dos temas (136 pares de contraste medidos, todos AA, y la medición corre en
  `npm run test`), unas 30 primitivas con un barril en `src/components/ui/index.js`, galería
  `/dev/ui` fuera de producción. **API congelada en `docs/design.md`.**
- **C2**: gráficas SVG sin dependencias en `src/components/charts/` (TimeSeries con cruceta por
  teclado, FanChart, DrawdownChart, Donut, Bars, Heatmap, FrontierChart, Sparkline, todas con "Ver
  tabla"). Props en `docs/design.md`, sección Gráficas. Cargarlas con `lazy()` desde la ruta.
- **C3**: shell con barra lateral plegable, tira de mercado, estado del servidor, menú de usuario,
  barra inferior y hoja "Más" en móvil, pie con aviso, paleta ⌘K, liga de salto y foco al h1. El
  legado va incrustado sin su cromo. El baseline ahora recorta solo el contenido del legado; antes de
  regenerar se comprobó con recorte y comparación que el contenido no cambió.
- Ajustes del orquestador al integrar: `/dev/ui` en el build de e2e, `app.spec.js` con la
  navegación nueva, ComingSoon sin `main` anidado, y el legado con consulta de contenedor en vez
  de viewport (se recortaba entre 820 y 1240 px junto a la barra lateral).

Compuerta: `npm run check` 1,816 pruebas y bundle al 69 %, `e2e:baseline` 16 de 16, `e2e` 126 y 8
omitidas (las de un solo viewport), Lighthouse 100 en accesibilidad y buenas prácticas en `/mercados`
escritorio y móvil, sin errores de consola.

Abierto: el contenido del legado no pasa por axe (se va en M3); el Heatmap esconde los valores de
celda a 390 px (siguen en "Ver tabla").

### Fase 3, primera tanda: rutas nuevas (23 de septiembre de 2026)

Se hizo con límite de tiempo y solo sobre las rutas que mostraban "Próximamente"; las que montan el
legado no se tocaron (el baseline las cuida y se reemplazan en M3). Construido y probado con axe en
los dos temas y viewports:

- **F1**: `/portafolio/movimientos` (libro con alta, borrado con Deshacer, USD con FIX de la fecha,
  costo promedio), `/portafolio/rebalanceo` (acciones enteras, registro al libro con Deshacer),
  `/portafolio/riesgo` (caída máxima, VaR, CVaR, betas en pesos, N efectiva, USD, correlaciones).
  **Falta `/portafolio/rendimiento`** (TWR, XIRR, efecto precio y tipo de cambio, ISR): hoy es el
  único ejemplo de "Próximamente" que usan `router.test.jsx` y `app.spec.js`.
- **F2**: `/mercados/mexico`, `/mercados/cetes` (calculadora con ISR), `/mercados/noticias`.
- **F3**: `/investigar/:symbol` (ficha con valuación, DCF editable, momentum, estados, dividendos,
  noticias; cada sección cae sola) y `/investigar/comparar`.
- **F4**: `/herramientas/simulador` (Monte Carlo en el worker, abanico, metas, retiro; reproduce
  176,729.14 y 180,292.00).
- **F5**: `/aprender`, `/aprender/:termino`, `/aprender/metodologia/:guia`, los tres legales como
  borrador, `/watchlist`, `/bienvenida` y `public/manifest.webmanifest` (falta enlazarlo en
  `index.html`).

Compuerta: `npm run check` 1,831 pruebas, bundle al 74 %; `e2e:baseline` 16 de 16; `e2e` 246 más
las 2 del shell corregidas después (shell.spec 17 de 17); sin errores de consola en la ficha, México
y el simulador con el replay.

Pedidos abiertos de los streams en `docs/requests/F1.md` a `F5.md` (sector en lote para la
concentración, precios en moneda original para separar efectos, buscador reutilizable, etc.). La
descripción de la emisora llega en inglés desde Yahoo.

Lo siguiente: `/portafolio/rendimiento`, luego reemplazar las rutas del legado (panorama,
portafolio, optimizador, backtest, screeners) y M3.

### Estado al 23 de septiembre de 2026, tarde: M3 hecho, pendiente para `main`

- Segunda tanda de la fase 3 integrada (las 8 pantallas del legado reemplazadas, PF y PB). El
  workflow se detuvo por cuota: solo F5 y PB pasaron por revisión adversaria; F1, F2, F3b, F3c, F4
  y PF no. Hallazgos abiertos de F5: CSV con coma decimal y columnas desconocidas, la tendencia de
  la watchlist sin su meta, páginas públicas sin salida a la app.
- M3 hecho (`84b572f`): `src/legacy`, LegacyPage, legacyRoute, legacyTabs y el baseline visual
  retirados. `npm run check` en verde (2,009 pruebas). **e2e: 47 fallas**: 41 son pruebas del
  legado en `e2e/app.spec.js` que hay que borrar, 6 son de `e2e/shell.spec.js` sin diagnosticar.
  La infraestructura e2e del legado (`e2e/support/legacy.js`, `e2e/fixtures/legacy`, proyectos
  baseline en `playwright.config.js`, `legacyApi` de setupApp) sigue ahí y se limpia después.
- **Banxico, verificado con el token del dueño (en `.env.local`, nunca en el repo)**: el SIE solo
  confirma `SF331451` (TIIE de fondeo) y `SF43718` (FIX). `SF61745` (tasa objetivo) y `SF43783`
  fallan solo porque el SIE reporta la unidad como "Sin Unidad"; `SP68257` (UDI) por "Unidades de
  Inversión": hay que aceptar esas unidades en el catálogo. Los CETES `SF43936/39/42/45` salen con
  periodicidad "Diaria" contra "Semanal": revisar si son los de subasta. **Ids equivocados**:
  `SF43881` es un BPA a 1092 días, no el Bono M 10 años, y `SP74625`/`SP74626` son índices del INPC
  subyacente, no inflación anual. Sin arreglar esto, con token en producción la tasa objetivo NO se
  publica. Comando: `KAIZEN_LIVE=1` con `tests/unit/b2b/test_banxico_live.py -s`.
- Bloqueo para `main`: no existe el servicio v2 en Render; la app nueva no puede iniciar sesión
  contra el backend viejo.

### 23 de septiembre de 2026, mediodía: e2e en verde (`19199f1`)

- Las 47 fallas e2e se cerraron: `e2e/app.spec.js` y `e2e/shell.spec.js` ya prueban las rutas
  nuevas (login, `?next`, cierre de sesión, avisos, paleta y axe sobre `/mercados` completo, sin
  excluir contenido). Las 6 del shell no eran un defecto: esperaban `.app-shell[data-embedded]` del
  legado y pedían `/v2/markets/world` y `/v2/screeners/*` sin mock (501). Suite completa: **409
  pasadas, 0 fallas**, 47 omitidas (las de un solo viewport); `npm run check` en verde.
- Se borró la prueba de "Próximamente" en `/portafolio/rendimiento`: ninguna ruta usa ya
  `ComingSoon`.
- `ComingSoon.jsx` y su CSS exclusivo se borraron (código muerto). `useShell()` quedó sin uso.
- SIE: el candado acepta por serie la unidad literal que reporta Banxico (`unidadExacta` en
  `banxico_series.json`: "Sin Unidad" en SF61745 y SF43783, "Unidades de Inversión" en SP68257),
  sin relajar las demás. **Falta** correr la prueba en vivo con el token para decidir `verified`, y
  siguen abiertos los ids equivocados (SF43881, SP74625/SP74626) y la periodicidad de los CETES.
- Sigue pendiente limpiar la infraestructura e2e del legado (`e2e/support/legacy.js`,
  `e2e/fixtures/legacy`, proyectos baseline de `playwright.config.js` y la opción `legacyApi` de
  `setupApp`, que todavía pasan varios specs aunque ya no haga falta).

### 25 de septiembre de 2026: revisión de la fase 3, fase 4 y G4

Todo en `analizavende` y en `origin/analizavende`, nada en `main`. Se hizo con 9 agentes (Agent, no
Workflow) en worktrees propios, en tandas de 4 o 5 con hora límite, más integración y recorrido del
orquestador. Reportes en `docs/overhaul/notas/`: `fase3-revision-RP.md`, `-RM.md`, `-RT.md`,
`sie-catalogo.md`, `fase4-seguridad.md`, `fase3-api-pedidos.md`, `fase3-adopcion-api.md`,
`fase4-copy-ux.md`.

- **Revisión de F1, F2, F3b, F3c, F4 y PF** (nunca se habían revisado): un blocker (el rebalanceo
  pedía vender casi todo con compras sin depósito) y unos 15 major, todos corregidos con prueba que
  falla antes. Los más graves: el TWR daba 5.55 % contra 31.30 % real por mezclar precio pagado con
  cierres ajustados; el DCF de emisoras del SIC salía en USD con formato de pesos; el FIX duplicado y
  el dólar de Yahoo etiquetado como FIX; el CSV leía `1.234,56` como 1.23456; sin token la tasa de
  respaldo se convertía a 28 días en vez de 91.
- **SIE**: ids correctos (`SF44071` Bono M 10 años, `SP30578` y `SP74662` inflación anual y
  subyacente), CETES de subasta con su periodicidad real, las 12 series con `verified: true` probadas
  en vivo. Calendarios BMV y NYSE con 2025 (DOF y NYSE Group, con el cierre por Carter).
- **Seguridad**: pass_with_issues. `AUTH_REQUIRED` ya es verdadero por omisión en producción, el login
  tiene tope de 16 KB, la bitácora escapa caracteres de control y la CSP ya no bloquea fuentes. El
  historial del repo público no tiene secretos; dependencias sin CVE conocidos.
- **API**: `verified`, `stale` y `tenorDays` por serie, `marketStatus.lastClose`, `FibraRow.notes`,
  `MagicRow.ebitSource`, `FibrasResponse.rate`, `GET /v2/assumptions`, `GET /v2/rates/mx/inpc` (SIE
  `SP1`, sin respaldo: sin token da 503) y `/v2/panel?adjust=splits`. Las pantallas ya los usan, con
  lo viejo como respaldo mientras Render no tenga el backend v2.
- **Copy y UX**: títulos de pestaña únicos, subpáginas alcanzables en móvil, "Primeros pasos" en
  /mercados, avisos del API sin jerga técnica, términos unificados ("clave", "portafolio",
  "Lista de seguimiento").
- **e2e**: se retiró toda la infraestructura del legado (HAR, grabadores, baseline, `legacyApi`), el
  scroll horizontal se mide contra el viewport emulado (`e2e/support/layout.js`) y **la CI ya corre
  e2e en Linux** (job nuevo en `check.yml`). El aviso con Deshacer ya recibe clic en móvil.
- **G4, medido por el orquestador**: Lighthouse con Brave sobre el build y el replay. Públicas: 100 en
  escritorio, 92 a 96 en móvil, accesibilidad y buenas prácticas 100, SEO 100 con el `robots.txt`
  nuevo. Con sesión (`scripts/lighthouse-sesion.mjs`): 94 a 100 en móvil y 100 en escritorio en las 20
  rutas. Para llegar ahí se corrigió CLS: /mercados 0.36, noticias 0.60 y la ficha 0.66 bajaron a
  menos de 0.05 (esqueletos del tamaño real y `Card` que reserva el lugar de su insignia); hay
  pruebas e2e de CLS en /mercados y en la ficha.
- **Hallado solo al mirar la página**: /portafolio/riesgo pedía `range=3y`, que el contrato no tiene,
  y el API contestaba 422; los mocks de e2e aceptan cualquier rango y por eso pasaba. Ahora pide 5y y
  recorta, y `getPanel`/`getHistory` rechazan un periodo fuera del contrato antes de salir a la red.
- Capa de replay nueva `2026-09-22-recorrido` (VIX a 5 años, panel del portafolio de ejemplo,
  screener de factores y FIBRAs); `newkaizen-replay` del `launch.json` ya la carga.

Compuerta final: `npm run check` 2,114 pruebas y bundle al 75 %, pytest 1,519 y 6 omitidas, ruff
limpio, e2e completa en local 459 pasadas y 0 fallas (47 omitidas, las de un solo viewport).

### 29 de septiembre al 1 de octubre de 2026: pendientes sin decisiones del dueño (T1 y T2)

El usuario pidió hacer todo lo que no dependiera de sus decisiones. Se revalidó cada pendiente contra
el código, se partió en streams con archivos disjuntos (`scripts/ownership.json`: T1LB, T1PF, T1RS,
T1MK, T2SW) y se hizo en dos tandas. Los agentes de T1RS y T2SW se atoraron (10 minutos sin avanzar,
con la Mac cargada) y el orquestador terminó su parte. T2DC (docs y comentarios) lo hizo el
orquestador directo. Todo en `analizavende`, nada en `main`.

- **T1LB** (`7de741f`): `avgFx` pondera por costo (10@100 FX 17 más 10@200 FX 20 da 57,000 y un split ya
  no duplica el peso), A4-1, A4-2, A2-2, A3-2, F1-6, un solo parser de CSV para bienvenida y
  Movimientos que nombra las columnas que no lee, y fuera `legacyChangedSinceMigration`.
- **T1MK** (`0afc740`): el heatmap muestra sus cifras a 390, noticias con esqueleto de ocho titulares
  sin CLS, CETES con la retención de `tax-mx.js`, `fmtWeekday` en `format.js`, "Panorama" una sola
  vez, la tira de mercado se desvanece cuando no cabe, y los selectores de emisoras con `SearchCombobox`.
- **T1PF** (`d093389`): el resumen valúa el cierre de ayer en USD con el FIX de ayer, no pierde el
  efectivo en pesos sin tipo de cambio y corta en hoy lo que tiene fecha futura (también Riesgo,
  Rebalanceo, Rendimiento y Movimientos, que avisan). Riesgo con betas contra NAFTRAC.MX y SPY y
  concentración por sector; Rendimiento con el tipo de cambio implícito del panel.
- **T1RS** (`a0ab146`): la industria de la ficha en español (`industryEs`), nueve llaves nuevas del
  glosario cableadas en la ficha, Comparar y los screeners, con guarda de que todo `termKey` existe, y
  `SearchCombobox` con fichas en Comparar y en el universo propio del screener.
- **T2DC** (`6c4fa80` a `d8335c7`): la metodología del TWR, backtest, optimizador y riesgo dice lo que
  la pantalla hace hoy, página nueva `docs/metodologia/mercados.md`, `api-v2.md` al día en sesión,
  CORS, 503 y rf, y fuera los comentarios y la condición `onLegacyRoute` del legado.
- **`9a8802e`**: `SearchCombobox` recibe la prop `error` (`aria-invalid`, alerta en la descripción y
  cierra el panel); los tres selectores la usan. Pedido 8 de F2 cerrado.
- **T2SW** (`d61ca73`): el `%` pegado a la cifra en 45 textos del frontend y 7 del API; los errores de
  `optimize.js` y `walkforward.js` con el menos U+2212 de `format.js`; `PATHS.learnMethodology` y
  `pathMethodology()` en vez de 11 ligas escritas a mano; "Cómo se calcula" en /mercados hacia su
  guía; `InlineLink` en herramientas; la frontera eficiente marca la paridad de riesgo. Guardas nuevas:
  `src/test/copy-guards.test.js` (lee `src/` con el `Linter` de ESLint: `%` separado, `toFixed` dentro
  de un error y ligas a la metodología escritas a mano, más el `%` de `docs/metodologia`) y
  `tests/unit/test_copy_percent.py` (cadenas del API por AST, sin docstrings ni `legacy_v1.py`).
- **Hallado al medir Lighthouse con el portafolio de ejemplo** (el 25 sep el portafolio se auditó
  vacío, por eso no salía): CLS de 0.40 en /screener, 0.20 en optimizador y backtest, 0.18 en
  Rendimiento y 0.14 en Riesgo, todos a 1440. La causa que multiplicaba todo era la tira de mercado:
  cada celda decía "IPC s/d" y al llegar las cifras crecía hasta 2.6 veces, así que las de la derecha
  se recorrían 175 px, y el CLS multiplica el área que se mueve por la distancia más grande. Ahora cada
  celda aparta su ancho con datos (`data-id` y `min-width` en `topbar.css`) y el estado el de su
  insignia. Además, cada pantalla aparta lo suyo: el tablero del screener y los resultados de
  optimizador y backtest hasta debajo del borde, Rendimiento con esqueletos del alto de sus dos
  gráficas y textos de espera del mismo largo. Pruebas e2e de CLS nuevas en las cinco pantallas y una
  que fija la x de cada celda de la tira (`shell.spec.js`).
- **El optimizador pedía "Revisa los supuestos marcados" mientras cargaba**: la tasa de CETES se pide
  hasta que llega el panel y, en camino, valía `null` ("no llegó"), así que el campo decía "No llegó la
  tasa de CETES". Ahora vale `undefined` mientras se espera, como la prima, y `useOptimizer` expone
  `waiting` para que la pantalla muestre la carga.
- **Grabaciones nuevas** en la capa `2026-09-22-recorrido`: FEMSA semanal a 5 años (Riesgo) y a 1 y 2
  años (Comparar con FEMSA daba 500 `ReplayMiss`).

Compuerta sobre `analizavende` integrado: `npm run check` 2,237 pruebas y bundle al 76 %, pytest 1,521 y 6
omitidas, ruff limpio, e2e completa en local 547 pasadas y 0 fallas (51 omitidas, las de un solo viewport).

Recorrido real (build más replay, 1440x900 y 390x844, portafolio de ejemplo más 5 AAPL en USD del
2 de marzo): /portafolio y sus cuatro subpáginas, la ficha de WALMEX.MX, Comparar, los tres screeners,
las cuatro de Mercados, la lista de seguimiento, optimizador, backtest, simulador, /aprender y la guía de
Mercados. Sin errores de consola, sin scroll horizontal, ningún `N %` separado en pantalla, y todas las
llamadas al API en 200 salvo los dos `ReplayMiss` de FEMSA, ya grabados. Lighthouse con sesión y el
portafolio de ejemplo (`LH_EJEMPLO=1`) en diez rutas: 100 en escritorio en todas, 100 en móvil salvo el
optimizador (94), y accesibilidad y buenas prácticas en 100 en las veinte mediciones.

### Lo que falta, en orden

Todo lo que no dependía del dueño quedó hecho. Lo que queda, de más a menos valor:

1. **Lo del dueño** (sección final): servicio v2 en Render, `VITE_API_URL` en Vercel y merge a `main`.
   Sin eso nada de esto lo ve nadie. Arturo no ha movido `alumora` desde `5dd569b` (21 sep).
2. **Decisiones del dueño** que siguen abiertas (se preguntaron el 29 sep y no se contestaron):
   - `render.yaml` todavía declara `kaizen-backend` en modo desarrollo (`/docs` abierto, v1, sin sesión).
   - `scripts/hash_password.py` solo avisa ante contraseñas cortas; ¿rechazar menos de 12?
   - Campos aditivos del contrato v2 de B3b §5 (`dcf.currency`, `benchmark: null`, supuestos opcionales).
   - El portafolio del navegador no se borra al cerrar sesión (va con la decisión de Supabase).
   - `/aprender` y legales fuera del shell con sesión, y "Primeros pasos" en el menú de usuario.
   - Fiscal: INPC que baja (factor menor que 1, CFF 17-A), retención de FIBRAs al 30 por ciento del
     resultado fiscal, FIX contra DOF, prima país en el CAPM del optimizador, dividendos extranjeros.
   - Nombres en inglés: Screener, Backtest, walk forward, Tracking error.
3. **Al desplegar Render**: revisar cómo llega `X-Forwarded-For` (el límite por IP del login depende de
   eso) y, con el backend v2 en vivo, borrar el parseo de `meta.notes` que quedó como respaldo en
   FIBRAs y fórmula mágica.
4. **Menores abiertos**:
   - Movimientos: si guardas una compra en USD antes de que llegue el FIX de esa fecha, sale "Falta el
     tipo de cambio" y el aviso se queda aunque el campo ya se haya prellenado; habría que esperar al
     FIX o bloquear el botón mientras llega.
   - La ficha a 1440 parte "$775.3 mil M MXN" en dos renglones en el resumen.
   - No hay primitiva de aviso con tono: `.kz-tool__notice` sigue en `tools.css` (F4).
   - BMV 2027 hay que cotejarla cuando la publique la CNBV (diciembre 2026).
5. La prueba de desempeño de Monte Carlo (400 ms en local) falla con la Mac cargada por agentes; en
   corridas en paralelo usar `KAIZEN_PERF_MS=2000`, como la CI.

## Cómo trabajar aquí

1. **git** solo funciona así en esta Mac (licencia de Xcode sin aceptar):
   `export DEVELOPER_DIR=/Library/Developer/CommandLineTools` y luego `git ...` normal.
   El `isolation: 'worktree'` del harness NO sirve; los worktrees se crean a mano con `git worktree add`
   y se les copia `node_modules` con `cp -cR` (clon de APFS, es instantáneo).
2. Revisar que Arturo no haya movido nada: `git fetch && git log --oneline origin/alumora -3`.
   El 22 sep seguía en `5dd569b`, ya contenido en `main`. Si toca `App.jsx`, hay que portarlo a
   `src/legacy/App.legacy.jsx` o a la feature correspondiente.
3. Cada stream corre `node scripts/check-ownership.mjs <id>` antes de entregar, y el orquestador
   corre el modo `--coverage` con la lista de streams vivos antes de arrancar una fase.
4. Puertos por stream: web 5300+2i, API 8100+i. Nunca 8002, 5180 ni 4180, que son los del dueño.
   Máximo 3 agentes con navegador a la vez (24 GB de RAM). Cada agente corre e2e con su
   `E2E_PORT=53xx`; el 5291 por omisión choca.
5. **Recorrido real antes de cerrar una fase**: `preview_start` de `newkaizen-replay` y
   `newkaizen-preview` (o `-frontend`), portafolio de ejemplo desde /bienvenida y Lighthouse con
   `node scripts/lighthouse-sesion.mjs <rutas>`. Los mocks de e2e aceptan cualquier query: el 422 de
   Riesgo y el CLS de 0.66 solo salieron así. Un 500 `ReplayMiss` es hueco de grabación, no del código:
   se graba en una capa (`--set 2026-09-22,2026-09-22-recorrido --grabar-en 2026-09-22-recorrido`).
6. **Agent o Workflow (ultracode)**: con Opus 5.5 en esfuerzo alto, Agent con 4 o 5 agentes por tanda
   y hora límite fue suficiente para revisar y corregir; ultracode vale para lo que es ancho y
   uniforme (auditoría completa, una fase nueva con 8 o más streams independientes, verificación
   adversaria de cada hallazgo). Detalle en la memoria del proyecto.

## Decisiones ya tomadas (no re-discutir)

- **Todo va a `analizavende`. Nada a `main`** hasta que exista el servicio nuevo de Render con el
  backend v2, porque el login nuevo depende de él y Vercel publica `main` solo.
- Se construye nuevo feature por feature. El legado se monta con `LegacyPage` mientras tanto y se
  borra en M3; no se parte `App.jsx`.
- El frontend se queda en JS, con JSDoc y `tsc --checkJs` solo en `src/lib`. Las gráficas son SVG
  propias, sin librería.
- **Backend:** FastAPI + uvicorn, un worker, endpoints síncronos; scrypt de la stdlib para
  contraseñas y JWT HS256 para la sesión.
- **Convención de unidades del API v2:** todo porcentaje va como fracción, los cambios de tasa en pb,
  y cada respuesta trae `meta` con `asOf`, `source`, `stale` y `fallback`. Ya no hay 17.5 ni 8.6 %
  silenciosos.
- **Texto visible:** español de México, sin guiones largos (— ni –) y sin lenguaje de compra/venta
  como recomendación. Los datos faltantes se muestran como `s/d`, y el signo menos es U+2212.
- Se descartó el léxico Loughran-McDonald: solo existe en inglés y su licencia comercial no está clara.
- Monte Carlo: 176,729.14 es con aportación constante; con aportación que crece 1 % al mes da
  180,292.00. El CETES efectivo anual correcto es .117455.

## Trampas conocidas

- **Correr `npm run check` antes de cada push, no solo las pruebas.** El 22 de septiembre se empujó
  un cambio con las pruebas en verde y el lint sin correr: `process` no está declarado como global
  para `src/`, y la CI se cayó por dos errores de `no-undef`. Las cinco compuertas son un solo
  comando y tardan menos de un minuto.
- **Nada de topes de tiempo duros en pruebas unitarias.** La prueba de desempeño de Monte Carlo
  exigía menos de 400 ms y el corredor de GitHub midió 613. La meta del spec se conserva en
  desarrollo, en CI el techo es de 2,000 ms (ajustable con `KAIZEN_PERF_MS`) y el tiempo medido se
  imprime siempre, para que una regresión real se vea en el log.
- **El verde de Vercel en esta rama no significa que haya construido.** El proyecto tiene activada la
  casilla "Ignored Build Step", así que cancela despliegues y los reporta como `success`. Lo que de
  verdad mide el código son los dos jobs de GitHub Actions. Aparte, el proyecto tenía el directorio
  de salida en `build` (de Create React App) y Vite escribe en `dist`: por eso los despliegues que sí
  corrían morían al final. Quedó fijado en `vercel.json` con `framework`, `buildCommand` y
  `outputDirectory`, que manda sobre el panel, pero **falta verlo construir de verdad una vez**.

- La herramienta Write está bloqueada para subagentes cuando escriben reportes; que usen heredoc.
- Playwright tiene que quedarse en 1.62.1: la 1.63 pide un Chromium que no está en caché.
- Yahoo limita por tasa: grabar una vez y reproducir en replay para todo lo demás.
- **Fixtures en capas:** `--set a,b` es el ORDEN de búsqueda y `--grabar-en b` es a dónde se GRABA.
  Para corregir una llamada que la base grabó vacía, la capa del stream va primero y se nombra como
  destino: `--set 2026-09-22-b3a,2026-09-22 --grabar-en 2026-09-22-b3a`. Escribir en el set base
  necesita `--permitir-base`. El set base tiene 444 llamadas, 34 de ellas vacías a propósito o por
  fallo del proveedor; la tabla por stream está en `docs/OWNERSHIP.md`.
- **Rutas stub:** llevan el decorador `@stub` y su router no anuncia la capacidad. Al implementar una
  se borran las dos líneas; las pruebas de contrato fallan por dato si te falta una.
- **Vitest no hereda `.env.local`**: se le vacían `VITE_SKIP_LOGIN` y `VITE_ALLOW_LEGACY` en
  `vitest.config.js`, porque esta Mac tiene `VITE_SKIP_LOGIN=true` y sin eso 6 pruebas de sesión y
  router fallan solo aquí.
- Los PNG del baseline llevan sufijo `-darwin`. En Linux (CI) se generan desde el mismo HAR con
  `--update-snapshots=all`, nunca regrabando.
- Hay bugs del backend viejo que los goldens conservan a propósito para la paridad: `^MXX` etiquetado
  como USD, el DXY de Stooq siempre falla, los empates del ranking de fórmula mágica y los guiones
  largos del texto v1. Se corrigen en v2, no en v1. El legado dibuja 76 guiones em visibles y usa
  `—` como dato faltante: eso se va con `src/legacy` en M3.
- El Render viejo (`app-4-everyone.onrender.com`) NO despliega desde este repo y sigue con código viejo.

## Lo que solo el usuario puede hacer

1. Pedirle a Arturo que no edite `App.jsx` por ahora y que después rebasee sobre `analizavende`.
2. ~~Sacar un token de Banxico SIE~~: hecho; vive en `.env.local` y NUNCA en el repo. Hay que ponerlo
   como `BANXICO_TOKEN` en Render: sin él las tasas MX salen por el respaldo de FRED y
   `/v2/rates/mx/inpc` contesta 503.
3. Crear el servicio nuevo en Render desde `render.yaml` (rama `analizavende`, health check en
   `/health`) con `SECRET_KEY`, `USERS` (hashes de `scripts/hash_password.py`), `ALLOWED_ORIGINS`,
   `BANXICO_TOKEN` y `AUTH_REQUIRED=true`.
4. Poner `VITE_API_URL` en Vercel: primero en Preview y, al hacer el corte, en Production. Después,
   merge a `main`.
5. Antes de cobrarle a alguien: revisión legal (avisos, privacidad, fuentes de noticias), cotización
   comercial de EODHD y decidir Supabase para cuentas, sincronización y empresas.
