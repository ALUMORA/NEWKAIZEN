// V5PF: agenda de reportes y dividendos, sección "Qué tiene adentro" de la ficha de un ETF y rayos X
// del portafolio. Corre en desktop (1440x900) y mobile (390x844) con respuestas v2 simuladas con la
// forma de kaizen_api/schemas.py y SOLO las capacidades de V5PF anunciadas (más las de la base).
// La fixture `guards` tumba la prueba ante cualquier console.error, request fallido o >= 400.
import AxeBuilder from '@axe-core/playwright'
import { test, expect } from './support/guards.js'
import { V5_CAPABILITIES, setupApp } from './support/app.js'
import { expectNoHorizontalScroll, readLayoutShift, trackLayoutShift } from './support/layout.js'
import { RESEARCH_ROUTES, INSTRUMENT } from './support/research-data.js'

const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']
// 'events' es de B3a y el servidor real ya la anuncia; la agenda la necesita para /v2/events.
const CAPS = ['events', ...V5_CAPABILITIES.V5PF]
const YAHOO_NOTE = 'Datos de Yahoo Finance obtenidos con yfinance, que según los términos de Yahoo es para uso personal.'

const meta = (over = {}) => ({
  asOf: '2026-09-22',
  source: 'yahoo',
  delayMinutes: null,
  stale: false,
  fallback: false,
  generatedAt: '2026-09-22T14:52:19Z',
  notes: [YAHOO_NOTE],
  ...over,
})

// ─── datos ──────────────────────────────────────────────────────────────────

const EVENTS = {
  items: [
    { symbol: 'WALMEX.MX', type: 'earnings', date: '2026-10-27', estimate: 0.7129, amount: null, currency: 'MXN', estimateLow: 0.7, estimateHigh: 0.734 },
    { symbol: 'AAPL', type: 'earnings', date: '2026-10-29', estimate: 1.9812, amount: null, currency: 'USD', estimateLow: 1.93, estimateHigh: 2.07 },
    { symbol: 'WALMEX.MX', type: 'exDividend', date: '2026-11-17', estimate: null, amount: null, currency: 'MXN', estimateLow: null, estimateHigh: null },
  ],
  dividendSummary: [
    { symbol: 'WALMEX.MX', currency: 'MXN', lastPaidAmount: 0.5, lastPaidDate: '2026-07-15', frequency: 'trimestral', paidMonths: [1, 4, 7, 10] },
    { symbol: 'SPY', currency: 'USD', lastPaidAmount: 1.8, lastPaidDate: '2026-09-19', frequency: 'trimestral', paidMonths: [3, 6, 9, 12] },
    { symbol: 'QQQ', currency: 'USD', lastPaidAmount: null, lastPaidDate: null, frequency: null, paidMonths: [] },
    { symbol: 'AAPL', currency: 'USD', lastPaidAmount: 0.27, lastPaidDate: '2026-08-10', frequency: 'trimestral', paidMonths: [2, 5, 8, 11] },
  ],
  meta: meta({ notes: ['El monto del próximo dividendo no se conoce: el resumen trae el último pagado.', YAHOO_NOTE] }),
}

const season = (universe) => ({
  universe,
  events:
    universe === 'us'
      ? [{ symbol: 'AAPL', name: 'Apple Inc.', date: '2026-10-29', kind: 'earnings', estimateAvg: 1.9812, estimateLow: 1.93, estimateHigh: 2.07, currency: 'USD' }]
      : [
          { symbol: 'AMXB.MX', name: 'América Móvil', date: '2026-10-13', kind: 'earnings', estimateAvg: 0.38, estimateLow: 0.36, estimateHigh: 0.4, currency: 'MXN' },
          { symbol: 'WALMEX.MX', name: 'Wal-Mart de México', date: '2026-10-27', kind: 'earnings', estimateAvg: 0.7129, estimateLow: 0.7, estimateHigh: 0.734, currency: 'MXN' },
        ],
  missing: universe === 'us' ? [] : [{ symbol: 'FEMSAUBD.MX', reason: 'Yahoo no publicó fecha de reporte' }],
  universeSize: universe === 'us' ? 38 : 23,
  meta: meta({ notes: [`Muestra curada de ${universe === 'us' ? 38 : 23} emisoras, no el mercado entero.`, YAHOO_NOTE] }),
})

