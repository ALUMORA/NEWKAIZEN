// Screeners de la segunda tanda de F3 (F3c): fórmula mágica y FIBRAs, con respuestas v2 simuladas
// con la forma de kaizen_api/schemas.py. Los renglones y las notas salen de lo que el API sirvió
// con los fixtures grabados del 22 sep 2026 (scripts/run_replay_backend.py), recortados.
// Corre en desktop (1440x900) y mobile (390x844). La fixture `guards` tumba la prueba ante
// cualquier console.error, excepción, request fallido o respuesta >= 400.
//
// Capturas para revisión: con F3C_CAPTURE_DIR=/ruta la prueba "capturas" guarda cada página.
import AxeBuilder from '@axe-core/playwright'
import { test as plainTest } from '@playwright/test'
import { test, expect, attachGuards } from './support/guards.js'
import { HEALTH_V2, expectedHttpError, setupApp } from './support/app.js'
import { RESEARCH_ROUTES, meta } from './support/research-data.js'

const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']
const THEMES = /** @type {const} */ (['light', 'dark'])
const CAPTURE_DIR = process.env.F3C_CAPTURE_DIR ?? ''

const HEALTH = { ...HEALTH_V2, capabilities: [...HEALTH_V2.capabilities, 'markets.overview'] }

// ─── Fórmula mágica (MagicResponse) ──────────────────────────────────────────

/** MagicRow; currency y cierre fiscal por omisión, los del universo mx. */
const m = (symbol, name, sector, ebit, enterpriseValue, earningsYield, returnOnCapital, rankEY, rankROC, rank, currency = 'MXN', fiscalPeriodEnd = '2025-12-31') => ({
  symbol, name, sector, ebit, enterpriseValue, earningsYield, returnOnCapital, rankEY, rankROC, rank, currency, fiscalPeriodEnd,
})

