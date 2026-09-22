# Fase 2: entrega por stream (22 de septiembre de 2026)

Cada stream construyó en su worktree y corrió sus propias compuertas. La ronda de revisión
independiente se cortó a propósito por costo: solo alcanzaron a revisarse algunos streams, y lo que
se ve aquí es lo que reportó cada uno, más lo que el orquestador verificó al mergear (M2).
Las notas completas de cada quien están en su propio texto, abajo.

## A1

Implementé los 10 archivos de A1 en /Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN.wt/A1 (rama ws/A1): _util.js, returns.js, stats.js, performance.js, benchmark.js, rates.js, risk.js, backtest.js, fx.js e index.js, con 456 pruebas nuevas en 8 archivos *.test.js y 8 scripts de referencia en Python (scripts/golden/*_golden.py, corridos con .venv-golden) que generan tests/golden/*.json con 277 casos.

Cada respuesta conocida del spec está como prueba propia con toBeCloseTo de 6 a 12 dígitos: simple [.10, −.10, .10] y Σlog = ln 1.089; alignPanel A/B con inner join (returns A [.21,.10], B [.10,.10]); sd .0158114 y vol semanal .114018; CAGR .259921 y geométrico −.133975; Sharpe .632456 y 4.560702; Sortino .6 y 4.32666; MDD −.333333 con pico 1, fondo 4, recuperación 5; VaR/CVaR histórico .05/.05 al 95 % y .04/.045 al 90 %; paramétrico .052311/.077032; regresión β 1.65, α −.0015, R² .972321; TE .0442568 e IR 2.93740; CETES .0021321 a 7 días y .117455 efectiva anual; effectiveN 2.631579; mezcla constante .9975 contra comprar y no mover .995; desglose 8,700 = 5,100 de precio + 3,600 de tipo de cambio.

Dos hallazgos de implementación que valen la pena: (1) ⌈n(1−α)⌉ en punto flotante da 2 en vez de 1 para n=20 y α=.95 (20·(1−.95) = 1.0000000000000009), lo que sacaba el VaR al 95 % de la segunda peor observación y no de la peor; se corrige redondeando a 12 cifras significativas antes del techo, en JS y en el golden de Python por igual. (2) La aproximación de Acklam sola se movía en el sexto decimal del VaR paramétrico, así que normalInvCdf lleva un paso de refinamiento de Halley con una normalCdf por serie sin cancelación; contra scipy.stats.norm.ppf queda dentro de 1e−11.

Nada de A1 entra todavía al bundle (lo confirmé con grep sobre dist/assets: nadie importa la librería fuera de sus pruebas), así que el presupuesto sigue en 106.63 kB gzip de 180. No hay páginas ni servidores que revisar en este stream: es librería pura, sin React, sin fetch, sin Date.now() adentro de los cálculos y sin puertos abiertos.

### Commits

- `2eaab3e feat: base de la librería financiera, con alineación por fecha y sin rellenar huecos`
- `d19d47f feat: estadística de muestra y desempeño con CAGR, Sharpe, Sortino, caídas y VaR`
- `a0af307 feat: comparación contra índice en la misma moneda y tasa libre de riesgo con CETES 28`
- `3ac015a feat: riesgo del portafolio, backtest honesto y desglose de precio contra tipo de cambio`
- `f2b1b07 feat: barril de la librería financiera con el API de A1 y derivePositions`
- `f4a8eb9 docs: nota de A1 para el merge, con las exportaciones del barril que faltan por habilitar`

### Compuertas que reportó

- **npm run lint**: exit 0. 3 problems (0 errors, 3 warnings), los 3 avisos heredados de react-hooks/exhaustive-deps en src/legacy/App.legacy.jsx (líneas 1128, 1196, 1879), iguales a los de G1. Cero avisos en mis archivos.
- **npm run typecheck**: exit 0, sin salida (tsc -p jsconfig.check.json sobre src/lib/**).
- **npm run test**: exit 0. Test Files 26 passed (26), Tests 829 passed (829), 1.31 s. Antes de A1 eran 373; las 456 nuevas son mías.
- **npx vitest run src/lib/finance**: exit 0. Test Files 8 passed (8), Tests 456 passed (456). Por módulo: returns 45, stats 82, performance 84, benchmark 43, rates 96, risk 32, backtest 32, fx 42.
- **.venv-golden/bin/python scripts/golden/{returns,stats,performance,benchmark,rates,risk,backtest,fx}_golden.py**: Los 8 corrieron: returns 19 casos, stats 59, performance 54, benchmark 21, rates 80, risk 14, backtest 9, fx 21 (277 en total). Después de regenerarlos, 'git status --porcelain' salió vacío: los JSON son byte a byte los commiteados.
- **npm run check (lint + typecheck + test + build + bundle)**: exit 0. Build en 444 ms. JS inicial gzip 106.63 kB contra 180 de presupuesto (59 % usado), CSS 14.80 kB, diferido 47.86 kB.
- **node scripts/check-ownership.mjs A1**: ✓ A1 (ws/A1): 35 archivo(s), todos dentro de su propiedad.
- **.venv/bin/ruff check .**: All checks passed! (incluye los 8 scripts nuevos de scripts/golden/).
- **grep -lE 'alignPanel|cetesPerPeriod|riskContributions|pnlDecomposition' dist/assets/*.js**: Sin coincidencias: la librería de A1 todavía no entra al bundle porque nadie la importa fuera de sus pruebas. Por eso el presupuesto no se movió.
- **grep -rnE 'Date\.now|fetch\(|from .react|require\(' src/lib/finance/*.js**: Solo dos coincidencias, las dos dentro de comentarios que describen la regla. Cero usos reales.
- **grep -rnP '[\x{2014}\x{2013}]' src/lib/finance/ scripts/golden/**: Ninguno: no hay guiones largos ni en código ni en comentarios ni en docs/requests/A1.md.

### Pendientes que dejó

- El bloque comentado del final de src/lib/finance/index.js (12 líneas 'export ... from' de A2, A3 y A4) tiene que descomentarse en el merge, módulo por módulo, conforme existan. Si se descomenta algo que no existe, truenan 'npm run build' y 'npm run typecheck'. Está escrito en el propio archivo y en docs/requests/A1.md.
- La prueba 'el barril index.js' de src/lib/finance/returns.test.js compara la lista EXACTA de exportaciones con Object.keys(api). Al habilitar cada línea del bloque comentado hay que agregar esos nombres a la lista de la prueba, o falla. Es a propósito, para que el barril y su prueba no se separen, pero el orquestador tiene que saberlo antes de mergear.
- index.js no tiene archivo de prueba propio en scripts/ownership.json (ni _util.js). Por eso la prueba del barril vive dentro de returns.test.js. Si O prefiere un src/lib/finance/index.test.js, hay que agregarlo a los globs de A1 primero.
- rfSeriesForDates devuelve (number|null)[], con null en los periodos sin tasa vigente, pero sharpe, sortino y treynor exigen una serie completa del mismo largo (perPeriodSeries rechaza huecos). Quien los junte tiene que decidir: recortar el tramo sin tasa, o mostrar s/d. No lo resolví por A1 porque la decisión es de producto, no de la librería.
- captureRatios usa la definición compuesta (producto de (1+r) en los periodos de subida, entre lo mismo del índice). Hay casas que la reportan aritmética. Si A5 documenta una definición distinta en el glosario, hay que alinear las dos.
- drawdowns.durationPeriods va del pico a la recuperación, y si nunca se recuperó, del pico al último dato. No es lo mismo que la duración pico-fondo, que es lo que algunas fichas llaman 'duración'. Está documentado en el JSDoc, pero conviene que A5 use la misma palabra.
- El barril reexporta derivePositions desde ledger.js, que hoy es el stub de costo promedio de S2. Mientras A4 no lo reemplace, quien importe derivePositions del barril obtiene el stub: no trae P&L realizado, ni efectivo, ni FX por operación. El contrato mínimo que sí cumple está en src/lib/portfolio/ledger.contract.test.js.
- tests/golden/ suma 564 KB para A1. Con A2, A3 y A4 encima puede crecer bastante. Si a O le estorba, bajar el tamaño es cambiar los n de los scripts (ya los recorté una vez) y regenerar; no hay nada que reescribir.

### Notas de entrega

# A1: librería financiera base (returns, stats, performance, benchmark, rates, risk, backtest, fx)

Worktree `/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN.wt/A1`, rama `ws/A1`, 6 commits sobre `analizavende`.

## Cómo se importa

```js
import { simpleReturns, alignPanel, summary, sharpe, cetesPerPeriod, pnlDecomposition } from '@/lib/finance'
```

Todo sale del barril `src/lib/finance/index.js`. `_util.js` es interno y a propósito no se reexporta.

## Reglas que valen para TODA la librería

- Módulos ES puros: sin React, sin fetch, sin `Date.now()` adentro de un cálculo. Las fechas entran como argumento.
- **Cuando no alcanzan los datos se devuelve `null`**, nunca 0 ni NaN, para que la interfaz muestre `s/d`. Cada función documenta su n mínimo en el JSDoc.
- **Una entrada sucia también devuelve `null`**: NaN, Infinity, `null`, cadenas, arreglos de largos distintos, matrices que no cuadran. Un dato malo no se propaga.
- **Ningún `k` escondido.** Todo lo que anualiza recibe `k` explícito (252 diario, 52 semanal, 12 mensual). `periodsPerYear(interval)` lo da.
- Estadística de muestra con **n−1** siempre.
- **Fracciones, no porcentajes**: `.11` es 11 %. Los cambios de tasa en pb solo salen de `changeInBp`.
- **Una sola moneda por serie.** La librería no convierte sola: lo que necesita tipo de cambio lo recibe como argumento (ver `fx.js`). Comparar una serie en pesos contra una en dólares es el error que estamos corrigiendo.
- Ninguna función formatea: devuelven números. El formato es de `src/lib/format.js`.

## API pública, firma por firma

### returns.js
- `simpleReturns(prices) -> number[]|null` — largo n−1. Mínimo 2 precios. null si un precio anterior es 0.
- `logReturns(prices) -> number[]|null` — mínimo 2 precios, todos positivos.
- `cumulative(returns) -> number[]|null` — trayectoria de 1 peso, **largo n+1, empieza en 1**. Con `[]` devuelve `[1]`.
- `totalReturn(returns) -> number|null` — ∏(1+r)−1. Con `[]` devuelve 0.
- `periodsPerYear(interval) -> number|null` — `'1d'` 252, `'1wk'` 52, `'1mo'` 12, `'3mo'` 4, `'1y'` 1; null si no se reconoce.
- `inferInterval(dates) -> '1d'|'1wk'|'1mo'|null` — mediana de los huecos: ≤3 días diario, ≤10 semanal, más mensual. Mínimo 2 fechas ISO.
- `isInterval(x) -> boolean`.
- `alignPanel(seriesBySymbol, { minDates = 0 }) -> { dates, values: {[sym]: number[]}, dropped: string[] }` — **inner join por fecha ISO, SIN rellenar hacia adelante**. Nunca devuelve null: un símbolo mal armado (fechas no ISO, desordenadas, repetidas, valores no finitos, largos distintos) se va a `dropped` y los demás siguen. `minDates` es opcional: si la intersección queda corta, saca de uno en uno al símbolo con menos historia propia (empates por nombre, se va el último alfabéticamente) hasta alcanzarlo o quedar con un solo símbolo.
- `panelReturns(panel, { log = false }) -> { dates, values } | null` — **los rendimientos se calculan DESPUÉS de alinear**. `dates` son las de llegada de cada periodo, o sea `panel.dates.slice(1)`.

### stats.js
- `mean(values)` (mín 1), `variance(values)` (n−1, mín 2), `stdev(values)` (mín 2).
- `covariance(x, y)` (n−1, mín 2, largos iguales), `correlation(x, y)` (null si alguna serie es constante).
- `quantile(sorted, q) -> number|null` — **tipo 7**, el de numpy y R. Pide el arreglo YA ordenado. q en [0,1].
- `ols(y, x) -> { alpha, beta, r2, residualStd, n } | null` — **mínimo 3** observaciones (con 2 no existe `residualStd`); null si x es constante.
- `normalPdf(z)`, `normalCdf(z)`, `normalInvCdf(p)` — la inversa es Acklam más un paso de Halley, dentro de 1e−11 de `scipy.stats.norm.ppf`. `normalInvCdf` pide p en (0,1) abierto.

### performance.js
- `cagr(startValue, endValue, years)` — los tres positivos.
- `cagrFromReturns(returns, k)` — (∏(1+r))^(k/n)−1. **Con k=1 da el promedio geométrico por periodo.** null si el capital llega a 0 o menos.
- `annualizedVol(returns, k)` — sd(n−1)·√k, mínimo 2.
- `sharpe(returns, rfPerPeriod, k)` — `rfPerPeriod` acepta **número o serie del mismo largo**. Devuelve la anualizada; con k=1 la del periodo. Mínimo 2. null si la sd de los excesos es ~0.
- `sortino(returns, rfPerPeriod, k, marPerPeriod = rfPerPeriod)` — **DD sobre TODAS las n**, no solo las negativas. Anualizada. null si nunca hubo observación bajo el MAR.
- `drawdowns(values) -> { series, maxDrawdown, peakIndex, troughIndex, recoveryIndex|null, durationPeriods } | null` — `series[t] ≤ 0` siempre, `maxDrawdown` negativo. `durationPeriods` va del pico a la recuperación (o al último dato si no la hubo). Pide 2 valores positivos.
- `calmar(cagrValue, maxDrawdown)` — divide entre |MDD|; null si no hubo caída.
- `historicalVaR(returns, alpha)`, `historicalCVaR(returns, alpha)` — k = ⌈n(1−α)⌉ peores, **se devuelven como pérdida POSITIVA** (.05 = se puede perder 5 %). Mínimo 1.
- `parametricVaR(mu, sigma, alpha)`, `parametricCVaR(mu, sigma, alpha)` — normales, también pérdida positiva. `mu` y `sigma` son POR PERIODO.
- `percentile(values, q)` — ordena y luego interpola.
- `summary(returns, { k, rf = 0 }) -> { cagr, vol, sharpe, sortino, maxDrawdown, calmar, var95, cvar95, best, worst, positivePct, n, years } | null` — mínimo 2 periodos. **Cada campo puede venir null por separado** (p. ej. `calmar` cuando nunca hubo caída) sin tumbar el resto: dibujen `s/d` solo en ese dato.

### benchmark.js
Todo esto supone que el portafolio y el índice ya están en la **misma moneda y las mismas fechas**.
- `regress(portExcess, benchExcess, k = 1) -> { alpha, alphaAnnual, alphaAnnualArithmetic, beta, r2, residualStd, n } | null` — `alpha` es POR PERIODO, `alphaAnnual` = (1+α)^k−1 y `alphaAnnualArithmetic` = α·k. Mínimo 3.
- `blumeBeta(beta)` = .67β + .33.
- `trackingError(active, k)` = sd(n−1)·√k, mínimo 2.
- `informationRatio(active, k)` = media·k / TE; null si TE ~ 0.
- `treynor(portReturns, rfPerPeriod, beta, k)` — exceso promedio anualizado entre β; null si β ~ 0.
- `jensenAlpha(portReturns, benchReturns, rfPerPeriod, k) -> number|null` — **devuelve la alfa ANUAL compuesta**. Para la del periodo, β y R², usen `regress`.
- `captureRatios(port, bench) -> { up, down, upPeriods, downPeriods } | null` — compuesta: acumulado del portafolio entre acumulado del índice, en los periodos de subida y en los de bajada. Los periodos con índice exactamente 0 no cuentan de ningún lado. `up`/`down` salen null si no hubo periodos o si el denominador es ~0.
- `activeReturns(port, bench)`, `averageActive(port, bench)`.

### rates.js
- `cetesPerPeriod(annualYield, days, tenorDays = 28)` = (1 + y·plazo/360)^(días/plazo) − 1. **Base 360**, que es como se cotizan los CETES.
- `cetesEffectiveAnnual(annualYield, tenorDays = 28)` — lo mismo a 365 días. Con 11 % da .117455, no .11.
- `annualToPerPeriod(annualRate, k)` = (1+r)^(1/k) − 1.
- `changeInBp(from, to)` = (to−from)·10000. Es lo que hay que usar para los campos `*Bp` del API v2.
- `rfSeriesForDates(rfSeries, targetDates, interval, { maxStaleDays = 45, tenorDays = 28 }) -> (number|null)[] | null` — devuelve la rf **por periodo**, largo `targetDates.length − 1`. Usa la tasa vigente al **INICIO** de cada periodo (la última publicación con fecha ≤ el arranque), rellena hacia adelante solo las tasas hasta 45 días, y más allá deja `null` en vez de inventar. Usa los **días reales** entre fechas; `interval` es solo el respaldo cuando dos fechas consecutivas no dejan calcularlos.
- `MAX_STALE_DAYS` = 45.
- **Cuidado:** esta salida puede traer huecos y `sharpe`/`sortino`/`treynor` piden una serie completa. Recorten el tramo sin tasa o muestren s/d.

### risk.js
- `effectiveN(weights)` = 1/Σw²; `hhi(weights)` = Σw².
- `portfolioVol(weights, cov, k)` = √(wᵀΣw)·√k. La `cov` es **por periodo**, cuadrada y del tamaño de los pesos.
- `riskContributions(weights, cov) -> { marginal, contribution, percent, volatility } | null` — `contribution` suma exactamente `volatility` y `percent` suma 1. null si no hay riesgo que repartir.
- `exposureBy(positions, key) -> [{ key, value, weight }] | null` — agrupa `positions` (todas ya en la misma moneda, con campo `value`) por `currency`, `sector`, `country` o el que sea. De mayor a menor valor. **Una posición sin ese atributo cae en el grupo `key: null`**, que la interfaz dibuja como `s/d`; no inventa una categoría "otros". Si el total es ~0, los `weight` salen null y los `value` se conservan.
- `foreignExposure(positions, baseCurrency) -> number|null`.

### backtest.js
- `buyAndHold(pricePanel, initialWeights) -> { dates, values, returns, turnover, weights, rebalances } | null` — `pricePanel` es la salida de `alignPanel` (precios, una sola moneda). Los pesos se normalizan a 1. `values` empieza en 1 y tiene el largo de las fechas; `turnover` y `rebalances` son 0; `weights` son los FINALES, ya corridos.
- `constantMix(returnPanel, weights, rebalanceEvery = 1) -> {...} | null` — `returnPanel` trae **rendimientos** por periodo, `dates` son las de llegada. `rebalanceEvery` es un número de periodos, `'never'`, o `'monthly' | 'quarterly' | 'annual'` (estas tres **necesitan** `returnPanel.dates` del mismo largo que los rendimientos, si no devuelve null). `values` tiene **un elemento más** que `returns` y empieza en 1. `turnover` es la suma de Σ|w_objetivo − w_actual|/2 de cada rebalanceo. Una frecuencia que no se entiende devuelve null en vez de suponer.
- `withBenchmark(values, benchValues, { k }) -> { portReturns, benchReturns, active, totalPort, totalBench, excess, trackingError, informationRatio, n } | null`.
- `annualTurnover(turnover, periods, k)`, `weightsSum(weights)`.
- Propiedad probada: `constantMix(..., 'never')` da exactamente lo mismo que `buyAndHold`.

### fx.js
- `CURRENCIES` = `['MXN','USD']`. `MAX_FX_STALE_DAYS` = 7.
- `usdmxn` son **siempre pesos por dólar** (FIX de Banxico, SF43718). Nunca al revés.
- `toCurrency(amount, from, to, usdmxn) -> number|null` — **sin respaldo fijo**: si falta el tipo de cambio devuelve null, no 17.5. De una moneda a sí misma no pide tipo de cambio. Una moneda que no manejamos devuelve null, no pasa el monto tal cual.
- `pnlDecomposition({ quantity, price0, price1, fx0, fx1 }) -> { total, priceEffect, fxEffect, cross } | null` — `priceEffect = q(P₁−P₀)·X₀`, `fxEffect = q·P₁·(X₁−X₀)`, y suman exactamente `q·P₁·X₁ − q·P₀·X₀`. `cross` es siempre 0 por construcción (el término cruzado va dentro del efecto cambiario). **Para una posición que ya está en pesos, pasen `fx0: 1, fx1: 1`**: el efecto cambiario sale 0, que es lo correcto.
- `fxAt(fxSeries, date, { maxStaleDays = 7 }) -> { value, asOf, staleDays } | null` — arrastra la última publicación (Banxico no publica fines de semana ni festivos) pero solo hasta el límite.
- `convertSeries(values, usdmxn, from, to)` — un tipo de cambio por punto, no uno solo para toda la serie.
- `returnInBaseCurrency(localReturn, fx0, fx1)` = (1+r_local)·(X₁/X₀) − 1.

## Costuras

**Implementé:** los 10 archivos de A1 y su barril. `_util.js` es privado.

**Consumí sin tocar:** `src/lib/finance/ledger.js` (de A4), solo para reexportar `derivePositions` desde el barril. Hoy es el stub de costo promedio de S2, así que **no trae P&L realizado, ni efectivo, ni FX por operación** hasta que A4 lo reemplace. El contrato mínimo que sí cumple está en `src/lib/portfolio/ledger.contract.test.js`.

**No consumí:** `src/lib/rng.js` (A3) ni `src/lib/format.js`. Nada de A1 usa aleatoriedad ni formatea.

**Lo que falta en el merge:** `index.js` termina con un bloque comentado de 12 líneas `export ... from` para A2, A3 y el resto de A4. Hay que quitarles el `// ` conforme existan los módulos, y agregar esos nombres a la lista de la prueba `el barril index.js` de `returns.test.js`, que compara la lista exacta. Todo está escrito en `docs/requests/A1.md`.

## Cómo correrlo y probarlo

```bash
cd "/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN.wt/A1"
npm run lint && npm run typecheck && npm run test
npx vitest run src/lib/finance          # 456 pruebas, 8 archivos
node scripts/check-ownership.mjs A1
```

Regenerar los goldens (deben quedar byte a byte iguales, `git status` limpio después):

```bash
PY="/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv-golden/bin/python"
for m in returns stats performance benchmark rates risk backtest fx; do
  "$PY" "scripts/golden/${m}_golden.py"
done
```

Cada `*_golden.py` es autocontenido (repite su `clean`/`write` porque `scripts/golden/_util.py` no está en los globs de nadie) y usa **numpy y scipy como segunda opinión**, no una transliteración del JS: `np.var(ddof=1)`, `np.quantile(method='linear')`, `scipy.stats.linregress`, `scipy.stats.norm`. Cada JSON es `{cases:[{name, fn, input, expected, tol}]}`; el campo extra `fn` dice qué función llamar y cada `*.test.js` tiene su despachador.

## Limitaciones conocidas

- `alignPanel` nunca devuelve null: con panel vacío o sin traslape devuelve `{ dates: [], values: {...vacíos}, dropped }`. Revisen `dates.length` antes de graficar.
- El descarte por `minDates` es una heurística simple (el de menos historia primero). No busca el subconjunto óptimo.
- `captureRatios` usa la definición compuesta. Hay casas que la reportan aritmética; si A5 documenta otra, hay que alinear.
- `drawdowns.durationPeriods` es pico a recuperación, no pico a fondo.
- Nada aquí valida que dos series estén de verdad en la misma moneda: es responsabilidad de quien llama, con `fx.js`.
- `rfSeriesForDates` capitaliza siempre con la convención CETES base 360. Para una rf que no sea CETES (por ejemplo el respaldo de FRED `IR3TIB01MXM156N`), la conversión sigue siendo aproximada; conviene marcarla como respaldo en la interfaz, que es lo que ya pide el contrato v2 con `fallback: true`.
- Los goldens de A1 pesan 564 KB en `tests/golden/`. Bajarlos es cambiar los n de los scripts y regenerar.

## A2

Implemented the five A2 modules in /Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN.wt/A2 on branch ws/A2, with 157 new Vitest tests (530 total in the repo) and 55 golden cases generated from .venv-golden.

- src/lib/finance/linalg.js: matmul/transpose/matVec/dot/quadForm, Cholesky with escalating jitter, SPD solve, power-iteration lambda-max, cyclic Jacobi eigen, nearestPSD, plus the shared InvalidInputError and the assert* validators the other four modules use. 27 tests.
- src/lib/finance/covariance.js: sampleCov (n-1) and ledoitWolfConstantCorrelation, ported term by term from PyPortfolioOpt's _ledoit_wolf_constant_correlation including the detail that S uses T-1 while pi/theta use T. Matches CovarianceShrinkage(..., frequency=1).ledoit_wolf("constant_correlation") within 1e-10 on a fixed 60x5 panel and on 120x8 and 48x4 panels, all PSD. 22 tests.
- src/lib/finance/expected.js: capmExpected, historicalMean (carries its own Spanish "this is noisy" warning), jamesStein (Jorion 1986 Bayes-Stein), cross-checked against numpy at 1e-12 (my Cholesky solve vs numpy LU). 22 tests.
- src/lib/finance/optimize.js: exact box-simplex projection (bisection plus an exact final linear-piece correction), FISTA with adaptive restart and step 1/lambda-max, minVariance, meanVariance, efficientFrontier, maxSharpe (coarse tau scan then golden section), riskParity (cyclic coordinate descent). 66 tests, including 35 scipy goldens for 3-10 assets (SLSQP, and scipy.optimize.root for risk parity) all within 1e-6, with active caps and floors among them. Hand answers land at machine precision: min-var w1 .692308 (err 1.8e-15), sigma_p .166410, rho=.5 w1 .857143, tangency [.529412,.470588] (err 2.7e-10) with Sharpe .416667, risk parity [.6,.4] exact, and n=2 with u=.35 throws InfeasibleError.
- src/lib/finance/walkforward.js: walkForward with rolling or expanding estimation, hold-and-drift or per-period reset, and the look-ahead guard. 20 tests, including the spy strategy that records every row it was handed and asserts they are exactly the pre-hold rows, a "change the future and the earlier folds must not move a single weight" test, a mutation test proving the window is a copy, equal-weight OOS equal to a direct computation, and 6 goldens against a full numpy/scipy/PyPortfolioOpt reimplementation of the sweep.

Two defects found and fixed while testing, both real: the Ledoit-Wolf port emitted NaN across the whole matrix when any series had zero variance (PyPortfolioOpt does too), and isPositiveSemiDefinite rejected legitimately singular PSD matrices because Cholesky tests strict definiteness. Also hardened the FISTA step, because the Rayleigh quotient always underestimates lambda-max and a step slightly too large can diverge.

### Commits

- `0d2e752 feat: álgebra lineal chica para la librería financiera (Cholesky, Jacobi, potencia)`
- `21fb15b feat: covarianza muestral y contracción Ledoit-Wolf de correlación constante, con golden de PyPortfolioOpt`
- `41dcc2f feat: rendimientos esperados por CAPM, promedio histórico marcado como ruidoso y James-Stein`
- `9cce96b feat: optimizador convexo con FISTA y proyección símplex con caja, contra los goldens de scipy`
- `883d94d feat: validación walk-forward sin sesgo de anticipación, probada con una estrategia espía`
- `545b919 perf: frontera pareja en el eje de rendimiento y arranque caliente en el tangente`

### Compuertas que reportó

- **npm run lint**: 0 errores, 3 avisos (los tres heredados de src/legacy/App.legacy.jsx, idénticos a los de antes de empezar)
- **npm run typecheck**: limpio, sin salida (tsc -p jsconfig.check.json)
- **npm run test**: 23 archivos, 530 pruebas, todas pasan. 157 son mías: linalg 27, covariance 22, expected 22, optimize 66, walkforward 20
- **.venv-golden/bin/python scripts/golden/covariance_golden.py**: tests/golden/covariance.json: 6 casos (delta 0.651188 / 0.239961 / 0.551976 / 1.000000)
- **.venv-golden/bin/python scripts/golden/optimize_golden.py**: tests/golden/optimize.json: 35 casos (minVariance, maxSharpe y riskParity para n=3..10, más cajas activas, meanVariance y proyecciones)
- **.venv-golden/bin/python scripts/golden/expected_golden.py**: tests/golden/expected.json: 8 casos (w de James-Stein 0.175885 / 0.157407 / 0.127386 / 0.759786)
- **.venv-golden/bin/python scripts/golden/walkforward_golden.py**: tests/golden/walkforward.json: 6 casos (16 cortes y 196 periodos fuera de muestra en los de 300x5; 5 cortes y 18 periodos en el de 70x3)
- **git status --porcelain (después de regenerar los 4 goldens)**: vacío: los cuatro JSON se reproducen byte por byte
- **ruff check .**: All checks passed! (cubre los 4 guiones nuevos de scripts/golden/)
- **node scripts/check-ownership.mjs A2**: ✓ A2 (ws/A2): 19 archivo(s), todos dentro de su propiedad.
- **node bench (fuera del repo, n=20 activos, 260 semanas)**: Ledoit-Wolf 4.3 ms, minVariance 1.5 ms, riskParity 0.3 ms, maxSharpe 25 ms, efficientFrontier 30 puntos 73 ms, walkForward con maxSharpe 324 ms

### Pendientes que dejó

- `src/lib/finance/index.js` es de A1 y todavía no reexporta mis cinco módulos. Queda pedido en `docs/requests/A2.md`, con los dos choques de nombre que hay que resolver antes de hacer `export *`: mi `annualize(cov, k)` de covariance.js (propongo renombrarla a `annualizeCov` en el merge) y `InvalidInputError`, que debería ser una sola para toda la librería.
- Duplicados a propósito, para deduplicar en el merge: `meanAndSd` y `maxDrawdownOf` privadas en walkforward.js se van cuando exista `stats.js` y `performance.js` de A1. Al revés, A1 no necesita escribir la varianza del portafolio: ya es `quadForm(weights, cov)` de linalg.js.
- `ledoitWolfConstantCorrelation` se aparta de PyPortfolioOpt en dos casos degenerados, a propósito y documentado en el código y en la prueba: (a) con N=2 el objetivo ES la covarianza muestral, gamma sale cero y delta queda 0/0; PyPortfolioOpt devuelve 1 por la división entre cero y yo devuelvo 0, pero la matriz resultante es la misma; (b) una serie de varianza cero hace que PyPortfolioOpt contagie NaN a toda la matriz, y aquí esa serie sale del promedio de correlaciones y se trata como no correlacionada. Por eso los paneles del golden son de 3 activos o más.
- Los goldens del optimizador van a 1e-6 y los de walk-forward a 1e-7 porque ese es el piso de SLSQP con ftol 1e-16 y pulido, no el mío. Las respuestas conocidas a mano llegan a 1e-13 o mejor, salvo el tangente, que queda en 2.7e-10 porque sale de una sección áurea sobre tau.
- `riskParity(cov)` no acepta cajas (l, u), tal cual el spec. Si F4 necesita topes por activo en paridad de riesgo, hay que pedirlo: el descenso coordinado cíclico no las admite directo y habría que cambiar de método.
- `maxSharpe` y `efficientFrontier` suponen que la razón de Sharpe es unimodal a lo largo de la frontera parametrizada por tau, que es cierto para una covarianza definida positiva. Con una covarianza singular el barrido grueso de 41 taus es la única red: si alguna vez sale un caso raro, se sube `scan`.
- No verifiqué nada en el navegador porque A2 no dibuja nada: son módulos ES puros, sin React, sin fetch y sin Date.now(). No levanté ningún servidor, así que no quedó nada corriendo en 5308, 5309 ni 8104.

### Notas de entrega

ENTREGA COMPLETA DE A2. Worktree "/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN.wt/A2", rama ws/A2, 6 commits sobre analizavende, 19 archivos.

=== REGLAS QUE VALEN PARA LOS CINCO MÓDULOS ===
- Son módulos ES puros: sin React, sin fetch, sin Date.now(). Ninguno tiene aleatoriedad.
- ORIENTACIÓN DE LOS DATOS, siempre: `returnMatrix` es T x N, RENGLONES = PERIODOS, COLUMNAS = ACTIVOS. Si la pasas transpuesta no truena, te da basura.
- UNIDADES: `mu`, `rf` y la covarianza tienen que venir en la MISMA periodicidad (todo anual, o todo por periodo). Los pesos son fracciones que suman 1. Nada de porcentajes.
- DATOS INSUFICIENTES devuelven `null`, nunca 0 ni NaN, para que la UI muestre "s/d".
- ENTRADA INVÁLIDA (NaN, Infinity, renglones de distinto largo, dimensiones que no casan) LANZA `InvalidInputError` de linalg.js, con mensaje en español mostrable al usuario y sin guiones largos. Es a propósito que se distinga de "no hay datos": son dos cosas distintas y la UI las trata distinto.
- `InfeasibleError` de optimize.js es aparte: el problema no tiene solución con esas cajas.

=== src/lib/finance/linalg.js ===
`class InvalidInputError extends Error` (name 'InvalidInputError')
`isFiniteNumber(x) -> boolean`, `isFiniteVector(v) -> boolean`, `isFiniteMatrix(m) -> boolean`
`assertVector(v, name?) -> number[]` (copia), `assertMatrix(m, name?) -> number[][]` (copia), `assertSquare(m, name?) -> number[][]`
`zeros(n)`, `zerosMatrix(rows, cols)`, `identity(n)`, `transpose(a)`, `dot(a, b)`, `matmul(a, b)`, `matVec(a, v)`
`quadForm(v, a) -> number` (es wᵀΣw: A1, tu `portfolioVol` es Math.sqrt de esto, no lo reescribas)
`symmetrize(a)`, `isSymmetric(a, tol=1e-10)`, `frobeniusNorm(a)`
`cholesky(a, {jitter=0, maxAttempts=10}) -> {L, jitter} | null` (null si no es simétrica o no se pudo factorizar ni con jitter)
`isPositiveDefinite(a) -> boolean` (Cholesky, estricta), `isPositiveSemiDefinite(a, tol=1e-12) -> boolean` (por eigenvalores, acepta singulares)
`solveSPD(a, b) -> number[] | null`
`largestEigenvalue(a, {maxIter=2000, tol=1e-14}) -> {value, vector, iterations, converged} | null` (null si la matriz es toda ceros). OJO: el valor sale del cociente de Rayleigh y SIEMPRE se queda corto; si lo usas como paso, súmale margen. El eigenvector converge a ~1e-8, el valor a ~1e-12.
`jacobiEigen(a, {maxSweeps=100, tol=1e-15}) -> {values, vectors}` (valores ascendentes, vectores por columna, como numpy.linalg.eigh)
`nearestPSD(a) -> number[][]` (recorta eigenvalores negativos a cero, método "spectral" de PyPortfolioOpt)

=== src/lib/finance/covariance.js ===
`sampleCov(returnMatrix) -> number[][] | null`. Divisor T-1, igual que pandas .cov(). Mínimo T = 2, si no `null`.
`ledoitWolfConstantCorrelation(returnMatrix) -> {cov, shrinkage, target, meanCorrelation} | null`. `shrinkage` es delta en [0,1]; `target` es la matriz F; `meanCorrelation` es r̄ (null con un solo activo). Mínimo T = 2. `cov` siempre sale semidefinida positiva. ESTE es el estimador por omisión del optimizador, no `sampleCov`.
`annualize(cov, k) -> number[][]`. Multiplica la MATRIZ por k (252 diaria, 52 semanal, 12 mensual). Lanza si k <= 0.
`corrFromCov(cov) -> number[][] | null`. `null` si algún activo tiene varianza cero o negativa: hay que quitar esa serie antes de optimizar. Esto es lo que quiere el heatmap de correlación de F1.

=== src/lib/finance/expected.js ===
`capmExpected(betas, rfAnnual, erp) -> number[]`. mu_i = rf + beta_i * ERP. Todo en fracción anual. Es el valor POR OMISIÓN del optimizador.
`historicalMean(returnMatrix, k) -> {mu, perPeriod, k, periods, noisy, warning} | null`. `mu` es aritmético anualizado (media por periodo x k), NO es CAGR. `noisy` siempre true y `warning` trae el texto en es-MX listo para mostrar, con el número de periodos y años dentro. Mínimo T = 2. F4: esta función se ofrece DETRÁS de la advertencia, no como opción silenciosa.
`jamesStein(means, cov, T, {target='minVariance'|'average'}) -> {mu, shrinkage, target} | null`. Bayes-Stein de Jorion (1986). `target` de salida es el número hacia el que se encogió. Con un solo activo devuelve la media tal cual y shrinkage 0. `null` si Σ no se pudo factorizar.

=== src/lib/finance/optimize.js ===
`class InfeasibleError extends Error` (name 'InfeasibleError'). Mensaje en español listo para mostrar, por ejemplo "No hay solución: los pesos máximos suman 0.7000 y tendrían que sumar 1 o más. Con 2 activos y un tope de 0.3500 por activo no se llega al 100 %."
Las cajas `l` y `u` aceptan escalar O arreglo por activo, en TODAS las funciones. Por omisión l=0, u=1 (solo largos, sin tope).
`projectBoxSimplex(v, l=0, u=1) -> number[]`. Proyección euclidiana sobre {Σw=1, l<=w<=u}.
`minVariance(cov, {l, u, maxIter, tol}) -> {weights, variance, volatility, expectedReturn: null, iterations, converged}`
`meanVariance(mu, cov, tau, {l, u, maxIter, tol, start}) -> {weights, variance, volatility, expectedReturn, iterations, converged}`. tau >= 0; tau=0 es mínima varianza.
`efficientFrontier(mu, cov, {points=30, l, u, grid=160}) -> FrontierPoint[]` donde FrontierPoint = el objeto de arriba más `tau`. Ordenada de menor a mayor rendimiento esperado y repartida pareja EN EL EJE DE RENDIMIENTO, que es lo que se grafica. Con todos los mu iguales devuelve un solo punto.
`maxSharpe(mu, cov, rf, {l, u, scan=40, refine=100}) -> {weights, variance, volatility, expectedReturn, sharpe, tau, iterations, converged} | null`. `rf` va en la MISMA periodicidad que mu y cov. `null` si la volatilidad del mejor punto es cero.
`riskParity(cov, {budget=null, maxIter, tol}) -> {weights, riskContributions, variance, volatility, iterations, converged} | null`. `riskContributions` suma 1. `budget` reparte el riesgo desigual (se normaliza solo). NO acepta cajas. `null` si algún activo tiene varianza cero.

=== src/lib/finance/walkforward.js ===
`walkForward(returnMatrix, dates, options) -> resultado | null`
`dates` es OBLIGATORIO: arreglo de cadenas ISO del mismo largo que returnMatrix. Si no casan, lanza.
options: `{estimationWindow=156, holdPeriods=13, method='minVariance', window='rolling'|'expanding', rebalance='hold'|'period', covariance='ledoitWolf'|'sample', l=0, u=1, rf=0, k=52}`.
`method` es 'minVariance' | 'maxSharpe' | 'riskParity' | 'equalWeight' O UNA FUNCIÓN `(windowReturns, context) => number[]`, donde context = {estimationStart, estimationEnd, holdStart, holdEnd, dates, assets, fold}. `windowReturns` es una COPIA: modificarla no afecta nada.
`rf` es POR PERIODO y solo lo usa maxSharpe. `k` solo anualiza el resumen.
Devuelve `{dates, returns, values, rebalances, folds, summary}`; `rebalances` es [{fold, date, holdStart, holdEnd, estimationStart, estimationEnd, weights, note}] y `note` trae en español por qué hubo respaldo cuando lo hubo. `summary` = {periods, meanPerPeriod, volPerPeriod, annualizedReturn, annualizedVol, cumulative, maxDrawdown, k}; volPerPeriod y annualizedVol salen `null` con un solo periodo.
`null` si T < estimationWindow + 1.
GARANTÍA: estimationEnd === holdStart siempre, y la ventana es una copia de los renglones. Está probado con estrategia espía y con el experimento de cambiar el futuro.

=== COSTURAS QUE CONSUMÍ / OFREZCO ===
- No consumí ninguna costura de otro stream: A2 no importa nada fuera de sus cinco archivos. Tampoco usé `src/lib/format.js` ni `src/lib/rng.js`.
- Ofrezco los cinco módulos con las firmas de arriba, estables toda la fase 2.
- A1: `src/lib/finance/index.js` es tuyo y tiene que reexportar los cinco. El pedido, con los dos choques de nombre (`annualize` y `InvalidInputError`), está en docs/requests/A2.md.
- F4 (optimizador y backtest) es el consumidor principal. Receta típica: `alignPanel` de A1 -> `ledoitWolfConstantCorrelation` -> `annualize(cov, k)` -> `capmExpected(betas, rfAnual, erp)` -> `efficientFrontier` / `maxSharpe` / `minVariance` / `riskParity`, y `walkForward` para el resultado fuera de muestra. Los supuestos editables de la pantalla son `erp`, `rfAnnual`, y `l`/`u`.
- F1 (portafolio, vista de riesgo): `corrFromCov` para el heatmap, `quadForm` para la varianza, `riskParity(...).riskContributions` como referencia de contribución al riesgo.

=== CÓMO SE CORRE Y SE PRUEBA ===
  cd "/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN.wt/A2"
  npm run lint && npm run typecheck && npm run test
  npx vitest run src/lib/finance/          # solo lo mío: 157 pruebas
  node scripts/check-ownership.mjs A2
Regenerar los goldens (solo con el venv de referencia, es el único con PyPortfolioOpt y scipy):
  PY="/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv-golden/bin/python"
  for m in covariance expected optimize walkforward; do "$PY" scripts/golden/${m}_golden.py; done
  git status --porcelain     # tiene que quedar vacío
Los cuatro guiones generan sus datos con un congruencial lineal escrito adentro de cada archivo, NO con numpy.random, justo para que eso último sea cierto. No hay archivo compartido entre ellos porque ownership.json lista rutas exactas y `scripts/golden/_common.py` no sería de nadie.
Formato de los JSON: {cases: [{name, fn, input, expected, tol}]}. El campo `fn` dice qué función se prueba (hacía falta, porque cada archivo cubre varias).

=== LÍMITES CONOCIDOS ===
- `riskParity` no acepta cajas.
- `maxSharpe` y `efficientFrontier` suponen Sharpe unimodal a lo largo de la frontera; cierto con covarianza definida positiva.
- Costo con 20 activos y 260 semanas: minVariance 1.5 ms, riskParity 0.3 ms, maxSharpe 25 ms, efficientFrontier de 30 puntos 73 ms, walkForward con maxSharpe y 12 cortes 324 ms. Lo único que se acerca a molestar en el hilo principal es walkForward con maxSharpe; si F4 lo corre al vuelo, conviene un estado de carga.
- Con N=2 el delta de Ledoit-Wolf es degenerado (0/0) y devuelvo 0, no 1 como PyPortfolioOpt. La matriz es la misma; no lo muestren como "no se contrajo nada" sin leer el comentario del código.
- `historicalMean` NO es CAGR. Si F4 quiere enseñar rendimiento compuesto, use `cagr` de A1.

## A3

A3 entrega `src/lib/rng.js` (xoshiro128** sembrado desde un hash de texto, con uniform, normal, normals, int sin sesgo y reset), `src/lib/finance/montecarlo.js` (lognormalParams, perStepParams, quantilesOf, simulate con bandas de percentil por paso en nominal y real, bootstrap por bloques circulares, y el empaquetado para Web Worker) y `src/lib/finance/goals.js` (probabilityOfGoal, requiredContribution por bisección, retirementIncome como escenario). El worker opcional `montecarlo.worker.js` sí se hizo, porque salió barato: toda su lógica vive en `handleWorkerRequest` de montecarlo.js, que se prueba sin levantar un worker, y el archivo del worker es un cascarón de cuatro líneas que además se ejecuta de verdad en una prueba con el ámbito de worker sustituido.

Las tres respuestas conocidas del spec dan exacto: aportación constante 176,729.14322984166 contra 176,729.14322984172 esperado (diferencia 6e−11, `toBeCloseTo(..., 6)` pide 5e−7); aportación que crece 1 % al mes 180,292.00482111517, idéntico; y lognormalParams(.08, .15) da mu 0.06740782733107573 y sigma 0.13822600193200027, o sea .0674078 y .138226.

El objetivo de desempeño se cumple con holgura: 10,000 trayectorias por 360 pasos, 7 corridas en node v26, mejor 219.0 ms, mediana 225.4 ms, peor 233.0 ms, contra un presupuesto de 400 ms. La misma corrida con sigma=0 (sin generador ni exponencial por trayectoria) tarda 25.8 ms, así que la selección de percentiles y la contabilidad pesan unos 26 ms y los sorteos el resto. Los percentiles no se sacan ordenando: son selección múltiple (quickselect repartido) sobre una copia, que es lineal en vez de n·log n, y eso es lo que hace que quepa en el presupuesto.

Los goldens no son un calco del JS. `scripts/golden/montecarlo_golden.py` reimplementa xoshiro128** con enteros exactos de Python (las 4 semillas cuadran bit por bit en uint32 e int, y las normales a 1e−12 por la diferencia de un ulp entre las libm de Python y de V8), resuelve las trayectorias sin volatilidad con la suma cerrada de la anualidad y saca los cuantiles con numpy.percentile. `scripts/golden/goals_golden.py` despeja la aportación requerida con la fórmula de la anualidad, mientras el JS la resuelve por bisección sobre simulaciones: si la bisección tuviera sesgo se vería. Son 35 casos en montecarlo.json y 13 en goals.json.

Dos hallazgos reales salieron de las pruebas, no de leer el código: la validación de `history` con un rendimiento de −100 % quedaba después del corte por longitud, así que una historia corta e inválida devolvía null en vez de lanzar (se movió la validación arriba), y una aportación anual aparecía en `contributed` un índice antes de lo que yo esperaba, lo que obligó a dejar por escrito que `contributed[t]` es lo aportado ANTES del saldo del paso t.

### Commits

- `48c892c feat: generador sembrado xoshiro128** con uniformes, normales y enteros sin sesgo`
- `501e167 feat: Monte Carlo lognormal con bandas por percentil, bootstrap por bloques y worker`
- `0698c27 feat: metas con probabilidad de llegar, aportación requerida y escenario de retiro`
- `aae5f84 test: goldens de Python y respuestas conocidas del generador, Monte Carlo y metas`
- `9c4701b docs: petición de A3 para el barril de finance y el traslape de cuantiles con A1`

### Compuertas que reportó

- **npm run lint**: 0 errores, 3 avisos. Los 3 son react-hooks/exhaustive-deps en src/legacy/App.legacy.jsx (líneas 1128, 1196 y 1879), heredados del legado y presentes también en la base. Ninguno en archivos de A3.
- **npm run typecheck**: tsc -p jsconfig.check.json, exit 0. Cubre src/lib/**/*.js, o sea rng.js, montecarlo.js, montecarlo.worker.js y goals.js con JSDoc en cada exportación. En el camino corrigió dos cosas reales: el buffer de un Float64Array es ArrayBufferLike y había que acotarlo a ArrayBuffer para la lista de transferibles, y el postMessage del ámbito de worker no es el de Window.
- **npm run test**: 21 archivos, 504 pruebas, todas pasan (base 373 + 131 de A3). Desglose de A3: src/lib/rng.test.js 34, src/lib/finance/montecarlo.test.js 67, src/lib/finance/goals.test.js 30.
- **npx vitest run src/lib/finance/montecarlo.test.js (prueba de desempeño incluida)**: Pasa. La prueba exige el mejor de 3 corridas de 10,000 x 360 por debajo de 400 ms. Medición aparte de 7 corridas en node v26.0.0: 219.0, 223.5, 224.2, 225.4, 225.4, 225.6, 233.0 ms.
- **python scripts/golden/montecarlo_golden.py && python scripts/golden/goals_golden.py (con .venv-golden, numpy 2.4.6)**: tests/golden/montecarlo.json: 35 casos. tests/golden/goals.json: 13 casos. Vueltos a correr con los JSON ya versionados, `git status --porcelain` quedó sin una sola modificación: los goldens se regeneran idénticos.
- **node scripts/check-ownership.mjs A3**: ✓ A3 (ws/A3): 12 archivo(s), todos dentro de su propiedad. exit 0.
- **npm run build && npm run bundle**: Build en 333 ms. JS inicial 106.63 KB gzip contra 180 de presupuesto (59 % usado), idéntico a la base: la librería de A3 todavía no la importa nadie, así que no pesa en el bundle. montecarlo.worker.js queda fuera del grafo a propósito.
- **ruff check . && pytest (con el .venv de la app)**: ruff: All checks passed (incluye los dos scripts de scripts/golden/). pytest: 483 pasan, 1 se salta (la que necesita red). A3 no agregó pruebas de Python; se corrieron para comprobar que no rompió nada.

### Pendientes que dejó

- El Web Worker no se probó en un navegador de verdad. `handleWorkerRequest`, `toMessage` y `fromMessage` están probados a fondo en node, y el archivo `montecarlo.worker.js` sí se ejecuta en una prueba (se sustituye `self` por un doble que guarda el listener y los postMessage, y se comprueba que contesta con el id y con un resultado que rehidrata a 176,729.14). Lo que falta es una corrida real con `new Worker(new URL(...), { type: 'module' })` en el navegador, que solo se puede hacer desde una página, y las páginas son de C y de F4. Quien lo monte en F4 tiene que confirmarlo ahí.
- `requiredContribution` corre una simulación completa por iteración de la bisección. Con los valores por omisión (paths 2000, tolerance 0.01, maxIterations 80) una meta a 20 años tarda del orden de un segundo. Si F4 lo pone detrás de un control que se mueve, conviene subir `tolerance` a 1 peso, bajar `paths` mientras se arrastra, o mandarlo al worker.
- `bounded: true` de `requiredContribution` quiere decir que no se encontró respuesta, y hoy sale tanto cuando `maxContribution` no alcanza como cuando se acabaron las iteraciones buscando el corchete. El campo `probability` que regresa sí dice la verdad de lo que se logró, pero si a alguien le importa distinguir los dos casos, hay que partir la bandera.
- Con valores absurdos (por ejemplo sigma anual de 1e6) la exponencial se desborda a Infinity y la desviación estándar del resumen terminal sale NaN. No se puso guarda porque ningún supuesto razonable llega ahí, pero si F4 deja capturar sigma libre, conviene acotarla en la interfaz.
- `src/lib/finance/index.js` es de A1, así que los módulos de A3 no están en el barril. Las features importan directo del archivo mientras tanto. Queda pedido en docs/requests/A3.md, junto con el traslape entre `quantilesOf` (A3) y `quantile` (A1, stats.js), que el orquestador puede unificar sin riesgo porque las dos versiones están probadas contra numpy.

### Notas de entrega

# Fase 2, A3: rng, Monte Carlo y metas

Tres archivos nuevos de librería, más el worker opcional. Todo es ES module puro: sin React, sin
fetch, sin `Date.now()` adentro de los cálculos. JSDoc en cada exportación, `tsc --checkJs` en
verde. La aleatoriedad pasa toda por `src/lib/rng.js`, así que una simulación con la misma
semilla da exactamente el mismo resultado en cualquier máquina.

## Convenciones que aplican a todo

- **Unidades.** Todas las tasas son ANUALES y en fracción: `mu: 0.08` es 8 %, `sigma: 0.15` es
  15 %, `inflation: 0.04` es 4 %. Nada de porcentajes de 0 a 100.
- **Moneda.** Los montos van en una sola moneda, la que quien llama decida. Aquí no hay FX ni
  conversión: si el portafolio trae USD, se convierte antes de llamar.
- **Nulos.** `null` quiere decir "no alcanzan los datos" y se pinta como `s/d`. Nunca se devuelve
  0 ni NaN por falta de datos.
- **Rechazo.** Un argumento que no es número finito, o que está fuera de rango, LANZA un `Error`
  con mensaje en español. Los mensajes llevan el prefijo del módulo (`montecarlo:` o `goals:`) y
  no están pensados para mostrarse tal cual al usuario: F4 tiene que validar el formulario antes
  de llamar, y estos errores son la red de seguridad.
- **Signo menos.** En los mensajes de error el menos es U+2212, como en el resto de la app.
- **Nada de consejo.** `retirementIncome` devuelve una `nota` fija que dice que es un escenario
  ilustrativo y que no es recomendación de inversión. Los resultados se muestran junto a los
  supuestos que los produjeron.

## API pública

### src/lib/rng.js

```js
import { createRng, hashSeed, DEFAULT_SEED } from 'src/lib/rng.js'
```

- `DEFAULT_SEED` es la cadena `'kaizen'`.
- `hashSeed(seed: string|number|null|undefined) -> number`: entero en [0, 2^32). FNV-1a sobre las
  unidades UTF-16 más una mezcla final. `null` y `undefined` valen lo mismo que `''`.
- `createRng(seed?) -> Rng`. El objeto trae:
  - `seed: string`, la semilla ya normalizada a texto.
  - `nextUint32(): number`, entero en [0, 2^32).
  - `uniform(): number`, flotante en [0, 1), con 2^32 valores posibles.
  - `normal(): number`, normal estándar por Box-Muller con caché del segundo valor del par.
  - `normals(n): Float64Array`, n normales de un jalón. Lanza si n es negativo o no finito.
  - `int(maxExclusive): number`, entero en [0, max) SIN sesgo (rechaza el bloque incompleto).
    Lanza si max es cero, negativo o pasa de 2^32.
  - `reset(): void`, regresa al estado inicial, incluida la caché de Box-Muller.
- Un número y su texto son la misma semilla: `createRng(42)` y `createRng('42')` dan lo mismo.
- Ninguna función de rng devuelve `null`.

### src/lib/finance/montecarlo.js

```js
import {
  simulate, lognormalParams, perStepParams, quantilesOf,
  toMessage, fromMessage, handleWorkerRequest,
} from 'src/lib/finance/montecarlo.js'
```

**`lognormalParams(m, s) -> { mu, sigma } | null`**
De la media y desviación ARITMÉTICAS anuales a los parámetros del logaritmo:
`sigma^2 = ln(1 + s^2/(1+m)^2)` y `mu = ln(1+m) − sigma^2/2`. Devuelve `null` si `m <= −1`, o sea
una pérdida total o peor, que no tiene logaritmo. Lanza si m o s no son finitos, o si s < 0.
Respuesta conocida: `lognormalParams(.08, .15)` da mu 0.06740782733107573 y sigma
0.13822600193200027.

**`perStepParams(m, s, stepsPerYear) -> { mu, sigma, annual: { mu, sigma } } | null`**
Los mismos parámetros ya escalados al paso: deriva entre k y volatilidad entre raíz de k.
`stepsPerYear` tiene que ser entero mayor o igual a 1.

**`quantilesOf(values) -> { p5, p25, p50, p75, p95 } | null`**
Los cinco percentiles de una muestra desordenada, cuantil tipo 7 (el de numpy y Excel). No muta
el arreglo que recibe. Mínimo 1 valor; con `[]` o `null` devuelve `null`. Lanza si algún valor no
es finito. Sirve para histogramas y para las bandas de cualquier muestra, no solo de la
simulación.

**`simulate(options) -> SimulationResult | null`**

Opciones, con sus valores por omisión:

| Opción | Omisión | Qué es |
| --- | --- | --- |
| `initial` | 0 | Saldo de arranque. No puede ser negativo. |
| `contribution` | 0 | Aportación por evento, al INICIO del periodo. |
| `contributionFrequency` | `'monthly'` | `'monthly'` o `'annual'`. |
| `contributionGrowth` | `null` | Crecimiento anual de la aportación. `null` significa "usa `inflation`", que es lo que le mantiene el poder de compra. |
| `years` | (obligatorio) | Horizonte en años; admite fracciones. |
| `stepsPerYear` | 12 | Entero >= 1. Con frecuencia mensual tiene que ser múltiplo de 12. |
| `mu` | 0 | Rendimiento aritmético anual esperado, en fracción. |
| `sigma` | 0 | Desviación estándar anual, en fracción. |
| `inflation` | 0 | Inflación anual, para los valores reales. |
| `paths` | 10000 | Entero >= 1. |
| `seed` | `'kaizen'` | Texto o número. |
| `method` | `'lognormal'` | `'lognormal'` o `'bootstrap'`. |
| `history` | `null` | Rendimientos simples de la misma periodicidad que `stepsPerYear`, solo para bootstrap. |
| `blockSize` | 6 | Largo del bloque circular del bootstrap. |
| `samplePaths` | 0 | Cuántas trayectorias completas guardar para dibujar líneas individuales. |

Recurrencia: `W_{t+1} = (W_t + C_t) · e^{l_t}`, con la aportación al inicio del periodo. El saldo
nunca baja de cero. `C_t = contribution · (1 + contributionGrowth)^{t/stepsPerYear}` y solo en los
pasos donde toca aportar.

El resultado trae:

- `steps`, `stepsPerYear`, `years`, `paths`, `seed`, `method`.
- `perStep` y `annual`: `{ mu, sigma }` del logaritmo, o `null` con bootstrap.
- `percentiles: { p5, p25, p50, p75, p95 }`, cada uno un `number[]` de largo `steps + 1`. El
  índice 0 es el saldo inicial. Son los saldos NOMINALES.
- `percentilesReal`: los mismos ya deflactados. Como el deflactor es un divisor positivo, son los
  nominales entre `deflators[t]`, sin volver a ordenar.
- `deflators: number[]`, `(1 + inflation)^{t/stepsPerYear}`.
- `contributed: number[]`: lo aportado en acumulado. **Ojo con el índice**: `contributed[t]` es lo
  que se lleva aportado ANTES del saldo del paso t, así que una aportación hecha en el paso t
  aparece en `contributed[t+1]`.
- `contributedTotal: number`, incluye el saldo inicial.
- `terminal` y `terminalReal`: `{ mean, sd, min, max, p5, p25, p50, p75, p95 }`. `sd` es muestral
  (n−1) y sale `null` con una sola trayectoria.
- `terminalSorted: Float64Array`, los saldos finales nominales ordenados ascendente. Sirve para
  histogramas sin recalcular nada.
- `samples: number[][]`, tantas trayectorias completas como pida `samplePaths` (vacío por
  omisión, porque 10,000 por 361 pasos son 29 MB).
- `probabilityAbove(target, { real } = {}) -> number | null`: proporción de trayectorias que
  terminan en la meta O ARRIBA de ella. Con `real: true` la meta se entiende en pesos de hoy.
  Devuelve `null` si la meta no es un número finito.

Devuelve `null` cuando: `round(years · stepsPerYear) < 1`, `mu <= −1` con el método lognormal, o
`history` tiene menos de `max(2, blockSize)` rendimientos con bootstrap.

Lanza cuando: algún número no es finito, `initial < 0`, `sigma < 0`, `inflation <= −1`,
`contributionGrowth <= −1`, `paths` o `stepsPerYear` no son enteros positivos, `method` o
`contributionFrequency` traen un valor que no existe, `stepsPerYear` no es múltiplo de 12 con
aportación mensual, `blockSize < 1`, o `history` trae un valor no finito o de −100 % o peor.

Respuestas conocidas (100,000 iniciales, 5,000 al inicio de cada mes, 12 meses al 1 % mensual, o
sea `mu = 1.01^12 − 1` con `sigma = 0`): aportación constante termina en **176,729.14** en los
cinco percentiles, y aportación que crece 1 % al mes en **180,292.00**.

**Worker: `toMessage`, `fromMessage`, `handleWorkerRequest`**
`probabilityAbove` es una función y las funciones no sobreviven al clonado estructurado.
`toMessage(sim)` devuelve `{ payload, transfer }` con la función quitada y el búfer de
`terminalSorted` listo para transferir; `fromMessage(payload)` la vuelve a poner del otro lado.
Transferir DESPRENDE el búfer, así que después de `postMessage(payload, transfer)` el `sim`
original ya no sirve en ese hilo.

### src/lib/finance/montecarlo.worker.js

```js
const worker = new Worker(new URL('../../lib/finance/montecarlo.worker.js', import.meta.url),
                          { type: 'module' })
worker.addEventListener('message', (e) => {
  if (!e.data.ok) return mostrarError(e.data.error)
  const sim = fromMessage(e.data.result)   // puede ser null si no alcanzaban los datos
})
worker.postMessage({ id: 1, options: { years: 30, mu: 0.08, sigma: 0.15, paths: 10000 } })
```

El `id` va y regresa tal cual, para poder ignorar respuestas de peticiones ya canceladas cuando
alguien arrastra un control y se disparan varias simulaciones. La respuesta es
`{ id, ok: true, result }` o `{ id, ok: false, error }` con el mensaje en español. Correr las
10,000 trayectorias en el hilo principal congela la interfaz unos 220 ms; por eso existe.

### src/lib/finance/goals.js

```js
import { probabilityOfGoal, requiredContribution, retirementIncome } from 'src/lib/finance/goals.js'
```

**`probabilityOfGoal(sim, target, { real = false } = {}) -> number | null`**
Fracción entre 0 y 1. Devuelve `null` si no hay simulación o si la meta no es finita. Con
`real: true` compara contra los saldos en pesos de hoy.

**`requiredContribution(options) -> { contribution, probability, iterations, bounded, sim } | null`**
Aportación periódica mínima para que la meta se alcance en al menos `probability` de las
trayectorias. Toma las mismas opciones que `simulate` (sin `contribution`) más `target`,
`probability` (0.5 por omisión, tiene que estar en (0, 1]), `real`, `maxContribution`,
`tolerance` (0.01) y `maxIterations` (80). `paths` es 2000 por omisión, no 10000, porque corre una
simulación completa por iteración.

Se resuelve por bisección, y es válido porque con la semilla fija el saldo final de cada
trayectoria crece de forma monótona con la aportación. `contribution` sale `null` con
`bounded: true` cuando ni el tope alcanza. Devuelve `null` completo si la simulación misma no se
puede hacer. El `sim` que regresa es el de la aportación devuelta, listo para dibujar el abanico
sin volver a simular.

**`retirementIncome({ balance, withdrawalRate = .04, nominalReturn = 0, inflation = 0, years = 30 })`**
Escenario determinista: se retira un porcentaje del saldo inicial el primer año y ese monto se
indexa a la inflación; el retiro es al INICIO del año y lo que queda rinde `nominalReturn`.
Devuelve `{ withdrawalRate, firstYearWithdrawal, firstMonthWithdrawal, withdrawals, balances,
depletedYear, totalWithdrawn, finalBalance, finalBalanceReal, nota }`. `balances` tiene
`years + 1` elementos y arranca en el saldo inicial. `depletedYear` es el año en que el saldo
termina en cero, o `null`. Devuelve `null` si el saldo inicial no es positivo o si `years < 1`.
Respuesta conocida: 1,000,000 al 4 % con rendimiento 5 % e inflación 3 % da retiros de 40,000,
41,200 y 42,436 y saldos de 1,008,000, 1,015,140 y 1,021,339.20.

## Costuras

- **Consumidas:** ninguna de otro stream. A3 solo importa `src/lib/rng.js` desde
  `montecarlo.js`, y `montecarlo.js` desde `goals.js` y desde el worker. No toca `format.js` ni
  `index.js`.
- **Ofrecidas:** las tres APIs de arriba. Las firmas se mantienen estables toda la fase 2.
- **Pendiente de otro stream:** `src/lib/finance/index.js` es de A1, así que los módulos de A3 no
  están en el barril todavía. Mientras tanto se importa directo del archivo, que funciona igual.
  Queda pedido en `docs/requests/A3.md`, junto con el traslape entre `quantilesOf` (A3) y
  `quantile` (A1, stats.js): las dos usan cuantil tipo 7 y las dos están probadas contra numpy,
  así que el orquestador puede unificarlas sin riesgo. `quantilesOf` existe porque el motor
  necesita los cinco percentiles a la vez y sin ordenar, que es justo lo que hace que la
  simulación quepa en el presupuesto de tiempo.

## Cómo correrlo y probarlo

```bash
cd "/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN.wt/A3"
npm run lint && npm run typecheck && npm run test

# solo lo de A3 (131 pruebas: rng 34, montecarlo 67, goals 30)
npx vitest run src/lib/rng.test.js src/lib/finance/montecarlo.test.js src/lib/finance/goals.test.js

# regenerar los goldens (no cambia ni un byte si el código no cambió)
"/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv-golden/bin/python" scripts/golden/montecarlo_golden.py
"/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv-golden/bin/python" scripts/golden/goals_golden.py

node scripts/check-ownership.mjs A3
```

Los goldens viven en `tests/golden/montecarlo.json` (35 casos) y `tests/golden/goals.json` (13).
Cada caso es `{ name, kind, input, expected, tol }` y `tol` es tolerancia RELATIVA: pasa si
`|a − b| <= tol · max(1, |b|)`. Las pruebas despachan por `kind`. `rng.test.js` lee los casos de
generador de `montecarlo.json`, porque A3 no tiene un `rng_golden.py` en su propiedad.

Los scripts de Python no son un calco del JS, a propósito: reimplementan xoshiro128** con enteros
exactos, resuelven las trayectorias sin volatilidad con la suma cerrada de la anualidad, sacan los
cuantiles con `numpy.percentile` y despejan la aportación requerida con la fórmula de la
anualidad, mientras el JS la busca por bisección.

## Desempeño

10,000 trayectorias por 360 pasos, node v26.0.0, 7 corridas: 219.0, 223.5, 224.2, 225.4, 225.4,
225.6 y 233.0 ms. Presupuesto 400 ms, o sea 44 % de holgura sobre la mediana. La misma corrida con
`sigma = 0` (sin generador ni exponencial por trayectoria) tarda 25.8 ms, así que la selección de
percentiles y la contabilidad cuestan unos 26 ms y los sorteos el resto. La prueba de desempeño
está en `montecarlo.test.js` y toma el mejor de tres para no medir el calentamiento del JIT.

Dos decisiones son las que hacen que quepa: los percentiles salen por selección múltiple sobre una
copia (lineal) en vez de ordenar 10,000 saldos 360 veces, y con `sigma = 0` ni se toca el
generador, porque el factor es el mismo para todas las trayectorias.

## Límites conocidos

- **El worker no se probó en un navegador de verdad.** `handleWorkerRequest`, `toMessage` y
  `fromMessage` están probados a fondo, y el archivo del worker sí se ejecuta en una prueba con
  `self` sustituido por un doble, así que se comprueba que registra el listener y contesta bien.
  Falta la corrida real con `new Worker(...)`, que solo se puede hacer desde una página. F4 tiene
  que confirmarlo cuando lo monte.
- `requiredContribution` corre una simulación completa por iteración. Con los valores por omisión,
  una meta a 20 años tarda del orden de un segundo. Si va detrás de un control que se arrastra,
  conviene subir `tolerance` a 1 peso, bajar `paths` mientras se mueve, o mandarlo al worker.
- `bounded: true` sale tanto cuando `maxContribution` no alcanza como cuando se acabaron las
  iteraciones buscando el corchete. El campo `probability` que regresa sí dice qué se logró.
- Con valores absurdos (sigma anual de 1e6) la exponencial se desborda a Infinity y la desviación
  del resumen terminal sale NaN. Si F4 deja capturar sigma libre, hay que acotarla en la interfaz.
- `contributionFrequency: 'monthly'` exige que `stepsPerYear` sea múltiplo de 12. Con pasos
  semanales (52) hay que usar aportación anual, o pedir el cambio.
- Las aportaciones son siempre al inicio del periodo; no hay opción de fin de periodo. Es lo que
  pide el spec y lo que sostienen las dos respuestas conocidas.
- No hay FX: todo va en una sola moneda y la conversión se hace antes de llamar.

## A4

Los cinco módulos de A4 quedaron implementados en /Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN.wt/A4 (rama ws/A4, 7 commits sobre eada31f, 21 archivos, árbol limpio): src/lib/finance/ledger.js (reemplaza el stub de S2), performance-ledger.js, xirr.js, tax-mx.js y rebalance.js, todos ES puros, sin React, sin fetch y sin Date.now(), con JSDoc en cada export y regla explícita de null documentada por función.

Las respuestas conocidas del spec están corridas de verdad, no leídas del código:
- costo promedio: 10@100 + 10@120, vende 5@130 -> 15 @ 110 con 100 realizado; split 2 por 1 -> 30 @ 55.
- descomposición de tipo de cambio: q=10, P 150->180, X 17->19 -> {"total":8700,"priceEffect":5100,"fxEffect":3600,"cross":0}.
- TWR encadenado: [100,110,160,144] con depósito de 50 -> -0.009999999999999898.
- XIRR: -1000 y +1100 a 365 días -> 0.09999999999999988; ejemplo de Microsoft -> 0.37336253351883136 (Excel publica .373362535 porque corta en 1e-6; la raíz exacta que da scipy es .3733625335, y el test exige las dos a 6 y 9 dígitos).
- ISR art. 129: costo 550 con factor INPC 1.05 contra 650 -> ganancia 72.5, impuesto 7.25.
- rebalanceo entero: 10,000 al 50/50 con precios 300/700 -> {"A":17,"B":7}, efectivo 0, desviación 0.02.

Cada módulo tiene su golden en Python con una implementación DISTINTA a propósito: ledger en Fraction exacto, tax-mx en Decimal de 28 dígitos, xirr con scipy.optimize.brentq, performance-ledger por valor de la unidad (no encadenando) y rebalance con piso y codicioso más búsqueda exhaustiva de todas las combinaciones enteras. Son 41 casos golden que las pruebas de JavaScript iteran, además de los casos a mano y los de borde (vacío, un punto, ceros, NaN rechazado).

El único hallazgo que hay que decidir arriba: derivePositions no pudo crecer de forma porque la prueba de contrato de S2 (src/lib/portfolio/ledger.contract.test.js, que no es de A4) compara con toEqual contra objetos de exactamente cinco llaves. Conservé esa forma al pie de la letra y las tres llaves que pide el spec viven en derivePositionsDetailed, con el mismo motor. Está en docs/requests/A4.md con las dos opciones para resolverlo tras el merge.

### Commits

- `f92d44f feat: el libro de movimientos da posiciones a costo promedio, efectivo, ventas y flujos externos`
- `5d1c095 feat: XIRR Actual/365 con Newton y respaldo de bisección`
- `c7b568e feat: serie de valor del portafolio y TWR encadenado por subperiodo`
- `cd461e8 feat: estimación del ISR por ganancias en bolsa con actualización por INPC`
- `de7ce67 feat: rebalanceo en acciones enteras con piso y compra codiciosa`
- `8b07ba6 docs: petición de A4 sobre la forma de derivePositions y la descomposición de tipo de cambio`
- `c5355be fix: el rebalanceo solo avisa de movimientos omitidos cuando de verdad omitió alguno`

### Compuertas que reportó

- **npm run lint**: exit 0. 3 problems (0 errors, 3 warnings). Las 3 son react-hooks/exhaustive-deps preexistentes en src/legacy/App.legacy.jsx (líneas 1128, 1196, 1879), idénticas a las que reportó M1. Cero avisos en archivos de A4.
- **npm run typecheck (tsc -p jsconfig.check.json, checkJs sobre src/lib)**: exit 0, sin salida. Los cinco módulos pasan con JSDoc en cada export.
- **npm run test (vitest run)**: exit 0. Test Files 23 passed (23), Tests 527 passed (527). La base de fase 1 eran 373, o sea +154 de A4. Desglose por archivo: ledger.test.js 37, tax-mx.test.js 32, performance-ledger.test.js 30, rebalance.test.js 28, xirr.test.js 27.
- **npx vitest run src/lib/portfolio/ledger.contract.test.js**: exit 0. 11 passed (11). Es el contrato de derivePositions que dejó S2 y sigue verde sin tocar ese archivo.
- **.venv-golden/bin/python scripts/golden/{ledger,xirr,performance-ledger,tax-mx,rebalance}_golden.py (los 5, dos veces)**: exit 0 los cinco. Salida: ledger 9 casos, xirr 11 casos (Microsoft 0.373362533519), performance-ledger 9 casos (deposito-a-media-serie twr=-0.010000000000), tax-mx 8 casos (caso-conocido-factor-1.05 gain=72.500000 tax=7.250000), rebalance 8 casos (caso-conocido-50-50-precios-300-700 {'A': 17, 'B': 7} efectivo=0.00 desv=0.020000). Tras regenerarlos, git status --porcelain sale VACÍO: los cinco JSON
- **npm run build**: exit 0, built in 331ms. dist/assets/index-TLc0SSHu.js 338.45 kB (gzip 107.78 kB). Nada de A4 entra todavía al bundle porque ninguna feature lo importa aún.
- **node scripts/check-ownership.mjs A4**: exit 0. ✓ A4 (ws/A4): 21 archivo(s), todos dentro de su propiedad.
- **grep de guiones em/en en los 11 archivos nuevos**: 0 apariciones en texto, comentarios y docs. Los 4 aciertos del grep son las expresiones regulares /[—–]/ de las pruebas que JUSTAMENTE verifican que no haya guiones en los avisos de ledger, tax-mx y rebalance.
- **git status --porcelain**: vacío. 7 commits sobre eada31f, mensajes de una línea en español con acentos, sin Co-Authored-By.

### Pendientes que dejó

- DECISIÓN PARA EL ORQUESTADOR: derivePositions devuelve las cinco llaves del contrato de S2, no las ocho del spec. La prueba src/lib/portfolio/ledger.contract.test.js (de S2, fuera de mis globs) usa toEqual contra objetos de exactamente cinco llaves en 2 de sus 11 casos, y toEqual falla con cualquier llave de más que traiga valor. Las tres llaves del spec (realizedPnl, firstBuyDate, avgFx) viven en derivePositionsDetailed, mismo motor, cero lógica duplicada. Opción recomendada: cambiar esas 2 aserciones a toMatchObject, mover las tres llaves a derivePositions y dejar derivePositionsDetailed como alias. Detalle en docs/requests/A4.md punto 1.
- DEDUPE EN EL MERGE: ledger.js exporta positionPnl({quantity, price0, price1, fx0, fx1}), que es la misma cuenta que fx.js::pnlDecomposition de A1 (el spec la pone allá). La hice aquí porque A4 es quien produce avgCost y avgFx, y porque no puedo importar un archivo de A1 que no existe en mi worktree. Las dos devuelven {total, priceEffect, fxEffect, cross:0} y las dos prueban 8,700 = 5,100 + 3,600. Dejar una sola y que la otra sea envoltorio. docs/requests/A4.md punto 2.
- LÍMITE MEDIDO DEL REBALANCEO: el paso codicioso que fija el spec no siempre llega al óptimo entero. Caso medido y guardado en el golden (rebalance.json, caso greedy-vs-optimo): con 10 A y 2 B, precios 250 y 1500, objetivos 60/40 y 1,200 de efectivo, el método da 16 A y 1 B con desviación .179104 y la mejor combinación entera es 14 A y 2 B con .125373. Pasa porque el piso vende una B que ya no alcanza para recomprar. Está documentado en el encabezado del módulo y la prueba exige que sea el ÚNICO caso del golden donde no coincide con la búsqueda exhaustiva. Si se quiere cerrar, hay que cambiar el método (por ejemplo, redondear en vez de pisar del lado de las ventas), y eso cambia el spec.
- APROXIMACIÓN DEL costDate: con costo promedio no existe una fecha de adquisición única, así que realizedSales reporta como costDate la fecha de la PRIMERA compra del lote abierto. Eso hace que el factor de INPC salga un poco alto (más meses de actualización) cuando hubo varias compras. Queda dicho en el JSDoc de Sale y en las notas que devuelve isrOnGains. Si el usuario o su contador necesitan el dato exacto, hay que capturar el factor directo por venta, que ya se acepta con el campo `factor`.
- valueSeries arrastra el último precio conocido para VALUAR posiciones (eso es lo normal en la valuación de tenencias), pero nunca inventa uno: si no hay precio en esa fecha ni antes, el corte sale con value null y su motivo en `missing`, y twr se lo salta arrastrando el flujo al siguiente periodo válido. Vale la pena que F1 muestre `missing` en la UI en vez de esconderlo.
- No hay verificación en navegador en este stream: son cinco módulos puros sin UI. La compuerta visual y de consola le toca a quien los pinte (F1).

### Notas de entrega

ENTREGA DE A4: la parte del libro de movimientos de la librería financiera. Rama ws/A4, worktree "/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN.wt/A4", 7 commits sobre eada31f, árbol limpio.

## Reglas que cumplen los cinco módulos
Módulos ES puros: sin React, sin fetch, sin Date.now() (toda fecha de corte entra por parámetro), sin aleatoriedad. Solo importan entre ellos (performance-ledger importa ledger); ninguno importa nada de A1, A2, A3 ni de src/lib/format.js. Todo porcentaje, rendimiento, peso y tasa va como FRACCIÓN (0.10 = 10 %). Los montos van en la moneda que diga cada firma. Cuando no hay con qué calcular devuelven null, nunca 0 ni NaN, y el mínimo está escrito en el JSDoc de cada función.

## API pública, archivo por archivo

### src/lib/finance/ledger.js
- `derivePositions(transactions, { asOf })` -> `Position[]`, `Position = { symbol, quantity, avgCost: number|null, currency: 'MXN'|'USD', costBasis: number|null }`. EXACTAMENTE las cinco llaves del contrato de S2. Ordenado por símbolo, sin posiciones cerradas. Con [] o undefined devuelve [].
- `derivePositionsDetailed(transactions, { asOf })` -> `Position & { realizedPnl: number|null, firstBuyDate: string|null, avgFx: number|null }`. ESTA es la que debe llamar F1 para P&L realizado, primera compra y tipo de cambio promedio. realizedPnl es del lote ABIERTO (se reinicia al cerrar y reabrir); null si alguna compra llegó sin precio. avgFx es el fxRate de las compras ponderado por cantidad, null si a alguna le falta. firstBuyDate es la compra con fecha más vieja del lote abierto, null si ninguna la trae.
- `cashBalances(transactions, { asOf })` -> `{ MXN: number, USD: number }`, saldo crudo. PUEDE QUEDAR NEGATIVO si se registraron compras sin depósitos, y eso es información útil para la UI ("te faltan depósitos por registrar").
- `realizedSales(transactions, { asOf })` -> `Sale[]` en orden cronológico: `{ symbol, saleDate, quantity, proceeds, cost, costDate, gain, currency }`. Es la entrada natural de tax-mx: mapea a `{ proceeds, cost, costDate, saleDate }` tal cual.
- `realizedPnlBySymbol(transactions, { asOf })` -> `{ [symbol]: number|null }`, INCLUIDAS las posiciones ya cerradas (derivePositions las omite).
- `externalFlows(transactions, { asOf })` -> `{ date, currency, amount, kind: 'deposit'|'withdrawal'|'funding' }[]`. Depósitos en positivo, retiros en negativo, y 'funding' es el faltante de efectivo de una compra que nadie financió con depósito previo, que se toma como aportación.
- `ledgerSnapshots(transactions, dates)` -> `{ date, positions, cash, fundedCash, external }[]`. Una sola pasada por los movimientos, un corte por fecha. Es la costura que usa performance-ledger; si F1 necesita cortes, use esta y no un derivePositions por fecha.
- `validateTransaction(tx, existing = [])` -> `{ ok: boolean, errors: string[] }`. Mensajes en español de México, sin guiones largos, listos para pintar debajo del campo. Revisa tipo, fecha AAAA-MM-DD, moneda, cantidad, precio, comisiones, ratio, monto, tipo de cambio, y con `existing` también que no se venda más de lo que hay a esa fecha ("No puedes vender 25 de AAPL: a esa fecha tienes 10.").
- `positionPnl({ quantity, price0, price1, fx0, fx1 })` -> `{ total, priceEffect, fxEffect, cross: 0 }|null`. priceEffect = q(P1-P0)X0, fxEffect = q·P1·(X1-X0), el cruce queda dentro del de tipo de cambio y por eso suma exacto. Ver "open issues": A1 tiene la misma en fx.js.
- `orderTransactions(transactions, asOf)` -> Transaction[] en orden de aplicación (sin fecha primero, luego por fecha, estable) y `TX_TYPES`.
- Reglas del método: costo promedio; comisiones SUMAN al costo en compras y RESTAN al producto en ventas; el split multiplica cantidad y divide el costo promedio sin mover el costo total; una venta no cambia el costo promedio; una compra sin precio deja el costo en null y ahí se queda hasta que la posición cierre; vender de más se recorta a lo que hay (para rechazarlo, use validateTransaction).

### src/lib/finance/performance-ledger.js
- `valueSeries(transactions, pricesBySymbolDate, fxByDate = {}, baseCurrency = 'MXN', { dates } = {})` -> `{ dates, values: (number|null)[], holdings, cash, flows: number[], currency, missing: {date, reason}[] }`. pricesBySymbolDate es `{ [symbol]: { [fecha]: precio } }` en la moneda del símbolo; fxByDate es `{ [fecha]: pesos por dólar }` y solo hace falta si conviven dos monedas. Sin `dates` toma la unión de todas las fechas de precios. Arrastra el último precio conocido para valuar, pero si no hay ninguno anterior el corte sale null con su motivo en `missing`. `flows[i]` es lo externo que entró o salió entre dates[i-1] y dates[i]; `flows[0]` junta todo lo anterior, incluidos los saldos migrados sin fecha.
- `twr(values, flows = [])` -> number|null. Encadenado, con el flujo al INICIO del periodo: r_i = values[i] / (values[i-1] + flows[i]) - 1. flows[0] no se usa. Mínimo 2 valores utilizables.
- `twrReturns(values, flows)` -> number[]|null, los subperiodos. Los cortes sin valuar se saltan y su flujo se acumula al siguiente periodo válido; una base cero o negativa también se salta.
- `annualizeReturn(total, years)` -> number|null. (1+total)^(1/years)-1; null si years <= 0 o si total <= -1.
- `yearsBetween(from, to)` -> number|null, Actual/365, la MISMA convención del XIRR para que TWR anualizado y XIRR se puedan comparar.

### src/lib/finance/xirr.js
- `xirr(cashflows, { guess = 0.1, tolerance = 1e-12, maxIterations = 100 } = {})` -> number|null. cashflows es `[{ date: 'AAAA-MM-DD' o Date, amount }]`, negativo = sale dinero. Actual/365, Newton cortando por tamaño de paso y respaldo de bisección sobre un intervalo con cambio de signo. Devuelve null con menos de 2 flujos, con una fecha o monto inválido, sin cambio de signo (todo positivo o todo negativo) o si no converge. El orden de entrada no importa y el punto de partida tampoco (probado con guess de -0.9 a 50).
- `moneyWeightedReturn(flows, endValue, endDate, options)` -> number|null. Atajo para el portafolio: aportaciones en POSITIVO, retiros en NEGATIVO, y el valor final se agrega solo como flujo positivo en endDate. Internamente les cambia el signo para el XIRR.
- `xnpv(rate, cashflows)` -> number|null y `dayCount(from, to)` -> number|null (días reales, bisiesto incluido).

### src/lib/finance/tax-mx.js (TODO es estimación, y el texto lo dice)
- `isrOnGains({ sales, inpc = {}, rate = 0.10, lossCarryIn = 0 })` -> `{ gain, taxableGain, tax, lossCarry, rate, years, detail, dropped, notes }|null`. sales es `[{ symbol?, proceeds, cost, costDate?, saleDate?, factor? }]`; inpc es `{ 'AAAA-MM': índice }`. Costo actualizado por INPC(mes anterior a la venta)/INPC(mes de compra); si falta el índice o la fecha, factor 1 y queda anotado (la ganancia sale POR ARRIBA de la real, nunca por abajo). `factor` en la venta manda sobre el INPC, que es como se captura el dato de la constancia del intermediario. Agrupa por ejercicio con la fecha de venta, las pérdidas restan a las ganancias del mismo año y lo que sobra se arrastra al siguiente. `years` trae `{ year, gain, taxableGain, tax, lossUsed, lossCarry }`. Las ventas con montos que no son números se descartan a `dropped` sin tumbar el resto. Devuelve null solo si `sales` no es arreglo; con [] devuelve ceros, que es la respuesta correcta.
- `inpcFactor({ costDate, saleDate, inpc })` -> `{ factor, applied, from, to, reason }`.
- `dividendWithholding(amount, { rate = 0.10 })` -> `{ amount, rate, withholding, net, notes }|null`. Informativo, sin más cuenta que amount × .10.
- `ISR_GAINS_RATE = 0.1`, `DIVIDEND_WITHHOLDING_RATE = 0.1`, `LOSS_CARRY_YEARS = 10`.
- Las F-streams deben PINTAR `notes` tal cual, junto al número. Ya vienen en español natural, sin guiones largos y sin lenguaje de recomendación, y hay una prueba que lo verifica.

### src/lib/finance/rebalance.js
- `wholeShareRebalance({ holdings = {}, prices = {}, targets = {}, cash = 0, allowSell = true, minTrade = 0 })` -> `{ trades, after, deviation, targets, skipped, notes }|null`. targets son fracciones que suman 1 (si no suman, se reescalan y queda anotado). trades es `[{ symbol, side: 'compra'|'venta', quantity, amount, price }]`, ventas primero y luego compras, cada grupo por símbolo, cantidades SIEMPRE enteras. after es `{ holdings, weights, cash, value }` y deviation es `{ before, after }` con Σ|peso - objetivo| medida contra el valor TOTAL (el efectivo cuenta, su objetivo implícito es cero). Devuelve null si el efectivo no es número, si el valor total no es positivo o si una posición que YA se tiene no trae precio utilizable (sin eso no se puede valuar el portafolio). Un símbolo que solo está en objetivos y no trae precio se salta a `skipped` y su objetivo se reparte.
- `allowSell: false` no vende nada, solo invierte el efectivo disponible. `minTrade` omite los movimientos chicos, salvo cuando quitarlos dejaría el efectivo en negativo.
- F1: el diálogo de confirmación puede armarse directo con `trades` (side ya viene en español como paso mecánico) y escribir un movimiento de ledger por cada uno. `notes[0]` es el aviso de que no es recomendación y va visible.

## Cómo correrlo y probarlo
```
cd "/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN.wt/A4"
npm run lint && npm run typecheck && npm run test
npx vitest run src/lib/finance/            # los 154 de A4
node scripts/check-ownership.mjs A4
```
Los goldens se regeneran con el venv de referencia y NO deben cambiar el JSON:
```
"/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv-golden/bin/python" scripts/golden/<módulo>_golden.py
```
(<módulo> = ledger, xirr, performance-ledger, tax-mx, rebalance). Cada script escribe tests/golden/<módulo>.json con {cases:[{name, input, expected, tol}]} y su *.test.js lo itera. Los JSON salen con sort_keys y semillas fijas, así que regenerar deja git limpio: comprobado corriéndolos dos veces y comparando md5.

## Lo que hay que saber antes de usarlos
1. derivePositions NO trae realizedPnl ni avgFx: use derivePositionsDetailed. La razón está arriba en open issues y en docs/requests/A4.md.
2. cashBalances puede salir negativo (saldo crudo); valueSeries usa el efectivo YA ajustado por las aportaciones implícitas, por eso nunca valúa en negativo por ese motivo. Son dos números distintos a propósito.
3. El TWR se alimenta de valueSeries sin tocar nada: `twr(serie.values, serie.flows)`. Probado de punta a punta: la serie del spec sale exactamente [100,110,160,144] con flujos [100,0,50,0] y da -0.01.
4. Los mensajes de validateTransaction, las notas de tax-mx y las de rebalance son texto visible ya redactado en es-MX. No los reescriba la feature: si hace falta otro, pídalo.
5. Nada de esto formatea números. El signo menos U+2212, el "s/d" y la moneda son de src/lib/format.js (S2), que A4 no importa a propósito para no atar la librería a la presentación.

## A5

Resumed the cut-off run instead of restarting. First I read `git log --oneline analizavende..HEAD`, `git status` and `git diff`, and ran the gates to see where the previous session stopped: 3 commits were in, plus an uncommitted 2-line change to `src/content/glossary.js` and an unadded `docs/requests/A5.md`.

The uncommitted diff turned out to be the middle of a numeric audit of the glossary examples, so I finished that audit rather than discarding it. I verified the two pending fixes arithmetically (100,000 at 11.75% effective annual for 10 years = 303,721.35, not 303,589; terminal value with FCFF_n = 161.051, g = 3%, WACC = 9% = 2,764.71 gross and 1,796.87 discounted five years), then checked all 91 numeric examples across the 95 terms. Every one reconciles, including each of the spec's known answers: DCF 513.93 + 1,796.87 = 2,310.80, Hamada 1.08, Re 11.56%, WACC 9.34% and 10.62% in MXN, justified P/B 1.4286, robust z(18) = 1.349, magic-formula order 1-3-2, whole-share rebalance 17/7 with zero cash left, Monte Carlo 176,729.14 (annuity-due, which is what the stated figure implies). Parametric VaR 5.23% and CVaR 7.70% also reproduce exactly once the sample sd of the 20 returns is computed with n−1 (5.9161%).

`docs/requests/A5.md` made two quantitative claims from the earlier session, so I re-measured both before committing it: the glossary chunk is now 144.79 kB / 46.48 kB gzip (the note said 144.75 / 46.47; it grew because my two example fixes added characters) and the first route in this worktree builds to 338.45 kB / 107.78 kB gzip (the note said 106.63 KB). I rewrote that paragraph to the figures I actually measured.

I then found two genuine defects of my own that the project gate does not catch: `glossarySlugs` and `glossaryTerms` are `Object.freeze`d at runtime but were annotated as mutable arrays, which `tsc --checkJs` rejects (TS4104). The project's `jsconfig.check.json` only includes `src/lib/**`, so `npm run typecheck` was green regardless, but the annotations were wrong and `glossary-lazy.js` already declared `readonly GlossaryTerm[]` on the other side of the same seam. I fixed both annotations and confirmed with an ad-hoc `tsc` over `src/content` (exit 0). I did not touch `jsconfig.check.json`, which I do not own.

Final state: 95 terms (spec enumerates 77, all present; minimum is 60), 11 methodology pages (10 tools plus README index), 135 tests in my own file, working tree clean, 15 files all inside my ownership globs. No servers were started and nothing is left running.

### Commits

- `9895adc feat: glosario de 95 términos con búsqueda sin acentos y carga diferida`
- `47903a8 docs: metodología de las diez herramientas, con métodos exactos, supuestos y límites`
- `4cf9d6a fix: la búsqueda quita acentos con \p{M} y la prueba arma los guiones prohibidos sin escribirlos`
- `8102942 fix: corrige dos ejemplos aritméticos del glosario y deja las peticiones de A5 con cifras medidas`
- `f5f828b fix: glossarySlugs y glossaryTerms se anotan readonly, que es lo que Object.freeze deja`

### Compuertas que reportó

- **npm run lint**: PASA. 3 problems (0 errors, 3 warnings). Las 3 advertencias son react-hooks/exhaustive-deps preexistentes en src/legacy/App.legacy.jsx (líneas 1128, 1196, 1879), que no es mío. Cero problemas en src/content.
- **npm run test**: PASA. Test Files 19 passed (19), Tests 508 passed (508), 1.81s. De esos, src/content/glossary.test.js aporta 135 pruebas (corrida aislada: 1 archivo, 135 passed, 615ms).
- **npm run typecheck**: PASA, exit 0, sin salida. Ojo: jsconfig.check.json solo incluye src/lib/**, así que esta compuerta NO cubre src/content.
- **npx tsc -p <config ad hoc sobre src/content/glossary.js y glossary-lazy.js>**: PASA, exit 0. Antes del arreglo daba 2 errores TS4104 en glossary.js líneas 1608 y 1611 ('readonly string[]' / 'readonly GlossaryTerm[]' contra el tipo mutable anotado). Corregido en f5f828b.
- **grep -rn $'[–—]' src/content docs/metodologia docs/requests/A5.md**: PASA. exit 1, ninguna coincidencia. Conteo crudo por archivo: 0 en los 11 .md de docs/metodologia y 0 en los 3 .js de src/content. La prueba 'no hay guiones em ni en en ningún campo' además arma el regex con String.fromCodePoint para que el propio archivo de pruebas no contenga los caracteres prohibidos.
- **node -e "import('./src/content/glossary.js').then(m=>console.log(m.glossaryCount, m.glossarySlugs.length, m.glossaryTerms.length))"**: 95 términos (glossaryCount = 95, slugs = 95, terms = 95). El spec enumera 77 uno por uno y la prueba 'incluye todos los términos que enumera el spec' los verifica contra la lista completa; el mínimo pedido era 60.
- **node scripts/check-ownership.mjs A5**: PASA, exit 0. '✓ A5 (ws/A5): 15 archivo(s), todos dentro de su propiedad.'
- **npm run build (para medir la primera ruta)**: PASA, built in 309ms. index-TLc0SSHu.js 338.45 kB / gzip 107.78 kB; App.legacy-G2Nl9dFh.js 187.27 kB / gzip 45.68 kB; index-CY5WekUm.css 40.51 kB / gzip 14.86 kB.
- **vite build en modo librería sobre src/content/glossary-lazy.js**: entrada.js 0.47 kB / gzip 0.24 kB; glossary-DHGjAVp8.js 144.79 kB / gzip 46.48 kB. Confirma que el glosario sale en su propio chunk y no entra al bundle de la primera ruta.
- **git status --porcelain**: Árbol limpio. 5 commits en ws/A5 sobre analizavende, sin push, sin merge, sin tocar otras ramas.

### Pendientes que dejó

- `jsconfig.check.json` solo incluye `src/lib/**`, así que `npm run typecheck` no cubre `src/content`. Mis dos errores TS4104 vivieron en verde hasta que corrí tsc a mano. Quien sea dueño de ese archivo debería agregar `src/content/**/*.js` al include; mis módulos ya pasan limpios, así que agregarlo no rompe nada hoy.
- El número de la primera ruta que cito en `docs/requests/A5.md` (107.78 KB gzip) es el de MI worktree. Los streams que están corriendo en paralelo van a moverlo. El argumento de la carga diferida no depende de esa cifra exacta, pero si alguien la cita en un reporte conviene volver a medirla.
- `docs/metodologia/*.md` todavía no los renderiza nadie. Son Markdown plano sin frontmatter y sin pipeline; la prueba fija el formato pero nada los sirve hasta que F5 haga la página /aprender.
- No existe una versión síncrona y chica del glosario para el primer render. Si C1 necesita `titulo` y `corto` de un puñado de métricas sin esperar una promesa, hay que generarla; la dejé fuera a propósito para no tener dos fuentes de la misma frase.
- Las páginas de metodología describen métodos que los streams B todavía están implementando. Si alguno se desvía del spec al implementar, la página de metodología queda describiendo algo que el código no hace, y no hay prueba que ate las dos cosas.

### Notas de entrega

HANDOFF A5: glosario y metodología

## 1. Qué quedó en disco (15 archivos, rama ws/A5)

    src/content/glossary.js        95 términos, ~153 KB de texto
    src/content/glossary-lazy.js   carga diferida, el que deben importar
    src/content/glossary.test.js   135 pruebas
    docs/metodologia/README.md     índice
    docs/metodologia/*.md          10 páginas, una por herramienta
    docs/requests/A5.md            lo que pido a otros streams

## 2. API pública de src/content/glossary.js

    glossary            objeto congelado, llave = slug
    glossarySlugs       readonly string[], orden temático
    glossaryTerms       readonly GlossaryTerm[], ordenados por título con localeCompare es-MX
    glossaryCount       95
    getTerm(x)          GlossaryTerm|null; tolera mayúsculas, acentos, separadores y alias
    hasTerm(x)          boolean
    relatedTerms(slug)  GlossaryTerm[] completos, [] si no existe
    glossarySearch(q, {limit})  GlossaryTerm[]
    glossaryTip(slug)   {slug, titulo, corto, href}|null
    glossaryHref(slug)  string
    slugify(texto)      string

Forma de un término: { titulo, corto (<=160), largo (2 a 4 párrafos), formula, comoLeer, ejemplo, fuente, relacionados[], alias?[] }. Todo congelado con Object.freeze, incluidos los arreglos internos: no lo muten, hagan copia.

## 3. IMPORTANTE para C1 (InfoTip) y F5 (Aprender): importen glossary-lazy.js

El glosario mide 144.79 kB, 46.48 KB gzip, el 26 por ciento del presupuesto de 180 KB. La primera ruta de este worktree está en 338.45 kB / 107.78 KB gzip. Un import estático desde el shell se la sube 43 por ciento de un jalón para mostrar texto que en la pantalla de mercados nadie va a leer.

    import { loadTip, loadTerm, searchGlossary, loadAllTerms } from '.../content/glossary-lazy.js'

    const tip = await loadTip('sharpe')        // {slug, titulo, corto, href} o null
    const term = await loadTerm(params.termino) // GlossaryTerm o null
    const todos = await loadAllTerms()          // readonly GlossaryTerm[]
    const hits = await searchGlossary(texto, { limit: 8 })

Todas devuelven promesa y ninguna truena: si el término no existe devuelven null o lista vacía, y el componente cae a su prop de texto, como pide el design brief. La promesa del chunk se guarda, así que se descarga una sola vez por sesión aunque pidan veinte términos.

Si necesitan una versión síncrona y chiquita para el primer render (solo titulo y corto de unas cuantas métricas), pídanmela y la genero como archivo aparte. No la hice por adelantado para no tener dos fuentes de la misma frase.

## 4. Costura que consumo sin tocar

glossary.js importa pathLearnTerm de src/app/paths.js (de S2) para armar la liga de cada término, en vez de repetir la ruta /aprender/:termino en dos lados. Es solo lectura. Si la firma pathLearnTerm(termino) => string cambia, se rompen glossaryHref y glossaryTip, y la prueba lo caza de inmediato.

## 5. Formato de docs/metodologia/*.md, para quien pinte /aprender

Markdown plano, sin frontmatter, pensado para renderizarse tal cual:

- El título de la página es su primer `# `.
- El resumen es el primer párrafo.
- El aviso de que no es recomendación de inversión va siempre en el segundo párrafo.
- La última sección, `## Términos relacionados en el glosario`, es una lista de slugs separados por comas, convertible a ligas /aprender/<slug> sin parsear nada más.
- README.md es el índice, con tabla de las diez herramientas.

Una prueba revisa esos cuatro puntos en los 11 archivos y que todos los slugs citados existan, así que el formato no se va a mover por debajo. Si prefieren consumirlos como datos, pidan un src/content/metodologia.js que los importe con ?raw y exponga { slug, titulo, resumen, markdown }; no lo hice porque no sé si F5 los va a servir desde el build o desde el API.

## 6. Cómo correrlo y probarlo

    npm run test                              508 pruebas, 19 archivos
    npx vitest run src/content/glossary.test.js   135 pruebas mías
    npm run lint                              0 errores
    node scripts/check-ownership.mjs A5       15 archivos, pasa

Las pruebas cubren: cobertura de los 77 términos que enumera el spec, esquema y longitudes de cada término, integridad de relacionados (existen, no se autorreferencian, no repiten, ningún término queda aislado), alias sin colisiones, congelamiento, ausencia de guiones em/en, ausencia de lenguaje de recomendación, s/d y el signo menos U+2212, estructura de las 11 páginas de metodología, y slugify, getTerm y glossarySearch con acentos, mayúsculas, alias y límites.

## 7. Números: ya están verificados, no los recalculen a ciegas

Auditamos los 91 ejemplos numéricos del glosario contra aritmética real. Todas las respuestas conocidas del spec reproducen exacto y están en el término y en la página de metodología que corresponde:

    DCF          513.93 + 1,796.87 = 2,310.80    -> dcf, crecimiento-terminal, valuacion-dcf.md
    Hamada       beta_L = 1.08                   -> beta-apalancada, riesgo.md
    CAPM         Re = 11.56 por ciento           -> capm, valuacion-dcf.md
    WACC         9.34, en pesos 10.62            -> wacc, valuacion-dcf.md
    P/VL banco   1.4286                          -> p-vl, valuacion-dcf.md
    z robusta    z(18) = 1.349                   -> z-score-sectorial, screener-de-factores.md
    magica       orden 1, 3, 2                   -> formula-magica, formula-magica.md
    rebalanceo   17 y 7, efectivo 0              -> rebalanceo
    Monte Carlo  176,729.14 (anualidad anticipada) -> monte-carlo, simulador.md

Si su implementación da otro número, revisen su lado antes que el mío. Dos avisos de detalle que cuestan tiempo: el VaR y CVaR paramétricos (5.23 y 7.70 por ciento) solo salen si la desviación estándar se calcula con n−1 sobre la muestra de 20 rendimientos (da 5.9161 por ciento, no 5.92 redondeado); y el 176,729.14 del simulador es anualidad ANTICIPADA, con la aportación al inicio del mes. Vencida da 176,095.02.

## 8. Límites conocidos

- npm run typecheck NO cubre src/content: jsconfig.check.json solo incluye src/lib/**. Mis módulos pasan tsc --checkJs limpios, verificado con una corrida a mano, pero dos errores TS4104 míos vivieron en verde hasta que la corrí. Vale la pena agregar src/content/**/*.js al include; no rompe nada hoy.
- Las páginas de metodología describen métodos que los streams B están implementando en paralelo. Nada ata el texto al código: si una implementación se desvía del spec, la página queda describiendo algo que el código no hace.
- El peso de la primera ruta que cito es el de mi worktree y ustedes lo van a mover.
- No hay versión síncrona del glosario.
- El glosario es texto puro: cero dependencias nuevas, cero cambios a package.json.

## B1

Seguridad y plataforma sobre S1, en ws/B1, 8 commits, árbol limpio. Los 8 puntos del encargo quedaron hechos y verificados contra el servidor corriendo, no leyendo código.

1. Límite de tasa del login. La cubeta por usuario (10/h) ahora cuenta SOLO fallos: se gasta la ficha al empezar el intento y `refund_user` la devuelve cuando las credenciales son buenas, así que nadie puede dejar a otra persona fuera de su cuenta. Comprobado en vivo: con 'ana' a 4 fichas de 10, 12 logins correctos seguidos dieron 12 de 12 en 200. La llave por IP pasó del primer salto de X-Forwarded-For (el que escribe el cliente) al salto de confianza contando desde la derecha, según TRUSTED_PROXY_HOPS (default 1, que es Render; con 0 se ignora la cabecera y manda el socket). Comprobado: 6 fallos con primer salto distinto y mismo último salto dieron 401 x5 y 429 con Retry-After al sexto, o sea que ya no se puede estrenar cubeta inventando la cabecera. LOGIN_RATE_LIMIT_IP_PER_MINUTE y LOGIN_RATE_LIMIT_USER_PER_HOUR solo se pueden APRETAR en producción: aflojarlos ahí levanta SettingsError.

2. Settings. Cada entrada `scrypt$` de USERS se valida al arrancar con `parse_hash`: en producción un hash mal formado detiene el arranque (antes se aceptaba en silencio y ese usuario nunca podía entrar), fuera de producción es aviso. Valores no string y usuarios vacíos se rechazan igual. El hash nunca se imprime en el mensaje.

3. `scripts/hash_password.py --json` imprime solo el objeto USERS por stdout y manda los encabezados a stderr, así que `USERS="$(python scripts/hash_password.py --user ana --json)"` sirve tal cual.

4. Guarda de carga. `ConcurrencyLimitMiddleware` va por dentro de CORS y por fuera de los routers, con MAX_CONCURRENCY 48 por debajo del limit_concurrency 64 de uvicorn, que queda de último recurso. Contesta 503 con ErrorBody del contrato congelado, código RATE_LIMITED (el más cercano que ya existe en schemas.py), mensaje en español, Retry-After y CORS. Comprobado con MAX_CONCURRENCY=1 y 20 logins en paralelo: 1 en 200 y 19 en 503, con access-control-allow-origin, retry-after: 2 y cache-control: no-store.

5. Cache-Control. `tests/unit/b1/test_cache_headers.py` recorre `app.routes` y exige a cada ruta v2 su clase de dato exacta (quotes 30, history 3600, fundamentals 21600, macro 3600, news 600, screeners 43200; /health y /auth no-store), más una prueba de que la dependencia sí pone el encabezado y otra de que todo error va no-store. B2 y B3 la heredan.

6. /health. `providers.yahoo.ok` y `sec.ok` salen de una señal barata en memoria (`cache.record_provider_call`), nunca de una llamada por sondeo, y valen null mientras nadie haya llamado al proveedor. Suma serverTime, version y commit, las capabilities son la unión de los CAPABILITIES de los routers montados y sigue pública bajo AUTH_REQUIRED.

7. El texto del docstring de legacy_v1 con las tres diferencias HTTP contra el servidor viejo quedó en docs/requests/B1.md (el archivo es de O). Las tres se comprobaron en vivo: ruta desconocida 404 con ErrorBody, POST a otra ruta 405, OPTIONS pelón 405, y el preflight CORS de verdad sigue en 200. La guarda de producción está probada: con KAIZEN_ENV=production se montan 0 rutas v1 y solo con KAIZEN_LEGACY_ROUTES=1 se montan las 34, con aviso.

8. Revisión de la superficie propia. JWT con algoritmo fijo en HS256 (un token alg:none da 401), las cuatro afirmaciones sub/iat/exp/ver obligatorias y 5 segundos de tolerancia de reloj. Comparaciones en tiempo constante, un usuario que no existe cuesta el mismo trabajo que una contraseña mala, y el 401 dice lo mismo en los dos casos. La línea de log trae método, ruta sin query, status, ms y request id: se verificó que la contraseña, el hash, el token, la llave y la query no aparecen en el log. El manejador de excepciones contesta 500 INTERNAL sin texto de la excepción y con CORS. La regex de previews de Vercel se puede acotar al equipo con VERCEL_TEAM_SLUG, y en producción avisa si se deja la ancha; la allowlist rechaza orígenes parecidos (probados 3 señuelos). GZip desde 1 KB.

### Commits

- `4e06ec9 fix: el JWT fija HS256, exige sus cuatro afirmaciones y tolera poco desfase de reloj`
- `ed9733c feat: la configuración valida los hashes de USERS, acota los previews de Vercel y suma los límites nuevos`
- `ffe5e65 fix: el login limita por la IP real detrás del proxy y su cubeta por usuario solo cuenta fallas`
- `6e581ab feat: guarda de carga que contesta 503 con el cuerpo del contrato, Retry-After y CORS`
- `e33678d feat: /health reporta los proveedores con la señal que ya existe, nunca llamándolos`
- `19474d7 fix: hash_password --json imprime solo el objeto USERS y los avisos van a la salida de error`
- `f916786 test: la caché HTTP por clase de dato se revisa recorriendo las rutas, y peticiones de B1`
- `0b79ac4 docs: por qué la señal de proveedores usa el candado del caché y el contador de carga no necesita uno`

### Compuertas que reportó

- **"/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv/bin/python" -m pytest -q -p no:cacheprovider -o addopts=""**: 580 passed, 1 skipped in 8.43s (sin red, con replay). La base de la fase eran 482 + 1 omitida, o sea +98.
- **"/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv/bin/python" -m pytest -q -p no:cacheprovider -o addopts="" tests/unit/b1**: 97 passed in 2.18s (las pruebas propias de B1; la número 98 es un ajuste en tests/unit/test_auth.py)
- **"/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv/bin/ruff" check .**: All checks passed!
- **node scripts/check-ownership.mjs B1**: ✓ B1 (ws/B1): 20 archivo(s), todos dentro de su propiedad.
- **git status --short (en ws/B1)**: vacío: árbol limpio, 8 commits sobre analizavende, nada sin commitear
- **grep de guiones em/en en los archivos que escribió B1**: 0 coincidencias en kaizen_api/main.py, settings.py, cache.py, security/*, routers/health.py, routers/auth.py, scripts/hash_password.py, docs/requests/B1.md y tests/unit/b1/*.py
- **python scripts/run_replay_backend.py --module kaizen_api.main --port 8108 --set 2026-09-22 (con AUTH_REQUIRED=true y un usuario scrypt de prueba) + curl a /health, /auth/login, /auth/me y rutas v2**: /health 200 con cache-control: no-store, apiVersion 2, version 2.0.0, capabilities [auth, legacy.v1], providers yahoo.ok null y sec.ok null (honesto: nadie los ha llamado), serverTime 2026-09-22T14:51:31Z. Login correcto 200 con token y CORS; contraseña mala 401 UNAUTHORIZED en español; /auth/me 200 con token, 401 sin token y 401 con alg:none. Las 6 rutas v2 consultadas siguen en 501/404 (son stub

### Pendientes que dejó

- docs/api-v2.md (de O): la sección de sesión quedó desactualizada en tres puntos (receta de USERS, límite de tasa, 503 de carga). El texto de reemplazo, listo para pegar, está en docs/requests/B1.md sección 1. La tabla de Cache-Control de ese documento SÍ coincide con el código, ruta por ruta.
- routers/legacy_v1.py (de O): falta pegar en el docstring del módulo las tres diferencias HTTP con el servidor viejo (POST a otra ruta 405, OPTIONS pelón 405, ruta desconocida 404 con ErrorBody). Texto listo en docs/requests/B1.md sección 2.
- routers/legacy_v1.py (de O): el POST /login de v1 comparte el limitador pero le falta el refund, así que un login v1 CORRECTO todavía gasta una ficha de la cubeta por hora del usuario. El arreglo es de una línea y está escrito en docs/requests/B1.md sección 3. No es bloqueante: v1 se apaga en producción y desaparece en M3.
- tests/unit/b1/test_cache_headers.py tiene una tabla EXPECTED con los nombres de ruta v2 tal como están registrados hoy. Si B2 o B3 agregan o renombran una ruta v2, esa prueba falla por nombre y el archivo es de B1, así que el ajuste lo tiene que hacer el orquestador en M2. Es a propósito: es lo que impide que entre una ruta sin clase de dato.
- Nadie llama todavía a cache.record_provider_call, así que /health reporta yahoo.ok y sec.ok en null. Es la verdad, pero deja de ser informativo hasta que B2a/B2b/B3a lo cableen (ver notas para los siguientes streams).
- Decisión tomada a propósito y NO revertida: no se anunció el 429 RATE_LIMITED en kaizen_api/http_responses.py. El límite de tasa vive solo en el login, que ya anuncia su 429 en routers/auth.py; ponerlo en las 22 rutas de datos prometería un código que nunca devuelven. Razonamiento completo en docs/requests/B1.md sección 4.
- El límite de tasa y el contador de carga son por proceso y en memoria: valen con workers=1, que es como corre el API. Con varios workers cada proceso contaría los suyos.

### Notas de entrega

HANDOFF DE B1 (seguridad y plataforma). Rama ws/B1, 8 commits sobre analizavende, árbol limpio.

## Lo que B1 dejó listo para que lo uses

### 1. Señal de proveedores para /health: cablea esto en tus llamadas (B2a, B2b, B3a, B3b, B3c)

```python
from kaizen_api.cache import record_provider_call
...
try:
    datos = llamada_real_al_proveedor(...)
    record_provider_call("yahoo", True)
except Exception:
    record_provider_call("yahoo", False)
    raise
```

Nombres que /health ya lee: "yahoo" y "sec". La señal dura 600 segundos (PROVIDER_SIGNAL_TTL) y después vuelve a null, que quiere decir "no sé", que es la verdad. `provider_ok(name)` la lee.

Regla dura: /health NUNCA sale a la red. Render lo sondea cada pocos segundos y Yahoo limita por tasa, así que un health check que llama al proveedor es la forma más tonta de quemar la cuota. Registra la señal de paso, cuando ya ibas a llamar por otra razón. banxico, fred y eodhd solo reportan si hay token configurado, que es cuestión de configuración y no de red.

### 2. Cache-Control: cada ruta v2 declara su clase de dato, y hay una prueba que lo vigila

En `kaizen_api/http_cache.py`: `CACHE_SECONDS`, `cache_control(clase)` y `no_store`. Se siguen importando desde `kaizen_api.routers` (reexportados), así que no cambies tus imports.

```python
@router.get("/v2/quotes", response_model=QuotesResponse, dependencies=[cache_control("quotes")])
```

Clases y segundos (la tabla de la spec, sin margen): quotes 30, history 3600, fundamentals 21600, macro 3600, news 600, screeners 43200. /health y /auth van con `no_store`. El encabezado sale como `private, max-age=N`, nunca `public`: son datos de una sesión, no de una caché compartida. Todo error va no-store solo.

`tests/unit/b1/test_cache_headers.py` recorre `app.routes` y falla por nombre si una ruta v2 no declara clase, si declara la equivocada, o si el conjunto de rutas cambió. Criterios para elegir, para que no adivines: precio que se mueve en el día -> quotes; serie histórica cerrada -> history; dato de la emisora que cambia por trimestre -> fundamentals; tasas y macro -> macro; titulares -> news; tabla completa de screener, cara de armar -> screeners.

Si agregas o renombras una ruta v2, esa prueba se va a poner roja y el archivo es de B1: repórtalo en tu `docs/requests/<stream>.md` para que el orquestador ajuste la tabla en M2. Está hecho a propósito así: es lo que impide que entre una ruta sin clase de dato.

### 3. /health anuncia solo lo que de verdad sirve

`capabilities` es la unión de los `CAPABILITIES` de los routers montados. Al implementar una ruta borras SUS DOS líneas (el `@stub` y el `raise not_implemented(...)`) y agregas la capacidad a la lista `CAPABILITIES` de tu router. Si haces una y no la otra, las pruebas de contrato fallan por dato. La forma completa de la respuesta: status, apiVersion 2, version, commit, authRequired, capabilities, providers {yahoo.ok, banxico.configured, fred.configured, sec.ok, eodhd.configured}, serverTime.

### 4. Guarda de carga: tu ruta puede recibir un 503 que no es tuyo

Con más de MAX_CONCURRENCY (48) requests en vuelo, la app contesta 503 antes de tocar tu router, con ErrorBody del contrato, código RATE_LIMITED, Retry-After y CORS. El limit_concurrency de uvicorn (64) queda de último recurso y ese sí contesta texto plano. /health está exento a propósito: es lo que sondea Render y tumbarlo por carga haría que la plataforma reiniciara el servicio justo cuando está ocupado. No necesitas hacer nada, solo saber que ese 503 existe y que no significa que tu proveedor falló.

### 5. Configuración nueva que puedes leer desde `Settings`

`trusted_proxy_hops`, `login_ip_per_minute`, `login_user_per_hour`, `max_concurrency`, y las de siempre. Variables de entorno nuevas: TRUSTED_PROXY_HOPS (default 1, Render), LOGIN_RATE_LIMIT_IP_PER_MINUTE (5), LOGIN_RATE_LIMIT_USER_PER_HOUR (10), MAX_CONCURRENCY (48), VERCEL_TEAM_SLUG. El docstring de `kaizen_api/settings.py` las documenta todas. Los dos límites del login solo se pueden apretar en producción; aflojarlos ahí levanta SettingsError.

### 6. Exportado nuevo desde `kaizen_api.security`

`parse_hash(encoded)` (antes `_parse_hash`), que devuelve la tupla del hash scrypt o None. Sirve para validar un hash sin intentar un login.

## Cómo correr y probar

```bash
cd "/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN.wt/B1"
"/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv/bin/python" -m pytest -q -p no:cacheprovider -o addopts=""
"/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv/bin/ruff" check .
node scripts/check-ownership.mjs B1
```

Servidor de replay (B1 no grabó fixtures nuevas, así que va con el set base solo; la capa 2026-09-22-b1 NO existe y el script falla si la pides):

```bash
SECRET_KEY="llave-de-prueba-b1-con-mas-de-32-caracteres" \
USERS='{"ana": "<hash de scripts/hash_password.py --user ana --json>"}' \
AUTH_REQUIRED=true \
"/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv/bin/python" \
  scripts/run_replay_backend.py --module kaizen_api.main --port 8108 --set 2026-09-22
```

Para generar el USERS: `python scripts/hash_password.py --user ana --json` imprime SOLO el objeto JSON (los encabezados van a stderr), así que `USERS="$(python scripts/hash_password.py --user ana --json)"` funciona tal cual.

## Limitaciones conocidas, dilas en tu reporte en vez de taparlas

- **El límite de tasa y el contador de carga son por proceso y en memoria.** Valen con workers=1, que es como corre el API. Con varios workers cada proceso contaría los suyos.
- **TRUSTED_PROXY_HOPS tiene que cuadrar con el despliegue.** Con 1 salto se confía en el último elemento de X-Forwarded-For, que es lo correcto detrás del balanceador de Render. Si algún día el API queda expuesto directo, hay que ponerlo en 0 o el cliente puede escribir su propia llave. Con una cadena más corta que los saltos declarados no se confía en la cabecera y manda la IP del socket.
- **El POST /login de v1 todavía gasta una ficha de la cubeta por usuario aunque el login sea correcto**, porque routers/legacy_v1.py es de O y el refund es de una línea que no se pudo agregar. El arreglo está escrito en docs/requests/B1.md sección 3. En /auth/login, que es el del frontend nuevo, sí aplica.
- **Nadie llama todavía a record_provider_call**, así que /health reporta yahoo.ok y sec.ok en null. Se arregla solo cuando B2a/B2b/B3a lo cableen.
- **`_configure_logging()` solo corre desde `run()`**, que es el camino de backend.py y por lo tanto el de Render y el Procfile. Bajo `scripts/run_replay_backend.py` la línea INFO de cada request no se imprime (los WARNING sí). No es un problema de producción, pero conviene saberlo al depurar en local: la línea existe y su formato es `GET /health 200 2ms rid=<id>`, sin la query.
- **docs/api-v2.md quedó desactualizado** en la sección de sesión; el texto de reemplazo está en docs/requests/B1.md sección 1. La tabla de Cache-Control de ese documento sí coincide con el código.


## B2a

Los 9 endpoints de B2a quedaron implementados, probados y verificados en vivo contra el servidor de replay en el puerto 8109: /v2/quotes, /v2/search, /v2/history/{symbol}, /v2/panel, /v2/fx, /v2/fx/history, /v2/markets/overview y /v2/markets/world (/v2/events es de B3a, no mío). Las dos costuras congeladas que me tocaban están implementadas: domain.history.get_series(...) y domain.fx.convert(...).

Al retomar tras el corte de cuota, el código ya estaba commiteado (6 commits) y faltaba la compuerta de verificación. Correrla encontró un defecto real de honestidad que arreglé en el commit 3195908: meta.stale venía fijo en false en historia, panel, fx/history, mercados y búsqueda. El contrato define stale como "el dato es más viejo de lo esperado para su clase", así que un false fijo afirma frescura sin medirla, que es justo el valor silencioso que la convención de unidades prohíbe. Ahora se calcula con dos reglas documentadas: con calendario de BMV o NYSE y barras diarias, la serie está vieja si le falta una jornada que ya cerró (la barra de hoy no cuenta mientras el mercado siga abierto); sin calendario (Tokio, cripto, divisas) o con barras semanales o mensuales, tolerancia en días naturales. Se nota en vivo: NAFTRAC.MX, cuyo histórico grabado termina el 18 de septiembre con el reloj en el 22, ahora sale stale=true, y el panel nombra al atrasado en meta.notes. Agregué 41 pruebas de esa regla contra instantes fijos, incluyendo el feriado del 16 de septiembre en la BMV y el Labor Day del 7 en Nueva York.

Los tres bugs de datos del legado quedaron corregidos solo en v2, con los goldens de v1 intactos: ^MXX sale en MXN (verificado en /v2/quotes y en el grupo mx de overview), el DXY viene de Yahoo DX-Y.NYB con dato real 100.578 en vez de Stooq que siempre falla, y no hay ningún 17.5 fijo (barrido con regex sobre las 9 rutas: cero coincidencias, igual que con guiones em y en).

### Commits

- `bbcca10 feat: datos curados de México y calendarios de la BMV y la NYSE`
- `4c4ddce feat: dominio v2 de precios, tipo de cambio, historia con fechas, calendario y búsqueda`
- `c5de0bd feat: rutas v2 de cotizaciones, históricos, panel, tipo de cambio, mercados y búsqueda`
- `232343b test: capa de fixtures de B2a con las 7 llamadas que faltaban`
- `22c5def test: pruebas de B2a con respuestas conocidas y solicitudes a otros streams`
- `47cd562 test: el camino bueno del FIX de Banxico en el spot, la serie y la ruta`
- `3195908 fix: meta.stale se calcula contra la jornada cerrada en vez de afirmarse falso`

### Compuertas que reportó

- **"/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv/bin/python" -m pytest -q -p no:cacheprovider -o addopts=""**: 642 passed, 1 skipped in 7.22s (la base de la fase era 482 + 1 omitida; B2a aporta 159 de tests/unit/b2a, 41 de ellas del arreglo de stale). La omitida es la que necesita red.
- **"/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv/bin/ruff" check .**: All checks passed!
- **node scripts/check-ownership.mjs B2a**: ✓ B2a (ws/B2a): 33 archivo(s), todos dentro de su propiedad.
- **pytest tests/characterization (los 122 goldens de v1)**: 274 passed in 1.33s; los 122 archivos de tests/goldens_legacy siguen en disco sin tocarse. v1 conserva sus bugs a propósito.
- **pytest tests/contract**: 85 passed in 0.55s. Borré el @stub y el raise not_implemented de cada ruta y registré su capacidad en CAPABILITIES del router.
- **git diff --name-only analizavende...ws/B2a | grep -cE 'tests/fixtures/recorded/2026-09-22/|package.*json|requirements'**: 0. Nunca escribí en el set base ni en archivos de dependencias. Mi capa 2026-09-22-b2a tiene 7 llamadas nuevas.
- **python scripts/run_replay_backend.py --module kaizen_api.main --port 8109 --set 2026-09-22,2026-09-22-b2a + curl a los 9 endpoints**: Todo verificado a ojo y apagado al final (puerto 8109 libre, proceso terminado, log sin un solo error ni ReplayMiss salvo el caso conocido de NAFTRAC a 1mo). /health anuncia quotes, fx, history, panel, fx.history, markets.overview, markets.world y search. Unidades en fracción (AAPL changePct 0.007346, no 0.73). Monedas correctas (^MXX en MXN, WALMEX.MX en MXN, FUNO11.MX en MXN). Errores: 404 NOT_F

### Pendientes que dejó

- Cobertura de fixtures, no defecto de código: NAFTRAC.MX solo quedó grabado con period=1y (no está en el set base), así que /v2/history/NAFTRAC.MX?range=1mo responde 500 ReplayMiss dentro del replay. En producción con red funciona. Los pares (símbolo, periodo) que sí están grabados: WALMEX.MX, AAPL.MX, FUNO11.MX, CEMEXCPO.MX, ^MXX y MXN=X a 1mo desde el set base, y AAPL, WALMEX.MX, NAFTRAC.MX, MXN=X y ZZZNOTREAL a 1y desde mi capa. Quien agregue combinaciones, que grabe en su propia capa y no en la base.
- El tipo de cambio que usa la conversión de históricos y el que publica /v2/fx salen de ventanas distintas de Yahoo (series_for(period) contra _yahoo_points('5d')), así que la barra de HOY, que todavía se está formando, puede diferir alrededor de 0.05%. Medido: 17.288309 en la conversión contra 17.297131 en /v2/fx para el 22 de septiembre. Las fechas ya cerradas coinciden exactas a 1e-6 (comprobé 4 de 5 fechas). Es inherente a pedir dos veces un dato intradía, no un desalineamiento de fechas, pero si molesta se resuelve compartiendo una sola serie de FX cacheada entre ambos caminos.
- El camino del FIX de Banxico está programado contra la firma de providers.banxico.fetch_series, que todavía levanta NotImplementedError porque es de B2b. Lo probé con dobles (las dos formas de respuesta que acepta _parse_banxico) pero nunca contra el proveedor real. Mientras B2b no lo implemente, /v2/fx y /v2/fx/history salen por Yahoo MXN=X con fallback=true y source 'yahoo', que es correcto pero no es el FIX.
- La lectura del company_tickers.json de la SEC quedó dentro de kaizen_api/domain/search.py en vez de providers/sec_edgar.py, que es de B3a, por propiedad de archivos. Funciona y está probada; la capa correcta sería el proveedor. Propuesta concreta en docs/requests/B2a.md para M2 o la fase 4.
- Los ETF e índices conocidos de EE. UU. quedaron como constante de Python en domain/search.py y no en un kaizen_api/data/symbols_us.json, porque mi glob de data solo admite symbols_mx.json y holidays*.json. Si se quiere mover, basta agregar el nombre al glob: el formato ya es el mismo que el de México.
- Los calendarios de holidays_bmv.json y holidays_nyse.json cubren 2026 y 2027. En 2028 hay que extenderlos o market_status deja de encontrar la siguiente jornada dentro de los 30 días de búsqueda.

### Notas de entrega

## API pública de B2a (todo en /v2, todo con meta honesto)

`GET /v2/quotes?symbols=` hasta 50 símbolos separados por coma. Devuelve `{quotes[], missing[], meta}`. Los que Yahoo no conoce van en `missing`, no se inventan. `changePct` es fracción.

`GET /v2/search?q=&limit=` busca en la lista curada de México (`kaizen_api/data/symbols_mx.json`, sin red) y en el índice de la SEC (cacheado 24 h). Los alias en español funcionan: "walmart" da WALMEX.MX, "bimbo" da BIMBOA.MX, "fibra uno" da FUNO11.MX, "cemex" da CEMEXCPO.MX y CX, "apple" da AAPL.MX y AAPL. Sin resultados responde 200 con lista vacía y una nota, no 404.

`GET /v2/history/{symbol}?range=&interval=&ccy=` devuelve `{symbol, currency, interval, adjusted, dates[], close[], fx, meta}`. Arreglos paralelos `dates`/`close`, NO una lista de puntos. Fechas reales de mercado y cierres ajustados por splits y dividendos. `range`: 1mo 3mo 6mo 1y 2y 5y 10y max (default 1y). `interval`: 1d 1wk 1mo. `ccy`: native MXN USD.

`GET /v2/panel?symbols=&range=&interval=&ccy=` cruza por fecha con INNER JOIN y **no rellena precios**. Devuelve `{currency, interval, dates[], prices{símbolo: [cierres]}, dropped[], meta}`. `ccy` default MXN. Lo que no se pudo alinear sale en `dropped` con su motivo en español. Si los símbolos cotizan en monedas distintas y pides `ccy=native`, responde 400 pidiendo MXN o USD.

`GET /v2/fx?pair=USDMXN` y `GET /v2/fx/history?pair=&start=&end=` (ojo: la serie toma `start`/`end` ISO, no `range`; un `range` se ignora y devuelve el año por omisión).

`GET /v2/markets/overview` devuelve `{groups[], marketStatus, meta}` con 24 instrumentos sin duplicados en 6 grupos (mx, us, global, fx, commodities, crypto), etiquetas en español en el campo **`label`** (no `name`). `marketStatus` trae bmv y nyse con `open`, `label`, `nextOpen`, `nextClose` en UTC.

`GET /v2/markets/world` devuelve 26 países con código ISO numérico, ETF proxy en USD y un `method` que dice honestamente que la variación incluye el movimiento de la moneda local contra el dólar.

## Costuras que implementé y pueden consumir

- `domain.history.get_series(symbol, range="1y", interval="1d", ccy="native") -> PriceSeries` con campos `symbol, currency, interval, dates, close, source, as_of, fx_pair, fx_source, notes, adjusted`. **B3a** (beta local) y **B3c** (precios de FIBRAs) van por aquí en vez de llamar a yfinance directo.
- `domain.fx.convert(amount_or_series, from_ccy, to_ccy, on=None)`. Con un número convierte al tipo de cambio de `on` (o el más reciente); con una `pandas.Series` indexada por fecha convierte punto por punto con el FX de SU misma fecha, rellenando hacia adelante a lo más 3 días y anotando cada relleno. Solo USD/MXN; cualquier otro par es 400.
- Auxiliares útiles de fx: `spot()`, `daily_range(start, end)`, `series_for(period, interval)`, `rate_on(rates, date) -> (valor, días arrastrados)`, `apply_rate`, `check_pair`.
- `domain.market_calendar`: `status(exchange, now=None)`, `market_status(now=None)`, `load_calendar`, `session`, `holiday_name` y el nuevo `last_completed_session(exchange, now=None) -> date`, que es la última jornada que YA cerró. Todas aceptan `now` explícito, así que se prueban contra instantes fijos sin congelar el reloj.
- `domain.history.exchange_for(symbol)` y `is_stale(symbol, last_date, interval, now)`; `domain.markets.basket_is_stale(as_of, now)`; `domain.search.curated_is_stale(now)`; `domain.fx.series_is_stale(series, now)`. Si agregas una ruta con datos de mercado, pásale `stale` calculado en vez de dejar el default.
- `providers.yahoo.prices`: `fetch_history`, `fetch_series`, `fetch_info`, `fetch_infos`, `download_closes(symbols, period, interval)`. **B2b** comparte el bajado en lote para VIX y DXY.

## Costuras que consumo y que todavía no existen

`providers.banxico.fetch_series(series_ids, start, end)` de **B2b**. Programé contra su firma con un lector tolerante (`domain/fx.py::_parse_banxico`) que acepta el sobre crudo del SIE y también un mapa ya normalizado, con fechas en dd/mm/aaaa o ISO, coma o punto decimal, y `N/E` tratado como hueco y no como cero. Detalles y la sugerencia de que devuelva el sobre crudo tal cual están en `docs/requests/B2a.md`. Mientras no exista, el respaldo de Yahoo se activa solo y se marca.

## Cómo correr y probar

```
cd "/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN.wt/B2a"
"/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv/bin/python" -m pytest -q -p no:cacheprovider -o addopts="" tests/unit/b2a
"/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv/bin/python" scripts/run_replay_backend.py --module kaizen_api.main --port 8109 --set 2026-09-22,2026-09-22-b2a
```

Las pruebas corren sin red. El `conftest.py` de `tests/unit/b2a` agrega la capa `2026-09-22-b2a` encima del set base aunque no pases variables de entorno, y falla si queda una llamada sin grabar. macOS no tiene `timeout`: el servidor se levanta en segundo plano, se guarda el PID y se mata al terminar.

## Convenciones que respeté y conviene no romper

Toda tasa, rendimiento y proporción va como fracción decimal. Cada respuesta trae `meta {asOf, source, delayMinutes, stale, fallback, generatedAt, notes}`. Una fuente sustituta es `fallback=true` y jamás se presenta como dato en vivo. Sin dato real de ninguna fuente, 503 UPSTREAM_UNAVAILABLE en vez de un valor fijo. Los textos son español de México sin guiones largos y sin lenguaje de compra o venta.

## Lo que ya no hay que volver a reportar

Los tres bugs de datos del legado están corregidos en v2 y siguen a propósito en v1: `^MXX` etiquetado en dólares, el DXY que pedía a Stooq y siempre fallaba, y el 17.5 fijo de USD/MXN. Los 122 goldens de v1 siguen verdes sin tocarse.

## B2b

Implementé las cuatro rutas de B2b en v2 (GET /v2/rates/mx, /v2/rates/rf, /v2/macro/us, /v2/news), el proveedor del SIE de Banxico, FRED sin llave por el CSV de fredgraph, feeds RSS en español de México y un heurístico de tono propio en domain/tone.py. Esta sesión retomó un trabajo ya commiteado: el código estaba puesto, así que me concentré en verificar de punta a punta, y al hacerlo encontré y arreglé tres defectos reales.

Los tres defectos: (1) las etiquetas de kaizen_api/data/banxico_series.json eran 100% ASCII y domain/rates.py:163 las publica tal cual en MxRateItem.label, así que con token la app habría mostrado "TIIE a 28 dias" e "Inflacion anual" sin acentos, junto a la etiqueta bien acentuada del respaldo de FRED ("Bono M 10 años"); era invisible hasta que exista un token, por eso ninguna prueba lo cazaba. (2) El aviso del respaldo de /v2/rates/rf decía siempre "No son CETES de 28 días" aunque pidieras 364: cierto pero no le responde a quien preguntó por 364; ahora RF_FALLBACK_NOTE es rf_fallback_note(tenor_days). (3) Tres guiones largos en docstrings de domain/macro.py y domain/news.py; comprobé contra analizavende que venían del legado v1 y no eran texto mío, pero están en archivos que me tocan y son solo docstrings, así que los normalicé. Los dos primeros llevan prueba de regresión, y la de los acentos la comprobé no vacía reintroduciendo el defecto a propósito y viéndola fallar.

Decisión de honestidad que conviene mirar: /v2/rates/mx sin token devuelve un solo renglón (Bono M 10Y de FRED) y NO el proxy interbancario que sugería el encargo. IR3TIB01MXM156N es mensual e interbancaria a 3 meses; publicarla bajo tiie28 o cetes28 sería presentar un instrumento como otro. Esa serie se usa solo en /v2/rates/rf, donde el contrato la nombra (source "fred_ir3tib"). Prefiero un renglón honesto que uno verosímil y equivocado.

El catálogo del SIE marca verificadas únicamente SF43718 (FIX) y SF61745 (tasa objetivo); los otros 10 ids quedan en false y el servidor los retiene en caliente hasta que los metadatos del SIE los confirmen. El camino del SIE solo está probado con la librería responses, porque no hay token.

### Commits

- `1dc66f8 feat: proveedor del SIE de Banxico y series de FRED con fechas`
- `f421e36 feat: tasas de México, tasa libre de riesgo en serie y macro de EE. UU. en v2`
- `1bd9d4f feat: noticias con fuentes en español y tono heurístico propio`
- `e6dc53a test: capa de fixtures de B2b con FRED, feeds en español y noticias de Yahoo`
- `6a3bafa test: pruebas de B2b para Banxico, FRED, tasas, macro, noticias y tono`
- `6845a34 perf: verificar los ids del SIE una sola vez para las dos rutas de tasas`
- `32d5831 fix: las etiquetas del catálogo del SIE llevan acentos y los docstrings pierden el guion largo`
- `585203c fix: el aviso del respaldo de tasa libre de riesgo nombra el plazo que se pidió`

### Compuertas que reportó

- **"/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv/bin/python" -m pytest -q -p no:cacheprovider -o addopts=""**: 655 passed, 3 skipped in 7.13s (la base de la fase era 482 passed + 1 skipped). Los 3 skips: tests/replay/test_live.py (1, ya existía) y tests/unit/b2b/test_banxico_live.py (2, míos), los tres detrás de KAIZEN_LIVE=1.
- **"/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv/bin/ruff" check .**: All checks passed!
- **node scripts/check-ownership.mjs B2b**: ✓ B2b (ws/B2b): 33 archivo(s), todos dentro de su propiedad.
- **"/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv/bin/python" -m pytest -q -p no:cacheprovider -o addopts="" tests/characterization**: 274 passed in 1.59s. Los 122 goldens del legado siguen en disco sin tocarse y el v1 no cambió.
- **"/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv/bin/python" -m pytest -q -p no:cacheprovider -o addopts="" tests/contract**: 85 passed in 0.55s (incluye el mapeo ruta->capacidad, que falla por datos si quitas el stub sin declarar la capacidad o al revés).
- **python scripts/run_replay_backend.py --module kaizen_api.main --port 8110 --set 2026-09-22,2026-09-22-b2b + curl a todas las rutas**: Arrancó con red=bloqueada. /health: capacidades ['auth','legacy.v1','macro.us','news','rates.mx','rf.series'], las cuatro mías presentes. Códigos: /v2/rates/mx 200, /v2/rates/rf 200 (28/91/364), tenorDays=99 -> 422, rango invertido -> 422, /v2/macro/us 200, /v2/news 200, ?symbol= 200 (idéntico a sin symbol, 50 items), ?symbol=SPY 200, ?symbol=CEMEXCPO.MX 200, ?symbol=%25 -> 400 INVALID_SYMBOL, ?li
- **Revisión a ojo de unidades, monedas y meta (curl + inspección)**: rates/mx: fallback=true con nota honesta de que falta BANXICO_TOKEN. rates/rf: 35 puntos, fracciones (último 0.0679), convention simple_act360, source fred_ir3tib, fallback=true. macro/us: ust3m 0.0414, ust2y 0.0476, ust10y 0.0501 en fracción; spreads en bp verificados a mano (10Y-2Y = 0.0501-0.0476 = 25 bp; 10Y-3M = 87 bp; previos 27 y 82, de ahí -2 y +5 bp de cambio); VIX 14.87 y DXY 100.54 como
- **Garantías de /v2/news sobre 50 titulares reales**: 50 items, 50 títulos normalizados únicos (dedup real), todas las ligas http(s), ninguna javascript:, 0 titulares con entidades HTML sin decodificar (se ve 'S&P 500' bien resuelto), idiomas es/en, method 'heuristic' en todos, etiquetas positivo/negativo/neutral (21/7/22). Tono a ojo: 'mejora', 'récord', 'Rises' positivos; 'recorta', 'caída', 'Fall', 'Slips' negativos; los ambiguos en neutral.
- **Integridad de fixtures y secretos**: git diff contra analizavende sobre tests/fixtures/recorded/2026-09-22/ -> vacío: NO escribí en el set base. Mi capa 2026-09-22-b2b tiene 9 archivos. grep de correo del usuario, gmail, BANXICO_TOKEN, Bmx-Token, api_key y token sobre mis fixtures -> vacío.

### Pendientes que dejó

- docs/requests/B2b.md, punto 1: GET /v2/news ya no declara `pattern` en el OpenAPI para `symbol`, solo `maxLength: 20`. El spec pide que `?symbol=` (vacío) se trate como ausente, y con Query(pattern=...) la cadena vacía daba 400. La validación de formato se hace dentro de la ruta y sigue dando 400 INVALID_SYMBOL con los mismos details.fields. Si O prefiere que el OpenAPI anuncie el patrón, hay que decidir otra cosa para la cadena vacía (por ejemplo `^$|<patrón>`): las dos juntas no se pueden.
- docs/requests/B2b.md, punto 2: MxRateItem.seriesId lleva un id de FRED (IRLTLT01MXM156N) cuando el renglón es de respaldo, pero el contrato describe el campo como "Id de la serie en el SIE de Banxico". El tipo es str y valida, pero conviene corregir la descripción a "id de la serie en su fuente" en schemas.py y docs/api-v2.md. No toqué schemas.py porque está congelado.
- docs/requests/B2b.md, punto 3: RfSeriesResponse.convention es Literal["simple_act360"] y el respaldo de FRED (IR3TIB01MXM156N, interbancaria mensual de la OCDE) no cumple esa convención. Se publica igual porque el contrato solo permite ese literal, con el aviso en meta.notes y fallback=true. Si se quiere exactitud, el campo tendría que aceptar algo como "unknown" o "annualized_simple".
- El camino del SIE de Banxico está probado SOLO con la librería responses, con el formato JSON documentado. Nadie lo ha visto contra el SIE real porque no hay token. Los 10 ids no verificados del catálogo (TIIE 28, TIIE de Fondeo, los cuatro CETES, Bono M, inflación, subyacente y UDI) no se publican hasta que los metadatos del SIE los confirmen.
- /v2/rates/mx sin token devuelve un solo renglón (Bono M 10Y de FRED), no el proxy interbancario que sugería el encargo. Es deliberado y está razonado en el código: IR3TIB01MXM156N es mensual e interbancaria a 3 meses, así que bajo tiie28 o cetes28 sería presentar un instrumento como otro. Si O prefiere publicarla ahí con etiqueta clara, es una línea, pero yo no la pondría.
- El respaldo de /v2/rates/rf sirve la misma serie de 3 meses para los cuatro plazos (28/91/182/364). Ahora el aviso nombra el plazo que se pidió, pero sigue siendo un sustituto: mientras no haya token, tenorDays es lo que pediste, no lo que te dieron.
- domain/macro.py::_yahoo_close_series duplica la llamada de la costura de B2a (domain/markets.py::_bulk_download) con los mismos argumentos en vez de importarla, porque _bulk_download tira el índice de fechas y UsMacroItem.asOf es obligatorio. Es la misma llave de fixture (yf.download:[DX-Y.NYB]?period=5d), o sea la misma llamada a Yahoo, no una de más. Si B2a expone una variante que conserve fechas, este archivo la usaría.

### Notas de entrega

## B2b: tasas de México, macro de EE. UU., noticias y tono

### Lo que quedó servible (API pública)

**Rutas nuevas en v2**, con sus capacidades ya declaradas en el CAPABILITIES del router (por eso /health las anuncia):

- `GET /v2/rates/mx` -> capacidad `rates.mx`, en `routers/rates.py`
- `GET /v2/rates/rf?start&end&tenorDays` -> capacidad `rf.series`, mismo archivo. tenorDays en {28,91,182,364}, default 28
- `GET /v2/macro/us` -> capacidad `macro.us`, en `routers/macro.py`
- `GET /v2/news?symbol&lang&limit` -> capacidad `news`, en `routers/news.py`. lang en {es,en,all} default all, limit 1..100 default 30

**Costuras que implementé y pueden consumir otros streams:**

`kaizen_api/providers/banxico.py`
- `configured() -> bool`: ¿hay BANXICO_TOKEN en el entorno?
- `fetch_series(series_ids, start=None, end=None) -> dict`: series del SIE. Manda el token en la cabecera `Bmx-Token`. Sin token levanta ApiError 503 NOT_CONFIGURED, o sea que el que llama puede caer a su respaldo. Las dos fechas o ninguna. Ordena aunque el SIE devuelva al revés.
- `fetch_metadata(series_ids) -> dict`: solo metadatos (`titulo`, `unidad`, `periodicidad`, `fechaFin`).
- `verified_ids(series_ids) -> dict[str, bool]`: con token le pregunta al SIE y compara el título real contra `tituloContiene` del catálogo (comparación que ignora acentos y mayúsculas). Cacheado 24 h. Esta es la red de seguridad: aunque el JSON diga verified=false, en caliente se publica solo lo que el SIE confirma.
- `catalog()`, `catalog_notes()`, `series_for(rate_id)`, `parse_amount(raw)`, `parse_date(raw)`. `parse_amount` resuelve "N/E", "N/D", vacío y guion a None, y no confunde miles con decimales ("17,251.23" -> 17251.23).

`kaizen_api/providers/fred.py` (sin llave, por el CSV de fredgraph)
- `fetch_series(series_id, start=None, end=None) -> {"dates": [...], "values": [...]}`
- `last_points(series_id, count=2)`, `latest(series_id)`, `parse_csv(text)`
- **Ojo, esto cuesta tiempo si lo redescubres:** FRED se cuelga con User-Agent de navegador o personalizado. Hay que dejar el User-Agent por default de `requests`. No lo cambies.

`kaizen_api/domain/tone.py` (heurístico propio, NO Loughran-McDonald)
- `tone(text) -> {"label", "score", "method"} | None`, con `method` siempre `"heuristic"`
- `explain(text) -> dict`: qué palabras pesaron, útil para depurar o para una vista de transparencia
- `label_for(score)`, `tokenize(text)`. Léxico español/inglés escrito a mano, con intensificadores, atenuadores y negación en ventana de 3 palabras. THRESHOLD 0.20.

`kaizen_api/providers/rss.py`
- `fetch_feed(url)`, `parse_feed(payload)`, `strip_html(raw, limit=280)`, `parse_instant(raw)`, `numeric_entities(data)`

`kaizen_api/domain/news.py`: `normalize_title(title)` y `feeds()` por si alguien más necesita deduplicar titulares con el mismo criterio.

### Datos en disco que te pueden servir

- `kaizen_api/data/banxico_series.json`: 12 series con id, etiqueta, unidad, `sieUnit`, `rateId` del contrato, `maxAgeDays`, `tituloContiene` y `verified`. **Solo SF43718 (FIX) y SF61745 (tasa objetivo) están verificadas.** Trae un bloque `comoVerificar` con el comando exacto para cuando el dueño consiga token.
- `kaizen_api/data/feeds_es.json`: cuatro feeds (Expansion mercados y economía, El Financiero mercados y economía), con `queSePublica`, `comoSeEligieron`, `atribucion` y los `descartados` con su porqué. Si agregas feeds, respeta el criterio: solo titular, liga y medio, nunca el cuerpo de la nota.

### Cómo correrlo y probarlo

```
"/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv/bin/python" -m pytest -q -p no:cacheprovider -o addopts=""
"/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv/bin/ruff" check .
node scripts/check-ownership.mjs B2b
```

Backend de replay (offline, red bloqueada):
```
python scripts/run_replay_backend.py --module kaizen_api.main --port 8110 --set 2026-09-22,2026-09-22-b2b
```
Mi capa de fixtures es `2026-09-22-b2b` (9 archivos: 3 de FRED, 4 de feeds en español, 1 de noticias de Yahoo, más el índice). **No escribí en el set base**, comprobado con git diff. Si vas a grabar algo nuevo, usa tu propia capa igual que yo.

Verificar los ids del SIE cuando haya token (esto es lo que pediste documentar):
```
export BANXICO_TOKEN=... KAIZEN_LIVE=1
.venv/bin/python -m pytest -q -p no:cacheprovider -o addopts="" tests/unit/b2b/test_banxico_live.py -s
```
Pide `GET /series/<ids>` (solo metadatos, no datos), compara el título que devuelve el SIE contra `tituloContiene` de cada id, revisa periodicidad y fechaFin, e imprime los confirmados. Después pones `verified: true` únicamente en los que pasaron y anotas la fecha en `revisado`. El token gratis sale en https://www.banxico.org.mx/SieAPIRest/service/v1/token

### Limitaciones conocidas, dilas si alguien pregunta

1. **El camino del SIE nadie lo ha visto en vivo.** Está probado con `responses` contra el formato JSON documentado, y con eso basta para el contrato, pero el primer contacto real puede traer sorpresas (sobre todo en `periodicidad` y en series que devuelven "N/E" seguido).
2. **Sin token, /v2/rates/mx trae un solo renglón**, el Bono M 10Y de FRED, con fallback=true. No hay TIIE, CETES, inflación, UDI ni FIX. Es a propósito: la única serie de México que FRED tiene (IR3TIB01MXM156N) es interbancaria a 3 meses y mensual, así que ponerla bajo tiie28 o cetes28 sería mentir con un dato verdadero. Esa serie se usa solo en /v2/rates/rf, marcada, con `source: "fred_ir3tib"`.
3. **El respaldo de /v2/rates/rf sirve la misma serie de 3 meses para los cuatro plazos.** El aviso ahora nombra el plazo que pediste, pero sigue siendo un sustituto y `convention` dice `simple_act360` porque el contrato no admite otra cosa (ver docs/requests/B2b.md punto 3).
4. **El tono es una heurística, no un modelo.** Va en un campo aparte, nunca mezclado con los números, y `method` lo dice. No lo uses para ordenar ni para nada que parezca una señal de compra o venta.
5. **/v2/news declara delayMinutes=15**, porque los feeds y Yahoo publican con retraso. No lo presentes como tiempo real.
6. **domain/macro.py duplica la llamada de la costura de B2a** (`_bulk_download`) con los mismos argumentos, porque esa función tira el índice de fechas y `UsMacroItem.asOf` es obligatorio. Misma llave de fixture, misma llamada a Yahoo, no una de más. B2a: si expones una variante que conserve las fechas, aquí se usa.

### Si tocas mis archivos, cuidado con esto

- Las etiquetas de `banxico_series.json` **se publican tal cual** en `MxRateItem.label`. Llevan acentos y hay una prueba que lo cuida (`test_las_etiquetas_del_catalogo_llevan_acentos`), porque el defecto es invisible hasta que exista un token.
- `schemas.py` está congelado y no lo toqué. Si el contrato te estorba, escribe tu propio docs/requests y construye contra el modelo de hoy.
- Si implementas una ruta, acuérdate de borrar **las dos** cosas (el decorador `@stub` y el `raise not_implemented(...)`) y de agregar la capacidad al CAPABILITIES de tu router. Las pruebas de contrato fallan por datos si haces una y no la otra.

## B3a

Los cinco endpoints de B3a quedaron implementados y verificados contra el servidor de replay: GET /v2/instrument/{symbol}, /v2/instrument/{symbol}/statements, /v2/instrument/{symbol}/dividends, /v2/insiders/{symbol} y /v2/events. Los cinco @stub y sus raise not_implemented se borraron y las capacidades (instrument, statements.real, dividends, insiders, events) ya salen en /health.

El trabajo de moneda es el centro. priceCurrency sale de info["currency"] y financialCurrency de info["financialCurrency"]; cuando difieren, cada monto de los estados pasa por fx.convert (costura de B2a) ANTES de mezclarse con el precio. Como esa costura todavía levanta NotImplementedError, AAPL.MX (cotiza en MXN, reporta en USD) devuelve ps, evEbitda, pfcf, fcfYield y enterpriseValue en null, coverage 16/22 y una nota que lo explica, en vez del 182.6 de P/S que publica Yahoo mezclando pesos con dólares. WALMEX.MX, que cotiza y reporta en pesos, sale completo 22/22. GBp/ZAc se normalizan a GBP/ZAR dividiendo entre 100. debtToEquity se divide entre 100 porque Yahoo lo publica en porcentaje (34.825 son 0.35 veces).

La beta se calcula con rendimientos semanales emparejados POR FECHA contra el referente local en la misma moneda (NAFTRAC.MX para MXN, SPY para USD), cruda y ajustada por Blume (0.67b+0.33), con window y observations. Si las monedas no coinciden, se niega. La de Yahoo solo se usa como respaldo para papeles en dólares, marcada source "yahoo", observations 0 y una nota que dice que es contra el S&P 500; para .MX nunca se usa.

Los estados son reales: SEC companyfacts para emisoras estadounidenses (con form 10-K/10-Q por periodo) y estados de Yahoo para las demás (form null, y una nota que dice que Yahoo no publica el trimestre fiscal). No se sintetiza ningún trimestre: en WALMEX.MX el hueco de 2025-09-30 se queda como hueco. Los insiders separan compras y ventas en mercado abierto (códigos P y S de la Forma 4) de otorgamientos y ejercicios (A y M), con la bandera de plan 10b5-1.

En esta continuación encontré y corregí dos deshonestidades chicas que ya estaban en el código: earningsYield caía en silencio a 1/(P/U) cuando no había estados convertidos, justo debajo de una nota que prometía que esas razones quedaban vacías; y el rendimiento de /dividends (pagos reales de 12 meses) difiere del de /instrument (el que publica Yahoo) sin que nada lo dijera, 3.75 % contra 4.45 % en WALMEX. Las dos ahora se explican en meta.notes y tienen prueba.

### Commits

- `0902218 feat: ficha de emisora, estados reales, dividendos, eventos e insiders del v2`
- `0dbbd01 test: pruebas de B3a con respuestas conocidas y capa de fixtures propia`
- `8790b16 docs: solicitudes de B3a sobre la fecha del tipo de cambio y el referente de la beta`
- `7a896df fix: el rendimiento de la utilidad y el de dividendos dicen de dónde salieron cuando no vienen de los estados`

### Compuertas que reportó

- **"/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv/bin/python" -m pytest -q -p no:cacheprovider -o addopts=""**: 619 passed, 1 skipped in 7.30s (la base de la fase era 482 passed + 1 skipped; B3a aporta 137 pruebas nuevas en tests/unit/b3a/). Todo sin red, bajo la guarda con replay.
- **"/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv/bin/ruff" check .**: All checks passed!
- **node scripts/check-ownership.mjs B3a**: ✓ B3a (ws/B3a): 57 archivo(s), todos dentro de su propiedad.
- **python scripts/run_replay_backend.py --module kaizen_api.main --port 8111 --set 2026-09-22,2026-09-22-b3a + curl a cada endpoint**: Servidor arriba con red bloqueada. /health: apiVersion 2 y capabilities ['auth','events','instrument','statements.real','dividends','insiders','legacy.v1'], o sea las cinco mías. Revisado a ojo: /v2/instrument/AAPL (USD/USD, changePct 0.007272, debtToEquity 0.78445, earningsYield 0.025872 = utilidad neta/capitalización, coverage 22/22, beta de respaldo de Yahoo con nota, fallback true); /v2/instru

### Pendientes que dejó

- Las razones que mezclan precio con estados salen en null para papeles con moneda de cotización distinta a la de sus estados (AAPL.MX y cualquier SIC) hasta que B2a implemente fx.convert. No es un bug de B3a: es la decisión de no mezclar monedas en silencio. En cuanto exista la costura se llenan solas, y hay prueba que lo demuestra fingiéndola (test_aapl_mx_converts_the_statements_when_there_is_an_fx).
- fxUsed.asOf sale siempre en null porque la costura congelada convert(monto, de, a, on=None) no devuelve la fecha del tipo de cambio. Pedido detallado en docs/requests/B3a.md punto 1: se propone una función hermana rate(from, to, on) -> (tasa, fechaISO, esSustituto), sin tocar la firma congelada.
- La beta sale null en TODOS los símbolos mientras history.get_series (B2a) levante NotImplementedError, salvo el respaldo de Yahoo para papeles en dólares. El cálculo ya está completo y probado contra respuestas conocidas con series fingidas; solo espera la costura.
- sectorMedians sale en null a propósito: calcular medianas por sector obliga a recorrer un universo completo, que es lo de B3c. El contrato ya permite null. Conviene acordar la costura en fase 3 en vez de que cada stream arme su mediana.
- /v2/events con un símbolo NO grabado responde 500 con {"error":"ReplayMiss"} en el servidor de replay. NO es un defecto del código: ReplayMiss hereda de BaseException a propósito (tests/replay/session.py línea 58, 'so except Exception cannot hide it') para que un fixture faltante sea ruidoso. En producción get_calendar y get_info atrapan Exception y devuelven {}, así que el símbolo cae en missing con su nota; está cubierto por test_a_symbol_without_a_calendar_is_reported_not_faked. Lo reporto explícito porque un curl contra el replay lo hace ver como error del endpoint.
- /statements e /insiders responden 200 con periodos y movimientos vacíos para un símbolo inexistente, mientras que /instrument y /dividends responden 404. Es defendible (vacío es un resultado legítimo ahí), pero es una inconsistencia de forma entre endpoints hermanos que el revisor puede querer unificar.
- Los eventos de dividendo traen amount en null: Yahoo publica la fecha del dividendo que viene, no su monto, y la nota lo dice. No se estima.

### Notas de entrega

HANDOFF COMPLETO DE B3a (rama ws/B3a, 4 commits sobre analizavende)

## API pública que queda servida

Todos en /v2, todos con meta {asOf, source, delayMinutes, stale, fallback, generatedAt, notes}, todo porcentaje/rendimiento/peso como FRACCIÓN, errores {error:{code,message}} en español.

1. GET /v2/instrument/{symbol} -> InstrumentResponse. Trae symbol, name, exchange, type (equity | etf | index | fibra), sector, industry, country, description, website, priceCurrency, financialCurrency, fxUsed {pair, rate, asOf} o null, quote, fundamentals (22 llaves), beta, sectorMedians (null por ahora), coverage {available, total}. type "fibra" = emisora .MX del sector Real Estate.
2. GET /v2/instrument/{symbol}/statements?freq=annual|quarterly -> StatementsResponse. OJO: NO acepta un parámetro kind; devuelve los 13 renglones juntos (resultados, balance y flujo) por periodo. Campos: symbol, currency, freq, source ("sec" | "yahoo"), periods [{end, fiscalYear, fiscalQuarter, form}], rows [{label, values}].
3. GET /v2/instrument/{symbol}/dividends -> DividendsResponse: symbol, currency, ttm, yield, history [{date, amount}] (máx 60, ordenada).
4. GET /v2/insiders/{symbol} -> InsidersResponse: items [{date, insider, role, type, shares, value, planned10b5_1}], summary {openMarketBuys, openMarketSells}. type ∈ compra | venta | otorgamiento | ejercicio | otro.
5. GET /v2/events?symbols=A,B,C -> EventsResponse: items [{symbol, type, date, estimate, amount, currency}], type ∈ earnings | exDividend | dividendPay, ordenados por fecha y luego símbolo.

Capacidades anunciadas en /health: instrument, statements.real, dividends (en routers/research.py), insiders (routers/insiders.py), events (routers/events.py).

## Costuras que CONSUMO (no las implementé, no las toqué)

- domain/fx.py::convert(monto, de, a, on=None) (dueño B2a). La uso vía domain/currency.py::Converter. Mientras levante NotImplementedError, Converter.ok es False y todo lo que mezcle precio con estados queda en null con nota. Cuando la implementes NO hay que tocar B3a: se llena solo. Pido además una función hermana rate(...) para poder llenar fxUsed.asOf (docs/requests/B3a.md punto 1).
- domain/history.py::get_series(symbol, range, interval, ccy) y PriceSeries (dueño B2a). La uso para la beta con ("2y", "1wk", "native"). DOS AVISOS IMPORTANTES: (a) PriceSeries.currency tiene que traer la moneda REAL del papel, porque comparo esa moneda con la del referente y me niego a calcular si no coinciden; (b) NAFTRAC.MX no estaba en el set base de fixtures, así que ya lo grabé en mi capa 2026-09-22-b3a (history 1wk/2y, y también 1y, 5y e info) con la misma forma de llave que usa _fetch_hist. Si tu get_series llama a Yahoo con otros parámetros vas a necesitar grabar esa llave, pero el dato de NAFTRAC ya está ahí para no volver a salir a la red.

## Costuras que YO implemento y otros pueden consumir

- kaizen_api/domain/currency.py (nuevo, mío): normalize_currency(code) -> (ISO4217, divisor) resuelve GBp/GBX/ZAc/ZAX/ILA a su moneda mayor con divisor 100; scale_minor(monto, divisor); Converter(moneda_estados, moneda_precio) con .same, .ok, .failure, .to_price(monto) y .used(). Si necesitas normalizar monedas o convertir estados, usa esto en vez de escribir el tuyo.
- kaizen_api/domain/fundamentals.py: get_instrument(symbol), get_dividends(symbol), compute_beta(symbol, moneda, notes), div_yield_fraction(info), instrument_type(info, symbol).
- kaizen_api/domain/statements.py: get_statements(symbol, freq) y los lectores de SEC companyfacts.
- kaizen_api/providers/sec_edgar.py: acceso a companyfacts y a los expedientes de la Forma 4.
- B3b (valuación) y B3c (screener): si van a mezclar capitalización con renglones de estados, PASEN por Converter o van a repetir el error de Yahoo. El P/S de AAPL.MX que publica Yahoo vale 182.6 justamente por no hacerlo.

## Cómo correr y probar

Pruebas (sin red, obligatorio):
  "/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv/bin/python" -m pytest -q -p no:cacheprovider -o addopts="" 
  -> 619 passed, 1 skipped. Las mías son tests/unit/b3a/ (137).
  ruff:  "/.../.venv/bin/ruff" check .   -> limpio.
  propiedad: node scripts/check-ownership.mjs B3a -> 57 archivos, todos dentro.

Servidor para mirar con los ojos:
  "/.../.venv/bin/python" scripts/run_replay_backend.py --module kaizen_api.main --port 8111 --set 2026-09-22,2026-09-22-b3a
  (arrancarlo en segundo plano, guardar el PID y matarlo al terminar; macOS no tiene timeout)

El conftest de tests/unit/b3a/ expone el fixture replay_b3a, que apila mi capa sobre la base, y un helper strings(obj) para recorrer todo el texto de una respuesta (lo uso para probar que no hay guiones em).

## Fixtures que grabé (capa 2026-09-22-b3a, nunca escribí en la base)

Una sola corrida, pausada, sin tokens ni correos en headers. Yahoo: dividends e info/calendar de AAPL, AAPL.MX, SPY, WALMEX.MX, CEMEXCPO.MX, FUNO11.MX; history e info de NAFTRAC.MX. SEC: submissions y 19 expedientes de la Forma 4 de Apple (CIK 320193) más companyfacts. Si necesitas una llave que la base grabó vacía, tu capa va PRIMERO y se nombra como destino: --set 2026-09-22-<tu-stream>,2026-09-22 --grabar-en 2026-09-22-<tu-stream>.

## Límites conocidos, por si alguien los ve y cree que son bugs

- La beta sale null en todo mientras no exista get_series, salvo el respaldo de Yahoo para papeles en dólares (marcado source "yahoo", observations 0, con nota que dice que es 5 años mensual contra el S&P 500). Para .MX JAMÁS se usa la de Yahoo.
- Las razones que mezclan precio con estados salen null en papeles con moneda cruzada hasta que exista fx.convert. Es a propósito.
- fxUsed.asOf siempre null (falta la fecha en la costura).
- sectorMedians siempre null (es dato de B3c).
- En Yahoo, form y fiscalQuarter van null: esa fuente no dice de qué documento salió cada cierre. Con la SEC sí vienen.
- El monto del dividendo que viene va null: Yahoo publica la fecha, no el monto.
- /v2/events contra el replay con un símbolo no grabado da 500 ReplayMiss. Es la guarda de fixtures (BaseException a propósito), no el endpoint; en producción ese símbolo cae en missing.
- El rendimiento por dividendo de /dividends (pagos reales de 12 meses) puede no coincidir con fundamentals.dividendYield de /instrument (el que publica Yahoo). Cuando difieren más de 10 % la respuesta de /dividends lo explica en una nota. Si la UI muestra los dos, conviene mostrar también esa nota.

## schemas.py

No pedí ni un cambio: el contrato aguantó los cinco endpoints. Dos cosas que podrían leerse como error y no lo son, escritas en docs/requests/B3a.md punto 4: Beta.observations va en 0 cuando la beta es la de Yahoo (no la calculamos, no sabemos cuántas observaciones usó), y StatementPeriod.form va en null para Yahoo.

## B3b

Reanudé la corrida que se cortó por cuota. Al llegar, el worktree traía 7 commits y 4 archivos sin commitear, y las tres compuertas ya salían en verde, así que no rehice nada: verifiqué lo que había, terminé lo pendiente y arreglé tres defectos reales que encontré verificando.

Lo que encontré al auditar lo heredado:

1. Los datos de Damodaran son reales, comprobado contra los archivos oficiales. Como el .venv no trae xlrd, escribí un lector mínimo de BIFF8/OLE2 en el scratchpad y bajé ctryprem.xls, pbvdata.xls, betas.xls y wacc.xls de pages.stern.nyu.edu. Todo cuadra a 6 decimales: Baa2 = 161.809 pb y Aa1 = 23.337 pb del catálogo de calificaciones, México Baa2 con ERP total 0.0669496 y CRP 0.0246496, ERP de mercado maduro 0.0423, multiplicador de volatilidad 1.5233781, tasas estatutarias 30 % y 25 %, y las industrias (Advertising pb 4.551215, roe -0.013423, betaUCash 1.00801, Rd 0.052913, WACC 0.078061; Bank (Money Center) betaU 0.341059, WACC 0.049849). No hay números inventados.

2. Un defecto real de dato: la prima total de Estados Unidos estaba guardada como 0.044634, que es 0.0423 + 0.002334 derivado a mano. El archivo dice 0.0446, porque Damodaran captura ahí la prima implícita y por eso su propia hoja no cuadra con la fórmula. Lo corregí al valor del archivo, dejé una nota explicando la diferencia de 0.34 pb y puse una prueba que fija los dos países contra el archivo. No afecta ningún cálculo: el CAPM usa mercado maduro más prima país, no ese campo.

3. Dos defectos de copy que solo se ven corriendo la ruta: la nota de moneda de momentum decía "comparar un precio en pesos contra un índice en dólares" incluso para AAPL en dólares, y la nota del DCF cantaba un crecimiento de 18.7 % anual sin decir de dónde salía. Las dos quedaron arregladas con prueba.

4. Un servidor huérfano de la corrida anterior seguía escuchando en 8112 desde las 12:26 con el código viejo. Lo maté antes de verificar, para no medir contra código que ya no existe.

Verificación en vivo contra el servidor de replay, no leyendo código: 17 rutas de éxito en 200 (valuation y momentum para AAPL, AAPL.MX, WALMEX.MX, CEMEXCPO.MX, GFNORTEO.MX, FUNO11.MX, SPY, NAFTRAC.MX y ^MXX) y 4 de error correctas (404 NOT_FOUND, 422 VALIDATION_ERROR, 400 INVALID_SYMBOL, todos con {error:{code,message}} en español). Revisé por programa que toda tasa sea fracción, que WACC menos g nunca baje de 2 pp, que el P/VL de bancos sea de verdad (ROE-g)/(Re-g), que la referencia de momentum esté en la moneda del activo y que ninguna cadena traiga guión largo. Cero problemas y cero errores en el log del servidor. Comprobé el 12-1 a mano sobre los cierres grabados: AAPL P11/P0 = 308.6438/231.2856 - 1 = 0.334470, con agosto 2026 como el mes que se salta.

### Commits

- `0b85640 feat: datasets de enero 2026 de Damodaran con su fuente, fecha y lo que no publica`
- `1ffeded feat: matemáticas del DCF de FCFF y parámetros de mercado con tasa libre de riesgo real`
- `76f95dd feat: múltiplos relativos y DCF de dos etapas con monedas cuadradas y P/VL de bancos`
- `ecbb4eb feat: momentum 12-1 sobre cierres de fin de mes contra una referencia en la misma moneda`
- `d998fed feat: /v2/valuation y /v2/momentum dejan de ser stub y anuncian sus capacidades`
- `fb6024f test: capa de grabaciones de B3b con los históricos mensuales y Banorte`
- `d715d8b test: respuestas conocidas del DCF, múltiplos, momentum y las dos rutas`
- `2fac1dd fix: el país y los acentos en español en las notas que ve el usuario`
- `1153c6c fix: la prima total de Estados Unidos se copia del archivo, no se deriva`
- `2f6ef64 fix: las notas dicen de dónde salió el crecimiento y no nombran una moneda que no es`

### Compuertas que reportó

- **"/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv/bin/python" -m pytest -q -p no:cacheprovider -o addopts=""**: 607 passed, 1 skipped in 6.66s (base de la fase: 482 passed + 1 skipped; tests/unit/b3b aporta 124: test_dcf 14, test_momentum 14, test_multiples 12, test_params 27, test_routes 57). Los 122 goldens del legado v1 siguen pasando sin tocarse.
- **"/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv/bin/ruff" check .**: All checks passed!
- **node scripts/check-ownership.mjs B3b**: ✓ B3b (ws/B3b): 31 archivo(s), todos dentro de su propiedad.
- **curl http://127.0.0.1:8112/health (servidor de replay --set 2026-09-22,2026-09-22-b3b, puerto 8112)**: apiVersion 2, status ok, capabilities ['auth', 'valuation.multiples', 'valuation.dcf', 'momentum', 'legacy.v1']. Las tres capacidades de B3b aparecen anunciadas.
- **Barrido por programa de las 17 rutas de éxito y 4 de error contra el servidor de replay**: 17 en 200 y 4 errores correctos (404 NOT_FOUND x2, 422 VALIDATION_ERROR, 400 INVALID_SYMBOL). Revisado: meta con las 7 llaves, unidades en fracción, WACC-g >= 2 pp, P/VL = (ROE-g)/(Re-g), referencia en la misma moneda, cero guiones largos. PROBLEMAS: ninguno. Log del servidor sin errores (2 líneas, ambas de arranque).
- **Respuestas conocidas del encargo, dentro de tests/unit/b3b/test_dcf.py**: FCFF0 100, g 10 % a 5 años, g terminal 3 %, WACC 9 % -> etapa 1 513.93, VP del VT 1796.87, EV 2310.80. Hamada beta_U .8 / D/E .5 / t .3 -> 1.08 (y la inversa da .8). Re = 4.2 % + 1.08*4.5 % + 2.5 % = 11.56 %. WACC con E/V 2/3 y Rd 7 % = 9.34 %, y 10.62 % en pesos con inflación 3.5 / 2.3. P/VL justificado 15 %/5 %/12 % = 1.4286. Todas pasan.
- **Verificación de los datasets de Damodaran contra los archivos oficiales (descarga y lectura del .xls)**: ctryprem.xls, pbvdata.xls, betas.xls y wacc.xls coinciden con lo guardado a 6 decimales. Única diferencia encontrada y corregida: erpTotal de Estados Unidos, que estaba derivado (0.044634) en vez del 0.0446 del archivo.
- **grep de secretos en tests/fixtures/recorded/2026-09-22-b3b/ y lsof del puerto 8112**: Ningún token ni correo en la capa (116 KB, 14 llamadas). Puerto 8112 libre y ningún run_replay_backend vivo al terminar.

### Pendientes que dejó

- Las tres costuras que B3b necesita todavía no existen, y por eso hay puentes dentro de archivos de B3b. Está todo escrito en docs/requests/B3b.md: (1) fundamentales v2 de B3a, hoy inputs.py le habla a Yahoo directo; (2) rf de B2b, hoy params.risk_free usa FRED (DGS10 e IRLTLT01MXM156N) como principal y la costura de B2b como RESPALDO marcado con fallback=true; (3) history.get_series de B2a, que sigue lanzando NotImplementedError, así que momentum cae a yft(symbol).history(period='2y', interval='1mo'). Los tres puentes se quitan en el merge cambiando solo el cuerpo de una función.
- La tasa de impuesto efectiva se acepta tal cual dentro de la banda 0 a 0.5 (MIN_TAX_RATE y MAX_TAX_RATE en inputs.py) y fuera de esa banda cae a la estatutaria del país de Damodaran. CEMEXCPO.MX sale con 48.8 % efectiva, que es dato real de sus estados pero castiga el FCFF. Queda etiquetado como 'efectiva del último ejercicio' en las notas. Si el revisor de finanzas prefiere la marginal para el valor terminal, es un cambio de una línea en service.py.
- MultipleMethod del contrato no tiene campo para decir POR QUÉ un método no aplica. El P/FCF sale con benchmark null y applicable false, y la razón (Damodaran no publica ese múltiplo por industria en el vintage de enero 2026) va en meta.notes. Si se quiere por método, sería un reason: str | None en MultipleMethod. No se pidió el cambio porque se resolvió dentro del contrato actual.
- ValuationResponse.currency es la moneda de COTIZACIÓN, y el DCF de una empresa que reporta en otra moneda sale en la moneda de sus flujos. CEMEXCPO.MX es el caso vivo: currency MXN, dcf.inputs.currency USD, con el tipo de cambio USDMXN=X a 17.2275 dicho en la nota. La UI tiene que leer dcf.inputs.currency para ese bloque y no la de arriba.
- El 12-1 toma como 't' el último cierre de mes COMPLETO, no el mes en curso. Hoy (22 de septiembre) eso significa ventana de agosto 2025 a julio 2026, con agosto 2026 como el mes que se salta. Es exactamente el P11/P0 - 1 sobre 13 cierres que pide el encargo y son 11 intervalos mensuales, pero conviene que el revisor de finanzas lo confirme, porque otra lectura válida sería usar agosto 2026 contra septiembre 2025.
- La corrida anterior dejó un servidor de replay colgado en el puerto 8112 desde las 12:26. Lo maté en esta sesión. Si otro stream reanuda una corrida cortada, que revise lsof -nP -iTCP:<su puerto> -sTCP:LISTEN antes de verificar, porque un servidor viejo sirve código viejo y la verificación sale falsamente buena.
- Para leer los .xls de Damodaran hay que escribir un lector propio: el .venv no tiene xlrd ni openpyxl para BIFF8, y pandas 3 no lee .xls sin él. No pedí la dependencia porque solo se necesita para verificar el dataset, no para correr el API, y el JSON ya está en el repo. Si alguien quiere reverificar, el lector mínimo que usé se puede rehacer en media hora o se pide xlrd en docs/requests/.

### Notas de entrega

ENTREGA DE B3b: valuación (múltiplos relativos, DCF de FCFF, P/VL justificado de bancos) y momentum 12-1.

## API público

### GET /v2/valuation/{symbol}
Cache-Control private, max-age=21600. Capacidades que anuncia: valuation.multiples y valuation.dcf.

Query, todos opcionales y validados (fuera de rango da 422 VALIDATION_ERROR):
- erp: fracción, 0 a 0.2. Default: prima de mercado maduro de Damodaran (0.0423).
- crp: fracción, 0 a 0.2. Default: prima país del país de la emisora (México 0.02465, EE. UU. 0.002334).
- terminalGrowth: fracción, -0.02 a 0.06. Default: min(rf de esa moneda, 0.06).
- years: entero 1 a 15. Default 5.
- growth: fracción, -0.5 a 1.0. Default: crecimiento esperado a 5 años que Damodaran publica para el sector.

Respuesta (ValuationResponse, congelada en schemas.py): symbol, currency, assumptions, multiples, dcf, bank, meta. OJO: no hay campo price.
- assumptions: rf, erp, crp, lambda, taxRate, terminalGrowth, source, asOf. Todo fracción.
- multiples: applicable, reason, market (US o EM), source, asOf, methods[], fairValueRange{low,mid,high}. Cada method: id (pe, pb, evEbitda, pfcf), label, current, benchmark, impliedPrice, applicable.
- dcf: applicable, reason, inputs{fcff0, growth, years, terminalGrowth, betaU, betaL, debtToEquity, taxRate, costOfEquity, costOfDebt, wacc, currency}, projection[], terminalValue, pvTerminal, tvShare, enterpriseValue, netDebt, minorityInterest, equityValue, sharesOutstanding, perShare, sensitivity{waccs, growths, grid}, warnings[].
- bank: null salvo bancos y aseguradoras; ahí trae applicable, justifiedPB, roe, costOfEquity, growth, impliedPrice.

Ejemplos reales del replay:
- AAPL: P/U 39.20 contra 34.58 del sector, DCF en USD con WACC 9.3913 %, g terminal 4.7766 %, perShare 237.28, tvShare 0.8416.
- GFNORTEO.MX: multiples y dcf en applicable false; bank con P/VL justificado 2.5749 = (0.236011 - 0.06)/(0.128356 - 0.06), impliedPrice 239.02.
- FUNO11.MX y SPY: los dos bloques en applicable false con su razón en español.
- CEMEXCPO.MX: currency MXN, dcf.inputs.currency USD, USDMXN=X 17.2275 en la nota.

### GET /v2/momentum/{symbol}
Cache-Control private, max-age de la clase history. Capacidad: momentum. Sin parámetros.
Respuesta: symbol, currency, benchmark, r12m1, r6m, r3m, benchmarkR12m1, relative12m1, meta. Todo fracción decimal.
Referencia SIEMPRE en la moneda del activo: NAFTRAC.MX para MXN, SPY para USD. La misma empresa en dos plazas se mide contra referencias distintas a propósito (AAPL contra SPY, AAPL.MX contra NAFTRAC.MX), porque comparar un precio en pesos contra un índice en dólares mezcla rendimiento con tipo de cambio.

Errores: 404 NOT_FOUND si no hay emisora o no hay precios mensuales; 400 INVALID_SYMBOL; 422 VALIDATION_ERROR; 503 UPSTREAM_UNAVAILABLE. Siempre {error:{code,message}} en español.

## Archivos que dejé

- kaizen_api/domain/valuation/dcf.py: matemáticas puras, sin red. levered_beta y unlevered_beta (Hamada), cost_of_equity (CAPM con lambda y CRP), wacc, wacc_in_currency, justified_pb, clamp_terminal_growth, two_stage_fcff, equity_bridge, sensitivity. Si otro stream necesita estas fórmulas, que importe de aquí en vez de reescribirlas.
- kaizen_api/domain/valuation/params.py: dataset(), sector_benchmark(sector, market) -> SectorBenchmark (con .label()), country_risk(country, currency, symbol) -> CountryRisk (con .label() en español), risk_free(currency) -> RiskFree, normalize_sector, market_for, classify(quote_type, sector, industry, symbol) -> Classification con is_fund, is_bank, is_insurer, is_reit y sus razones.
- kaizen_api/domain/valuation/inputs.py: load(symbol, statutory_tax) -> ValuationInputs, con fcff0().
- kaizen_api/domain/valuation/multiples.py: arriba el get_dcf del legado v1 SIN TOCAR (tiene guiones largos a propósito, los goldens lo prueban), abajo relative_multiples() para v2.
- kaizen_api/domain/valuation/service.py: get_valuation(), que arma la respuesta completa.
- kaizen_api/domain/screeners/momentum.py: arriba get_momentum del legado v1 sin tocar, abajo monthly_closes(), r12m1(), get_momentum_v2() y NoHistory.
- kaizen_api/routers/valuation.py: las dos rutas, ya sin @stub y con CAPABILITIES = ['valuation.multiples', 'valuation.dcf', 'momentum'].
- kaizen_api/data/damodaran_2026.json: vintage 2026-01, 94 industrias por mercado (US y EM), totales, mapa de 11 sectores a industrias, riesgo país de México y EE. UU., las 11 fuentes con URL, hoja y columna, y el bloque missing con el P/FCF que Damodaran no publica.
- tests/unit/b3b/ (124 pruebas) y tests/fixtures/recorded/2026-09-22-b3b/ (14 llamadas, 116 KB).

## Costuras

Las que CONSUMO (no toqué ningún archivo ajeno):
- domain/history.py::get_series de B2a, con puente a yft mientras lance NotImplementedError.
- domain/rates.py::rf_latest de B2b, buscada con getattr y usada como respaldo marcado.
- domain/fundamentals.py de B3a: todavía no hay firma v2, así que inputs.py resuelve solo.
- domain/universe.py::SECTOR_ETF de B3c: la usa el momentum del LEGADO, no el v2.
Las tres pendientes están pedidas con firma propuesta en docs/requests/B3b.md.

Las que OFREZCO y prometo estables: todo kaizen_api/domain/valuation/ y get_momentum_v2 / monthly_closes / r12m1 de momentum.py. B3c puede usar dcf.justified_pb y params.sector_benchmark para el screener de factores sin duplicar nada.

## Cómo correr y probar

    cd "/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN.wt/B3b"
    "/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv/bin/python" -m pytest -q -p no:cacheprovider -o addopts="" tests/unit/b3b/
    "/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv/bin/python" scripts/run_replay_backend.py --module kaizen_api.main --port 8112 --set 2026-09-22,2026-09-22-b3b

Todo corre sin red. La capa 2026-09-22-b3b trae los históricos mensuales de AAPL, AAPL.MX, WALMEX.MX, CEMEXCPO.MX, FUNO11.MX, GFNORTEO.MX, SPY, NAFTRAC.MX, ^MXX y ZZZNOTREAL (este último falla a propósito), más info, balance_sheet, cashflow e income_stmt de GFNORTEO.MX para el caso de banco. El set base va primero porque solo agrego llamadas, no corrijo ninguna suya.

## Decisiones que conviene conocer antes de mergear

1. Nunca se llama DCF a los múltiplos. El bloque se llama multiples y el texto dice "múltiplos relativos". El get_dcf del legado v1 sí son múltiplos pese al nombre, y se queda así por paridad.
2. Bancos, aseguradoras, FIBRAs, REITs, ETFs, fondos e índices salen con applicable false y una razón concreta en español, nunca con un número inventado. Los bancos reciben además el P/VL justificado.
3. Las dos guardas del valor terminal recortan y avisan, no revientan: g nunca pasa de la rf de esa moneda, y WACC menos g nunca baja de 2 pp. Comprobado en vivo: pedir terminalGrowth=0.06 en AAPL recorta a 4.7766 % con aviso, y con erp=0 y crp=0 se encadenan los dos avisos y queda en 2.00 pp exactos. En la tabla de sensibilidad los cruces que violan la guarda quedan en null para que la UI muestre s/d, en vez de recortar el supuesto a escondidas.
4. Nada de valores fijos silenciosos. La rf sale del bono a 10 años de la moneda menos el diferencial soberano, como pide el CAPM, y el tipo de cambio sale de USDMXN=X. No hay 17.5 ni 8.6 %.
5. El erpTotal de Estados Unidos del archivo (0.0446) NO es mercado maduro más prima país (0.044634). Es la prima implícita que Damodaran captura a mano. Guardamos el 0.0446 del archivo con la explicación en erpTotalNote y una prueba que lo fija. Ese campo no entra en ningún cálculo, pero si alguien lo usa que sepa por qué no cuadra.

## B3c

Las tres rutas de screeners quedan implementadas, probadas y verificadas contra el servidor de replay en el puerto 8113.

GET /v2/screeners/factors (universes mx, us, custom): puntaje z robusto relativo al sector, z = (x - mediana)/(1.4826*MAD), recortado a +-3. Respuesta conocida [10,12,14,16,18] -> z(18) = 1.3490 probada. Los multiplos se convierten a rendimiento antes de puntuar (earningsYield, fcfYield, ebitdaToEv, bookToPrice), asi que una utilidad negativa puntua bajo en vez de salir barata. Sectores con menos de 5 emisoras se comparan contra todo el universo y el renglon lo dice en reason; cobertura menor a 50 % excluye con motivo escrito; scores value, quality, momentum (12-1 sobre cierres de fin de mes), lowVol, growth y composite. Las checks son cumple/no cumple contra 6 umbrales publicados, sin lenguaje de compra o venta.

GET /v2/screeners/magic (us, mx): EY = EBIT/EV con EV = capitalizacion + deuda + minoritario + preferentes - efectivo; ROC = EBIT/(capital de trabajo neto sin efectivo ni deuda de corto plazo + PP&E neta). EBIT siempre reportado, nunca estimado (el legado usaba EBITDA*0.85 y eso se quedo solo en v1). Excluye bancos, aseguradoras y servicios publicos. Lugares de competencia 1-2-2-4 y desempate estable por rankEY y luego por simbolo. Respuesta conocida EY [.10,.08,.12] con ROC [.50,.30,.20] -> orden 1, 3, 2 probada. partial=true y excluded con motivo por renglon; currency por renglon.

GET /v2/screeners/fibras: ltv = deuda/activos totales (no deuda/(deuda+capitalizacion), que era el error del legado y ahora viaja aparte como debtToMarketCap); cashFlowYield con cashFlowBasis explicito ("ocf" o "fcf"), nunca llamado FFO; distributionYield, capRate y navPerCbfi solo cuando hay dato real; spreadVsCetes contra la costura de rf de B2b, que todavia no existe, asi que sale null con su nota escrita y nunca el 8.6 % fijo del legado; signal descuento/en_linea/prima/sin_datos con la regla documentada (0.90 y 1.10 sobre P/NAV) y clasificacion por tipo.

Verificado por ojo en el JSON servido: todas las tasas y rendimientos son fracciones, las monedas correctas (USD en el universo us, MXN en el mx, y las que reportan en otra moneda salen con su motivo en vez de dividir pesos entre dolares), meta honesta en las tres (asOf, source "yahoo,computed", delayMinutes 15, stale false, fallback false, generatedAt, notes) y sin guiones largos.

### Commits

- `7a15e06 feat: universos curados de México y Estados Unidos, lista de FIBRAs y lectura en lote de Yahoo`
- `f3a3dfb feat: screener por factores con puntajes z robustos relativos al sector`
- `cb618f7 feat: la fórmula mágica usa EBIT reportado, valor de empresa completo y empates estables`
- `df7e4a0 feat: FIBRAs con LTV contra activos, flujo con su base escrita y diferencial contra CETES`
- `32103d4 feat: las tres rutas de screeners dejan de responder 501 y se anuncian en /health`
- `dc6c261 perf: a los bancos y servicios públicos del universo curado ya no se les pide nada a Yahoo`
- `4828e6a test: la capa b3c graba las llamadas de los tres screeners y queda escrito lo que se le pide a otros streams`
- `dca58af test: la capa b3c cubre también el símbolo inválido en factores y en FIBRAs`

### Compuertas que reportó

- **"/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv/bin/python" -m pytest -q -p no:cacheprovider -o addopts=""**: 562 passed, 1 skipped in 5.44s (base de fase 2: 482 + 1 omitida; B3c suma 79 pruebas en tests/unit/b3c, 80 con la que ya estaba)
- **"/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv/bin/ruff" check .**: All checks passed!
- **node scripts/check-ownership.mjs B3c**: ✓ B3c (ws/B3c): 78 archivo(s), todos dentro de su propiedad.
- **"...venv/bin/python" -m pytest tests/unit/b3c -q -p no:cacheprovider -o addopts=""**: 79 passed in 0.74s. Respuestas conocidas verdes por nombre: test_respuesta_conocida_z_de_18_es_1_349, test_respuesta_conocida_el_orden_es_1_3_2, test_los_empates_reciben_el_mismo_lugar_y_el_siguiente_salta
- **python scripts/record_fixtures.py --set 2026-09-22,2026-09-22-b3c --get '/v2/screeners/factors?universe=us|mx' --get '/v2/screeners/magic?universe=us|mx' --get '/v2/screeners/fibras' (mas los casos de simbolo invalido)**: 50 llamadas en vivo grabadas en total, limite de tasa: 0. Resultado final: "todas las rutas se reproducen completas desde las capas". La capa 2026-09-22-b3c queda con 62 llamadas, 1.3 MB, sin ningun token del entorno.
- **python scripts/run_replay_backend.py --module kaizen_api.main --port 8113 --set 2026-09-22,2026-09-22-b3c ; curl /health**: HTTP 200. capabilities: ["auth", "screeners.factors", "screeners.magic", "screeners.fibras", "legacy.v1"]. Las tres capacidades de B3c aparecen. apiVersion 2. Servidor apagado al terminar, puerto 8113 libre.
- **curl '/v2/screeners/factors?universe=us'**: HTTP 200, 38 filas. universe {id us, name "Estados Unidos, empresas grandes", size 38}. meta.asOf 2026-09-21, notes avisa los 3 sectores con menos de 5 emisoras. Primera fila CVX composite 1.2242 con scores {value 1.8365, quality -0.2518, momentum 0.8578, lowVol 0.6783, growth 3.0 (recortado en el tope)}; metrics todas en fraccion (earningsYield 0.0510, debtToEquity 0.1896, volatility 0.2455); che
- **curl '/v2/screeners/factors?universe=mx'**: HTTP 200, 23 filas. GMEXICOB.MX, GRUMAB.MX, CEMEXCPO.MX y ORBIA.MX salen con reason "Reporta en USD y cotiza en MXN: las metricas de valor quedan en s/d hasta tener el tipo de cambio" y cobertura 0.58 a 0.67. Los sectores chicos (Comunicaciones, Consumo discrecional, Industriales, Materiales, Servicios financieros) aparecen en meta.notes y en el reason de cada renglon.
- **curl '/v2/screeners/magic?universe=us'**: HTTP 200, 36 filas y 2 excluidas, partial false. HON EY 0.0753 ROC 1.0137 rankEY 4 rankROC 8 suma 12, currency USD, fiscalPeriodEnd 2025-12-31. ADBE y ABBV excluidas con "El capital empleado no es positivo: la formula no aplica". meta.notes avisa que los cierres fiscales van de 2025-08-31 a 2026-06-30.
- **curl '/v2/screeners/magic?universe=mx'**: HTTP 200, 15 filas y 8 excluidas, partial false, currency MXN en todas. PINFRA.MX EY 0.2563 ROC 0.9465 suma 5 encabeza. Los 4 bancos (GFNORTEO, Q, BBAJIOO, GENTERA) salen por sector y las 4 que reportan en USD por moneda. El empate en suma 14 se resuelve por rankEY: LIVEPOLC-1 (2), ALSEA (5), AC (8), GAPB (13).
- **curl '/v2/screeners/fibras'**: HTTP 200, 10 filas. FUNO11.MX: ltv 0.359 (deuda/activos), debtToMarketCap 1.327 aparte, distributionYield 0.0871, capRate 0.0829, navPerCbfi 50.198, pNav 0.587, cashFlowYield 0.1690 con cashFlowBasis "ocf", spreadVsCetes null, signal "descuento". cetes28 null con la nota "Todavia no hay tasa de CETES 28 en este servidor, asi que el diferencial va en s/d". FIBRAPL14.MX marcada por reportar en otra 
- **curl los 6 caminos de error (universe invalido, symbols faltante, symbols de mas, simbolo invalido)**: 422 VALIDATION_ERROR con mensaje en espanol y details.fields en los 4 casos de parametros; 400 INVALID_SYMBOL en '/v2/screeners/fibras?extra=NO VALE!!'; 503 UPSTREAM_UNAVAILABLE en factors con solo ZZZNOTREAL. En el caso mixto AAPL,WALMEX.MX,ZZZNOTREAL responde 200 y el invalido sale con excluded true y reason "El proveedor no respondio por esta emisora". En FIBRAs el extra invalido sale con todo 

### Pendientes que dejó

- spreadVsCetes y cetes28 salen en null porque la costura de rf CETES 28 de B2b todavia no existe. fibras.cetes28() prueba por nombre get_cetes28, get_rf_current, get_rf_series y get_rf_v2 en kaizen_api.domain.rates y acepta numero, objeto con .rate/.as_of o dict con rate/value/yield/annual/last; en cuanto B2b publique cualquiera de esos nombres el diferencial se llena solo. Si el nombre real es otro, basta agregarlo a RF_FUNCTIONS en fibras.py, que es archivo de B3c. Pedido escrito en docs/requests/B3c.md punto 1.
- Sin costura de tipo de cambio por fecha, las emisoras que reportan en una moneda y cotizan en otra (GRUMAB.MX, GMEXICOB.MX, CEMEXCPO.MX, ORBIA.MX y FIBRAPL14.MX) quedan con las metricas de valor en null y su motivo escrito, en vez de dividir pesos entre dolares. Pedido en docs/requests/B3c.md punto 2, para cuando B2a deje firme domain/fx.py.
- El ROC de las concesionarias aeroportuarias sale enorme (GAPB.MX 10.34, ASURB.MX 5.18) porque su concesion vive en intangibles y no en PP&E, asi que el denominador de Greenblatt queda chico. El numero es correcto segun la formula, pero compara mal contra una empresa industrial. Vale la pena que la interfaz o la metodologia lo diga, o evaluar un piso de capital empleado. No se toco porque cambia el resultado del screener y es decision de producto.
- STORAGE18.MX (FIBRA Storage) no tiene estados financieros en Yahoo: se volvieron a pedir en vivo y Yahoo contesta vacio otra vez, asi que sus dos entradas en la capa 2026-09-22-b3c quedan marcadas soft_failure igual que en la base. Su ltv, capRate y cashFlowYield salen en s/d, que es el resultado honesto. Se dejaron las entradas grabadas para que nadie vuelva a gastar llamadas descubriendo lo mismo.
- Los tres archivos de data (universe_mx.json 23 emisoras, universe_us.json 38, fibras_mx.json 10) envejecen solos con fusiones, cambios de clave y deslistes; ya paso con TERRA13 y LFPE. Falta decidir quien los revisa y cada cuanto. Anotado en docs/requests/B3c.md punto 4.
- En magic.py sobreviven dos guiones largos, en los docstrings de la mitad legado del archivo que S1 movio sin cambios desde backend.py. No son texto visible y tocarlos es tocar codigo con paridad probada contra los goldens, asi que se dejaron. Se iran cuando se borre el legado.

### Notas de entrega

## B3c: screener de factores, formula magica y FIBRAs

Rama `ws/B3c`, 8 commits sobre `analizavende`. 15 archivos de codigo (2834 lineas nuevas) mas la capa de fixtures `tests/fixtures/recorded/2026-09-22-b3c` (62 llamadas, 1.3 MB).

### API publica (lo que el frontend consume)

**`GET /v2/screeners/factors`**
- Query: `universe` en `mx` (23 emisoras), `us` (38) o `custom`; `symbols` solo con `custom`, hasta 50 separados por coma. Mandar `symbols` con `us` o `mx` es 422.
- Respuesta: `{universe:{id,name,size}, method, rows[], meta}`.
- Cada `row`: `symbol`, `name`, `sector` (ya en espanol), `scores` (`value`, `quality`, `momentum`, `lowVol`, `growth`, `composite`, todos puntajes z o `null`), `coverage` (fraccion de 0 a 1 de las 12 metricas disponibles), `excluded` (bool), `reason` (string o `null`), `checks[]` (`{id,label,pass,value,threshold}` con `pass` en `null` cuando no hay dato) y `metrics{}` con las 12 crudas.
- Orden: comparables primero por `composite` de mayor a menor, las excluidas al final por simbolo.
- `method` trae el parrafo completo del metodo, listo para pintarlo bajo la tabla.

**`GET /v2/screeners/magic`**
- Query: `universe` en `us` (default) o `mx`. No hay `custom`.
- Respuesta: `{universe:{id,name,size,description}, rows[], excluded[], partial, meta}`.
- Cada `row`: `symbol`, `name`, `sector`, `ebit`, `enterpriseValue`, `earningsYield` (fraccion), `returnOnCapital` (fraccion), `rankEY`, `rankROC`, `rank` (la suma), `currency`, `fiscalPeriodEnd`.
- `excluded` es `[{symbol, reason}]`, con motivo escrito en espanol por emisora. `partial` es `true` cuando el proveedor dejo huecos.

**`GET /v2/screeners/fibras`**
- Query: `extra`, hasta 20 simbolos extra separados por coma. Si no traen punto se les agrega `.MX`.
- Respuesta: `{rows[], cetes28, meta}`. `cetes28` es fraccion o `null`.
- Cada `row`: `symbol`, `name`, `price`, `currency`, `financialCurrency`, `marketCap`, `distributionYield`, `capRate`, `navPerCbfi`, `pNav`, `ltv`, `debtToMarketCap`, `cashFlowYield`, `cashFlowBasis` (`"ocf"` o `"fcf"`), `spreadVsCetes`, `signal` (`descuento`/`en_linea`/`prima`/`sin_datos`), `type` (`propiedades`/`hipotecaria`/`energia`/`otro`).
- Orden: por `pNav` de menor a mayor, las que no tienen al final.

Las tres viven en la clase de cache `screeners` (12 h) y los dominios cachean aparte con `_cached(ttl=43200, fail_ttl=300)`. Todas las tasas, rendimientos y pesos son fracciones; nada viene en porcentaje. Los `null` son para que la interfaz pinte `s/d`.

### Costuras que implemente (las puede leer quien quiera)

`kaizen_api/domain/universe.py` es mio y lo dejo estable durante toda la fase 2:

- `SECTOR_ETF` (dict) no cambio de forma: **B3b lo lee tal cual** para la referencia por sector del 12-1.
- `get_universe(id)` y `custom_universe(symbols)` devuelven un `Universe` (`.id`, `.name`, `.symbols`, `.members`, `.size`, `.member(sym)`); `get_fibras_universe()` devuelve el de FIBRAs.
- `Member`: `symbol`, `name`, `sector` (canonico de Yahoo), `type` (solo FIBRAs).
- `fetch_symbols(symbols, statements=())` -> `(dict[str, SymbolData], pendientes)`. Lee en lote con 8 hilos y 40 s de tope. `SymbolData` trae `symbol`, `info`, `income`, `balance`, `cashflow`, `ok`, `currency`, `financial_currency` y `same_currency`.
- `fetch_closes(symbols, period, interval)` -> `{symbol: [(YYYY-MM-DD, cierre)]}` de una sola descarga en lote.
- `row_value(frame, labels, column=0)` y `column_date(frame, column=0)` para leer estados de Yahoo por etiqueta.
- `sector_label(sector)` traduce el sector canonico al espanol que ve la persona, y `SECTOR_ES` es la tabla.
- `MAGIC_EXCLUDED_SECTORS` es el frozenset de sectores que la formula magica deja fuera.

**Ojo B3b:** `EXCLUDED_SECTORS` (el del legado, que tambien excluye Real Estate) y `MAGIC_EXCLUDED_SECTORS` (el de v2, que no) conviven a proposito. El primero es paridad v1 y no se toca.

### Costuras que consumo de otros

- `domain/fundamentals.py::_div_yield_pct` (B3a) para el rendimiento por distribucion de cada FIBRA. Ya existe y lo uso tal cual.
- `domain/history.py::_fetch_hist` (B2a) como respaldo del precio del CBFI cuando `info` no lo trae.
- `domain/rates.py` (B2b) para el rf CETES 28: **todavia no existe**, asi que `fibras.cetes28()` busca por nombre entre `get_cetes28`, `get_rf_current`, `get_rf_series` y `get_rf_v2`, y si no encuentra ninguno deja `spreadVsCetes` y `cetes28` en `null` con la nota escrita en `meta.notes`. Cuando B2b aterrice, el diferencial se llena solo sin que nadie toque nada; si el nombre es otro, se agrega a `RF_FUNCTIONS` en `fibras.py`.

### Como correr y probar

```bash
cd "/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN.wt/B3c"
"/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv/bin/python" -m pytest tests/unit/b3c -q -p no:cacheprovider -o addopts=""
"/Users/luisalfredolizarragasanchez/Desktop/CLAUDE/05 NEWKAIZEN/.venv/bin/python" scripts/run_replay_backend.py --module kaizen_api.main --port 8113 --set 2026-09-22,2026-09-22-b3c
```

Las 79 pruebas de `tests/unit/b3c/` corren sin red y sin fixtures: `tests/unit/b3c/fakes.py` arma universos y `SymbolData` falsos, asi que las respuestas conocidas se prueban con numeros a mano y no dependen de Yahoo ni de que B2b o B3a hayan aterrizado. `test_routes.py` prueba las tres rutas con `TestClient` y el dominio parchado.

Las tres rutas se reproducen completas desde `2026-09-22,2026-09-22-b3c`, que es el orden que manda el guion: la base primero y mi capa encima solo agregando. Si alguien necesita el orden invertido (capa primero, para reemplazar llamadas que la base grabo vacias), tambien funciona, pero en mi caso no cambia nada: las dos entradas de STORAGE18.MX que reemplace salieron vacias igual en vivo.

### Limitaciones conocidas

1. `spreadVsCetes` y `cetes28` en `null` hasta que exista la costura de B2b. La interfaz tiene que pintar `s/d` y mostrar la nota de `meta.notes`, no inventar una tasa.
2. Las emisoras que reportan en otra moneda que la de cotizacion quedan sin metricas de valor (factores) o fuera de la tabla (magica), con el motivo escrito. Son 4 en el universo mx y 1 FIBRA. Se resuelve cuando B2a deje firme `domain/fx.py`.
3. El ROC de concesionarias aeroportuarias (GAPB, ASUR, OMA) sale inflado porque su concesion es intangible y no entra al capital empleado de Greenblatt. El numero es fiel a la formula, pero no compara bien contra una industrial.
4. El universo mx tiene 23 emisoras y el us 38, curados a mano. Son chicos a proposito: cada emisora cuesta de una a tres llamadas a Yahoo y la formula magica ya salta los bancos y servicios publicos del universo curado sin preguntarles nada. Crecerlos es barato en codigo y caro en llamadas.
5. `/v2/screeners/factors` con `universe=custom` y puros simbolos invalidos responde 503 `UPSTREAM_UNAVAILABLE`. Es defendible pero discutible: no es que el proveedor este caido, es que esos simbolos no existen. Si a alguien le estorba en la interfaz, vale la pena volverlo un 200 con todas las filas excluidas o un 404, y es un cambio de tres lineas en `routers/screeners.py`.
6. `magic` no acepta universo `custom`, solo `us` y `mx`, porque `MagicResponse` pide un `universe.id`. Si una feature lo necesita, hay que pedirlo.