const SECTORS = {
  SPY: [['Tecnología', 0.3869], ['Servicios financieros', 0.1206], ['Comunicaciones', 0.095], ['Salud', 0.0928]],
  QQQ: [['Tecnología', 0.5915], ['Comunicaciones', 0.127], ['Consumo discrecional', 0.12]],
}
const TOPS = {
  SPY: [['NVDA', 'NVIDIA Corp', 0.0808], ['AAPL', 'Apple Inc', 0.0703], ['MSFT', 'Microsoft Corp', 0.0569], ['AMZN', 'Amazon.com Inc', 0.0384]],
  QQQ: [['NVDA', 'NVIDIA Corp', 0.0851], ['AAPL', 'Apple Inc', 0.0741], ['MSFT', 'Microsoft Corp', 0.06], ['AMD', 'Advanced Micro Devices', 0.0337]],
}
const fund = (symbol) => ({
  symbol,
  mappedFrom: null,
  name: symbol === 'SPY' ? 'State Street SPDR S&P 500 ETF Trust' : 'Invesco QQQ Trust',
  family: symbol === 'SPY' ? 'State Street Investment Management' : 'Invesco',
  category: 'Large Blend',
  legalType: 'Exchange Traded Fund',
  expenseRatio: symbol === 'SPY' ? 0.000945 : 0.002,
  totalNetAssets: symbol === 'SPY' ? 513975.7 : null,
  totalNetAssetsUnit: symbol === 'SPY' ? 'usdMillions' : null,
  turnover: 0.03,
  assetClasses: { stock: 0.9988, bond: 0, cash: 0.0011, other: 0 },
  sectors: SECTORS[symbol].map(([sector, weight]) => ({ sector, weight })),
  topHoldings: TOPS[symbol].map(([s, name, weight]) => ({ symbol: s, name, weight })),
  coverage: { topHoldingsWeight: TOPS[symbol].reduce((a, [, , w]) => a + w, 0) },
  meta: meta(),
})

const NOT_FOUND = { status: 404, json: { error: { code: 'NOT_FOUND', message: 'Yahoo no publica la composición.', details: { reason: 'sin datos de fondo' } } } }

const quote = (symbol, name, price, currency, type) => ({ symbol, name, price, previousClose: price, change: 0, changePct: 0, currency, exchange: currency === 'USD' ? 'NYSE' : 'BMV', type, marketState: 'REGULAR', asOf: '2026-09-22T14:40:00Z' })
const QUOTE_TABLE = {
  'WALMEX.MX': quote('WALMEX.MX', 'Wal-Mart de México', 60, 'MXN', 'equity'),
  SPY: quote('SPY', 'SPDR S&P 500', 660, 'USD', 'etf'),
  QQQ: quote('QQQ', 'Invesco QQQ', 590, 'USD', 'etf'),
}
const QUOTES = ({ url }) => {
  const symbols = (url.searchParams.get('symbols') ?? '').split(',').filter(Boolean)
  return { json: { quotes: symbols.filter((s) => QUOTE_TABLE[s]).map((s) => QUOTE_TABLE[s]), missing: symbols.filter((s) => !QUOTE_TABLE[s]), meta: meta() } }
}

const ROUTES = {
  ...RESEARCH_ROUTES,
  'GET /v2/events': { json: EVENTS },
  'GET /v2/events/season': ({ url }) => ({ json: season(url.searchParams.get('universe') === 'us' ? 'us' : 'mx') }),
  'GET /v2/funds/:symbol': ({ params }) => (TOPS[decodeURIComponent(params.symbol)] ? { json: fund(decodeURIComponent(params.symbol)) } : NOT_FOUND),
  'GET /v2/quotes': QUOTES,
  'GET /v2/fx': { json: { pair: 'USDMXN', rate: 18.0, asOf: '2026-09-22T14:40:00Z', source: 'banxico', stale: false, meta: meta({ source: 'banxico', notes: [] }) } },
}

