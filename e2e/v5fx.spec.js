// Tipo de cambio (V5FX): /mercados/tipo-de-cambio, /empresas/tipo-de-cambio y /empresas/cobertura
// con respuestas v2 simuladas con la forma exacta del contrato (kaizen_api/schemas.py, extra=forbid).
// Anuncia SOLO las capacidades de V5FX: la encuesta (/v2/expectations, de V5TS) no se anuncia y la
// prueba revisa que no se pida. Corre en desktop (1440x900) y mobile (390x844); la fixture `guards`
// tumba la prueba ante cualquier console.error, excepción, request fallido o respuesta >= 400.
import { readFile } from 'node:fs/promises'
import AxeBuilder from '@axe-core/playwright'
import { test, expect } from './support/guards.js'
import { V5_CAPABILITIES, setupApp } from './support/app.js'
import { expectNoHorizontalScroll, readLayoutShift, trackLayoutShift } from './support/layout.js'

const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

/** Meta completo del contrato (Meta: asOf, source, delayMinutes, stale, fallback, generatedAt, notes). */
const meta = (over = {}) => ({
  asOf: '2026-09-22',
  source: 'banxico',
  delayMinutes: null,
  stale: false,
  fallback: false,
  generatedAt: '2026-09-22T14:52:00Z',
  notes: [],
  ...over,
})

/** Días hábiles (lunes a viernes) hacia atrás desde el 22 sep 2026. */
function businessDays(n) {
  const out = []
  const d = new Date(Date.UTC(2026, 8, 22))
  while (out.length < n) {
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6) out.unshift(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() - 1)
  }
  return out
}

function monitor(years) {
  const dates = businessDays(Math.min(260 * years, 1300))
  const values = dates.map((_, i) => Math.round((18.3 + 0.4 * Math.sin(i / 23) + 0.0004 * i) * 10_000) / 10_000)
  values[values.length - 1] = 18.25
  values[values.length - 2] = 18.1
  return {
    pair: 'USDMXN',
    spot: { value: 18.25, asOf: '2026-09-22', source: 'banxico' },
    range52w: { low: 17.8412, high: 19.1033, percentile: 0.42 },
    changes: { d1: 0.008287, w1: -0.0031, m1: 0.0124, ytd: -0.0456, y1: 0.0212 },
    changesCents: { d1: 15, w1: -5.7, m1: 22.4, ytd: -87.2, y1: 37.9 },
    realizedVol: { d20: 0.0921, d60: 0.1034, d250: 0.1187 },
    monthly: [
      { month: '2026-07', average: 18.4012, min: 18.1, max: 18.72, last: 18.55 },
      { month: '2026-08', average: 18.3311, min: 18.02, max: 18.61, last: 18.2 },
      { month: '2026-09', average: 18.2104, min: 18.05, max: 18.4, last: 18.25 },
    ],
    histogram: [
      { low: -0.02, high: -0.01, count: 6 },
      { low: -0.01, high: 0, count: 118 },
      { low: 0, high: 0.01, count: 124 },
      { low: 0.01, high: 0.02, count: 9 },
    ],
    series: { dates, values },
    cot: { reportDate: '2026-09-15', openInterest: 214_332, nonCommercialNet: 75_167, nonCommercialNetChange: -12_615, leveragedNet: 41_220, assetManagerNet: -8_310 },
    meta: meta({ source: 'banxico,cftc', notes: ['El FIX es el tipo de cambio que publica Banxico cada día hábil.'] }),
  }
}

const cross = (pair, value, over = {}) => ({ pair, value, asOf: '2026-09-22', change1d: 0.0012, change1y: -0.034, source: 'banxico', provider: 'banxico', fallback: false, ...over })
const CROSSES = {
  rows: [
    cross('EURMXN', 21.4402),
    cross('JPYMXN', 0.1271),
    cross('GBPMXN', 24.6612),
    cross('CNYMXN', 2.5714),
    cross('CADMXN', 13.2011, { asOf: '2026-09-19', source: 'frankfurter', provider: 'ecb', fallback: true }),
    cross('BRLMXN', 3.4120, { source: 'frankfurter', provider: 'mezcla' }),
    cross('COPMXN', 0.005461, { source: 'frankfurter', provider: 'mezcla', change1y: null }),
    cross('CLPMXN', 0.01951, { source: 'frankfurter', provider: 'mezcla' }),
    cross('ARSMXN', 0.01402, { source: 'frankfurter', provider: 'mezcla' }),
    cross('PENMXN', 5.1209, { source: 'frankfurter', provider: 'mezcla' }),
  ],
  meta: meta({ source: 'banxico,frankfurter', fallback: true, notes: ['El dólar canadiense del SIE no tiene dato del 22 sep: se tomó la referencia del BCE.'] }),
}

