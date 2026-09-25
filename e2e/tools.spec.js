// Herramientas (F4): /herramientas/simulador. Corre en desktop (1440x900) y mobile (390x844) sobre
// el build de e2e, con las respuestas v2 del shell simuladas. La fixture `guards` tumba la prueba
// ante cualquier console.error, excepción, request fallido o respuesta >= 400.
//
// Capturas para revisión: con F4_CAPTURE_DIR=/ruta la prueba "capturas" guarda la página en los dos
// temas; sin la variable se salta.
import AxeBuilder from '@axe-core/playwright'
import { test, expect } from './support/guards.js'
import { HEALTH_V2, setupApp } from './support/app.js'
import { expectNoHorizontalScroll } from './support/layout.js'

const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']
const THEMES = /** @type {const} */ (['light', 'dark'])
const CAPTURE_DIR = process.env.F4_CAPTURE_DIR ?? ''
const ROUTE = '/herramientas/simulador'

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
const V2_ROUTES = {
  'GET /v2/markets/overview': { json: OVERVIEW },
  'GET /v2/rates/mx': { json: RATES },
  'GET /v2/search': { json: { results: [], meta: meta({ source: 'kaizen', delayMinutes: null }) } },
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} baseURL
 * @param {{ theme?: 'light' | 'dark' }} [options]
 */
async function openSimulator(page, baseURL, { theme } = {}) {
  await setupApp(page, { baseURL, session: true, health: HEALTH, routes: V2_ROUTES })
  if (theme) await page.addInitScript((t) => window.localStorage.setItem('kaizen_theme', t), theme)
  await page.goto(ROUTE)
  await expect(page.getByRole('heading', { level: 1, name: 'Simulador de metas y retiro' })).toBeVisible()
  // La simulación terminó cuando la gráfica ya está dibujada.
  await expect(page.getByRole('figure', { name: /Saldo por año/ })).toBeVisible({ timeout: 15_000 })
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

test.describe('herramientas: simulador', () => {
  test('carga con un h1, resultado, abanico y escenario de retiro', async ({ page, baseURL }) => {
    await openSimulator(page, /** @type {string} */ (baseURL))
    await expect(page.locator('h1')).toHaveCount(1)
    await expect(page.getByText('Probabilidad de llegar a la meta')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Escenario de retiro' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Lee la metodología en Aprender' })).toHaveAttribute('href', '/aprender')
    await noHorizontalScroll(page)
  })

  test('reproduce las respuestas conocidas del spec: 176,729.14 y 180,292.00', async ({ page, baseURL }) => {
    await openSimulator(page, /** @type {string} */ (baseURL))
    const set = async (label, value) => page.getByLabel(label, { exact: true }).fill(value)
    await set('Saldo inicial', '100000')
    await set('Aportación mensual', '5000')
    await set('Crecimiento anual de la aportación', '0')
    await set('Horizonte', '1')
    await set('Inflación anual', '0')
    await set('Rendimiento anual esperado', String((Math.pow(1.01, 12) - 1) * 100))
    await set('Volatilidad anual', '0')
    // Con teclado, como en un grupo de radios nativo: flecha a la derecha pasa a "Pesos del futuro".
    await page.getByRole('radio', { name: 'Pesos de hoy' }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('radio', { name: 'Pesos del futuro' })).toBeChecked()
    const result = page.getByRole('region', { name: 'Resultado al final del horizonte' })
    await expect(result.getByText('$176,729', { exact: false }).first()).toBeVisible()
    await expect(result.getByText('$160,000', { exact: false }).first()).toBeVisible()
    await set('Crecimiento anual de la aportación', String((Math.pow(1.01, 12) - 1) * 100))
    await expect(result.getByText('$180,292', { exact: false }).first()).toBeVisible()
  })

  test('un campo inválido muestra su error y detiene la simulación', async ({ page, baseURL }) => {
    await openSimulator(page, /** @type {string} */ (baseURL))
    await page.getByLabel('Horizonte', { exact: true }).fill('0')
    await expect(page.getByText('Usa un número entero de 1 a 60 años.').first()).toBeVisible()
    await expect(page.getByText('Revisa los campos marcados')).toBeVisible()
  })
})

test.describe('herramientas: accesibilidad (WCAG 2.1 AA)', () => {
  for (const theme of THEMES) {
    test(`simulador sin violaciones de axe, tema ${theme === 'light' ? 'claro' : 'oscuro'}`, async ({ page, baseURL }) => {
      test.setTimeout(60_000)
      await openSimulator(page, /** @type {string} */ (baseURL), { theme })
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await expectNoAxeViolations(page, `${ROUTE}, tema ${theme}`)
      await noHorizontalScroll(page)
    })
  }
})

test.describe('capturas para revisión', () => {
  test.skip(!CAPTURE_DIR, 'solo con F4_CAPTURE_DIR')
  for (const theme of THEMES) {
    test(`capturas, tema ${theme === 'light' ? 'claro' : 'oscuro'}`, async ({ page, baseURL }, testInfo) => {
      await openSimulator(page, /** @type {string} */ (baseURL), { theme })
      await settleAnimations(page)
      await page.screenshot({ path: `${CAPTURE_DIR}/simulador-${testInfo.project.name}-${theme}.png`, fullPage: true })
    })
  }
})
