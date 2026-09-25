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
import { expectNoHorizontalScroll } from './support/layout.js'

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

// FactorsResponse (kaizen_api/schemas.py): métricas en fracciones, deuda/capital como razón.
const METRIC_IDS = ['earningsYield', 'fcfYield', 'ebitdaToEv', 'bookToPrice', 'returnOnEquity', 'returnOnAssets', 'operatingMargin', 'debtToEquity', 'momentum12m1', 'volatility', 'revenueGrowth', 'earningsGrowth']
const CHECKS = [
  ['valor', 'Rendimiento de utilidades de 6 % o más', 'earningsYield', '>=', 0.06],
  ['calidad', 'Rendimiento sobre capital de 15 % o más', 'returnOnEquity', '>=', 0.15],
  ['margen', 'Margen operativo de 10 % o más', 'operatingMargin', '>=', 0.1],
  ['deuda', 'Deuda entre capital de 1.0 o menos', 'debtToEquity', '<=', 1.0],
  ['crecimiento', 'Ingresos creciendo 5 % o más', 'revenueGrowth', '>=', 0.05],
  ['momento', 'Momento 12-1 positivo', 'momentum12m1', '>=', 0],
]
const SMALL = 'Su sector tiene menos de 5 emisoras en este universo: se compara contra todo el universo.'
const FX = 'Reporta en USD y cotiza en MXN: las métricas de valor quedan en s/d hasta tener el tipo de cambio.'

/** Renglón del tablero; `m` son las 12 métricas en orden (null = sin dato) y `z` los 5 factores + compuesto. */
function factorRow(symbol, name, sector, m, z, reason = null) {
  const metrics = Object.fromEntries(METRIC_IDS.map((id, i) => [id, m ? m[i] : null]))
  const have = METRIC_IDS.filter((id) => metrics[id] != null).length
  const [value, quality, momentum, lowVol, growth, composite] = z ?? []
  return {
    symbol,
    name,
    sector,
    scores: z ? { value, quality, momentum, lowVol, growth, composite } : null,
    coverage: Math.round((have / 12) * 10000) / 10000,
    excluded: !z,
    reason,
    checks: CHECKS.map(([id, label, metric, op, threshold]) => {
      const v = metrics[metric]
      return { id, label, pass: v == null ? null : op === '>=' ? v >= threshold : v <= threshold, value: v, threshold }
    }),
    metrics,
  }
}

