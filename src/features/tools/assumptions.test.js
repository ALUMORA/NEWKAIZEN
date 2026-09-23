import { DEFAULT_ASSUMPTIONS, validateAssumptions } from './assumptions.js'

describe('supuestos del optimizador', () => {
  it('los de omisión sirven: CAPM con 4.23 %, CETES del API y caja de 0 % a 100 %', () => {
    expect(DEFAULT_ASSUMPTIONS.erpPct).toBe(4.23)
    expect(validateAssumptions(DEFAULT_ASSUMPTIONS, 3, 7.49)).toEqual({})
  })

  it('sin tasa del API hay que escribir una', () => {
    expect(validateAssumptions(DEFAULT_ASSUMPTIONS, 3, null).rfPct).toMatch(/Escribe una/)
    expect(validateAssumptions({ ...DEFAULT_ASSUMPTIONS, rfPct: 8, rfTouched: true }, 3, null)).toEqual({})
    expect(validateAssumptions({ ...DEFAULT_ASSUMPTIONS, rfPct: null, rfTouched: true }, 3, 7).rfPct).toMatch(/entre 0 %/)
  })

  it('una caja que no deja sumar 100 % se explica con el número de emisoras', () => {
    expect(validateAssumptions({ ...DEFAULT_ASSUMPTIONS, maxPct: 30 }, 3, 7).maxPct).toMatch(/al menos 33.33 %/)
    expect(validateAssumptions({ ...DEFAULT_ASSUMPTIONS, minPct: 40 }, 3, 7).minPct).toMatch(/hasta 33.33 %/)
    expect(validateAssumptions({ ...DEFAULT_ASSUMPTIONS, minPct: 50, maxPct: 40 }, 2, 7).minPct).toMatch(/no puede pasar/)
  })

  it('la prima solo se exige con CAPM', () => {
    expect(validateAssumptions({ ...DEFAULT_ASSUMPTIONS, erpPct: null }, 2, 7).erpPct).toBeTruthy()
    expect(validateAssumptions({ ...DEFAULT_ASSUMPTIONS, erpPct: null, muMethod: 'jamesStein' }, 2, 7)).toEqual({})
  })
})
