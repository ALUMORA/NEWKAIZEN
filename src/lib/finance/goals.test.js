import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { probabilityOfGoal, requiredContribution, retirementIncome } from './goals.js'
import { simulate } from './montecarlo.js'

const golden = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../tests/golden/goals.json', import.meta.url)), 'utf8'),
)

/**
 * @param {string} kind
 * @returns {any[]}
 */
function casesOf(kind) {
  return golden.cases.filter((/** @type {any} */ c) => c.kind === kind)
}

/**
 * @param {number} actual
 * @param {number} expected
 * @param {number} tol tolerancia relativa
 */
function closeEnough(actual, expected, tol) {
  if (tol === 0) {
    expect(actual).toBe(expected)
    return
  }
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(expected)))
}

const MU_1PCT_MENSUAL = Math.pow(1.01, 12) - 1
const META_CONOCIDA = 176729.14322984172

const PLAN_BASE = {
  initial: 100000,
  contribution: 5000,
  contributionFrequency: /** @type {const} */ ('monthly'),
  contributionGrowth: 0,
  years: 1,
  stepsPerYear: 12,
  mu: MU_1PCT_MENSUAL,
  sigma: 0,
  inflation: 0,
  paths: 9,
  seed: 'metas',
}

describe('probabilityOfGoal', () => {
  it('lee la probabilidad de la simulación', () => {
    const sim = simulate(PLAN_BASE)
    expect(probabilityOfGoal(sim, 176000)).toBe(1)
    expect(probabilityOfGoal(sim, META_CONOCIDA - 0.01)).toBe(1)
    expect(probabilityOfGoal(sim, 177000)).toBe(0)
  })

  it('con la meta en pesos de hoy compara contra el saldo deflactado', () => {
    const sim = simulate({ ...PLAN_BASE, inflation: 0.05 })
    const real = sim.terminalReal.p50
    expect(probabilityOfGoal(sim, real - 1, { real: true })).toBe(1)
    expect(probabilityOfGoal(sim, real + 1, { real: true })).toBe(0)
    expect(probabilityOfGoal(sim, real + 1, { real: false })).toBe(1)
  })

  it('queda entre 0 y 1 con volatilidad', () => {
    const sim = simulate({ ...PLAN_BASE, sigma: 0.15, years: 10, paths: 3000 })
    const p = probabilityOfGoal(sim, 1000000)
    expect(p).toBeGreaterThan(0)
    expect(p).toBeLessThan(1)
  })

  it('devuelve null sin simulación o con meta inválida', () => {
    const sim = simulate(PLAN_BASE)
    expect(probabilityOfGoal(null, 100)).toBeNull()
    expect(probabilityOfGoal(/** @type {any} */ ({}), 100)).toBeNull()
    expect(probabilityOfGoal(sim, Number.NaN)).toBeNull()
    expect(probabilityOfGoal(sim, /** @type {any} */ ('100000'))).toBeNull()
  })

  it.each(casesOf('probabilityOfGoal'))('$name', (testCase) => {
    const sim = simulate(testCase.input.sim)
    const p = probabilityOfGoal(sim, testCase.input.target, { real: testCase.input.real })
    closeEnough(p, testCase.expected, testCase.tol)
  })
})

