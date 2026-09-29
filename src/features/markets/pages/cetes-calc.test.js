import { describe, expect, it, vi } from 'vitest'
import { INTEREST_WITHHOLDING_RATE, interestWithholding } from '../../../lib/finance/tax-mx.js'
import * as calc from './cetes-calc.js'
import { cetesResult, cetesRows, tenorOf } from './cetes-calc.js'

// Se espía la retención de tax-mx para fijar que la calculadora no tiene su propia fórmula.
vi.mock('../../../lib/finance/tax-mx.js', async (importOriginal) => {
  const mod = /** @type {any} */ (await importOriginal())
  return { ...mod, interestWithholding: vi.fn(mod.interestWithholding) }
})

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

describe('retención de ISR de la calculadora', () => {
  it('usa interestWithholding de tax-mx, sin constante ni fórmula propias', () => {
    expect(calc).not.toHaveProperty('ISR_RETENTION_2026')
    vi.mocked(interestWithholding).mockClear()
    const r = cetesResult({ amount: 10000, tenorDays: 91, annualYield: 0.11, retentionRate: INTEREST_WITHHOLDING_RATE })
    expect(interestWithholding).toHaveBeenCalledWith(10000, 91, { rate: INTEREST_WITHHOLDING_RATE })
    expect(r?.retention).toBeCloseTo((10000 * 0.009 * 91) / 365, 8)
  })
  it('una tasa editada sigue mandando sobre la de la ley', () => {
    const r = cetesResult({ amount: 10000, tenorDays: 28, annualYield: 0.11, retentionRate: 0.005 })
    expect(r?.retention).toBeCloseTo((10000 * 0.005 * 28) / 365, 8)
  })
})

describe('cetesRows', () => {
  const r = (over) => ({ unit: 'fraction', value: 0.07, ...over })

  it('con tenorDays del API (fase 3) no adivina por texto', () => {
    const rows = cetesRows([
      r({ id: 'cetes182', label: 'CETES 182 días', tenorDays: 182 }),
      r({ id: 'cetes28', label: 'CETES 28 días', tenorDays: 28 }),
      // Una serie cuyo texto dice "cetes" pero no es un plazo de subasta: tenorDays null la saca.
      r({ id: 'cetes_spread', label: 'Diferencial CETES 28 contra objetivo', tenorDays: null }),
      r({ id: 'tiie28', label: 'TIIE 28 días', tenorDays: null }),
    ])
    expect(rows.map((x) => [x.id, x.tenorDays])).toEqual([['cetes28', 28], ['cetes182', 182]])
  })

  it('un API anterior sin el campo: se reconoce por el texto y el plazo sale de tenorOf', () => {
    const rows = cetesRows([r({ id: 'cetes91', label: 'CETES 91 días' }), r({ id: 'tiie28', label: 'TIIE 28 días' }), r({ id: 'cetes28', label: 'CETES 28', unit: 'index' })])
    expect(rows.map((x) => [x.id, x.tenorDays])).toEqual([['cetes91', 91]])
  })
})
