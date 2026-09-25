# Fase 3, stream ADOPT: las pantallas usan los campos nuevos del API v2

Rama `ws/ADOPT`, 25 de septiembre de 2026. Punto de partida: `979608c` (merge del stream API). Cada
pantalla lee el campo nuevo cuando viene y conserva el método anterior como respaldo para un API que
todavía no lo manda (todo el contrato nuevo es aditivo y opcional). Cambios de JSX mínimos y sin
reescribir copy, salvo el texto que dejaba de ser cierto.

## Veredicto por pantalla

| Pantalla | Pedido | Veredicto | Commit |
| --- | --- | --- | --- |
| Capa de API (`src/lib/api`) | soporte de lo de abajo | pass | `a29191d` |
| /portafolio/rendimiento, TWR | F1-4, `adjust=splits` | pass_with_issues | `2be59b3` |
| /portafolio/rendimiento, ISR | F1-3, INPC | pass_with_issues | `2be59b3` |
| /herramientas/optimizador | F4, `/v2/assumptions` | pass | `8e792a6` |
| /mercados (estado de las bolsas) | F2-7a, `lastClose` | pass | `fc49aa9` |
| /mercados/cetes y /mercados/mexico | F2-2 y F2-3 | pass | `fc49aa9` (mexico ya estaba) |
| /screener/fibras | F3c-2 y F3c-3 | pass | `8365ec9` |
| /screener/formula-magica | F3c-2 (`ebitSource`) | pass | `8365ec9` |
| Pedidos marcados como adoptados | | pass | `cbe8198` |

## Detalle

### Capa de API (`a29191d`)
- `src/lib/api/endpoints.js`: `getPanel` acepta `adjust: 'splits'` y solo lo manda si se pide;
  `getInpc({ start, end })` y `getAssumptions()`. `src/lib/api/queries.js`: `inpcQuery` y
  `assumptionsQuery` (frescura de fundamentales) con sus llaves. Prueba de URLs en
  `endpoints.test.js`. Nota: `src/lib/api/**` es de S2 en `scripts/ownership.json`; el cambio es
  aditivo (tres funciones y dos llaves) y no toca nada existente.

### F1-4: TWR con cierres sin ajustar por dividendos
- Decisión: con la capacidad `panel.splits`, `Performance.jsx:55` pide el panel del libro (MXN y USD)
  con `adjust=splits` y la referencia en un tercer panel (`Performance.jsx:62`) con rendimiento
  total, para que las dos series cuenten dividendos (el libro por su efectivo, la referencia por el
  ajuste). Si ese panel de referencia falla, se usa la del panel del libro antes que tumbar la
  página.
- `performance-view.js:245` (`computePerformance`, opción `adjustment`): con `'splits'` el TWR se mide
  sobre el libro completo, así que cada dividendo cuenta una vez, por su efectivo. La mitigación de
  RP (TWR sin dividendos) **se conserva como respaldo**: solo corre si el panel no contesta
  `adjustment: 'splits'` (`panelAdjustment`, `performance-view.js:216`, exige que todos los paneles
  con precios lo digan; un API viejo ignora el parámetro y contesta sin el campo). `tradeGapFlows`
  se conserva en los dos modos: con cierres crudos ya no corrige un sesgo, pero sigue siendo la
  convención de tomar cada movimiento al cierre de su corte, que es lo que dice "Cómo leer".
- Repro en Vitest: emisora a 100, fecha ex con pago de 2 y cierre de 98, dos compras y el
  dividendo. Con `'splits'` el TWR es 0 exacto; la mitigación sobre los mismos cierres daría −2 %.
- "Cómo leer estos números" (`HowToRead.jsx`): el aviso de dividendos decía que los cierres vienen
  ajustados y el TWR no suma el efectivo; en modo `splits` eso deja de ser cierto y se cambia por
  "van sin ajustar por dividendos, así que el TWR, el valor, la ganancia y el XIRR cuentan su
  efectivo una sola vez". Con el respaldo se queda el texto anterior. El resto del texto sigue
  siendo cierto y no se tocó.
- Las pruebas se esperan al sondeo de /health antes de pedir el panel, para no pedirlo dos veces con
  llaves distintas.
- [minor, abierto] `docs/metodologia/portafolio.md:81-88` todavía describe solo la mitigación con
  cierres ajustados. Es de A5; conviene agregar que con `panel.splits` se usan cierres crudos.
- [minor, abierto] Los dos detalles que dejó abiertos el stream API siguen aplicando: en `1wk` el
  deshacer el ajuste es aproximado (la ventana de más de un año usa semanal), y un símbolo sin
  `adjclose` en Yahoo inflaría los cierres viejos.

### F1-3: INPC para el ISR
- `performance-view.js:383` (`inpcStart`): pide la serie desde el mes de la compra más vieja entre
  las ventas en pesos, no 26 años; sin ventas con fecha no se pide nada. `isrView(transactions,
  inpc)` (`:400`) pasa la serie a `isrOnGains` y marca `inpc: true`.