const MAGIC_MX = {
  universe: {
    id: 'mx',
    name: 'México, emisoras grandes de la BMV',
    size: 23,
    description:
      'Emisoras grandes de la Bolsa Mexicana de Valores, sin bancos, servicios públicos ni FIBRAs. El EBIT es la utilidad de operación del estado de resultados anual más reciente y el valor de empresa sale de la capitalización de hoy.',
  },
  rows: [
    m('PINFRA.MX', 'Promotora y Operadora de Infraestructura, S.A.B. de C.V.', 'Industriales', 23104448000, 102251259160, 0.226, 0.8346, 1, 4, 5),
    m('ASURB.MX', 'Grupo Aeroportuario del Sureste, S.A.B. de C.V.', 'Industriales', 16993885000, 157956792752, 0.1076, 5.3403, 4, 2, 6),
    m('LIVEPOLC-1.MX', 'El Puerto de Liverpool, S.A.B. de C.V.', 'Consumo discrecional', 29434962000, 170994830768, 0.1721, 0.2476, 2, 10, 12),
    m('AC.MX', 'Arca Continental, S.A.B. de C.V.', 'Consumo básico', 38789584000, 404590105616, 0.0959, 0.4339, 7, 6, 13),
    m('ALSEA.MX', 'Alsea, S.A.B. de C.V.', 'Consumo discrecional', 8405341000, 79465022176, 0.1058, 0.3308, 5, 9, 14),
    m('OMAB.MX', 'Grupo Aeroportuario del Centro Norte, S.A.B. de C.V.', 'Industriales', 8938934000, 97595440432, 0.0916, 2.115, 11, 3, 14),
    m('GAPB.MX', 'Grupo Aeroportuario del Pacífico, S.A.B. de C.V.', 'Industriales', 17493711000, 258884769904, 0.0676, 9.7894, 13, 1, 14),
    m('KIMBERA.MX', 'Kimberly-Clark de México, S.A.B. de C.V.', 'Consumo básico', 12091264000, 129245894160, 0.0936, 0.5762, 10, 5, 15),
    m('WALMEX.MX', 'Wal-Mart de México, S.A.B. de C.V.', 'Consumo básico', 78493750000, 827511829200, 0.0949, 0.3419, 8, 8, 16),
    m('CHDRAUIB.MX', 'Grupo Comercial Chedraui, S.A.B. de C.V.', 'Consumo básico', 15097902000, 125624695480, 0.1202, 0.1901, 3, 14, 17),
    m('AMXB.MX', 'América Móvil, S.A.B. de C.V.', 'Comunicaciones', 190539136000, 1925380161096, 0.099, 0.2248, 6, 12, 18),
    m('KOFUBL.MX', 'Coca-Cola FEMSA, S.A.B. de C.V.', 'Consumo básico', 40615000000, 483753124928, 0.084, 0.4002, 12, 7, 19),
    m('BIMBOA.MX', 'Grupo Bimbo, S.A.B. de C.V.', 'Consumo básico', 39424000000, 418718111552, 0.0942, 0.2247, 9, 13, 22),
    m('FEMSAUBD.MX', 'Fomento Económico Mexicano, S.A.B. de C.V.', 'Consumo básico', 72155000000, 1103028743360, 0.0654, 0.2474, 14, 11, 25),
    m('TLEVISACPO.MX', 'Grupo Televisa, S.A.B.', 'Comunicaciones', 5039385000, 95801068760, 0.0526, 0.0675, 15, 15, 30),
  ],
  excluded: [
    { symbol: 'GRUMAB.MX', reason: 'Reporta en USD y cotiza en MXN: falta el tipo de cambio para no mezclar monedas.' },
    { symbol: 'GFNORTEO.MX', reason: 'La fórmula deja fuera el sector Servicios financieros.' },
    { symbol: 'Q.MX', reason: 'La fórmula deja fuera el sector Servicios financieros.' },
    { symbol: 'BBAJIOO.MX', reason: 'La fórmula deja fuera el sector Servicios financieros.' },
    { symbol: 'GENTERA.MX', reason: 'La fórmula deja fuera el sector Servicios financieros.' },
    { symbol: 'GMEXICOB.MX', reason: 'Reporta en USD y cotiza en MXN: falta el tipo de cambio para no mezclar monedas.' },
    { symbol: 'CEMEXCPO.MX', reason: 'Reporta en USD y cotiza en MXN: falta el tipo de cambio para no mezclar monedas.' },
    { symbol: 'ORBIA.MX', reason: 'Reporta en USD y cotiza en MXN: falta el tipo de cambio para no mezclar monedas.' },
  ],
  partial: false,
  meta: meta({
    asOf: '2026-09-22',
    source: 'yahoo,computed',
    notes: [
      '8 de 23 emisoras quedaron fuera, cada una con su motivo.',
      'La capitalización es del 2026-09-22 y la utilidad de operación del cierre fiscal más reciente de cada emisora (el último, 2025-12-31).',
    ],
  }),
}

const MAGIC_US = {
  universe: {
    id: 'us',
    name: 'Estados Unidos, empresas grandes',
    size: 38,
    description:
      'Emisoras grandes de Estados Unidos, sin bancos, servicios públicos ni bienes raíces. El EBIT es la utilidad de operación del estado de resultados anual más reciente y el valor de empresa sale de la capitalización de hoy.',
  },
  rows: [
    m('HON', 'Honeywell International Inc.', 'Industriales', 6567000000, 90523281024, 0.0725, 0.9761, 3, 8, 11, 'USD', '2025-12-31'),
    m('PG', 'The Procter & Gamble Company', 'Consumo básico', 19748000000, 369202798976, 0.0535, 1.3643, 12, 4, 16, 'USD', '2026-06-30'),
    m('MRK', 'Merck & Co., Inc.', 'Salud', 22107000000, 409235627904, 0.054, 0.7749, 10, 9, 19, 'USD', '2025-12-31'),
    m('PEP', 'PepsiCo, Inc.', 'Consumo básico', 13491000000, 219214156480, 0.0615, 0.495, 8, 13, 21, 'USD', '2025-12-31'),
    m('CMCSA', 'Comcast Corporation', 'Comunicaciones', 20670000000, 171068572736, 0.1208, 0.3552, 1, 21, 22, 'USD', '2025-12-31'),
    m('DIS', 'The Walt Disney Company', 'Comunicaciones', 13832000000, 223711940416, 0.0618, 0.4272, 7, 16, 23, 'USD', '2025-09-30'),
    m('LOW', "Lowe's Companies, Inc.", 'Consumo discrecional', 10153000000, 152626440640, 0.0665, 0.3858, 5, 19, 24, 'USD', '2026-01-31'),
    m('HD', 'The Home Depot, Inc.', 'Consumo discrecional', 20890000000, 365026797632, 0.0572, 0.4294, 9, 15, 24, 'USD', '2026-01-31'),
  ],
  excluded: [
    { symbol: 'ADBE', reason: 'El capital empleado no es positivo: la fórmula no aplica.' },
    { symbol: 'ABBV', reason: 'El capital empleado no es positivo: la fórmula no aplica.' },
  ],
  partial: false,
  meta: meta({
    asOf: '2026-09-22',
    source: 'yahoo,computed',
    notes: [
      '2 de 38 emisoras quedaron fuera, cada una con su motivo.',
      'Los cierres fiscales van de 2025-08-31 a 2026-06-30: no todas comparan el mismo periodo.',
    ],
  }),
}

