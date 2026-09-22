// Simulación Monte Carlo de un plan de ahorro o inversión.
//
// Qué arregla respecto del código viejo: el legado componía rendimientos simples i.i.d. normales,
// lo que permite saldos negativos y sesga la media. Aquí se simula el rendimiento en logaritmos
// (lognormal), que es la forma estándar y no deja que el saldo cruce el cero por la vía del
// rendimiento.
//
// Convenciones de unidades (las mismas del API v2):
// - `mu` es el rendimiento ARITMÉTICO anual esperado, en fracción (0.08 = 8 %).
// - `sigma` es la desviación estándar anual de ese rendimiento, en fracción.
// - `inflation` y `contributionGrowth` son tasas anuales en fracción.
// - Los montos van en la moneda que quien llama decida, y todos en la misma. Aquí no hay FX.
//
// Nada de Date.now() ni de fetch: la función es pura y determinista dada la semilla.

import { createRng } from '../rng.js'

/** Cuantiles que se reportan por paso. */
const QUANTILES = /** @type {const} */ ([0.05, 0.25, 0.5, 0.75, 0.95])
const QUANTILE_KEYS = /** @type {const} */ (['p5', 'p25', 'p50', 'p75', 'p95'])

/**
 * @typedef {{ p5: number[], p25: number[], p50: number[], p75: number[], p95: number[] }} PercentileBands
 */

/**
 * @typedef {{
 *   mean: number,
 *   sd: number | null,
 *   min: number,
 *   max: number,
 *   p5: number,
 *   p25: number,
 *   p50: number,
 *   p75: number,
 *   p95: number,
 * }} TerminalSummary
 */

/**
 * @typedef {{
 *   steps: number,
 *   stepsPerYear: number,
 *   years: number,
 *   paths: number,
 *   seed: string,
 *   method: 'lognormal' | 'bootstrap',
 *   perStep: { mu: number, sigma: number } | null,
 *   annual: { mu: number, sigma: number } | null,
 *   deflators: number[],
 *   contributed: number[],
 *   contributedTotal: number,
 *   contributedReal: number[],
 *   contributedTotalReal: number,
 *   percentiles: PercentileBands,
 *   percentilesReal: PercentileBands,
 *   terminal: TerminalSummary,
 *   terminalReal: TerminalSummary,
 *   terminalSorted: Float64Array,
 *   samples: number[][],
 *   probabilityAbove: (target: number, options?: { real?: boolean }) => number | null,
 * }} SimulationResult
 */

/**
 * Valida que algo sea un número finito y lo devuelve.
 * @param {unknown} value
 * @param {string} name
 * @returns {number}
 */
function finite(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`montecarlo: ${name} tiene que ser un número finito`)
  }
  return value
}

/**
 * Parámetros de la lognormal a partir de la media y la desviación aritméticas anuales.
 *
 * Si R = e^ℓ con ℓ ~ N(μ_l, σ_l²), entonces E[R] = 1 + m y Var[R] = s² dan
 * σ_l² = ln(1 + s²/(1+m)²) y μ_l = ln(1+m) − σ_l²/2.
 *
 * @param {number} m media aritmética anual del rendimiento, en fracción (0.08 = 8 %)
 * @param {number} s desviación estándar anual, en fracción; 0 es válido
 * @returns {{ mu: number, sigma: number } | null} `null` si m ≤ −1 (una pérdida total o peor no
 *   tiene logaritmo). Lanza si m o s no son finitos, o si s es negativa.
 */
export function lognormalParams(m, s) {
  finite(m, 'mu')
  finite(s, 'sigma')
  if (s < 0) throw new Error('montecarlo: sigma no puede ser negativa')
  if (m <= -1) return null
  const gross = 1 + m
  const variance = Math.log(1 + (s * s) / (gross * gross))
  return { mu: Math.log(gross) - variance / 2, sigma: Math.sqrt(variance) }
}

