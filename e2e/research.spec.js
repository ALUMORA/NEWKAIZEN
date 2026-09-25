// Investigar (F3): ficha de la emisora y comparador, con respuestas v2 simuladas con la forma de
// kaizen_api/schemas.py. Corre en desktop (1440x900) y mobile (390x844). La fixture `guards` tumba
// la prueba ante cualquier console.error, excepción, request fallido o respuesta >= 400.
//
// Capturas para revisión: con F3_CAPTURE_DIR=/ruta la prueba "capturas" guarda cada página.
import AxeBuilder from '@axe-core/playwright'
import { test as plainTest } from '@playwright/test'
import { test, expect, attachGuards } from './support/guards.js'
import { HEALTH_V2, expectedHttpError, setupApp } from './support/app.js'

const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']
const THEMES = /** @type {const} */ (['light', 'dark'])
const CAPTURE_DIR = process.env.F3_CAPTURE_DIR ?? ''

const HEALTH = { ...HEALTH_V2, capabilities: [...HEALTH_V2.capabilities, 'markets.overview'] }

import { DIVIDENDS, INSTRUMENT, RESEARCH_ROUTES, VALUATION, meta } from './support/research-data.js'
import { expectNoHorizontalScroll } from './support/layout.js'

const V2_ROUTES = RESEARCH_ROUTES

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
  await expectNoHorizontalScroll(page)
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

  test('DCF que no aplica: muestra la razón y el resto de la ficha', async ({ page, baseURL }) => {
    await open(page, /** @type {string} */ (baseURL), {
      routes: { 'GET /v2/valuation/:symbol': { json: { ...VALUATION, dcf: { ...VALUATION.dcf, applicable: false, reason: 'El flujo libre es negativo: el DCF no aplica.' } } } },
    })
    await page.goto('/investigar/WALMEX.MX')
    await expect(page.getByText('El flujo libre es negativo: el DCF no aplica.')).toBeVisible()
    await expect(page.getByText('Walmex reporta ventas')).toBeVisible()
  })

  test('emisora del SIC: tipo de cambio usado, DCF en la moneda en que reporta y dato de respaldo visibles', async ({ page, baseURL }) => {
    const sic = {
      ...INSTRUMENT,
      symbol: 'AAPL.MX',
      name: 'Apple (SIC)',
      exchange: 'BMV SIC',
      financialCurrency: 'USD',
      fxUsed: { pair: 'USDMXN', rate: 18.4321, asOf: '2026-09-19' },
      meta: meta({ fallback: true, stale: true, source: 'stooq', asOf: '2026-09-19' }),
    }
    // Lo que escribe kaizen_api/domain/valuation/inputs.py: el DCF va en la moneda de los flujos.
    const warning = 'La empresa reporta en USD y cotiza en MXN. El DCF se hace en USD, que es la moneda de sus flujos, y los múltiplos se comparan en MXN con USDMXN=X a 18.4321.'
    const dcf = { ...VALUATION.dcf, inputs: { ...VALUATION.dcf.inputs, currency: 'USD' }, perShare: 12.34, warnings: [warning, ...VALUATION.dcf.warnings] }
    await open(page, /** @type {string} */ (baseURL), {
      routes: {
        'GET /v2/instrument/:symbol': { json: sic },
        'GET /v2/valuation/:symbol': { json: { ...VALUATION, symbol: 'AAPL.MX', currency: 'MXN', dcf } },
      },
    })
    await page.goto('/investigar/AAPL.MX')
    await expect(page.getByRole('heading', { level: 1, name: 'Apple (SIC) (AAPL.MX)' })).toBeVisible()
    await expect(page.getByText(/se convirtieron a MXN con USDMXN/)).toBeVisible()
    await expect(page.getByRole('region', { name: 'Resumen' }).getByText('18.4321')).toBeVisible()
    await expect(page.getByText(warning)).toBeVisible()
    await expect(page.getByText(/Respaldo/).first()).toBeVisible()
    const valuation = page.getByRole('region', { name: 'Valuación' })
    await expect(valuation.getByText('$12.34 USD')).toBeVisible()
    await expect(valuation.getByText(/El DCF va en USD/)).toBeVisible()
    await expect(valuation.getByRole('table', { name: /valor por acción en USD/ })).toBeVisible()
  })

  test('banco: el P/VL justificado se ve en la ficha y los avisos de cada sección no se esconden', async ({ page, baseURL }) => {
    const bank = { applicable: true, justifiedPB: 1.84, roe: 0.21, costOfEquity: 0.145, growth: 0.06, impliedPrice: 171.23 }
    const note = 'P/VL justificado: El crecimiento terminal (9.00%) deja menos de 2 puntos contra el costo de capital propio (14.50%); se recortó a 12.50%.'
    const divNote = 'Este rendimiento sale de los dividendos pagados en los últimos 12 meses; Yahoo publica 4.45 %.'
    await open(page, /** @type {string} */ (baseURL), {
      routes: {
        'GET /v2/valuation/:symbol': {
          json: {
            ...VALUATION,
            dcf: { ...VALUATION.dcf, applicable: false, reason: 'Se valúa con el P/VL justificado del bloque de bancos.' },
            bank,
            meta: { ...VALUATION.meta, notes: [note] },
          },
        },
        'GET /v2/instrument/:symbol/dividends': { json: { ...DIVIDENDS, meta: { ...DIVIDENDS.meta, notes: [divNote] } } },
      },
    })
    await page.goto('/investigar/WALMEX.MX')
    const valuation = page.getByRole('region', { name: 'Valuación' })
    await expect(valuation.getByRole('heading', { name: 'P/VL justificado' })).toBeVisible()
    await expect(valuation.getByText('1.84x')).toBeVisible()
    await expect(valuation.getByText('$171.23').first()).toBeVisible()
    await expect(valuation.getByRole('note', { name: 'Avisos de la valuación' })).toContainText('se recortó a 12.50%')
    await expect(page.getByRole('note', { name: 'Avisos de los dividendos' })).toContainText('Yahoo publica 4.45 %')
    await noHorizontalScroll(page)
  })
})

