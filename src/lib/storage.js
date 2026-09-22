// Estado local de la persona (portafolios, movimientos, listas y ajustes) en localStorage bajo
// "kaizen:v2". Es la única fuente de verdad del lado del cliente: las features leen con
// useStore(selector) y escriben con update(fn) o con los hooks de src/lib/portfolio/.
//
// Forma (v: 2):
//   { v, updatedAt, portfolios: Portfolio[], activePortfolioId, watchlists: Watchlist[],
//     settings: { benchmark, riskProfile, onboardingDone }, migrationReport, legacyHashes }
//
// Migración desde la app vieja, una sola vez, cuando "kaizen:v2" no existe:
// - "momentum_portfolios" (varios) o "momentum_portfolio" (uno) → portafolios con un movimiento
//   por posición: "$MXN" es un depósito en pesos; lo demás, una compra sin fecha a su costo.
// - "momentum_screener" (lista de tickers) → la lista "Mi lista".
// - Antes de escribir se copia cada llave vieja a "kaizen:backup:<ISO>:<llave>". Las llaves
//   viejas NUNCA se borran: la app legada las sigue usando mientras conviva con la nueva.
// Si no hay nada que migrar se arranca sin portafolios (la bienvenida ofrece uno de ejemplo).
//
// LA MIGRACIÓN ES UNA FOTO DE UN SOLO MOMENTO, y a propósito no se repite. Mientras src/legacy
// siga montado (hasta M3), la app vieja sigue escribiendo momentum_portfolios y
// momentum_screener, y eso ya no llega a "kaizen:v2"; al revés tampoco. Volver a migrar solo
// porque cambiaron las llaves viejas pisaría lo que la persona haya hecho en la app nueva, así
// que no se hace automáticamente. Para que esa divergencia se pueda detectar, al crear el estado
// v2 se guarda en `legacyHashes` (el sobre de la migración) una huella de cada llave vieja, y
// legacyChangedSinceMigration() dice cuáles cambiaron desde entonces. Quien tenga que resolverlo
// (F1, con la página nueva de portafolio) decide qué ofrecerle a la persona: re-importar, o
// retirar las tabs legadas que leen esas llaves. Ver docs/overhaul/notas.
//
// Versión más nueva: si "kaizen:v2" trae un `v` mayor que 2 (una build más nueva escribió ahí),
// NO se toca. No se respalda, no se re-migra y no se sobrescribe: se sirve un estado vacío de
// solo lectura, save() no hace nada y getStorageError() lo explica en español.
import { useSyncExternalStore } from 'react'

export const STORAGE_KEY = 'kaizen:v2'
export const BACKUP_PREFIX = 'kaizen:backup:'
export const LEGACY_KEYS = Object.freeze({
  portfolios: 'momentum_portfolios',
  portfolio: 'momentum_portfolio',
  screener: 'momentum_screener',
})
export const TX_TYPES = /** @type {const} */ (['buy', 'sell', 'dividend', 'deposit', 'withdrawal', 'split', 'fee'])
export const CURRENCIES = /** @type {const} */ (['MXN', 'USD'])
export const DEFAULT_BENCHMARK = 'NAFTRAC.MX'
export const MIGRATED_NOTE = 'Saldo inicial migrado'
export const LEGACY_WATCHLIST_NAME = 'Mi lista'

const SYMBOL_RE = /^[A-Za-z0-9.\-^=$]{1,20}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
// Lo que la app vieja guardaba sin que la persona lo tocara: sirve para marcarlo en el reporte.
const LEGACY_DEFAULT_POSITIONS = 'AAPL:10:150|MSFT:8:320|AMZN:5:130|CEMEXCPO.MX:100:8.5|WALMEX.MX:50:68'
const LEGACY_DEFAULT_SCREENER = 'AAPL,MSFT,GOOGL,AMZN,META,NVDA,TSLA,JPM,V,WMT,CEMEXCPO.MX,WALMEX.MX,AMXL.MX,FEMSAUBD.MX'

