// Páginas nuevas de mercados (F2): /mercados (panorama), /mercados/mexico, /mercados/cetes y
// /mercados/noticias. Respuestas v2 simuladas con la forma de kaizen_api/schemas.py; la fixture
// `guards` tumba la prueba ante cualquier console.error, excepción, request fallido o respuesta >= 400.
// Por página: carga con su h1, axe WCAG 2.1 AA sin violaciones en claro y oscuro, sin scroll
// horizontal a 390 px. Con F2_CAPTURE_DIR=/ruta guarda una captura por página y tema.
import AxeBuilder from '@axe-core/playwright'
import { test as plainTest } from '@playwright/test'
import { test, expect, attachGuards } from './support/guards.js'
import { HEALTH_V2, expectedHttpError, setupApp } from './support/app.js'
import { expectNoHorizontalScroll } from './support/layout.js'

const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']
const THEMES = /** @type {const} */ (['light', 'dark'])
const CAPTURE_DIR = process.env.F2_CAPTURE_DIR ?? ''

const HEALTH = { ...HEALTH_V2, capabilities: [...HEALTH_V2.capabilities, 'markets.overview', 'markets.world', 'macro.us', 'history', 'news'] }

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

const OVERVIEW = {
  groups: [
    { id: 'mx', label: 'México', items: [item('^MXX', 'S&P/BMV IPC', 61234.52, 297.1, 0.00487, 'MXN')] },
    {
      id: 'us',
      label: 'Estados Unidos',
      items: [
        item('^GSPC', 'S&P 500', 6650.12, -19.9, -0.00298, 'USD'),
        item('^IXIC', 'Nasdaq Compuesto', 22480.3, 91.2, 0.00407, 'USD'),
        item('^VIX', 'VIX, volatilidad esperada del S&P 500', 15.21, 0.41, 0.0277, null),
      ],
    },
    {
      id: 'global',
      label: 'Resto del mundo',
      items: [item('^N225', 'Nikkei 225', 44120.5, -310.2, -0.00698, 'JPY'), { ...item('^HSI', 'Hang Seng', null, null, null, 'HKD'), asOf: null }],
    },
    {
      id: 'fx',
      label: 'Divisas',
      items: [item('USDMXN=X', 'Dólar frente al peso', 18.4321, 0.0496, 0.0027, 'MXN'), item('DX-Y.NYB', 'Índice del dólar (DXY)', 97.31, -0.12, -0.00123, null)],
    },
    { id: 'commodities', label: 'Materias primas', items: [item('CL=F', 'Petróleo WTI', 62.48, -1.14, -0.0179, 'USD'), item('GC=F', 'Oro', 3651.2, 22.1, 0.00609, 'USD')] },
    { id: 'crypto', label: 'Cripto', items: [item('BTC-USD', 'Bitcoin', 65210.4, 1340.1, 0.021, 'USD')] },
  ],
  marketStatus: {
    bmv: { open: true, label: 'Abierta. Cierra hoy a las 15:00 h de la Ciudad de México.', nextOpen: '2026-09-23T14:30:00Z', nextClose: '2026-09-22T21:00:00Z' },
    nyse: { open: true, label: 'Abierta. Cierra hoy a las 16:00 h de Nueva York.', nextOpen: '2026-09-23T13:30:00Z', nextClose: '2026-09-22T20:00:00Z' },
  },
  meta: meta({ notes: ['Sin dato en esta actualización de Hang Seng (^HSI); sale como s/d.'] }),
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
    macro('ust2y', 'Tesoro 2 años', 0.037, 'fraction', 1),
    macro('ust10y', 'Tesoro 10 años', 0.0415, 'fraction', 4),
    macro('spread10y2y', 'Diferencial 10 años menos 2 años', 45, 'bp', 3),
    macro('vix', 'VIX', 15.21, 'index', null, 0.41),
    macro('dxy', 'Índice del dólar', 97.3, 'index', null, -0.12),
  ],
  meta: meta({ asOf: '2026-09-19', source: 'fred', delayMinutes: null, fallback: true }),
}

