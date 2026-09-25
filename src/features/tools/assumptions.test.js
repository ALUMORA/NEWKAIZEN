import { DEFAULT_ASSUMPTIONS, marketPremiumPct, validateAssumptions } from './assumptions.js'
import { DEFAULT_ERP, ERP_SOURCE, marketPremium } from './optimizer.js'

describe('supuestos del optimizador', () => {
  it('los de omisión sirven: CAPM con la prima del API, CETES del API y caja de 0 % a 100 %', () => {
    expect(DEFAULT_ASSUMPTIONS.erpPct).toBeNull()
    expect(DEFAULT_ASSUMPTIONS.erpTouched).toBe(false)
    expect(validateAssumptions(DEFAULT_ASSUMPTIONS, 3, 7.49, 4.23)).toEqual({})
  })

  it('la prima sale del API salvo que la persona la escriba; mientras llega no es error', () => {
    expect(marketPremiumPct(DEFAULT_ASSUMPTIONS, 5.1)).toBe(5.1)
    expect(marketPremiumPct({ ...DEFAULT_ASSUMPTIONS, erpPct: 6, erpTouched: true }, 5.1)).toBe(6)
    expect(validateAssumptions(DEFAULT_ASSUMPTIONS, 3, 7.49, undefined)).toEqual({})
    expect(validateAssumptions({ ...DEFAULT_ASSUMPTIONS, erpPct: 25, erpTouched: true }, 3, 7.49, 4.23).erpPct).toMatch(/entre 0 % y 20 %/)
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
    expect(validateAssumptions({ ...DEFAULT_ASSUMPTIONS, erpPct: null, erpTouched: true }, 2, 7, 4.23).erpPct).toBeTruthy()
    expect(validateAssumptions({ ...DEFAULT_ASSUMPTIONS, erpPct: null, erpTouched: true, muMethod: 'jamesStein' }, 2, 7, 4.23)).toEqual({})
  })
})

describe('marketPremium: /v2/assumptions con respaldo declarado', () => {
  const data = /** @type {any} */ ({
    erp: 0.0461, matureMarketErp: 0.0461, crp: { MX: 0.0263 }, source: 'Aswath Damodaran, NYU Stern, vintage enero 2027',
    sourceUrl: 'https://pages.stern.nyu.edu/', vintage: '2027-01', asOf: '2027-01-06', meta: { stale: false },
  })

  it('usa la prima del API con su fuente y fecha', () => {
    expect(marketPremium(data, { available: true, failed: false })).toEqual({ erp: 0.0461, source: data.source, asOf: '2027-01-06', fallback: false, stale: false })
  })

  it('sin la capacidad o con la ruta caída usa DEFAULT_ERP y lo marca como respaldo', () => {
    const fallback = { erp: DEFAULT_ERP, source: ERP_SOURCE, asOf: null, fallback: true, stale: false }
    expect(marketPremium(undefined, { available: false, failed: false })).toEqual(fallback)
    expect(marketPremium(undefined, { available: true, failed: true })).toEqual(fallback)
    expect(marketPremium({ ...data, erp: Number.NaN }, { available: true, failed: false })).toEqual(fallback)
  })

  it('mientras llega no inventa: null', () => {
    expect(marketPremium(undefined, { available: true, failed: false })).toBeNull()
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
