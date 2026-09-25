import { describe, expect, it } from 'vitest'
import { DEFAULT_INPUTS, fanPoints, retirementFromSim, runSimulation, summarize, toSimulateOptions, validateInputs } from './simulator.js'

// Caso del spec: 100,000 iniciales, 5,000 al inicio de cada mes, 1 % al mes sin volatilidad, un año.
const MU_1PCT_MENSUAL_PCT = (Math.pow(1.01, 12) - 1) * 100
const CASO_SPEC = {
  ...DEFAULT_INPUTS,
  initial: 100000,
  contribution: 5000,
  contributionGrowthPct: 0,
  years: 1,
  inflationPct: 0,
  returnPct: MU_1PCT_MENSUAL_PCT,
  volatilityPct: 0,
  goal: 176000,
}

describe('simulador: respuestas conocidas del spec a través de la lógica de la página', () => {
  it('aportación constante termina en 176,729.14', () => {
    const sim = runSimulation(CASO_SPEC, { paths: 11 })
    const s = summarize(sim, CASO_SPEC.goal, false)
    expect(s.median).toBeCloseTo(176729.14, 2)
    expect(s.contributed).toBe(160000)
    expect(s.probability).toBe(1)
  })

  it('aportación que crece 1 % al mes termina en 180,292.00', () => {
    const sim = runSimulation({ ...CASO_SPEC, contributionGrowthPct: MU_1PCT_MENSUAL_PCT }, { paths: 11 })
    expect(summarize(sim, 1, false).median).toBeCloseTo(180292.0, 2)
  })
})

describe('simulador: armado de datos', () => {
  it('convierte porcentajes anuales a fracciones', () => {
    const o = toSimulateOptions(DEFAULT_INPUTS)
    expect(o.mu).toBeCloseTo(0.09, 12)
    expect(o.sigma).toBeCloseTo(0.16, 12)
    expect(o.inflation).toBeCloseTo(0.04, 12)
    expect(o.stepsPerYear).toBe(12)
  })

  it('un punto del abanico por año, del año 0 al horizonte', () => {
    const sim = runSimulation({ ...DEFAULT_INPUTS, years: 5 }, { paths: 50 })
    const { points, contributed } = fanPoints(sim, true)
    expect(points.map((p) => p.x)).toEqual([0, 1, 2, 3, 4, 5])
    expect(contributed).toHaveLength(6)
    for (const p of points) {
      expect(p.p5).toBeLessThanOrEqual(p.p50)
      expect(p.p50).toBeLessThanOrEqual(p.p95)
    }
  })

  it('en términos reales la mediana es menor que en nominales cuando hay inflación', () => {
    const sim = runSimulation(DEFAULT_INPUTS, { paths: 200 })
    expect(summarize(sim, DEFAULT_INPUTS.goal, true).median).toBeLessThan(summarize(sim, DEFAULT_INPUTS.goal, false).median)
  })

  it('el escenario de retiro usa la mediana nominal y reporta el retiro mensual en pesos de hoy', () => {
    const sim = runSimulation(DEFAULT_INPUTS, { paths: 200 })
    const r = retirementFromSim(sim, DEFAULT_INPUTS)
    expect(r.balance).toBe(sim.terminal.p50)
    expect(r.firstMonthWithdrawal).toBeCloseTo((sim.terminal.p50 * 0.04) / 12, 6)
    expect(r.firstMonthReal).toBeLessThan(r.firstMonthWithdrawal)
  })

  it('marca los campos fuera de rango', () => {
    expect(validateInputs(DEFAULT_INPUTS)).toEqual({})
    const e = validateInputs({ ...DEFAULT_INPUTS, years: 0, initial: null, volatilityPct: -1 })
    expect(Object.keys(e).sort()).toEqual(['initial', 'volatilityPct', 'years'])
  })

  it('el retiro acepta lo que dice su mensaje: de 0.1 % a 30 %', () => {
    expect(validateInputs({ ...DEFAULT_INPUTS, withdrawalRatePct: 0.05 }).withdrawalRatePct).toBe('Usa un valor entre 0.1 % y 30 %.')
    expect(validateInputs({ ...DEFAULT_INPUTS, withdrawalRatePct: 0.1 })).toEqual({})
  })

  it('la aportación crece mes con mes al ritmo anual, no de golpe cada año', () => {
    const sim = runSimulation({ ...DEFAULT_INPUTS, initial: 0, contribution: 1000, contributionGrowthPct: 12, years: 1, inflationPct: 0, returnPct: 0, volatilityPct: 0 }, { paths: 3 })
    // Con crecimiento de una vez al año, el primer año serían 12 aportaciones de 1,000 exactas.
    const expected = Array.from({ length: 12 }, (_, t) => 1000 * 1.12 ** (t / 12)).reduce((a, b) => a + b, 0)
    expect(sim.contributedTotal).toBeCloseTo(expected, 6)
    expect(sim.contributedTotal).toBeGreaterThan(12000)
  })
})
