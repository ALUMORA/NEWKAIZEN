// Páginas de F5: Aprender (glosario y ficha), legales y, con sesión, lista de seguimiento y
// bienvenida. Corre en desktop (1440x900) y mobile (390x844) sobre el build de e2e, con las
// respuestas v2 simuladas. La fixture `guards` tumba la prueba ante cualquier console.error,
// excepción, request fallido o respuesta >= 400.
//
// Capturas para revisión: con F5_CAPTURE_DIR=/ruta se guarda una por página y viewport.
import AxeBuilder from '@axe-core/playwright'
import { test, expect } from './support/guards.js'
import { HEALTH_V2, setupApp } from './support/app.js'

const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']
const THEMES = /** @type {const} */ (['light', 'dark'])
const CAPTURE_DIR = process.env.F5_CAPTURE_DIR ?? ''

/** @param {import('@playwright/test').Page} page */
// ─── Respuestas v2 simuladas (kaizen_api/schemas.py) ─────────────────────────

const HEALTH = { ...HEALTH_V2, capabilities: [...HEALTH_V2.capabilities, 'markets.overview', 'markets.world'] }
const meta = (over = {}) => ({ asOf: '2026-09-22T14:40:00Z', source: 'yahoo', delayMinutes: 15, stale: false, fallback: false, generatedAt: '2026-09-22T14:52:00Z', notes: [], ...over })
const item = (symbol, label, price, change, changePct, currency) => ({ symbol, label, price, change, changePct, currency, asOf: '2026-09-22T14:40:00Z' })
const exchange = { open: true, label: 'Abierta', nextOpen: null, nextClose: '2026-09-22T20:00:00Z' }
const OVERVIEW = {
  groups: [
    { id: 'mx', label: 'México', items: [item('^MXX', 'S&P/BMV IPC', 61234.52, 297.1, 0.00487, 'MXN')] },
    { id: 'us', label: 'Estados Unidos', items: [item('^GSPC', 'S&P 500', 6650.12, -19.9, -0.00298, 'USD'), item('^VIX', 'VIX, volatilidad esperada del S&P 500', 15.21, 0.41, 0.0277, null)] },
    { id: 'fx', label: 'Divisas', items: [item('USDMXN=X', 'Dólar frente al peso', 18.4321, 0.0496, 0.0027, 'MXN')] },
  ],
  marketStatus: { bmv: exchange, nyse: exchange },
  meta: meta(),
}
const RATES = {
  items: [{ id: 'cetes28', label: 'CETES 28 días', value: 0.0725, unit: 'fraction', asOf: '2026-09-18', seriesId: 'SF43936', source: 'banxico', previous: 0.073, changeBp: -5 }],
  meta: meta({ asOf: '2026-09-18', source: 'banxico', delayMinutes: null }),
}
const SEARCH_ALL = [
  { symbol: 'WALMEX.MX', name: 'Wal-Mart de México', exchange: 'BMV', type: 'equity', currency: 'MXN', aliases: ['Walmart de México'] },
  { symbol: 'FEMSAUBD.MX', name: 'Fomento Económico Mexicano', exchange: 'BMV', type: 'equity', currency: 'MXN', aliases: ['FEMSA'] },
]
const QUOTES = {
  'WALMEX.MX': { symbol: 'WALMEX.MX', name: 'Wal-Mart de México', price: 58.12, previousClose: 57.5, change: 0.62, changePct: 0.01078, currency: 'MXN', exchange: 'BMV', type: 'equity', marketState: 'REGULAR', asOf: '2026-09-22T14:40:00Z' },
  'FEMSAUBD.MX': { symbol: 'FEMSAUBD.MX', name: 'Fomento Económico Mexicano', price: 171.3, previousClose: 173.1, change: -1.8, changePct: -0.0104, currency: 'MXN', exchange: 'BMV', type: 'equity', marketState: 'REGULAR', asOf: '2026-09-22T14:40:00Z' },
}
const DATES = Array.from({ length: 21 }, (_, i) => `2026-08-${String(i + 5).padStart(2, '0')}`)

