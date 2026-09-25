# Revisión RT: Herramientas (F4) y hallazgos abiertos de F5

Fecha: 25 de septiembre de 2026. Rama `ws/RT`, worktree `05 NEWKAIZEN.wt/RT`, puerto e2e 5305.
Alcance: `src/features/tools/**` (merge `62e8e7a`, integrado sin revisión), `e2e/tools*.spec.js`, y
los pendientes de la revisión de F5 (CSV, watchlist, páginas públicas, liga del simulador).

## Veredicto por pantalla

| Pantalla | Veredicto | Resumen |
| --- | --- | --- |
| `/herramientas/optimizador` | pass_with_issues | Matemática sana (pesos suman 1, sin negativos, caja respetada, 1 activo no truena). Se corrigió la tasa libre de riesgo del respaldo y dos avisos engañosos. Queda una decisión de producto sobre la prima país. |
| `/herramientas/backtest` | pass | Cuadra al decimal 12 con un cálculo a mano en Python. Se corrigieron la etiqueta de la tasa de respaldo y el aviso de referentes descartados. |
| `/herramientas/simulador` | pass | Reproduce 176,729.14 y 180,292.00 (prueba unitaria y e2e). Se corrigió una nota que describía mal el crecimiento de la aportación y un rango de validación. |
| `/bienvenida` (CSV) | pass | Acepta coma decimal y avisa columnas desconocidas. |
| `/watchlist` | pass | La tendencia ya dice periodo, tipo de cierre, moneda y fuente. |
| `/aprender`, `/legal/*` | pass | Barra con salida a la app: "Entrar" sin sesión, "Ir a la app" con sesión vigente. |

## Hallazgos

### F4, Herramientas

1. **[major] La tasa libre de riesgo del respaldo de FRED se convertía con el plazo equivocado y se
   presentaba como "CETES 28".** `src/features/tools/optimizer.js:67` (antes), `backtester.js:125`,
   `components/AssumptionsForm.jsx:31`, `components/BacktestResults.jsx:70`.
   Sin token de Banxico, `/v2/rates/rf` sirve la interbancaria a 3 meses de la OCDE con
   `tenorDays: 91` y `fallback: true` (`kaizen_api/domain/rates.py:98` pide usar el plazo de la
   respuesta). El cliente usaba 28 días fijos: con 10 % daba 10.675 % efectivo en vez de 10.513 %
   (16 pb), y el texto decía "CETES 28 al X % simple" y "Sobre CETES 28 de cada semana".
   Repro: respuesta de rf con `tenorDays: 91, fallback: true`; la pista del optimizador decía CETES 28.
   **Corregido** en `07175c6`: `src/features/tools/riskfree.js` (plazo de la respuesta y nombre),
   betas, backtest y textos. Prueba: `src/features/tools/riskfree.test.js` (fallaba antes).

2. **[minor] El simulador enlazaba a `/aprender` en vez de a su guía.** `pages/SimulatorPage.jsx`.
   Existe `docs/metodologia/simulador.md`, servida en `/aprender/metodologia/simulador`.
   **Corregido** en `07175c6`; e2e `tools.spec.js` revisa el href.

3. **[minor] La nota del simulador decía que la aportación "crece una vez al año"; la librería la
   crece mes con mes** (`C_t = C·(1+g)^(t/12)`, `src/lib/finance/montecarlo.js:437`). Es justo lo
   que produce 180,292.00 en un horizonte de un año. **Corregido** en `b7fac75` (nota y pista del
   campo); prueba que fija la semántica en `simulator.test.js` y e2e que revisa el texto.

4. **[minor] El retiro decía "entre 0.1 % y 30 %" pero aceptaba 0.05 %.** `simulator.js:44`.
   **Corregido** en `b7fac75`, prueba en `simulator.test.js` (fallaba antes).

