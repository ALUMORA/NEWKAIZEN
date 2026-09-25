import { describe, expect, it } from 'vitest'
import { fxStatSpec, itemStatus, rfChartText } from './shared.js'

describe('itemStatus', () => {
  it('una serie con verified: false (el Bono M de FRED) se marca como respaldo aunque la respuesta no lo sea', () => {
    const item = { id: 'bonoM10', asOf: '2026-08-01', source: 'fred', verified: false, stale: false }
    expect(itemStatus(item, { fallback: false, source: 'banxico,fred' }).fallback).toBe(true)
  })
  it('una serie verificada de Banxico no se marca', () => {
    expect(itemStatus({ id: 'target', source: 'banxico', verified: true }, { fallback: false }).fallback).toBe(false)
  })
  it('sin el campo verified (API anterior) manda meta.fallback', () => {
    expect(itemStatus({ id: 'target', source: 'banxico' }, { fallback: false }).fallback).toBe(false)
    expect(itemStatus({ id: 'target', source: 'fred' }, { fallback: true }).fallback).toBe(true)
  })
})

describe('fxStatSpec', () => {
  const FX = { rate: 18.43, source: 'banxico_fix', meta: {} }
  it('si /v2/rates/mx ya trae el FIX con valor, no se repite el de /v2/fx', () => {
    expect(fxStatSpec([{ id: 'fix', value: 18.43, unit: 'mxn' }], FX)).toBeNull()
  })
  it('sin FIX en las tasas, el de /v2/fx se llama FIX solo si viene de Banxico', () => {
    expect(fxStatSpec([], FX)?.label).toBe('Dólar FIX')
    const yahoo = fxStatSpec([], { rate: 18.5, source: 'yahoo', fallback: true, meta: { fallback: true } })
    expect(yahoo?.label).toBe('Dólar en el mercado')
    expect(yahoo?.label).not.toMatch(/FIX/)
  })
  it('sin dato de /v2/fx no hay tarjeta', () => {
    expect(fxStatSpec([], undefined)).toBeNull()
  })
})

describe('rfChartText', () => {
  it('con CETES de Banxico nombra los CETES del plazo', () => {
    expect(rfChartText({ source: 'banxico', fallback: false, tenorDays: 28 }).series).toBe('CETES 28 días')
  })
  it('con el respaldo de FRED no dice CETES: es la tasa interbancaria a 3 meses', () => {
    const t = rfChartText({ source: 'fred_ir3tib', fallback: true, tenorDays: 91 })
    expect(t.title).not.toMatch(/CETES/)
    expect(t.series).not.toMatch(/CETES/)
    expect(t.title).toMatch(/interbancaria a 3 meses/)
  })
})