const WORLD = {
  items: [
    { country: '484', symbol: 'EWW', label: 'México', changePct: 0.0061, currency: 'USD', asOf: '2026-09-22' },
    { country: '840', symbol: 'SPY', label: 'Estados Unidos', changePct: -0.0028, currency: 'USD', asOf: '2026-09-22' },
    { country: '076', symbol: 'EWZ', label: 'Brasil', changePct: 0.0115, currency: 'USD', asOf: '2026-09-22' },
    { country: '392', symbol: 'EWJ', label: 'Japón', changePct: -0.0072, currency: 'USD', asOf: '2026-09-22' },
    { country: '276', symbol: 'EWG', label: 'Alemania', changePct: 0.0019, currency: 'USD', asOf: '2026-09-22' },
    { country: '156', symbol: 'MCHI', label: 'China', changePct: null, currency: 'USD', asOf: null },
  ],
  method: 'Variación del ETF de cada país cotizado en dólares (iShares, salvo Estados Unidos con SPY), así que incluye el movimiento de la moneda local frente al dólar.',
  meta: meta({ asOf: '2026-09-22' }),
}

/** Cinco años de cierres diarios del VIX, deterministas (caminata con reversión a 16.5 y saltos esporádicos). */
function vixHistory() {
  const dates = []
  const close = []
  let seed = 7
  let v = 16.5
  for (let t = Date.UTC(2021, 8, 22); t <= Date.UTC(2026, 8, 21); t += 86_400_000) {
    const wd = new Date(t).getUTCDay()
    if (wd === 0 || wd === 6) continue
    seed = (seed * 16807) % 2147483647
    const u = seed / 2147483647
    v = Math.max(11, v + 0.08 * (16.5 - v) + (u - 0.5) * 2.2 + (u > 0.985 ? 6 : 0))
    dates.push(new Date(t).toISOString().slice(0, 10))
    close.push(Math.round(v * 100) / 100)
  }
  return { symbol: '^VIX', currency: 'USD', interval: '1d', adjusted: true, dates, close, fx: null, meta: meta({ asOf: '2026-09-21', delayMinutes: null }) }
}
const VIX_HISTORY = vixHistory()
const VIX_PCTL = Math.round((VIX_HISTORY.close.filter((c) => c <= 15.21).length / VIX_HISTORY.close.length) * 100)

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
  'GET /v2/markets/world': { json: WORLD },
  'GET /v2/history/:symbol': ({ params }) => (params.symbol === '^VIX' ? { json: VIX_HISTORY } : { status: 404, json: { error: { code: 'NOT_FOUND', message: 'Sin historia.' } } }),
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
  { path: '/mercados', h1: 'Mercados', ready: (page) => page.getByText('S&P/BMV IPC sube 0.49% y va en 61,234.52 puntos.') },
  { path: '/mercados/mexico', h1: 'México: tasas, CETES e inflación', ready: (page) => page.getByText('Tasa objetivo').first() },
  { path: '/mercados/noticias', h1: 'Noticias', ready: (page) => page.getByRole('link', { name: /Banxico recorta/ }) },
  { path: '/mercados/cetes', h1: 'Calculadora de CETES', ready: (page) => page.getByRole('rowheader', { name: '364 días' }) },
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
  await expectNoHorizontalScroll(page)
}