const MX_ROWS = [
  factorRow('Q.MX', 'Quálitas Controladora, S.A.B. de C.V.', 'Servicios financieros', [0.081, 0.09, null, 0.31, 0.29, 0.08, 0.14, 0.2, 0.22, 0.27, 0.12, 0.3], [0.2, 1.8, 0.9, -0.9, 1.2, 0.64], SMALL),
  factorRow('GRUMAB.MX', 'Gruma, S.A.B. de C.V.', 'Consumo básico', [0.058, 0.05, 0.1, 0.3, 0.24, 0.1, 0.13, 0.62, 0.18, 0.2, 0.06, 0.08], [-0.2, 0.9, 1.4, 0.1, 0.6, 0.56]),
  factorRow('GFNORTEO.MX', 'Grupo Financiero Banorte, S.A.B. de C.V.', 'Servicios financieros', [0.11, null, null, 0.62, 0.22, 0.02, 0.48, null, 0.05, 0.25, 0.09, 0.07], [1.3, 1.1, 0.2, -0.3, 0.4, 0.54], SMALL),
  factorRow('AC.MX', 'Arca Continental, S.A.B. de C.V.', 'Consumo básico', [0.055, 0.047, 0.11, 0.42, 0.16, 0.08, 0.15, 0.48, 0.09, 0.18, 0.07, 0.04], [0.1, 0.5, 0.8, 0.2, 0.3, 0.38]),
  factorRow('GAPB.MX', 'Grupo Aeroportuario del Pacífico, S.A.B. de C.V.', 'Industriales', [0.04, 0.03, 0.07, 0.12, 0.41, 0.14, 0.52, 1.9, 0.11, 0.24, 0.13, 0.1], [-0.9, 1.6, 0.5, -0.4, 0.8, 0.32], SMALL),
  factorRow('FEMSAUBD.MX', 'Fomento Económico Mexicano, S.A.B. de C.V.', 'Consumo básico', [0.061, 0.05, 0.1, 0.55, 0.11, 0.05, 0.09, 0.72, 0.12, 0.19, 0.095, 0.2], [0.52, 0.13, 0.44, 0.1, 0.35, 0.31]),
  factorRow('WALMEX.MX', 'Wal-Mart de México, S.A.B. de C.V.', 'Consumo básico', [0.047, 0.041, 0.083, 0.19, 0.27, 0.12, 0.084, 0.55, -0.084, 0.21, 0.071, 0.05], [-0.41, 1.12, -0.35, 0.88, 0.21, 0.29]),
  factorRow('KOFUBL.MX', 'Coca-Cola FEMSA, S.A.B. de C.V.', 'Consumo básico', [0.06, 0.055, 0.12, 0.4, 0.17, 0.09, 0.14, 0.5, -0.02, 0.17, 0.08, 0.03], [0.31, 0.4, -0.2, 0.6, 0.1, 0.24]),
  factorRow('BIMBOA.MX', 'Grupo Bimbo, S.A.B. de C.V.', 'Consumo básico', [0.07, 0.06, 0.13, 0.5, 0.09, 0.03, 0.07, 1.4, -0.21, 0.26, 0.02, -0.1], [0.9, -0.3, -1.1, -0.2, -0.4, -0.22]),
  factorRow('CEMEXCPO.MX', 'CEMEX, S.A.B. de C.V.', 'Materiales', [null, null, null, null, 0.06, 0.03, 0.11, 0.7, 0.04, 0.33, 0.01, -0.2], [null, -0.6, 0.3, -1.2, 0.2, -0.33], FX),
  factorRow('ORBIA.MX', 'Orbia Advance Corporation, S.A.B. de C.V.', 'Materiales', [0.03, null, 0.09, 0.8, 0.02, null, null, 1.3, null, null, null, null], [0.1, -0.2, null, null, null, null], SMALL),
  factorRow('TLEVISACPO.MX', 'Grupo Televisa, S.A.B.', 'Comunicaciones', [null, null, null, 1.2, -0.04, null, 0.05, 1.1, -0.3, null, null, null], null, 'Cobertura de 42 %: hacen falta al menos 50 % de las métricas para compararla.'),
  factorRow('LIVEPOLC-1.MX', 'El Puerto de Liverpool, S.A.B. de C.V.', 'Consumo discrecional', null, null, 'El proveedor no respondió por esta emisora.'),
]
const US_ROWS = [
  factorRow('MSFT', 'Microsoft Corporation', 'Tecnología', [0.03, 0.025, 0.04, 0.08, 0.33, 0.17, 0.45, 0.2, 0.15, 0.22, 0.16, 0.18], [-0.6, 1.5, 0.4, 0.3, 0.9, 0.5]),
  factorRow('AAPL', 'Apple Inc.', 'Tecnología', [0.029, 0.03, 0.035, 0.02, 1.5, 0.28, 0.31, 1.8, 0.08, 0.25, 0.04, 0.09], [-0.8, 1.2, 0.1, 0.1, -0.2, 0.08]),
  factorRow('XOM', 'Exxon Mobil Corporation', 'Energía', [0.08, 0.07, 0.15, 0.55, 0.15, 0.08, 0.13, 0.16, -0.05, 0.24, -0.04, -0.1], [1.1, 0.4, -0.5, 0.2, -1.0, 0.04], SMALL),
]
const FACTOR_META = meta({ asOf: '2026-09-22', source: 'yahoo', delayMinutes: null })
const MX_NOTES = [
  'Sectores con menos de 5 emisoras, comparados contra todo el universo: Comunicaciones, Consumo discrecional, Industriales, Materiales, Servicios financieros.',
  '2 de 13 emisoras quedaron fuera por falta de datos.',
  'El proveedor no respondió por: LIVEPOLC-1.MX.',
]
const METHOD = 'Puntaje z robusto relativo al sector: z = (x menos la mediana) entre 1.4826 por la MAD, recortado a más menos 3.'