/**
 * @typedef {'buy' | 'sell' | 'dividend' | 'deposit' | 'withdrawal' | 'split' | 'fee'} TxType
 * @typedef {{
 *   id: string, type: TxType, date: string | null, symbol: string | null,
 *   quantity: number | null, price: number | null, currency: 'MXN' | 'USD',
 *   fxRate: number | null, fees: number, amount: number | null, ratio: number | null, note: string,
 * }} Transaction
 *   fxRate: pesos por dólar en la fecha de la operación. amount: efectivo de dividendos,
 *   depósitos, retiros y comisiones. ratio: acciones nuevas por cada vieja en un split (2 = 2 por 1).
 * @typedef {{
 *   id: string, name: string, baseCurrency: 'MXN', createdAt: string,
 *   transactions: Transaction[], targets: Record<string, number>, notes: string,
 * }} Portfolio
 * @typedef {{ id: string, name: string, symbols: string[] }} Watchlist
 * @typedef {{ benchmark: string, riskProfile: string | null, onboardingDone: boolean }} Settings
 * @typedef {{ source: string, index?: number, reason: string }} DroppedEntry
 * @typedef {{
 *   migratedAt: string, sources: string[], backups: string[], portfolios: number,
 *   transactions: number, watchlists: number, dropped: DroppedEntry[], notes: string[],
 *   legacyExample: boolean, recoveredFromCorruptV2: boolean,
 * }} MigrationReport
 * @typedef {Record<string, string | null>} LegacyHashes
 *   Huella de cada llave de la app vieja al momento de crear el estado v2 (null = no existía).
 * @typedef {{
 *   v: 2, updatedAt: string, portfolios: Portfolio[], activePortfolioId: string | null,
 *   watchlists: Watchlist[], settings: Settings, migrationReport: MigrationReport | null,
 *   legacyHashes: LegacyHashes | null,
 * }} KaizenState
 */

// ─── Utilidades ─────────────────────────────────────────────────────────────

let idCounter = 0
/** Id nuevo, único en la práctica. @param {string} prefix */
export function newId(prefix) {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return `${prefix}_${c.randomUUID()}`
  idCounter += 1
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v)
const numOrNull = (v) => (v === null || v === undefined ? null : isFiniteNum(v) ? v : Number.NaN)