for (const p of PAGES) {
  for (const theme of THEMES) {
    test(`${p.path} (${theme}): h1, datos, axe AA y sin scroll horizontal`, async ({ page, baseURL }, testInfo) => {
      await setupApp(page, { baseURL: /** @type {string} */ (baseURL), session: true, health: HEALTH, routes: V2_ROUTES })
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
  await setupApp(page, { baseURL: /** @type {string} */ (baseURL), session: true, health: HEALTH, routes: V2_ROUTES })
  await page.goto('/mercados/mexico')
  await expect(page.getByText('no está verificada')).toBeVisible()
  await expect(page.getByText(/Este dato viene de una fuente de respaldo/).first()).toBeVisible()
  await expect(page.getByText('18.4321').first()).toBeVisible()
})

test('/mercados/cetes: tasa prellenada, 11 % a 28 días da efectiva de 11.75 % y retención sobre el capital', async ({ page, baseURL }) => {
  await setupApp(page, { baseURL: /** @type {string} */ (baseURL), session: true, health: HEALTH, routes: V2_ROUTES })
  await page.goto('/mercados/cetes')
  const rate = page.getByLabel('Tasa anual')
  await expect(rate).toHaveValue(/7\.25/)
  await rate.fill('11')
  await rate.blur()
  const amount = page.getByLabel('Monto a invertir')
  await amount.fill('10000')
  await amount.blur()
  await expect(page.getByText('11.75%').first()).toBeVisible()
  // 10,000 × .11 × 28 / 360 = 85.56; retención 10,000 × .009 × 28 / 365 = 6.90; neto 78.65
  await expect(page.getByText('$85.56').first()).toBeVisible()
  await expect(page.getByText('78.65').first()).toBeVisible()
})

test('/mercados/noticias: liga externa segura, sin resumen ni ánimo, filtro por idioma', async ({ page, baseURL }) => {
  await setupApp(page, { baseURL: /** @type {string} */ (baseURL), session: true, health: HEALTH, routes: V2_ROUTES })
  await page.goto('/mercados/noticias')
  const link = page.getByRole('link', { name: /Banxico recorta/ })
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  await expect(link).toHaveAttribute('href', 'https://example.com/n1')
  await expect(page.getByRole('link', { name: /Treasury yields/ })).toBeVisible()
  await page.getByRole('radio', { name: 'Español' }).check({ force: true })
  await expect(page.getByRole('link', { name: /Treasury yields/ })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /La BMV cierra/ })).toBeVisible()
  await expect(page.getByText(/positivo|negativo/i)).toHaveCount(0)
})

test('/mercados/mexico: la serie de CETES de respaldo (FRED) se marca y el FIX se ve aunque Banxico no traiga series', async ({ page, baseURL }) => {
  const routes = {
    ...V2_ROUTES,
    'GET /v2/rates/mx': { json: { items: [], meta: meta({ asOf: null, source: 'banxico', delayMinutes: null }) } },
    'GET /v2/rates/rf': { json: { ...RF, source: 'fred_ir3tib', fallback: true, meta: meta({ asOf: '2026-09-18', source: 'fred_ir3tib', delayMinutes: null, fallback: true }) } },
  }
  await setupApp(page, { baseURL: /** @type {string} */ (baseURL), session: true, health: HEALTH, routes })
  await page.goto('/mercados/mexico')
  await expect(page.getByText('Sin tasas por ahora')).toBeVisible()
  await expect(page.getByText('18.4321').first()).toBeVisible()
  await expect(page.getByText(/Este dato viene de una fuente de respaldo \(fred_ir3tib\)/)).toBeVisible()
})

