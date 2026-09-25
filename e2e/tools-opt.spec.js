// Herramientas (F4, segunda tanda): /herramientas/optimizador y /herramientas/backtest con
// respuestas v2 simuladas (panel semanal en pesos, CETES 28 y búsqueda). Corre en desktop
// (1440x900) y mobile (390x844). La fixture `guards` tumba la prueba ante cualquier console.error,
// excepción, request fallido o respuesta >= 400.
//
// Capturas para revisión: con F4_CAPTURE_DIR=/ruta la prueba "capturas" guarda cada página en los
// dos temas; sin la variable se salta.
import AxeBuilder from '@axe-core/playwright'
import { test as plainTest } from '@playwright/test'
import { test, expect, attachGuards } from './support/guards.js'
import { HEALTH_V2, expectedHttpError, setupApp } from './support/app.js'
import { expectNoHorizontalScroll } from './support/layout.js'

const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']
const THEMES = /** @type {const} */ (['light', 'dark'])
const CAPTURE_DIR = process.env.F4_CAPTURE_DIR ?? ''
const HEALTH = { ...HEALTH_V2, capabilities: [...HEALTH_V2.capabilities, 'markets.overview'] }

const meta = (over = {}) => ({ asOf: '2026-09-22T14:40:00Z', source: 'yahoo', delayMinutes: 15, stale: false, fallback: false, generatedAt: '2026-09-22T14:52:00Z', notes: [], ...over })
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

// ─── Panel semanal sintético: un factor de mercado común más ruido propio, con semilla ───────────

/** Lunes hacia atrás desde el 21 sep 2026. */
function weeks(n) {
  const out = []
  const d = new Date(Date.UTC(2026, 8, 21))
  for (let i = 0; i < n; i += 1) {
    out.unshift(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() - 7)
  }
  return out
}
function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32 - 0.5
  }
}
const PROFILE = {
  'NAFTRAC.MX': { beta: 1, vol: 0, drift: 0.0012, start: 50 },
  SPY: { beta: 0.5, vol: 0.02, drift: 0.0022, start: 7000 },
  'WALMEX.MX': { beta: 0.7, vol: 0.025, drift: 0.0014, start: 60 },
  'AMXB.MX': { beta: 1.1, vol: 0.03, drift: 0.001, start: 15 },
  'GFNORTEO.MX': { beta: 1.3, vol: 0.035, drift: 0.0021, start: 110 },
  AAPL: { beta: 0.9, vol: 0.035, drift: 0.003, start: 2500 },
}
const LENGTH = { '3y': 157, '5y': 261, '10y': 521 }
function panel(symbols, range) {
  const n = LENGTH[range] ?? 261
  const dates = weeks(n)
  const market = rng(7)
  // Uniforme en ±0.5 tiene desviación 0.2887: el factor queda cerca de 2 % semanal.
  const m = dates.map(() => 0.075 * market())
  const prices = {}
  const dropped = []
  for (const s of symbols) {
    const p = PROFILE[s]
    if (!p) {
      dropped.push({ symbol: s, reason: 'sin_historia' })
      continue
    }
    const own = rng(s.length * 97 + s.charCodeAt(0))
    let level = p.start
    prices[s] = dates.map((_, i) => {
      if (i > 0) level *= 1 + p.drift + p.beta * m[i] + p.vol * 3.46 * own()
      return Math.round(level * 10000) / 10000
    })
  }
  return { currency: 'MXN', interval: '1wk', dates, prices, dropped, meta: meta({ asOf: '2026-09-21', delayMinutes: null }) }
}
const RF = (() => {
  const dates = []
  const d = new Date(Date.UTC(2015, 0, 1))
  while (d < new Date(Date.UTC(2026, 8, 19))) {
    dates.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 7)
  }
  return { tenorDays: 28, convention: 'simple_act360', dates, values: dates.map(() => 0.0725), source: 'banxico', fallback: false, meta: meta({ asOf: dates[dates.length - 1], source: 'banxico', delayMinutes: null }) }
})()
const SEARCH = [
  { symbol: 'WALMEX.MX', name: 'Wal-Mart de México', exchange: 'BMV', type: 'equity', currency: 'MXN', aliases: ['walmart'] },
  { symbol: 'AMXB.MX', name: 'América Móvil', exchange: 'BMV', type: 'equity', currency: 'MXN', aliases: ['telcel'] },
  { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', type: 'equity', currency: 'USD', aliases: [] },
]

const V2_ROUTES = {
  'GET /v2/markets/overview': { json: OVERVIEW },
  'GET /v2/rates/mx': { json: RATES },
  'GET /v2/rates/rf': { json: RF },
  'GET /v2/panel': ({ url }) => ({ json: panel(String(url.searchParams.get('symbols') ?? '').split(','), url.searchParams.get('range') ?? '5y') }),
  'GET /v2/search': ({ url }) => {
    const q = String(url.searchParams.get('q') ?? '').toLowerCase()
    const results = SEARCH.filter((r) => r.symbol.toLowerCase().includes(q) || r.name.toLowerCase().includes(q) || r.aliases.some((a) => a.includes(q)))
    return { json: { results, meta: meta({ source: 'kaizen', delayMinutes: null }) } }
  },
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
        tx({ id: 'tx1', type: 'deposit', date: '2026-09-01', amount: 50000 }),
        tx({ id: 'tx2', type: 'buy', date: '2026-09-02', symbol: 'WALMEX.MX', quantity: 200, price: 60 }),
        tx({ id: 'tx3', type: 'buy', date: '2026-09-03', symbol: 'AMXB.MX', quantity: 800, price: 15 }),
        tx({ id: 'tx4', type: 'buy', date: '2026-09-04', symbol: 'GFNORTEO.MX', quantity: 50, price: 110 }),
      ],
      targets: {},
      notes: '',
    },
  ],
  activePortfolioId: 'p1',
  watchlists: [],
  settings: { benchmark: 'NAFTRAC.MX', riskProfile: null, onboardingDone: true },
  migrationReport: null,
  legacyHashes: null,
}
const EMPTY_STATE = { ...STATE, portfolios: [], activePortfolioId: null }

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} baseURL
 * @param {{ theme?: 'light' | 'dark', state?: object | null, routes?: Record<string, any> }} [options]
 */
