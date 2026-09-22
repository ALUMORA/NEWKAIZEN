// Metas: qué probabilidad tiene un plan de llegar, cuánto habría que aportar para llegar, y cómo
// se ve un retiro tipo "regla del 4 %" como ESCENARIO, no como consejo.
//
// Todo se apoya en `simulate()` de montecarlo.js, así que hereda sus convenciones: tasas anuales
// en fracción, montos en una sola moneda, y resultados deterministas dada la semilla.
//
// Nada aquí es recomendación de inversión: son cuentas sobre supuestos que quien usa la app
// escribe, y los supuestos se muestran junto al resultado.

import { simulate } from './montecarlo.js'

/**
 * @typedef {import('./montecarlo.js').SimulationResult} SimulationResult
 * @typedef {import('./montecarlo.js').SimulateOptions} SimulateOptions
 */

/**
 * Valida que algo sea un número finito y lo devuelve.
 * @param {unknown} value
 * @param {string} name
 * @returns {number}
 */
function finite(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`goals: ${name} tiene que ser un número finito`)
  }
  return value
}

/**
 * Probabilidad de que la simulación termine en la meta o arriba de ella.
 *
 * @param {SimulationResult | null} sim resultado de `simulate()`
 * @param {number} target meta, en la misma moneda de la simulación
 * @param {{ real?: boolean }} [options] `real: true` compara la meta en pesos de hoy, o sea
 *   contra los saldos ya deflactados por la inflación de la simulación
 * @returns {number | null} fracción entre 0 y 1; `null` si no hay simulación o la meta no es un
 *   número finito
 */
export function probabilityOfGoal(sim, target, options = {}) {
  if (!sim || typeof sim.probabilityAbove !== 'function') return null
  if (typeof target !== 'number' || !Number.isFinite(target)) return null
  return sim.probabilityAbove(target, { real: options.real === true })
}

/**
 * @typedef {{
 *   target: number,
 *   years: number,
 *   initial?: number,
 *   mu?: number,
 *   sigma?: number,
 *   inflation?: number,
 *   contributionFrequency?: 'monthly' | 'annual',
 *   contributionGrowth?: number | null,
 *   stepsPerYear?: number,
 *   probability?: number,
 *   seed?: string | number,
 *   paths?: number,
 *   real?: boolean,
 *   method?: 'lognormal' | 'bootstrap',
 *   history?: number[] | Float64Array | null,
 *   blockSize?: number,
 *   maxContribution?: number | null,
 *   tolerance?: number,
 *   maxIterations?: number,
 * }} RequiredContributionOptions
 */

/**
 * Por qué la búsqueda no dio una respuesta refinada. `null` cuando sí la dio.
 *
 * - `'max-contribution'`: se probó `maxContribution` y ni con eso se alcanza la probabilidad.
 *   Subir `maxIterations` no sirve; hay que subir el tope o bajar la meta.
 * - `'max-iterations-bracket'`: se acabaron las iteraciones buscando un corchete, antes de llegar
 *   al tope. La meta podría ser alcanzable con más iteraciones.
 * - `'max-iterations-bisect'`: había corchete y se acabaron las iteraciones bisecando, así que
 *   `contribution` es una cota superior sin refinar a `tolerance`.
 *
 * @typedef {'max-contribution' | 'max-iterations-bracket' | 'max-iterations-bisect'} RequiredContributionReason
 */

/**
 * @typedef {{
 *   contribution: number | null,
 *   probability: number | null,
 *   iterations: number,
 *   bounded: boolean,
 *   converged: boolean,
 *   reason: RequiredContributionReason | null,
 *   sim: SimulationResult | null,
 * }} RequiredContribution
 */