const tx = (over) => ({ fees: 0, currency: 'MXN', fxRate: null, amount: null, ratio: null, price: null, quantity: null, symbol: null, note: '', ...over })
const STATE = {
  v: 2,
  updatedAt: '2026-09-22T12:00:00.000Z',
  portfolios: [
    {
      id: 'p1',
      name: 'Mi portafolio',
      baseCurrency: 'MXN',
      createdAt: '2026-09-01T12:00:00.000Z',
      transactions: [
        tx({ id: 'tx1', type: 'deposit', date: '2026-09-01', amount: 200000 }),
        tx({ id: 'tx2', type: 'buy', date: '2026-09-02', symbol: 'WALMEX.MX', quantity: 100, price: 60 }),
        tx({ id: 'tx3', type: 'buy', date: '2026-09-03', symbol: 'SPY', quantity: 5, price: 650, currency: 'USD', fxRate: 18.2 }),
        tx({ id: 'tx4', type: 'buy', date: '2026-09-03', symbol: 'QQQ', quantity: 5, price: 580, currency: 'USD', fxRate: 18.2 }),
      ],
      targets: {},
      notes: '',
    },
  ],
  activePortfolioId: 'p1',
  watchlists: [{ id: 'wl1', name: 'Mi lista', symbols: ['AAPL'] }],
  settings: { benchmark: 'NAFTRAC.MX', riskProfile: null, onboardingDone: true },
  migrationReport: null,
  legacyHashes: null,
}

async function open(page, baseURL, { routes = {}, state = STATE, theme } = {}) {
  const api = await setupApp(page, { baseURL, session: true, capabilities: CAPS, routes: { ...ROUTES, ...routes } })
  if (theme) await page.addInitScript((t) => window.localStorage.setItem('kaizen_theme', t), theme)
  if (state) await page.addInitScript((s) => window.localStorage.setItem('kaizen:v2', s), JSON.stringify(state))
  return api
}