/** @param {unknown} v */
function isIsoDate(v) {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

/** @param {unknown} v @returns {string | null} */
export function normalizeSymbol(v) {
  if (typeof v !== 'string') return null
  const s = v.trim().toUpperCase()
  return SYMBOL_RE.test(s) ? s : null
}

/** @param {unknown} v @returns {string} */
function isoOr(v, fallback) {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : fallback
}

/** @returns {Settings} */
export function defaultSettings() {
  return { benchmark: DEFAULT_BENCHMARK, riskProfile: null, onboardingDone: false }
}

/** Estado vacío: sin portafolios ni listas. @param {string} [now] @returns {KaizenState} */
export function emptyState(now = new Date().toISOString()) {
  return {
    v: 2,
    updatedAt: now,
    portfolios: [],
    activePortfolioId: null,
    watchlists: [],
    settings: defaultSettings(),
    migrationReport: null,
    legacyHashes: null,
  }
}

// ─── Huella de las llaves viejas ────────────────────────────────────────────

/**
 * Huella de un valor de localStorage: largo más FNV-1a de 32 bits en hexadecimal. No es
 * criptográfica y no pretende serlo; solo tiene que cambiar cuando el texto cambia, sin guardar
 * una copia del contenido viejo ni depender de crypto.subtle (que es asíncrono).
 * @param {string | null} value
 * @returns {string | null} null si la llave no existe
 */
export function hashLegacyValue(value) {
  if (typeof value !== 'string') return null
  let h = 0x811c9dc5
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `${value.length}-${h.toString(16).padStart(8, '0')}`
}

/**
 * Huella de las tres llaves de la app vieja, tal como están ahorita.
 * @param {(key: string) => string | null} get
 * @returns {LegacyHashes}
 */
function snapshotLegacyKeys(get) {
  /** @type {LegacyHashes} */
  const out = {}
  for (const key of Object.values(LEGACY_KEYS)) out[key] = hashLegacyValue(get(key))
  return out
}

/**
 * ¿`value` es exactamente lo que la app vieja guarda sin que la persona haya tocado nada?
 *
 * Hace falta porque el Workspace legado escribe "momentum_screener" con su lista por defecto en
 * cada montaje (App.legacy.jsx, efecto "Persistir screener", que vive en el Workspace y no en la
 * tab del screener). O sea que a quien estrena la app nueva y luego abre cualquier ruta legada le
 * aparece una llave vieja que no existía al migrar, y sin este filtro legacyChangedSinceMigration()
 * la reportaría como divergencia para siempre sin que nadie haya cambiado nada.
 * @param {string} key
 * @param {string | null} value
 */
function isLegacyDefaultValue(key, value) {
  if (typeof value !== 'string') return false
  if (key === LEGACY_KEYS.screener) {
    const list = parseScreenerList(value)
    if (!list) return false
    /** @type {string[]} */
    const symbols = []
    for (const raw of list) {
      const sym = normalizeSymbol(raw)
      if (!sym) return false
      if (!symbols.includes(sym)) symbols.push(sym)
    }
    return symbols.join(',') === LEGACY_DEFAULT_SCREENER
  }
  if (key === LEGACY_KEYS.portfolios || key === LEGACY_KEYS.portfolio) {
    try {
      const parsed = JSON.parse(value)
      if (key === LEGACY_KEYS.portfolio) return signature(parsed) === LEGACY_DEFAULT_POSITIONS
      if (!Array.isArray(parsed) || parsed.length !== 1) return false
      return signature(parsed[0]?.positions) === LEGACY_DEFAULT_POSITIONS
    } catch {
      return false
    }
  }
  return false
}

// ─── Validación ─────────────────────────────────────────────────────────────

/**
 * Valida un movimiento. Devuelve { tx } o { reason } en español.
 * @param {any} raw
 * @returns {{ tx: Transaction, reason?: undefined } | { tx?: undefined, reason: string }}
 */
export function validateTransaction(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { reason: 'no es un movimiento' }
  const type = raw.type
  if (!TX_TYPES.includes(type)) return { reason: `tipo desconocido (${String(type)})` }
  const date = raw.date ?? null
  if (date !== null && !isIsoDate(date)) return { reason: 'fecha inválida' }
  const currency = raw.currency ?? 'MXN'
  if (!CURRENCIES.includes(currency)) return { reason: `moneda no soportada (${String(currency)})` }
  const symbol = raw.symbol == null || raw.symbol === '' ? null : normalizeSymbol(raw.symbol)
  if (raw.symbol != null && raw.symbol !== '' && symbol === null) return { reason: 'símbolo inválido' }

  const quantity = numOrNull(raw.quantity)
  const price = numOrNull(raw.price)
  const fxRate = numOrNull(raw.fxRate)
  const amount = numOrNull(raw.amount)
  const ratio = numOrNull(raw.ratio)
  const fees = raw.fees == null ? 0 : raw.fees
  for (const [name, v] of Object.entries({ quantity, price, fxRate, amount, ratio })) {
    if (Number.isNaN(v)) return { reason: `${name} no es un número` }
  }
  if (!isFiniteNum(fees) || fees < 0) return { reason: 'comisión inválida' }
  if (fxRate !== null && fxRate <= 0) return { reason: 'tipo de cambio inválido' }

  if (type === 'buy' || type === 'sell') {
    if (!symbol) return { reason: 'falta el símbolo' }
    if (quantity === null || quantity <= 0) return { reason: 'la cantidad debe ser mayor que cero' }
    if (price !== null && price < 0) return { reason: 'precio negativo' }
  } else if (type === 'split') {
    if (!symbol) return { reason: 'falta el símbolo' }
    if (ratio === null || ratio <= 0) return { reason: 'la proporción del split debe ser mayor que cero' }
  } else if (type === 'dividend') {
    if (!symbol) return { reason: 'falta el símbolo' }
    if (amount === null || amount < 0) return { reason: 'monto inválido' }
  } else if (amount === null || amount <= 0) {
    return { reason: 'el monto debe ser mayor que cero' }
  }

  return {
    tx: {
      id: typeof raw.id === 'string' && raw.id ? raw.id : newId('tx'),
      type,
      date,
      symbol,
      quantity,
      price,
      currency,
      fxRate,
      fees,
      amount,
      ratio,
      note: typeof raw.note === 'string' ? raw.note : '',
    },
  }
}

/**
 * @param {any} raw
 * @param {string} now
 * @param {DroppedEntry[]} dropped
 * @param {string} where
 * @returns {Portfolio | null}
 */
function normalizePortfolio(raw, now, dropped, where) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    dropped.push({ source: where, reason: 'no es un portafolio' })
    return null
  }
  const transactions = []
  const seen = new Set()
  ;(Array.isArray(raw.transactions) ? raw.transactions : []).forEach((t, index) => {
    const res = validateTransaction(t)
    if (!res.tx) {
      dropped.push({ source: `${where}.transactions`, index, reason: res.reason })
      return
    }
    if (seen.has(res.tx.id)) res.tx.id = newId('tx')
    seen.add(res.tx.id)
    transactions.push(res.tx)
  })
  /** @type {Record<string, number>} */
  const targets = {}
  if (raw.targets && typeof raw.targets === 'object' && !Array.isArray(raw.targets)) {
    for (const [k, v] of Object.entries(raw.targets)) {
      const sym = normalizeSymbol(k)
      if (sym && isFiniteNum(v) && v >= 0 && v <= 1) targets[sym] = v
      else dropped.push({ source: `${where}.targets`, reason: `peso objetivo inválido para ${k}` })
    }
  }
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 80) : 'Portafolio'
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId('pf'),
    name,
    baseCurrency: 'MXN',
    createdAt: isoOr(raw.createdAt, now),
    transactions,
    targets,
    notes: typeof raw.notes === 'string' ? raw.notes : '',
  }
}

