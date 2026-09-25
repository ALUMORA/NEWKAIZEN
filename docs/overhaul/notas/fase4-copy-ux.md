# Fase 4: revisión de texto visible (copy) y UX de todas las rutas (stream UX)

Rama `ws/UX`, 25 de septiembre de 2026, de 15:13 a 16:00 MST. Base: `644a10c`.
Método: barrido mecánico con grep (guiones largos, lenguaje de compra y venta, faltantes, formato
numérico, términos), lectura de los textos de cada ruta y del API v2 que llegan a pantalla, y
revisión del render en 1440x900 y 390x844 con las capturas de los specs (`F1/F2/F3B/F3C/F5/C3_CAPTURE_DIR`)
más un spec temporal (no commiteado) para login, 404, ficha, comparar, estados vacíos del
portafolio y una auditoría axe `target-size` (WCAG 2.2) en las 26 rutas.

## Veredicto por pantalla

| Ruta | Veredicto | Notas |
| --- | --- | --- |
| /login | pass (corregido) | Sin salida para quien no tiene usuario: ahora liga a Aprender y legales (0296b2f). |
| /mercados | pass (corregido) | Primeros pasos para quien entra sin portafolio (b94a619); avisos del panorama legibles (7395d66). |
| /mercados/mexico | pass (corregido) | "contra el dato anterior" se encimaba sobre la columna de al lado a 1440 (90ba2f6). |
| /mercados/cetes, /mercados/noticias | pass | Carga, vacío y error con reintento. |
| /portafolio | pass (corregido) | Eyebrow "MI PORTAFOLIO" repetía el h1 (bfeac88). Vacío con salida a la bienvenida. |
| /portafolio/movimientos | pass (corregido) | Columna "Acciones" del botón Borrar pasa a "Opciones" (1ffd164). |
| /portafolio/rendimiento, /riesgo, /rebalanceo | pass | Vacíos con salida; títulos de pestaña ahora "... del portafolio". |
| /investigar | pass | |
| /investigar/:symbol (ficha) | pass (corregido) | Sector, país y descripción de Yahoo en inglés (0b78b75); título de pestaña por emisora (d67eb88). |
| /investigar/comparar | pass | Tabla ancha con scroll propio en 390. |
| /screener, /formula-magica, /fibras | pass (corregido) | "Fórmula Mágica" en mayúsculas de título; "La señal" pasa a "La etiqueta"; avisos del API (69f78da, c7bc998). |
| /herramientas/optimizador, /backtest, /simulador | pass (corregido) | Sin liga visible entre ellas en móvil (d25cd81); "cartera" por "portafolio" para el tuyo (bfeac88); por qué está deshabilitado "Mi portafolio hoy" (0296b2f). |
| /watchlist | pass (corregido) | El h1 decía "Lista de seguimiento" y la navegación "Watchlist": unificado (d67eb88). |
| /bienvenida | pass (corregido) | El CSV decía "símbolo" y el resto de la app "clave" (bfeac88). Sin liga en la navegación: ver propuesta 1. |
| /aprender, /aprender/:termino, /aprender/metodologia/:guia | pass_with_issues | Títulos de pestaña propios (d67eb88); guías sin notas para programadores (636a749). Sale del shell: propuesta 2. |
| /legal/* | pass | |
| 404 | pass | Con y sin sesión, salida a Mercados o a login. |

## Hallazgos corregidos

Cada uno con su prueba (Vitest, pytest o aserción e2e) que falla antes y pasa después.

1. [major] Títulos de pestaña repetidos y en mayúsculas de título. `/aprender` y `/aprender/:termino`
   se llamaban "Aprender"; todas las fichas "Ficha de la emisora"; "Fórmula Mágica" (nav: "Fórmula
   mágica"); "Riesgo", "Movimientos" sin contexto. Nuevo `src/app/pageTitle.js` (`usePageTitle`), que
   RootLayout respeta solo para la ruta que lo pidió: "Ficha de WALMEX.MX", "Volatilidad",
   "Metodología: Backtest". `src/app/titles.test.jsx` exige títulos únicos, mayúscula de oración y sin
   guiones largos. d67eb88.
2. [major] "Watchlist" en la navegación, el título y el screener contra "Lista de seguimiento" en el
   h1. Unificado a "Lista de seguimiento" (la palabra `watchlist` queda como alias en la paleta). d67eb88.
3. [major] Móvil: la barra inferior lleva a la portada de cada sección, y Backtest, Simulador, Riesgo,
   Rebalanceo, Comparar, FIBRAs y Fórmula mágica no tenían liga visible (solo la paleta). Nuevo
   `src/app/shell/SectionNav.jsx`: tira de páginas hermanas solo bajo 768 px, con la activa marcada y
   desplazada a la vista. d25cd81, 5e7724b.
4. [major] Primera experiencia: al entrar se llega a /mercados y nada apuntaba a /bienvenida si no
   abrías Mi portafolio. `FirstSteps.jsx` en Mercados, se va sola con un portafolio o con "Ahora no"
   (guarda `settings.onboardingDone`). b94a619.
5. [major] Avisos del API que enseñaban cosas internas en pantalla: rutas de pruebas
   (`tests/unit/b2b/test_banxico_live.py`), `verified: false en el catálogo`, `BANXICO_TOKEN`, el
   código `UPSTREAM_UNAVAILABLE` y "corrida" con claves de Yahoo sueltas ("Sin dato de ^HSI").
   `kaizen_api/domain/rates.py`, `markets.py`; con más de cinco faltantes se cuentan en vez de listar
   treinta y tantos. 7395d66, 69f78da, c7bc998.
6. [major] `/mercados/mexico` a 1440: "−25 pb contra el dato anterior" se encimaba sobre la cifra de
   la columna de al lado (el `nowrap` de `.kz-delta` alcanzaba al texto de la pista).
   `src/styles/components.css`. 90ba2f6.
7. [major] Ficha: sector, industria, país y descripción llegan de Yahoo en inglés sin aviso. Sector y
   país pasan a español (`src/features/research/yahoo-labels.js`); la descripción en inglés se anuncia
   y lleva `lang="en"`. 0b78b75.
8. [minor] Término de la clave de pizarra: "clave" en tablas y formularios contra "símbolo" en
   errores del storage, del ledger, del rebalanceo, del cliente del API, de la bienvenida y del API v2.
   Unificado a "clave" (y "emisora"). bfeac88, 76b60ab.
9. [minor] "Mi cartera hoy", "Tu cartera" en Backtest y Optimizador para el portafolio del usuario.
   Regla: "portafolio" es el tuyo; "cartera" queda para las mezclas teóricas del optimizador. bfeac88.
10. [minor] ISR: "1 ventas no traen fecha", "Se descartaron 1 ventas", "Caducaron 700.00 de pérdidas".
    Plurales y monto con `fmtMoney`. bfeac88.
11. [minor] "Acciones" como grupo de la paleta y columna del libro: en bolsa son títulos. "Opciones". 1ffd164.
12. [minor] Login sin salida para quien aún no tiene usuario; backtest con "Mi portafolio hoy"
    deshabilitado sin decir por qué. 0296b2f.
13. [minor] "El proveedor no respondió por: X" ("responder por" es otra cosa): "Sin respuesta del
    proveedor para: X". 69f78da.
14. [minor] Guías de metodología en /aprender con "Nota para quien programe la interfaz" y rutas de
    archivos. 636a749.
15. [minor] Tira de mercado: "VIX s/d s/d". Un solo s/d. c103a2f.
16. [minor] Eyebrow "MI PORTAFOLIO" sobre el h1 "Mi portafolio"; "Cada símbolo aparece una sola vez"
    en el panorama. bfeac88, 7395d66.
17. [minor] Prueba vieja: `test_market_calendar.py` esperaba "Cerrado por Duelo nacional" y la
    etiqueta ya dice "Cerrada" desde F2-7b. a60bbbe.

## Barrido mecánico, sin hallazgos

- Guiones largos: cero en `src/` (fuera de pruebas y comentarios), `src/content/glossary.js` y
  `docs/metodologia/*.md`. Quedan en `kaizen_api` solo en el legado v1 congelado por goldens
  (`sec_edgar.get_edgar_financials`, `screeners/momentum.get_momentum`, `insiders.get_insiders`,
  `multiples.get_dcf`), que la app nueva no llama.
- Compra y venta: solo como tipo de movimiento, estrategia "Comprar y mantener" o descargos
  ("no recomienda comprar ni vender"). Nada de "oportunidad", "infravalorada" ni BUY/SELL en pantalla.
- Faltantes: ningún `—`, `N/A` ni `NaN` como marcador; todo pasa por `MISSING = 's/d'`. Cifras con
  `toFixed` fuera de `format.js` solo en mensajes de validación de pesos (ver abierto 5).
- Tuteo: sin formas de usted. `target-size` (WCAG 2.2): 0 violaciones en las 26 rutas, 1440 y 390.

## Abierto, como propuesta

1. [major] La bienvenida no está en la navegación. Con FirstSteps ya hay pista en Mercados, pero
   después de "Ahora no" solo se llega desde Mi portafolio vacío. Propuesta: entrada "Primeros pasos"
   en el menú del usuario. Decisión de IA.
2. [major] Aprender y los legales son rutas públicas fuera del shell: con sesión, la liga "Aprender"
   de la barra lateral y cada InfoTip con liga sacan al usuario de la app (sin barra lateral ni
   inferior) y "Ir a la app" vuelve a /mercados, no a donde estaba. Propuesta: montar las públicas
   dentro del shell cuando hay sesión. Cambio de arquitectura de rutas (`router.jsx`).
3. [minor] Anglicismos que dejé por ser nombres de producto: "Screener", "Backtest", "walk forward",
   "Tracking error". Propuesta para el dueño: "Filtro de emisoras" y "Prueba histórica", o mantenerlos
   con su término del glosario.
4. [minor] Industria de la ficha sigue en inglés (Yahoo trae ~150 valores): hace falta un catálogo
   en el API como `SECTOR_ES`.
5. [minor] Porcentaje con y sin espacio: `fmtPct` da "7.25%" y varios textos escriben "10 %" o
   "100 %"; y mensajes de validación con `toFixed` (`lib/finance/optimize.js:69`,
   `walkforward.js:113`) que podrían mostrar el guion ASCII en un peso negativo. Unificar con
   `format.js` en una pasada.
6. [minor] El panorama repite "Panorama" (eyebrow y sección), y el eyebrow del h1 de la ficha dice
   "Ficha de la emisora" mientras la pestaña dice "Ficha de WALMEX.MX". Cosmético.
7. [minor] Otras notas del API para operación siguen en pantalla ("El SIE no confirmó la serie
   SF43936..."). Son honestas, pero conviene separar notas de operación de notas para quien invierte.
8. [minor] La tira de mercado en 390 corta la segunda cifra a media palabra; es desplazable, pero un
   degradado al borde avisaría que hay más.

## Compuertas (números reales de la última corrida)

- `npm run check`: lint y typecheck limpios, Vitest 88 archivos y 2090 pruebas en verde, build y
  bundle "Dentro del presupuesto (75 % usado)", JS inicial 135.35 kB gzip. Nota: la prueba de
  desempeño `montecarlo.test.js` (400 ms) falló dos veces con la máquina a carga 10 por los otros
  agentes (451 ms); sola pasa 77 de 77. No es de este stream.
- pytest: todo verde (`.venv/bin/python -m pytest -q`), `ruff check .` limpio.
- e2e con `E2E_PORT=5313`: markets 40 de 40, shell 21 de 21, app 51 de 51 (1 saltada), portfolio
  50 (2 saltadas), research 32 (4 saltadas), research-search y screeners 71 (21 saltadas),
  tools-opt y learn en verde; corrida base antes de tocar nada: 288 pasadas, 4 saltadas.