test.describe('investigar: supuestos del DCF', () => {
  test('Recalcular manda los supuestos como fracción y conserva los avisos', async ({ page, baseURL }) => {
    /** @type {URLSearchParams[]} */
    const seen = []
    await open(page, /** @type {string} */ (baseURL), {
      routes: {
        'GET /v2/valuation/:symbol': ({ url }) => {
          seen.push(url.searchParams)
          return { json: VALUATION }
        },
      },
    })
    await page.goto('/investigar/WALMEX.MX')
    await instrumentReady(page)
    await page.getByRole('textbox', { name: 'Prima de mercado' }).fill('6')
    await page.getByRole('textbox', { name: 'Años de proyección' }).fill('7')
    await page.getByRole('button', { name: 'Recalcular' }).click()
    await expect.poll(() => seen.some((q) => q.get('erp') === '0.06' && q.get('years') === '7')).toBe(true)
    await expect(page.getByText('El valor terminal pesa 62%')).toBeVisible()
  })
})

test.describe('investigar: supuestos fuera de rango', () => {
  test('un crecimiento terminal de 7 % se detiene en el formulario y no se manda', async ({ page, baseURL }) => {
    /** @type {URLSearchParams[]} */
    const seen = []
    await open(page, /** @type {string} */ (baseURL), {
      routes: {
        'GET /v2/valuation/:symbol': ({ url }) => {
          seen.push(url.searchParams)
          return { json: VALUATION }
        },
      },
    })
    await page.goto('/investigar/WALMEX.MX')
    await instrumentReady(page)
    const tg = page.getByRole('textbox', { name: 'Crecimiento terminal' })
    await tg.fill('7')
    await page.getByRole('button', { name: 'Recalcular' }).click()
    await expect(page.getByText('El crecimiento terminal va de −2 a 6 %.')).toBeVisible()
    await expect(tg).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByRole('table', { name: /Malla de sensibilidad/ })).toBeVisible()
    expect(seen.some((q) => q.has('terminalGrowth'))).toBe(false)
  })
})

