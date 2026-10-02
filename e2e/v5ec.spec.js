// V5EC: /mercados/calendario y /mercados/economia con el API simulado (forma de kaizen_api/schemas.py).
// El servidor anuncia solo las capacidades de V5EC. La fixture `guards` tumba la prueba ante
// cualquier console.error, excepción, request fallido o respuesta >= 400. Por página y tema: h1,
// datos, axe WCAG 2.1 AA y sin scroll horizontal, en desktop y mobile. Además: CLS con la respuesta
// demorada y la descarga del .ics.
import AxeBuilder from '@axe-core/playwright'
import { readFile } from 'node:fs/promises'
import { test, expect } from './support/guards.js'
import { V5_CAPABILITIES, setupApp } from './support/app.js'
import { expectNoHorizontalScroll, readLayoutShift, trackLayoutShift } from './support/layout.js'

const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']
const THEMES = /** @type {const} */ (['light', 'dark'])

const meta = (over = {}) => ({ asOf: '2026-09-22', source: 'curated', delayMinutes: null, stale: false, fallback: false, generatedAt: '2026-09-22T14:52:00Z', notes: [], ...over })

const ev = (over) => ({ country: 'MX', kind: 'release', period: null, timeLocal: '06:00', datetimeUtc: null, source: 'curated', seriesId: null, unit: null, previous: null, actual: null, consensus: null, ...over })

const CALENDAR = {
  events: [
    ev({ id: 'bls-jolts-2026-09-22', country: 'US', title: 'Vacantes y rotación laboral (JOLTS)', period: 'jul 2026', date: '2026-09-22', timeLocal: '08:00', datetimeUtc: '2026-09-22T14:00:00Z', source: 'bls' }),
    ev({ id: 'inegi-igae-2026-09-24', title: 'Indicador Global de la Actividad Económica (IGAE)', period: 'jul 2026', date: '2026-09-24', datetimeUtc: '2026-09-24T12:00:00Z' }),
    ev({ id: 'banxico-decision-2026-09-24', kind: 'decision', title: 'Decisión de política monetaria de Banxico', date: '2026-09-24', timeLocal: '13:00', datetimeUtc: '2026-09-24T19:00:00Z', seriesId: 'SF61745', unit: 'fraction', previous: 0.07 }),
    ev({ id: 'inegi-inpc-2026-09-09', title: 'Inflación mensual (INPC)', period: 'ago 2026', date: '2026-09-25', datetimeUtc: '2026-09-25T12:00:00Z', seriesId: 'SP30578', unit: 'fraction', previous: 0.0312, actual: 0.0326 }),
    ev({ id: 'bls-empsit-2026-09-25', country: 'US', title: 'Situación del empleo (nómina no agrícola)', period: 'ago 2026', date: '2026-09-25', timeLocal: '06:30', datetimeUtc: '2026-09-25T12:30:00Z', source: 'bls', seriesId: 'PAYEMS', unit: 'thousandsPersons', previous: -13, actual: 122 }),
  ],
  coverage: { banxicoUntil: '2026-12-17', fomcUntil: '2027-12-08', inegiUntil: '2027-06-24', blsUntil: '2026-12-30' },
  nextDecisions: { banxico: { date: '2026-09-24', daysLeft: 2 }, fed: { date: '2026-10-28', daysLeft: 36 } },
  meta: meta({ source: 'curated,bls,banxico,fred', notes: ['Banxico se reserva el derecho de tomar decisiones fuera de las fechas programadas.'] }),
}

