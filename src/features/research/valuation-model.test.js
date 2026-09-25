import { describe, expect, it } from 'vitest'
import { dcfCurrency, validateAssumptions } from './valuation-model.js'

describe('validateAssumptions', () => {
  it('pasa porcentajes a fracción y redondea los años', () => {
    expect(validateAssumptions({ erp: 6, crp: null, terminalGrowth: 3.5, growth: undefined, years: 7.4 })).toEqual({
      params: { erp: 0.06, terminalGrowth: 0.035, years: 7 },
      errors: {},
    })
  })
  it('detiene lo que el API rechazaría con 422, con el rango en el mensaje', () => {
    const { params, errors } = validateAssumptions({ terminalGrowth: 7, erp: 25, years: 20, growth: -60, crp: 2 })
    expect(params).toEqual({ crp: 0.02 })
    expect(errors.terminalGrowth).toBe('El crecimiento terminal va de −2 a 6 %.')
    expect(errors.erp).toMatch(/0 a 20 %/)
    expect(errors.years).toBe('Los años de proyección van de 1 a 15.')
    expect(errors.growth).toMatch(/−50 a 100 %/)
  })
  it('los bordes son válidos', () => {
    expect(validateAssumptions({ terminalGrowth: -2, years: 15 }).errors).toEqual({})
  })
})

describe('dcfCurrency', () => {
  it('emisora que reporta en USD y cotiza en MXN: el DCF va en USD', () => {
    expect(dcfCurrency({ currency: 'MXN', dcf: { inputs: { currency: 'USD' } } })).toBe('USD')
  })
  it('sin moneda en los insumos, la de cotización', () => {
    expect(dcfCurrency({ currency: 'MXN', dcf: { inputs: {} } })).toBe('MXN')
  })
})