const EBIT_NOTE =
  'Sin utilidad de operación reportada, se usó el renglón EBIT de Yahoo (antes de impuestos más intereses), que puede incluir partidas no operativas: AMXB.MX.'

// ─── FIBRAs (FibrasResponse) ─────────────────────────────────────────────────

// prettier-ignore
const f = (symbol, name, type, price, marketCap, distributionYield, capRate, navPerCbfi, pNav, ltv, debtToMarketCap, cashFlowYield, cashFlowBasis, spreadVsCetes, signal, financialCurrency) => ({
  symbol, name, type, price, currency: 'MXN', financialCurrency, marketCap, distributionYield, capRate, navPerCbfi, pNav, ltv,
  debtToMarketCap, cashFlowYield, cashFlowBasis, spreadVsCetes, signal,
})

const FMTY_NOTE =
  'FMTY14.MX: LTV, deuda entre capitalización, cap rate y flujo van en s/d porque los estados financieros que publica Yahoo no son de esta FIBRA o ya no la describen. Yahoo la clasifica como banco (Banks - Regional), así que sirve los datos del fiduciario; su balance es idéntico al de FHIPO14.MX, así que es el del fiduciario que comparten; su último cierre anual es del 2023-12-31, de hace más de 18 meses.'

const FIBRAS = {
  rows: [
    f('FSHOP13.MX', 'Fibra Shop', 'propiedades', 11.89, 7400496640, 0.0634, 0.0951, 27.0, 0.4404, 0.385, 1.6725, 0.255, 'ocf', -0.0045, 'descuento', 'MXN'),
    f('FINN13.MX', 'Fibra Inn', 'propiedades', 4.6, 3336424704, 0.0783, 0.0401, 10.129, 0.4541, 0.2806, 1.134, 0.1723, 'ocf', 0.0104, 'descuento', 'MXN'),
    f('FUNO11.MX', 'Fibra Uno', 'propiedades', 29.49, 112376061952, 0.086, 0.0829, 50.198, 0.5875, 0.3594, 1.3269, 0.169, 'ocf', 0.0181, 'descuento', 'MXN'),
    f('FHIPO14.MX', 'Fibra Hipotecaria (FHipo)', 'hipotecaria', 14.1, 67748077568, 0.1011, null, 23.896, 0.5901, null, null, null, null, 0.0332, 'descuento', 'MXN'),
    f('DANHOS13.MX', 'Fibra Danhos', 'propiedades', 29.16, 47204077568, 0.0617, null, 40.38, 0.7221, null, null, 0.1212, 'ocf', -0.0062, 'descuento', 'MXN'),
    f('FIBRAMQ12.MX', 'Fibra Macquarie México', 'propiedades', 43.55, 34722910208, 0.0844, 0.0677, 52.03, 0.837, 0.3222, 0.5948, 0.0831, 'ocf', 0.0165, 'descuento', 'MXN'),
    f('STORAGE18.MX', 'Fibra Storage', 'propiedades', 25.39, null, 0.0357, null, 27.604, 0.9198, null, null, null, null, -0.0322, 'en_linea', 'MXN'),
    f('FMTY14.MX', 'Fibra Mty', 'propiedades', 14.06, 34943037440, 0.0704, null, 13.271, 1.0595, null, null, null, null, 0.0025, 'en_linea', 'MXN'),
    f('FNOVA17.MX', 'Fibra Nova', 'propiedades', 40.78, 13691027456, 0.0604, null, 29.112, 1.4008, null, null, null, null, -0.0075, 'prima', 'MXN'),
    f('FIBRAPL14.MX', 'Fibra Prologis', 'propiedades', 74.38, 124081029120, 0.038, null, null, null, 0.251, null, null, null, -0.0299, 'sin_datos', 'USD'),
  ],
  cetes28: 0.0679,
  meta: meta({
    asOf: '2026-09-22',
    source: 'yahoo,computed,fred',
    fallback: true,
    notes: [
      'El NAV por CBFI es el valor en libros que reporta la FIBRA, no un avalúo independiente. Bajo IFRS los inmuebles ya van a valor razonable, así que se le parece, pero no es lo mismo.',
      'Señal por P/NAV: descuento abajo de 0.90, prima arriba de 1.10 y en línea entre las dos. Es una descripción del precio contra libros, no una recomendación de inversión.',
      'El rendimiento por distribución suma lo que cada FIBRA pagó en los últimos 12 meses y lo divide entre el precio de hoy; no es el rendimiento proyectado que publica Yahoo.',
      'El campo cetes28 y el diferencial usan una tasa sustituta, no CETES de 28 días: la tasa interbancaria de México a 91 días de la OCDE en FRED, promedio mensual, dato del 2026-08-01. Sirve como referencia de corto plazo mientras el servidor no tenga CETES de Banxico.',
      'Falta el token de Banxico (BANXICO_TOKEN) para servir CETES del SIE.',
      'FNOVA17.MX: LTV, deuda entre capitalización, cap rate y flujo van en s/d porque los estados financieros que publica Yahoo no son de esta FIBRA o ya no la describen. Su balance reporta 432.2 millones de CBFIs contra 335.7 millones que Yahoo le cuenta a la FIBRA.',
      'DANHOS13.MX: LTV, deuda entre capitalización y cap rate van en s/d porque la deuda de su balance (11.7 millones) no cuadra con la que Yahoo le reporta (11,579.2 millones).',
      FMTY_NOTE,
      'Sin NAV para calcular P/NAV: FIBRAPL14.MX.',
      'Reportan en otra moneda que la de cotización, así que sus razones quedan en s/d: FIBRAPL14.MX.',
      'Los precios son del 2026-09-22; la tasa de referencia, del 2026-08-01; los estados financieros cierran a más tardar el 2025-12-31.',
    ],
  }),
}

