// Validación walk-forward: estimar con el pasado y medir con lo que vino después.
//
// Es la única forma honesta de enseñar qué hubiera hecho un optimizador. Si estimas la covarianza
// con TODA la serie y luego "mides" el resultado sobre esa misma serie, el número que sale ya vio
// el futuro y no significa nada. Aquí la ventana de estimación termina exactamente donde empieza
// el tramo que se mide, y la prueba `walkforward.test.js` lo comprueba con una estrategia espía
// que anota qué renglones recibió.
//
// Orientación de los datos: `returnMatrix` es T x N, renglones = periodos, columnas = activos.
// Todo sale en la periodicidad de esos rendimientos; `k` solo se usa para anualizar el resumen.

import { ledoitWolfConstantCorrelation, sampleCov } from './covariance.js'
import { assertMatrix, InvalidInputError } from './linalg.js'
import { maxSharpe, minVariance, projectBoxSimplex, riskParity } from './optimize.js'

/**
 * @typedef {{
 *   estimationStart: number,
 *   estimationEnd: number,
 *   holdStart: number,
 *   holdEnd: number,
 *   dates: string[],
 *   assets: number,
 *   fold: number,
 * }} WalkForwardContext
 */

/**
 * @typedef {(windowReturns: number[][], context: WalkForwardContext) => number[]} WeightStrategy
 */

/**
 * @typedef {{
 *   fold: number,
 *   date: string,
 *   holdStart: number,
 *   holdEnd: number,
 *   estimationStart: number,
 *   estimationEnd: number,
 *   weights: number[],
 *   note: string | null,
 * }} Rebalance
 */

/**
 * Media y desviación estándar muestral (n − 1) de un arreglo.
 * @param {number[]} xs
 * @returns {{ mean: number, sd: number | null }}
 */
function meanAndSd(xs) {
  const n = xs.length
  let mean = 0
  for (const x of xs) mean += x
  mean /= n
  if (n < 2) return { mean, sd: null }
  let acc = 0
  for (const x of xs) acc += (x - mean) * (x - mean)
  return { mean, sd: Math.sqrt(acc / (n - 1)) }
}

/**
 * Caída máxima de una trayectoria de valor (fracción negativa).
 *
 * `values` NO trae el arranque: es la riqueza DESPUÉS de cada periodo. Por eso el pico inicial es
 * 1, la riqueza con la que se entra, y no `values[0]`; si no, una pérdida en el primer periodo
 * fuera de muestra no se contaría. Si esto se cambia por `performance.js::drawdowns`, hay que
 * pasarle `[1, ...values]`.
 * @param {number[]} values
 * @returns {number}
 */
function maxDrawdownOf(values) {
  let peak = 1
  let worst = 0
  for (const v of values) {
    if (v > peak) peak = v
    const dd = peak > 0 ? v / peak - 1 : 0
    if (dd < worst) worst = dd
  }
  return worst
}

/**
 * Pesos de la estrategia pedida, calculados SOLO con la ventana de estimación.
 * @param {number[][]} windowReturns
 * @param {WalkForwardContext} context
 * @param {{ method: string | WeightStrategy, l: number | number[], u: number | number[], rf: number, covariance: string }} cfg
 * @returns {{ weights: number[], note: string | null }}
 */