/** @param {unknown} list @returns {string[]} */
function cleanSymbols(list) {
  if (!Array.isArray(list)) return []
  return [...new Set(list.map(normalizeSymbol).filter(Boolean))]
}

/**
 * Valida un estado completo (el guardado o uno importado). null si no es v2.
 * @param {any} raw
 * @param {string} [now]
 * @returns {{ state: KaizenState, dropped: DroppedEntry[] } | null}
 */
export function normalizeState(raw, now = new Date().toISOString()) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.v !== 2) return null
  /** @type {DroppedEntry[]} */
  const dropped = []
  const portfolios = []
  const ids = new Set()
  ;(Array.isArray(raw.portfolios) ? raw.portfolios : []).forEach((p, i) => {
    const pf = normalizePortfolio(p, now, dropped, `portfolios[${i}]`)
    if (!pf) return
    if (ids.has(pf.id)) pf.id = newId('pf')
    ids.add(pf.id)
    portfolios.push(pf)
  })
  const watchlists = []
  ;(Array.isArray(raw.watchlists) ? raw.watchlists : []).forEach((w, i) => {
    if (!w || typeof w !== 'object') {
      dropped.push({ source: `watchlists[${i}]`, reason: 'no es una lista' })
      return
    }
    watchlists.push({
      id: typeof w.id === 'string' && w.id ? w.id : newId('wl'),
      name: typeof w.name === 'string' && w.name.trim() ? w.name.trim().slice(0, 80) : 'Lista',
      symbols: cleanSymbols(w.symbols),
    })
  })
  const s = raw.settings && typeof raw.settings === 'object' ? raw.settings : {}
  const settings = {
    benchmark: normalizeSymbol(s.benchmark) ?? DEFAULT_BENCHMARK,
    riskProfile: typeof s.riskProfile === 'string' && s.riskProfile ? s.riskProfile : null,
    onboardingDone: s.onboardingDone === true,
  }
  const active = portfolios.some((p) => p.id === raw.activePortfolioId) ? raw.activePortfolioId : (portfolios[0]?.id ?? null)
  return {
    state: {
      v: 2,
      updatedAt: isoOr(raw.updatedAt, now),
      portfolios,
      activePortfolioId: active,
      watchlists,
      settings,
      migrationReport: raw.migrationReport && typeof raw.migrationReport === 'object' ? raw.migrationReport : null,
      legacyHashes: normalizeLegacyHashes(raw.legacyHashes),
    },
    dropped,
  }
}

/** @param {unknown} raw @returns {LegacyHashes | null} */
function normalizeLegacyHashes(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  /** @type {LegacyHashes} */
  const out = {}
  for (const [key, value] of Object.entries(raw)) {
    if (value === null || typeof value === 'string') out[key] = value
  }
  return Object.keys(out).length ? out : null
}

// ─── Migración desde la app vieja ───────────────────────────────────────────

/**
 * Convierte las posiciones de un portafolio viejo en movimientos.
 * @param {unknown} positions
 * @param {string} portfolioId
 * @param {string} source
 * @param {DroppedEntry[]} dropped
 * @param {Set<string>} notes
 * @returns {Transaction[]}
 */