const SCREENER_ROUTES = {
  'GET /v2/screeners/magic': ({ url }) => ({ json: url.searchParams.get('universe') === 'us' ? MAGIC_US : MAGIC_MX }),
  'GET /v2/screeners/fibras': { json: FIBRAS },
}

// ─── Ayudas ──────────────────────────────────────────────────────────────────

async function open(page, baseURL, { theme, routes = {} } = {}) {
  const api = await setupApp(page, { baseURL, session: true, health: HEALTH, routes: { ...RESEARCH_ROUTES, ...SCREENER_ROUTES, ...routes } })
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

/** La tabla de un DataTable por su caption; `row(symbol)` es el renglón de esa clave. */
function tableOf(page, caption) {
  const table = page.getByRole('table', { name: caption })
  return { table, row: (symbol) => table.getByRole('row').filter({ has: page.getByRole('link', { name: symbol, exact: true }) }) }
}

async function magicReady(page) {
  await expect(page.getByRole('heading', { level: 1, name: 'Fórmula Mágica' })).toBeVisible()
  await expect(tableOf(page, 'Ranking de la fórmula mágica').row('PINFRA.MX')).toBeVisible()
  await expect(page.getByRole('heading', { level: 3, name: /Emisoras que quedaron fuera/ })).toBeVisible()
}

async function fibrasReady(page) {
  await expect(page.getByRole('heading', { level: 1, name: 'FIBRAs' })).toBeVisible()
  await expect(tableOf(page, 'FIBRAs ordenadas por P/NAV').row('FSHOP13.MX')).toBeVisible()
  await expect(page.getByRole('figure', { name: 'Diferencial por FIBRA' })).toBeVisible()
}

const PAGES = [
  { path: '/screener/formula-magica', ready: magicReady, name: 'formula-magica' },
  { path: '/screener/fibras', ready: fibrasReady, name: 'fibras' },
]

// ─── Fórmula mágica ──────────────────────────────────────────────────────────

test.describe('screener: fórmula mágica', () => {
  test('México por omisión: ranking con empates, exclusiones con motivo y notas', async ({ page, baseURL }) => {
    /** @type {string[]} */
    const universes = []
    await open(page, /** @type {string} */ (baseURL), {
      routes: {
        'GET /v2/screeners/magic': ({ url }) => {
          universes.push(String(url.searchParams.get('universe')))
          return { json: MAGIC_MX }
        },
      },
    })
    await page.goto('/screener/formula-magica')
    await magicReady(page)
    await expect(page).toHaveTitle('Fórmula Mágica · Kaizen')
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    expect(universes).toEqual(['mx'])
    await expect(page.getByRole('radio', { name: 'México (BMV)' })).toBeChecked()

    const { table, row } = tableOf(page, 'Ranking de la fórmula mágica')
    await expect(table.getByRole('row')).toHaveCount(16)
    await expect(table.getByRole('row').nth(1)).toContainText('PINFRA.MX')
    await expect(row('PINFRA.MX')).toContainText('22.6%')
    await expect(row('PINFRA.MX')).toContainText('83.5%')
    // ALSEA, OMAB y GAPB suman 14: comparten lugar y lo dicen con texto.
    for (const s of ['ALSEA.MX', 'OMAB.MX', 'GAPB.MX']) await expect(row(s)).toContainText('14 (empate)')
    await expect(row('PINFRA.MX')).not.toContainText('(empate)')
    await expect(page.getByText('3 emisoras comparten su suma de lugares con otra')).toBeVisible()
    await expect(table.getByRole('columnheader', { name: /Suma de lugares/ })).toHaveAttribute('aria-sort', 'ascending')

    const out = page.getByRole('region', { name: 'Fuera del ranking' })
    await expect(out.getByRole('heading', { level: 3, name: 'Emisoras que quedaron fuera (8)' })).toBeVisible()
    await expect(out.getByText('La fórmula deja fuera el sector Servicios financieros.')).toBeVisible()
    await expect(out.getByText('GFNORTEO.MX, Q.MX, BBAJIOO.MX, GENTERA.MX')).toBeVisible()
    await expect(out.getByText(/^Financieras: bancos, aseguradoras/)).toBeVisible()
    await expect(out.getByText(/^Utilidad de operación de cero o negativa/)).toBeVisible()
    await expect(out.getByText(/el EBIT nunca se estima/)).toBeVisible()
    await expect(out.getByText(/^Sector inmobiliario y FIBRAs/)).toBeVisible()
    await expect(page.getByRole('region', { name: 'Notas del cálculo' }).getByText('8 de 23 emisoras quedaron fuera, cada una con su motivo.')).toBeVisible()
    await expect(page.getByText(/compra|vende|aprovecha/i)).toHaveCount(0)
    await noHorizontalScroll(page)
  })

  test('con el teclado se cambia a Estados Unidos y el universo queda en la URL', async ({ page, baseURL }) => {
    /** @type {string[]} */
    const universes = []
    await open(page, /** @type {string} */ (baseURL), {
      routes: {
        'GET /v2/screeners/magic': ({ url }) => {
          const u = String(url.searchParams.get('universe'))
          universes.push(u)
          return { json: u === 'us' ? MAGIC_US : MAGIC_MX }
        },
      },
    })
    await page.goto('/screener/formula-magica')
    await magicReady(page)
    await page.getByRole('radio', { name: 'México (BMV)' }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('radio', { name: 'Estados Unidos' })).toBeChecked()
    await expect(page).toHaveURL(/\/screener\/formula-magica\?universo=us$/)
    const { row } = tableOf(page, 'Ranking de la fórmula mágica')
    await expect(row('HON')).toBeVisible()
    await expect(row('HON')).toContainText('USD')
    for (const s of ['LOW', 'HD']) await expect(row(s)).toContainText('24 (empate)')
    await expect(page.getByText('Los cierres fiscales van de 2025-08-31 a 2026-06-30: no todas comparan el mismo periodo.')).toBeVisible()
    expect(universes).toEqual(['mx', 'us'])

    await page.reload()
    await expect(page.getByRole('radio', { name: 'Estados Unidos' })).toBeChecked()
    await expect(row('HON')).toBeVisible()
  })

  test('EBIT de respaldo y tabla incompleta quedan a la vista', async ({ page, baseURL }) => {
    const partial = { ...MAGIC_MX, partial: true, meta: { ...MAGIC_MX.meta, notes: [...MAGIC_MX.meta.notes, 'Faltaron datos de algunas emisoras, así que la tabla está incompleta.', EBIT_NOTE] } }
    await open(page, /** @type {string} */ (baseURL), { routes: { 'GET /v2/screeners/magic': { json: partial } } })
    await page.goto('/screener/formula-magica')
    await magicReady(page)
    const { row } = tableOf(page, 'Ranking de la fórmula mágica')
    await expect(row('AMXB.MX').getByText('EBIT de respaldo')).toBeVisible()
    await expect(row('WALMEX.MX').getByText('EBIT de respaldo')).toHaveCount(0)
    await expect(page.getByRole('note', { name: 'Tabla incompleta' })).toBeVisible()
    await expect(page.getByText(EBIT_NOTE)).toBeVisible()
    await expect(page.getByText(/usan el renglón EBIT de la fuente/)).toBeVisible()
  })

  test('la emisora abre su ficha', async ({ page, baseURL }) => {
    await open(page, /** @type {string} */ (baseURL))
    await page.goto('/screener/formula-magica')
    await magicReady(page)
    await tableOf(page, 'Ranking de la fórmula mágica').row('WALMEX.MX').getByRole('link', { name: 'WALMEX.MX' }).click()
    await expect(page).toHaveURL(/\/investigar\/WALMEX\.MX$/)
    await expect(page.getByRole('heading', { level: 1, name: /WALMEX\.MX/ })).toBeVisible()
  })
})

// Sin la fixture automática: el 503 es a propósito.
plainTest('screener: fórmula mágica caída muestra el error con reintento', async ({ page, baseURL }) => {
  const guards = attachGuards(page, { allow: expectedHttpError(503, 'GET', '/v2/screeners/magic', 'la prueba tumba el screener a propósito') })
  const down = { status: 503, json: { error: { code: 'UPSTREAM_UNAVAILABLE', message: 'El proveedor de datos no responde. Intenta en unos minutos.' } } }
  await open(page, /** @type {string} */ (baseURL), { routes: { 'GET /v2/screeners/magic': down } })
  await page.goto('/screener/formula-magica')
  await expect(page.getByRole('heading', { level: 1, name: 'Fórmula Mágica' })).toBeVisible()
  const universe = page.getByRole('region', { name: 'Universo' })
  await expect(universe.getByRole('alert')).toContainText('El proveedor de datos no responde', { timeout: 10_000 })
  await expect(universe.getByRole('button', { name: 'Reintentar' })).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Estados Unidos' })).toBeEnabled()
  guards.assertClean()
})

// ─── FIBRAs ──────────────────────────────────────────────────────────────────

test.describe('screener: FIBRAs', () => {
  test('orden por P/NAV, tasa sustituta dicha y s/d con su motivo', async ({ page, baseURL }) => {
    await open(page, /** @type {string} */ (baseURL))
    await page.goto('/screener/fibras')
    await fibrasReady(page)
    await expect(page).toHaveTitle('FIBRAs · Kaizen')
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)

    // La tasa es de FRED: se nombra como sustituta y el respaldo se ve.
    const rate = page.getByRole('region', { name: 'Tasa de referencia' })
    await expect(rate.getByText('Tasa sustituta de corto plazo', { exact: true })).toBeVisible()
    await expect(rate.getByText('6.79%')).toBeVisible()
    await expect(rate.getByRole('note', { name: 'Tasa sustituta' })).toContainText('No son CETES de 28 días.')
    await expect(rate.getByText(/tasa interbancaria de México a 91 días de la OCDE en FRED/)).toBeVisible()
    await expect(rate.getByText('Respaldo: FRED')).toBeVisible()
    await expect(rate.getByText('Fuente: FRED, serie de la OCDE, dato del 1 ago 2026')).toBeVisible()
    await expect(page.getByRole('region', { name: 'FIBRAs ordenadas por P/NAV' }).getByText(/^Respaldo: Yahoo Finance, cálculo de Kaizen y FRED/)).toBeVisible()
    await expect(page.getByRole('main').getByText('CETES 28 días', { exact: true })).toHaveCount(0)

    const { table, row } = tableOf(page, 'FIBRAs ordenadas por P/NAV')
    await expect(table.getByRole('row').nth(1)).toContainText('FSHOP13.MX')
    await expect(table.getByRole('row').last()).toContainText('FIBRAPL14.MX')
    await expect(row('FSHOP13.MX')).toContainText('0.44x')
    await expect(row('FSHOP13.MX')).toContainText('Descuento')
    await expect(row('FSHOP13.MX')).toContainText('−0.45 pp')
    await expect(row('FUNO11.MX')).toContainText('+1.81 pp')
    await expect(row('FUNO11.MX')).toContainText('flujo de operación')
    await expect(row('FNOVA17.MX')).toContainText('Prima')
    await expect(row('FIBRAPL14.MX')).toContainText('Sin NAV')
    // Estados del fiduciario descartados: s/d en la fila y el motivo a un clic.
    await expect(row('FMTY14.MX')).toContainText('s/d')
    const why = row('FMTY14.MX').getByRole('button', { name: 'Por qué hay s/d en FMTY14.MX' })
    await why.click()
    const tip = page.getByRole('dialog', { name: 'FMTY14.MX: por qué hay s/d' })
    await expect(tip).toBeVisible()
    await expect(tip).toContainText('sirve los datos del fiduciario')
    await page.keyboard.press('Escape')
    await expect(tip).toBeHidden()
    await expect(why).toBeFocused()

    const reasons = page.getByRole('region', { name: 'Datos que faltan y por qué' })
    await expect(reasons.getByRole('heading', { level: 3, name: /FMTY14\.MX/ })).toBeVisible()
    await expect(reasons.getByText(FMTY_NOTE).first()).toBeVisible()
    await expect(reasons.getByText('En s/d: LTV, deuda entre capitalización, cap rate, rendimiento de flujo.').first()).toBeVisible()
    await expect(reasons.getByText(/no cuadra con la que Yahoo le reporta/)).toBeVisible()
    await expect(reasons.getByRole('heading', { level: 3, name: /STORAGE18\.MX/ })).toBeVisible()
    await expect(reasons.getByText('El servidor no dejó una nota para esta FIBRA; la fuente no trae esos renglones.')).toBeVisible()

    const notes = page.getByRole('region', { name: 'Notas del cálculo' })
    await expect(notes.getByText(/no un avalúo independiente/)).toBeVisible()
    await expect(notes.getByText(/Señal por P\/NAV/)).toBeVisible()
    await expect(page.getByText(/compra|vende|aprovecha/i)).toHaveCount(0)
    await noHorizontalScroll(page)
  })

  test('con CETES de Banxico no hay aviso de tasa sustituta', async ({ page, baseURL }) => {
    const banxico = {
      ...FIBRAS,
      cetes28: 0.0725,
      meta: { ...FIBRAS.meta, source: 'yahoo,computed,banxico', fallback: false, notes: FIBRAS.meta.notes.filter((n) => !/sustituta|BANXICO_TOKEN/.test(n)) },
    }
    await open(page, /** @type {string} */ (baseURL), { routes: { 'GET /v2/screeners/fibras': { json: banxico } } })
    await page.goto('/screener/fibras')
    await fibrasReady(page)
    const rate = page.getByRole('region', { name: 'Tasa de referencia' })
    await expect(rate.getByText('CETES 28 días', { exact: true })).toBeVisible()
    await expect(rate.getByText('7.25%')).toBeVisible()
    await expect(rate.getByRole('note', { name: 'Tasa sustituta' })).toHaveCount(0)
  })

  test('las FIBRAs adicionales viajan en la URL y en el request', async ({ page, baseURL }) => {
    /** @type {(string | null)[]} */
    const extras = []
    await open(page, /** @type {string} */ (baseURL), {
      routes: {
        'GET /v2/screeners/fibras': ({ url }) => {
          extras.push(url.searchParams.get('extra'))
          return { json: FIBRAS }
        },
      },
    })
    await page.goto('/screener/fibras')
    await fibrasReady(page)
    const input = page.getByRole('textbox', { name: 'FIBRAs adicionales' })
    await input.fill('<>')
    await page.getByRole('button', { name: 'Actualizar tabla' }).click()
    await expect(page.getByText(/Escribe claves separadas por coma/)).toBeVisible()
    await input.fill('fibrahd15, educa18')
    await input.press('Enter')
    await expect(page).toHaveURL(/\/screener\/fibras\?extra=FIBRAHD15%2CEDUCA18$/)
    await expect(page.getByText('Agregadas: FIBRAHD15, EDUCA18.')).toBeVisible()
    await expect.poll(() => extras).toContain('FIBRAHD15,EDUCA18')
    await page.getByRole('button', { name: 'Quitar las agregadas' }).click()
    await expect(page).toHaveURL(/\/screener\/fibras$/)
    await expect(input).toHaveValue('')
  })
})