describe('requiredContribution', () => {
  it('respuesta conocida: 5,000 al mes para llegar a 176,729.14', () => {
    const r = requiredContribution({
      target: META_CONOCIDA,
      years: 1,
      initial: 100000,
      mu: MU_1PCT_MENSUAL,
      sigma: 0,
      inflation: 0,
      contributionGrowth: 0,
      stepsPerYear: 12,
      probability: 0.5,
      paths: 1,
      seed: 'metas',
      tolerance: 1e-7,
      maxIterations: 300,
    })
    expect(r.contribution).toBeCloseTo(5000, 6)
    expect(r.probability).toBe(1)
    expect(r.bounded).toBe(false)
    expect(r.sim).not.toBeNull()
    expect(r.iterations).toBeGreaterThan(1)
  })

  it('devuelve 0 cuando la meta ya está cubierta sin aportar', () => {
    const r = requiredContribution({
      target: 100000,
      years: 5,
      initial: 500000,
      mu: 0.06,
      sigma: 0,
      probability: 0.5,
      paths: 1,
      seed: 'metas',
    })
    expect(r.contribution).toBe(0)
    expect(r.probability).toBe(1)
    expect(r.iterations).toBe(1)
  })

  it('la aportación sube cuando se pide más probabilidad', () => {
    const base = {
      target: 1000000,
      years: 10,
      initial: 100000,
      mu: 0.08,
      sigma: 0.15,
      stepsPerYear: 12,
      paths: 800,
      seed: 'metas',
      tolerance: 1,
    }
    const p50 = requiredContribution({ ...base, probability: 0.5 })
    const p90 = requiredContribution({ ...base, probability: 0.9 })
    expect(p50.contribution).toBeGreaterThan(0)
    expect(p90.contribution).toBeGreaterThan(p50.contribution)
    expect(p50.probability).toBeGreaterThanOrEqual(0.5)
    expect(p90.probability).toBeGreaterThanOrEqual(0.9)
  })

  it('la aportación que devuelve sí alcanza la meta al simularla de nuevo', () => {
    const r = requiredContribution({
      target: 2000000,
      years: 12,
      initial: 50000,
      mu: 0.09,
      sigma: 0.14,
      inflation: 0.04,
      stepsPerYear: 12,
      probability: 0.75,
      paths: 1000,
      seed: 'comprobacion',
      tolerance: 1,
    })
    const sim = simulate({
      initial: 50000,
      contribution: r.contribution,
      contributionFrequency: 'monthly',
      contributionGrowth: null,
      years: 12,
      stepsPerYear: 12,
      mu: 0.09,
      sigma: 0.14,
      inflation: 0.04,
      paths: 1000,
      seed: 'comprobacion',
    })
    expect(probabilityOfGoal(sim, 2000000)).toBeGreaterThanOrEqual(0.75)
  })

  it('avisa cuando ni el tope alcanza', () => {
    const r = requiredContribution({
      target: 1e12,
      years: 1,
      initial: 0,
      mu: 0.05,
      sigma: 0,
      probability: 0.9,
      paths: 1,
      seed: 'metas',
      maxContribution: 1000,
    })
    expect(r.contribution).toBeNull()
    expect(r.bounded).toBe(true)
    expect(r.probability).toBe(0)
  })

  it('devuelve null cuando la simulación misma no existe', () => {
    expect(
      requiredContribution({ target: 1000, years: 1, initial: 0, mu: -1.5, sigma: 0, paths: 1 }),
    ).toBeNull()
    expect(requiredContribution({ target: 1000, years: 0, initial: 0, mu: 0.08, sigma: 0, paths: 1 })).toBeNull()
  })

  it('rechaza parámetros inválidos', () => {
    const base = { target: 1000, years: 1, mu: 0.08, sigma: 0, paths: 1 }
    expect(() => requiredContribution({ ...base, target: Number.NaN })).toThrow(/número finito/)
    expect(() => requiredContribution({ ...base, probability: 0 })).toThrow(/entre 0/)
    expect(() => requiredContribution({ ...base, probability: 1.2 })).toThrow(/entre 0/)
    expect(() => requiredContribution({ ...base, tolerance: 0 })).toThrow(/mayor que cero/)
    expect(() => requiredContribution({ ...base, maxIterations: 0 })).toThrow(/al menos 1/)
    expect(() => requiredContribution({ ...base, maxContribution: -5 })).toThrow(/mayor que cero/)
    expect(() => requiredContribution(/** @type {any} */ (null))).toThrow(/objeto de opciones/)
  })

  it.each(casesOf('requiredContribution'))('$name', (testCase) => {
    const r = requiredContribution(testCase.input)
    expect(r).not.toBeNull()
    closeEnough(r.contribution, testCase.expected.contribution, testCase.tol)
  })
})