function positionsToTransactions(positions, portfolioId, source, dropped, notes) {
  if (!Array.isArray(positions)) {
    dropped.push({ source, reason: 'las posiciones no son una lista' })
    return []
  }
  /** @type {Transaction[]} */
  const out = []
  positions.forEach((pos, index) => {
    const id = `${portfolioId}-mig-${index + 1}`
    if (!pos || typeof pos !== 'object') {
      dropped.push({ source, index, reason: 'posición mal formada' })
      return
    }
    if (pos.expPct != null) notes.add('Los porcentajes del modo experimental no se migraron.')
    const shares = typeof pos.shares === 'string' ? Number(pos.shares) : pos.shares
    if (!isFiniteNum(shares) || shares <= 0) {
      dropped.push({ source, index, reason: 'cantidad inválida' })
      return
    }
    if (pos.ticker === '$MXN') {
      out.push({ id, type: 'deposit', date: null, symbol: null, quantity: null, price: null, currency: 'MXN', fxRate: null, fees: 0, amount: shares, ratio: null, note: MIGRATED_NOTE })
      return
    }
    const symbol = normalizeSymbol(pos.ticker)
    if (!symbol) {
      dropped.push({ source, index, reason: `ticker inválido (${String(pos.ticker).slice(0, 24)})` })
      return
    }
    const cost = typeof pos.cost === 'string' ? Number(pos.cost) : pos.cost
    let price = null
    if (cost == null) notes.add('Algunas posiciones no tenían costo y quedaron sin precio de compra.')
    else if (!isFiniteNum(cost) || cost < 0) {
      dropped.push({ source, index, reason: 'costo inválido' })
      return
    } else price = cost
    out.push({
      id,
      type: 'buy',
      date: null,
      symbol,
      quantity: shares,
      price,
      currency: symbol.endsWith('.MX') ? 'MXN' : 'USD',
      fxRate: null,
      fees: 0,
      amount: null,
      ratio: null,
      note: MIGRATED_NOTE,
    })
  })
  return out
}

function signature(positions) {
  if (!Array.isArray(positions)) return ''
  return positions.map((p) => `${p?.ticker}:${p?.shares}:${p?.cost}`).join('|')
}

/** @param {string} raw @returns {string[] | null} */
function parseScreenerList(raw) {
  const text = raw.trim()
  if (text.startsWith('[')) {
    try {
      const arr = JSON.parse(text)
      return Array.isArray(arr) ? arr.map(String) : null
    } catch {
      return null
    }
  }
  // Igual que la app vieja (separados por coma), aceptando también punto y coma y saltos de línea.
  return text.split(/[,;\r\n]+/).map((t) => t.trim()).filter(Boolean)
}

/**
 * Arma el estado v2 a partir de las llaves viejas. No toca el storage.
 * @param {(key: string) => string | null} read
 * @param {string} [now]
 * @returns {KaizenState | null} null si no hay nada que migrar
 */