/** Fecha del FIX según la regla, para los casos que usan las pruebas. */
function fixFor(date, rule) {
  if (rule === 'dof') {
    if (date === '2026-10-05') return { fixDate: '2026-10-01', dof: '2026-10-02', value: 18.3 }
    return { fixDate: '2026-09-18', dof: '2026-09-21', value: 18.2 }
  }
  return { fixDate: date, dof: null, value: 18.25 }
}

const fixHandler = ({ url }) => {
  const date = url.searchParams.get('date') ?? ''
  const rule = url.searchParams.get('rule') ?? 'fecha'
  const f = fixFor(date, rule)
  return {
    json: {
      date,
      rule,
      fixDate: f.fixDate,
      value: f.value,
      dofPublicationDate: f.dof,
      explanation: rule === 'dof'
        ? `Con la regla del DOF, el ${date} usa el tipo publicado en el DOF del ${f.dof}, que trae el FIX determinado el ${f.fixDate}.`
        : `Se usa el FIX determinado por Banxico el ${f.fixDate}.`,
      meta: meta(),
    },
  }
}

function eachDay(start, end) {
  const out = []
  const d = new Date(`${start}T00:00:00Z`)
  const e = new Date(`${end}T00:00:00Z`)
  while (d <= e) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

/** @type {string[]} */
let fixTableCalls = []
const fixTableHandler = ({ url }) => {
  fixTableCalls.push(url.search)
  const start = url.searchParams.get('start') ?? ''
  const end = url.searchParams.get('end') ?? ''
  const rule = url.searchParams.get('rule') ?? 'fecha'
  const monthEnd = url.searchParams.get('monthEnd') === 'true'
  const rows = monthEnd ? [] : eachDay(start, end).map((date) => {
    const f = fixFor(date, rule)
    return { date, fixDate: f.fixDate, value: f.value }
  })
  const monthEnds = ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'].map((month, i) => ({
    month,
    fixDate: `${month}-2${i % 8}`,
    value: Math.round((18 + i * 0.05) * 10_000) / 10_000,
    average: Math.round((18.02 + i * 0.05) * 10_000) / 10_000,
  }))
  return { json: { rule, rows, monthEnds: monthEnd ? monthEnds : monthEnds.slice(-1), meta: meta() } }
}

const fwdRow = (days, date, forward, carry) => ({
  days, date, iMxn: 0.0745, iUsd: 0.0419, iMxnSeries: 'SF43783', iUsdSeries: 'DGS3MO', iMxnConvention: 'act/360 simple',
  iUsdConvention: 'cmt convertida x360/365', forward, pointsPips: Math.round((forward - 18.25) * 10_000 * 100) / 100, carryAnnual: carry,
})
const FORWARD = {
  spot: { value: 18.25, asOf: '2026-09-22' },
  rows: [
    fwdRow(30, '2026-10-22', 18.2995, 0.0327),
    fwdRow(91, '2026-12-22', 18.3992, 0.0323),
    fwdRow(182, '2027-03-23', 18.5472, 0.0322),
    fwdRow(365, '2027-09-22', 18.8411, 0.0319),
  ],
  meta: meta({ source: 'banxico,fred', notes: ['Precio teórico sin margen bancario.', 'La tasa del Tesoro es CMT convertida x360/365.'] }),
}

const ROUTES = {
  'GET /v2/fxdesk/monitor': ({ url }) => ({ json: monitor(Number(url.searchParams.get('years') ?? 1)) }),
  'GET /v2/fxdesk/crosses': { json: CROSSES },
  'GET /v2/fxdesk/fix': fixHandler,
  'GET /v2/fxdesk/fix-table': fixTableHandler,
  'GET /v2/fxdesk/forward': { json: FORWARD },
}

