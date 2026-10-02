// Centro de tasas (V5TS): /mercados/tasas con sus tres pestañas y los dos países. Respuestas v2
// simuladas con la forma de kaizen_api/schemas.py; solo se anuncian las capacidades de V5TS. La
// fixture `guards` tumba la prueba ante cualquier console.error, request fallido o respuesta >= 400.
import AxeBuilder from '@axe-core/playwright'
import { test, expect } from './support/guards.js'
import { V5_CAPABILITIES, setupApp, v2Meta } from './support/app.js'
import { expectNoHorizontalScroll, readLayoutShift, trackLayoutShift } from './support/layout.js'

const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']
const meta = (over = {}) => ({ ...v2Meta({ asOf: '2026-09-22', source: 'banxico', delayMinutes: null, generatedAt: '2026-09-22T14:51:31Z' }), ...over })

const mxNode = (tenorDays, label, value, asOf, seriesId, instrument) => ({ tenorDays, label, value, asOf, seriesId, instrument })
const MX_NODES = [
  mxNode(28, '28 días', 0.0625, '2026-09-17', 'SF43936', 'cetes'),
  mxNode(91, '91 días', 0.0666, '2026-09-17', 'SF43939', 'cetes'),
  mxNode(182, '182 días', 0.069, '2026-09-17', 'SF43942', 'cetes'),
  mxNode(364, '364 días', 0.0724, '2026-09-17', 'SF43945', 'cetes'),
  mxNode(1095, '3 años', 0.0824, '2026-09-10', 'SF43883', 'bonoM'),
  mxNode(1825, '5 años', 0.09, '2026-09-17', 'SF43886', 'bonoM'),
  mxNode(3650, '10 años', 0.0916, '2026-08-20', 'SF44071', 'bonoM'),
  mxNode(7300, '20 años', 0.0964, '2026-08-27', 'SF45384', 'bonoM'),
  mxNode(10950, '30 años', null, null, 'SF60696', 'bonoM'),
]
const past = (nodes, delta, asOf) => nodes.map((n) => ({ tenorDays: n.tenorDays, value: n.value == null ? null : Math.round((n.value + delta) * 1e6) / 1e6, asOf }))
const CURVES_MX = {
  country: 'mx',
  nodes: MX_NODES,
  compare: { '1m': past(MX_NODES, -0.001, '2026-08-20'), '1y': past(MX_NODES, 0.006, '2025-09-18') },
  real: [
    { tenorDays: 1095, value: 0.0399, asOf: '2026-09-03', seriesId: 'SF61592' },
    { tenorDays: 7300, value: 0.0461, asOf: '2026-08-27', seriesId: 'SF46958' },
  ],
  breakeven: [
    { tenorDays: 1095, value: 0.040869, simpleBp: 425, nominalAsOf: '2026-09-10', realAsOf: '2026-09-03', dateGapDays: 7 },
    { tenorDays: 7300, value: 0.048083, simpleBp: 503, nominalAsOf: '2026-08-27', realAsOf: '2026-08-27', dateGapDays: 0 },
    { tenorDays: 10950, value: null, simpleBp: null, nominalAsOf: null, realAsOf: '2026-09-17', dateGapDays: null },
  ],
  meta: meta({ asOf: '2026-09-17', notes: ['El Udibono a 10 años no tiene serie de subasta en el SIE, así que ese plazo no tiene tasa real.'] }),
}
const usNode = (tenorDays, label, value, seriesId) => ({ tenorDays, label, value, asOf: '2026-09-22', seriesId, instrument: 'ust' })
const US_NODES = [
  usNode(30, '1 mes', 0.0397, 'DGS1MO'),
  usNode(91, '3 meses', 0.0414, 'DGS3MO'),
  usNode(365, '1 año', 0.0443, 'DGS1'),
  usNode(1095, '3 años', 0.0481, 'TSY-PAR-3Y'),
  usNode(3650, '10 años', 0.0501, 'DGS10'),
  usNode(10950, '30 años', 0.0529, 'DGS30'),
]
const CURVES_US = {
  country: 'us',
  nodes: US_NODES,
  compare: { '1m': past(US_NODES, -0.002, '2026-08-21'), '1y': past(US_NODES, -0.008, '2025-09-22') },
  real: [{ tenorDays: 3650, value: 0.0263, asOf: '2026-09-22', seriesId: 'TSY-REAL-10Y' }],
  breakeven: [{ tenorDays: 3650, value: 0.022928, simpleBp: 236, nominalAsOf: '2026-09-22', realAsOf: '2026-09-22', dateGapDays: 0 }],
  meta: meta({ source: 'fred,treasury' }),
}
const spread = (tenorYears, mx, us, mxAsOf, usAsOf, gap) => ({
  tenorYears, mxSeriesId: 'SF', usSeriesId: 'DGS', mx, us, spreadBp: Math.round((mx - us) * 1e6) / 100, mxAsOf, usAsOf, dateGapDays: gap, asOfMismatch: gap > 7,
})
const SPREADS = {
  rows: [spread(1, 0.0724, 0.0443, '2026-09-17', '2026-09-22', 5), spread(10, 0.0935, 0.0526, '2026-09-20', '2026-09-22', 2), spread(20, 0.0964, 0.0533, '2026-08-27', '2026-09-30', 34)],
  history10y: { dates: ['2025-10-23', '2025-11-27', '2026-01-22', '2026-04-16', '2026-08-20'], valuesBp: [470, 496, 495, null, 447] },
  meta: meta({ source: 'banxico,fred,treasury' }),
}
const mm = (id, label, country, value, convention, change1wBp) => ({
  id, label, country, value, convention, asOf: '2026-09-22', change1dBp: 1, change1wBp, change1mBp: null, seriesId: id.toUpperCase(), source: country === 'MX' ? 'banxico' : 'fred', stale: false,
})
const MONEY = {
  rows: [
    mm('tiie91', 'TIIE a 91 días', 'MX', 0.068134, 'act/360 simple', -8.66),
    mm('dff', 'Fondos federales efectiva', 'US', 0.0388, 'overnight', 25),
    mm('sofr', 'SOFR', 'US', 0.0387, 'overnight', 23),
    mm('ust3m', 'Tesoro a 3 meses', 'US', 0.0414, 'cmt base bono', 7),
  ],
  mxChanges: [{ id: 'target', change1wBp: 0, change1mBp: -25 }],
  meta: meta({ source: 'banxico,fred', notes: ['SOFR: Federal Reserve Bank of New York, Secured Overnight Financing Rate, obtenida de FRED, Federal Reserve Bank of St. Louis.'] }),
}
const RATES_MX = {
  items: [{ id: 'target', label: 'Tasa objetivo', value: 0.0725, unit: 'fraction', asOf: '2026-09-18', seriesId: 'SF61745', source: 'banxico', previous: 0.075, changeBp: -25, verified: true }],
  meta: meta(),
}
const item = (id, label, year, mean, median, unit, verified = true) => ({ id, label, year, mean, median, unit, seriesIdMean: 'SR1', seriesIdMedian: 'SR2', verified })
const EXPECTATIONS = {
  survey: {
    surveyDate: '2026-09-01',
    yearT: 2026,
    items: [
      item('inflationT', 'Inflación al cierre del año', 2026, 0.0385, 0.0387, 'fraction'),
      item('inflationT1', 'Inflación al cierre del año siguiente', 2027, 0.0385, null, 'fraction', false),
      item('fxT', 'Tipo de cambio al cierre del año', 2026, 17.57, 17.5, 'mxnPerUsd'),
    ],
  },
  realRates: { cetes28: 0.0625, observedInflation: 0.0326, exPost: 0.028956, expectedInflation: 0.0387, exAnte: 0.022913 },
  impliedForwards: {
    mx: [
      { fromDays: 0, toDays: 28, rate: 0.0625, vsTargetBp: -25 },
      { fromDays: 28, toDays: 91, rate: 0.068091, vsTargetBp: 30.91 },
    ],
    us: [{ fromDays: 0, toDays: 30, rate: 0.039156, vsDffBp: 3.56, note: 'de rendimientos cmt convertidos a act/360 con x360/365' }],
  },
  meta: meta({ source: 'banxico,fred' }),
}

