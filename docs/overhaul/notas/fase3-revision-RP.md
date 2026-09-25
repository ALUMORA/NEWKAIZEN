# Revisión adversaria RP: Mi portafolio (F1) y plataforma de frontend (PF)

Stream RP, rama `ws/RP`, 25 de septiembre de 2026. Alcance: `src/features/portfolio/**` con
`e2e/portfolio.spec.js` (merge `60522de` y anteriores de F1) y lo que cambió el merge `1880746` (PF).
Cada defecto corregido lleva una prueba que falla con el código anterior (comprobado a mano en los
de finanzas, restaurando el archivo de HEAD).

## Veredicto por pantalla

| Pantalla | Veredicto | Motivo principal |
| --- | --- | --- |
| /portafolio/rebalanceo | fail, corregido | Con un libro de solo compras el plan desaparecía o pedía vender casi todo |
| /portafolio/rendimiento | fail, corregido | TWR con sesgo de decenas de puntos con compras frecuentes en emisoras con dividendos |
| /portafolio (resumen) | pass_with_issues, corregido | Emisoras del SIC compradas en pesos salían s/d; costo en pesos de USD mal ponderado |
| /portafolio/riesgo | pass_with_issues, corregido | Etiquetas: no decía que excluye efectivo; "exposición a dólares" mal descrita |
| /portafolio/movimientos | pass_with_issues, corregido | CSV con "1.234,56" se leía 1.23456 |
| PF (combobox, paleta, InlineLink, tax-mx, glosario, CSS) | pass_with_issues, corregido | Artículo de la LIF equivocado, texto fiscal engañoso, ids de opción repetibles |

## Hallazgos

### [blocker] Rebalanceo valuaba con el efectivo crudo, negativo en un libro sin depósitos. Corregido en `7436b53`
- `src/features/portfolio/pages/Rebalance.jsx:34` usaba `cashBalances`, que queda negativo cuando se
  registran compras sin depósito (lo normal al importar un CSV de compras). El resumen y el
  rendimiento usan `fundedCash`.
- Repro: WALMEX 100 a 60 y 100 a 70, sin depósito, metas 60/40, WALMEX a 65 y NAFTRAC a 55.2.
  Efectivo −13,000 más 13,000 invertidos da valor 0: `wholeShareRebalance` devuelve null y la
  página no mostraba plan ni explicación. Con precios arriba del costo es peor: A y B 100 a 50,
  hoy a 60, metas 50/50, el plan pedía **reducir 83 y 84 títulos** (todo) para "cubrir" −10,000.
- Arreglo: `rebalanceCash` en `lib/rebalance-view.js` (mismo `fundedCash` al día de hoy). Ahora el
  caso da reducir 80 WALMEX y aumentar 94 NAFTRAC. Pruebas: `rebalance-view.test.js` y la e2e
  "un libro de solo compras no pide reducir todo".
- Además, cuando no hay plan se dice por qué (falta precio de una posición o valor no positivo).

### [major] Rebalanceo registraba en la moneda de la cotización, no en la del lote. Corregido en `7436b53`
- `Rebalance.jsx:118-128` (antes): una emisora del SIC comprada en pesos que cotiza en USD se
  registraba como venta en USD sobre un lote en MXN, saltándose `validateTransaction`. El libro
  quedaba con costo en pesos contra producto en dólares.
- Arreglo: `planTransactions` registra en la moneda de la posición y, si hace falta tipo de cambio
  y no lo hay, bloquea el registro y lo dice. Prueba en `rebalance-view.test.js`.
- También: el plan esperaba en silencio si fallaba `/v2/fx`; ahora se muestra `ErrorState` con
  reintentar, y el plan no se calcula hasta tener el tipo de cambio cuando hay algo en dólares.

### [major] TWR sesgado con cierres ajustados por dividendos. Corregido en `c6cb734`
- `src/features/portfolio/lib/performance-view.js` (`computePerformance`). El pedido abierto 4 de
  F1 describía un doble conteo "a lo mucho por lo que suman los dividendos". Es peor y es otro
  mecanismo: cada compra entra como flujo al precio real pagado, pero se valúa al cierre ajustado,
  que está debajo por los dividendos futuros; la diferencia se anota como pérdida contra lo que ya
  había. Con compras frecuentes el error se acumula y **ocurre aunque no registres dividendos**.