const SHELL_ROUTES = {
  'GET /v2/markets/overview': { json: OVERVIEW },
  'GET /v2/rates/mx': { json: RATES },
  'GET /v2/search': ({ url }) => {
    const needle = String(url.searchParams.get('q') ?? '').toLowerCase()
    return { json: { results: SEARCH_ALL.filter((r) => r.symbol.toLowerCase().startsWith(needle) || r.name.toLowerCase().includes(needle) || r.aliases.some((a) => a.toLowerCase().includes(needle))), meta: meta({ source: 'kaizen', delayMinutes: null }) } }
  },
  'GET /v2/quotes': ({ url }) => {
    const wanted = url.searchParams.getAll('symbols').flatMap((s) => s.split(',')).filter(Boolean)
    return { json: { quotes: wanted.map((s) => QUOTES[s]).filter(Boolean), missing: wanted.filter((s) => !QUOTES[s]), meta: meta() } }
  },
  'GET /v2/history/:symbol': ({ params }) => ({
    json: { symbol: decodeURIComponent(params.symbol), currency: 'MXN', interval: '1d', adjusted: true, dates: DATES, close: DATES.map((_, i) => 100 + i * 0.5 + (i % 3)), fx: null, meta: meta({ asOf: '2026-09-22' }) },
  }),
}

/** @param {import('@playwright/test').Page} page */
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
  const { scrollWidth, innerWidth, frame } = await page.evaluate(() => {
    const el = document.querySelector('.kz-shell__frame')
    return { scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth, frame: el ? el.scrollWidth - el.clientWidth : 0 }
  })
  expect(scrollWidth, 'la página no se desplaza a lo ancho').toBeLessThanOrEqual(innerWidth)
  expect(frame, 'el marco del shell no se desplaza a lo ancho').toBeLessThanOrEqual(0)
}

async function open(page, baseURL, path, { theme = 'light', session = false, routes = {}, legacyApi = false } = {}) {
  await setupApp(page, { baseURL, session, legacyApi, routes: { ...SHELL_ROUTES, ...routes }, health: session ? HEALTH : 'v2' })
  await page.addInitScript((t) => window.localStorage.setItem('kaizen_theme', t), theme)
  await page.goto(path)
}

const PUBLIC_PAGES = [
  { path: '/aprender', h1: 'Glosario' },
  { path: '/aprender/sharpe', h1: /Sharpe/ },
  { path: '/legal/terminos', h1: 'Términos de uso' },
  { path: '/legal/privacidad', h1: 'Aviso de privacidad' },
  { path: '/legal/aviso', h1: 'Aviso legal' },
]

test.describe('F5: páginas públicas', () => {
  for (const { path, h1 } of PUBLIC_PAGES) {
    for (const theme of THEMES) {
      test(`${path} en tema ${theme}: h1, axe y sin scroll a lo ancho`, async ({ page, baseURL }, testInfo) => {
        await open(page, baseURL, path, { theme })
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(h1)
        await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
        await noHorizontalScroll(page)
        await expectNoAxeViolations(page, `${path} ${theme}`)
        if (CAPTURE_DIR && theme === 'light') {
          const name = path.replace(/\//g, '_').replace(/^_/, '')
          await page.screenshot({ path: `${CAPTURE_DIR}/${name}-${testInfo.project.name}.png`, fullPage: false })
        }
      })
    }
  }

  test('el buscador del glosario filtra y lleva a la ficha', async ({ page, baseURL }) => {
    await open(page, baseURL, '/aprender')
    await page.getByRole('searchbox', { name: /Buscar un concepto/ }).fill('volatilidad')
    await expect(page.getByRole('status')).toContainText('encontrado')
    const first = page.getByRole('region', { name: 'Resultados' }).getByRole('link').first()
    const title = (await first.locator('strong').textContent()) ?? ''
    await first.click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title)
    await expect(page.getByText('Cómo leerlo')).toBeVisible()
  })

  test('un término que no existe muestra un estado vacío amable', async ({ page, baseURL }) => {
    await open(page, baseURL, '/aprender/no-existe-este-termino')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Concepto no encontrado')
    await expect(page.getByRole('link', { name: 'Ver el glosario completo' })).toBeVisible()
  })
})

