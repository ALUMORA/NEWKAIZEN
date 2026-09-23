// Lógica sin React del panorama de /mercados: qué se muestra una sola vez, cómo se escribe cada
// precio, qué dice el estado de cada bolsa y el resumen del día. El resumen es factual a propósito:
// qué subió, qué bajó y cuánto, sin etiqueta de ánimo ni afirmaciones de causa.
import { MISSING, fmtInt, fmtMoney, fmtNumber, fmtPct } from '../../../lib/format.js'

export const VIX_SYMBOL = '^VIX'
export const DXY_SYMBOL = 'DX-Y.NYB'
export const USDMXN_SYMBOL = 'USDMXN=X'

const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/

/** Zona de cada bolsa: la fecha de un cierre se lee en la hora de su propia bolsa. */
export const EXCHANGES = {
  bmv: { id: 'bmv', name: 'BMV', long: 'Bolsa Mexicana de Valores', tz: 'America/Mexico_City', group: 'mx' },
  nyse: { id: 'nyse', name: 'NYSE', long: 'Bolsa de Nueva York', tz: 'America/New_York', group: 'us' },
}

/**
 * "vie 18 sep". Una fecha sola se toma tal cual; un instante se lee en la zona de la bolsa.
 * @param {unknown} value @param {string} [tz] @returns {string}
 */
export function fmtSessionDay(value, tz = 'America/Mexico_City') {
  if (typeof value !== 'string' || !value.trim()) return MISSING
  const text = value.trim()
  let y, m, d
  const only = DATE_ONLY.exec(text)
  if (only) {
    ;[y, m, d] = [Number(only[1]), Number(only[2]), Number(only[3])]
  } else {
    const date = new Date(text)
    if (Number.isNaN(date.getTime())) return MISSING
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
    const get = (type) => Number(parts.find((p) => p.type === type)?.value)
    ;[y, m, d] = [get('year'), get('month'), get('day')]
  }
  const utc = new Date(Date.UTC(y, m - 1, d))
  if (utc.getUTCMonth() !== m - 1 || utc.getUTCDate() !== d) return MISSING
  return `${WEEKDAYS[utc.getUTCDay()]} ${d} ${MONTHS[m - 1]}`
}

/** Fecha más nueva de los renglones de un grupo, o null. */
export function latestAsOf(items) {
  let best = null
  for (const it of items ?? []) if (it?.asOf && (best === null || String(it.asOf) > best)) best = String(it.asOf)
  return best
}

/**
 * Estado de una bolsa para su insignia: abierta con "Retraso ~15 min", cerrada con
 * "Cierre vie 18 sep". `detail` es el texto del API tal cual (cuándo abre o cierra).
 * @param {{ open: boolean, label: string } | null | undefined} status
 * @param {{ lastAsOf?: string | null, delayMinutes?: number | null, tz?: string }} [ctx]
 */
export function exchangeTiming(status, { lastAsOf = null, delayMinutes = null, tz } = {}) {
  if (!status) return { known: false, open: false, state: 'Sin dato', timing: 'El servidor no mandó el estado de esta bolsa.', detail: '' }
  if (status.open) {
    const timing = typeof delayMinutes === 'number' && delayMinutes > 0 ? `Retraso ~${fmtInt(delayMinutes)} min` : 'Retraso s/d'
    return { known: true, open: true, state: 'Abierta', timing, detail: status.label ?? '' }
  }
  const day = lastAsOf ? fmtSessionDay(lastAsOf, tz) : MISSING
  return { known: true, open: false, state: 'Cerrada', timing: day === MISSING ? 'Cierre s/d' : `Cierre ${day}`, detail: status.label ?? '' }
}

const CURRENCY_NAMES = { MXN: 'peso', USD: 'dólar', EUR: 'euro', GBP: 'libra', JPY: 'yen' }

/**
 * Pista de texto para un tipo de cambio, que no tiene bueno ni malo: si USD/MXN sube, el peso está
 * más débil. En el DXY, si sube, el dólar está más fuerte. undefined si no hay cambio o no aplica.
 * @param {string} symbol @param {number | null | undefined} change
 */
