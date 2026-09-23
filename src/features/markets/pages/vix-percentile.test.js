import { describe, expect, it } from 'vitest'
import { percentRank, percentileNumber, quartileText, vixContext } from './vix-percentile.js'

describe('percentRank', () => {
  it('cuenta los valores en ese nivel o por debajo', () => {
    expect(percentRank([10, 20, 30, 40], 25)).toBe(0.5)
    expect(percentRank([10, 20, 30, 40], 30)).toBe(0.75)
    expect(percentRank([10, 20, 30, 40], 5)).toBe(0)
    expect(percentRank([10, 20, 30, 40], 99)).toBe(1)
  })
  it('ignora faltantes y no inventa con datos vacíos', () => {
    expect(percentRank([null, 10, undefined, 20], 15)).toBe(0.5)
    expect(percentRank([], 15)).toBeNull()
    expect(percentRank([1, 2], Number.NaN)).toBeNull()
  })
})

describe('vixContext', () => {
  const dates = Array.from({ length: 100 }, (_, i) => `2026-01-${String((i % 28) + 1).padStart(2, '0')}`)
  const close = Array.from({ length: 100 }, (_, i) => i + 1)

  it('percentil, extremos y cuartiles de la ventana', () => {
    const c = vixContext({ dates, close }, 62.5)
    expect(c).toMatchObject({ rank: 0.62, n: 100, min: 1, max: 100, from: dates[0], to: dates[99] })
    expect(c?.p50).toBeCloseTo(50.5, 10)
    expect(c?.p25).toBeCloseTo(25.75, 10)
    expect(c?.p75).toBeCloseTo(75.25, 10)
    expect(percentileNumber(/** @type {number} */ (c?.rank))).toBe(62)
  })
  it('con menos de dos cierres o sin valor de hoy no hay percentil', () => {
    expect(vixContext({ dates: ['2026-01-01'], close: [15] }, 15)).toBeNull()
    expect(vixContext({ dates, close }, null)).toBeNull()
    expect(vixContext(null, 15)).toBeNull()
  })
})

describe('quartileText', () => {
  it('describe la posición sin adjetivos de ánimo', () => {
    expect(quartileText(0.1)).toMatch(/más baja/)
    expect(quartileText(0.4)).toMatch(/debajo de su mediana/)
    expect(quartileText(0.6)).toMatch(/arriba de su mediana/)
    expect(quartileText(0.9)).toMatch(/más alta/)
    for (const r of [0.1, 0.4, 0.6, 0.9]) expect(quartileText(r)).not.toMatch(/miedo|codicia|pánico|calma|tranquil/i)
  })
})
