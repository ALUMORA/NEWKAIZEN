// Investigar, segunda tanda (F3b): el buscador de /investigar y el screener de factores de
// /screener, con respuestas v2 simuladas con la forma de kaizen_api/schemas.py. Corre en desktop
// (1440x900) y mobile (390x844). La fixture `guards` tumba la prueba ante cualquier console.error,
// excepción, request fallido o respuesta >= 400.
//
// Capturas para revisión: con F3B_CAPTURE_DIR=/ruta la prueba "capturas" guarda cada página.
import AxeBuilder from '@axe-core/playwright'
import { test as plainTest } from '@playwright/test'
import { test, expect, attachGuards } from './support/guards.js'
import { HEALTH_V2, expectedHttpError, setupApp } from './support/app.js'
import { RESEARCH_ROUTES, meta } from './support/research-data.js'

// ─── Datos simulados ─────────────────────────────────────────────────────────

const SEARCH_ROWS = [
  { symbol: 'WALMEX.MX', name: 'Wal-Mart de México', exchange: 'BMV', type: 'equity', currency: 'MXN', aliases: ['Walmart de México', 'Walmex'] },
  { symbol: 'WMT', name: 'Walmart Inc.', exchange: 'NYSE', type: 'equity', currency: 'USD', aliases: ['Walmart'] },
  { symbol: 'CEMEXCPO.MX', name: 'CEMEX', exchange: 'BMV', type: 'equity', currency: 'MXN', aliases: ['Cemex'] },
  { symbol: 'FUNO11.MX', name: 'Fibra Uno', exchange: 'BMV', type: 'fibra', currency: 'MXN', aliases: ['FUNO'] },
  { symbol: 'FIBRAMQ12.MX', name: 'Fibra Macquarie', exchange: 'BMV', type: 'fibra', currency: 'MXN', aliases: [] },
  { symbol: 'NAFTRAC.MX', name: 'iShares NAFTRAC', exchange: 'BMV', type: 'etf', currency: 'MXN', aliases: ['IPC'] },
  { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', type: 'equity', currency: 'USD', aliases: ['Apple'] },
]

const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']
const THEMES = /** @type {const} */ (['light', 'dark'])
const CAPTURE_DIR = process.env.F3B_CAPTURE_DIR ?? ''

const HEALTH = { ...HEALTH_V2, capabilities: [...HEALTH_V2.capabilities, 'markets.overview', 'screeners.factors'] }

const fold = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** SearchResponse para /v2/search?q=...: clave, nombre o alias que contengan lo tecleado. */
function searchResponse(q) {
  const needle = fold(q).trim()
  const results = SEARCH_ROWS.filter((r) => [r.symbol, r.name, ...r.aliases].some((t) => fold(t).includes(needle)))
  return { results, meta: meta({ source: 'sec,curated', delayMinutes: null, asOf: '2026-09-22' }) }
}

const V2_ROUTES = {
  ...RESEARCH_ROUTES,
  'GET /v2/search': ({ url }) => ({ json: searchResponse(url.searchParams.get('q')) }),
}

async function open(page, baseURL, { theme, routes = {} } = {}) {
  const api = await setupApp(page, { baseURL, session: true, health: HEALTH, routes: { ...V2_ROUTES, ...routes } })
  if (theme) await page.addInitScript((t) => window.localStorage.setItem('kaizen_theme', t), theme)
  return api
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

const searchBox = (page) => page.getByRole('searchbox', { name: 'Nombre o clave de la emisora' })
const results = (page) => page.getByRole('list', { name: /^Resultados para/ })

/** El buscador con resultados de "walmart". */
async function searchReady(page) {
  await expect(page.getByRole('heading', { level: 1, name: 'Buscar emisora' })).toBeVisible()
  await expect(results(page).getByRole('link')).toHaveCount(2)
}

test.describe('investigar: buscador', () => {
  test('busca por nombre, muestra clave, nombre, bolsa y moneda, y el teclado recorre y abre', async ({ page, baseURL }) => {
    const api = await open(page, /** @type {string} */ (baseURL))
    await page.goto('/investigar')
    await expect(page.getByRole('heading', { level: 1, name: 'Buscar emisora' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.getByText('Todavía no hay recientes')).toBeVisible()

    const box = searchBox(page)
    await box.fill('walmart')
    await searchReady(page)
    const first = results(page).getByRole('link').first()
    await expect(first).toContainText('WALMEX.MX')
    await expect(first).toContainText('Wal-Mart de México')
    await expect(first).toContainText('BMV · MXN')
    await expect(results(page).getByRole('link').nth(1)).toContainText('NYSE · USD')
    await expect(page.getByRole('status').filter({ hasText: '2 resultados para “walmart”.' })).toBeAttached()
    await expect(page.getByRole('region', { name: 'Resultados' }).getByRole('button', { name: /Al 22 sep/ })).toBeVisible()
    await expect(page).toHaveURL(/\/investigar\?q=walmart$/)
    expect(api.calls.some((c) => c.startsWith('GET /v2/search?') && c.includes('q=walmart'))).toBe(true)

    // Flecha abajo baja a los resultados, flechas los recorren, Esc regresa al campo.
    await box.press('ArrowDown')
    await expect(first).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(results(page).getByRole('link').nth(1)).toBeFocused()
    await page.keyboard.press('Home')
    await expect(first).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(box).toBeFocused()

    // Enter abre la que mejor coincide y la deja en recientes.
    await box.press('Enter')
    await expect(page).toHaveURL(/\/investigar\/WALMEX\.MX$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Wal-Mart de México (WALMEX.MX)' })).toBeVisible()
    await page.goBack()
    await expect(searchBox(page)).toHaveValue('walmart')
    await expect(page.getByRole('list', { name: 'Emisoras recientes' }).getByRole('link', { name: /WALMEX\.MX/ })).toBeVisible()
    await noHorizontalScroll(page)
  })

  test('Enter antes de que conteste la búsqueda abre la que mejor coincide, o la clave tal cual', async ({ page, baseURL }) => {
    await open(page, /** @type {string} */ (baseURL))
    await page.goto('/investigar')
    const box = searchBox(page)
    await box.fill('cemex')
    await box.press('Enter')
    await expect(page).toHaveURL(/\/investigar\/CEMEXCPO\.MX$/)
    await page.goto('/investigar')
    await searchBox(page).fill('msft')
    await searchBox(page).press('Enter')
    await expect(page).toHaveURL(/\/investigar\/MSFT$/)
  })

  test('Enter sobre un resultado enfocado abre su ficha', async ({ page, baseURL }) => {
    await open(page, /** @type {string} */ (baseURL))
    await page.goto('/investigar?q=walmart')
    await searchReady(page)
    await results(page).getByRole('link').nth(1).focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/investigar\/WMT$/)
  })

  test('sin resultados lo dice y sugiere escribir la clave', async ({ page, baseURL }) => {
    await open(page, /** @type {string} */ (baseURL))
    await page.goto('/investigar')
    await searchBox(page).fill('zzzz zz')
    await expect(page.getByText('Sin resultados para “zzzz zz”', { exact: true })).toBeVisible()
    await searchBox(page).press('Enter')
    await expect(page.getByText('No encontramos “zzzz zz”', { exact: false })).toBeVisible()
    await expect(page).toHaveURL(/\/investigar\?q=/)
  })

  test('ejemplos llenan el campo y los recientes se pueden borrar', async ({ page, baseURL }) => {
    await open(page, /** @type {string} */ (baseURL))
    await page.addInitScript(() => window.localStorage.setItem('kaizen.recent-symbols', JSON.stringify([{ symbol: 'AMXB.MX', name: 'América Móvil' }])))
    await page.goto('/investigar')
    const recents = page.getByRole('list', { name: 'Emisoras recientes' })
    await expect(recents.getByRole('link', { name: /AMXB\.MX/ })).toHaveAttribute('href', '/investigar/AMXB.MX')
    await page.getByRole('button', { name: 'Borrar recientes' }).click()
    await expect(page.getByText('Todavía no hay recientes')).toBeVisible()
    await page.getByRole('button', { name: 'fibra' }).click()
    await expect(searchBox(page)).toHaveValue('fibra')
    await expect(results(page).getByRole('link', { name: /FUNO11\.MX/ })).toBeVisible()
  })
})

// Sin la fixture automática: la búsqueda falla a propósito.
plainTest('investigar: si la búsqueda falla, lo dice y deja reintentar', async ({ page, baseURL }) => {
  const guards = attachGuards(page, { allow: expectedHttpError(503, 'GET', '/v2/search', 'la prueba tumba la búsqueda a propósito') })
  await open(page, /** @type {string} */ (baseURL), {
    routes: { 'GET /v2/search': { status: 503, json: { error: { code: 'UPSTREAM_UNAVAILABLE', message: 'El proveedor de datos no responde. Intenta en unos minutos.' } } } },
  })
  await page.goto('/investigar?q=walmart')
  const region = page.getByRole('region', { name: 'Resultados' })
  await expect(region.getByRole('alert')).toContainText('El proveedor de datos no responde', { timeout: 10_000 })
  await expect(region.getByRole('button', { name: 'Reintentar' })).toBeVisible()
  guards.assertClean()
})

const PAGES = [{ path: '/investigar?q=walmart', ready: searchReady, name: 'buscador' }]

test.describe('investigar F3b: accesibilidad (WCAG 2.1 AA)', () => {
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

test.describe('capturas F3b para revisión', () => {
  test.skip(!CAPTURE_DIR, 'sin F3B_CAPTURE_DIR')
  for (const theme of THEMES) {
    for (const p of PAGES) {
      test(`captura ${p.name} ${theme}`, async ({ page, baseURL }, testInfo) => {
        await open(page, /** @type {string} */ (baseURL), { theme })
        await page.goto(p.path)
        await p.ready(page)
        await settleAnimations(page)
        await page.screenshot({ path: `${CAPTURE_DIR}/${p.name}-${theme}-${testInfo.project.name}.png`, fullPage: true })
      })
    }
  }
})
