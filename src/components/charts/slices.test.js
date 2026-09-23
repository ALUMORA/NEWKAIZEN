import { describe, expect, it } from 'vitest'
import { arcPath, toSlices } from './slices.js'

describe('toSlices', () => {
  it('más de 8 rebanadas: 7 mayores y "Otros"', () => {
    const data = Array.from({ length: 11 }, (_, i) => ({ label: `A${i}`, value: i + 1 }))
    const { slices, total } = toSlices(data)
    expect(slices).toHaveLength(8)
    expect(slices[0].label).toBe('A10')
    expect(slices.at(-1).label).toBe('Otros')
    expect(slices.at(-1).members).toEqual(['A3', 'A2', 'A1', 'A0'])
    expect(slices.at(-1).value).toBe(10)
    expect(total).toBe(66)
    expect(slices.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1)
  })
  it('descarta ceros, negativos y faltantes', () => {
    expect(toSlices([{ label: 'a', value: 0 }, { label: 'b', value: -1 }, { label: 'c', value: null }, { label: 'd', value: 2 }]).slices).toHaveLength(1)
  })
  it('colores en orden fijo', () => {
    expect(toSlices([{ label: 'a', value: 2 }, { label: 'b', value: 1 }]).slices.map((s) => s.color)).toEqual(['var(--chart-1)', 'var(--chart-2)'])
  })
  it('arco completo con una sola rebanada', () => {
    expect(arcPath(50, 50, 50, 30, 0, Math.PI * 2)).toContain('A50,50 0 1,1')
  })
})