export function fxHint(symbol, change) {
  if (typeof change !== 'number' || !Number.isFinite(change) || change === 0) return undefined
  if (symbol === DXY_SYMBOL) return change > 0 ? 'dólar más fuerte' : 'dólar más débil'
  const m = /^([A-Z]{3})([A-Z]{3})=X$/.exec(String(symbol))
  const quote = m ? CURRENCY_NAMES[m[2]] : undefined
  if (!quote) return undefined
  return change > 0 ? `${quote} más débil` : `${quote} más fuerte`
}

/** ¿Este renglón es un tipo de cambio o índice de divisas (movimiento sin bueno ni malo)? */
export function isFxLike(item, groupId) {
  return groupId === 'fx' || /=X$/.test(String(item?.symbol)) || item?.symbol === DXY_SYMBOL
}

/**
 * Precio de un renglón del panorama: índices en puntos, divisas con 4 decimales (el DXY con 2),
 * materias primas y cripto con su moneda. Sin precio: "s/d".
 */
export function fmtItemPrice(item, groupId) {
  const price = item?.price
  if (typeof price !== 'number' || !Number.isFinite(price)) return MISSING
  if (item.symbol === DXY_SYMBOL) return fmtNumber(price, { decimals: 2 })
  if (isFxLike(item, groupId)) return fmtNumber(price, { decimals: 4 })
  if (String(item.symbol).startsWith('^') || !item.currency) return fmtNumber(price, { decimals: 2 })
  return fmtMoney(price, item.currency, { decimals: 2 })
}

/**
 * Quita duplicados entre /v2/markets/overview, /v2/macro/us y /v2/markets/world:
 * - el VIX sale una sola vez, en su medidor de percentil (no en la tabla ni en las tasas);
 * - el DXY sale en Divisas si el panorama lo trae con precio; si no, en las tasas de EE. UU.;
 * - un símbolo repetido dentro del panorama o del mundo se queda en su primera aparición, y un ETF
 *   del mundo que ya esté en el panorama no se repite.
 * @param {{ overview?: any, macro?: any, world?: any }} data
 */
export function dedupeMarkets({ overview, macro, world } = {}) {
  const seen = new Set()
  const groups = (overview?.groups ?? []).map((g) => ({
    ...g,
    items: (g.items ?? []).filter((it) => {
      if (!it?.symbol || it.symbol === VIX_SYMBOL || seen.has(it.symbol)) return false
      seen.add(it.symbol)
      return true
    }),
  }))
  const overviewDxy = groups.some((g) => g.items.some((it) => it.symbol === DXY_SYMBOL && typeof it.price === 'number'))
  const usRates = (macro?.items ?? []).filter((it) => it.id !== 'vix' && !(it.id === 'dxy' && overviewDxy))
  const worldSeen = new Set()
  const worldItems = (world?.items ?? []).filter((it) => {
    const key = it?.symbol ?? it?.country
    if (!key || seen.has(key) || worldSeen.has(key)) return false
    worldSeen.add(key)
    return true
  })
  return { groups: groups.filter((g) => g.items.length > 0), usRates, world: worldItems }
}

/**
 * El VIX que se muestra: el del panorama (más reciente, con retraso de la bolsa) si trae precio;
 * si no, el de /v2/macro/us. null si ninguno lo trae.
 * @returns {{ value: number, change: number | null, asOf: string | null, source: string, delayMinutes: number | null, stale: boolean, fallback: boolean, from: 'overview' | 'macro' } | null}
 */
export function pickVix(overview, macro) {
  for (const g of overview?.groups ?? []) {
    const it = (g.items ?? []).find((x) => x?.symbol === VIX_SYMBOL)
    if (it && typeof it.price === 'number' && Number.isFinite(it.price)) {
      const m = overview.meta ?? {}
      return { value: it.price, change: it.change ?? null, asOf: it.asOf ?? m.asOf ?? null, source: m.source ?? '', delayMinutes: m.delayMinutes ?? null, stale: Boolean(m.stale), fallback: Boolean(m.fallback), from: 'overview' }
    }
  }
  const v = (macro?.items ?? []).find((x) => x?.id === 'vix')
  if (v && typeof v.value === 'number' && Number.isFinite(v.value)) {
    const m = macro.meta ?? {}
    return { value: v.value, change: v.change ?? null, asOf: v.asOf ?? m.asOf ?? null, source: v.source ?? m.source ?? '', delayMinutes: m.delayMinutes ?? null, stale: Boolean(m.stale), fallback: Boolean(m.fallback), from: 'macro' }
  }
  return null
}

