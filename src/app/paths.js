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

/** Origen contra el que se revisa ?next cuando no hay window (pruebas en Node). */
const CHECK_ORIGIN = 'http://kaizen.invalid'

function currentOrigin() {
  try {
    const origin = globalThis.location?.origin
    return origin && origin !== 'null' ? origin : CHECK_ORIGIN
  } catch {
    return CHECK_ORIGIN
  }
}

/**
 * Caracteres de control ASCII (U+0000 a U+001F y U+007F) o diagonal invertida. El parser de URL
 * borra tabs y saltos de línea y trata "\" como "/": "/\t/example.com" o "/\\example.com"
 * terminan siendo "//example.com", otro sitio.
 * @param {string} s
 */
function hasUnsafeChars(s) {
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i)
    if (c < 0x20 || c === 0x7f || c === 0x5c) return true
  }
  return false
}

/**
 * Destino seguro para ?next: solo rutas internas de este mismo origen, nunca la propia /login.
 * Evita redirecciones abiertas y que un link armado tumbe el login con "Algo salió mal" (React
 * Router se niega a navegar a otro origen). Rechaza, tal cual o ya decodificado con %XX:
 * caracteres de control, diagonales invertidas, "//otro-sitio", esquemas ("https:",
 * "javascript:"), cualquier cosa que el navegador resuelva a otro origen y también lo que
 * TERMINE en "//otro-sitio" después de normalizar los segmentos de punto ("/..//example.com").
 * Devuelve la ruta normalizada (pathname + search + hash) o `fallback`.
 * @param {string | null | undefined} next
 * @param {string} [fallback]
 */
export function safeNext(next, fallback = DEFAULT_PRIVATE_PATH) {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//')) return fallback
  let decoded
  try {
    decoded = decodeURIComponent(next)
  } catch {
    return fallback
  }
  if (hasUnsafeChars(next) || hasUnsafeChars(decoded) || decoded.startsWith('//')) return fallback
  const origin = currentOrigin()
  let url
  try {
    url = new URL(next, origin)
  } catch {
    return fallback
  }
  if (url.origin !== origin) return fallback
  // El origen no alcanza: los segmentos de punto se normalizan DENTRO del mismo origen, así que
  // "/..//example.com" termina con el pathname "//example.com" y `url.origin` sigue siendo el
  // nuestro. Devolver esa cadena sería entregar un destino relativo al protocolo, o sea otro
  // sitio. Se revisa el resultado ya normalizado, no la entrada.
  if (url.pathname.startsWith('//')) return fallback
  let path
  try {
    path = decodeURIComponent(url.pathname)
  } catch {
    return fallback
  }
  if (/^\/login(?:\/|$)/i.test(path)) return fallback
  const resolved = `${url.pathname}${url.search}${url.hash}`
  // Cinturón y tirantes: nada que salga de aquí puede leerse como URL absoluta o relativa al
  // protocolo, pase lo que pase con el parser.
  if (!resolved.startsWith('/') || resolved.startsWith('//')) return fallback
  return resolved
}

/**
 * "/login" o "/login?next=%2Fportafolio" (no agrega next para la raíz).
 * @param {string} [next] ruta interna a la que volver
 */
export function pathLogin(next) {
  if (!next || next === '/' || safeNext(next, '') === '') return PATHS.login
  return `${PATHS.login}?next=${encodeURIComponent(next)}`
}