const months = (n, end = 2026 * 12 + 7) => Array.from({ length: n }, (_, i) => {
  const t = end - (n - 1) + i
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}-01`
})
const hist = (start, step, n = 60) => ({ dates: months(n), values: Array.from({ length: n }, (_, i) => Math.round((start + step * i + 0.002 * Math.sin(i / 2)) * 1e6) / 1e6) })
const ind = (over) => {
  const history = over.history
  const last = { date: history.dates.at(-1), value: history.values.at(-1) }
  const previous = { date: history.dates.at(-2), value: history.values.at(-2) }
  return { kind: 'rate', unit: 'fraction', frequency: 'monthly', last, previous, changeYoY: null, changeYoYBp: null, source: 'fred', fallback: false, stale: false, nextRelease: null, ...over }
}
const MX = {
  country: 'mx',
  indicators: [
    ind({ id: 'inflation', label: 'Inflación anual (INPC)', history: hist(0.045, -0.0002), changeYoYBp: -31, seriesId: 'SP30578', source: 'banxico', nextRelease: '2026-10-08' }),
    ind({ id: 'coreInflation', label: 'Inflación subyacente anual', history: hist(0.05, -0.0002), changeYoYBp: -35, seriesId: 'SP74662', source: 'banxico', nextRelease: '2026-10-08' }),
    ind({ id: 'unemployment', label: 'Tasa de desempleo (espejo OCDE)', history: hist(0.03, -0.00005), changeYoYBp: 12, seriesId: 'LRHUTTTTMXM156S' }),
    ind({ id: 'remittances', label: 'Remesas familiares', kind: 'level', unit: 'usdMillions', history: hist(5000, 7), changeYoY: 0.090467, seriesId: 'SE27803', source: 'banxico' }),
    ind({ id: 'reserves', label: 'Reserva internacional', kind: 'level', unit: 'usdMillions', frequency: 'weekly', history: hist(200000, 900), changeYoY: 0.044554, seriesId: 'SF43707', source: 'banxico' }),
  ],
  meta: meta({ source: 'banxico,fred', notes: ['Desempleo y PIB de México vienen de los espejos de la OCDE en FRED, con dos meses o más de rezago.'] }),
}
const US = {
  country: 'us',
  indicators: [
    ind({ id: 'inflation', label: 'Inflación anual (CPI)', history: hist(0.03, 0.00005), changeYoYBp: 41, seriesId: 'CPIAUCSL', nextRelease: '2026-10-14' }),
    ind({ id: 'payrolls', label: 'Nómina no agrícola', kind: 'level', unit: 'thousandsPersons', history: hist(150000, 150), changeYoY: 0.0038, seriesId: 'PAYEMS', nextRelease: '2026-10-02' }),
    ind({ id: 'wti', label: 'Petróleo WTI', kind: 'level', unit: 'usdPerBarrel', frequency: 'daily', history: hist(70, 0.4), changeYoY: 0.49, seriesId: 'DCOILWTICO' }),
  ],
  meta: meta({ source: 'fred' }),
}
const wrow = (country, name, indicator, unit, year, value) => ({ country, name, indicator, unit, year, value })
const WORLD = {
  rows: [
    wrow('MEX', 'México', 'gdpUsd', 'usd', 2025, 1832641364775.52), wrow('USA', 'Estados Unidos', 'gdpUsd', 'usd', 2025, 30769700000000), wrow('BRA', 'Brasil', 'gdpUsd', 'usd', 2025, 2279920092492.13),
    wrow('MEX', 'México', 'gdpGrowth', 'fraction', 2025, 0.005617), wrow('USA', 'Estados Unidos', 'gdpGrowth', 'fraction', 2025, 0.021614), wrow('BRA', 'Brasil', 'gdpGrowth', 'fraction', 2025, 0.022857),
    wrow('MEX', 'México', 'inflation', 'fraction', 2025, 0.038067), wrow('USA', 'Estados Unidos', 'inflation', 'fraction', 2025, null), wrow('BRA', 'Brasil', 'inflation', 'fraction', 2025, 0.050168),
    wrow('MEX', 'México', 'debt', 'fraction', 2024, 0.50271), wrow('USA', 'Estados Unidos', 'debt', 'fraction', 2024, 1.157684), wrow('BRA', 'Brasil', 'debt', 'fraction', 2024, 0.818554),
  ],
  meta: meta({ source: 'worldbank', asOf: '2025-12-31', notes: ['Datos del Banco Mundial bajo licencia CC BY 4.0.'] }),
}

const routes = (delayMs = 0) => ({
  'GET /v2/calendar/economic': { json: CALENDAR, delayMs },
  'GET /v2/macro/indicators': ({ url }) => ({ json: url.searchParams.get('country') === 'us' ? US : MX, delayMs }),
  'GET /v2/macro/world': { json: WORLD, delayMs },
})

async function open(page, baseURL, path, delayMs = 0) {
  await setupApp(page, { baseURL: /** @type {string} */ (baseURL), session: true, capabilities: V5_CAPABILITIES.V5EC, routes: routes(delayMs) })
  await page.goto(path)
}

async function expectNoAxeViolations(page, context) {
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => null))))
  const results = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze()
  const detail = results.violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.map((n) => n.target.join(' ')).slice(0, 6).join('\n    ')}`).join('\n')
  expect(results.violations, `${context}:\n${detail}`).toEqual([])
}

