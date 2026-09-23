// Páginas nuevas de Mi portafolio (F1). Corre en desktop (1440x900) y mobile (390x844) con las
// respuestas v2 simuladas y el libro sembrado en localStorage (storage v2, llave kaizen:v2).
// La fixture `guards` tumba la prueba ante cualquier console.error, request fallido o >= 400.
import { readFile } from 'node:fs/promises'
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

const quote = (symbol, name, price) => ({ symbol, name, price, previousClose: price, change: 0, changePct: 0, currency: 'MXN', exchange: 'BMV', type: 'equity', marketState: 'REGULAR', asOf: '2026-09-22T14:40:00Z' })
const QUOTE_TABLE = {
  'WALMEX.MX': { ...quote('WALMEX.MX', 'Walmex', 65), previousClose: 64, change: 1, changePct: 1 / 64 },
  'NAFTRAC.MX': { ...quote('NAFTRAC.MX', 'Naftrac', 55.2), previousClose: 55.5, change: -0.3, changePct: -0.3 / 55.5 },
  'AMXB.MX': quote('AMXB.MX', 'América Móvil', 18.5),
  AAPL: { ...quote('AAPL', 'Apple', 240), previousClose: 238, change: 2, changePct: 2 / 238, currency: 'USD', exchange: 'NASDAQ' },
}
/** QuotesResponse con lo que se pidió: lo que no está en la tabla sale en `missing`. */
const QUOTES = ({ url }) => {
  const symbols = (url.searchParams.get('symbols') ?? '').split(',').filter(Boolean)
  return { json: { quotes: symbols.filter((s) => QUOTE_TABLE[s]).map((s) => QUOTE_TABLE[s]), missing: symbols.filter((s) => !QUOTE_TABLE[s]), meta: meta() } }
}

// PanelResponse: 12 semanas de precios en pesos, sin rellenar.
const weeks = Array.from({ length: 12 }, (_, i) => `2026-${String(7 + Math.floor(i / 4)).padStart(2, '0')}-${String(1 + (i % 4) * 7).padStart(2, '0')}`)
const walk = (start, steps) => steps.map((_, i) => Math.round(start * (1 + 0.01 * Math.sin(i * 1.3) + 0.002 * i) * 100) / 100)
const PANEL = {
  currency: 'MXN',
  interval: '1wk',
  dates: weeks,
  prices: {
    'WALMEX.MX': walk(62, weeks),
    'NAFTRAC.MX': walk(55, weeks).map((v, i) => Math.round((v * (1 + 0.004 * Math.cos(i))) * 100) / 100),
    '^MXX': walk(60000, weeks),
    '^GSPC': walk(120000, weeks).map((v, i) => Math.round(v * (1 + 0.006 * Math.cos(i * 0.7)))),
  },
  dropped: [],
  meta: meta({ asOf: '2026-09-19', delayMinutes: null }),
}

