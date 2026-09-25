// Marco de la app nueva (C3): barra lateral, barra superior con la tira de mercado, pie, barra
// inferior con "Más", paleta de comandos, liga de salto, foco al cambiar de ruta y accesibilidad.
// Corre en desktop (1440x900) y mobile (390x844) sobre el build de e2e, con las respuestas v2
// simuladas con la forma de kaizen_api/schemas.py y el legado servido desde el HAR de siempre.
//
// La fixture `guards` tumba la prueba ante cualquier console.error, excepción, request fallido o
// respuesta >= 400.
//
// Capturas para revisión: con C3_CAPTURE_DIR=/ruta la prueba "capturas" guarda /mercados,
// /portafolio y la paleta en los dos temas; sin la variable se salta.
import AxeBuilder from '@axe-core/playwright'
import { test, expect } from './support/guards.js'
import { HEALTH_V2, setupApp } from './support/app.js'
import { RESEARCH_ROUTES } from './support/research-data.js'
import { expectNoHorizontalScroll } from './support/layout.js'

const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']
const THEMES = /** @type {const} */ (['light', 'dark'])
const CAPTURE_DIR = process.env.C3_CAPTURE_DIR ?? ''

// ─── Respuestas v2 simuladas (kaizen_api/schemas.py) ─────────────────────────

const HEALTH = { ...HEALTH_V2, capabilities: [...HEALTH_V2.capabilities, 'markets.overview', 'markets.world'] }

/** Meta (procedencia) de una respuesta v2. */
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

/** MarketsOverviewResponse */
const OVERVIEW = {
  groups: [
    { id: 'mx', label: 'México', items: [item('^MXX', 'S&P/BMV IPC', 61234.52, 297.1, 0.00487, 'MXN')] },
    {
      id: 'us',
      label: 'Estados Unidos',
      items: [item('^GSPC', 'S&P 500', 6650.12, -19.9, -0.00298, 'USD'), item('^VIX', 'VIX, volatilidad esperada del S&P 500', 15.21, 0.41, 0.0277, null)],
    },
    { id: 'fx', label: 'Divisas', items: [item('USDMXN=X', 'Dólar frente al peso', 18.4321, 0.0496, 0.0027, 'MXN')] },
  ],
  marketStatus: { bmv: exchange, nyse: exchange },
  meta: meta(),
}

/** MxRatesResponse */
const RATES = {
  items: [
    { id: 'cetes28', label: 'CETES 28 días', value: 0.0725, unit: 'fraction', asOf: '2026-09-18', seriesId: 'SF43936', source: 'banxico', previous: 0.073, changeBp: -5 },
  ],
  meta: meta({ asOf: '2026-09-18', source: 'banxico', delayMinutes: null }),
}

/** SearchResponse para /v2/search?q=... */
function searchResponse(q) {
  const all = [
    { symbol: 'WALMEX.MX', name: 'Wal-Mart de México', exchange: 'BMV', type: 'equity', currency: 'MXN', aliases: ['Walmart de México'] },
    { symbol: 'WMT', name: 'Walmart Inc.', exchange: 'NYSE', type: 'equity', currency: 'USD', aliases: ['Walmart'] },
  ]
  const needle = String(q ?? '').toLowerCase()
  return { results: all.filter((r) => r.symbol.toLowerCase().startsWith(needle.slice(0, 3)) || r.name.toLowerCase().includes(needle)), meta: meta({ source: 'kaizen', delayMinutes: null }) }
}

/** Cotizaciones para /watchlist (la prueba de avisos la usa porque ahí hay "Deshacer"). */
const QUOTES = {
  'WALMEX.MX': { symbol: 'WALMEX.MX', name: 'Wal-Mart de México', price: 58.12, previousClose: 57.5, change: 0.62, changePct: 0.01078, currency: 'MXN', exchange: 'BMV', type: 'equity', marketState: 'REGULAR', asOf: '2026-09-22T14:40:00Z' },
  WMT: { symbol: 'WMT', name: 'Walmart Inc.', price: 97.4, previousClose: 98.1, change: -0.7, changePct: -0.00714, currency: 'USD', exchange: 'NYSE', type: 'equity', marketState: 'REGULAR', asOf: '2026-09-22T14:40:00Z' },
}

