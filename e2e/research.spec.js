// Investigar (F3): ficha de la emisora y comparador, con respuestas v2 simuladas con la forma de
// kaizen_api/schemas.py. Corre en desktop (1440x900) y mobile (390x844). La fixture `guards` tumba
// la prueba ante cualquier console.error, excepción, request fallido o respuesta >= 400.
//
// Capturas para revisión: con F3_CAPTURE_DIR=/ruta la prueba "capturas" guarda cada página.
import AxeBuilder from '@axe-core/playwright'
import { test, expect } from './support/guards.js'
import { HEALTH_V2, setupApp } from './support/app.js'

const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']
const THEMES = /** @type {const} */ (['light', 'dark'])
const CAPTURE_DIR = process.env.F3_CAPTURE_DIR ?? ''

const HEALTH = { ...HEALTH_V2, capabilities: [...HEALTH_V2.capabilities, 'markets.overview'] }

const meta = (over = {}) => ({
  asOf: '2026-09-22T14:40:00Z',
  source: 'yahoo',
  delayMinutes: 15,
  stale: false,
  fallback: false,
  generatedAt: '2026-09-22T14:52:00Z',
  notes: [],
  ...over,
})

const item = (symbol, label, price, change, changePct, currency) => ({ symbol, label, price, change, changePct, currency, asOf: '2026-09-22T14:40:00Z' })
const exchange = { open: true, label: 'Abierta', nextOpen: null, nextClose: '2026-09-22T20:00:00Z' }
const OVERVIEW = {
  groups: [
    { id: 'mx', label: 'México', items: [item('^MXX', 'S&P/BMV IPC', 61234.52, 297.1, 0.00487, 'MXN')] },
    { id: 'us', label: 'Estados Unidos', items: [item('^GSPC', 'S&P 500', 6650.12, -19.9, -0.00298, 'USD')] },
    { id: 'fx', label: 'Divisas', items: [item('USDMXN=X', 'Dólar frente al peso', 18.4321, 0.0496, 0.0027, 'MXN')] },
  ],
  marketStatus: { bmv: exchange, nyse: exchange },
  meta: meta(),
}
const RATES = {
  items: [{ id: 'cetes28', label: 'CETES 28 días', value: 0.0725, unit: 'fraction', asOf: '2026-09-18', seriesId: 'SF43936', source: 'banxico', previous: 0.073, changeBp: -5 }],
  meta: meta({ asOf: '2026-09-18', source: 'banxico', delayMinutes: null }),
}

/** Fechas hábiles hacia atrás desde el 22 sep 2026. */
function dates(n) {
  const out = []
  const d = new Date(Date.UTC(2026, 8, 22))
  while (out.length < n) {
    const day = d.getUTCDay()
    if (day !== 0 && day !== 6) out.unshift(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() - 1)
  }
  return out
}
const DATES = dates(60)
const walk = (start, drift) => DATES.map((_, i) => Math.round((start * (1 + drift * i + 0.01 * Math.sin(i / 3))) * 100) / 100)