/**
 * Aportación periódica mínima para que la meta se alcance con al menos `probability` de las
 * trayectorias simuladas.
 *
 * Se resuelve por bisección: con la semilla fija, el saldo final de CADA trayectoria crece de
 * forma monótona con la aportación, así que la proporción de trayectorias que llegan también, y
 * la bisección es válida. El corchete inicial se busca duplicando.
 *
 * Costo: corre una simulación completa por iteración, de ahí que `paths` sea 2000 por omisión y
 * no 10000. Súbelo si la respuesta se va a mostrar como definitiva.
 *
 * Tres campos dicen qué tan buena es la respuesta, y conviene leerlos los tres:
 * - `bounded: true` y `contribution: null`: no se encontró aportación que alcance.
 * - `converged: false`: hay número, pero sin refinar a `tolerance`. Es una cota SUPERIOR, o sea
 *   que la aportación real es menor. No lo pintes como definitivo.
 * - `reason`: cuál de los tres finales fue. `null` solo cuando la respuesta está refinada.
 *
 * @param {RequiredContributionOptions} options
 * @returns {RequiredContribution | null} `contribution` en `null` (con `bounded: true`) cuando ni
 *   siquiera `maxContribution` alcanza la probabilidad pedida. Devuelve `null` completo si la
 *   simulación misma no se puede hacer (por ejemplo `mu ≤ −1`). Lanza si un parámetro no es
 *   finito, si `probability` está fuera de (0, 1] o si `maxContribution` no es positivo, y lo
 *   hace ANTES de simular, o sea siempre que el dato esté mal y no solo a veces.
 */
export function requiredContribution(options) {
  if (!options || typeof options !== 'object') {
    throw new Error('goals: requiredContribution necesita un objeto de opciones')
  }
  const {
    target,
    years,
    initial = 0,
    mu = 0,
    sigma = 0,
    inflation = 0,
    contributionFrequency = 'monthly',
    contributionGrowth = null,
    stepsPerYear = 12,
    probability = 0.5,
    seed = 'kaizen',
    paths = 2000,
    real = false,
    method = 'lognormal',
    history = null,
    blockSize = 6,
    maxContribution = null,
    tolerance = 0.01,
    maxIterations = 80,
  } = options

  finite(target, 'target')
  finite(years, 'years')
  finite(probability, 'probability')
  const tol = finite(tolerance, 'tolerance')
  if (tol <= 0) throw new Error('goals: tolerance tiene que ser mayor que cero')
  if (probability <= 0 || probability > 1) {
    throw new Error('goals: probability tiene que estar entre 0 (exclusivo) y 1')
  }
  const iterationCap = Math.trunc(finite(maxIterations, 'maxIterations'))
  if (iterationCap < 1) throw new Error('goals: maxIterations tiene que ser al menos 1')

  /** @type {SimulateOptions} */
  const base = {
    initial,
    contributionFrequency,
    contributionGrowth,
    years,
    stepsPerYear,
    mu,
    sigma,
    inflation,
    paths,
    seed,
    method,
    history,
    blockSize,
  }

  /**
   * @param {number} contribution
   * @returns {{ sim: SimulationResult, probability: number } | null}
   */
  function run(contribution) {
    const sim = simulate({ ...base, contribution })
    if (sim === null) return null
    const p = sim.probabilityAbove(target, { real })
    return { sim, probability: p === null ? 0 : p }
  }

  // El tope se calcula y se valida ANTES de simular. Si se deja abajo, un `maxContribution`
  // inválido pasa callado cuando la meta ya se cumple sin aportar y truena solo con otros datos,
  // o sea que un error de captura aparece o no según el caso. Misma clase de error de orden que el
  // de `history` en montecarlo.js.
  const cap = maxContribution == null
    ? Math.max(1e6, Math.abs(target) * 10)
    : finite(maxContribution, 'maxContribution')
  if (cap <= 0) throw new Error('goals: maxContribution tiene que ser mayor que cero')

  let iterations = 1
  const zero = run(0)
  if (zero === null) return null
  if (zero.probability >= probability) {
    return {
      contribution: 0,
      probability: zero.probability,
      iterations,
      bounded: false,
      converged: true,
      reason: null,
      sim: zero.sim,
    }
  }

  // Corchete: se duplica desde una primera estimación hasta que la meta se alcance o se tope.
  let lo = 0
  let hi = Math.min(cap, Math.max(1, Math.abs(target) / Math.max(1, Math.round(years * stepsPerYear))))
  let feasible = run(hi)
  iterations += 1
  while (feasible !== null && feasible.probability < probability && hi < cap && iterations < iterationCap) {
    lo = hi
    hi = Math.min(cap, hi * 2)
    feasible = run(hi)
    iterations += 1
  }
  if (feasible === null) return null
  if (feasible.probability < probability) {
    return {
      contribution: null,
      probability: feasible.probability,
      iterations,
      bounded: true,
      converged: false,
      // Se probó el tope y no alcanzó, o se acabaron las iteraciones antes de llegar a él. No es
      // lo mismo: en el primer caso subir `maxIterations` no sirve de nada.
      reason: hi >= cap ? 'max-contribution' : 'max-iterations-bracket',
      sim: feasible.sim,
    }
  }

  // Bisección sobre [lo, hi] con lo infactible y hi factible.
  while (hi - lo > tol && iterations < iterationCap) {
    const mid = (lo + hi) / 2
    const attempt = run(mid)
    iterations += 1
    if (attempt === null) return null
    if (attempt.probability >= probability) {
      hi = mid
      feasible = attempt
    } else {
      lo = mid
    }
  }

  // Si se acabaron las iteraciones el corchete sigue abierto y `hi` es una SOBRESTIMACIÓN sin
  // refinar, no la respuesta. Se devuelve igual, porque es una cota superior honesta, pero
  // marcada: con maxIterations bajo la diferencia llega a ser de varios por ciento.
  const converged = hi - lo <= tol
  return {
    contribution: hi,
    probability: feasible.probability,
    iterations,
    bounded: false,
    converged,
    reason: converged ? null : 'max-iterations-bisect',
    sim: feasible.sim,
  }
}