const ROUTES = {
  'GET /v2/curves': ({ url }) => ({ json: url.searchParams.get('country') === 'us' ? CURVES_US : CURVES_MX }),
  'GET /v2/curves/spreads': { json: SPREADS },
  'GET /v2/money-market': { json: MONEY },
  'GET /v2/rates/mx': { json: RATES_MX },
  'GET /v2/expectations': { json: EXPECTATIONS },
}

async function open(page, baseURL, path, routes = ROUTES) {
  await setupApp(page, { baseURL: /** @type {string} */ (baseURL), session: true, capabilities: V5_CAPABILITIES.V5TS, routes })
  await page.goto(path)
  await expect(page.getByRole('heading', { level: 1, name: 'Tasas y curvas' })).toBeVisible()
}

async function expectNoAxeViolations(page, context) {
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => null))))
  const results = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze()
  const detail = results.violations.map((v) => `${v.id}: ${v.help}\n    ${v.nodes.map((n) => n.target.join(' ')).slice(0, 6).join('\n    ')}`).join('\n')
  expect(results.violations, `${context}:\n${detail}`).toEqual([])
}

const VIEWS = [
  { path: '/mercados/tasas', ready: (page) => page.getByRole('rowheader', { name: '20 años' }).first() },
  { path: '/mercados/tasas?pais=us', ready: (page) => page.getByRole('rowheader', { name: '30 años' }).first() },
  { path: '/mercados/tasas?pestana=dinero', ready: (page) => page.getByRole('rowheader', { name: 'TIIE a 91 días' }) },
  { path: '/mercados/tasas?pais=us&pestana=dinero', ready: (page) => page.getByRole('rowheader', { name: 'SOFR' }) },
  { path: '/mercados/tasas?pestana=expectativas', ready: (page) => page.getByText('Tasa real ex post') },
]