const V2_ROUTES = {
  ...Object.fromEntries(Object.entries(RESEARCH_ROUTES).filter(([k]) => /instrument|history|valuation|momentum|news/.test(k))),
  'GET /v2/markets/overview': { json: OVERVIEW },
  // Mercados ya es la ruta nueva y pide los datos por país; con dos basta para que dibuje.
  'GET /v2/markets/world': {
    json: {
      items: [
        { country: '484', symbol: 'EWW', label: 'México', changePct: 0.0061, currency: 'USD', asOf: '2026-09-22' },
        { country: '840', symbol: 'SPY', label: 'Estados Unidos', changePct: -0.0028, currency: 'USD', asOf: '2026-09-22' },
      ],
      method: 'Variación del ETF de cada país cotizado en dólares.',
      meta: meta({ asOf: '2026-09-22' }),
    },
  },
  'GET /v2/rates/mx': { json: RATES },
  'GET /v2/search': ({ url }) => ({ json: searchResponse(url.searchParams.get('q')) }),
  'GET /v2/quotes': ({ url }) => {
    const wanted = url.searchParams.getAll('symbols').flatMap((s) => s.split(',')).filter(Boolean)
    return { json: { quotes: wanted.map((s) => QUOTES[s]).filter(Boolean), missing: wanted.filter((s) => !QUOTES[s]), meta: meta() } }
  },
}

// ─── Ayudas ──────────────────────────────────────────────────────────────────

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} baseURL
 * @param {{ theme?: 'light' | 'dark' }} [options]
 */
async function openShell(page, baseURL, { theme } = {}) {
  const api = await setupApp(page, { baseURL, session: true, health: HEALTH, routes: V2_ROUTES })
  if (theme) await page.addInitScript((t) => window.localStorage.setItem('kaizen_theme', t), theme)
  return api
}

/** Espera a que la ruta termine de montar dentro del shell: su h1 visible. */
async function appSettled(page) {
  await expect(page.getByRole('main').getByRole('heading', { level: 1 }).first()).toBeVisible()
}

/** La tira muestra datos (la respuesta ya llegó). */
async function stripReady(page) {
  await expect(page.getByRole('region', { name: 'Mercado en breve' }).getByText('61,234.52')).toBeVisible()
}

/** Espera las animaciones de entrada (un diálogo a media opacidad mide contraste de más). */
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

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} context
 * @param {{ exclude?: string[] }} [options]
 */