/** Dirección de una variación en fracción, con el mismo redondeo que se muestra (2 decimales). */
function dirOf(changePct) {
  const rounded = Math.round(changePct * 10000)
  return rounded > 0 ? 'up' : rounded < 0 ? 'down' : 'flat'
}

const pctAbs = (x) => fmtPct(Math.abs(x), { decimals: 2 })
const pctSigned = (x) => fmtPct(x, { decimals: 2, sign: true })

/** Una línea por índice clave: "S&P/BMV IPC sube 0.49% y va en 61,234.52 puntos." */
function indexSentence(item, open) {
  const price = fmtNumber(item.price, { decimals: 2 })
  const dir = dirOf(item.changePct)
  if (open === false) {
    if (dir === 'flat') return `${item.label} cerró sin cambio, en ${price} puntos.`
    return `${item.label} cerró con ${dir === 'up' ? 'alza' : 'baja'} de ${pctAbs(item.changePct)}, en ${price} puntos.`
  }
  if (dir === 'flat') return `${item.label} va sin cambio, en ${price} puntos.`
  return `${item.label} ${dir === 'up' ? 'sube' : 'baja'} ${pctAbs(item.changePct)} y va en ${price} puntos.`
}

const hasMove = (it) => it && typeof it.changePct === 'number' && Number.isFinite(it.changePct) && typeof it.price === 'number'

/**
 * Resumen del día: oraciones factuales armadas solo con lo que trae el API. Nada de "sube por...",
 * nada de "sentimiento". Un dato que falta se dice en la última línea.
 * @param {{ groups: any[], marketStatus?: any }} input grupos ya sin duplicados
 * @returns {{ id: string, text: string }[]}
 */
export function dailySummary({ groups, marketStatus } = { groups: [] }) {
  const out = []
  const all = (groups ?? []).flatMap((g) => (g.items ?? []).map((it) => ({ ...it, groupId: g.id })))
  const find = (symbol) => all.find((it) => it.symbol === symbol)
  for (const [symbol, exchange] of [['^MXX', 'bmv'], ['^GSPC', 'nyse']]) {
    const it = find(symbol)
    if (hasMove(it)) out.push({ id: symbol, text: indexSentence(it, marketStatus?.[exchange]?.open) })
  }
  const usd = find(USDMXN_SYMBOL)
  if (hasMove(usd)) {
    const dir = dirOf(usd.changePct)
    const price = fmtNumber(usd.price, { decimals: 4 })
    out.push({
      id: USDMXN_SYMBOL,
      text:
        dir === 'flat'
          ? `El dólar va sin cambio frente al peso, en ${price} pesos por dólar.`
          : `El dólar ${dir === 'up' ? 'sube' : 'baja'} ${pctAbs(usd.changePct)} frente al peso, a ${price} pesos por dólar: ${dir === 'up' ? 'peso más débil' : 'peso más fuerte'}.`,
    })
  }
  const movers = all.filter((it) => hasMove(it) && !isFxLike(it, it.groupId))
  if (movers.length) {
    const count = { up: 0, down: 0, flat: 0 }
    for (const it of movers) count[dirOf(it.changePct)] += 1
    out.push({
      id: 'breadth',
      text: `Contra su cierre anterior, de ${fmtInt(movers.length)} índices, materias primas y criptomonedas con dato, ${fmtInt(count.up)} están arriba, ${fmtInt(count.down)} abajo y ${fmtInt(count.flat)} sin cambio.`,
    })
    const sorted = [...movers].sort((a, b) => b.changePct - a.changePct)
    const top = sorted[0]
    const bottom = sorted.at(-1)
    const parts = []
    if (dirOf(top.changePct) === 'up') parts.push(`Mayor alza: ${top.label}, ${pctSigned(top.changePct)}.`)
    if (dirOf(bottom.changePct) === 'down') parts.push(`Mayor baja: ${bottom.label}, ${pctSigned(bottom.changePct)}.`)
    if (parts.length) out.push({ id: 'extremes', text: parts.join(' ') })
  }
  const missing = all.filter((it) => typeof it.price !== 'number').map((it) => it.label)
  if (missing.length) out.push({ id: 'missing', text: `Sin dato en esta actualización: ${missing.join(', ')}.` })
  return out
}
