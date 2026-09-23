// Páginas nuevas de Mi portafolio (F1). Corre en desktop (1440x900) y mobile (390x844) con las
// respuestas v2 simuladas y el libro sembrado en localStorage (storage v2, llave kaizen:v2).
// La fixture `guards` tumba la prueba ante cualquier console.error, request fallido o >= 400.
import AxeBuilder from '@axe-core/playwright'
import { test, expect } from './support/guards.js'
import { HEALTH_V2, setupApp } from './support/app.js'

const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']
const THEMES = /** @type {const} */ (['light', 'dark'])

const HEALTH = { ...HEALTH_V2, capabilities: [...HEALTH_V2.capabilities, 'markets.overview', 'markets.world'] }

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
    { id: 'us', label: 'Estados Unidos', items: [item('^GSPC', 'S&P 500', 6650.12, -19.9, -0.00298, 'USD'), item('^VIX', 'VIX', 15.21, 0.41, 0.0277, null)] },
    { id: 'fx', label: 'Divisas', items: [item('USDMXN=X', 'Dólar frente al peso', 18.4321, 0.0496, 0.0027, 'MXN')] },
  ],
  marketStatus: { bmv: exchange, nyse: exchange },
  meta: meta(),
}
const RATES = {
  items: [{ id: 'cetes28', label: 'CETES 28 días', value: 0.0725, unit: 'fraction', asOf: '2026-09-18', seriesId: 'SF43936', source: 'banxico', previous: 0.073, changeBp: -5 }],
  meta: meta({ asOf: '2026-09-18', source: 'banxico', delayMinutes: null }),
}
const FX_HISTORY = {
  pair: 'USDMXN',
  dates: ['2026-09-17', '2026-09-18', '2026-09-21'],
  values: [18.35, 18.39, 18.4125],
  source: 'banxico_fix',
  meta: meta({ asOf: '2026-09-21', source: 'banxico_fix', delayMinutes: null }),
}

const V2_ROUTES = {
  'GET /v2/markets/overview': { json: OVERVIEW },
  'GET /v2/rates/mx': { json: RATES },
  'GET /v2/fx/history': { json: FX_HISTORY },
  'GET /v2/search': { json: { results: [], meta: meta({ source: 'kaizen', delayMinutes: null }) } },
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
        tx({ id: 'tx1', type: 'deposit', date: '2026-09-01', amount: 20000 }),
        tx({ id: 'tx2', type: 'buy', date: '2026-09-02', symbol: 'WALMEX.MX', quantity: 100, price: 60 }),
        tx({ id: 'tx3', type: 'buy', date: '2026-09-10', symbol: 'WALMEX.MX', quantity: 100, price: 70 }),
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

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} baseURL
 * @param {{ theme?: 'light' | 'dark', state?: object | null }} [options]
 */
async function open(page, baseURL, { theme, state = STATE } = {}) {
  await setupApp(page, { baseURL, session: true, legacyApi: true, health: HEALTH, routes: V2_ROUTES })
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
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }))
  expect(scrollWidth, 'la página no se desplaza a lo ancho').toBeLessThanOrEqual(innerWidth)
}

const txTable = (page) => page.getByRole('table', { name: 'Movimientos del portafolio' })
const posTable = (page) => page.getByRole('table', { name: 'Posiciones abiertas según el libro' })

test.describe('portafolio: movimientos', () => {
  for (const theme of THEMES) {
    test(`carga con su h1, costo promedio y sin violaciones (${theme})`, async ({ page, baseURL }) => {
      await open(page, baseURL, { theme })
      await page.goto('/portafolio/movimientos')
      await expect(page.getByRole('heading', { level: 1, name: 'Movimientos' })).toBeVisible()
      await expect(page.locator('h1')).toHaveCount(1)
      await expect(txTable(page).getByRole('row')).toHaveCount(4)
      // Dos compras de 100 a 60 y a 70 se integran en 200 títulos a 65.
      const walmex = posTable(page).getByRole('row', { name: /WALMEX\.MX/ })
      await expect(walmex).toContainText('200')
      await expect(walmex).toContainText('65.00')
      await noHorizontalScroll(page)
      await expectNoAxeViolations(page, `movimientos ${theme}`)
    })
  }

  test('alta en USD con tipo de cambio prellenado y clave inválida', async ({ page, baseURL }) => {
    await open(page, baseURL)
    await page.goto('/portafolio/movimientos')
    await page.getByRole('button', { name: 'Agregar movimiento' }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Agregar movimiento' })
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('Fecha').fill('2026-09-21')
    await dialog.getByLabel('Clave de pizarra').fill('WAL MEX')
    await dialog.getByLabel('Cantidad de títulos').fill('5')
    await dialog.getByRole('button', { name: 'Guardar movimiento' }).click()
    await expect(dialog.getByText('Esa clave no es válida')).toBeVisible()

    await dialog.getByLabel('Clave de pizarra').fill('AAPL')
    await dialog.getByLabel('Precio por título').fill('230.50')
    await dialog.getByLabel('Moneda').selectOption('USD')
    await expect(dialog.getByLabel('Tipo de cambio')).toHaveValue(/18\.4125/)
    await expectNoAxeViolations(page, 'diálogo de alta')
    await dialog.getByRole('button', { name: 'Guardar movimiento' }).click()
    await expect(dialog).toBeHidden()
    const row = txTable(page).getByRole('row', { name: /AAPL/ })
    await expect(row).toContainText('USD')
    await expect(row).toContainText('18.4125')
    await expect(posTable(page).getByRole('row', { name: /AAPL/ })).toBeVisible()
  })

  test('borrar con confirmación y Deshacer', async ({ page, baseURL }) => {
    await open(page, baseURL)
    await page.goto('/portafolio/movimientos')
    await expect(txTable(page).getByRole('row')).toHaveCount(4)
    await txTable(page).getByRole('button', { name: /Borrar Compra WALMEX\.MX 10 sep/ }).click()
    const confirm = page.getByRole('alertdialog', { name: '¿Borrar este movimiento?' })
    await confirm.getByRole('button', { name: 'Borrar' }).click()
    await expect(txTable(page).getByRole('row')).toHaveCount(3)
    await page.getByRole('button', { name: 'Deshacer' }).click()
    await expect(txTable(page).getByRole('row')).toHaveCount(4)
  })

  test('sin portafolio lleva a la bienvenida', async ({ page, baseURL }) => {
    await open(page, baseURL, { state: { ...STATE, portfolios: [], activePortfolioId: null } })
    await page.goto('/portafolio/movimientos')
    await expect(page.getByRole('heading', { level: 1, name: 'Movimientos' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Ir a la bienvenida' })).toHaveAttribute('href', '/bienvenida')
    await noHorizontalScroll(page)
    await expectNoAxeViolations(page, 'movimientos vacío')
  })
})

// Capturas para revisión: con F1_CAPTURE_DIR=/ruta guarda cada página nueva; sin la variable se salta.
test('capturas', async ({ page, baseURL }, testInfo) => {
  const dir = process.env.F1_CAPTURE_DIR ?? ''
  test.skip(!dir, 'sin F1_CAPTURE_DIR')
  await open(page, baseURL)
  await page.goto('/portafolio/movimientos')
  await expect(page.getByRole('heading', { level: 1, name: 'Movimientos' })).toBeVisible()
  await settleAnimations(page)
  await page.screenshot({ path: `${dir}/movimientos-${testInfo.project.name}.png`, fullPage: true })
})