/**
 * Los mismos parámetros, ya escalados al paso de la simulación. El escalamiento de una caminata
 * aleatoria es μ/k para la deriva y σ/√k para la volatilidad.
 *
 * @param {number} m media aritmética anual, en fracción
 * @param {number} s desviación estándar anual, en fracción
 * @param {number} stepsPerYear pasos por año (12 = mensual); entero ≥ 1
 * @returns {{ mu: number, sigma: number, annual: { mu: number, sigma: number } } | null}
 *   `null` si `lognormalParams` devuelve `null`.
 */
export function perStepParams(m, s, stepsPerYear) {
  const k = finite(stepsPerYear, 'stepsPerYear')
  if (!Number.isInteger(k) || k < 1) {
    throw new Error('montecarlo: stepsPerYear tiene que ser un entero mayor o igual a 1')
  }
  const annual = lognormalParams(m, s)
  if (annual === null) return null
  return { mu: annual.mu / k, sigma: annual.sigma / Math.sqrt(k), annual }
}

// ---------------------------------------------------------------------------
// Selección de estadísticos de orden
//
// Sacar 5 percentiles por paso ordenando 10,000 saldos 360 veces cuesta demasiado. En vez de
// ordenar se usa selección múltiple (quickselect repartido), que deja cada índice pedido en su
// lugar con trabajo lineal en vez de n·log n.
// ---------------------------------------------------------------------------

/**
 * @param {Float64Array} a
 * @param {number} i
 * @param {number} j
 */
function swap(a, i, j) {
  const t = a[i]
  a[i] = a[j]
  a[j] = t
}

/**
 * Ordena un tramo corto por inserción.
 * @param {Float64Array} a
 * @param {number} left
 * @param {number} right
 */
function insertionSort(a, left, right) {
  for (let i = left + 1; i <= right; i += 1) {
    const value = a[i]
    let j = i - 1
    while (j >= left && a[j] > value) {
      a[j + 1] = a[j]
      j -= 1
    }
    a[j + 1] = value
  }
}

/**
 * Deja en `a[k]` el k-ésimo menor del tramo [left, right] (partición de Hoare con mediana de tres).
 * @param {Float64Array} a
 * @param {number} left
 * @param {number} right
 * @param {number} k
 */
function quickselect(a, left, right, k) {
  let lo = left
  let hi = right
  while (lo < hi) {
    if (hi - lo < 16) {
      insertionSort(a, lo, hi)
      return
    }
    const mid = (lo + hi) >> 1
    // Mediana de tres para que una entrada ya ordenada no degenere a O(n²).
    if (a[mid] < a[lo]) swap(a, mid, lo)
    if (a[hi] < a[lo]) swap(a, hi, lo)
    if (a[hi] < a[mid]) swap(a, hi, mid)
    const pivot = a[mid]
    let i = lo
    let j = hi
    while (i <= j) {
      while (a[i] < pivot) i += 1
      while (a[j] > pivot) j -= 1
      if (i <= j) {
        swap(a, i, j)
        i += 1
        j -= 1
      }
    }
    if (k <= j) hi = j
    else if (k >= i) lo = i
    else return
  }
}

/**
 * Coloca en su lugar varios estadísticos de orden a la vez.
 * @param {Float64Array} a
 * @param {Int32Array} indices índices pedidos, ascendentes y sin repetir
 * @param {number} left
 * @param {number} right
 * @param {number} i0
 * @param {number} i1
 */
function multiselect(a, indices, left, right, i0, i1) {
  if (i1 < i0 || left >= right) return
  const mid = (i0 + i1) >> 1
  const k = indices[mid]
  quickselect(a, left, right, k)
  multiselect(a, indices, left, k - 1, i0, mid - 1)
  multiselect(a, indices, k + 1, right, mid + 1, i1)
}

/**
 * Plan de cuantiles tipo 7 (el de numpy y Excel) para un tamaño de muestra fijo.
 * @param {number} n
 * @returns {{ lo: Int32Array, hi: Int32Array, frac: Float64Array, needed: Int32Array }}
 */