const INSTRUMENT = {
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
const history = (symbol, start) => ({ symbol, currency: 'MXN', interval: '1d', adjusted: true, dates: DATES, close: walk(start, 0.002), fx: null, meta: meta({ asOf: '2026-09-22' }) })
const STATEMENTS = {
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
const VALUATION = {
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
const MOMENTUM = { symbol: 'WALMEX.MX', currency: 'MXN', benchmark: '^MXX', r12m1: -0.084, r6m: 0.031, r3m: 0.012, benchmarkR12m1: 0.052, relative12m1: -0.136, meta: meta({ source: 'computed', delayMinutes: null }) }
const DIVIDENDS = {
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
const NEWS = {
  items: [{ id: 'n1', title: 'Walmex reporta ventas mismas tiendas de agosto', url: 'https://example.com/n1', source: 'El Economista', publishedAt: '2026-09-21T13:00:00Z', summary: null, lang: 'es', tone: null }],
  meta: meta({ source: 'rss', delayMinutes: null }),
}

/** PanelResponse: precios alineados por fecha. */
const panel = (symbols) => ({
  currency: 'MXN',
  interval: '1d',
  dates: DATES,
  prices: Object.fromEntries(symbols.map((s, i) => [s, walk(50 + 20 * i, i % 2 ? -0.001 : 0.003)])),
  dropped: [],
  meta: meta({ asOf: '2026-09-22', delayMinutes: null }),
})

const V2_ROUTES = {
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

async function open(page, baseURL, { theme, routes = {} } = {}) {
  await setupApp(page, { baseURL, session: true, health: HEALTH, routes: { ...V2_ROUTES, ...routes } })
  if (theme) await page.addInitScript((t) => window.localStorage.setItem('kaizen_theme', t), theme)
}

async function settleAnimations(page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => null)),
    ),
  )
}

async function expectNoAxeViolations(page, context) {
  await settleAnimations(page)
  const results = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze()
  const detail = results.violations
    .map((v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.map((n) => n.target.join(' ')).slice(0, 6).join('\n    ')}`)
    .join('\n')
  expect(results.violations, `${context}:\n${detail}`).toEqual([])
}

async function noHorizontalScroll(page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }))
  expect(scrollWidth, 'la página no se desplaza a lo ancho').toBeLessThanOrEqual(innerWidth)
}

/** La ficha terminó de cargar sus bloques. */
async function instrumentReady(page) {
  await expect(page.getByRole('heading', { level: 1, name: 'Wal-Mart de México (WALMEX.MX)' })).toBeVisible()
  await expect(page.getByRole('figure', { name: /Precio de Wal-Mart/ })).toBeVisible()
  await expect(page.getByRole('table', { name: /Malla de sensibilidad/ })).toBeVisible()
  await expect(page.getByRole('table', { name: 'Estados financieros anuales' })).toBeAttached()
  await expect(page.getByText('Walmex reporta ventas')).toBeVisible()
}

/** El comparador terminó de cargar. */
async function compareReady(page) {
  await expect(page.getByRole('heading', { level: 1, name: 'Comparar emisoras' })).toBeVisible()
  await expect(page.getByRole('figure', { name: 'Precio en base 100' })).toBeVisible()
  await expect(page.getByRole('table', { name: 'Múltiplos y rentabilidad lado a lado' }).getByText('21.4x').first()).toBeVisible()
  await expect(page.getByRole('table', { name: 'Rendimiento de cada emisora en el periodo' })).toBeVisible()
}

const PAGES = [
  { path: '/investigar/WALMEX.MX', ready: instrumentReady, name: 'ficha' },
  { path: '/investigar/comparar?symbols=WALMEX.MX,AAPL', ready: compareReady, name: 'comparar' },
]

test.describe('investigar: ficha de la emisora', () => {
  test('muestra precio, historia, valuación con avisos, estados, dividendos y noticias', async ({ page, baseURL }) => {
    await open(page, /** @type {string} */ (baseURL))
    await page.goto('/investigar/WALMEX.MX')
    await instrumentReady(page)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.getByText('El valor terminal pesa 62%')).toBeVisible()
    await expect(page.getByText(/no un precio objetivo/).first()).toBeVisible()
    await expect(page.getByText('−8.40%').first()).toBeVisible()
    await noHorizontalScroll(page)
  })

  test('una sección caída no tumba la ficha', async ({ page, baseURL }) => {
    await open(page, /** @type {string} */ (baseURL), {
      routes: { 'GET /v2/valuation/:symbol': { status: 200, json: { ...VALUATION, dcf: { ...VALUATION.dcf, applicable: false, reason: 'El flujo libre es negativo: el DCF no aplica.' } } } },
    })
    await page.goto('/investigar/WALMEX.MX')
    await expect(page.getByText('El flujo libre es negativo: el DCF no aplica.')).toBeVisible()
    await expect(page.getByText('Walmex reporta ventas')).toBeVisible()
  })
})

test.describe('investigar: comparar', () => {
  test('dos emisoras lado a lado, base 100 y cambio de emisoras', async ({ page, baseURL }) => {
    await open(page, /** @type {string} */ (baseURL))
    await page.goto('/investigar/comparar?symbols=WALMEX.MX,AAPL')
    await compareReady(page)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.getByRole('columnheader', { name: 'AAPL' })).toBeVisible()
    const input = page.getByRole('textbox', { name: 'Claves de las emisoras' })
    await input.fill('WALMEX.MX')
    await page.getByRole('button', { name: 'Comparar' }).click()
    await expect(page.getByText(/Escribe de 2 a 5 claves/).first()).toBeVisible()
    await input.fill('walmex.mx, aapl, msft')
    await page.getByRole('button', { name: 'Comparar' }).click()
    await expect(page).toHaveURL(/symbols=WALMEX\.MX,AAPL,MSFT/)
    await expect(page.getByRole('columnheader', { name: 'MSFT' })).toBeVisible()
    await noHorizontalScroll(page)
  })

  test('sin emisoras pide elegir al menos dos', async ({ page, baseURL }) => {
    await open(page, /** @type {string} */ (baseURL))
    await page.goto('/investigar/comparar')
    await expect(page.getByRole('heading', { level: 2, name: 'Elige al menos dos emisoras' })).toBeVisible()
  })
})

test.describe('investigar: accesibilidad (WCAG 2.1 AA)', () => {
  for (const theme of THEMES) {
    for (const p of PAGES) {
      test(`${p.name} sin violaciones, tema ${theme === 'light' ? 'claro' : 'oscuro'}`, async ({ page, baseURL }) => {
        test.setTimeout(60_000)
        await open(page, /** @type {string} */ (baseURL), { theme })
        await page.goto(p.path)
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        await p.ready(page)
        await noHorizontalScroll(page)
        await expectNoAxeViolations(page, `${p.path}, tema ${theme}`)
      })
    }
  }
})

test.describe('capturas para revisión', () => {
  test.skip(!CAPTURE_DIR, 'sin F3_CAPTURE_DIR')
  for (const p of PAGES) {
    test(`captura ${p.name}`, async ({ page, baseURL }, testInfo) => {
      await open(page, /** @type {string} */ (baseURL), { theme: 'light' })
      await page.goto(p.path)
      await p.ready(page)
      await page.screenshot({ path: `${CAPTURE_DIR}/${p.name}-${testInfo.project.name}.png`, fullPage: true })
    })
  }
})