function strategyWeights(windowReturns, context, cfg) {
  const n = context.assets
  const equal = () => projectBoxSimplex(new Array(n).fill(1 / n), cfg.l, cfg.u)

  if (typeof cfg.method === 'function') {
    const raw = cfg.method(windowReturns, context)
    if (!Array.isArray(raw) || raw.length !== n || raw.some((x) => !Number.isFinite(x))) {
      throw new InvalidInputError(`La estrategia devolvió algo que no son ${n} pesos numéricos.`)
    }
    return { weights: raw.slice(), note: null }
  }

  if (cfg.method === 'equalWeight') return { weights: equal(), note: null }

  /** @type {number[][] | null} */
  let estimated = null
  if (cfg.covariance === 'sample') {
    estimated = sampleCov(windowReturns)
  } else {
    const lw = ledoitWolfConstantCorrelation(windowReturns)
    estimated = lw ? lw.cov : null
  }
  if (!estimated) return { weights: equal(), note: 'Sin covarianza estimable, se repartió parejo.' }

  if (cfg.method === 'minVariance') {
    return { weights: minVariance(estimated, { l: cfg.l, u: cfg.u }).weights, note: null }
  }
  if (cfg.method === 'riskParity') {
    const rp = riskParity(estimated)
    if (!rp) return { weights: equal(), note: 'Algún activo tuvo varianza cero, se repartió parejo.' }
    return { weights: rp.weights, note: null }
  }
  if (cfg.method === 'maxSharpe') {
    const T = windowReturns.length
    const mu = new Array(n).fill(0)
    for (const row of windowReturns) {
      for (let i = 0; i < n; i += 1) mu[i] += row[i] / T
    }
    const ms = maxSharpe(mu, estimated, cfg.rf, { l: cfg.l, u: cfg.u })
    if (!ms) {
      return {
        weights: minVariance(estimated, { l: cfg.l, u: cfg.u }).weights,
        note: 'No hubo portafolio tangente, se usó mínima varianza.',
      }
    }
    return { weights: ms.weights, note: null }
  }
  throw new InvalidInputError(
    `Método desconocido: "${cfg.method}". Usa minVariance, maxSharpe, riskParity, equalWeight o una función.`,
  )
}

/**
 * Validación walk-forward de una estrategia de pesos.
 *
 * En cada corte se estima con los renglones `[estimationStart, estimationEnd)` y se mide con
 * `[holdStart, holdEnd)`, con `estimationEnd === holdStart` siempre: ni un renglón del tramo que
 * se mide entra a la estimación. La ventana de estimación recibe una COPIA de los renglones, así
 * que una estrategia no puede alcanzar el futuro ni por referencia.
 *
 * Dentro de cada tramo los pesos se dejan correr por omisión (`rebalance: 'hold'`), que es lo que
 * de verdad pasa en una cuenta: si un activo sube, su peso sube. Con `rebalance: 'period'` los
 * pesos se restablecen cada periodo, que es la versión de libro de texto.
 *
 * @param {number[][]} returnMatrix T x N: renglones = periodos, columnas = activos
 * @param {string[]} dates fechas ISO de cada renglón, del mismo largo que `returnMatrix`
 * @param {{
 *   estimationWindow?: number,
 *   holdPeriods?: number,
 *   method?: 'minVariance' | 'maxSharpe' | 'riskParity' | 'equalWeight' | WeightStrategy,
 *   window?: 'rolling' | 'expanding',
 *   rebalance?: 'hold' | 'period',
 *   covariance?: 'ledoitWolf' | 'sample',
 *   l?: number | number[],
 *   u?: number | number[],
 *   rf?: number,
 *   k?: number,
 * }} [options]
 *   `rf` es por periodo y solo lo usa `maxSharpe`; `k` son los periodos por año y solo anualiza
 *   el resumen (52 por omisión, o sea datos semanales).
 * @returns {{
 *   dates: string[],
 *   returns: number[],
 *   values: number[],
 *   rebalances: Rebalance[],
 *   folds: number,
 *   summary: {
 *     periods: number,
 *     meanPerPeriod: number,
 *     volPerPeriod: number | null,
 *     annualizedReturn: number | null,
 *     annualizedVol: number | null,
 *     cumulative: number,
 *     maxDrawdown: number,
 *     k: number,
 *   },
 * } | null}
 *   `null` si no alcanza para un solo periodo fuera de muestra, o sea T < estimationWindow + 1
 * @throws {InvalidInputError} si la matriz no es rectangular, trae NaN, las fechas no casan o
 *   los parámetros de ventana no son enteros positivos
 */
