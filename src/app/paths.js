// Rutas de la app (URLs en español). Todo link, redirect y definición de ruta sale de aquí:
// nav.js (C3) y las features importan estas constantes en vez de escribir cadenas.
//
//   <Link to={PATHS.portfolio}>        <Link to={pathInstrument('WALMEX.MX')}>
//   routes.jsx: { path: route(PATHS.portfolioRisk), ... }   → "portafolio/riesgo"

export const PATHS = Object.freeze({
  root: '/',

  // Públicas (sin sesión)
  login: '/login',
  learn: '/aprender',
  learnTerm: '/aprender/:termino',
  legalTerms: '/legal/terminos',
  legalPrivacy: '/legal/privacidad',
  legalNotice: '/legal/aviso',

  // Mercados (F2)
  markets: '/mercados',
  marketsMexico: '/mercados/mexico',
  marketsCetes: '/mercados/cetes',
  marketsNews: '/mercados/noticias',

  // Mi portafolio (F1)
  portfolio: '/portafolio',
  portfolioTransactions: '/portafolio/movimientos',
  portfolioPerformance: '/portafolio/rendimiento',
  portfolioRisk: '/portafolio/riesgo',
  portfolioRebalance: '/portafolio/rebalanceo',

  // Investigar (F3)
  research: '/investigar',
  instrument: '/investigar/:symbol',
  compare: '/investigar/comparar',
  screener: '/screener',
  screenerMagic: '/screener/formula-magica',
  screenerFibras: '/screener/fibras',

  // Herramientas (F4)
  tools: '/herramientas',
  toolsOptimizer: '/herramientas/optimizador',
  toolsBacktest: '/herramientas/backtest',
  toolsSimulator: '/herramientas/simulador',

  // F5
  watchlist: '/watchlist',
  onboarding: '/bienvenida',

  // Solo en desarrollo (C1)
  devUi: '/dev/ui',
})

/** Adonde se va después de entrar si no hay ?next. */
export const DEFAULT_PRIVATE_PATH = PATHS.markets

/**
 * Ruta relativa para los `path` de routes.jsx: "/portafolio/riesgo" → "portafolio/riesgo".
 * @param {string} path
 */
export function route(path) {
  return path.replace(/^\/+/, '')
}

/** @param {string} symbol → "/investigar/WALMEX.MX" */
export function pathInstrument(symbol) {
  return `/investigar/${encodeURIComponent(String(symbol).trim().toUpperCase())}`
}

/** @param {string[]} symbols → "/investigar/comparar?symbols=AAPL,MSFT" */
export function pathCompare(symbols) {
  const list = (symbols ?? []).map((s) => encodeURIComponent(String(s).trim().toUpperCase())).filter(Boolean)
  return list.length ? `${PATHS.compare}?symbols=${list.join(',')}` : PATHS.compare
}

/** @param {string} term → "/aprender/sharpe" */
export function pathLearnTerm(term) {
  return `/aprender/${encodeURIComponent(String(term).trim().toLowerCase())}`
}

/**
 * Solo acepta rutas internas ("/algo"), nunca "//otro-sitio", esquemas ni la propia /login:
 * evita redirecciones abiertas con ?next.
 * @param {string | null | undefined} next
 * @param {string} [fallback]
 */
export function safeNext(next, fallback = DEFAULT_PRIVATE_PATH) {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return fallback
  if (/^\/login(?:[/?#]|$)/.test(next)) return fallback
  return next
}

/**
 * "/login" o "/login?next=%2Fportafolio" (no agrega next para la raíz).
 * @param {string} [next] ruta interna a la que volver
 */
export function pathLogin(next) {
  if (!next || next === '/' || safeNext(next, '') === '') return PATHS.login
  return `${PATHS.login}?next=${encodeURIComponent(next)}`
}