function quantilePlan(n) {
  const lo = new Int32Array(QUANTILES.length)
  const hi = new Int32Array(QUANTILES.length)
  const frac = new Float64Array(QUANTILES.length)
  /** @type {Set<number>} */
  const set = new Set()
  for (let q = 0; q < QUANTILES.length; q += 1) {
    const h = (n - 1) * QUANTILES[q]
    const floor = Math.floor(h)
    lo[q] = floor
    hi[q] = Math.min(floor + 1, n - 1)
    frac[q] = h - floor
    set.add(lo[q])
    set.add(hi[q])
  }
  const needed = Int32Array.from([...set].sort((a, b) => a - b))
  return { lo, hi, frac, needed }
}

/**
 * Cuantiles tipo 7 de un arreglo YA ordenado de forma ascendente.
 * @param {Float64Array} sorted
 * @param {number} q entre 0 y 1
 * @returns {number}
 */
function quantileSorted(sorted, q) {
  const n = sorted.length
  const h = (n - 1) * q
  const floor = Math.floor(h)
  const next = Math.min(floor + 1, n - 1)
  return sorted[floor] + (h - floor) * (sorted[next] - sorted[floor])
}

/**
 * Resumen de una muestra ya ordenada.
 * @param {Float64Array} sorted
 * @param {number} scale divisor (1 para nominal, el deflactor final para real)
 * @returns {TerminalSummary}
 */
function summarize(sorted, scale) {
  const n = sorted.length
  let sum = 0
  for (let i = 0; i < n; i += 1) sum += sorted[i]
  const mean = sum / n / scale
  let sd = null
  if (n > 1) {
    let acc = 0
    const rawMean = sum / n
    for (let i = 0; i < n; i += 1) {
      const d = sorted[i] - rawMean
      acc += d * d
    }
    sd = Math.sqrt(acc / (n - 1)) / scale
  }
  return {
    mean,
    sd,
    min: sorted[0] / scale,
    max: sorted[n - 1] / scale,
    p5: quantileSorted(sorted, 0.05) / scale,
    p25: quantileSorted(sorted, 0.25) / scale,
    p50: quantileSorted(sorted, 0.5) / scale,
    p75: quantileSorted(sorted, 0.75) / scale,
    p95: quantileSorted(sorted, 0.95) / scale,
  }
}

/**
 * Índice del primer elemento ≥ target en un arreglo ascendente.
 * @param {Float64Array} sorted
 * @param {number} target
 * @returns {number}
 */
function lowerBound(sorted, target) {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid] < target) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Prepara el resultado de `simulate()` para cruzar la frontera de un Web Worker.
 *
 * `probabilityAbove` es una función y las funciones no sobreviven al clonado estructurado, así
 * que se quita aquí y se vuelve a poner con `fromMessage()` del otro lado. El `Float64Array` de
 * los saldos finales se puede transferir en vez de copiarse: por eso también se devuelve la lista
 * de búferes para el segundo argumento de `postMessage`.
 *
 * Ojo: transferir DESPRENDE el búfer del lado que envía, así que después de `postMessage(payload,
 * transfer)` el objeto `sim` original ya no sirve en ese hilo. No hay que confiarse del aviso: a
 * partir de ese momento `sim.probabilityAbove()` devuelve `null` (antes devolvía 1, o sea un
 * "100 % de llegar a la meta" falso), y lo mismo pasa si se rehidrata con `fromMessage` un payload
 * cuyo búfer ya se fue.
 *
 * @param {SimulationResult | null} sim
 * @returns {{ payload: any, transfer: ArrayBuffer[] }}
 */
export function toMessage(sim) {
  if (sim === null || sim === undefined) return { payload: null, transfer: [] }
  const { probabilityAbove: _omitido, ...rest } = sim
  return { payload: rest, transfer: [/** @type {ArrayBuffer} */ (rest.terminalSorted.buffer)] }
}