export function migrateLegacy(read, now = new Date().toISOString()) {
  const rawMany = read(LEGACY_KEYS.portfolios)
  const rawOne = read(LEGACY_KEYS.portfolio)
  const rawScreener = read(LEGACY_KEYS.screener)
  if (rawMany == null && rawOne == null && rawScreener == null) return null

  /** @type {DroppedEntry[]} */
  const dropped = []
  const notes = new Set()
  const sources = []
  /** @type {Portfolio[]} */
  const portfolios = []
  let legacyExample = false

  let legacyList = null
  if (rawMany != null) {
    sources.push(LEGACY_KEYS.portfolios)
    try {
      const parsed = JSON.parse(rawMany)
      if (Array.isArray(parsed)) legacyList = parsed
      else dropped.push({ source: LEGACY_KEYS.portfolios, reason: 'no es una lista de portafolios' })
    } catch {
      dropped.push({ source: LEGACY_KEYS.portfolios, reason: 'JSON inválido' })
    }
  }
  // Igual que la app vieja: la llave de un solo portafolio solo cuenta si no hubo la de varios.
  if (legacyList === null && rawOne != null) {
    sources.push(LEGACY_KEYS.portfolio)
    try {
      legacyList = [{ id: 'p1', name: 'Principal', positions: JSON.parse(rawOne) }]
    } catch {
      dropped.push({ source: LEGACY_KEYS.portfolio, reason: 'JSON inválido' })
    }
  }

  const ids = new Set()
  ;(legacyList ?? []).forEach((lp, i) => {
    const source = `${sources[sources.length - 1]}[${i}]`
    if (!lp || typeof lp !== 'object') {
      dropped.push({ source, reason: 'portafolio mal formado' })
      return
    }
    let id = typeof lp.id === 'string' && lp.id ? lp.id : typeof lp.id === 'number' ? `p${lp.id}` : `p${i + 1}`
    if (ids.has(id)) id = `${id}-${i + 1}`
    ids.add(id)
    if (signature(lp.positions) === LEGACY_DEFAULT_POSITIONS) legacyExample = true
    if (lp.experimentalTotal) notes.add('Los porcentajes del modo experimental no se migraron.')
    portfolios.push({
      id,
      name: typeof lp.name === 'string' && lp.name.trim() ? lp.name.trim().slice(0, 80) : `Portafolio ${i + 1}`,
      baseCurrency: 'MXN',
      createdAt: now,
      transactions: positionsToTransactions(lp.positions, id, `${source}.positions`, dropped, notes),
      targets: {},
      notes: '',
    })
  })
  if (legacyExample) notes.add('Un portafolio coincide con el de ejemplo que traía la versión anterior.')

  /** @type {Watchlist[]} */
  const watchlists = []
  if (rawScreener != null) {
    sources.push(LEGACY_KEYS.screener)
    const list = parseScreenerList(rawScreener)
    if (list === null) dropped.push({ source: LEGACY_KEYS.screener, reason: 'lista ilegible' })
    else {
      const symbols = []
      list.forEach((t, index) => {
        const s = normalizeSymbol(t)
        if (!s) dropped.push({ source: LEGACY_KEYS.screener, index, reason: `ticker inválido (${t.slice(0, 24)})` })
        else if (!symbols.includes(s)) symbols.push(s)
      })
      if (symbols.length) {
        watchlists.push({ id: 'wl-mi-lista', name: LEGACY_WATCHLIST_NAME, symbols })
        if (symbols.join(',') === LEGACY_DEFAULT_SCREENER) notes.add('"Mi lista" es la lista por defecto del screener anterior.')
      }
    }
  }

  const state = emptyState(now)
  state.portfolios = portfolios
  state.activePortfolioId = portfolios[0]?.id ?? null
  state.watchlists = watchlists
  state.migrationReport = {
    migratedAt: now,
    sources,
    backups: [],
    portfolios: portfolios.length,
    transactions: portfolios.reduce((n, p) => n + p.transactions.length, 0),
    watchlists: watchlists.length,
    dropped,
    notes: [...notes],
    legacyExample,
    recoveredFromCorruptV2: false,
  }
  return state
}

// ─── Store ──────────────────────────────────────────────────────────────────

/** @type {KaizenState | null} */
let memory = null
/** @type {{ code: string, message: string } | null} */
let lastError = null
const listeners = new Set()
let crossTabAttached = false

function local() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function safeGet(key) {
  try {
    return local()?.getItem(key) ?? null
  } catch {
    return null
  }
}

function safeSet(key, value) {
  try {
    const store = local()
    if (!store) return false
    store.setItem(key, value)
    return true
  } catch {
    return false
  }
}

function notify() {
  for (const fn of [...listeners]) fn()
}

/** Copia una llave a kaizen:backup:<iso>:<llave>. Devuelve la llave del respaldo o null. */
function backupKey(key, raw, iso) {
  const target = `${BACKUP_PREFIX}${iso}:${key}`
  return safeSet(target, raw) ? target : null
}

/** Mensaje único para cuando los datos guardados son de una versión más nueva. */
export const FUTURE_VERSION_ERROR = Object.freeze({
  code: 'FUTURE_VERSION',
  message: 'Tus datos se guardaron con una versión más nueva de Kaizen. Recarga la página para usarla.',
})

/** true cuando el estado en memoria es de solo lectura (había datos de una versión más nueva). */
let readOnly = false

/** ¿El estado es de solo lectura? Si es true, save() y update() no escriben nada. */
export function isReadOnly() {
  load()
  return readOnly
}

