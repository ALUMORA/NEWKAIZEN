// Lógica del simulador (F4): convierte lo que la persona escribe en la página (porcentajes
// anuales, montos y años) a las opciones de `simulate` y arma los puntos del FanChart. Es pura para
// poder probarla sin navegador; la página solo la llama.
import { simulate, retirementIncome } from '../../lib/finance/index.js'

/** Supuestos de arranque. Son ejemplos editables, no una predicción. */
export const DEFAULT_INPUTS = {
  initial: 100000,
  contribution: 5000,
  contributionGrowthPct: 4,
  years: 20,
  inflationPct: 4,
  returnPct: 9,
  volatilityPct: 16,
  goal: 3000000,
  withdrawalRatePct: 4,
  retirementYears: 25,
}

export const DEFAULT_PATHS = 2000
export const DEFAULT_SEED = 'kaizen-simulador'

/**
 * Revisa los campos y devuelve los errores por campo (texto en español) o `{}` si todo cuadra.
 * @param {Record<string, number | null>} inputs
 * @returns {Record<string, string>}
 */
export function validateInputs(inputs) {
  /** @type {Record<string, string>} */
  const errors = {}
  const need = (key, ok, text) => {
    const v = inputs[key]
    if (v === null || v === undefined || !Number.isFinite(v)) errors[key] = 'Escribe un número.'
    else if (!ok(v)) errors[key] = text
  }
  need('initial', (v) => v >= 0, 'No puede ser negativo.')
  need('contribution', (v) => v >= 0, 'No puede ser negativa.')
  need('contributionGrowthPct', (v) => v > -100 && v <= 50, 'Usa un valor entre −99 % y 50 %.')
  need('years', (v) => v >= 1 && v <= 60 && Number.isInteger(v), 'Usa un número entero de 1 a 60 años.')
  need('inflationPct', (v) => v > -100 && v <= 50, 'Usa un valor entre −99 % y 50 %.')
  need('returnPct', (v) => v > -100 && v <= 50, 'Usa un valor entre −99 % y 50 %.')
  need('volatilityPct', (v) => v >= 0 && v <= 100, 'Usa un valor entre 0 % y 100 %.')
  need('goal', (v) => v > 0, 'La meta tiene que ser mayor que cero.')
  need('withdrawalRatePct', (v) => v >= 0.1 && v <= 30, 'Usa un valor entre 0.1 % y 30 %.')
  need('retirementYears', (v) => v >= 1 && v <= 60 && Number.isInteger(v), 'Usa un número entero de 1 a 60 años.')
  return errors
}

/**
 * Opciones de `simulate` a partir de los campos de la página (porcentajes anuales).
 * @param {Record<string, number>} inputs
 * @param {{ paths?: number, seed?: string }} [opts]
 */
export function toSimulateOptions(inputs, opts = {}) {
  return {
    initial: inputs.initial,
    contribution: inputs.contribution,
    contributionFrequency: /** @type {const} */ ('monthly'),
    contributionGrowth: inputs.contributionGrowthPct / 100,
    years: inputs.years,
    stepsPerYear: 12,
    mu: inputs.returnPct / 100,
    sigma: inputs.volatilityPct / 100,
    inflation: inputs.inflationPct / 100,
    paths: opts.paths ?? DEFAULT_PATHS,
    seed: opts.seed ?? DEFAULT_SEED,
  }
}

/**
 * Corre la simulación en este hilo (respaldo cuando no hay Web Worker, y las pruebas).
 * @param {Record<string, number>} inputs
 * @param {{ paths?: number, seed?: string }} [opts]
 */
export function runSimulation(inputs, opts) {
  return simulate(toSimulateOptions(inputs, opts))
}

/**
 * Puntos del FanChart, uno por año (y el último paso), en años como eje x.
 * @param {any} sim resultado de `simulate`
 * @param {boolean} real true: pesos de hoy; false: pesos nominales
 */
export function fanPoints(sim, real) {
  if (!sim) return { points: [], contributed: [] }
  const bands = real ? sim.percentilesReal : sim.percentiles
  const contributed = real ? sim.contributedReal : sim.contributed
  const k = sim.stepsPerYear
  const points = []
  const line = []
  for (let t = 0; t <= sim.steps; t += 1) {
    if (t % k !== 0 && t !== sim.steps) continue
    const x = t / k
    points.push({ x, p5: bands.p5[t], p25: bands.p25[t], p50: bands.p50[t], p75: bands.p75[t], p95: bands.p95[t] })
    line.push({ x, value: contributed[t] })
  }
  return { points, contributed: line }
}

/**
 * Resumen del resultado para las cifras de la página.
 * @param {any} sim
 * @param {number} goal meta en pesos de hoy
 * @param {boolean} real
 */
export function summarize(sim, goal, real) {
  if (!sim) return null
  const terminal = real ? sim.terminalReal : sim.terminal
  const lastDeflator = sim.deflators[sim.deflators.length - 1]
  return {
    median: terminal.p50,
    p5: terminal.p5,
    p95: terminal.p95,
    contributed: real ? sim.contributedTotalReal : sim.contributedTotal,
    // La meta se escribe en pesos de hoy, así que se compara en términos reales.
    probability: sim.probabilityAbove(goal, { real: true }),
    goalNominal: goal * lastDeflator,
  }
}

/**
 * Escenario de retiro con el saldo mediano nominal al final del horizonte.
 * @param {any} sim
 * @param {Record<string, number>} inputs
 */
export function retirementFromSim(sim, inputs) {
  if (!sim) return null
  const balance = sim.terminal.p50
  if (!(balance > 0)) return null
  const scenario = retirementIncome({
    balance,
    withdrawalRate: inputs.withdrawalRatePct / 100,
    nominalReturn: inputs.returnPct / 100,
    inflation: inputs.inflationPct / 100,
    years: inputs.retirementYears,
  })
  if (!scenario) return null
  // Primer retiro mensual en pesos de hoy: se deflacta con la inflación de todo el horizonte.
  const deflator = sim.deflators[sim.deflators.length - 1]
  return { ...scenario, balance, firstMonthReal: scenario.firstMonthWithdrawal / deflator }
}
