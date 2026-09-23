import { describe, expect, it } from 'vitest'
import { cetesResult, tenorOf } from './cetes-calc.js'

describe('cetesResult', () => {
  it('11 % a 28 días: efectiva anual .117455 del spec', () => {
    const r = cetesResult({ amount: 10000, tenorDays: 28, annualYield: 0.11, retentionRate: 0.009 })
    expect(r?.effectiveAnnual).toBeCloseTo(0.117455, 6)
    expect(r?.gross).toBeCloseTo((10000 * 0.11 * 28) / 360, 8)
    expect(r?.retention).toBeCloseTo((10000 * 0.009 * 28) / 365, 8)
    expect(r?.net).toBeCloseTo(r.gross - r.retention, 8)
  })
  it('sin monto o con tasa vacía no calcula', () => {
    expect(cetesResult({ amount: null, tenorDays: 28, annualYield: 0.11, retentionRate: 0 })).toBeNull()
    expect(cetesResult({ amount: 100, tenorDays: 28, annualYield: null, retentionRate: 0 })).toBeNull()
  })
  it('lee el plazo del identificador o la etiqueta', () => {
    expect(tenorOf({ id: 'cetes91', label: '' })).toBe(91)
    expect(tenorOf({ id: 'x', label: 'CETES 364 días' })).toBe(364)
    expect(tenorOf({ id: 'x', label: 'y' })).toBeNull()
  })
})
