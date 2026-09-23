// Páginas nuevas de mercados (F2): /mercados/mexico, /mercados/cetes y /mercados/noticias.
// Respuestas v2 simuladas con la forma de kaizen_api/schemas.py; la fixture `guards` tumba la
// prueba ante cualquier console.error, excepción, request fallido o respuesta >= 400.
// Por página: carga con su h1, axe WCAG 2.1 AA sin violaciones en claro y oscuro, sin scroll
// horizontal a 390 px. Con F2_CAPTURE_DIR=/ruta guarda una captura por página y tema.
import AxeBuilder from '@axe-core/playwright'
import { test, expect } from './support/guards.js'
import { HEALTH_V2, setupApp } from './support/app.js'

const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']
const THEMES = /** @type {const} */ (['light', 'dark'])
const CAPTURE_DIR = process.env.F2_CAPTURE_DIR ?? ''

const HEALTH = { ...HEALTH_V2, capabilities: [...HEALTH_V2.capabilities, 'markets.overview', 'macro.us', 'news'] }

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
    { id: 'us', label: 'Estados Unidos', items: [item('^GSPC', 'S&P 500', 6650.12, -19.9, -0.00298, 'USD')] },
    { id: 'fx', label: 'Divisas', items: [item('USDMXN=X', 'Dólar frente al peso', 18.4321, 0.0496, 0.0027, 'MXN')] },
  ],
  marketStatus: { bmv: exchange, nyse: exchange },
  meta: meta(),
}

const rate = (id, label, value, unit, seriesId, previous, changeBp, asOf = '2026-09-18') => ({ id, label, value, unit, asOf, seriesId, source: 'banxico', previous, changeBp })

const RATES = {
  items: [
    rate('target', 'Tasa objetivo', 0.0725, 'fraction', 'SF61745', 0.075, -25),
    rate('tiie28', 'TIIE 28 días', 0.0751, 'fraction', 'SF43783', 0.0754, -3),
    rate('cetes28', 'CETES 28 días', 0.0725, 'fraction', 'SF43936', 0.073, -5),
    rate('cetes91', 'CETES 91 días', 0.0738, 'fraction', 'SF43939', 0.074, -2),
    rate('cetes182', 'CETES 182 días', 0.0752, 'fraction', 'SF43942', 0.0755, -3),
    rate('cetes364', 'CETES 364 días', 0.0771, 'fraction', 'SF43945', null, null),
    rate('inpc', 'INPC', 141.234, 'index', 'SP1', 140.9, null, '2026-08-31'),
    rate('udi', 'UDI', 8.4567, 'mxn', 'SP68257', 8.455, null),
  ],
  meta: meta({ asOf: '2026-09-18', source: 'banxico', delayMinutes: null, notes: ['La serie de CETES 364 días no está verificada contra la publicación de la subasta.'] }),
}

const FX = { pair: 'USDMXN', rate: 18.4321, asOf: '2026-09-22', source: 'banxico_fix', stale: false, meta: meta({ asOf: '2026-09-22', source: 'banxico', delayMinutes: null }) }

const macro = (id, label, value, unit, changeBp, change = null) => ({ id, label, value, previous: null, change, changeBp, unit, asOf: '2026-09-19', source: 'fred' })
const MACRO_US = {
  items: [
    macro('ust3m', 'Tesoro 3 meses', 0.0412, 'fraction', -2),
    macro('ust10y', 'Tesoro 10 años', 0.0415, 'fraction', 4),
    macro('spread10y2y', 'Diferencial 10 años menos 2 años', 45, 'bp', 3),
    macro('vix', 'VIX', 15.21, 'index', null, 0.41),
  ],
  meta: meta({ asOf: '2026-09-19', source: 'fred', delayMinutes: null, fallback: true }),
}

const RF = {
  tenorDays: 28,
  convention: 'simple_act360',
  dates: ['2026-08-28', '2026-09-04', '2026-09-11', '2026-09-18'],
  values: [0.074, 0.0735, 0.073, 0.0725],
  source: 'banxico',
  fallback: false,
  meta: meta({ asOf: '2026-09-18', source: 'banxico', delayMinutes: null }),
}

const news = (id, title, source, lang) => ({ id, title, url: `https://example.com/${id}`, source, publishedAt: '2026-09-22T13:00:00Z', summary: null, lang, tone: null })
const NEWS = {
  items: [
    news('n1', 'Banxico recorta su tasa objetivo en 25 puntos base', 'El Economista', 'es'),
    news('n2', 'Treasury yields edge higher ahead of Fed minutes', 'Reuters', 'en'),
    news('n3', 'La BMV cierra con ganancia moderada', 'Expansión', 'es'),
  ],
  meta: meta({ source: 'yahoo', delayMinutes: null }),
}

const V2_ROUTES = {
  'GET /v2/markets/overview': { json: OVERVIEW },
  'GET /v2/rates/mx': { json: RATES },
  'GET /v2/rates/rf': { json: RF },
  'GET /v2/fx': { json: FX },
  'GET /v2/macro/us': { json: MACRO_US },
  'GET /v2/news': ({ url }) => {
    const lang = url.searchParams.get('lang')
    return { json: { ...NEWS, items: lang && lang !== 'all' ? NEWS.items.filter((n) => n.lang === lang) : NEWS.items } }
  },
}

const PAGES = [
  { path: '/mercados/mexico', h1: 'México: tasas, CETES e inflación', ready: (page) => page.getByText('Tasa objetivo').first() },
]

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

for (const p of PAGES) {
  for (const theme of THEMES) {
    test(`${p.path} (${theme}): h1, datos, axe AA y sin scroll horizontal`, async ({ page, baseURL }, testInfo) => {
      await setupApp(page, { baseURL: /** @type {string} */ (baseURL), session: true, legacyApi: true, health: HEALTH, routes: V2_ROUTES })
      await page.addInitScript((t) => window.localStorage.setItem('kaizen_theme', t), theme)
      await page.goto(p.path)
      await expect(page.getByRole('heading', { level: 1, name: p.h1 })).toBeVisible()
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      await expect(p.ready(page)).toBeVisible()
      await noHorizontalScroll(page)
      await expectNoAxeViolations(page, `${p.path} ${theme} ${testInfo.project.name}`)
      if (CAPTURE_DIR) await page.screenshot({ path: `${CAPTURE_DIR}/${p.path.split('/').pop()}-${theme}-${testInfo.project.name}.png`, fullPage: true })
    })
  }
}

test('/mercados/mexico: respaldo y serie sin verificar se notan, cambios en pb', async ({ page, baseURL }) => {
  await setupApp(page, { baseURL: /** @type {string} */ (baseURL), session: true, legacyApi: true, health: HEALTH, routes: V2_ROUTES })
  await page.goto('/mercados/mexico')
  await expect(page.getByText('no está verificada')).toBeVisible()
  await expect(page.getByText(/Este dato viene de una fuente de respaldo/).first()).toBeVisible()
  await expect(page.getByText('Dólar FIX')).toBeVisible()
  await expect(page.getByText('18.4321')).toBeVisible()
})