/**
 * Reconstruye el resultado que viajó por `postMessage`, con `probabilityAbove` otra vez puesta.
 *
 * @param {any} payload lo que `toMessage()` mandó
 * @returns {SimulationResult | null}
 */
export function fromMessage(payload) {
  if (payload === null || payload === undefined) return null
  const terminalSorted = payload.terminalSorted instanceof Float64Array
    ? payload.terminalSorted
    : Float64Array.from(payload.terminalSorted ?? [])
  const nPaths = terminalSorted.length
  // Cuántas trayectorias DEBERÍA haber, según el propio payload. Si alguien rehidrata un payload
  // cuyo búfer ya se transfirió, `nPaths` es 0 y `paths` sigue diciendo la verdad: la cuenta daría
  // 0/0 = NaN, que en pantalla es peor que un `s/d` honesto.
  const esperadas = Number.isFinite(payload.paths) ? payload.paths : nPaths
  const finalDeflator = payload.deflators[payload.deflators.length - 1]
  /**
   * @param {number} target
   * @param {{ real?: boolean }} [opts]
   * @returns {number | null} `null` si `target` no es finito, o si los saldos finales no llegaron
   *   completos (búfer ya transferido)
   */
  function probabilityAbove(target, opts = {}) {
    if (typeof target !== 'number' || !Number.isFinite(target)) return null
    if (nPaths === 0 || nPaths !== esperadas) return null
    const nominalTarget = opts.real ? target * finalDeflator : target
    return (nPaths - lowerBound(terminalSorted, nominalTarget)) / nPaths
  }
  return { ...payload, terminalSorted, probabilityAbove }
}

/**
 * Corre una petición del worker. Vive aquí, y no en `montecarlo.worker.js`, para que se pueda
 * probar sin levantar un worker de verdad: el archivo del worker es solo el cascarón que escucha
 * mensajes y llama a esta función.
 *
 * @param {any} data lo que llegó en `event.data`: `{ id, options }`
 * @returns {{ message: any, transfer: ArrayBuffer[] }}
 */
export function handleWorkerRequest(data) {
  const id = data && typeof data === 'object' ? data.id : undefined
  try {
    const sim = simulate(data?.options)
    const { payload, transfer } = toMessage(sim)
    return { message: { id, ok: true, result: payload }, transfer }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'montecarlo: falló la simulación'
    return { message: { id, ok: false, error: message }, transfer: [] }
  }
}

/**
 * Los cinco percentiles que dibuja el abanico (5, 25, 50, 75 y 95), de una muestra cualquiera.
 * Usa cuantiles tipo 7, el mismo de numpy y de Excel, e interpolación lineal entre estadísticos
 * de orden. No modifica el arreglo que recibe.
 *
 * Mínimo: 1 valor. Con un solo valor los cinco percentiles son ese valor.
 *
 * Nota para el orquestador: A1 tiene `quantile(sorted, q)` en stats.js. Esta versión existe
 * porque el motor de la simulación necesita los cinco a la vez sin ordenar, y se expone porque
 * las gráficas de F4 la piden con la misma forma. Se puede unificar en el merge.
 *
 * @param {number[] | Float64Array} values
 * @returns {{ p5: number, p25: number, p50: number, p75: number, p95: number } | null}
 *   `null` si no hay valores. Lanza si alguno no es finito.
 */
export function quantilesOf(values) {
  const source = values == null ? [] : values
  const n = source.length
  if (n === 0) return null
  const copy = new Float64Array(n)
  for (let i = 0; i < n; i += 1) copy[i] = finite(source[i], `values[${i}]`)
  const plan = quantilePlan(n)
  multiselect(copy, plan.needed, 0, n - 1, 0, plan.needed.length - 1)
  /** @type {any} */
  const out = {}
  for (let q = 0; q < QUANTILES.length; q += 1) {
    const a = copy[plan.lo[q]]
    const b = copy[plan.hi[q]]
    out[QUANTILE_KEYS[q]] = a + plan.frac[q] * (b - a)
  }
  return out
}

