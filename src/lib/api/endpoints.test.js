import { installFetch, json } from '../../test/fetchMock.js'
import { resetSessionForTests } from '../auth/session.js'
import { resetCapabilitiesForTests } from './capabilities.js'
import { API_BASE } from './config.js'
import {
  MAX_SYMBOLS, getAssumptions, getBreadth, getCreditHealth, getCurveSpreads, getCurves, getEarnings, getEconomicCalendar, getEventsSeason,
  getExpectations, getFilings, getFix, getFixTable, getFund, getFxCrosses, getFxForward, getFxMonitor, getHistory, getHolders, getIndustries,
  getInpc, getInstrument, getMacroIndicators, getMacroWorld, getMoneyMarket, getMovers, getOhlc, getPanel, getQuotes, getReferenceMx,
  getSectors, getShares, getUpdateFactor, getValuation, isValidOhlc, normalizeSymbol, normalizeSymbols,
} from './endpoints.js'
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
  it('rechaza sin salir a la red un periodo o intervalo fuera del contrato (el API contesta 422)', async () => {
    const f = installFetch([])
    await expect(getPanel(['walmex.mx'], { range: /** @type {any} */ ('3y'), interval: '1wk', ccy: 'MXN' })).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' })
    await expect(getHistory('walmex.mx', { range: '1y', interval: /** @type {any} */ ('1h') })).rejects.toMatchObject({ status: 400 })
    expect(f.calls).toHaveLength(0)
  })

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

  it('fase 3: panel con adjust=splits solo si se pide, INPC y supuestos', async () => {
    const f = installFetch([json(200, {}), json(200, {}), json(200, {}), json(200, {})])
    await getPanel(['walmex.mx'], { range: '1y', interval: '1d', ccy: 'MXN' })
    await getPanel(['walmex.mx'], { range: '1y', interval: '1d', ccy: 'MXN', adjust: 'splits' })
    await getInpc({ start: '2026-01-01' })
    await getAssumptions()
    expect(f.calls.map((c) => c.url)).toEqual([
      `${API_BASE}/v2/panel?symbols=WALMEX.MX&range=1y&interval=1d&ccy=MXN`,
      `${API_BASE}/v2/panel?symbols=WALMEX.MX&range=1y&interval=1d&ccy=MXN&adjust=splits`,
      `${API_BASE}/v2/rates/mx/inpc?start=2026-01-01`,
      `${API_BASE}/v2/assumptions`,
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

describe('fase 5: rutas y validación antes de salir a la red', () => {
  it('arma rutas y query exactos del contrato', async () => {
    const f = installFetch(Array.from({ length: 26 }, () => json(200, { meta: {} })))
    await getCurves({ country: 'mx', compare: ['1w', '1y'] })
    await getCurveSpreads({ history: '5y' })
    await getMoneyMarket()
    await getExpectations()
    await getFxMonitor({ years: 5 })
    await getFxCrosses()
    await getFix({ date: '2026-09-30', rule: 'dof' })
    await getFixTable({ start: '2026-01-01', end: '2026-09-30', rule: 'dof', monthEnd: true })
    await getFxForward({ days: [30, 91], mxn: 'tiie', usd: 'sofr' })
    await getEconomicCalendar({ start: '2026-10-01', end: '2026-10-31', country: ['mx', 'us'] })
    await getMacroIndicators({ country: 'us', years: 'max' })
    await getMacroWorld({ countries: ['mex', 'USA', 'BRA'], indicators: ['gdpGrowth', 'inflation'] })
    await getEventsSeason({ universe: 'mx', days: 60 })
    await getEarnings('aapl')
    await getHolders('AAPL')
    await getShares('AAPL', { start: '2023-10-01' })
    await getFilings('AAPL', { forms: ['10-K', '8-K', 'SC 13G'], limit: 20 })
    await getOhlc('walmex.mx', { range: '1mo', interval: '5m', compare: '^MXX' })
    await getMovers({ market: 'us', kind: 'losers', limit: 25 })
    await getBreadth({ market: 'mx' })
    await getSectors({ market: 'us' })
    await getFund('spy')
    await getReferenceMx()
    await getUpdateFactor({ from: '2025-01', to: '2026-08' })
    await getIndustries({ market: 'EM' })
    await getCreditHealth('WALMEX.MX', { years: 5 })
    expect(f.calls.map((c) => c.url.replace(API_BASE, ''))).toEqual([
      '/v2/curves?country=mx&compare=1w%2C1y',
      '/v2/curves/spreads?history=5y',
      '/v2/money-market',
      '/v2/expectations',
      '/v2/fxdesk/monitor?years=5',
      '/v2/fxdesk/crosses',
      '/v2/fxdesk/fix?date=2026-09-30&rule=dof',
      '/v2/fxdesk/fix-table?start=2026-01-01&end=2026-09-30&rule=dof&monthEnd=true',
      '/v2/fxdesk/forward?days=30%2C91&mxn=tiie&usd=sofr',
      '/v2/calendar/economic?start=2026-10-01&end=2026-10-31&country=mx%2Cus',
      '/v2/macro/indicators?country=us&years=max',
      '/v2/macro/world?countries=MEX%2CUSA%2CBRA&indicators=gdpGrowth%2Cinflation',
      '/v2/events/season?universe=mx&days=60',
      '/v2/earnings/AAPL',
      '/v2/holders/AAPL',
      '/v2/shares/AAPL?start=2023-10-01',
      '/v2/filings/AAPL?forms=10-K%2C8-K%2CSC+13G&limit=20',
      '/v2/ohlc/WALMEX.MX?range=1mo&interval=5m&compare=%5EMXX',
      '/v2/movers?market=us&kind=losers&limit=25',
      '/v2/breadth?market=mx',
      '/v2/sectors?market=us',
      '/v2/funds/SPY',
      '/v2/reference/mx',
      '/v2/reference/mx/update-factor?from=2025-01&to=2026-08',
      '/v2/business/industries?market=EM',
      '/v2/credit-health/WALMEX.MX?years=5',
    ])
  })

  it('los opcionales sin dar no viajan', async () => {
    const f = installFetch(Array.from({ length: 6 }, () => json(200, { meta: {} })))
    await getCurves({ country: 'us' })
    await getCurveSpreads()
    await getFxMonitor()
    await getFix({ date: '2026-09-30' })
    await getFxForward()
    await getOhlc('AAPL')
    expect(f.calls.map((c) => c.url.replace(API_BASE, ''))).toEqual([
      '/v2/curves?country=us',
      '/v2/curves/spreads',
      '/v2/fxdesk/monitor?years=1',
      '/v2/fxdesk/fix?date=2026-09-30&rule=fecha',
      '/v2/fxdesk/forward',
      '/v2/ohlc/AAPL?range=1y&interval=1d',
    ])
  })

  it.each([
    ['país fuera del contrato', () => getCurves({ country: /** @type {any} */ ('br') })],
    ['país faltante', () => getCurves(/** @type {any} */ ({}))],
    ['comparación desconocida', () => getCurves({ country: 'mx', compare: /** @type {any} */ (['2y']) })],
    ['historia de diferenciales', () => getCurveSpreads({ history: /** @type {any} */ ('10y') })],
    ['años del monitor', () => getFxMonitor({ years: /** @type {any} */ (2) })],
    ['fecha del FIX mal formada', () => getFix({ date: '30/09/2026' })],
    ['fecha del FIX imposible', () => getFix({ date: '2026-02-30' })],
    ['regla del FIX', () => getFix({ date: '2026-09-30', rule: /** @type {any} */ ('sat') })],
    ['tabla de FIX de más de 3 años', () => getFixTable({ start: '2020-01-01', end: '2023-01-02' })],
    ['tabla de FIX al revés', () => getFixTable({ start: '2026-09-30', end: '2026-01-01' })],
    ['plazo 0 en forward', () => getFxForward({ days: [0] })],
    ['plazo mayor a 365 en forward', () => getFxForward({ days: [366] })],
    ['plazos y fecha a la vez', () => getFxForward({ days: [30], date: '2026-12-31' })],
    ['referencia en pesos', () => getFxForward({ mxn: /** @type {any} */ ('libor') })],
    ['calendario de más de 90 días', () => getEconomicCalendar({ start: '2026-01-01', end: '2026-06-01' })],
    ['país del calendario', () => getEconomicCalendar({ start: '2026-10-01', end: '2026-10-02', country: /** @type {any} */ (['ca']) })],
    ['años de indicadores', () => getMacroIndicators({ country: 'mx', years: /** @type {any} */ (3) })],
    ['país del comparador', () => getMacroWorld({ countries: ['MX'] })],
    ['más de 10 países', () => getMacroWorld({ countries: ['MEX', 'USA', 'BRA', 'ARG', 'CHL', 'COL', 'PER', 'CAN', 'DEU', 'FRA', 'JPN'] })],
    ['indicador del comparador', () => getMacroWorld({ indicators: /** @type {any} */ (['pib']) })],
    ['ventana de la temporada', () => getEventsSeason({ universe: 'us', days: /** @type {any} */ (45) })],
    ['símbolo mal formado', () => getEarnings('no válido')],
    ['inicio de acciones', () => getShares('AAPL', { start: '2023-13-01' })],
    ['tipo de documento', () => getFilings('AAPL', { forms: ['S-1'] })],
    ['límite de documentos', () => getFilings('AAPL', { limit: 51 })],
    ['intradía de 5 minutos a un año', () => getOhlc('AAPL', { range: '1y', interval: '5m' })],
    ['intradía de 1 hora a 5 años', () => getOhlc('AAPL', { range: '5y', interval: '1h' })],
    ['periodo de velas', () => getOhlc('AAPL', { range: /** @type {any} */ ('3mo') })],
    ['referencia de velas', () => getOhlc('AAPL', { compare: /** @type {any} */ ('QQQ') })],
    ['tipo de movimientos', () => getMovers({ market: 'mx', kind: /** @type {any} */ ('up') })],
    ['límite de movimientos', () => getMovers({ market: 'mx', kind: 'active', limit: 5 })],
    ['mercado de amplitud', () => getBreadth({ market: /** @type {any} */ ('eu') })],
    ['mercado de sectores', () => getSectors(/** @type {any} */ ({}))],
    ['mes del INPC', () => getUpdateFactor({ from: '2025-1', to: '2026-08' })],
    ['meses al revés', () => getUpdateFactor({ from: '2026-08', to: '2025-01' })],
    ['mercado de industrias en minúsculas', () => getIndustries({ market: /** @type {any} */ ('us') })],
    ['años de salud financiera', () => getCreditHealth('AAPL', { years: /** @type {any} */ (10) })],
  ])('%s: 400 sin salir a la red', async (_, call) => {
    const f = installFetch([])
    await expect(call()).rejects.toMatchObject({ status: 400 })
    expect(f.calls).toHaveLength(0)
  })

  it('isValidOhlc adelanta las combinaciones que el API contesta con 400', () => {
    expect(isValidOhlc('1mo', '5m')).toBe(true)
    expect(isValidOhlc('6mo', '5m')).toBe(false)
    expect(isValidOhlc('1y', '1h')).toBe(true)
    expect(isValidOhlc('max', '1h')).toBe(false)
    expect(isValidOhlc('max', '1mo')).toBe(true)
    expect(isValidOhlc('2y', '1d')).toBe(false)
  })
})
