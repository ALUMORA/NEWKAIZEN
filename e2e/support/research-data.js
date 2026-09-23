// Respuestas v2 simuladas de la ficha de emisora (F3), compartidas por research.spec.js y
// shell.spec.js: la paleta abre /investigar/:symbol y esa página pide estos endpoints.
export const meta = (over = {}) => ({
  asOf: '2026-09-22T14:40:00Z',
  source: 'yahoo',
  delayMinutes: 15,
  stale: false,
  fallback: false,
  generatedAt: '2026-09-22T14:52:00Z',
  notes: [],
  ...over,
})

export const item = (symbol, label, price, change, changePct, currency) => ({ symbol, label, price, change, changePct, currency, asOf: '2026-09-22T14:40:00Z' })
export const exchange = { open: true, label: 'Abierta', nextOpen: null, nextClose: '2026-09-22T20:00:00Z' }
export const OVERVIEW = {
  groups: [
    { id: 'mx', label: 'México', items: [item('^MXX', 'S&P/BMV IPC', 61234.52, 297.1, 0.00487, 'MXN')] },
    { id: 'us', label: 'Estados Unidos', items: [item('^GSPC', 'S&P 500', 6650.12, -19.9, -0.00298, 'USD')] },
    { id: 'fx', label: 'Divisas', items: [item('USDMXN=X', 'Dólar frente al peso', 18.4321, 0.0496, 0.0027, 'MXN')] },
  ],
  marketStatus: { bmv: exchange, nyse: exchange },
  meta: meta(),
}
export const RATES = {
  items: [{ id: 'cetes28', label: 'CETES 28 días', value: 0.0725, unit: 'fraction', asOf: '2026-09-18', seriesId: 'SF43936', source: 'banxico', previous: 0.073, changeBp: -5 }],
  meta: meta({ asOf: '2026-09-18', source: 'banxico', delayMinutes: null }),
}

/** Fechas hábiles hacia atrás desde el 22 sep 2026. */
export function dates(n) {
  const out = []
  const d = new Date(Date.UTC(2026, 8, 22))
  while (out.length < n) {
    const day = d.getUTCDay()
    if (day !== 0 && day !== 6) out.unshift(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() - 1)
  }
  return out
}
export const DATES = dates(60)
export const walk = (start, drift) => DATES.map((_, i) => Math.round((start * (1 + drift * i + 0.01 * Math.sin(i / 3))) * 100) / 100)