export function walkForward(returnMatrix, dates, options = {}) {
  const X = assertMatrix(returnMatrix, 'la matriz de rendimientos')
  const T = X.length
  const n = X[0].length

  if (!Array.isArray(dates) || dates.length !== T) {
    throw new InvalidInputError(`Hacen falta ${T} fechas, una por renglón de rendimientos.`)
  }
  for (let t = 0; t < T; t += 1) {
    if (typeof dates[t] !== 'string' || dates[t].length === 0) {
      throw new InvalidInputError(`La fecha del renglón ${t} tiene que ser una cadena ISO (YYYY-MM-DD).`)
    }
  }

  const estimationWindow = Math.round(options.estimationWindow ?? 156)
  const holdPeriods = Math.round(options.holdPeriods ?? 13)
  if (!(estimationWindow >= 2)) {
    throw new InvalidInputError('La ventana de estimación tiene que ser de al menos 2 periodos.')
  }
  if (!(holdPeriods >= 1)) {
    throw new InvalidInputError('El tramo fuera de muestra tiene que ser de al menos 1 periodo.')
  }

  const cfg = {
    method: options.method ?? 'minVariance',
    l: options.l ?? 0,
    u: options.u ?? 1,
    rf: options.rf ?? 0,
    covariance: options.covariance ?? 'ledoitWolf',
  }
  const expanding = options.window === 'expanding'
  const driftWithin = (options.rebalance ?? 'hold') === 'hold'
  const k = options.k ?? 52
  if (!Number.isFinite(k) || k <= 0) {
    throw new InvalidInputError('Los periodos por año (k) tienen que ser un número mayor que cero.')
  }

  if (T < estimationWindow + 1) return null

  /** @type {number[]} */
  const oosReturns = []
  /** @type {string[]} */
  const oosDates = []
  /** @type {Rebalance[]} */
  const rebalances = []

  let fold = 0
  for (let holdStart = estimationWindow; holdStart < T; holdStart += holdPeriods) {
    const holdEnd = Math.min(holdStart + holdPeriods, T)
    const estimationStart = expanding ? 0 : Math.max(0, holdStart - estimationWindow)
    const estimationEnd = holdStart
    // Guarda dura contra el sesgo de anticipación: si esto se rompe, el resultado no vale nada.
    if (estimationEnd > holdStart) {
      throw new InvalidInputError('Error interno: la ventana de estimación se metió al tramo fuera de muestra.')
    }

    const windowReturns = []
    for (let t = estimationStart; t < estimationEnd; t += 1) windowReturns.push(X[t].slice())

    /** @type {WalkForwardContext} */
    const context = {
      estimationStart,
      estimationEnd,
      holdStart,
      holdEnd,
      dates: dates.slice(estimationStart, estimationEnd),
      assets: n,
      fold,
    }
    const { weights, note } = strategyWeights(windowReturns, context, cfg)

    rebalances.push({
      fold,
      date: dates[holdStart],
      holdStart,
      holdEnd,
      estimationStart,
      estimationEnd,
      weights: weights.slice(),
      note,
    })

    let live = weights.slice()
    for (let t = holdStart; t < holdEnd; t += 1) {
      let r = 0
      for (let i = 0; i < n; i += 1) r += live[i] * X[t][i]
      oosReturns.push(r)
      oosDates.push(dates[t])
      if (driftWithin) {
        const growth = 1 + r
        if (Math.abs(growth) < 1e-12) {
          live = weights.slice()
        } else {
          live = live.map((w, i) => (w * (1 + X[t][i])) / growth)
        }
      } else {
        live = weights.slice()
      }
    }
    fold += 1
  }

  const values = []
  let wealth = 1
  for (const r of oosReturns) {
    wealth *= 1 + r
    values.push(wealth)
  }

  const { mean, sd } = meanAndSd(oosReturns)
  const periods = oosReturns.length
  return {
    dates: oosDates,
    returns: oosReturns,
    values,
    rebalances,
    folds: fold,
    summary: {
      periods,
      meanPerPeriod: mean,
      volPerPeriod: sd,
      annualizedReturn: wealth > 0 ? Math.pow(wealth, k / periods) - 1 : null,
      annualizedVol: sd == null ? null : sd * Math.sqrt(k),
      cumulative: wealth - 1,
      maxDrawdown: maxDrawdownOf(values),
      k,
    },
  }
}
