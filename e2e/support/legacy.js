// Todo lo específico de la app LEGADA (src/legacy/App.legacy.jsx) que comparten el grabador
// (scripts/record-legacy-fixtures.mjs) y el spec de baseline (e2e/baseline.spec.js): tabs,
// navegación, criterio de "ya terminó de cargar" y rutas de los fixtures. Si el grabador y el
// spec no usan exactamente el mismo recorrido, el replay pide cosas que no se grabaron.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const LEGACY_API_ORIGIN = 'http://127.0.0.1:8002'

// Lo que se graba y se sirve desde el HAR: el backend viejo y Google Fonts. Desde S2 la app sirve
// sus fuentes (@fontsource-variable) y ya no pide nada a Google; el HAR de septiembre todavía trae
// esas entradas y se dejan en el patrón para que una regrabación con una versión vieja no falle.
export const LEGACY_HAR_URL = /^(http:\/\/127\.0\.0\.1:8002|https:\/\/fonts\.(googleapis|gstatic)\.com)\//

export const LEGACY_FIXTURES_DIR = fileURLToPath(new URL('../fixtures/legacy/', import.meta.url))

/** @param {'desktop' | 'mobile'} viewport */
export const legacyHarPath = (viewport) => `${LEGACY_FIXTURES_DIR}legacy-${viewport}.har`
export const LEGACY_META_PATH = `${LEGACY_FIXTURES_DIR}meta.json`

/** @returns {{ recordedAt: Record<string, string>, [k: string]: unknown }} */
export function readLegacyMeta() {
  return JSON.parse(readFileSync(LEGACY_META_PATH, 'utf8'))
}

// Orden del recorrido y etiquetas tal como aparecen en src/legacy/App.legacy.jsx: la barra lateral en
// escritorio y las pastillas de la barra inferior en móvil (que usan nombres cortos).
export const LEGACY_TABS = [
  { id: 'news', slug: 'noticias', desktop: 'Noticias', mobile: 'Noticias' },
  { id: 'portfolio', slug: 'portfolio', desktop: 'Portfolio', mobile: 'Portfolio' },
  { id: 'analytics', slug: 'analytics', desktop: 'Analytics vs SPY', mobile: 'Analytics' },
  { id: 'optimize', slug: 'sharpe', desktop: 'Sharpe Optimizer', mobile: 'Sharpe' },
  { id: 'screener', slug: 'ml-screener', desktop: 'ML Screener', mobile: 'ML Screener' },
  { id: 'analisis', slug: 'analisis', desktop: 'Análisis', mobile: 'Análisis' },
  { id: 'fibras', slug: 'fibras', desktop: 'FIBRA Screener', mobile: 'FIBRAs' },
  { id: 'magic', slug: 'formula-magica', desktop: 'Fórmula Mágica', mobile: 'Fórmula Mágica' },
]

/**
 * Lleva la cuenta de los requests en vuelo hacia `url` para saber cuándo la red se calmó.
 * Hay que crearlo antes de page.goto.
 * @param {import('@playwright/test').Page} page
 * @param {RegExp} [url]
 */
export function trackNetwork(page, url = LEGACY_HAR_URL) {
  const inflight = new Set()
  const state = { inflight, lastActivity: Date.now(), total: 0 }
  const start = (req) => {
    if (!url.test(req.url())) return
    inflight.add(req)
    state.total += 1
    state.lastActivity = Date.now()
  }
  const end = (req) => {
    if (!inflight.delete(req)) return
    state.lastActivity = Date.now()
  }
  page.on('request', start)
  page.on('requestfinished', end)
  page.on('requestfailed', end)
  return state
}

/** Estado visible de "cargando" en la app legada: spinners girando y textos de carga. */
async function loadingSignals(page) {
  return page.evaluate(() => {
    const visible = (el) => el.getClientRects().length > 0
    const spinners = [...document.querySelectorAll('div')].filter(
      (el) => getComputedStyle(el).animationName.split(',').some((n) => n.trim() === 'spin') && visible(el),
    ).length
    const text = document.body?.innerText ?? ''
    const loadingText = /Cargando|CONECTANDO|Conectando\.\.\.|Analizando/.test(text)
    return { spinners, loadingText, root: Boolean(document.querySelector('.app-shell')) }
  })
}

/**
 * Espera a que la app legada termine de cargar: shell montado, cero requests al API en vuelo
 * durante `quietMs` (la app encadena fetches con sleeps de 150 y 400 ms), sin spinners ni
 * textos de carga, y fuentes listas. Todo eso dos sondeos seguidos.
 * @param {import('@playwright/test').Page} page
 * @param {ReturnType<typeof trackNetwork>} net
 * @param {{ quietMs?: number, timeout?: number, pollMs?: number }} [options]
 */
export async function waitForSettled(page, net, { quietMs = 1200, timeout = 12_000, pollMs = 150 } = {}) {
  const deadline = Date.now() + timeout
  let streak = 0
  let last = null
  while (Date.now() < deadline) {
    const signals = await loadingSignals(page)
    const quiet = net.inflight.size === 0 && Date.now() - net.lastActivity >= quietMs
    last = { ...signals, inflight: [...net.inflight].map((r) => r.url()) }
    if (quiet && signals.root && signals.spinners === 0 && !signals.loadingText) {
      streak += 1
      if (streak >= 2) {
        await page.evaluate(() => document.fonts.ready.then(() => undefined))
        return
      }
    } else {
      streak = 0
    }
    await page.waitForTimeout(pollMs)
  }
  throw new Error(`La app legada no se estabilizó en ${timeout} ms: ${JSON.stringify(last)}`)
}

/**
 * Cambia de tab como lo haría la persona: barra lateral en escritorio, pastillas abajo en móvil.
 * @param {import('@playwright/test').Page} page
 * @param {(typeof LEGACY_TABS)[number]} tab
 * @param {boolean} isMobile
 */
export async function openLegacyTab(page, tab, isMobile) {
  const button = isMobile
    ? page.locator('.bottom-nav-mobile').getByRole('button', { name: tab.mobile, exact: true })
    : page.locator('.app-sidebar .app-nav').getByRole('button', { name: tab.desktop, exact: true })
  await button.click()
}

/** El scroll del documento persiste entre tabs: se regresa arriba antes de cada captura. */
export async function scrollToTop(page) {
  await page.evaluate(() => {
    window.scrollTo(0, 0)
    if (document.scrollingElement) document.scrollingElement.scrollTop = 0
  })
}