describe('retirementIncome', () => {
  it('respuesta conocida a tres años', () => {
    const r = retirementIncome({
      balance: 1000000,
      withdrawalRate: 0.04,
      nominalReturn: 0.05,
      inflation: 0.03,
      years: 3,
    })
    expect(r.firstYearWithdrawal).toBeCloseTo(40000, 9)
    expect(r.firstMonthWithdrawal).toBeCloseTo(40000 / 12, 9)
    expect(r.withdrawals[0]).toBeCloseTo(40000, 9)
    expect(r.withdrawals[1]).toBeCloseTo(41200, 9)
    expect(r.withdrawals[2]).toBeCloseTo(42436, 9)
    expect(r.balances[0]).toBe(1000000)
    expect(r.balances[1]).toBeCloseTo(1008000, 6)
    expect(r.balances[2]).toBeCloseTo(1015140, 6)
    expect(r.balances[3]).toBeCloseTo(1021339.2, 6)
    expect(r.depletedYear).toBeNull()
    expect(r.totalWithdrawn).toBeCloseTo(123636, 6)
    expect(r.finalBalanceReal).toBeCloseTo(1021339.2 / Math.pow(1.03, 3), 6)
  })

  it('marca el año en que se acaba el dinero', () => {
    const r = retirementIncome({ balance: 100000, withdrawalRate: 0.2, nominalReturn: 0, inflation: 0, years: 8 })
    expect(r.depletedYear).toBe(5)
    expect(r.withdrawals[4]).toBeCloseTo(20000, 9)
    expect(r.withdrawals[5]).toBe(0)
    expect(r.balances[5]).toBe(0)
    expect(r.totalWithdrawn).toBeCloseTo(100000, 9)
  })

  it('con rendimiento real cero el saldo real baja exactamente la tasa de retiro cada año', () => {
    // Rendimiento nominal = inflación, o sea rendimiento real 0: retirar 4 % al año consume el
    // saldo en 25 años justos, así que a los 20 tiene que quedar el 20 % en pesos de hoy.
    const r = retirementIncome({
      balance: 1000000,
      withdrawalRate: 0.04,
      nominalReturn: 0.04,
      inflation: 0.04,
      years: 20,
    })
    expect(r.depletedYear).toBeNull()
    expect(r.finalBalanceReal).toBeCloseTo(200000, 4)
    const veinticinco = retirementIncome({
      balance: 1000000,
      withdrawalRate: 0.04,
      nominalReturn: 0.04,
      inflation: 0.04,
      years: 30,
    })
    expect(veinticinco.depletedYear).toBe(25)
  })

  it('siempre trae la nota de que es un escenario', () => {
    const r = retirementIncome({ balance: 500000 })
    expect(r.nota).toMatch(/no es recomendación de inversión/i)
    expect(r.withdrawals).toHaveLength(30)
    expect(r.balances).toHaveLength(31)
  })

  it('devuelve null sin saldo o sin horizonte', () => {
    expect(retirementIncome({ balance: 0 })).toBeNull()
    expect(retirementIncome({ balance: -100 })).toBeNull()
    expect(retirementIncome({ balance: 100000, years: 0 })).toBeNull()
  })

  it('rechaza parámetros inválidos', () => {
    expect(() => retirementIncome({ balance: Number.NaN })).toThrow(/número finito/)
    expect(() => retirementIncome({ balance: 1000, withdrawalRate: Number.NaN })).toThrow(/número finito/)
    expect(() => retirementIncome({ balance: 1000, withdrawalRate: -0.01 })).toThrow(/negativa/)
    expect(() => retirementIncome({ balance: 1000, nominalReturn: -1 })).toThrow(/mayor que −1/)
    expect(() => retirementIncome({ balance: 1000, inflation: -1 })).toThrow(/mayor que −1/)
    expect(() => retirementIncome(/** @type {any} */ (null))).toThrow(/objeto de opciones/)
  })

  it.each(casesOf('retirementIncome'))('$name', (testCase) => {
    const r = retirementIncome(testCase.input)
    expect(r).not.toBeNull()
    closeEnough(r.firstYearWithdrawal, testCase.expected.firstYearWithdrawal, testCase.tol)
    closeEnough(r.firstMonthWithdrawal, testCase.expected.firstMonthWithdrawal, testCase.tol)
    closeEnough(r.totalWithdrawn, testCase.expected.totalWithdrawn, testCase.tol)
    closeEnough(r.finalBalance, testCase.expected.finalBalance, testCase.tol)
    closeEnough(r.finalBalanceReal, testCase.expected.finalBalanceReal, testCase.tol)
    expect(r.depletedYear).toBe(testCase.expected.depletedYear)
    expect(r.withdrawals).toHaveLength(testCase.expected.withdrawals.length)
    for (let i = 0; i < testCase.expected.withdrawals.length; i += 1) {
      closeEnough(r.withdrawals[i], testCase.expected.withdrawals[i], testCase.tol)
    }
    expect(r.balances).toHaveLength(testCase.expected.balances.length)
    for (let i = 0; i < testCase.expected.balances.length; i += 1) {
      closeEnough(r.balances[i], testCase.expected.balances[i], testCase.tol)
    }
  })
})