/**
 * @typedef {{
 *   initial?: number,
 *   contribution?: number,
 *   contributionFrequency?: 'monthly' | 'annual',
 *   contributionGrowth?: number | null,
 *   years: number,
 *   stepsPerYear?: number,
 *   mu?: number,
 *   sigma?: number,
 *   inflation?: number,
 *   paths?: number,
 *   seed?: string | number,
 *   method?: 'lognormal' | 'bootstrap',
 *   history?: number[] | Float64Array | null,
 *   blockSize?: number,
 *   samplePaths?: number,
 * }} SimulateOptions
 */

/**
 * Simula la trayectoria de un saldo con aportaciones al INICIO de cada periodo:
 * `W_{t+1} = (W_t + C_t) · e^{ℓ_t}`. El saldo nunca baja de cero.
 *
 * Método `lognormal`: ℓ_t ~ N(μ_l/k, (σ_l/√k)²) con μ_l y σ_l de `lognormalParams(mu, sigma)`.
 * Método `bootstrap`: remuestreo por bloques circulares de `history` (rendimientos simples de la
 * misma periodicidad que `stepsPerYear`); cada `blockSize` pasos se sortea un nuevo arranque.
 *
 * Las aportaciones crecen con `contributionGrowth` (anual) repartido por paso:
 * `C_t = contribution · (1 + contributionGrowth)^{t/stepsPerYear}`. Si `contributionGrowth` es
 * `null` se usa `inflation`, que es lo que mantiene el poder de compra de la aportación.
 * Con `contributionFrequency: 'annual'` solo se aporta cada `stepsPerYear` pasos, y para que eso
 * tenga sentido `stepsPerYear` tiene que ser múltiplo de 12 cuando la frecuencia es mensual. Con
 * `contribution: 0` ese requisito no aplica, porque no hay nada que calendarizar.
 *
 * `contribution` no puede ser negativa: retirar no es aportar al revés. El escenario de retiro es
 * `retirementIncome` de goals.js.
 *
 * El campo `seed` del resultado es la etiqueta del generador, que es la que reproduce la corrida
 * si se vuelve a pasar como `seed`. No siempre es igual a lo que se recibió: `null` y `undefined`
 * salen como la semilla por omisión.
 *
 * Los valores reales se obtienen dividiendo entre `(1 + inflation)^{t/stepsPerYear}`. Como es un
 * divisor positivo, los percentiles reales son los nominales deflactados, sin volver a ordenar.
 * Lo aportado NO se deflacta así: `contributedReal` se acumula deflactando cada aportación con el
 * deflactor de SU fecha, y por eso viene calculado y no se deja que quien llama lo derive.
 *
 * Mínimos: `paths ≥ 1`, `steps = round(years · stepsPerYear) ≥ 1`. Con `bootstrap`, `history`
 * necesita al menos `max(2, blockSize)` rendimientos finitos.
 *
 * Todas las validaciones corren ANTES del corte por horizonte, para que un `years` que redondea a
 * cero pasos no se trague un parámetro roto.
 *
 * @param {SimulateOptions} options
 * @returns {SimulationResult | null} `null` cuando no alcanzan los datos: `round(years ·
 *   stepsPerYear) < 1` con `years ≥ 0`, `mu ≤ −1`, o `bootstrap` con menos historia que
 *   `blockSize`. Lanza (Error con mensaje en español) si algún parámetro no es finito o está fuera
 *   de rango; `mu` y `sigma` se validan con los DOS métodos, aunque `bootstrap` no los use, y
 *   `years` negativo lanza en vez de devolver `null`.
 */
