import { describe, expect, it } from 'vitest'
import { forwardAt, impactBars, impactMxn, monthEnd, percentileOf, projectBudget } from './budget.js'

describe('percentileOf', () => {
  it('caso de la spec: 19 contra [17, 18, 19, 20] da 0.75', () => {
    expect(percentileOf(19, [17, 18, 19, 20])).toBe(0.75)
  })
  it('ignora huecos y sin ventana da null', () => {
    expect(percentileOf(18, [17, null, 18, 20])).toBeCloseTo(2 / 3)
    expect(percentileOf(18, [])).toBeNull()
    expect(percentileOf(null, [1, 2])).toBeNull()
  })
})

describe('impactMxn', () => {
  it('caso de la spec: 100,000 USD con +0.50 dan +50,000 MXN', () => {
    expect(impactMxn(100_000, 0.5)).toBe(50_000)
    expect(impactMxn(100_000, -1)).toBe(-100_000)
    expect(impactMxn(null, 1)).toBeNull()
  })
  it('las barras traen los cuatro choques con signo U+2212', () => {
    const bars = impactBars(10_000)
    expect(bars.map((b) => b.value)).toEqual([-10_000, -5_000, 5_000, 10_000])
    expect(bars[0].label).toBe('−1.00 por dólar')
    expect(bars[3].label).toBe('+1.00 por dólar')
  })
})

describe('forwardAt', () => {
  const rows = [
    { days: 30, forward: 18.1 },
    { days: 90, forward: 18.4 },
  ]
  it('interpola en línea recta desde el spot y no extrapola', () => {
    expect(forwardAt(rows, 18, 0)).toBe(18)
    expect(forwardAt(rows, 18, 15)).toBeCloseTo(18.05)
    expect(forwardAt(rows, 18, 60)).toBeCloseTo(18.25)
    expect(forwardAt(rows, 18, 120)).toBeNull()
  })
})

describe('projectBudget', () => {
  it('compara el forward de cada cierre de mes con el presupuesto', () => {
    expect(monthEnd('2026-09-22', 0)).toBe('2026-09-30')
    const out = projectBudget({
      spot: 18,
      asOf: '2026-09-22',
      rows: [{ days: 365, forward: 18.73 }],
      budgetRate: 18.5,
      flowUsd: 100_000,
      months: 3,
    })
    expect(out.map((r) => r.month)).toEqual(['2026-09', '2026-10', '2026-11'])
    expect(out[0].days).toBe(8)
    expect(out[0].forward).toBeCloseTo(18 + (0.73 * 8) / 365)
    expect(out[0].diffMxn).toBeCloseTo((out[0].forward - 18.5) * 100_000, 1)
  })
  it('si hoy es fin de mes empieza en el siguiente', () => {
    const out = projectBudget({ spot: 18, asOf: '2026-09-30', rows: [{ days: 365, forward: 19 }], budgetRate: 18, flowUsd: 1, months: 2 })
    expect(out.map((r) => r.month)).toEqual(['2026-10', '2026-11'])
  })
})