- `Performance.jsx:75`: solo con la capacidad `rates.inpc`, sin reintento. Con 503 (sin token de
  Banxico) o sin la capacidad, `IsrCard.jsx` deja el aviso de siempre ("Todavía no tenemos la serie
  mensual del INPC"). Con la serie, muestra las notas de `isrOnGains`, que ya dicen cómo se actualizó
  y cuántas ventas quedaron sin actualizar si falta un mes.
- Repro e2e: compra de enero 2025 a 60, venta de 50 a 66 en septiembre 2026, INPC 104/100: ISR
  $18.00 (sin INPC, $30.00). Y la variante con 503 conserva $30.00 y el aviso.
- [minor, abierto, lo había dejado RP] `src/lib/finance/tax-mx.js:91` (`inpcFactor`): un INPC que
  baja da factor menor que 1 y sube el impuesto. Hasta hoy no se alcanzaba porque no había serie;
  **ahora sí es alcanzable** con una venta después de un mes de deflación. Decisión del dueño o su
  contador (CFF art. 17-A fija 1 como mínimo para contribuciones).

### F4: prima de mercado de `/v2/assumptions`
- `optimizer.js:51` (`marketPremium`): la de la ruta si llegó; `DEFAULT_ERP` si el servidor no
  anuncia `assumptions` o la ruta falla (o manda un `erp` inválido); null mientras llega.
  `assumptions.js`: la prima pasa al mismo esquema que la tasa libre de riesgo (`erpPct` +
  `erpTouched`): sin tocarla manda la del API; escrita, manda la persona, y un botón la regresa.
  Mientras llega no hay error visible, pero el CAPM no se calcula (`useOptimizer.js`).
- El campo dice la fuente y la fecha: "Aswath Damodaran, NYU Stern, vintage enero 2026, actualizada
  el 5 ene 2026. Es la misma de la valuación." Con el respaldo: "Respaldo guardado en la app
  (Damodaran, prima de mercado maduro, enero de 2026) porque el servidor no la envió." Si
  `meta.stale`, lo dice.
- Repro e2e (`tools-opt.spec.js`): con la ruta, 4.61 del mock en lugar de 4.23; escribir 6 y volver;
  sin la capacidad y con la ruta en 500, 4.23 declarado como respaldo.

### F2-7a, F2-2 y F2-3
- `overview-model.js:65` (`exchangeTiming`): la fecha de "Cierre vie 18 sep" sale de
  `marketStatus.<bolsa>.lastClose`; sin el campo o en null, del `asOf` más nuevo del grupo como
  antes. Sin cambio de JSX. Repro e2e: el 16 de septiembre (BMV 15, NYSE 16) con renglones del 18:
  antes las dos decían "vie 18 sep", ahora "mar 15 sep" y "mié 16 sep".
- `cetes-calc.js:23` (`cetesRows`): los CETES se reconocen por `tenorDays` cuando el renglón trae el
  campo; por texto e identificador solo con un API anterior. Repro: una serie "Diferencial CETES 28
  contra la tasa objetivo" con `tenorDays: null` salía como un segundo renglón de 28 días; ya no.
- `verified` y `stale` por serie ya se leían por renglón (`shared.js:39-42`, `MexicoPage.jsx:51`); no
  había nada que adivinar. Revalidado, sin cambio.

### F3c-2 y F3c-3
- `screenerNotes.js:86` (`rowNotes`): motivos de las s/d desde `FibraRow.notes`; un renglón con
  `notes: []` ya no hereda la nota general que lo nombra. `screenerNotes.js:69`
  (`ebitFallbackRows`): la insignia "EBIT de respaldo" sale de `MagicRow.ebitSource === 'ebit_row'`.
- `fibras.js:130` (`referenceRate`): la tarjeta de la tasa toma valor, fecha, fuente, respaldo y
  plazo de `rate`; con `rate: null` no hay tasa. El respaldo de la tarjeta ahora es el de la tasa,
  no el `meta.fallback` de toda la respuesta (que también se prende por los precios).
- Repro e2e: `meta` dice FRED y 2026-08-01 pero `rate` dice Banxico y 2026-09-18: la tarjeta dice
  "CETES 28 días" y "Fuente: Banxico, dato del 18 sep 2026". La nota larga de FMTY14.MX de `meta.notes`
  ya no aparece en su renglón; aparece la de `row.notes`.
- **¿Se puede borrar el parseo de `meta.notes`?** Todavía no: el cliente sigue sirviendo contra el
  API que esté desplegado, y hasta que producción traiga la fase 3 (merge de `ws/API` y deploy del
  backend) las respuestas vienen sin `notes`, `ebitSource` ni `rate`. Después de ese deploy se
  pueden borrar `notesFor` como respaldo en `rowNotes`, `ebitFallbackSymbols`, `rateDate` y
  `rateSource` (con sus pruebas) sin cambiar nada visible. `splitRateNotes` y `generalNotes` se
  quedan: separan las notas generales, que siguen siendo texto.

## Abierto para otros
- A5: `docs/metodologia/portafolio.md:81-88` (TWR con `adjust=splits`).
- Dueño o contador: factor INPC menor que 1 (arriba).
- S2: revisar los agregados a `src/lib/api/**` al integrar.
- `/portafolio/riesgo` y el backtest siguen con cierres ajustados, que es lo correcto para medir
  riesgo y rendimiento total; no se tocaron.

## Compuertas (números reales)
- `npm run check` después de F1, F4 y F2: exit 0; 83 archivos, 2082, 2086 y 2089 pruebas de Vitest en
  verde; JS inicial 135.21 kB gzip de 180 (75 %).
- Después de F3c: 2093 de 2094. La única falla es
  `src/lib/finance/montecarlo.test.js:772` (desempeño: 460 a 500 ms contra una meta de 400) con la
  máquina en carga promedio 13 por los otros agentes; es un archivo que no toqué y aislado pasa
  77/77 (`npx vitest run src/lib/finance/montecarlo.test.js`). Lint, typecheck, build y bundle en
  verde en esa misma corrida.
- e2e con `E2E_PORT=5315`, desktop 1440x900 y mobile 390x844:
  - `e2e/portfolio.spec.js`: 54 pasan, 2 se saltan (capturas).
  - `e2e/tools-opt.spec.js`: 34 pasan, 8 se saltan (capturas).
  - `e2e/markets.spec.js`: 42 pasan.
  - `e2e/screeners.spec.js`: 31 pasan, 5 se saltan (capturas).