async function open(page, baseURL, path) {
  fixTableCalls = []
  const api = await setupApp(page, { baseURL, session: true, capabilities: [...V5_CAPABILITIES.V5FX], routes: ROUTES })
  await page.goto(path)
  return api
}

async function expectNoAxeViolations(page, label) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze()
  const detail = results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`).join('\n')
  expect(results.violations, `${label}\n${detail}`).toEqual([])
}

test.describe('tipo de cambio: monitor del peso', () => {
  test('FIX, rango, historia, histograma, cruces con fuente y respaldo, promedios y CFTC', async ({ page, baseURL }) => {
    const api = await open(page, /** @type {string} */ (baseURL), '/mercados/tipo-de-cambio')
    await expect(page.getByRole('heading', { level: 1, name: 'Tipo de cambio' })).toBeVisible()
    const summary = page.getByRole('region', { name: 'Resumen del FIX' })
    await expect(summary.getByText('18.2500')).toBeVisible()
    await expect(summary.getByText(/\+15\.00/)).toBeVisible()
    await expect(summary.getByText(/peso más débil/)).toBeVisible()
    await expect(summary.getByText('17.8412 a 19.1033')).toBeVisible()
    await expect(summary.getByText(/Percentil 42%/)).toBeVisible()

    const crosses = page.getByRole('table', { name: 'Cruces contra el peso' })
    await expect(crosses.getByRole('row')).toHaveCount(11)
    const cad = crosses.getByRole('row', { name: /Dólar canadiense/ })
    await expect(cad.getByText('respaldo')).toBeVisible()
    await expect(cad.getByText('BCE vía Frankfurter')).toBeVisible()
    await expect(crosses.getByRole('row', { name: /Peso colombiano/ }).getByText('Bancos centrales vía Frankfurter')).toBeVisible()
    await expect(crosses.getByRole('row', { name: /Peso colombiano/ }).getByText('0.005461')).toBeVisible()

    await expect(page.getByRole('table', { name: 'Promedios mensuales del FIX' }).getByRole('row')).toHaveCount(4)
    await expect(page.getByText('+75,167', { exact: true }).first()).toBeVisible()
    await expect(page.getByText(/Cambio en la semana: −12,615/)).toBeVisible()
    await expect(page.getByText(/se tomó la referencia del BCE/)).toBeVisible()

    await page.getByRole('radio', { name: '5 años' }).check({ force: true })
    await expect.poll(() => api.calls.some((c) => c.includes('/v2/fxdesk/monitor?years=5'))).toBe(true)
    await expect(page.getByRole('heading', { name: 'FIX de los últimos 5 años' })).toBeVisible()

    expect(api.calls.some((c) => c.startsWith('GET /v2/expectations'))).toBe(false)
    await expectNoHorizontalScroll(page)
    await expectNoAxeViolations(page, 'monitor del peso')
    api.assertAllMatched()
  })

  test('los datos no empujan la página al llegar (CLS < 0.1)', async ({ page, baseURL }) => {
    await trackLayoutShift(page)
    await open(page, /** @type {string} */ (baseURL), '/mercados/tipo-de-cambio')
    await expect(page.getByRole('table', { name: 'Cruces contra el peso' }).getByRole('row')).toHaveCount(11)
    await expect(page.getByRole('heading', { name: 'Histograma de movimientos diarios' })).toBeVisible()
    expect(await readLayoutShift(page), 'desplazamiento acumulado del layout').toBeLessThan(0.1)
  })
})

test.describe('tipo de cambio: contable', () => {
  test('FIX por fecha y con la regla del DOF, explicación y cierres de mes', async ({ page, baseURL }) => {
    const api = await open(page, /** @type {string} */ (baseURL), '/empresas/tipo-de-cambio')
    await expect(page.getByRole('heading', { level: 1, name: 'Tipo de cambio contable' })).toBeVisible()
    await expect(page.getByText('Se usa el FIX determinado por Banxico el 2026-09-22.')).toBeVisible()
    await expect(page.getByText('18.2500 pesos por dólar')).toBeVisible()
    await expect(page.getByRole('table', { name: 'Cierres de mes del FIX' }).getByRole('row')).toHaveCount(13)

    await page.getByRole('radio', { name: 'Regla del DOF (art. 20 CFF)' }).check({ force: true })
    await expect(page.getByText(/usa el tipo publicado en el DOF del 2026-09-21/)).toBeVisible()
    await expect(page.getByText('Determinado el 18 sep 2026')).toBeVisible()
    await expect(page.getByText(/decisión fiscal de cada empresa/)).toBeVisible()
    await expect.poll(() => fixTableCalls.some((s) => s.includes('rule=dof') && s.includes('monthEnd=true'))).toBe(true)

    await expectNoHorizontalScroll(page)
    await expectNoAxeViolations(page, 'tipo de cambio contable')
    api.assertAllMatched()
  })

  test('conversión por lote: pega el CSV, calcula con la regla del DOF y descarga', async ({ page, baseURL }) => {
    const api = await open(page, /** @type {string} */ (baseURL), '/empresas/tipo-de-cambio')
    await page.getByRole('radio', { name: 'Regla del DOF (art. 20 CFF)' }).check({ force: true })
    await page.getByRole('button', { name: 'Convertir un lote' }).click()
    const dialog = page.getByRole('dialog', { name: 'Convertir un lote a pesos' })
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('O pega el contenido').fill('fecha,monto\n2026-10-05,"1,000"\n2026-10-02,250\n')
    await dialog.getByRole('button', { name: 'Calcular' }).click()
    await expect(dialog.getByRole('status')).toContainText('2 renglones')
    const preview = dialog.getByRole('table', { name: 'Previa del lote convertido' })
    await expect(preview.getByRole('row', { name: /5 oct 2026/ }).getByText('18,300.00')).toBeVisible()
    expect(fixTableCalls.some((s) => s.includes('start=2026-10-02') && s.includes('end=2026-10-05') && s.includes('rule=dof') && s.includes('monthEnd=false'))).toBe(true)
    await expectNoAxeViolations(page, 'diálogo del lote')

    const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Descargar CSV' }).click()])
    expect(download.suggestedFilename()).toBe('fix-lote-dof.csv')
    const text = await readFile(/** @type {string} */ (await download.path()), 'utf8')
    expect(text.replace(/^\uFEFF/, '').split('\r\n')).toEqual([
      'fecha,monto_usd,fix_fecha,tipo_de_cambio,monto_mxn',
      '2026-10-05,1000.00,2026-10-01,18.3000,18300.00',
      '2026-10-02,250.00,2026-09-18,18.2000,4550.00',
      '',
    ])
    api.assertAllMatched()
  })
})

test.describe('tipo de cambio: forward y presupuesto', () => {
  test('forward por plazo con convenciones, presupuesto y sin pedir la encuesta sin su capacidad', async ({ page, baseURL }) => {
    const api = await open(page, /** @type {string} */ (baseURL), '/empresas/cobertura')
    await expect(page.getByRole('heading', { level: 1, name: 'Forward y presupuesto en dólares' })).toBeVisible()
    await expect(page.getByText(/no es cotización ni sugerencia de cubrirse/i).first()).toBeVisible()
    const table = page.getByRole('table', { name: 'Forward teórico por plazo' })
    await expect(table.getByRole('row')).toHaveCount(5)
    await expect(table.getByRole('row', { name: /91 días/ }).getByText('18.3992')).toBeVisible()
    await expect(page.getByText(/Convención en pesos: act\/360 simple/)).toBeVisible()
    await expect(page.getByText(/La encuesta de Banxico todavía no está disponible/)).toBeVisible()

    await page.getByRole('radio', { name: 'SOFR' }).check({ force: true })
    await expect.poll(() => api.calls.some((c) => c.includes('/v2/fxdesk/forward') && c.includes('usd=sofr'))).toBe(true)

    await expect(page.getByRole('heading', { name: 'Forward teórico contra el presupuesto' })).toBeVisible()
    await expect(page.getByRole('table', { name: 'Diferencia contra el presupuesto por mes' }).getByRole('row')).toHaveCount(13)
    await expect(page.getByText('Percentil histórico del presupuesto')).toBeVisible()
    await expect.poll(() => api.calls.some((c) => c.includes('/v2/fxdesk/monitor?years=10'))).toBe(true)

    expect(api.calls.some((c) => c.startsWith('GET /v2/expectations'))).toBe(false)
    await expect(page.getByText(/probabilidad/i)).toHaveCount(0)
    await expectNoHorizontalScroll(page)
    await expectNoAxeViolations(page, 'forward y presupuesto')
    api.assertAllMatched()
  })
})