plainTest('investigar: si el API rechaza los supuestos, el formulario y los múltiplos siguen y se puede volver', async ({ page, baseURL }) => {
  const guards = attachGuards(page, { allow: expectedHttpError(422, 'GET', '/v2/valuation/WALMEX.MX', 'la prueba rechaza los supuestos a propósito') })
  await open(page, /** @type {string} */ (baseURL), {
    routes: {
      'GET /v2/valuation/:symbol': ({ url }) =>
        url.searchParams.has('erp')
          ? { status: 422, json: { error: { code: 'VALIDATION_ERROR', message: 'Algún supuesto está fuera de rango.' } } }
          : { json: VALUATION },
    },
  })
  await page.goto('/investigar/WALMEX.MX')
  await instrumentReady(page)
  await page.getByRole('textbox', { name: 'Prima de mercado' }).fill('6')
  await page.getByRole('button', { name: 'Recalcular' }).click()
  const valuation = page.getByRole('region', { name: 'Valuación' })
  await expect(valuation.getByRole('alert')).toContainText('fuera de rango', { timeout: 10_000 })
  await expect(valuation.getByRole('form', { name: 'Supuestos del DCF' })).toBeVisible()
  await expect(valuation.getByRole('table', { name: 'Múltiplos contra su referencia sectorial' })).toBeVisible()
  await valuation.getByRole('button', { name: 'Volver a los supuestos del servidor' }).click()
  await expect(valuation.getByRole('alert')).toHaveCount(0)
  await expect(valuation.getByRole('table', { name: /Malla de sensibilidad/ })).toBeVisible()
  guards.assertClean()
})

// Sin la fixture automática: esta prueba adjunta sus guardas con permisos explícitos para los 503.
plainTest('investigar: una sección caída no tumba la ficha', async ({ page, baseURL }) => {
  const guards = attachGuards(page, {
    allow: [
      ...expectedHttpError(503, 'GET', '/v2/valuation/WALMEX.MX', 'la prueba tumba la valuación a propósito'),
      ...expectedHttpError(503, 'GET', '/v2/news', 'la prueba tumba las noticias a propósito'),
    ],
  })
  const down = { status: 503, json: { error: { code: 'UPSTREAM_UNAVAILABLE', message: 'El proveedor de datos no responde. Intenta en unos minutos.' } } }
  await open(page, /** @type {string} */ (baseURL), { routes: { 'GET /v2/valuation/:symbol': down, 'GET /v2/news': down } })
  await page.goto('/investigar/WALMEX.MX')
  await expect(page.getByRole('heading', { level: 1, name: 'Wal-Mart de México (WALMEX.MX)' })).toBeVisible()
  const valuation = page.getByRole('region', { name: 'Valuación' })
  await expect(valuation.getByRole('alert')).toContainText('El proveedor de datos no responde', { timeout: 10_000 })
  await expect(valuation.getByRole('button', { name: 'Reintentar' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Noticias' }).getByRole('alert')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('figure', { name: /Precio de Wal-Mart/ })).toBeVisible()
  await expect(page.getByRole('table', { name: 'Dividendos más recientes' })).toBeVisible()
  guards.assertClean()
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

// Sin la fixture automática: una emisora del comparador falla y las demás siguen.
plainTest('investigar: en el comparador, una emisora que no existe queda como s/d', async ({ page, baseURL }) => {
  const guards = attachGuards(page, { allow: expectedHttpError(404, 'GET', '/v2/instrument/NOPE', 'la prueba pide una emisora que no existe') })
  await open(page, /** @type {string} */ (baseURL), {
    routes: {
      'GET /v2/instrument/:symbol': ({ params }) =>
        params.symbol === 'NOPE' ? { status: 404, json: { error: { code: 'NOT_FOUND', message: 'No encontramos esa emisora.' } } } : { json: INSTRUMENT },
    },
  })
  await page.goto('/investigar/comparar?symbols=WALMEX.MX,NOPE')
  await expect(page.getByRole('heading', { level: 1, name: 'Comparar emisoras' })).toBeVisible()
  await expect(page.getByText('No pudimos cargar NOPE. Sus columnas quedan como s/d.')).toBeVisible()
  await expect(page.getByRole('table', { name: 'Múltiplos y rentabilidad lado a lado' }).getByText('21.4x')).toBeVisible()
  guards.assertClean()
})