test('/mercados/mexico: el FIX sale una sola vez, el Bono M de FRED dice sin verificar y el respaldo del rf no se llama CETES', async ({ page, baseURL }) => {
  const withFix = {
    ...RATES,
    items: [
      ...RATES.items,
      { ...rate('bonoM10', 'Bono M 10 años (serie mensual de la OCDE en FRED)', 0.0861, 'fraction', 'IRLTLT01MXM156N', 0.087, -9, '2026-08-01'), source: 'fred', verified: false },
      rate('fix', 'Tipo de cambio FIX', 18.4321, 'mxn', 'SF43718', 18.41, null),
    ],
  }
  const routes = {
    ...V2_ROUTES,
    'GET /v2/rates/mx': { json: withFix },
    'GET /v2/rates/rf': { json: { ...RF, tenorDays: 91, source: 'fred_ir3tib', fallback: true, meta: meta({ asOf: '2026-09-18', source: 'fred_ir3tib', delayMinutes: null, fallback: true }) } },
  }
  await setupApp(page, { baseURL: /** @type {string} */ (baseURL), session: true, health: HEALTH, routes })
  await page.goto('/mercados/mexico')
  await expect(page.getByText('Serie SF43718')).toBeVisible()
  await expect(page.getByText('Dólar FIX', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Serie IRLTLT01MXM156N, sin verificar contra Banxico')).toBeVisible()
  await expect(page.getByRole('region', { name: 'México' }).getByRole('button', { name: /^Respaldo: fred/ })).toHaveCount(1)
  await expect(page.getByRole('heading', { name: /interbancaria a 3 meses/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'CETES 28 días en el tiempo' })).toHaveCount(0)
})

test('/mercados: quien entra sin portafolio ve los primeros pasos y puede descartarlos', async ({ page, baseURL }) => {
  await setupApp(page, { baseURL: /** @type {string} */ (baseURL), session: true, health: HEALTH, routes: V2_ROUTES })
  await page.goto('/mercados')
  const first = page.getByRole('region', { name: 'Primeros pasos' })
  await expect(first.getByRole('link', { name: 'Ir a la bienvenida' })).toHaveAttribute('href', '/bienvenida')
  await first.getByRole('button', { name: 'Ahora no' }).click()
  await expect(first).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Mercados' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Primeros pasos' })).toHaveCount(0)
})

