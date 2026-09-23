// Modelo de la tira de mercado de la barra superior: toma /v2/markets/overview y /v2/rates/mx
// (forma de kaizen_api/schemas.py) y arma las cinco cifras del brief en orden.
//
// Dirección del cambio (docs/design.md, "El color nunca va solo"): los índices accionarios van en
// verde o rojo; USD/MXN, CETES y VIX no tienen bueno ni malo y van en neutral con pista de texto.

/**
 * @typedef {{ id: string, label: string, title: string, value: number | null, decimals: number,
 *   suffix?: string, change: number | null, changeKind: 'pct' | 'bp', direction: 'auto' | 'neutral',
 *   hint?: string }} StripItem
 */

const FROM_OVERVIEW = [
  { id: 'ipc', symbol: '^MXX', label: 'IPC', title: 'S&P/BMV IPC', decimals: 2, direction: 'auto' },
  { id: 'sp500', symbol: '^GSPC', label: 'S&P 500', title: 'S&P 500', decimals: 2, direction: 'auto' },
  { id: 'usdmxn', symbol: 'USDMXN=X', label: 'USD/MXN', title: 'Dólar frente al peso', decimals: 4, direction: 'neutral' },
]
const VIX = { id: 'vix', symbol: '^VIX', label: 'VIX', title: 'VIX, volatilidad esperada del S&P 500', decimals: 2, direction: 'neutral' }

/** @param {any} overview @param {string} symbol */
function findItem(overview, symbol) {
  for (const group of overview?.groups ?? []) {
    const hit = (group.items ?? []).find((/** @type {any} */ it) => it.symbol === symbol)
    if (hit) return hit
  }
  return null
}

/** @param {any} overview @param {typeof VIX} spec @returns {StripItem} */
function fromOverview(overview, spec) {
  const it = findItem(overview, spec.symbol)
  const value = typeof it?.price === 'number' ? it.price : null
  const change = typeof it?.changePct === 'number' ? it.changePct : null
  /** @type {StripItem} */
  const item = { id: spec.id, label: spec.label, title: spec.title, value, decimals: spec.decimals, change, changeKind: 'pct', direction: /** @type {'auto'|'neutral'} */ (spec.direction) }
  if (spec.id === 'usdmxn' && change !== null && change !== 0) item.hint = change > 0 ? 'peso más débil' : 'peso más fuerte'
  return item
}

/** @param {any} rates @returns {StripItem} */
function cetes28(rates) {
  const it = (rates?.items ?? []).find((/** @type {any} */ r) => r.id === 'cetes28')
  const value = typeof it?.value === 'number' ? it.value * 100 : null
  const change = typeof it?.changeBp === 'number' ? it.changeBp : null
  return { id: 'cetes28', label: 'CETES 28', title: 'CETES a 28 días, tasa de la última subasta', value, decimals: 2, suffix: '%', change, changeKind: 'bp', direction: 'neutral' }
}

/**
 * Las cinco cifras en el orden del brief: IPC, S&P 500, USD/MXN, CETES 28, VIX.
 * @param {any} overview respuesta de /v2/markets/overview (o undefined)
 * @param {any} rates respuesta de /v2/rates/mx (o undefined)
 * @returns {StripItem[]}
 */
export function stripItems(overview, rates) {
  return [...FROM_OVERVIEW.map((spec) => fromOverview(overview, spec)), cetes28(rates), fromOverview(overview, VIX)]
}

/**
 * Un solo estado para toda la tira: la fecha más vieja, las fuentes juntas, el retraso mayor y
 * cualquier aviso de dato viejo o de respaldo. null si no llegó ninguna respuesta.
 * @param {...any} metas `meta` de cada respuesta v2
 */
export function mergeMeta(...metas) {
  const list = metas.filter((m) => m && typeof m === 'object')
  if (!list.length) return null
  const dates = list.map((m) => m.asOf).filter((d) => typeof d === 'string' && !Number.isNaN(Date.parse(d)))
  const asOf = dates.length ? dates.reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b)) : undefined
  const sources = [...new Set(list.flatMap((m) => String(m.source ?? '').split(',').map((s) => s.trim()).filter(Boolean)))]
  const delays = list.map((m) => m.delayMinutes).filter((d) => typeof d === 'number')
  return {
    asOf,
    source: sources.join(', ') || undefined,
    delayMinutes: delays.length ? Math.max(...delays) : undefined,
    stale: list.some((m) => m.stale === true),
    fallback: list.some((m) => m.fallback === true),
  }
}