// Sin la fixture automática: el 503 es a propósito.
plainTest('screener: FIBRAs caídas muestran el error con reintento', async ({ page, baseURL }) => {
  const guards = attachGuards(page, { allow: expectedHttpError(503, 'GET', '/v2/screeners/fibras', 'la prueba tumba el screener a propósito') })
  const down = { status: 503, json: { error: { code: 'UPSTREAM_UNAVAILABLE', message: 'El proveedor de datos no responde. Intenta en unos minutos.' } } }
  await open(page, /** @type {string} */ (baseURL), { routes: { 'GET /v2/screeners/fibras': down } })
  await page.goto('/screener/fibras')
  await expect(page.getByRole('heading', { level: 1, name: 'FIBRAs' })).toBeVisible()
  const rate = page.getByRole('region', { name: 'Tasa de referencia' })
  await expect(rate.getByRole('alert')).toContainText('El proveedor de datos no responde', { timeout: 10_000 })
  await expect(rate.getByRole('button', { name: 'Reintentar' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'FIBRAs adicionales' })).toBeVisible()
  guards.assertClean()
})

// ─── Accesibilidad y capturas ────────────────────────────────────────────────

test.describe('screeners: accesibilidad (WCAG 2.1 AA)', () => {
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
  test.skip(!CAPTURE_DIR, 'sin F3C_CAPTURE_DIR')
  for (const p of PAGES) {
    test(`captura ${p.name}`, async ({ page, baseURL }, testInfo) => {
      await open(page, /** @type {string} */ (baseURL), { theme: 'light' })
      await page.goto(p.path)
      await p.ready(page)
      await settleAnimations(page)
      await page.screenshot({ path: `${CAPTURE_DIR}/${p.name}-${testInfo.project.name}.png`, fullPage: true })
    })
  }
})