export const INSTRUMENT = {
  symbol: 'WALMEX.MX',
  name: 'Wal-Mart de México',
  exchange: 'BMV',
  type: 'equity',
  sector: 'Consumo básico',
  industry: 'Tiendas de autoservicio',
  country: 'México',
  description: 'Opera tiendas de autoservicio y clubes de precio en México y Centroamérica.',
  website: null,
  priceCurrency: 'MXN',
  financialCurrency: 'MXN',
  fxUsed: null,
  quote: { price: 61.23, previousClose: 60.8, change: 0.43, changePct: 0.00707, dayLow: 60.5, dayHigh: 61.5, low52w: 51.2, high52w: 72.4, volume: 1.2e7, avgVolume: 1.5e7, marketCap: 1.07e12, asOf: '2026-09-22T14:40:00Z' },
  fundamentals: { pe: 21.4, forwardPe: 19.8, pb: 5.2, ps: 1.1, evEbitda: 11.3, pfcf: 24.1, earningsYield: 0.0467, fcfYield: 0.041, dividendYield: 0.052, payoutRatio: 0.9, roe: 0.26, roa: 0.11, grossMargin: 0.23, operatingMargin: 0.084, netMargin: 0.056, revenueGrowthYoY: 0.08, epsGrowthYoY: -0.03, debtToEquity: 0.42, netDebtToEbitda: 0.3, currentRatio: 0.9, enterpriseValue: 1.1e12, sharesOutstanding: 1.746e10 },
  beta: { value: 0.72, adjusted: 0.81, benchmark: '^MXX', currency: 'MXN', window: '5y', observations: 260, source: 'computed' },
  sectorMedians: null,
  coverage: { available: 21, total: 22 },
  meta: meta(),
}
export const history = (symbol, start) => ({ symbol, currency: 'MXN', interval: '1d', adjusted: true, dates: DATES, close: walk(start, 0.002), fx: null, meta: meta({ asOf: '2026-09-22' }) })
export const STATEMENTS = {
  symbol: 'WALMEX.MX',
  currency: 'MXN',
  freq: 'annual',
  source: 'yahoo',
  periods: [
    { end: '2023-12-31', fiscalYear: 2023, fiscalQuarter: null, form: null },
    { end: '2024-12-31', fiscalYear: 2024, fiscalQuarter: null, form: null },
    { end: '2025-12-31', fiscalYear: 2025, fiscalQuarter: null, form: null },
  ],
  rows: [
    { id: 'revenue', label: 'Ingresos', values: [8.8e11, 9.6e11, 1.04e12] },
    { id: 'netIncome', label: 'Utilidad neta', values: [5.2e10, 5.5e10, null] },
    { id: 'eps', label: 'Utilidad por acción', values: [2.98, 3.15, 3.02] },
  ],
  meta: meta({ asOf: '2025-12-31', delayMinutes: null }),
}
export const VALUATION = {
  symbol: 'WALMEX.MX',
  currency: 'MXN',
  assumptions: { rf: 0.095, erp: 0.055, crp: 0.02, lambda: 1, taxRate: 0.3, terminalGrowth: 0.035, source: 'banxico', asOf: '2026-09-18' },
  multiples: {
    applicable: true,
    reason: null,
    market: 'EM',
    source: 'damodaran',
    asOf: '2026-01-05',
    methods: [
      { id: 'pe', label: 'P/U', current: 21.4, benchmark: 18.2, impliedPrice: 52.1, applicable: true },
      { id: 'evEbitda', label: 'VE/EBITDA', current: 11.3, benchmark: 9.8, impliedPrice: 53.4, applicable: true },
    ],
    fairValueRange: { low: 52.1, mid: 52.8, high: 53.4 },
  },
  dcf: {
    applicable: true,
    reason: null,
    inputs: { fcff0: 4.1e10, growth: 0.07, years: 5, terminalGrowth: 0.035, betaU: 0.6, betaL: 0.72, debtToEquity: 0.42, taxRate: 0.3, costOfEquity: 0.155, costOfDebt: 0.1, wacc: 0.128, currency: 'MXN' },
    projection: [{ year: 1, fcff: 4.4e10, discountFactor: 0.887, pv: 3.9e10 }],
    terminalValue: 5.1e11,
    pvTerminal: 2.8e11,
    tvShare: 0.62,
    enterpriseValue: 4.6e11,
    netDebt: 2e10,
    minorityInterest: 0,
    equityValue: 4.4e11,
    sharesOutstanding: 1.746e10,
    perShare: 25.2,
    sensitivity: { waccs: [0.118, 0.128, 0.138], growths: [0.025, 0.035, 0.045], grid: [[27.1, 28.9, 31.2], [23.9, 25.2, 26.8], [21.4, 22.4, 23.6], ] },
    warnings: ['El valor terminal pesa 62% del total: el resultado depende mucho del crecimiento de largo plazo.'],
  },
  bank: null,
  meta: meta({ source: 'computed', delayMinutes: null }),
}
export const MOMENTUM = { symbol: 'WALMEX.MX', currency: 'MXN', benchmark: '^MXX', r12m1: -0.084, r6m: 0.031, r3m: 0.012, benchmarkR12m1: 0.052, relative12m1: -0.136, meta: meta({ source: 'computed', delayMinutes: null }) }
export const DIVIDENDS = {
  symbol: 'WALMEX.MX',
  currency: 'MXN',
  ttm: 3.18,
  yield: 0.052,
  history: [
    { date: '2025-11-19', amount: 0.87 },
    { date: '2026-04-15', amount: 1.44 },
    { date: '2026-08-20', amount: 0.87 },
  ],
  meta: meta({ asOf: '2026-08-20', delayMinutes: null }),
}
export const NEWS = {
  items: [{ id: 'n1', title: 'Walmex reporta ventas mismas tiendas de agosto', url: 'https://example.com/n1', source: 'El Economista', publishedAt: '2026-09-21T13:00:00Z', summary: null, lang: 'es', tone: null }],
  meta: meta({ source: 'rss', delayMinutes: null }),
}

/** PanelResponse: precios alineados por fecha. */
export const panel = (symbols) => ({
  currency: 'MXN',
  interval: '1d',
  dates: DATES,
  prices: Object.fromEntries(symbols.map((s, i) => [s, walk(50 + 20 * i, i % 2 ? -0.001 : 0.003)])),
  dropped: [],
  meta: meta({ asOf: '2026-09-22', delayMinutes: null }),
})

export const RESEARCH_ROUTES = {
  'GET /v2/markets/overview': { json: OVERVIEW },
  'GET /v2/rates/mx': { json: RATES },
  'GET /v2/search': { json: { results: [], meta: meta() } },
  'GET /v2/instrument/:symbol': { json: INSTRUMENT },
  'GET /v2/instrument/:symbol/statements': { json: STATEMENTS },
  'GET /v2/instrument/:symbol/dividends': { json: DIVIDENDS },
  'GET /v2/history/:symbol': ({ params }) => ({ json: history(decodeURIComponent(params.symbol), 60) }),
  'GET /v2/valuation/:symbol': { json: VALUATION },
  'GET /v2/momentum/:symbol': { json: MOMENTUM },
  'GET /v2/news': { json: NEWS },
  'GET /v2/panel': ({ url }) => ({ json: panel(String(url.searchParams.get('symbols') ?? '').split(',')) }),
}
