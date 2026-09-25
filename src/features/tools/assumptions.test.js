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

describe('prima de mercado contra el archivo de Damodaran (revisión RT)', () => {
  it('DEFAULT_ERP es la matureMarketErp de kaizen_api/data/damodaran_2026.json y la fuente dice su vintage', async () => {
    const { readFileSync } = await import('node:fs')
    const file = JSON.parse(readFileSync(new URL('../../../kaizen_api/data/damodaran_2026.json', import.meta.url), 'utf8'))
    const { DEFAULT_ERP, ERP_SOURCE } = await import('./optimizer.js')
    expect(DEFAULT_ERP).toBe(file.matureMarketErp)
    expect(file.vintage).toBe('2026-01')
    expect(ERP_SOURCE).toMatch(/enero de 2026/)
  })
})
