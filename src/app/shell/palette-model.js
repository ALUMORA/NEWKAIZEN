// Lógica pura de la paleta de comandos: filtrar rutas, armar los grupos (Emisoras, Ir a,
// Acciones), elegir la emisora para un ticker tecleado y recordar las emisoras recientes.
import { pathInstrument } from '../paths.js'

/**
 * @typedef {{ id: string, kind: 'symbol' | 'route' | 'action', label: string, detail?: string,
 *   to?: string, symbol?: string, action?: string }} PaletteOption
 * @typedef {{ id: string, label: string, options: PaletteOption[] }} PaletteGroup
 */

export const RECENT_KEY = 'kaizen.recent-symbols'
const RECENT_MAX = 5

/** Minúsculas y sin acentos: "México" encuentra con "mexico". @param {unknown} s */
export function fold(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
}

/** Algo que parece ticker: letras, números y . - ^ =, sin espacios. @param {string} q */
export function isTickerLike(q) {
  return /^[A-Za-z0-9.\-^=]{1,20}$/.test(String(q ?? '').trim())
}

/**
 * La emisora que corresponde a lo tecleado: el símbolo exacto o el de la BMV ("WALMEX" →
 * "WALMEX.MX"). null si ninguno coincide.
 * @param {string} q
 * @param {{ symbol: string }[] | undefined} results
 */
export function matchSymbol(q, results) {
  const want = String(q ?? '').trim().toUpperCase()
  if (!want || !results?.length) return null
  const exact = results.find((r) => r.symbol.toUpperCase() === want)
  if (exact) return exact.symbol
  const mx = results.find((r) => r.symbol.toUpperCase() === `${want}.MX`)
  if (mx) return mx.symbol
  const prefixed = results.find((r) => r.symbol.toUpperCase().split('.')[0] === want)
  return prefixed ? prefixed.symbol : null
}

/**
 * @param {string} q
 * @param {{ label: string, to: string, section?: string, keywords?: string[] }} route
 */
function routeMatches(q, route) {
  const needle = fold(q)
  if (!needle) return true
  const hay = fold([route.label, route.section, ...(route.keywords ?? [])].join(' '))
  return needle.split(/\s+/).every((word) => hay.includes(word))
}

/**
 * Grupos de la paleta en orden, sin grupos vacíos.
 * @param {{ q: string, results?: { symbol: string, name: string, exchange?: string | null }[],
 *   recents?: { symbol: string, name?: string }[],
 *   routes: { id: string, label: string, to: string, section?: string, keywords?: string[] }[],
 *   dark: boolean }} input
 * @returns {PaletteGroup[]}
 */
export function buildGroups({ q, results = [], recents = [], routes, dark }) {
  const text = String(q ?? '').trim()
  const needle = fold(text)
  /** @type {PaletteOption[]} */
  const symbols = []
  const seen = new Set()
  const pushSymbol = (/** @type {{ symbol: string, name?: string, exchange?: string | null }} */ r, recent) => {
    const key = r.symbol.toUpperCase()
    if (seen.has(key)) return
    seen.add(key)
    symbols.push({
      id: `sym-${key.replace(/[^A-Z0-9]/g, '_')}`,
      kind: 'symbol',
      label: r.symbol,
      detail: [r.name, recent ? 'Reciente' : r.exchange].filter(Boolean).join(' · '),
      symbol: r.symbol,
      to: pathInstrument(r.symbol),
    })
  }
  for (const r of results) pushSymbol(r, false)
  for (const r of recents) {
    if (!needle || fold(`${r.symbol} ${r.name ?? ''}`).includes(needle)) pushSymbol(r, true)
  }

  /** @type {PaletteOption[]} */
  // Primero las rutas cuyo nombre empieza con lo tecleado ("resumen" pone Resumen antes que
  // Panorama, que solo coincide por palabra clave); el resto conserva el orden de nav.js.
  const startsWith = (/** @type {{ label: string }} */ r) => (needle && fold(r.label).startsWith(needle) ? 0 : 1)
  const go = routes
    .filter((r) => routeMatches(text, r))
    .map((r, i) => ({ r, i }))
    .sort((a, b) => startsWith(a.r) - startsWith(b.r) || a.i - b.i)
    .map(({ r }) => ({ id: `go-${r.id}`, kind: 'route', label: r.label, detail: r.section || undefined, to: r.to }))

  const actionList = [
    { id: 'act-theme', kind: /** @type {const} */ ('action'), label: dark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro', action: 'theme', keywords: 'tema modo oscuro claro apariencia' },
    { id: 'act-logout', kind: /** @type {const} */ ('action'), label: 'Cerrar sesión', action: 'logout', keywords: 'salir sesión cuenta' },
  ]
  /** @type {PaletteOption[]} */
  const actions = actionList
    .filter((a) => !needle || needle.split(/\s+/).every((w) => fold(`${a.label} ${a.keywords}`).includes(w)))
    .map((a) => ({ id: a.id, kind: a.kind, label: a.label, action: a.action }))

  return [
    { id: 'emisoras', label: 'Emisoras', options: symbols },
    { id: 'ir-a', label: 'Ir a', options: go },
    { id: 'acciones', label: 'Acciones', options: actions },
  ].filter((g) => g.options.length > 0)
}

/** @returns {{ symbol: string, name?: string }[]} */
export function readRecents() {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((r) => r && typeof r.symbol === 'string').slice(0, RECENT_MAX) : []
  } catch {
    return []
  }
}

/** @param {{ symbol: string, name?: string }} entry */
export function pushRecent(entry) {
  const list = [entry, ...readRecents().filter((r) => r.symbol.toUpperCase() !== entry.symbol.toUpperCase())].slice(0, RECENT_MAX)
  try {
    globalThis.localStorage?.setItem(RECENT_KEY, JSON.stringify(list))
  } catch {
    /* sin almacenamiento: no se recuerda */
  }
  return list
}