const V2_ROUTES = {
  'GET /v2/panel': { json: PANEL },
  'GET /v2/markets/overview': { json: OVERVIEW },
  'GET /v2/rates/mx': { json: RATES },
  'GET /v2/fx/history': { json: FX_HISTORY },
  'GET /v2/search': { json: { results: [], meta: meta({ source: 'kaizen', delayMinutes: null }) } },
  'GET /v2/fx': { json: { pair: 'USDMXN', rate: 18.4321, asOf: '2026-09-22T14:40:00Z', source: 'yahoo', stale: false, meta: meta() } },
  'GET /v2/quotes': QUOTES,
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

const OVERSELL_STATE = {
  ...STATE,
  portfolios: [{ ...STATE.portfolios[0], transactions: [...STATE.portfolios[0].transactions, tx({ id: 'tx9', type: 'sell', date: '2026-09-15', symbol: 'WALMEX.MX', quantity: 250, price: 66 })] }],
}

test.describe('portafolio: movimientos, huecos de la primera tanda', () => {
  test('una venta por más de lo que había se avisa y se marca en el libro', async ({ page, baseURL }) => {
    await open(page, baseURL, { state: OVERSELL_STATE })
    await page.goto('/portafolio/movimientos')
    const warning = page.getByRole('region', { name: 'Ventas por más títulos de los que tenías' })
    await expect(warning).toBeVisible()
    await expect(warning).toContainText('Venta de 250 WALMEX.MX el 15 sep 2026: tenías 200, así que solo cuentan 200.')
    await expect(txTable(page).getByRole('row', { name: /15 sep 2026/ })).toContainText('Recortada')
    // Lo que cuenta el libro: 200 vendidos de 200, así que no queda posición.
    await expect(posTable(page).getByRole('row', { name: /WALMEX\.MX/ })).toHaveCount(0)
    await noHorizontalScroll(page)
    await expectNoAxeViolations(page, 'movimientos con venta de más')
  })

  test('exportar CSV y volver a importarlo con filas nuevas, repetidas y malas', async ({ page, baseURL }) => {
    await open(page, baseURL)
    await page.goto('/portafolio/movimientos')
    await expect(txTable(page).getByRole('row')).toHaveCount(4)

    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar CSV' }).click()])
    expect(download.suggestedFilename()).toBe('movimientos-2026-09-22.csv')
    const exported = await readFile(/** @type {string} */ (await download.path()), 'utf8')
    const lines = exported.replace(/^\uFEFF/, '').trim().split(/\r\n/)
    expect(lines[0]).toBe('Fecha,Tipo,Clave,Títulos,Precio,Monto,Comisión,Moneda,Tipo de cambio,Proporción,Nota')
    expect(lines).toHaveLength(4)

    const csv = [lines[0], lines[2], '2026-09-12,Compra,NAFTRAC.MX,50,55.1,,,MXN,,,', '2026-09-13,Dividendo,WALMEX.MX,,,120,,MXN,,,', '2026-09-14,Regalo,X,1,1,,,MXN,,,'].join('\r\n')
    await page.getByLabel('Archivo CSV de movimientos').setInputFiles({ name: 'mis-movimientos.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') })
    const dialog = page.getByRole('dialog', { name: 'Importar movimientos' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('2 movimientos listos para agregar, 1 ya estaban en tu libro y no se repiten, 1 con problemas que se quedan fuera.')
    await expect(dialog).toContainText('Fila 5: tipo desconocido (Regalo).')
    await expectNoAxeViolations(page, 'diálogo de importación')
    await dialog.getByRole('button', { name: 'Agregar 2 movimientos' }).click()
    await expect(dialog).toBeHidden()
    await expect(txTable(page).getByRole('row')).toHaveCount(6)
    await expect(posTable(page).getByRole('row', { name: /NAFTRAC\.MX/ })).toBeVisible()
    await page.getByRole('button', { name: 'Deshacer' }).click()
    await expect(txTable(page).getByRole('row')).toHaveCount(4)
  })
})

const REBALANCE_STATE = { ...STATE, portfolios: [{ ...STATE.portfolios[0], targets: { 'WALMEX.MX': 0.6, 'NAFTRAC.MX': 0.4 } }] }
const planTable = (page) => page.getByRole('table', { name: 'Movimientos del plan' })

test.describe('portafolio: rebalanceo', () => {
  for (const theme of THEMES) {
    test(`carga con su h1, metas y plan sin violaciones (${theme})`, async ({ page, baseURL }) => {
      await open(page, baseURL, { theme, state: REBALANCE_STATE })
      await page.goto('/portafolio/rebalanceo')
      await expect(page.getByRole('heading', { level: 1, name: 'Rebalanceo' })).toBeVisible()
      await expect(page.locator('h1')).toHaveCount(1)
      await expect(page.getByLabel('Meta de WALMEX.MX en porcentaje')).toHaveValue(/60/)
      await expect(planTable(page).getByRole('row', { name: /NAFTRAC\.MX/ })).toContainText('Aumentar')
      await expect(planTable(page).getByRole('row', { name: /WALMEX\.MX/ })).toContainText('Reducir')
      await noHorizontalScroll(page)
      await expectNoAxeViolations(page, `rebalanceo ${theme}`)
    })
  }

  test('registrar el plan escribe al libro y Deshacer lo quita', async ({ page, baseURL }) => {
    await open(page, baseURL, { state: REBALANCE_STATE })
    await page.goto('/portafolio/rebalanceo')
    await page.getByRole('button', { name: 'Registrar en el libro' }).click()
    await page.getByRole('alertdialog', { name: '¿Registrar el plan en tu libro?' }).getByRole('button', { name: 'Registrar' }).click()
    await expect(page.getByText('Movimientos registrados')).toBeVisible()
    const count = () => page.evaluate(() => JSON.parse(window.localStorage.getItem('kaizen:v2') ?? '{}').portfolios[0].transactions.length)
    await expect.poll(count).toBe(5)
    await page.getByRole('button', { name: 'Deshacer' }).click()
    await expect.poll(count).toBe(3)
  })

  test('agregar una emisora nueva con meta entra al plan', async ({ page, baseURL }) => {
    await open(page, baseURL, { state: REBALANCE_STATE })
    await page.goto('/portafolio/rebalanceo')
    const form = page.getByRole('region', { name: 'Agregar una emisora' })
    await form.getByLabel('Clave de la emisora').fill('WAL MEX')
    await form.getByLabel('Meta').fill('10')
    await form.getByRole('button', { name: 'Agregar a las metas' }).click()
    await expect(form.getByText('Esa clave no es válida')).toBeVisible()

    await form.getByLabel('Clave de la emisora').fill('amxb.mx')
    await form.getByRole('button', { name: 'Agregar a las metas' }).click()
    await expect(page.getByLabel('Meta de AMXB.MX en porcentaje')).toHaveValue(/10/)
    await expect(page.getByText('Ajusta las metas hasta que sumen 100%.')).toBeVisible()
    await page.getByLabel('Meta de WALMEX.MX en porcentaje').fill('50')
    await expect(planTable(page).getByRole('row', { name: /AMXB\.MX/ })).toContainText('Aumentar')

    await form.getByLabel('Clave de la emisora').fill('ZZZZ.MX')
    await form.getByLabel('Meta').fill('5')
    await form.getByRole('button', { name: 'Agregar a las metas' }).click()
    await expect(form.getByText('Sin cotización para ZZZZ.MX')).toBeVisible()
    await noHorizontalScroll(page)
    await expectNoAxeViolations(page, 'rebalanceo con emisora nueva')
  })

  test('metas que no suman 100% no calculan plan', async ({ page, baseURL }) => {
    await open(page, baseURL)
    await page.goto('/portafolio/rebalanceo')
    await expect(page.getByText('Ajusta las metas hasta que sumen 100%.')).toBeVisible()
    await expect(planTable(page)).toHaveCount(0)
  })
})

const RISK_STATE = {
  ...STATE,
  portfolios: [{ ...STATE.portfolios[0], transactions: [...STATE.portfolios[0].transactions, tx({ id: 'tx4', type: 'buy', date: '2026-09-11', symbol: 'NAFTRAC.MX', quantity: 50, price: 55 })] }],
}

// Sin montar hasta que src/app/router.test.jsx deje de usar /portafolio/riesgo como "Próximamente"
// (docs/requests/F1.md). Para correrlas, monta Risk.jsx en routes.jsx y quita el skip.
test.describe('portafolio: riesgo', () => {
  for (const theme of THEMES) {
    test(`carga con su h1, medidas, correlaciones y sin violaciones (${theme})`, async ({ page, baseURL }) => {
      await open(page, baseURL, { theme, state: RISK_STATE })
      await page.goto('/portafolio/riesgo')
      await expect(page.getByRole('heading', { level: 1, name: 'Riesgo' })).toBeVisible()
      await expect(page.locator('h1')).toHaveCount(1)
      await expect(page.getByText('11 semanas de datos')).toBeVisible()
      await expect(page.getByRole('figure', { name: 'Correlaciones entre tus emisoras' })).toBeVisible()
      await noHorizontalScroll(page)
      await expectNoAxeViolations(page, `riesgo ${theme}`)
    })
  }

  test('sin posiciones lleva a Movimientos', async ({ page, baseURL }) => {
    await open(page, baseURL, { state: { ...STATE, portfolios: [{ ...STATE.portfolios[0], transactions: [] }] } })
    await page.goto('/portafolio/riesgo')
    await expect(page.getByRole('link', { name: 'Ir a Movimientos' })).toHaveAttribute('href', '/portafolio/movimientos')
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
  await page.addInitScript((st) => window.localStorage.setItem('kaizen:v2', st), JSON.stringify(REBALANCE_STATE))
  await page.goto('/portafolio/rebalanceo')
  await expect(page.getByRole('heading', { level: 1, name: 'Rebalanceo' })).toBeVisible()
  await expect(planTable(page)).toBeVisible()
  await settleAnimations(page)
  await page.screenshot({ path: `${dir}/rebalanceo-${testInfo.project.name}.png`, fullPage: true })
})
