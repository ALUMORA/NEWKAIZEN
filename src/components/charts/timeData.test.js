import { describe, expect, it } from 'vitest'
import { bandPath, linePaths, prepareTime, yDomainOf } from './timeData.js'

const id = (v) => v

describe('prepareTime', () => {
  it('une y ordena las fechas de todas las series', () => {
    const d = prepareTime([
      { label: 'A', points: [{ date: '2026-01-02', value: 1 }, { date: '2026-01-01', value: 2 }] },
      { label: 'B', points: [{ date: '2026-01-03', value: 3 }, { date: 'basura', value: 4 }] },
    ])
    expect(d.xs).toEqual([Date.UTC(2026, 0, 1), Date.UTC(2026, 0, 2), Date.UTC(2026, 0, 3)])
    expect(d.series[1].color).toBe('var(--chart-2)')
  })
  it('modo numérico', () => {
    const d = prepareTime([{ label: 'A', points: [{ x: 2, value: 1 }, { x: 1, value: 0 }] }], [], 'number')
    expect(d.xs).toEqual([1, 2])
  })
})

describe('yDomainOf', () => {
  it('base en 0 para rendimientos', () => {
    const d = prepareTime([{ label: 'A', points: [{ date: '2026-01-01', value: 0.05 }, { date: '2026-01-02', value: 0.12 }] }])
    expect(yDomainOf(d, { zeroBaseline: true }).domain[0]).toBe(0)
  })
  it('log ignora no positivos', () => {
    const d = prepareTime([{ label: 'A', points: [{ date: '2026-01-01', value: -1 }, { date: '2026-01-02', value: 10 }, { date: '2026-01-03', value: 1000 }] }])
    const y = yDomainOf(d, { log: true })
    expect(y.domain[0]).toBeGreaterThan(0)
    expect(y.ticks).toContain(100)
  })
  it('sin valores es null', () => {
    expect(yDomainOf(prepareTime([{ label: 'A', points: [] }]))).toBeNull()
  })
  it('respeta un tope fijo (drawdown en 0)', () => {
    const d = prepareTime([{ label: 'A', points: [{ date: '2026-01-01', value: -0.3 }, { date: '2026-01-02', value: -0.01 }] }])
    expect(yDomainOf(d, { yDomain: [undefined, 0] }).domain[1]).toBe(0)
  })
})

describe('trazos', () => {
  it('corta la línea en los faltantes y reporta puntos sueltos', () => {
    const map = new Map([[0, 1], [1, 2], [2, null], [3, 4]])
    const r = linePaths([0, 1, 2, 3], map, id, id, 0)
    expect(r.line).toBe('M0,1L1,2M3,4')
    expect(r.singles).toEqual([[3, 4]])
    expect(r.area).toContain('Z')
  })
  it('banda cerrada', () => {
    const map = new Map([[0, [1, 3]], [1, [2, 4]]])
    expect(bandPath([0, 1], map, id, id)).toBe('M0,3L1,4L1,2L0,1Z')
  })
})