export function simulate(options) {
  if (!options || typeof options !== 'object') {
    throw new Error('montecarlo: simulate necesita un objeto de opciones')
  }
  const {
    initial = 0,
    contribution = 0,
    contributionFrequency = 'monthly',
    contributionGrowth = null,
    years,
    stepsPerYear = 12,
    mu = 0,
    sigma = 0,
    inflation = 0,
    paths = 10000,
    seed = 'kaizen',
    method = 'lognormal',
    history = null,
    blockSize = 6,
    samplePaths = 0,
  } = options

  finite(initial, 'initial')
  finite(contribution, 'contribution')
  finite(years, 'years')
  finite(inflation, 'inflation')
  // mu y sigma se validan aquí y no dentro de la rama lognormal: con `method: 'bootstrap'` no se
  // usan, pero un valor roto tiene que truenar igual. Quien llama arma UN objeto de opciones y le
  // cambia el método, así que un mu en NaN se colaría callado y reaparecería al volver a lognormal.
  finite(mu, 'mu')
  finite(sigma, 'sigma')
  const k = finite(stepsPerYear, 'stepsPerYear')
  if (!Number.isInteger(k) || k < 1) {
    throw new Error('montecarlo: stepsPerYear tiene que ser un entero mayor o igual a 1')
  }
  const nPaths = finite(paths, 'paths')
  if (!Number.isInteger(nPaths) || nPaths < 1) {
    throw new Error('montecarlo: paths tiene que ser un entero mayor o igual a 1')
  }
  if (initial < 0) throw new Error('montecarlo: initial no puede ser negativo')
  // Un horizonte negativo es un dato inválido, no "faltan datos": devolver null lo disfrazaba de
  // s/d en pantalla. El null se reserva para el caso legítimo de years ≥ 0 que redondea a cero
  // pasos (por ejemplo 0.04 años con pasos mensuales).
  if (years < 0) throw new Error('montecarlo: years no puede ser negativo')
  // Retirar no es aportar en negativo: el piso de cero del saldo se tragaría el faltante sin avisar
  // que el plan es imposible, y `contributedTotal` saldría negativo. Para retiros está
  // `retirementIncome` de goals.js.
  if (contribution < 0) throw new Error('montecarlo: contribution no puede ser negativa')
  if (sigma < 0) throw new Error('montecarlo: sigma no puede ser negativa')
  if (inflation <= -1) throw new Error('montecarlo: inflation tiene que ser mayor que −1')
  if (method !== 'lognormal' && method !== 'bootstrap') {
    throw new Error('montecarlo: method tiene que ser "lognormal" o "bootstrap"')
  }
  if (contributionFrequency !== 'monthly' && contributionFrequency !== 'annual') {
    throw new Error('montecarlo: contributionFrequency tiene que ser "monthly" o "annual"')
  }
  const perYear = contributionFrequency === 'monthly' ? 12 : 1
  // Sin aportación la periodicidad no significa nada, así que no se exige el múltiplo: pedir pasos
  // anuales, trimestrales o semanales para dibujar un saldo sin aportaciones es legítimo y no tiene
  // por qué chocar con el valor por omisión de `contributionFrequency`.
  if (contribution !== 0 && k % perYear !== 0) {
    throw new Error(
      `montecarlo: con aportación ${contributionFrequency === 'monthly' ? 'mensual' : 'anual'}, ` +
        `stepsPerYear (${k}) tiene que ser múltiplo de ${perYear}`,
    )
  }
  // Con aportación el cociente es exacto; con aportación cero se redondea y nunca baja de 1, y da
  // igual porque el monto aportado es cero en todos los pasos.
  const every = Math.max(1, Math.round(k / perYear))

  const growthAnnual = contributionGrowth == null ? inflation : finite(contributionGrowth, 'contributionGrowth')
  if (growthAnnual <= -1) throw new Error('montecarlo: contributionGrowth tiene que ser mayor que −1')
  const growthStep = growthAnnual === 0 ? 1 : Math.pow(1 + growthAnnual, 1 / k)

  const nSamples = Math.max(0, Math.min(Math.trunc(finite(samplePaths, 'samplePaths')), nPaths))

  // --- preparación del motor de rendimientos -------------------------------
  // TODO lo que valida va ANTES del corte por horizonte. Si se deja después, un horizonte que
  // redondea a cero pasos devuelve null y se traga parámetros rotos (un contributionGrowth en NaN,
  // una history inválida), así que el mismo objeto de opciones truena o no según el horizonte.
  /** @type {{ mu: number, sigma: number } | null} */
  let perStep = null
  /** @type {{ mu: number, sigma: number } | null} */
  let annual = null
  /** @type {Float64Array | null} */
  let historyReturns = null
  let block = 1

  if (method === 'lognormal') {
    const params = perStepParams(mu, sigma, k)
    if (params === null) return null
    perStep = { mu: params.mu, sigma: params.sigma }
    annual = params.annual
  } else {
    const raw = history == null ? [] : Array.from(history)
    // La validación va antes que la cuenta: una historia inválida truena aunque además sea corta.
    for (const value of raw) {
      finite(value, 'history')
      if (value <= -1) {
        throw new Error('montecarlo: history no puede traer rendimientos de −100 % o peores')
      }
    }
    block = Math.trunc(finite(blockSize, 'blockSize'))
    if (block < 1) throw new Error('montecarlo: blockSize tiene que ser un entero mayor o igual a 1')
    if (raw.length < Math.max(2, block)) return null
    historyReturns = Float64Array.from(raw)
  }

  // Corte por horizonte, ya con todo validado: aquí null sí quiere decir "no hay nada que simular".
  const steps = Math.round(years * k)
  if (!Number.isFinite(steps) || steps < 1) return null

  // --- salidas --------------------------------------------------------------
  const rng = createRng(seed)
  const wealth = new Float64Array(nPaths).fill(initial)
  const scratch = new Float64Array(nPaths)
  const plan = quantilePlan(nPaths)

  /** @type {number[][]} */
  const bands = QUANTILE_KEYS.map(() => new Array(steps + 1))
  const deflators = new Array(steps + 1)
  const contributed = new Array(steps + 1)
  // Lo aportado en pesos de hoy. NO es `contributed[t] / deflators[t]`: cada aportación se hizo en
  // una fecha distinta y le toca su propio deflactor, así que hay que deflactar al momento de
  // aportar y luego acumular. A 30 años con 4 % de inflación la diferencia entre las dos cuentas
  // es de varios por ciento, y la forma equivocada es la que parece obvia desde afuera.
  const contributedReal = new Array(steps + 1)
  /** @type {number[][]} */
  const samples = []
  for (let i = 0; i < nSamples; i += 1) samples.push(new Array(steps + 1))

  const inflationStep = inflation === 0 ? 1 : Math.pow(1 + inflation, 1 / k)

  /** @param {number} t */
  function record(t) {
    scratch.set(wealth)
    multiselect(scratch, plan.needed, 0, nPaths - 1, 0, plan.needed.length - 1)
    for (let q = 0; q < QUANTILES.length; q += 1) {
      const a = scratch[plan.lo[q]]
      const b = scratch[plan.hi[q]]
      bands[q][t] = a + plan.frac[q] * (b - a)
    }
    for (let i = 0; i < nSamples; i += 1) samples[i][t] = wealth[i]
  }

  deflators[0] = 1
  contributed[0] = initial
  // El saldo inicial ya está en pesos de hoy: su deflactor es 1.
  contributedReal[0] = initial
  record(0)

  let currentContribution = contribution
  let deflator = 1
  let totalContributed = initial
  let totalContributedReal = initial

  /** @type {Int32Array | null} */
  const blockStart = historyReturns === null ? null : new Int32Array(nPaths)

  for (let t = 0; t < steps; t += 1) {
    const cash = t % every === 0 ? currentContribution : 0
    if (cash !== 0) {
      totalContributed += cash
      // `deflator` todavía vale deflators[t], que es el del momento en que entra este dinero.
      totalContributedReal += cash / deflator
    }

    if (historyReturns === null && perStep !== null) {
      const drift = perStep.mu
      const vol = perStep.sigma
      if (vol === 0) {
        // Sin volatilidad no hace falta tocar el generador: el factor es el mismo para todos.
        const factor = Math.exp(drift)
        for (let i = 0; i < nPaths; i += 1) {
          const next = (wealth[i] + cash) * factor
          wealth[i] = next > 0 ? next : 0
        }
      } else {
        for (let i = 0; i < nPaths; i += 1) {
          const next = (wealth[i] + cash) * Math.exp(drift + vol * rng.normal())
          wealth[i] = next > 0 ? next : 0
        }
      }
    } else if (historyReturns !== null && blockStart !== null) {
      const n = historyReturns.length
      const offset = t % block
      if (offset === 0) {
        for (let i = 0; i < nPaths; i += 1) blockStart[i] = rng.int(n)
      }
      for (let i = 0; i < nPaths; i += 1) {
        const idx = (blockStart[i] + offset) % n
        const next = (wealth[i] + cash) * (1 + historyReturns[idx])
        wealth[i] = next > 0 ? next : 0
      }
    }

    deflator *= inflationStep
    deflators[t + 1] = deflator
    contributed[t + 1] = totalContributed
    contributedReal[t + 1] = totalContributedReal
    record(t + 1)
    currentContribution *= growthStep
  }

  /** @type {PercentileBands} */
  const percentiles = /** @type {any} */ ({})
  /** @type {PercentileBands} */
  const percentilesReal = /** @type {any} */ ({})
  for (let q = 0; q < QUANTILE_KEYS.length; q += 1) {
    percentiles[QUANTILE_KEYS[q]] = bands[q]
    percentilesReal[QUANTILE_KEYS[q]] = bands[q].map((v, t) => v / deflators[t])
  }

  const terminalSorted = Float64Array.from(wealth)
  terminalSorted.sort()
  const finalDeflator = deflators[steps]
  const terminal = summarize(terminalSorted, 1)
  const terminalReal = summarize(terminalSorted, finalDeflator)

  /**
   * Proporción de trayectorias que terminan en `target` o más.
   * @param {number} target
   * @param {{ real?: boolean }} [opts] `real: true` compara contra pesos de hoy
   * @returns {number | null} `null` si `target` no es finito, o si los saldos finales ya no están
   *   (búfer transferido a un worker)
   */
  function probabilityAbove(target, opts = {}) {
    if (typeof target !== 'number' || !Number.isFinite(target)) return null
    // Si el búfer se transfirió con postMessage, este lado se queda con un Float64Array de largo
    // cero. Sin esta guarda lowerBound devuelve 0 y la cuenta sale 1, o sea "100 % de llegar a la
    // meta", que es una mentira callada y justo lo que se pintaría en pantalla. Mejor `s/d`.
    if (terminalSorted.length !== nPaths) return null
    const nominalTarget = opts.real ? target * finalDeflator : target
    const idx = lowerBound(terminalSorted, nominalTarget)
    return (nPaths - idx) / nPaths
  }

  return {
    steps,
    stepsPerYear: k,
    years,
    paths: nPaths,
    // La etiqueta del generador, no `String(seed)`: con `seed: null` (un campo de formulario vacío
    // llega así) createRng cae en DEFAULT_SEED, y reportar la cadena 'null' daba un campo que NO
    // reproducía la corrida al volver a pasarlo.
    seed: rng.seed,
    method,
    perStep,
    annual,
    deflators,
    contributed,
    contributedTotal: totalContributed,
    contributedReal,
    contributedTotalReal: totalContributedReal,
    percentiles,
    percentilesReal,
    terminal,
    terminalReal,
    terminalSorted,
    samples,
    probabilityAbove,
  }
}