- Simulación (104 semanas, 3 % anual en dividendos trimestrales, cierres ajustados al estilo Yahoo,
  script en el scratchpad de la sesión) contra el TWR real con cierres sin ajustar:

  | Compras | Real | Antes | Sin dividendos | Ahora |
  | --- | --- | --- | --- | --- |
  | una | 28.40 % | 36.34 % | 29.13 % | 29.13 % |
  | cada 4 semanas | 29.09 % | 13.74 % | 6.95 % | 29.13 % |
  | cada semana | 31.30 % | 5.55 % | −0.77 % | 31.45 % |
  | trimestral | −1.87 % | −6.27 % | −11.93 % | −1.78 % |

  Solo quitar los dividendos (lo que proponía el pedido) empeora el caso con compras.
- Arreglo: para el TWR, libro sin dividendos cobrados (van dentro del cierre ajustado como
  reinvertidos) y cada compra y venta tomada al cierre del corte en que cae (`tradeGapFlows`: la
  diferencia entre precio del movimiento y cierre entra como flujo; la comisión sigue siendo
  rendimiento). Lo que queda de error (0.1 a 0.7 pp) es reinvertido contra efectivo.
  Valor, ganancia y XIRR usan dinero real: llevan el efectivo de los dividendos y, si el libro
  arranca en ceros dentro de la ventana, parten de lo aportado y no del primer cierre ajustado
  (antes la ganancia perdía el movimiento del día de la primera compra). "Cómo leer estos números"
  y `docs/metodologia/portafolio.md` lo dicen.
- Pruebas: `performance-view.test.js`, caso "comprar seguido no se anota como pérdida" (antes
  −4.2 %, ahora 0 exacto) y `tradeGapFlows`. Los cierres sin ajustar por dividendos siguen siendo
  la salida exacta (pedido 4 de F1, que dejé anotado como mitigado).

### [major] Costo en pesos de posiciones en USD ponderado por cantidad. Corregido en `25e0fda`
- `avgFx` de `src/lib/finance/ledger.js` pondera el tipo de cambio por títulos (probado así allá).
  Con compras a precios distintos descuadra: 10 a 100 USD con 17 y 10 a 200 con 20 costaron
  57,000 pesos, pero 20 × 150 × 18.5 = 55,500. Afectaba "Ganancia no realizada" del resumen y el
  efecto precio y cambiario de Rendimiento.
- Arreglo dentro de la feature: `lib/cost-fx.js` recorre el libro con las reglas del costo
  promedio y da el tipo de cambio ponderado por costo. No toqué `ledger.js`; si A1 prefiere
  cambiar `avgFx`, la prueba de `ledger.test.js:86` fija el comportamiento actual.

### [major] Resumen: emisora del SIC comprada en pesos salía s/d con un aviso de error. Corregido en `2c04a11`
- `lib/summary-view.js:29-35` (antes): si la cotización venía en USD y la compra en MXN, el
  resultado salía s/d y la página decía "Revisa la moneda en Movimientos". Es como la mayoría
  compra acciones de EE. UU. desde México, y Rendimiento y Rebalanceo sí lo valuaban.
- Arreglo: resultado en pesos (valor de hoy con el FIX del día contra lo pagado en pesos), columna
  en MXN y aviso informativo, no de error. Prueba actualizada en `summary-view.test.js`.

### [major] PF: fuente de la retención de intereses citaba la LIF 2026 art. 21. Corregido en `ad8fbff`
- `src/lib/finance/tax-mx.js:32`. Verificado con el texto del PDF oficial de la LIF 2026 (Cámara
  de Diputados): "Artículo 24. Durante el ejercicio fiscal de 2026 la tasa de retención anual
  [...] será del 0.90 por ciento". La tasa 0.009 estaba bien. Prueba en `tax-mx.test.js`.

### [major] PF: glosario decía que los dividendos del extranjero "siguen el tratado". Corregido en `ad8fbff`
- `src/content/glossary.js:1139` (término nuevo `rendimiento-por-dividendo`), y lo mismo en
  `:819` y `:1540`. A una persona física residente le aplica además 10 % en México (LISR art.
  142, fr. V); el tratado solo rige la retención del país de origen.

### [minor] Corregidos
- Riesgo (`5c5bae1`): la descripción no decía que las medidas excluyen el efectivo; "Exposición a
  dólares" decía "emisoras que cotizan en USD" pero cuenta la moneda del libro (lo del SIC en pesos
  no entra). PnlCard: "Solo mueve lo que cotiza en dólares" tenía el mismo problema. IsrCard: la
  retención por dividendos se calcula como si el monto capturado fuera bruto; ahora lo dice.
