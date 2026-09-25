import { installFetch, json } from '../../test/fetchMock.js'
import { resetSessionForTests } from '../auth/session.js'
import { resetCapabilitiesForTests } from './capabilities.js'
import { API_BASE } from './config.js'
import { MAX_SYMBOLS, getHistory, getInstrument, getQuotes, getValuation, normalizeSymbol, normalizeSymbols } from './endpoints.js'
import { legacyFx, legacyHistory, legacyQuotes, legacyRiskFree } from './legacy.js'

beforeEach(() => {
  resetSessionForTests()
  resetCapabilitiesForTests({ status: 'ready', apiVersion: 2, authRequired: false, checkedAt: 'x' })
})

describe('símbolos', () => {
  it('normaliza y valida', () => {
    expect(normalizeSymbol(' walmex.mx ')).toBe('WALMEX.MX')
    expect(normalizeSymbol('^MXX')).toBe('^MXX')
    expect(() => normalizeSymbol('AAPL; DROP')).toThrow(/no es una clave válida/)
    expect(() => normalizeSymbol('')).toThrow()
  })

  it('lista sin repetidos, no vacía y con tope', () => {
    expect(normalizeSymbols(['aapl', 'AAPL', 'msft'])).toEqual(['AAPL', 'MSFT'])
    expect(() => normalizeSymbols([])).toThrow('Falta al menos una clave.')
    expect(() => normalizeSymbols(Array.from({ length: MAX_SYMBOLS + 1 }, (_, i) => `S${i}`))).toThrow(/hasta 50/)
  })
})

describe('endpoints v2', () => {
  it('arma rutas y query del contrato', async () => {
    const f = installFetch([json(200, { quotes: [] }), json(200, {}), json(200, {}), json(200, {})])
    await getQuotes(['walmex.mx', 'AAPL'])
    await getHistory('naftrac.mx', { range: '5y', interval: '1wk', ccy: 'MXN' })
    await getInstrument('^MXX')
    await getValuation('AAPL', { erp: 0.055, years: 5 })
    expect(f.calls.map((c) => c.url)).toEqual([
      `${API_BASE}/v2/quotes?symbols=WALMEX.MX%2CAAPL`,
      `${API_BASE}/v2/history/NAFTRAC.MX?range=5y&interval=1wk&ccy=MXN`,
      `${API_BASE}/v2/instrument/%5EMXX`,
      `${API_BASE}/v2/valuation/AAPL?erp=0.055&years=5`,
    ])
  })

  it('símbolo inválido: ApiError sin llamar al API', async () => {
    const f = installFetch([])
    await expect(getInstrument('no válido')).rejects.toMatchObject({ status: 400, code: 'INVALID_SYMBOL' })
    expect(f.calls).toHaveLength(0)
  })

  it('servidor viejo sin VITE_ALLOW_LEGACY: LEGACY_SERVER y no se llama la ruta v2', async () => {
    resetCapabilitiesForTests({ status: 'legacy', apiVersion: 1, authRequired: false, checkedAt: 'x' })
    const f = installFetch([])
    await expect(getQuotes(['AAPL'])).rejects.toMatchObject({ status: 501, code: 'LEGACY_SERVER' })
    await expect(getInstrument('AAPL')).rejects.toMatchObject({ code: 'LEGACY_SERVER' })
    expect(f.calls).toHaveLength(0)
  })

  it('espera el sondeo de /health antes de decidir', async () => {
    resetCapabilitiesForTests()
    const f = installFetch([json(200, { status: 'ok', apiVersion: 2, authRequired: false }), json(200, { quotes: [] })])
    await getQuotes(['AAPL'])
    expect(f.calls.map((c) => c.url)).toEqual([`${API_BASE}/health`, `${API_BASE}/v2/quotes?symbols=AAPL`])
  })
})

describe('adaptadores del API viejo', () => {
  it('historia: sin fechas por punto y con la nota de alineación', async () => {
    const f = installFetch([json(200, { closes: [1, 2, null, 3], period: '1y', bars: 4, currency: 'MXN' })])
    const h = await legacyHistory('AAPL', { range: '1y', ccy: 'MXN' })
    expect(f.calls[0].url).toBe(`${API_BASE}/chart/AAPL?period=1y&ccy=MXN`)
    expect(h).toMatchObject({ symbol: 'AAPL', currency: 'MXN', interval: '1wk', dates: null, close: [1, 2, 3], fx: { pair: 'USDMXN' } })
    expect(h.meta.notes).toContain('alineación aproximada')
    expect(h.meta.source).toBe('legacy')
  })

  it('historia: "max" se pide como 10 años y lo dice', async () => {
    const f = installFetch([json(200, { closes: [1], currency: 'USD' })])
    const h = await legacyHistory('AAPL', { range: 'max' })
    expect(f.calls[0].url).toBe(`${API_BASE}/chart/AAPL?period=10y`)
    expect(h.meta.notes.join(' ')).toMatch(/10 años/)
  })

  it('el {"error"} con 200 del v1 se vuelve ApiError 502', async () => {
    installFetch([json(200, { error: 'Sin histórico USD/MXN para convertir', closes: [] })])
    await expect(legacyHistory('AAPL', { ccy: 'MXN' })).rejects.toMatchObject({ status: 502, code: 'UPSTREAM_UNAVAILABLE' })
  })

  it('cotizaciones: los que fallan van a missing', async () => {
    installFetch((url) => (url.includes('/stock/AAPL') ? json(200, { name: 'Apple Inc.', price: 341.56, currency: 'USD' })() : json(200, { error: 'x' })()))
    const q = await legacyQuotes(['AAPL', 'ZZZ'])
    expect(q.quotes).toEqual([expect.objectContaining({ symbol: 'AAPL', price: 341.56, change: null, changePct: null })])
    expect(q.missing).toEqual(['ZZZ'])
  })

  it('FX: acepta el dato real y rechaza el 17.5 fijo', async () => {
    installFetch([json(200, { USDMXN: 17.2275 }), json(200, { USDMXN: 17.5, fallback: true })])
    await expect(legacyFx()).resolves.toMatchObject({ pair: 'USDMXN', rate: 17.2275, source: 'yahoo' })
    await expect(legacyFx()).rejects.toMatchObject({ status: 503, code: 'UPSTREAM_UNAVAILABLE' })
  })

  it('rf: serie constante marcada fallback, sin disfrazarla de CETES', async () => {
    installFetch([json(200, { rate: 0.0916, label: 'Bono M 10Y (ago 2026)', asOf: '2026-08-01' }), json(200, { rate: 0.086, fallback: true })])
    const rf = await legacyRiskFree()
    expect(rf).toMatchObject({ dates: ['2026-08-01'], values: [0.0916], fallback: true, source: 'legacy_bono_m_10y' })
    expect(rf.meta.fallback).toBe(true)
    expect(rf.meta.notes.join(' ')).toMatch(/Bono M 10Y .*en lugar de CETES 28/)
    await expect(legacyRiskFree()).rejects.toMatchObject({ status: 503 })
  })
})