test('/mercados: bolsas abiertas con retraso, resumen factual, USD/MXN neutral y ligas', async ({ page, baseURL }) => {
  await setupApp(page, { baseURL: /** @type {string} */ (baseURL), session: true, health: HEALTH, routes: V2_ROUTES })
  await page.goto('/mercados')
  await expect(page).toHaveTitle('Mercados · Kaizen')
  const exchanges = page.getByRole('region', { name: 'Estado de las bolsas' })
  await expect(exchanges.getByRole('heading', { name: 'BMV' })).toBeVisible()
  await expect(exchanges.getByRole('heading', { name: 'NYSE' })).toBeVisible()
  await expect(exchanges.getByText('Abierta', { exact: true })).toHaveCount(2)
  await expect(exchanges.getByText('Retraso ~15 min')).toHaveCount(2)
  await expect(exchanges.getByText('Cierra hoy a las 15:00 h de la Ciudad de México.', { exact: false })).toBeVisible()

  const summary = page.getByRole('region', { name: 'Resumen del día' })
  await expect(summary.getByText('S&P/BMV IPC sube 0.49% y va en 61,234.52 puntos.')).toBeVisible()
  await expect(summary.getByText('S&P 500 baja 0.30% y va en 6,650.12 puntos.')).toBeVisible()
  await expect(summary.getByText('El dólar sube 0.27% frente al peso, a 18.4321 pesos por dólar: peso más débil.')).toBeVisible()
  await expect(summary.getByText('Mayor alza: Bitcoin, +2.10%. Mayor baja: Petróleo WTI, −1.79%.')).toBeVisible()
  await expect(summary.getByText('Sin dato en esta actualización: Hang Seng.')).toBeVisible()
  await expect(summary.getByText('Sin dato en esta actualización de Hang Seng (^HSI); sale como s/d.')).toBeVisible()
  // Ni ánimo ni "miedo y codicia" en ningún lado.
  await expect(page.getByText(/sentimiento|codicia|cauteloso|optimista|pesimista/i)).toHaveCount(0)

  // USD/MXN en la tabla: cambio en neutral con pista de texto, nunca verde o rojo.
  const fx = page.getByRole('table', { name: 'Panorama: Divisas' })
  const usd = fx.getByRole('row', { name: /Dólar frente al peso/ })
  await expect(usd.getByText('peso más débil')).toBeVisible()
  await expect(usd.locator('.kz-delta').first()).toHaveAttribute('data-dir', 'neutral')
  await expect(fx.getByRole('row', { name: /Índice del dólar/ }).getByText('dólar más débil')).toBeVisible()
  const hsi = page.getByRole('table', { name: 'Panorama: Resto del mundo' }).getByRole('row', { name: /Hang Seng/ })
  await expect(hsi.getByText('s/d').first()).toBeVisible()

  for (const [name, href] of [
    [/México y tasas/, '/mercados/mexico'],
    [/^CETES/, '/mercados/cetes'],
    [/^Noticias/, '/mercados/noticias'],
  ]) {
    await expect(page.getByRole('navigation', { name: 'Más de mercados' }).getByRole('link', { name })).toHaveAttribute('href', href)
  }
  await page.getByRole('navigation', { name: 'Más de mercados' }).getByRole('link', { name: /^CETES/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Calculadora de CETES' })).toBeVisible()
})

test('/mercados: sin duplicados, VIX con su percentil de cinco años y tasas de EE. UU. en pb', async ({ page, baseURL }) => {
  await setupApp(page, { baseURL: /** @type {string} */ (baseURL), session: true, health: HEALTH, routes: V2_ROUTES })
  await page.goto('/mercados')
  const vix = page.getByRole('region', { name: 'VIX y su percentil' })
  await expect(vix.getByText(`Percentil ${VIX_PCTL}`, { exact: true })).toBeVisible()
  await expect(vix.getByText(`El ${VIX_PCTL}% de los cierres diarios de los últimos 5 años quedó en este nivel o más abajo.`, { exact: false })).toBeVisible()
  await expect(vix.getByText(`${VIX_HISTORY.close.length.toLocaleString('en-US')} cierres diarios`, { exact: false })).toBeVisible()
  await expect(vix.getByRole('figure', { name: 'VIX, cierres diarios de cinco años' })).toBeVisible()

  // El VIX sale una vez: ni en la tabla de EE. UU. ni en las tasas. El DXY solo en Divisas.
  await expect(page.getByRole('rowheader', { name: /VIX/ })).toHaveCount(0)
  const rates = page.getByRole('region', { name: 'Tasas de EE. UU.' })
  await expect(rates.getByText('Tesoro 10 años')).toBeVisible()
  await expect(rates.getByText('+4 pb')).toBeVisible()
  await expect(rates.getByText('VIX', { exact: true })).toHaveCount(0)
  await expect(rates.getByText('Índice del dólar')).toHaveCount(0)
  await expect(page.getByRole('rowheader', { name: /Índice del dólar/ })).toHaveCount(1)
  await expect(rates.getByText(/Este dato viene de una fuente de respaldo \(fred\)/)).toBeVisible()

  const world = page.getByRole('region', { name: 'El mundo en dólares' })
  await expect(world.getByRole('figure', { name: 'Cambio del día por país, en dólares' })).toBeVisible()
  await expect(world.getByText('Sin dato en esta actualización: China.')).toBeVisible()
  await expect(world.getByText(/incluye el movimiento de la moneda local/)).toBeVisible()
})

test('/mercados: bolsas cerradas muestran la fecha de su último cierre', async ({ page, baseURL }) => {
  const closed = (label) => ({ open: false, label, nextOpen: '2026-09-22T14:30:00Z', nextClose: '2026-09-22T21:00:00Z' })
  const onFriday = (g) => ({ ...g, items: g.items.map((it) => ({ ...it, asOf: it.asOf ? '2026-09-18' : null })) })
  const overview = {
    ...OVERVIEW,
    groups: OVERVIEW.groups.map(onFriday),
    marketStatus: { bmv: closed('Cerrada. Abre hoy a las 8:30 h de la Ciudad de México.'), nyse: closed('Cerrada. Abre hoy a las 9:30 h de Nueva York.') },
  }
  await setupApp(page, { baseURL: /** @type {string} */ (baseURL), session: true, health: HEALTH, routes: { ...V2_ROUTES, 'GET /v2/markets/overview': { json: overview } } })
  await page.goto('/mercados')
  const exchanges = page.getByRole('region', { name: 'Estado de las bolsas' })
  await expect(exchanges.getByText('Cerrada', { exact: true })).toHaveCount(2)
  await expect(exchanges.getByText('Cierre vie 18 sep')).toHaveCount(2)
  await expect(page.getByText('S&P/BMV IPC cerró con alza de 0.49%, en 61,234.52 puntos.')).toBeVisible()
})

test('/mercados: sin las capacidades en /health, cada sección lo dice y no pide nada', async ({ page, baseURL }) => {
  const api = await setupApp(page, { baseURL: /** @type {string} */ (baseURL), session: true, health: 'v2', routes: V2_ROUTES })
  await page.goto('/mercados')
  await expect(page.getByRole('heading', { level: 1, name: 'Mercados' })).toBeVisible()
  await expect(page.getByText('Sin panorama por ahora')).toBeVisible()
  await expect(page.getByText('Sin tasas de EE. UU.', { exact: true })).toBeVisible()
  await expect(page.getByText('Sin datos por país', { exact: true })).toBeVisible()
  await expect(page.getByText('El servidor todavía no ofrece este dato. Cuando lo tenga, aparecerá aquí.').first()).toBeVisible()
  expect(api.calls.filter((c) => /\/v2\/(markets|macro|history)/.test(c))).toEqual([])
})

// Sin la fixture automática: esta prueba adjunta sus guardas con permisos explícitos para los 503.
plainTest('/mercados: una sección caída no tumba las demás', async ({ page, baseURL }) => {
  const guards = attachGuards(page, {
    allow: [
      ...expectedHttpError(503, 'GET', '/v2/markets/world', 'la prueba tumba los datos por país a propósito'),
      ...expectedHttpError(503, 'GET', '/v2/history/%5EVIX', 'la prueba tumba la historia del VIX a propósito'),
    ],
  })
  const down = { status: 503, json: { error: { code: 'UPSTREAM_UNAVAILABLE', message: 'El proveedor de datos no responde. Intenta en unos minutos.' } } }
  await setupApp(page, {
    baseURL: /** @type {string} */ (baseURL),
    session: true,
    health: HEALTH,
    routes: { ...V2_ROUTES, 'GET /v2/markets/world': down, 'GET /v2/history/:symbol': down },
  })
  await page.goto('/mercados')
  await expect(page.getByRole('region', { name: 'El mundo en dólares' }).getByRole('alert')).toContainText('No pudimos traer los datos por país', { timeout: 15_000 })
  const vix = page.getByRole('region', { name: 'VIX y su percentil' })
  await expect(vix.getByRole('alert')).toContainText('No pudimos traer la historia del VIX', { timeout: 15_000 })
  await expect(vix.getByText('15.21')).toBeVisible()
  await expect(page.getByText('S&P/BMV IPC sube 0.49% y va en 61,234.52 puntos.')).toBeVisible()
  guards.assertClean()
})

// Sin la fixture automática: las dos fuentes del nivel del VIX caen a propósito.
plainTest('/mercados: si el panorama y las tasas de EE. UU. fallan, el VIX lo dice como error y deja reintentar', async ({ page, baseURL }) => {
  const guards = attachGuards(page, {
    allow: [
      ...expectedHttpError(503, 'GET', '/v2/markets/overview', 'la prueba tumba el panorama a propósito'),
      ...expectedHttpError(503, 'GET', '/v2/macro/us', 'la prueba tumba las tasas de EE. UU. a propósito'),
    ],
  })
  const down = { status: 503, json: { error: { code: 'UPSTREAM_UNAVAILABLE', message: 'El proveedor de datos no responde. Intenta en unos minutos.' } } }
  await setupApp(page, {
    baseURL: /** @type {string} */ (baseURL),
    session: true,
    health: HEALTH,
    routes: { ...V2_ROUTES, 'GET /v2/markets/overview': down, 'GET /v2/macro/us': down },
  })
  await page.goto('/mercados')
  const vix = page.getByRole('region', { name: 'VIX y su percentil' })
  await expect(vix.getByRole('alert')).toContainText('No pudimos traer el nivel del VIX', { timeout: 15_000 })
  await expect(vix.getByRole('button', { name: 'Reintentar' })).toBeVisible()
  await expect(vix.getByText('Sin valor del VIX por ahora')).toHaveCount(0)
  guards.assertClean()
})