test.describe('F5: lista de seguimiento', () => {
  for (const theme of THEMES) {
    test(`/watchlist en tema ${theme}: vacía, agregar, quitar con Deshacer, axe`, async ({ page, baseURL }, testInfo) => {
      await open(page, baseURL, '/watchlist', { theme, session: true })
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lista de seguimiento')
      await expect(page.getByText('Tu lista está vacía')).toBeVisible()
      await expectNoAxeViolations(page, `/watchlist vacía ${theme}`)

      const search = page.getByRole('searchbox', { name: /Agregar una emisora/ })
      await search.fill('walmex')
      await page.getByRole('button', { name: 'Agregar WALMEX.MX' }).click()
      await search.fill('femsa')
      await page.getByRole('button', { name: 'Agregar FEMSAUBD.MX' }).click()
      const table = page.getByRole('table', { name: 'Emisoras en seguimiento' })
      await expect(table.getByRole('row')).toHaveCount(3)
      await expect(table).toContainText('+1.08%')
      await expect(table).toContainText('−1.04%')
      await noHorizontalScroll(page)
      await expectNoAxeViolations(page, `/watchlist con datos ${theme}`)
      if (CAPTURE_DIR && theme === 'light') await page.screenshot({ path: `${CAPTURE_DIR}/watchlist-${testInfo.project.name}.png` })

      await table.getByRole('button', { name: 'Quitar WALMEX.MX' }).click()
      await expect(table.getByRole('row')).toHaveCount(2)
      // En móvil el marco del shell tapa el aviso para el puntero (pendiente de C3, ver
      // docs/requests/F5.md); se usa el teclado, que es igual de válido para Deshacer.
      const undo = page.getByRole('button', { name: 'Deshacer' })
      await undo.focus()
      await page.keyboard.press('Enter')
      await expect(table.getByRole('row')).toHaveCount(3)
      await expect(table.getByRole('row').nth(1)).toContainText('WALMEX.MX')
    })
  }
})

const readStore = (page) => page.evaluate(() => JSON.parse(window.localStorage.getItem('kaizen:v2') ?? 'null'))

test.describe('F5: bienvenida', () => {
  for (const theme of THEMES) {
    test(`/bienvenida en tema ${theme}: h1, axe y sin scroll a lo ancho`, async ({ page, baseURL }, testInfo) => {
      await open(page, baseURL, '/bienvenida', { theme, session: true })
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Te damos la bienvenida a Kaizen')
      await expect(page.getByText('EJEMPLO', { exact: true })).toBeVisible()
      await noHorizontalScroll(page)
      await expectNoAxeViolations(page, `/bienvenida ${theme}`)
      if (CAPTURE_DIR && theme === 'light') await page.screenshot({ path: `${CAPTURE_DIR}/bienvenida-${testInfo.project.name}.png` })
    })
  }

  test('importar un CSV valida filas y guarda onboardingDone', async ({ page, baseURL }) => {
    await open(page, baseURL, '/bienvenida', { session: true, legacyApi: true })
    const csv = 'tipo,fecha,símbolo,cantidad,precio,moneda\ncompra,2026-03-02,WALMEX.MX,10,60.5,MXN\ncompra,2026-03-02,,5,10,MXN\n'
    await page.getByLabel('Archivo CSV').setInputFiles({ name: 'movimientos.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
    await expect(page.getByRole('status').filter({ hasText: 'movimientos.csv' })).toContainText('1 movimiento válido, 1 con problemas')
    await expect(page.getByText('Fila 3: falta el símbolo')).toBeVisible()
    await page.getByRole('button', { name: 'Crear portafolio con 1 movimientos' }).click()
    await expect(page).toHaveURL(/\/portafolio$/)
    const store = await readStore(page)
    expect(store.settings.onboardingDone).toBe(true)
    expect(store.portfolios.at(-1).transactions).toHaveLength(1)
  })

  test('el ejemplo queda marcado EJEMPLO', async ({ page, baseURL }) => {
    await open(page, baseURL, '/bienvenida', { session: true, legacyApi: true })
    await page.getByRole('button', { name: 'Usar el ejemplo' }).click()
    await expect(page).toHaveURL(/\/portafolio$/)
    const store = await readStore(page)
    expect(store.settings.onboardingDone).toBe(true)
    expect(store.portfolios.at(-1).name).toContain('EJEMPLO')
    expect(store.portfolios.at(-1).transactions.length).toBe(5)
  })
})