async function expectNoAxeViolations(page, context, { exclude = [] } = {}) {
  await settleAnimations(page)
  let builder = new AxeBuilder({ page }).withTags(WCAG_AA)
  for (const sel of exclude) builder = builder.exclude(sel)
  const results = await builder.analyze()
  const detail = results.violations
    .map((v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.map((n) => n.target.join(' ')).slice(0, 6).join('\n    ')}`)
    .join('\n')
  expect(results.violations, `${context}:\n${detail}`).toEqual([])
}

const isMobile = (testInfo) => testInfo.project.name === 'mobile'

// ─── Pruebas ─────────────────────────────────────────────────────────────────

test.describe('shell: estructura', () => {
  test('landmarks, liga de salto y aviso en el pie', async ({ page, baseURL }, testInfo) => {
    await openShell(page, /** @type {string} */ (baseURL))
    await page.goto('/portafolio/riesgo')
    await expect(page.getByRole('heading', { level: 1, name: 'Riesgo' })).toBeVisible()

    await expect(page.getByRole('banner')).toHaveCount(1)
    await expect(page.locator('main#contenido')).toHaveCount(1)
    await expect(page.getByRole('contentinfo')).toHaveCount(1)
    // Escritorio: barra lateral "Principal". Móvil: barra inferior "Secciones".
    await expect(page.getByRole('navigation', { name: isMobile(testInfo) ? 'Secciones' : 'Principal' })).toBeVisible()

    // Primera tecla Tab: la liga de salto aparece y lleva al contenido.
    await page.keyboard.press('Tab')
    const skip = page.getByRole('link', { name: 'Saltar al contenido' })
    await expect(skip).toBeFocused()
    await expect(skip).toBeInViewport()
    await page.keyboard.press('Enter')
    await expect(page.locator('main#contenido')).toBeFocused()

    const footer = page.getByRole('contentinfo')
    await expect(footer).toContainText('Kaizen es una herramienta educativa y de análisis. No es recomendación de inversión.')
    await expect(footer.getByRole('link', { name: 'Términos de uso' })).toHaveAttribute('href', '/legal/terminos')
    await expect(footer.getByRole('link', { name: 'Aviso de privacidad' })).toHaveAttribute('href', '/legal/privacidad')
    await expect(footer.getByRole('link', { name: 'Aviso legal' })).toHaveAttribute('href', '/legal/aviso')
    await expectNoHorizontalScroll(page)
  })

  test('tira de mercado: cinco cifras del API v2, USD/MXN en neutral y DataStatus', async ({ page, baseURL }, testInfo) => {
    const api = await openShell(page, /** @type {string} */ (baseURL))
    await page.goto('/portafolio/riesgo')
    const strip = page.getByRole('region', { name: 'Mercado en breve' })
    await stripReady(page)
    await expect(strip.getByRole('listitem')).toHaveCount(5)
    await expect(strip.getByRole('listitem')).toHaveText([/^IPC/, /^S&P 500/, /^USD\/MXN/, /^CETES 28/, /^VIX/])
    const usd = strip.getByRole('listitem').filter({ hasText: 'USD/MXN' })
    await expect(usd).toContainText('18.4321')
    await expect(usd).toContainText('peso más débil')
    await expect(usd.locator('.kz-delta')).toHaveAttribute('data-dir', 'neutral')
    await expect(strip.getByRole('listitem').filter({ hasText: 'CETES 28' })).toContainText('7.25%')
    await expect(strip.getByRole('button', { name: /Ver fuente y fecha del dato/ })).toBeVisible()
    expect(api.calls).toContain('GET /v2/markets/overview')
    expect(api.calls).toContain('GET /v2/rates/mx')
    if (isMobile(testInfo)) {
      // En móvil no cabe: se desplaza dentro de su propio contenedor, que entra al orden de Tab.
      const scroller = strip.getByRole('group', { name: /Cifras del mercado/ })
      await expect(scroller).toHaveAttribute('tabindex', '0')
      const { sw, cw } = await scroller.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }))
      expect(sw).toBeGreaterThan(cw)
    }
    await expectNoHorizontalScroll(page)
    api.assertAllMatched()
  })
})

test.describe('shell: navegación', () => {
  test('escritorio: barra lateral, foco al h1, título y plegado a 64 px', async ({ page, baseURL }, testInfo) => {
    test.skip(isMobile(testInfo), 'En móvil la barra lateral no existe; ver la prueba de la barra inferior.')
    await openShell(page, /** @type {string} */ (baseURL))
    await page.goto('/portafolio/riesgo')
    const nav = page.getByRole('navigation', { name: 'Principal' })
    await expect(nav.getByRole('link', { name: 'Riesgo' })).toHaveAttribute('aria-current', 'page')

    await nav.getByRole('link', { name: 'Rebalanceo' }).click()
    await expect(page).toHaveURL(/\/portafolio\/rebalanceo$/)
    await expect(page).toHaveTitle('Rebalanceo · Kaizen')
    await expect(page.getByRole('heading', { level: 1, name: 'Rebalanceo' })).toBeFocused()
    await expect(nav.getByRole('link', { name: 'Rebalanceo' })).toHaveAttribute('aria-current', 'page')

    await nav.getByRole('link', { name: 'Watchlist' }).click()
    await expect(page).toHaveTitle('Watchlist · Kaizen')
    await expect(page.getByRole('heading', { level: 1, name: 'Lista de seguimiento' })).toBeFocused()

    await page.getByRole('button', { name: 'Plegar barra lateral' }).click()
    await expect(page.locator('.kz-side')).toHaveCSS('width', '64px')
    // Plegada conserva los nombres accesibles.
    await expect(nav.getByRole('link', { name: 'Simulador y metas' })).toBeVisible()
    await page.getByRole('button', { name: 'Expandir barra lateral' }).click()
    await expect(page.locator('.kz-side')).toHaveCSS('width', '240px')
  })

  test('escritorio: Mercados y Riesgo sin la barra vieja del legado', async ({ page, baseURL }, testInfo) => {
    test.skip(isMobile(testInfo), 'La misma revisión en móvil está en la prueba de la barra inferior.')
    await openShell(page, /** @type {string} */ (baseURL))
    await page.goto('/mercados')
    await appSettled(page)
    await expect(page.locator('.app-sidebar, .app-topbar, .bottom-nav-mobile')).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1, name: 'Mercados' })).toBeAttached()

    await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Riesgo' }).click()
    await expect(page).toHaveURL(/\/portafolio\/riesgo$/)
    await expect(page).toHaveTitle('Riesgo · Kaizen')
    await expect(page.getByRole('heading', { level: 1, name: 'Riesgo' })).toBeFocused()
    await appSettled(page)
    await expectNoHorizontalScroll(page)
  })

  test('móvil: barra inferior, "Más" con Watchlist, Aprender, Tema y Cerrar sesión', async ({ page, baseURL }, testInfo) => {
    test.skip(!isMobile(testInfo), 'La barra inferior solo existe debajo de 768 px.')
    await openShell(page, /** @type {string} */ (baseURL))
    await page.goto('/portafolio/riesgo')
    await expect(page.locator('.kz-side')).toBeHidden()
    const bottom = page.getByRole('navigation', { name: 'Secciones' })
    await expect(bottom.getByRole('listitem')).toHaveText(['Mercados', 'Portafolio', 'Investigar', 'Herramientas', 'Más'])
    await expect(bottom.getByRole('link', { name: 'Portafolio' })).toHaveAttribute('aria-current', 'page')

    await bottom.getByRole('button', { name: 'Más' }).click()
    const sheet = page.getByRole('dialog', { name: 'Más' })
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole('link', { name: 'Watchlist' })).toBeVisible()
    await expect(sheet.getByRole('link', { name: 'Aprender' })).toHaveAttribute('href', '/aprender')
    await expect(sheet.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible()
    await sheet.getByRole('radio', { name: 'Oscuro' }).check()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await sheet.getByRole('link', { name: 'Watchlist' }).click()
    await expect(sheet).toBeHidden()
    await expect(page).toHaveURL(/\/watchlist$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Lista de seguimiento' })).toBeFocused()

    // El contenido nunca queda debajo de la barra inferior: al fondo, el pie termina arriba de ella.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    const footerBottom = await page.getByRole('contentinfo').evaluate((el) => el.getBoundingClientRect().bottom)
    const navTop = await bottom.evaluate((el) => el.getBoundingClientRect().top)
    expect(footerBottom).toBeLessThanOrEqual(navTop + 0.5)
    await bottom.getByRole('link', { name: 'Mercados' }).click()
    await expect(page).toHaveURL(/\/mercados$/)
    await appSettled(page)
    await expect(page.locator('.bottom-nav-mobile, .app-topbar')).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1, name: 'Mercados' })).toBeFocused()
    await expectNoHorizontalScroll(page)
  })

  test('cerrar sesión desde el shell vuelve a /login', async ({ page, baseURL }, testInfo) => {
    await openShell(page, /** @type {string} */ (baseURL))
    await page.goto('/portafolio/riesgo')
    await expect(page.getByRole('heading', { level: 1, name: 'Riesgo' })).toBeVisible()
    if (isMobile(testInfo)) {
      await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Más' }).click()
      await page.getByRole('dialog', { name: 'Más' }).getByRole('button', { name: 'Cerrar sesión' }).click()
    } else {
      await page.getByRole('button', { name: /^Cuenta de / }).click()
      await page.getByRole('button', { name: 'Cerrar sesión' }).click()
    }
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('status').filter({ hasText: 'Cerraste tu sesión.' })).toBeVisible()
  })
})

test.describe('shell: paleta de comandos', () => {
  test('Ctrl+K, ⌘K y "/" la abren; flechas, Esc y aria-activedescendant', async ({ page, baseURL }) => {
    await openShell(page, /** @type {string} */ (baseURL))
    await page.goto('/portafolio/riesgo')
    await expect(page.getByRole('heading', { level: 1, name: 'Riesgo' })).toBeVisible()
    const dialog = page.getByRole('dialog', { name: 'Buscar emisora o función' })
    const input = dialog.getByRole('combobox', { name: 'Buscar emisora o función' })

    for (const keys of ['Control+k', 'Meta+k', '/']) {
      await page.locator('body').press(keys)
      await expect(dialog, `${keys} abre la paleta`).toBeVisible()
      await expect(input).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
    }

    await page.keyboard.press('Control+k')
    await expect(dialog.getByRole('group', { name: 'Ir a' })).toBeVisible()
    await expect(dialog.getByRole('group', { name: 'Acciones' })).toBeVisible()
    await input.fill('riesgo')
    const first = dialog.getByRole('option').first()
    await expect(first).toHaveText(/Riesgo/)
    await expect(first).toHaveAttribute('aria-selected', 'true')
    await expect(input).toHaveAttribute('aria-activedescendant', /** @type {string} */ (await first.getAttribute('id')))
    await input.fill('ma')
    await page.keyboard.press('ArrowDown')
    const second = dialog.getByRole('option').nth(1)
    await expect(second).toHaveAttribute('aria-selected', 'true')
    await expect(input).toHaveAttribute('aria-activedescendant', /** @type {string} */ (await second.getAttribute('id')))
    await page.keyboard.press('ArrowUp')
    await expect(dialog.getByRole('option').first()).toHaveAttribute('aria-selected', 'true')

    await input.fill('riesgo')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/portafolio\/riesgo$/)
    await expect(dialog).toBeHidden()
  })

  test('"WALMEX" + Enter abre /investigar/WALMEX.MX y queda en recientes', async ({ page, baseURL }) => {
    const api = await openShell(page, /** @type {string} */ (baseURL))
    await page.goto('/portafolio/riesgo')
    await expect(page.getByRole('heading', { level: 1, name: 'Riesgo' })).toBeVisible()
    await page.getByRole('button', { name: /Buscar emisora o función/ }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Buscar emisora o función' })
    await dialog.getByRole('combobox').pressSequentially('WALMEX')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/investigar\/WALMEX\.MX$/)
    await expect(page.getByRole('heading', { level: 1, name: /WALMEX\.MX/ })).toBeFocused()
    expect(api.calls.some((c) => c.startsWith('GET /v2/search?') && c.includes('q=WALMEX'))).toBe(true)

    await page.keyboard.press('Control+k')
    const emisoras = dialog.getByRole('group', { name: 'Emisoras' })
    await expect(emisoras.getByRole('option', { name: /WALMEX\.MX/ })).toContainText('Reciente')

    // Resultado de /v2/search con la espera de 200 ms: el grupo Emisoras lo muestra.
    await dialog.getByRole('combobox').fill('walmart')
    await expect(emisoras.getByRole('option', { name: /WMT/ })).toBeVisible()
  })
})

test.describe('shell: avisos', () => {
  // docs/requests/F5.md: en móvil "Deshacer" no recibía el clic y Playwright culpaba a
  // .kz-shell__frame. No era el z-index (avisos 1200, barra 200, marco sin capa): los .sr-only de
  // una tabla ancha se salían de su scroll, el viewport de diseño crecía a 557 px y el aviso, que
  // es fijo, se iba fuera de la pantalla. Aquí se hace clic de verdad, sin force ni teclado.
  test('el aviso queda encima del marco y de la barra inferior, y "Deshacer" recibe el clic', async ({ page, baseURL }, testInfo) => {
    await openShell(page, /** @type {string} */ (baseURL))
    await page.goto('/watchlist')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lista de seguimiento')

    // Dos altas y una baja: tres avisos apilados y una tabla más ancha que el teléfono.
    const search = page.getByRole('searchbox', { name: /Agregar una emisora/ })
    for (const [q, symbol] of [['walmex', 'WALMEX.MX'], ['wmt', 'WMT']]) {
      await search.fill(q)
      await page.getByRole('button', { name: `Agregar ${symbol}` }).click()
    }
    const table = page.getByRole('table', { name: 'Emisoras en seguimiento' })
    await expect(table.getByRole('row')).toHaveCount(3)
    await table.getByRole('button', { name: 'Quitar WALMEX.MX' }).click()
    await expect(table.getByRole('row')).toHaveCount(2)

    const region = page.getByRole('region', { name: 'Avisos', exact: true })
    const undo = region.getByRole('button', { name: 'Deshacer' })
    await expect(undo).toBeVisible()
    await settleAnimations(page)
    await expectNoHorizontalScroll(page)

    const width = /** @type {{ width: number }} */ (page.viewportSize()).width
    const box = /** @type {{ x: number, y: number, width: number, height: number }} */ (await page.locator('.kz-toaster').boundingBox())
    expect(box.x, 'el aviso empieza dentro de la pantalla').toBeGreaterThanOrEqual(0)
    expect(box.x + box.width, 'el aviso termina dentro de la pantalla').toBeLessThanOrEqual(width)
    if (isMobile(testInfo)) {
      const nav = /** @type {{ y: number }} */ (await page.getByRole('navigation', { name: 'Secciones' }).boundingBox())
      expect(box.y + box.height, 'el aviso no tapa la barra inferior').toBeLessThanOrEqual(nav.y)
    }
    // Lo que el puntero encuentra en el centro del botón es el botón, no el marco.
    const onTop = await undo.evaluate((button) => {
      const r = button.getBoundingClientRect()
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      return hit !== null && button.contains(hit)
    })
    expect(onTop, 'nada tapa a "Deshacer"').toBe(true)

    await undo.click()
    await expect(table.getByRole('row')).toHaveCount(3)
    await expect(table.getByRole('row').nth(1)).toContainText('WALMEX.MX')
  })
})

test.describe('shell: accesibilidad (WCAG 2.1 AA)', () => {
  for (const theme of THEMES) {
    test(`axe sin violaciones, tema ${theme === 'light' ? 'claro' : 'oscuro'}`, async ({ page, baseURL }, testInfo) => {
      test.setTimeout(60_000)
      await openShell(page, /** @type {string} */ (baseURL), { theme })
      await page.goto('/portafolio/riesgo')
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await stripReady(page)
      await expectNoAxeViolations(page, `/portafolio/riesgo, tema ${theme}`)

      await page.keyboard.press('Control+k')
      await page.getByRole('combobox', { name: 'Buscar emisora o función' }).fill('wal')
      await expect(page.getByRole('option', { name: /WALMEX\.MX/ })).toBeVisible()
      await expectNoAxeViolations(page, `paleta abierta, tema ${theme}`)
      await page.keyboard.press('Escape')

      if (isMobile(testInfo)) {
        await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Más' }).click()
        await expect(page.getByRole('dialog', { name: 'Más' })).toBeVisible()
        await expectNoAxeViolations(page, `hoja Más, tema ${theme}`)
        await page.keyboard.press('Escape')
      } else {
        await page.getByRole('button', { name: /^Cuenta de / }).click()
        await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible()
        await expectNoAxeViolations(page, `menú de usuario, tema ${theme}`)
        await page.keyboard.press('Escape')
        await page.getByRole('button', { name: 'Plegar barra lateral' }).click()
        await expectNoAxeViolations(page, `barra lateral plegada, tema ${theme}`)
        await page.getByRole('button', { name: 'Expandir barra lateral' }).click()
      }

      // Mercados ya es la ruta nueva: se revisa completa, sin excluir contenido.
      await page.goto('/mercados')
      await appSettled(page)
      await expectNoAxeViolations(page, `/mercados, tema ${theme}`)
    })
  }
})

test.describe('capturas para revisión', () => {
  test.skip(!CAPTURE_DIR, 'Solo con C3_CAPTURE_DIR.')
  for (const theme of THEMES) {
    test(`capturas, tema ${theme === 'light' ? 'claro' : 'oscuro'}`, async ({ page, baseURL }, testInfo) => {
      test.setTimeout(60_000)
      const vp = isMobile(testInfo) ? '390x844' : '1440x900'
      await openShell(page, /** @type {string} */ (baseURL), { theme })
      for (const [route, name] of [
        ['/mercados', 'mercados'],
        ['/portafolio', 'portafolio'],
      ]) {
        await page.goto(route)
        await appSettled(page)
        await stripReady(page)
        await settleAnimations(page)
        await page.screenshot({ path: `${CAPTURE_DIR}/${name}-${vp}-${theme}.png` })
      }
      await page.keyboard.press('Control+k')
      await page.getByRole('combobox', { name: 'Buscar emisora o función' }).fill('wal')
      await expect(page.getByRole('option', { name: /WALMEX\.MX/ })).toBeVisible()
      await settleAnimations(page)
      await page.screenshot({ path: `${CAPTURE_DIR}/paleta-${vp}-${theme}.png` })
    })
  }
})