/** ¿`raw` es un estado v2 bien formado pero de una versión mayor? @param {unknown} raw */
function isFutureVersion(raw) {
  return Boolean(raw) && typeof raw === 'object' && !Array.isArray(raw) && typeof (/** @type {any} */ (raw).v) === 'number' && /** @type {any} */ (raw).v > 2
}

/**
 * Lee el estado (con caché en memoria). La primera vez migra desde la app vieja si hace falta.
 * @returns {KaizenState}
 */
export function load() {
  if (memory) return memory
  const now = new Date().toISOString()
  const raw = safeGet(STORAGE_KEY)
  let corrupt = false
  if (raw != null) {
    try {
      const parsed = JSON.parse(raw)
      // Una build más nueva escribió aquí: no se toca nada de lo guardado.
      if (isFutureVersion(parsed)) {
        memory = emptyState(now)
        readOnly = true
        lastError = { ...FUTURE_VERSION_ERROR }
        return memory
      }
      const res = normalizeState(parsed, now)
      if (res) {
        memory = res.state
        return memory
      }
    } catch {
      /* JSON roto: se respalda abajo */
    }
    corrupt = true
  }

  const legacyHashes = snapshotLegacyKeys(safeGet)
  const migrated = migrateLegacy(safeGet, now)
  if (migrated) migrated.legacyHashes = legacyHashes
  const backups = []
  const report = migrated?.migrationReport ?? null
  if (corrupt) {
    const b = backupKey(STORAGE_KEY, /** @type {string} */ (raw), now)
    if (b) backups.push(b)
  }
  if (migrated && report) {
    for (const key of report.sources) {
      const value = safeGet(key)
      if (value == null) continue
      const b = backupKey(key, value, now)
      if (b) backups.push(b)
      else report.notes.push(`No se pudo respaldar ${key}; la llave original sigue intacta.`)
    }
    report.backups = backups
    report.recoveredFromCorruptV2 = corrupt
    memory = migrated
    if (!safeSet(STORAGE_KEY, JSON.stringify(memory))) {
      lastError = { code: 'WRITE_FAILED', message: 'No se pudieron guardar tus datos en este navegador.' }
    }
    return memory
  }
  memory = emptyState(now)
  memory.legacyHashes = legacyHashes
  if (corrupt) {
    memory.migrationReport = {
      migratedAt: now,
      sources: [],
      backups,
      portfolios: 0,
      transactions: 0,
      watchlists: 0,
      dropped: [{ source: STORAGE_KEY, reason: 'datos ilegibles' }],
      notes: ['Los datos guardados estaban dañados; se respaldaron y se empezó de cero.'],
      legacyExample: false,
      recoveredFromCorruptV2: true,
    }
    // Se escribe ya para no respaldar lo mismo en cada recarga.
    safeSet(STORAGE_KEY, JSON.stringify(memory))
  }
  return memory
}

/**
 * Valida y guarda el estado completo. Si el navegador no deja escribir, el cambio queda en
 * memoria y getStorageError() lo reporta. Si los datos guardados son de una versión más nueva,
 * no se guarda nada (ni en memoria): se devuelve el estado tal como está y getStorageError()
 * explica por qué.
 * @param {KaizenState} state
 * @returns {KaizenState}
 */
export function save(state) {
  const current = load()
  if (readOnly) {
    lastError = { ...FUTURE_VERSION_ERROR }
    notify()
    return current
  }
  const now = new Date().toISOString()
  const res = normalizeState({ ...state, v: 2 }, now)
  if (!res) throw new TypeError('save(): el estado no tiene la forma v2')
  const next = { ...res.state, updatedAt: now, legacyHashes: res.state.legacyHashes ?? current.legacyHashes ?? null }
  memory = next
  lastError = safeSet(STORAGE_KEY, JSON.stringify(next))
    ? null
    : { code: 'WRITE_FAILED', message: 'No se pudieron guardar tus cambios en este navegador.' }
  notify()
  return next
}

/**
 * Aplica un cambio inmutable: update((s) => ({ ...s, settings: { ...s.settings, onboardingDone: true } })).
 * @param {(state: KaizenState) => KaizenState} fn
 */
export function update(fn) {
  return save(fn(load()))
}