5. **[minor] El optimizador listaba `NAFTRAC.MX` como emisora "que quedó fuera" cuando el API tiraba
   el IPC, que la persona no eligió** (se pide solo para las betas; el CAPM ya lo explica).
   `pages/OptimizerPage.jsx:55`. Lo mismo en el backtest con `SPY` cuando el referente era el IPC
   (`pages/BacktestPage.jsx:61`), con el texto "los demás pesos se reescalaron", que era falso.
   **Corregido** en `a601339` y `8d77bb9` con `droppedSymbols` (`optimizer.js`), prueba unitaria y
   dos e2e en `tools-opt.spec.js` (las dos fallaban antes).

6. **[minor] Historia corta sin explicación.** El panel es un INNER JOIN: una emisora recién
   listada recorta a todas y la pantalla solo decía "hacen falta 52 semanas". Ahora dice cuántas
   hay y por qué. **Corregido** en `a601339`, e2e "historia corta" (fallaba antes). Sigue sin poder
   nombrar a la emisora culpable porque `/v2/panel` no devuelve el rango de cada símbolo: pedido de
   API, abierto.

7. **[minor, verificado] La prima de mercado `DEFAULT_ERP = 0.0423` coincide con
   `matureMarketErp` de `kaizen_api/data/damodaran_2026.json` (vintage 2026-01).** Se agregó una
   prueba que lee el JSON para que no se desalineen (`assumptions.test.js`, `a601339`).
   La tasa libre de riesgo es CETES 28 del SIE con su fecha en la pista del campo (o el respaldo,
   ahora nombrado como tal).