- Movimientos (`4432dc3`, luego `parseLocaleNumber`): `parseCell('1.234,56')` de
  `src/features/portfolio/lib/tx-csv.js:69` daba 1.23456 en silencio (también lo reportó otro
  agente). Por pedido del orquestador mezclé `analizavende` en `ws/RP` (`4c13708`) y `parseCell`
  ahora delega en `parseLocaleNumber` de `src/lib/csv.js`, el mismo de la bienvenida. Al cambiar
  salió un defecto del helper compartido: `parseLocaleNumber('0,375')` daba 375 porque aceptaba un
  grupo de miles que empieza en 0; corregido en `src/lib/csv.js` con su caso en `csv.test.js`. No
  se fuerza la coma decimal en archivos con punto y coma: la prueba existente de F1 trae uno con
  "1,000" de miles.
- PF `search-combobox.js:25` y `palette-model.js:75` (`ad8fbff`): `BRK.B` y `BRK-B` daban el mismo
  id de opción (ids repetidos, `aria-activedescendant` ambiguo, aviso de key de React). Ahora el
  id es inyectivo; `WALMEX.MX` sigue siendo `sym-WALMEX_MX`.
- PF `SearchCombobox.jsx:104` (`ad8fbff`): durante `probing`/`waking` anunciaba "no está disponible";
  ahora "Conectando con el servidor…".
- PF `tax-mx.js:125,272,299` (`ad8fbff`): una tasa mayor que 1 (porcentaje en vez de fracción) se
  aceptaba y multiplicaba por 100; ahora cae a la de ley. Un 0.9 que quiso decir 0.9 % no se
  puede distinguir de 90 %, eso no lo cubre.
- F5-5 (`74ed2de`): `.kz-table-scroll` ya tenía `position: relative` en la primitiva desde
  `fa20b7c`; quité el parche de `watchlist.css` y `e2e/portfolio.spec.js` comprueba el estilo
  computado de cada marco de tabla en Movimientos. `watchlist.spec.js` sigue en verde.
- F5-6 (`7436b53`): `noHorizontalScroll` de `portfolio.spec.js` comparaba contra
  `window.innerWidth`, que en mobile crece con el desborde; ahora contra `page.viewportSize()`.

### [minor] Abiertos
- `src/lib/finance/tax-mx.js:105` (`inpcFactor`): un INPC que baja da factor menor que 1 y sube
  el impuesto. CFF art. 17-A fija 1 como mínimo para actualizar contribuciones; no confirmé que
  aplique igual al costo de acciones del art. 129, así que lo dejo para el dueño o su contador. Hoy
  no hay serie de INPC, así que no afecta pantalla.
- Resumen: el cambio del día de lo que cotiza en USD usa el tipo de cambio de hoy también para
  ayer (no incluye el movimiento del peso del día).
- Resumen: posiciones sin fecha de corte y efectivo al día de hoy; un movimiento con fecha futura
  cuenta en posiciones pero no en efectivo.
- Resumen: si hay efectivo en USD y no hay tipo de cambio, también se deja fuera el efectivo en
  pesos. Solo pasa mientras carga o con `/v2/fx` caído, que ya muestra error.
- ISR: dividendos de emisoras extranjeras (10 % adicional, art. 142 fr. V) no se estiman.
- Alta en USD: el prellenado usa el FIX de la fecha de la operación; para efectos fiscales se usa
  el publicado en el DOF, que es el del día hábil anterior. Decisión de producto.
- Pedidos 1, 2, 3, 5, 6 y 7 de `docs/requests/F1.md` siguen como estaban.

## Compuertas corridas (números reales)
- `npm run check` (lint, typecheck, Vitest, build, bundle) en verde antes de los commits de
  código: 77 archivos y 2020 pruebas antes de mezclar `analizavende`; 80 archivos y 2059 pruebas
  después, con el último commit. Bundle inicial 135.07 kB gzip de 180 (75 %). En la primera
  corrida falló solo `montecarlo.test.js` por tiempo (carga de la máquina 26.7); aislado pasa 77/77.
- `E2E_PORT=5301 npx playwright test e2e/portfolio.spec.js`: 50 pasan, 2 se saltan (capturas sin
  `F1_CAPTURE_DIR`), desktop 1440x900 y mobile 390x844, axe WCAG 2.1 AA en claro y oscuro. Antes
  de los cambios: 48 pasan y 2 se saltan.
- `shell.spec.js`, `research-search.spec.js`, `dev-ui.spec.js` con el mismo puerto: 87 pasan, 23 se
  saltan (los de baseline). Después de la mezcla, `portfolio`, `learn` (cubre /watchlist sin el
  parche, con scroll horizontal) y `shell`: 153 pasan, 9 se saltan.
- Capturas revisadas a mano de rendimiento y resumen en desktop y mobile (`F1_CAPTURE_DIR`).