const PAGES = [
  { path: '/mercados/calendario', h1: 'Calendario económico', ready: (page) => page.getByText('Decisión de política monetaria de Banxico') },
  { path: '/mercados/economia', h1: 'Economía de México y Estados Unidos', ready: (page) => page.getByText('Remesas familiares') },
  { path: '/mercados/economia?pais=us', h1: 'Economía de México y Estados Unidos', ready: (page) => page.getByText('Nómina no agrícola') },
]

for (const p of PAGES) {
  for (const theme of THEMES) {
    test(`${p.path} (${theme}): h1, datos, axe AA y sin scroll horizontal`, async ({ page, baseURL }, testInfo) => {
      await page.addInitScript((t) => window.localStorage.setItem('kaizen_theme', t), theme)
      await open(page, baseURL, p.path)
      await expect(page.getByRole('heading', { level: 1, name: p.h1 })).toBeVisible()
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
      await expect(p.ready(page).filter({ visible: true }).first()).toBeVisible()
      await expectNoHorizontalScroll(page)
      await expectNoAxeViolations(page, `${p.path} ${theme} ${testInfo.project.name}`)
    })
  }
}

test('calendario: cuenta regresiva, anterior y publicado por unidad, consenso s/d', async ({ page, baseURL }) => {
  await open(page, baseURL, '/mercados/calendario')
  await expect(page.getByText('2 días')).toBeVisible()
  await expect(page.getByText('36 días')).toBeVisible()
  await expect(page.getByText('+122 mil')).toBeVisible()
  await expect(page.getByText('3.26%')).toBeVisible()
  await expect(page.getByText('7.00%')).toBeVisible()
  await expect(page.getByText(/hasta el 17 dic 2026/)).toBeVisible()
  await expect(page.getByText(/[–—]/)).toHaveCount(0)
})

test('calendario: filtro de país y semana en la URL', async ({ page, baseURL }) => {
  await open(page, baseURL, '/mercados/calendario')
  const req = page.waitForRequest((r) => r.url().includes('/v2/calendar/economic') && r.url().includes('country=us'))
  await page.getByRole('radio', { name: 'EE. UU.' }).check()
  await req
  await expect(page).toHaveURL(/pais=us/)
  await page.getByRole('button', { name: 'Semana siguiente' }).click()
  await expect(page).toHaveURL(/semana=2026-09-28/)
})

test('calendario: Agregar a mi calendario baja un .ics con la hora en UTC', async ({ page, baseURL }) => {
  await open(page, baseURL, '/mercados/calendario')
  await expect(page.getByText('Decisión de política monetaria de Banxico')).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Agregar a mi calendario' }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe('calendario-economico-2026-09-21.ics')
  const text = await readFile(/** @type {string} */ (await file.path()), 'utf8')
  expect(text).toContain('BEGIN:VCALENDAR')
  expect(text).toContain('DTSTART:20260924T190000Z')
})

test('economía: abrir un indicador muestra su historia y el comparador marca s/d', async ({ page, baseURL }) => {
  await open(page, baseURL, '/mercados/economia')
  await page.getByRole('button', { name: 'Ver historia' }).first().click()
  await expect(page.getByRole('heading', { name: 'Inflación anual (INPC) en el tiempo' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Qué es Actividad económica (IGAE)' })).toBeVisible()
  await expect(page.getByText('INEGI sin token').first()).toBeVisible()
  await expect(page.getByRole('cell', { name: 's/d (2025)' })).toBeVisible()
  await expect(page.getByText(/[–—]/)).toHaveCount(0)
})

for (const path of ['/mercados/calendario', '/mercados/economia']) {
  test(`${path}: sin saltos de layout mientras carga (CLS < 0.1)`, async ({ page, baseURL }) => {
    await trackLayoutShift(page)
    await open(page, baseURL, path, 800)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(300)
    expect(await readLayoutShift(page)).toBeLessThan(0.1)
  })
}