async function expectNoAxeViolations(page, context) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze()
  const detail = results.violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.map((n) => n.target.join(' ')).slice(0, 6).join('\n    ')}`).join('\n')
  expect(results.violations, `${context}:\n${detail}`).toEqual([])
}

const ETF_INSTRUMENT = ({ params }) => {
  const symbol = decodeURIComponent(params.symbol)
  const etf = symbol === 'SPY' || symbol === 'NAFTRAC.MX'
  return { json: { ...INSTRUMENT, symbol, name: etf ? `Fondo ${symbol}` : INSTRUMENT.name, type: etf ? 'etf' : 'equity', sector: etf ? null : INSTRUMENT.sector, industry: etf ? null : INSTRUMENT.industry } }
}

test.describe('agenda de reportes y dividendos', () => {
  test('portafolio y lista: calendario, filtro y proyección del último pagado', async ({ page, baseURL }) => {
    await open(page, baseURL)
    await page.goto('/portafolio/agenda')
    await expect(page.getByRole('heading', { level: 1, name: 'Agenda de reportes y dividendos' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Mi portafolio y lista' })).toHaveAttribute('aria-selected', 'true')
    const table = page.getByRole('table', { name: 'Próximos 90 días' })
    await expect(table.getByRole('link', { name: 'WALMEX.MX' }).first()).toBeVisible()
    await expect(table.getByRole('link', { name: 'AAPL' })).toBeVisible()
    await page.getByRole('radio', { name: 'Portafolio', exact: true }).click()
    await expect(table.getByRole('link', { name: 'AAPL' })).toHaveCount(0)
    await expect(page.getByText('Dividendos al año, bruto')).toBeVisible()
    await expect(page.getByRole('table', { name: 'Proyección por emisora' })).toBeVisible()
    await expect(page.getByText(/último pagado/i).first()).toBeVisible()
    await expectNoHorizontalScroll(page)
    await expectNoAxeViolations(page, 'agenda, portafolio')
  })

  test('temporada de reportes con ?universo=us y las emisoras sin dato', async ({ page, baseURL }) => {
    await open(page, baseURL)
    await page.goto('/portafolio/agenda?universo=mx')
    await expect(page.getByRole('tab', { name: 'Temporada de reportes' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('heading', { name: 'Temporada de reportes de México' })).toBeVisible()
    await expect(page.getByText('FEMSAUBD.MX')).toBeVisible()
    await page.getByRole('radio', { name: 'EE. UU.' }).click()
    await expect(page).toHaveURL(/universo=us/)
    await expect(page.getByRole('heading', { name: 'Temporada de reportes de Estados Unidos' })).toBeVisible()
    await expect(page.getByRole('table', { name: 'Temporada de reportes de Estados Unidos' }).getByRole('link', { name: 'AAPL' })).toBeVisible()
    await expectNoHorizontalScroll(page)
    await expectNoAxeViolations(page, 'agenda, temporada')
  })

  test('sin reportes en la ventana muestra el estado vacío', async ({ page, baseURL }) => {
    await open(page, baseURL, { routes: { 'GET /v2/events/season': { json: { ...season('mx'), events: [], missing: [] } } } })
    await page.goto('/portafolio/agenda?universo=mx')
    await expect(page.getByText('Sin reportes en la ventana')).toBeVisible()
  })

  test('la agenda no mueve el layout al cargar (CLS < 0.1)', async ({ page, baseURL }) => {
    await open(page, baseURL, { routes: { 'GET /v2/events': { json: EVENTS, delayMs: 400 } } })
    await trackLayoutShift(page)
    await page.goto('/portafolio/agenda')
    await expect(page.getByText('Dividendos al año, bruto')).toBeVisible()
    await page.waitForTimeout(500)
    expect(await readLayoutShift(page), 'desplazamiento acumulado del layout').toBeLessThan(0.1)
  })
})

test.describe('ETF por dentro', () => {
  test('la ficha de SPY muestra comisión, sectores y las 10 principales', async ({ page, baseURL }) => {
    await open(page, baseURL, { routes: { 'GET /v2/instrument/:symbol': ETF_INSTRUMENT } })
    await page.goto('/investigar/SPY')
    await expect(page.getByRole('heading', { name: 'Qué tiene adentro' })).toBeVisible()
    await expect(page.getByText('0.09%', { exact: true })).toBeVisible()
    await expect(page.getByRole('table', { name: 'Las 10 posiciones principales' }).getByRole('link', { name: 'NVDA' })).toBeVisible()
    await expectNoHorizontalScroll(page)
    await expectNoAxeViolations(page, 'ficha de SPY')
  })

  test('NAFTRAC.MX dice que Yahoo no publica su composición, sin pedirla', async ({ page, baseURL }) => {
    await open(page, baseURL, { routes: { 'GET /v2/instrument/:symbol': ETF_INSTRUMENT } })
    await page.goto('/investigar/NAFTRAC.MX')
    await expect(page.getByText('Sin composición publicada')).toBeVisible()
  })

  test('rayos X: cobertura, sectores, emisoras y traslape entre ETF', async ({ page, baseURL }) => {
    await open(page, baseURL)
    await page.goto('/portafolio/rayos-x')
    await expect(page.getByRole('heading', { level: 1, name: 'Rayos X del portafolio' })).toBeVisible()
    await expect(page.getByText('Cobertura por sector')).toBeVisible()
    await expect(page.getByText(/Cubre \d+%/)).toBeVisible()
    await expect(page.getByText('Traslape entre tus ETF')).toBeVisible()
    await expect(page.getByText(/cota inferior/i).first()).toBeVisible()
    await expect(page.getByRole('table', { name: 'Exposición por emisora' }).getByRole('link', { name: 'AAPL' })).toBeVisible()
    await expectNoHorizontalScroll(page)
    await expectNoAxeViolations(page, 'rayos X')
  })

  test('rayos X sin posiciones invita a registrar compras', async ({ page, baseURL }) => {
    await open(page, baseURL, { state: { ...STATE, portfolios: [{ ...STATE.portfolios[0], transactions: [] }] } })
    await page.goto('/portafolio/rayos-x')
    await expect(page.getByRole('heading', { name: 'Aún no hay posiciones' })).toBeVisible()
  })
})