/**
 * @typedef {{
 *   withdrawalRate: number,
 *   firstYearWithdrawal: number,
 *   firstMonthWithdrawal: number,
 *   withdrawals: number[],
 *   balances: number[],
 *   depletedYear: number | null,
 *   totalWithdrawn: number,
 *   finalBalance: number,
 *   finalBalanceReal: number,
 *   nota: string,
 * }} RetirementScenario
 */

/**
 * Escenario determinista de retiro: se saca un porcentaje del saldo inicial el primer año y ese
 * monto se indexa a la inflación cada año. El retiro ocurre al INICIO del año y lo que queda
 * rinde `nominalReturn` durante ese año.
 *
 * No es una regla ni un consejo: es una cuenta con los supuestos que quien usa la app escribió.
 * Si el saldo no alcanza para el retiro de un año, se retira lo que queda y se marca el año en
 * `depletedYear`.
 *
 * @param {{
 *   balance: number,
 *   withdrawalRate?: number,
 *   nominalReturn?: number,
 *   inflation?: number,
 *   years?: number,
 * }} options
 * @returns {RetirementScenario | null} `null` si el saldo inicial es cero o negativo, o si
 *   `years` es menor que 1. Lanza si algún parámetro no es finito o si las tasas son ≤ −1.
 */
export function retirementIncome(options) {
  if (!options || typeof options !== 'object') {
    throw new Error('goals: retirementIncome necesita un objeto de opciones')
  }
  const {
    balance,
    withdrawalRate = 0.04,
    nominalReturn = 0,
    inflation = 0,
    years = 30,
  } = options

  finite(balance, 'balance')
  finite(withdrawalRate, 'withdrawalRate')
  finite(nominalReturn, 'nominalReturn')
  finite(inflation, 'inflation')
  const horizon = Math.trunc(finite(years, 'years'))
  if (withdrawalRate < 0) throw new Error('goals: withdrawalRate no puede ser negativa')
  if (nominalReturn <= -1) throw new Error('goals: nominalReturn tiene que ser mayor que −1')
  if (inflation <= -1) throw new Error('goals: inflation tiene que ser mayor que −1')
  if (balance <= 0 || horizon < 1) return null

  const firstYearWithdrawal = balance * withdrawalRate
  /** @type {number[]} */
  const withdrawals = []
  /** @type {number[]} */
  const balances = [balance]
  let current = balance
  let planned = firstYearWithdrawal
  let total = 0
  /** @type {number | null} */
  let depletedYear = null

  for (let year = 1; year <= horizon; year += 1) {
    // Solo se puede retirar lo que hay; el año en que el saldo termina en cero es el de
    // agotamiento, tanto si el retiro salió completo como si salió a medias.
    const taken = Math.min(planned, current)
    current = (current - taken) * (1 + nominalReturn)
    if (current <= 0) {
      current = 0
      if (depletedYear === null) depletedYear = year
    }
    total += taken
    withdrawals.push(taken)
    balances.push(current)
    planned *= 1 + inflation
  }

  const deflator = Math.pow(1 + inflation, horizon)
  return {
    withdrawalRate,
    firstYearWithdrawal,
    firstMonthWithdrawal: firstYearWithdrawal / 12,
    withdrawals,
    balances,
    depletedYear,
    totalWithdrawn: total,
    finalBalance: current,
    finalBalanceReal: current / deflator,
    nota: 'Escenario ilustrativo con los supuestos que capturaste. No es recomendación de inversión.',
  }
}