/** /v2/screeners/factors por universo; con custom, los renglones de las claves pedidas. */
function factorsFor(universe, symbols) {
  if (universe === 'us') {
    return { universe: { id: 'us', name: 'Estados Unidos, empresas grandes', size: 38 }, method: METHOD, rows: US_ROWS, meta: { ...FACTOR_META, stale: true, asOf: '2026-09-19' } }
  }
  if (universe === 'custom') {
    const list = String(symbols ?? '').split(',').filter(Boolean)
    const all = [...MX_ROWS, ...US_ROWS]
    const rows = list.map((s) => all.find((r) => r.symbol === s) ?? factorRow(s, null, null, null, null, 'El proveedor no respondió por esta emisora.'))
    return { universe: { id: 'custom', name: 'Lista propia', size: list.length }, method: METHOD, rows, meta: FACTOR_META }
  }
  return { universe: { id: 'mx', name: 'México, emisoras grandes de la BMV', size: MX_ROWS.length }, method: METHOD, rows: MX_ROWS, meta: { ...FACTOR_META, notes: MX_NOTES } }
}

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
  'GET /v2/screeners/factors': ({ url }) => ({ json: factorsFor(url.searchParams.get('universe'), url.searchParams.get('symbols')) }),
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
  await expectNoHorizontalScroll(page)
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

  test('Enter mientras llega la búsqueda nueva no abre un resultado de la búsqueda anterior', async ({ page, baseURL }) => {
    await open(page, /** @type {string} */ (baseURL), {
      routes: {
        'GET /v2/search': ({ url }) => {
          const q = url.searchParams.get('q')
          return { json: searchResponse(q), ...(q === 'cemex' ? { delayMs: 1500 } : {}) }
        },
      },
    })
    await page.goto('/investigar')
    const box = searchBox(page)
    await box.fill('walmart')
    await searchReady(page)
    await box.fill('cemex')
    // Ya pasó el retraso del buscador, pero la respuesta de "cemex" todavía no llega: en pantalla
    // siguen los resultados de "walmart".
    await page.waitForTimeout(500)
    await box.press('Enter')
    await expect(page).toHaveURL(/\/investigar\/CEMEXCPO\.MX$/)
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

  test('con un servidor viejo lo dice, no busca y Enter abre la clave tal cual', async ({ page, baseURL }) => {
    const api = await setupApp(page, { baseURL: /** @type {string} */ (baseURL), session: true, health: 'legacy', routes: V2_ROUTES })
    await page.goto('/investigar')
    await expect(page.getByText('La búsqueda por nombre no está disponible con este servidor', { exact: false })).toBeVisible()
    await searchBox(page).fill('walmex.mx')
    await expect(page.getByText('Sin búsqueda por nombre')).toBeVisible()
    await searchBox(page).press('Enter')
    await expect(page).toHaveURL(/\/investigar\/WALMEX\.MX$/)
    expect(api.calls.some((c) => c.startsWith('GET /v2/search'))).toBe(false)
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

// ─── Screener de factores ────────────────────────────────────────────────────

const scoresTable = (page) => page.getByRole('table', { name: /^Puntajes por factor/ })
const bodyRows = (table) => table.locator('tbody tr')

/** El screener de México terminó de cargar. */
async function screenerReady(page) {
  await expect(page.getByRole('heading', { level: 1, name: 'Screener de factores' })).toBeVisible()
  await expect(bodyRows(scoresTable(page))).toHaveCount(11)
}

test.describe('screener de factores', () => {
  test('tablero de México: compuesto, factores con su dato crudo, cobertura, avisos y excluidas', async ({ page, baseURL }, testInfo) => {
    const api = await open(page, /** @type {string} */ (baseURL))
    await page.goto('/screener')
    await screenerReady(page)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    expect(api.calls.some((c) => c.startsWith('GET /v2/screeners/factors?') && c.includes('universe=mx'))).toBe(true)

    const table = scoresTable(page)
    await expect(bodyRows(table).first()).toContainText('Q.MX')
    const walmex = bodyRows(table).filter({ hasText: 'WALMEX.MX' })
    await expect(walmex).toContainText('Wal-Mart de México')
    await expect(walmex).toContainText('+0.29')
    await expect(walmex).toContainText('−0.41')
    await expect(walmex).toContainText('4.7%')
    await expect(walmex).toContainText('12 de 12')
    await expect(walmex.getByRole('link', { name: 'WALMEX.MX' })).toHaveAttribute('href', '/investigar/WALMEX.MX')
    const orbia = bodyRows(table).filter({ hasText: 'ORBIA.MX' })
    await expect(orbia).toContainText('s/d')
    await expect(orbia).toContainText('Contra todo el universo')
    await expect(bodyRows(table).filter({ hasText: 'CEMEXCPO.MX' })).toContainText('Valor en s/d por moneda')
    if (testInfo.project.name === 'desktop') {
      // A 1440 caben todas las columnas de puntajes, cobertura incluida, sin desplazar la tabla.
      const fits = await table.evaluate((t) => t.scrollWidth <= (t.closest('.kz-table-scroll')?.clientWidth ?? 0))
      expect(fits, 'la tabla de puntajes cabe completa a 1440').toBe(true)
    }

    const board = page.getByRole('region', { name: 'Tablero' })
    await expect(board.getByRole('note', { name: 'Avisos del tablero' })).toContainText('Sectores con menos de 5 emisoras')
    await expect(board.getByRole('button', { name: /Al 22 sep/ })).toBeVisible()
    await expect(board.getByText('Reporta en USD y cotiza en MXN', { exact: false })).toBeVisible()
    const out = page.getByRole('region', { name: 'Fuera del tablero', exact: true })
    await expect(out).toContainText('TLEVISACPO.MX')
    await expect(out).toContainText('Cobertura de 42 %')
    await expect(out).toContainText('El proveedor no respondió por esta emisora.')

    // Nada de comprar o vender: ni columnas ni etiquetas.
    await expect(page.getByRole('main').getByText(/\b(compra|compre|vende|venta|comprar|vender)\b/i)).toHaveCount(0)
    await noHorizontalScroll(page)
  })

  test('ordena por encabezado, filtra por sector y la URL lo recuerda', async ({ page, baseURL }) => {
    await open(page, /** @type {string} */ (baseURL))
    await page.goto('/screener')
    await screenerReady(page)
    const table = scoresTable(page)
    await table.getByRole('button', { name: /^Valor/ }).click()
    await expect(table.getByRole('columnheader', { name: /^Valor/ })).toHaveAttribute('aria-sort', 'descending')
    await expect(bodyRows(table).first()).toContainText('GFNORTEO.MX')
    await expect(bodyRows(table).last()).toContainText('CEMEXCPO.MX')

    await page.getByRole('combobox', { name: 'Sector' }).selectOption('Consumo básico')
    await expect(page).toHaveURL(/\/screener\?sector=Consumo/)
    await expect(bodyRows(scoresTable(page))).toHaveCount(6)
    await expect(page.getByRole('region', { name: 'Tablero' })).toContainText('6 en Consumo básico')
    await page.reload()
    await expect(page.getByRole('combobox', { name: 'Sector' })).toHaveValue('Consumo básico')
    await expect(bodyRows(scoresTable(page))).toHaveCount(6)
  })

  test('pruebas con su umbral escrito y métricas crudas, con el teclado en las pestañas', async ({ page, baseURL }, testInfo) => {
    await open(page, /** @type {string} */ (baseURL))
    await page.goto('/screener')
    await screenerReady(page)
    await page.getByRole('tab', { name: 'Pruebas' }).click()
    const checks = page.getByRole('table', { name: 'Pruebas cumple o no cumple' })
    await expect(checks.getByRole('columnheader', { name: /Rendimiento de utilidades de 6 % o más/ })).toBeVisible()
    await expect(checks.getByRole('columnheader', { name: /Deuda entre capital de 1.0 o menos/ })).toBeVisible()
    const walmex = bodyRows(checks).filter({ hasText: 'WALMEX.MX' })
    await expect(walmex).toContainText('No cumple')
    await expect(walmex).toContainText('Cumple')
    await expect(walmex).toContainText('3 de 6')
    if (testInfo.project.name === 'desktop') {
      const fits = await checks.evaluate((t) => t.scrollWidth <= (t.closest('.kz-table-scroll')?.clientWidth ?? 0))
      expect(fits, 'las seis pruebas y el total caben a 1440').toBe(true)
    }
    await expect(bodyRows(checks).filter({ hasText: 'GFNORTEO.MX' })).toContainText('Sin dato')

    await page.getByRole('tab', { name: 'Pruebas' }).press('ArrowRight')
    await expect(page.getByRole('tab', { name: 'Métricas' })).toHaveAttribute('aria-selected', 'true')
    const metrics = page.getByRole('table', { name: 'Métricas crudas' })
    await expect(metrics.getByRole('columnheader', { name: /Deuda \/ capital/ })).toBeVisible()
    await expect(bodyRows(metrics).filter({ hasText: 'WALMEX.MX' })).toContainText('0.55')
    await expect(bodyRows(metrics).filter({ hasText: 'WALMEX.MX' })).toContainText('−8.4%')
    await noHorizontalScroll(page)
  })

  test('Estados Unidos con dato viejo a la vista, y lista propia con validación', async ({ page, baseURL }) => {
    const api = await open(page, /** @type {string} */ (baseURL))
    await page.goto('/screener')
    await screenerReady(page)
    await page.getByRole('radio', { name: 'Estados Unidos' }).click()
    await expect(page.getByRole('radio', { name: 'Estados Unidos' })).toBeChecked()
    await expect(page).toHaveURL(/universo=us/)
    await expect(bodyRows(scoresTable(page)).first()).toContainText('MSFT')
    await expect(page.getByRole('region', { name: 'Tablero' }).getByRole('button', { name: /Dato del 19 sep/ })).toBeVisible()

    await page.getByRole('radio', { name: 'Lista propia' }).click()
    await expect(page.getByRole('radio', { name: 'Lista propia' })).toBeChecked()
    await expect(page.getByRole('heading', { level: 2, name: 'Arma tu lista' })).toBeVisible()
    const input = page.getByRole('textbox', { name: 'Claves de tu lista' })
    await input.fill('AAPL')
    await page.getByRole('button', { name: 'Calcular' }).click()
    await expect(page.getByText(/Escribe de 2 a 50 claves/).first()).toBeVisible()
    await input.fill('aapl, msft, walmex.mx')
    await page.getByRole('button', { name: 'Calcular' }).click()
    await expect(page).toHaveURL(/universo=propia&symbols=AAPL,MSFT,WALMEX\.MX/)
    await expect(bodyRows(scoresTable(page))).toHaveCount(3)
    expect(api.calls.some((c) => c.includes('universe=custom') && c.includes('symbols=AAPL%2CMSFT%2CWALMEX.MX'))).toBe(true)
  })

  test('explica cada factor en texto llano con InfoTip y liga a la metodología', async ({ page, baseURL }) => {
    await open(page, /** @type {string} */ (baseURL))
    await page.goto('/screener')
    await screenerReady(page)
    const guide = page.getByRole('region', { name: 'Qué mide cada factor' })
    for (const term of ['Valor', 'Calidad', 'Momentum', 'Baja volatilidad', 'Crecimiento', 'Compuesto', 'Cobertura']) {
      await expect(guide.getByRole('term').filter({ hasText: term }).first()).toBeVisible()
    }
    await guide.getByRole('button', { name: 'Qué es Valor' }).click()
    await expect(page.getByText('La tendencia histórica de las acciones baratas')).toBeVisible()
    await expect(page.getByRole('link', { name: /Ver más sobre Valor/ })).toHaveAttribute('href', '/aprender/factor-valor')
    await page.keyboard.press('Escape')
    await expect(guide.getByRole('link', { name: 'Metodología completa del screener' })).toHaveAttribute('href', '/aprender/metodologia/screener-de-factores')
    await expect(guide).toContainText('Cómo lo calcula el servidor')
  })
})

// Sin la fixture automática: el screener falla a propósito.
plainTest('screener: si el tablero falla, lo dice y deja reintentar', async ({ page, baseURL }) => {
  const guards = attachGuards(page, { allow: expectedHttpError(503, 'GET', '/v2/screeners/factors', 'la prueba tumba el screener a propósito') })
  await open(page, /** @type {string} */ (baseURL), {
    routes: { 'GET /v2/screeners/factors': { status: 503, json: { error: { code: 'UPSTREAM_UNAVAILABLE', message: 'El proveedor de datos no responde. Intenta en unos minutos.' } } } },
  })
  await page.goto('/screener')
  await expect(page.getByRole('heading', { level: 1, name: 'Screener de factores' })).toBeVisible()
  const board = page.getByRole('region', { name: 'Tablero' })
  await expect(board.getByRole('alert')).toContainText('El proveedor de datos no responde', { timeout: 10_000 })
  await expect(board.getByRole('button', { name: 'Reintentar' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Qué mide cada factor' })).toBeVisible()
  guards.assertClean()
})

/** Abre una pestaña del tablero y espera su tabla. */
const onTab = (tab, table) => async (page) => {
  await screenerReady(page)
  await page.getByRole('tab', { name: tab }).click()
  await expect(page.getByRole('table', { name: table })).toBeVisible()
}

const PAGES = [
  { path: '/investigar?q=walmart', ready: searchReady, name: 'buscador' },
  { path: '/screener', ready: screenerReady, name: 'screener' },
  { path: '/screener', ready: onTab('Pruebas', 'Pruebas cumple o no cumple'), name: 'screener-pruebas' },
  { path: '/screener', ready: onTab('Métricas', 'Métricas crudas'), name: 'screener-metricas' },
]

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