8. **[minor, abierto, decisión del dueño] Prima país inconsistente entre el optimizador y el DCF.**
   `optimizer.js:36`: el CAPM del optimizador usa CETES + β·4.23 % y no suma prima país ("CETES ya
   trae el riesgo soberano"). El DCF (`kaizen_api/domain/valuation/params.py:346`) usa bono a
   10 años menos el diferencial de incumplimiento, más mercado maduro MÁS prima país. La prima país
   de Damodaran es mayor que el diferencial de incumplimiento, así que el optimizador queda por
   debajo del DCF en un par de décimas por unidad de beta. Ninguno está mal escrito; conviene
   elegir uno y documentarlo en `docs/metodologia/optimizador.md`.

9. **[minor, abierto] La paridad de riesgo ignora la caja de pesos.** `optimizer.js:165`. Con
   máximo de 20 % y 6 emisoras dio 22.5 % a una. Está dicho en pantalla dos veces ("La paridad de
   riesgo no los usa"), así que no se tocó.

10. **[minor, abierto] "Rango probable" en compacto pierde casi toda la precisión** (`$1 M MXN a
    $4 M MXN` a 390 px). `pages/SimulatorPage.jsx:145`. Cosmético.

Comprobaciones que salieron bien (sin cambio):
- Pesos: mínima varianza, paridad y máximo Sharpe suman 1 a 12 decimales, sin negativos, dentro de
  la caja [0,1], [5 %,40 %], [0,20 %] y con la caja degenerada 1/N; con 1 activo devuelve peso 1 sin
  excepción (la pantalla pide 2 de todos modos); sin cartera por encima de la tasa, máximo Sharpe
  es null y la pantalla lo explica.
- Ledoit y Wolf: contracción de 2.6 % con 260 semanas y correlaciones distintas; el 100 % que se
  ve en las capturas es de los datos simulados del e2e (correlación igual por construcción).
- Backtest, caso a mano en Python (`scratchpad/bt_hand.py`), 60/40 en 8 semanas: comprar y
  mantener 1.068, CAGR 53.3604 %, volatilidad 25.2634 %, caída −5.2973 %; mezcla constante
  1.073078, CAGR 58.1623 %, volatilidad 24.8511 %. El JS cuadra a 12 decimales; quedó como prueba
  en `backtester.test.js`.
- CETES 28 al 11 % simple es 11.7455 % efectivo (act/360 capitalizado a 365).
- Estados de error, vacío y carga presentes en las tres páginas; sin guiones largos, sin lenguaje
  de compra y venta como recomendación, faltantes como `s/d`, sin hex nuevos.

### F5, hallazgos abiertos de la revisión anterior

11. **[major] El CSV de la bienvenida corrompía números con coma decimal.**
    `src/features/onboarding/sample.js:43` hacía `Number(text.replace(/[$,\s]/g, ''))`:
    `1.234,56` se volvía 1.23456 y `1234,56` se volvía 123456, callado. Las columnas desconocidas se
    tiraban sin aviso. **Corregido** en `19dc43f`: `parseLocaleNumber` y `detectDelimiter` en
    `src/lib/csv.js` (con punto y coma la coma siempre es decimal), `csvColumns` en `sample.js` y un
    aviso en la pantalla. Pruebas en `src/lib/csv.test.js`, `sample.test.js` y e2e en
    `learn.spec.js` que importa un CSV de Excel en español y revisa 1234.56 en el storage.

12. **[major, abierto para RP] El mismo defecto vive en el parser del portafolio.**
    `src/features/portfolio/lib/tx-csv.js:69`: con coma y punto quita todas las comas, así que
    `1.234,56` se lee como 1.23456. No lo toqué (pantalla y librería de portafolio son del stream
    RP); el arreglo es llamar a `parseLocaleNumber` de `src/lib/csv.js`, que ya tiene pruebas.

13. **[major] Las páginas públicas no tenían salida a la app.** `src/features/learn/PublicPage.jsx`.
    **Corregido** en `8bbef88`: barra con "Entrar" (a `/login`) sin sesión o con sesión vencida, e
    "Ir a la app" (a `/mercados`) con sesión vigente, usando `useSession` e `isExpired` de
    `src/lib/auth/session.js`; el router no se tocó. Pruebas en `PublicPage.test.jsx` (fallaban
    antes) y e2e en `learn.spec.js`; axe limpio en claro y oscuro, los dos viewports.

14. **[minor] La tendencia de la watchlist no decía periodo, fuente ni precio.**
    **Corregido** en `43a1926`: `src/features/watchlist/trend.js` arma el texto para lector de
    pantalla de cada fila (fechas, cierres diarios ajustados, moneda, cambio) y una nota visible bajo
    la tabla con el periodo y el `DataStatus` de la serie. Pruebas en `trend.test.js` y e2e.

## Compuertas

- `npm run check` (lint, typecheck, Vitest, build, bundle): verde, 78 archivos y **2046 pruebas**,
  JS inicial 133.66 kB gzip de 180 (74 %). Nota: la prueba de desempeño de Monte Carlo
  (`montecarlo.test.js:772`, techo local de 400 ms) marcó 628 ms en una corrida con otros agentes
  cargando la Mac; las corridas buenas se hicieron con `KAIZEN_PERF_MS=2000`, el techo de CI. No es
  un cambio de esta rama.
- e2e con `E2E_PORT=5305`: `tools.spec.js` + `tools-opt.spec.js` **38 pasaron** (12 de capturas se
  saltan sin `F4_CAPTURE_DIR`); `learn.spec.js` **84 pasaron**. Incluyen axe WCAG 2.1 AA en claro y
  oscuro, 1440x900 y 390x844, y la fixture de guardas (sin `console.error` ni respuestas >= 400).
- Capturas revisadas a mano (optimizador, backtest, simulador, aprender, legales, watchlist,
  bienvenida) en los dos viewports.
- Lighthouse (Brave, `vite preview` en 5305) sobre `/aprender`: escritorio 100/100/100/91
  (rendimiento, accesibilidad, buenas prácticas, SEO); móvil 94/100/100/91 (`formFactor: mobile`).
  Las herramientas no se pueden auditar con Lighthouse en local porque dependen del API simulado
  que solo existe dentro de Playwright.
- Backend: no se tocó, no se corrió pytest.