async function open(page, baseURL, { theme, state = STATE, routes = {} } = {}) {
  await setupApp(page, { baseURL, session: true, health: HEALTH, routes: { ...V2_ROUTES, ...routes } })
  if (theme) await page.addInitScript((t) => window.localStorage.setItem('kaizen_theme', t), theme)
  if (state) await page.addInitScript((s) => window.localStorage.setItem('kaizen:v2', s), JSON.stringify(state))
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
  await expectNoHorizontalScroll(page)
}

/** El optimizador terminó de calcular. */
async function optimizerReady(page) {
  await expect(page.getByRole('heading', { level: 1, name: 'Optimizador de portafolio' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Tres carteras con los mismos supuestos' })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('figure', { name: 'Frontera eficiente' })).toBeVisible()
  await expect(page.getByRole('table', { name: 'Walk forward contra toda la historia' })).toBeVisible()
}

/** El backtest terminó de correr. */
async function backtestReady(page) {
  await expect(page.getByRole('heading', { level: 1, name: 'Backtest' })).toBeVisible()
  const result = page.getByRole('region', { name: 'Resultado' })
  await expect(result.getByRole('table', { name: 'Métricas contra el referente' })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('figure', { name: 'Crecimiento de 1 peso' })).toBeVisible()
  await expect(page.getByRole('figure', { name: 'Caídas desde el máximo' })).toBeVisible()
}

const PAGES = [
  { path: '/herramientas/optimizador', ready: optimizerReady, name: 'optimizador' },
  { path: '/herramientas/backtest', ready: backtestReady, name: 'backtest' },
]

test.describe('herramientas: optimizador', () => {
  test('arranca con las emisoras del portafolio: tres carteras, frontera, walk forward e insumos', async ({ page, baseURL }) => {
    await open(page, /** @type {string} */ (baseURL))
    await page.goto('/herramientas/optimizador')
    await optimizerReady(page)
    await expect(page).toHaveTitle('Optimizador · Kaizen')
    await expect(page.locator('h1')).toHaveCount(1)
    await expect(page.getByRole('list', { name: '3 de 20 emisoras elegidas' }).getByRole('listitem')).toHaveCount(3)
    const weights = page.getByRole('table', { name: 'Pesos por cartera' })
    await expect(weights.getByRole('columnheader', { name: 'Tu cartera hoy' })).toBeVisible()
    await expect(weights.getByRole('row')).toHaveCount(4)
    const wf = page.getByRole('table', { name: 'Walk forward contra toda la historia' })
    await expect(wf.getByRole('row')).toHaveCount(5)
    await expect(page.getByText(/cortes de 13 semanas/)).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Notas de convergencia' })).toBeVisible()
    await expect(page.getByRole('table', { name: 'Insumos por emisora' })).toBeAttached()
    await expect(page.getByRole('link', { name: 'Lee la metodología del optimizador' })).toHaveAttribute('href', '/aprender/metodologia/optimizador')
    await noHorizontalScroll(page)
  })

  test('sin portafolio pide dos emisoras; se agregan con la búsqueda y con la clave', async ({ page, baseURL }) => {
    await open(page, /** @type {string} */ (baseURL), { state: EMPTY_STATE })
    await page.goto('/herramientas/optimizador')
    await expect(page.getByRole('heading', { name: 'Elige al menos dos emisoras' })).toBeVisible()
    const search = page.getByRole('textbox', { name: 'Agregar emisora' })
    await search.fill('wal')
    await page.getByRole('button', { name: /WALMEX\.MX.*agregar/ }).click()
    await expect(page).toHaveURL(/symbols=WALMEX\.MX$/)
    await search.fill('aapl')
    await search.press('Enter')
    await expect(page).toHaveURL(/symbols=WALMEX\.MX(%2C|,)AAPL/)
    await optimizerReady(page)
    await expect(page.getByRole('table', { name: 'Pesos por cartera' }).getByRole('columnheader', { name: 'Tu cartera hoy' })).toHaveCount(0)
    await search.fill('aapl')
    await search.press('Enter')
    await expect(page.getByText('AAPL ya está en la lista.')).toBeVisible()
    await page.getByRole('button', { name: 'Quitar AAPL' }).click()
    await expect(page.getByRole('heading', { name: 'Elige al menos dos emisoras' })).toBeVisible()
  })

  test('supuestos: sin prima no hay máximo Sharpe, James y Stein y una caja imposible', async ({ page, baseURL }) => {
    await open(page, /** @type {string} */ (baseURL))
    await page.goto('/herramientas/optimizador?symbols=WALMEX.MX,AMXB.MX')
    await optimizerReady(page)
    await page.getByLabel('Prima de riesgo de mercado', { exact: true }).fill('0')
    await expect(page.getByText(/así que no hay cartera de máximo Sharpe/)).toBeVisible()
    await page.getByRole('radio', { name: 'James y Stein' }).check()
    await expect(page.getByRole('region', { name: 'Tres carteras con los mismos supuestos' })).toContainText('Rendimientos esperados por James y Stein')
    await expect(page.getByLabel('Prima de riesgo de mercado', { exact: true })).toBeDisabled()
    await page.getByLabel('Peso máximo', { exact: true }).fill('30')
    await expect(page.getByText('Con 2 emisoras el máximo tiene que ser de al menos 50 %, para que los pesos sumen 100 %.')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Revisa los supuestos marcados' })).toBeVisible()
    await page.getByLabel('Peso máximo', { exact: true }).fill('60')
    await expect(page.getByRole('region', { name: 'Tres carteras con los mismos supuestos' })).toBeVisible()
    await page.getByRole('radio', { name: 'Muestral' }).check()
    await expect(page.getByText(/la muestral cruda exagera/)).toBeVisible()
    await expect(page.getByText('No aplica')).toBeVisible()
  })

  test('una emisora sin historia se avisa y el resto se optimiza', async ({ page, baseURL }) => {
    await open(page, /** @type {string} */ (baseURL))
    await page.goto('/herramientas/optimizador?symbols=WALMEX.MX,AMXB.MX,NOPE.MX')
    await optimizerReady(page)
    await expect(page.getByText('Sin historia suficiente en estas fechas, quedaron fuera: NOPE.MX.')).toBeVisible()
    await expect(page.getByRole('table', { name: 'Pesos por cartera' }).getByRole('row')).toHaveCount(3)
  })
})

test.describe('herramientas: backtest', () => {
  test('con tu cartera: aviso de pesos de hoy, CAGR, métricas contra el IPC y las dos gráficas', async ({ page, baseURL }) => {
    await open(page, /** @type {string} */ (baseURL))
    await page.goto('/herramientas/backtest')
    await backtestReady(page)
    await expect(page).toHaveTitle('Backtest · Kaizen')
    await expect(page.locator('h1')).toHaveCount(1)
    await expect(page.getByRole('radio', { name: 'Mi cartera hoy' })).toBeChecked()
    await expect(page.getByText('Pesos de hoy sobre historia anterior.')).toBeVisible()
    await expect(page.getByRole('radio', { name: 'Comprar y mantener' })).toBeChecked()
    const metrics = page.getByRole('table', { name: 'Métricas contra el referente' })
    await expect(metrics.getByRole('columnheader', { name: 'Tu cartera' })).toBeVisible()
    await expect(metrics.getByRole('columnheader', { name: 'IPC' })).toBeVisible()
    await expect(metrics.getByRole('row')).toHaveCount(12)
    const result = page.getByRole('region', { name: 'Resultado' })
    await expect(result.getByText(/260 semanas, del/)).toBeVisible()
    await expect(result.getByText('contra el referente', { exact: true })).toBeVisible()
    await expect(result.getByText('Sobre CETES 28 de cada semana.')).toBeVisible()
    await expect(page.getByRole('table', { name: 'Pesos al inicio' }).getByRole('row')).toHaveCount(4)
    await expect(page.getByRole('link', { name: 'Lee la metodología del backtest' })).toHaveAttribute('href', '/aprender/metodologia/backtest')
    await noHorizontalScroll(page)
  })

  test('pesos a mano, mezcla constante, otro referente y otro periodo', async ({ page, baseURL }) => {
    await open(page, /** @type {string} */ (baseURL))
    await page.goto('/herramientas/backtest')
    await backtestReady(page)
    await page.getByRole('radio', { name: 'Los escribo yo' }).check()
    await expect(page.getByText('Pesos de hoy sobre historia anterior.')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Elige qué probar' })).toBeVisible()
    const search = page.getByRole('textbox', { name: 'Agregar emisora' })
    await search.fill('WALMEX.MX')
    await search.press('Enter')
    await search.fill('AAPL')
    await search.press('Enter')
    await expect(page.getByLabel('Peso de AAPL', { exact: true })).toHaveValue('50')
    await backtestReady(page)
    await expect(page.getByRole('table', { name: 'Métricas contra el referente' }).getByRole('columnheader', { name: 'Tu mezcla' })).toBeVisible()
    await page.getByLabel('Peso de AAPL', { exact: true }).fill('30')
    await expect(page.getByText('Los pesos suman 80 % y tienen que sumar 100 %.')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Revisa los pesos' })).toBeVisible()
    await page.getByRole('button', { name: 'Repartir parejo' }).click()
    await backtestReady(page)
    await page.getByRole('radio', { name: 'Mezcla constante' }).check()
    await expect(page.getByLabel('Regresar a los pesos', { exact: true })).toHaveValue('monthly')
    await expect(page.getByText('Rotación anual')).toBeVisible()
    await page.getByLabel('Referente', { exact: true }).selectOption('spx')
    await expect(page.getByRole('table', { name: 'Métricas contra el referente' }).getByRole('columnheader', { name: 'S&P 500', exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Resultado' }).getByText(/Referente: S&P 500 en pesos\./)).toBeVisible()
    await page.getByLabel('Referente', { exact: true }).selectOption('blend')
    await page.getByLabel('Parte del IPC en la mezcla', { exact: true }).fill('70')
    await expect(page.getByRole('table', { name: 'Métricas contra el referente' }).getByRole('columnheader', { name: 'Mezcla', exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Resultado' }).getByText(/Referente: Mezcla: 70 % IPC y 30 % S&P 500\./)).toBeVisible()
    await page.getByRole('radio', { name: '10 años' }).check()
    await expect(page.getByRole('region', { name: 'Resultado' }).getByText(/520 semanas, del/)).toBeVisible()
    await noHorizontalScroll(page)
  })

  test('una emisora sin historia se avisa y el resto se reescala', async ({ page, baseURL }) => {
    await open(page, /** @type {string} */ (baseURL), { state: EMPTY_STATE })
    await page.goto('/herramientas/backtest?symbols=WALMEX.MX,NOPE.MX')
    await backtestReady(page)
    await expect(page.getByRole('radio', { name: 'Mi cartera hoy' })).toBeDisabled()
    await expect(page.getByText(/quedaron fuera: NOPE\.MX\. Los demás pesos se reescalaron/)).toBeVisible()
    await expect(page.getByRole('table', { name: 'Pesos al inicio' }).getByRole('row')).toHaveCount(2)
  })
})

// Sin la fixture automática: la serie de CETES falla a propósito y la página sigue con la tasa escrita.
plainTest('herramientas: sin CETES se avisa y se puede escribir la tasa', async ({ page, baseURL }) => {
  const guards = attachGuards(page, { allow: expectedHttpError(503, 'GET', '/v2/rates/rf', 'la prueba tumba la serie de CETES') })
  const down = { status: 503, json: { error: { code: 'UPSTREAM_UNAVAILABLE', message: 'Banxico no responde. Intenta en unos minutos.' } } }
  await open(page, /** @type {string} */ (baseURL), { routes: { 'GET /v2/rates/rf': down } })
  await page.goto('/herramientas/optimizador')
  await expect(page.getByText('No pudimos traer la tasa de CETES')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('No llegó la tasa de CETES. Escribe una para seguir.')).toBeVisible()
  await page.getByLabel('Tasa libre de riesgo anual', { exact: true }).fill('8')
  await optimizerReady(page)
  await expect(page.getByText(/tasa libre de riesgo de 8.00%/)).toBeVisible()
  guards.assertClean()
})

test.describe('herramientas: accesibilidad (WCAG 2.1 AA)', () => {
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
  test.skip(!CAPTURE_DIR, 'solo con F4_CAPTURE_DIR')
  for (const theme of THEMES) {
    for (const p of PAGES) {
      test(`captura ${p.name}, tema ${theme === 'light' ? 'claro' : 'oscuro'}`, async ({ page, baseURL }, testInfo) => {
        test.setTimeout(60_000)
        await open(page, /** @type {string} */ (baseURL), { theme })
        await page.goto(p.path)
        await p.ready(page)
        await settleAnimations(page)
        // En captura de página completa la barra inferior fija se pintaría a media página.
        await page.addStyleTag({ content: '.kz-bottom { visibility: hidden !important; }' })
        await page.screenshot({ path: `${CAPTURE_DIR}/${p.name}-${testInfo.project.name}-${theme}.png`, fullPage: true })
      })
    }
  }
})