/**
 * Último problema con el almacenamiento, o null. Dos casos: no se pudo escribir en este navegador
 * (WRITE_FAILED) o los datos guardados son de una versión más nueva (FUTURE_VERSION, y entonces
 * el estado es de solo lectura). El mensaje está en español y se puede mostrar tal cual.
 * @returns {{ code: string, message: string } | null}
 */
export function getStorageError() {
  return lastError
}

/**
 * ¿Las llaves de la app vieja cambiaron desde que se creó el estado v2? La migración es una foto
 * única (ver el encabezado del archivo): mientras src/legacy siga montado, la app vieja sigue
 * escribiendo momentum_portfolios y momentum_screener sin que eso llegue a "kaizen:v2". Esto no
 * re-migra nada; solo lo reporta, para que F1 decida qué ofrecerle a la persona.
 * No cuenta como cambio una llave que no existía al migrar y que hoy tiene exactamente el valor por
 * defecto del legado: eso no lo escribió la persona, lo escribe el Workspace legado al montarse
 * (ver isLegacyDefaultValue). Sin ese filtro, el primer paso por cualquier ruta legada dejaba
 * "momentum_screener" marcado como divergente para siempre.
 * @returns {{ known: boolean, changed: string[], hashes: LegacyHashes }}
 *   known: false si el estado v2 no trae la foto (datos de antes de este cambio, o de solo
 *   lectura). changed: las llaves viejas cuyo contenido ya no es el de la migración.
 */
export function legacyChangedSinceMigration() {
  const recorded = load().legacyHashes
  const hashes = snapshotLegacyKeys(safeGet)
  if (!recorded) return { known: false, changed: [], hashes }
  const changed = Object.keys(recorded).filter((key) => {
    if (recorded[key] === (hashes[key] ?? null)) return false
    if (recorded[key] === null && isLegacyDefaultValue(key, safeGet(key))) return false
    return true
  })
  return { known: true, changed, hashes }
}

function onStorageEvent(event) {
  if (event.key === STORAGE_KEY || event.key === null) {
    memory = null
    readOnly = false
    notify()
  }
}

/**
 * Suscribe a cambios (propios y de otras pestañas).
 * @param {() => void} fn
 * @returns {() => void}
 */
export function subscribe(fn) {
  listeners.add(fn)
  if (!crossTabAttached && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('storage', onStorageEvent)
    crossTabAttached = true
  }
  return () => listeners.delete(fn)
}

/** Respaldo descargable con todo el estado. */
export function exportJSON() {
  return JSON.stringify({ app: 'kaizen', kind: 'kaizen-backup', v: 2, exportedAt: new Date().toISOString(), data: load() }, null, 2)
}

export class ImportError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ImportError'
  }
}

/**
 * Reemplaza el estado con un respaldo (el de exportJSON o el estado v2 tal cual). Antes copia el
 * estado actual a kaizen:backup:<iso>:kaizen:v2. Lanza ImportError con mensaje en español.
 * @param {string} text
 * @returns {{ state: KaizenState, dropped: DroppedEntry[], backup: string | null }}
 */
export function importJSON(text) {
  if (isReadOnly()) throw new ImportError(FUTURE_VERSION_ERROR.message)
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new ImportError('El archivo no es un JSON válido.')
  }
  const candidate = parsed && typeof parsed === 'object' && parsed.kind === 'kaizen-backup' ? parsed.data : parsed
  const res = normalizeState(candidate)
  if (!res) throw new ImportError('El archivo no tiene el formato de respaldo de Kaizen (versión 2).')
  const current = safeGet(STORAGE_KEY)
  const backup = current == null ? null : backupKey(STORAGE_KEY, current, new Date().toISOString())
  const state = save(res.state)
  return { state, dropped: res.dropped, backup }
}

/**
 * Hook: estado completo o una parte. El selector corre en cada render; si arma objetos nuevos,
 * envolver el resultado en useMemo en el componente.
 * @template T
 * @param {(state: KaizenState) => T} [selector]
 * @returns {T}
 */
export function useStore(selector) {
  const state = useSyncExternalStore(subscribe, load, load)
  return selector ? selector(state) : /** @type {T} */ (/** @type {unknown} */ (state))
}

/** Solo pruebas: olvida la caché en memoria y los suscriptores. */
export function resetStorageForTests() {
  memory = null
  lastError = null
  readOnly = false
  listeners.clear()
}