for (const view of VIEWS) {
  for (const theme of ['light', 'dark']) {
    test(`${view.path} (${theme}): datos, axe AA y sin scroll horizontal`, async ({ page, baseURL }, testInfo) => {
      await page.addInitScript((t) => window.localStorage.setItem('kaizen_theme', t), theme)
      await open(page, baseURL, view.path)
      await expect(view.ready(page)).toBeVisible()
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      await expectNoHorizontalScroll(page)
      await expectNoAxeViolations(page, `${view.path} ${theme} ${testInfo.project.name}`)
    })
  }
}

test('curvas: fechas distintas, s/d para lo que falta e inflación implícita', async ({ page, baseURL }) => {
  await open(page, baseURL, '/mercados/tasas')
  await expect(page.getByText('fechas distintas').first()).toBeVisible()
  await expect(page.getByText('+409 pb').or(page.getByText('409 pb')).first()).toBeVisible()
  await expect(page.getByText('4.81%').first()).toBeVisible()
  const row30 = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: '30 años' }) }).first()
  await expect(row30).toContainText('s/d')
  await expect(page.locator('body')).not.toContainText(/[—–]/)
})

test('pestañas y país viven en la URL', async ({ page, baseURL }) => {
  await open(page, baseURL, '/mercados/tasas')
  await page.getByRole('tab', { name: 'Mercado de dinero' }).click()
  await expect(page).toHaveURL(/pestana=dinero/)
  await expect(page.getByRole('rowheader', { name: 'TIIE a 91 días' })).toBeVisible()
  await page.getByRole('radio', { name: 'EE. UU.' }).click()
  await expect(page).toHaveURL(/pais=us/)
  await expect(page.getByRole('radio', { name: 'EE. UU.' })).toBeChecked()
  await expect(page.getByRole('rowheader', { name: 'SOFR' })).toBeVisible()
  await expect(page.getByText(/Federal Reserve Bank of New York/)).toBeVisible()
})

test('mercado de dinero une /v2/rates/mx con /v2/money-market y muestra cambios en pb con signo menos', async ({ page, baseURL }) => {
  await open(page, baseURL, '/mercados/tasas?pestana=dinero')
  await expect(page.getByRole('rowheader', { name: 'Tasa objetivo' })).toBeVisible()
  await expect(page.getByText('−8.66 pb').first()).toBeVisible()
  await expect(page.getByText('Simple act/360').first()).toBeVisible()
})

test('expectativas: año de la encuesta y s/d en la serie sin verificar', async ({ page, baseURL }) => {
  await open(page, baseURL, '/mercados/tasas?pestana=expectativas')
  await expect(page.getByText('Inflación al cierre del año siguiente 2027')).toBeVisible()
  await expect(page.getByText(/Serie sin verificar/)).toBeVisible()
  await expect(page.getByText('3.87%').first()).toBeVisible()
})

test('sin las capacidades de V5TS la página no pide nada y lo dice', async ({ page, baseURL }) => {
  await setupApp(page, { baseURL: /** @type {string} */ (baseURL), session: true, routes: {} })
  await page.goto('/mercados/tasas')
  await expect(page.getByText('Sin datos por ahora')).toBeVisible()
})

test('CLS bajo con respuestas lentas', async ({ page, baseURL }) => {
  await trackLayoutShift(page)
  const slow = Object.fromEntries(Object.entries(ROUTES).map(([k, v]) => [k, typeof v === 'function' ? async (ctx) => ({ ...(await v(ctx)), delayMs: 900 }) : { ...v, delayMs: 900 }]))
  await open(page, baseURL, '/mercados/tasas', slow)
  await expect(page.getByRole('rowheader', { name: '20 años' }).first()).toBeVisible()
  await page.waitForTimeout(500)
  expect(await readLayoutShift(page)).toBeLessThan(0.1)
})
