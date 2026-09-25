import { lastYears } from './panel-window.js'

describe('lastYears', () => {
  const panel = {
    dates: ['2021-09-17', '2023-09-15', '2023-09-22', '2024-09-20', '2026-09-18'],
    prices: { A: [1, 2, 3, 4, 5], B: [10, 20, 30, 40, 50] },
    meta: { asOf: '2026-09-18' },
  }

  it('se queda con los cierres de los últimos N años contados desde el último', () => {
    const out = lastYears(panel, 3)
    expect(out.dates).toEqual(['2023-09-22', '2024-09-20', '2026-09-18'])
    expect(out.prices).toEqual({ A: [3, 4, 5], B: [30, 40, 50] })
    expect(out.meta).toBe(panel.meta)
  })

  it('sin datos o con historia más corta que la ventana devuelve el mismo panel', () => {
    expect(lastYears(undefined, 3)).toBeUndefined()
    expect(lastYears({ ...panel, dates: [] }, 3).dates).toEqual([])
    expect(lastYears(panel, 10)).toBe(panel)
  })
})
