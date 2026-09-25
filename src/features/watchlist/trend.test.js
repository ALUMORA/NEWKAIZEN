import { describe, expect, it } from 'vitest'
import { trendSummary } from './trend.js'

// La tendencia de un mes se mostraba sin decir de qué fechas, con qué precios ni de qué fuente.
describe('trendSummary', () => {
  const history = { symbol: 'WALMEX.MX', currency: 'MXN', interval: '1d', adjusted: true, dates: ['2026-08-24', '2026-09-01', '2026-09-22'], close: [50, 52, 55], meta: { source: 'yahoo', asOf: '2026-09-22' } }

  it('cambio del primer al último cierre con su periodo, intervalo y moneda', () => {
    const t = trendSummary(history)
    expect(t.change).toBeCloseTo(0.1, 12)
    expect(t.start).toBe('2026-08-24')
    expect(t.end).toBe('2026-09-22')
    expect(t.label).toBe('WALMEX.MX: del 24 ago 2026 al 22 sep 2026, cierres diarios ajustados en MXN, cambio de +10.00%')
  })

  it('sin datos o con el primer cierre en cero no inventa un cambio', () => {
    expect(trendSummary(null)).toBeNull()
    expect(trendSummary({ ...history, dates: [], close: [] })).toBeNull()
    expect(trendSummary({ ...history, close: [0, 1, 2] }).change).toBeNull()
  })

  it('la nota del pie dice periodo y precios aunque cada emisora tenga su moneda', () => {
    expect(trendSummary(history).note).toBe('Un mes: cambio entre el primer y el último cierre diario ajustado, del 24 ago 2026 al 22 sep 2026, en la moneda de cada emisora.')
  })
})
