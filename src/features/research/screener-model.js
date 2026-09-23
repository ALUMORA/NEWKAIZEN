// Lógica pura del screener de factores (/screener): qué factor lleva qué dato crudo, cómo se
// formatea cada métrica, cobertura, pruebas cumplidas, filtros y la URL. Lo que se explica aquí
// sigue a docs/metodologia/screener-de-factores.md y a kaizen_api/domain/screeners/factors.py.
import { MISSING, fmtNumber, fmtPct } from '../../lib/format.js'
import { parseSymbols } from './symbols.js'

export const UNIVERSES = /** @type {const} */ ([
  { value: 'mx', label: 'México (BMV)' },
  { value: 'us', label: 'Estados Unidos' },
  { value: 'custom', label: 'Lista propia' },
])
/** En la URL el universo propio se escribe en español. */
const UNIVERSE_PARAM = { mx: 'mx', us: 'us', custom: 'propia' }
export const CUSTOM_MIN = 2
export const CUSTOM_MAX = 50

/**
 * Las doce métricas del tablero, en el orden del servidor. `kind` decide el formato: las
 * fracciones van como porcentaje y deuda entre capital como razón simple.
 */
export const METRICS = /** @type {const} */ ([
  { key: 'earningsYield', label: 'Rendimiento de utilidades', kind: 'pct', termKey: 'earnings-yield' },
  { key: 'fcfYield', label: 'Flujo libre / capitalización', kind: 'pct', termKey: 'fcf-yield' },
  { key: 'ebitdaToEv', label: 'EBITDA / valor empresa', kind: 'pct', termKey: 'ev-ebitda' },
  { key: 'bookToPrice', label: 'Libros / precio', kind: 'pct', termKey: 'p-vl' },
  { key: 'returnOnEquity', label: 'ROE', kind: 'pct', termKey: 'roe' },
  { key: 'returnOnAssets', label: 'ROA', kind: 'pct', text: 'Utilidad neta entre activos totales: cuánto gana la empresa por cada peso de activos.' },
  { key: 'operatingMargin', label: 'Margen operativo', kind: 'pct', termKey: 'margen-operativo' },
  { key: 'debtToEquity', label: 'Deuda / capital', kind: 'ratio', termKey: 'deuda-capital' },
  { key: 'momentum12m1', label: 'Momentum 12-1', kind: 'pct', termKey: 'momentum-12-1' },
  { key: 'volatility', label: 'Volatilidad anual', kind: 'pct', termKey: 'volatilidad' },
  { key: 'revenueGrowth', label: 'Crecimiento de ingresos', kind: 'pct', text: 'Ingresos del último periodo contra el mismo periodo del año anterior.' },
  { key: 'earningsGrowth', label: 'Crecimiento de utilidades', kind: 'pct', text: 'Utilidades del último periodo contra el mismo periodo del año anterior.' },
])

const METRIC_BY_KEY = Object.fromEntries(METRICS.map((m) => [m.key, m]))

/**
 * Los cinco factores con el dato crudo que va junto al puntaje. Los textos repiten, en llano, la
 * tabla "Los factores" de la metodología.
 */
export const FACTORS = /** @type {const} */ ([
  {
    key: 'value',
    label: 'Valor',
    raw: 'earningsYield',
    rawLabel: 'rend. utilidades',
    termKey: 'factor-valor',
    text: 'Cuánta utilidad, flujo libre, EBITDA y valor en libros recibes por cada peso de precio, contra sus pares del sector. Los múltiplos se invierten antes de comparar, así que una empresa con pérdidas queda abajo y no sale “barata”.',
  },
  {
    key: 'quality',
    label: 'Calidad',
    raw: 'returnOnEquity',
    rawLabel: 'ROE',
    termKey: 'factor-calidad',
    text: 'Rentabilidad (ROE, ROA y margen operativo) y deuda moderada frente a su sector. La deuda cuenta al revés: menos deuda entre capital suma.',
  },
  {
    key: 'momentum',
    label: 'Momentum',
    raw: 'momentum12m1',
    rawLabel: '12-1',
    termKey: 'momentum-12-1',
    text: 'Rendimiento de los últimos 12 meses sin contar el más reciente, en la moneda de cotización y sin restar un referente. Es el mismo cálculo de la ficha.',
  },
  {
    key: 'lowVol',
    label: 'Baja volatilidad',
    raw: 'volatility',
    rawLabel: 'vol. anual',
    termKey: 'baja-volatilidad',
    text: 'Qué tan poco se mueve el precio: volatilidad anualizada de rendimientos semanales de dos años, con el signo invertido para que moverse menos sume.',
  },
  {
    key: 'growth',
    label: 'Crecimiento',
    raw: 'revenueGrowth',
    rawLabel: 'ingresos',
    text: 'Crecimiento de ingresos y de utilidades contra el mismo periodo del año anterior, comparado con su sector.',
  },
])

export const COMPOSITE_TEXT =
  'Promedio de los factores que sí tienen puntaje, no su suma, para no castigar a quien le falta un dato. Con menos de tres factores con puntaje sale s/d.'
export const Z_TEXT =
  'Cuántas desviaciones robustas está una métrica arriba (+) o abajo (−) de la mediana de su sector: z = (x − mediana) / (1.4826 × MAD), recortado a ±3. Un sector con menos de 5 emisoras se compara contra todo el universo.'
export const COVERAGE_TEXT =
  'Cuántas de las doce métricas tienen dato para la emisora. Con menos de la mitad sale del tablero, con el motivo escrito.'

/**
 * Nombre sin la razón social del final: "Wal-Mart de México, S.A.B. de C.V." → "Wal-Mart de México".
 * @param {string | null | undefined} name
 */
export function shortName(name) {
  return String(name ?? '')
    .replace(/,?\s+S\.\s?A\.(\s?B\.)?(\s+de\s+C\.\s?V\.)?$/i, '')
    .trim()
}

/** Puntaje z con signo y dos decimales: "+1.35", "−0.42", "s/d". @param {unknown} z */
export function fmtZ(z) {
  return fmtNumber(z, { decimals: 2, sign: true })
}

/**
 * Una métrica cruda con su formato: porcentaje desde fracción o razón simple.
 * @param {string} key
 * @param {unknown} value
 * @param {{ decimals?: number }} [options]
 */
export function fmtMetric(key, value, { decimals } = {}) {
  const spec = METRIC_BY_KEY[key]
  if (spec?.kind === 'ratio') return fmtNumber(value, { decimals: decimals ?? 2 })
  if (typeof value === 'string') return value
  return fmtPct(value, { decimals: decimals ?? 1 })
}

/**
 * Métricas con dato y total: { have: 10, total: 12 }. Manda la cobertura del servidor (la misma
 * con la que decide quién sale del tablero); el total son las métricas que trae el renglón.
 * @param {{ metrics?: Record<string, unknown>, coverage?: number | null }} row
 */
export function coverageOf(row) {
  const values = Object.values(row.metrics ?? {})
  const total = values.length || METRICS.length
  const have =
    typeof row.coverage === 'number' && Number.isFinite(row.coverage)
      ? Math.round(row.coverage * total)
      : values.filter((v) => typeof v === 'number' && Number.isFinite(v)).length
  return { have, total }
}

/** Pruebas cumplidas, no cumplidas y sin dato. @param {{ checks?: { pass: boolean | null }[] }} row */
export function checksOf(row) {
  const checks = row.checks ?? []
  return {
    pass: checks.filter((c) => c.pass === true).length,
    fail: checks.filter((c) => c.pass === false).length,
    missing: checks.filter((c) => c.pass == null).length,
    total: checks.length,
  }
}

/** "4 de 6" y, si faltan datos, "4 de 6 (1 s/d)". @param {{ checks?: { pass: boolean | null }[] }} row */
export function checksText(row) {
  const c = checksOf(row)
  if (!c.total) return MISSING
  return `${c.pass} de ${c.total}${c.missing ? ` (${c.missing} ${MISSING})` : ''}`
}

/**
 * El umbral escrito de una prueba, con el mismo formato que su valor: "6.0%" o "1.00".
 * @param {{ id: string, threshold: unknown }} check
 */
export function thresholdText(check) {
  const metric = CHECK_METRIC[check.id]
  if (typeof check.threshold === 'string') return check.threshold
  return metric ? fmtMetric(metric, check.threshold) : fmtNumber(check.threshold)
}

/**
 * Las pruebas que trae el tablero, una por id y en el orden del servidor.
 * @template {{ id: string }} C
 * @param {{ checks?: C[] }[]} rows
 * @returns {C[]}
 */
export function checkDefs(rows) {
  /** @type {Map<string, C>} */
  const defs = new Map()
  for (const row of rows) for (const c of row.checks ?? []) if (!defs.has(c.id)) defs.set(c.id, c)
  return [...defs.values()]
}

/** Prueba → métrica que mide (ids de kaizen_api/domain/screeners/factors.py). */
export const CHECK_METRIC = Object.freeze({
  valor: 'earningsYield',
  calidad: 'returnOnEquity',
  margen: 'operatingMargin',
  deuda: 'debtToEquity',
  crecimiento: 'revenueGrowth',
  momento: 'momentum12m1',
})

/** El valor medido de una prueba con su formato. @param {{ id: string, value: unknown }} check */
export function checkValueText(check) {
  const metric = CHECK_METRIC[check.id]
  if (typeof check.value === 'string') return check.value
  return metric ? fmtMetric(metric, check.value) : fmtNumber(check.value)
}

/**
 * Etiqueta corta del motivo de un renglón que sí se compara: el texto completo va en las notas.
 * @param {string | null | undefined} reason
 */
export function reasonTag(reason) {
  if (!reason) return null
  if (/todo el universo/i.test(reason)) return 'Contra todo el universo'
  if (/reporta en/i.test(reason)) return 'Valor en s/d por moneda'
  return 'Con nota'
}

/**
 * Motivos agrupados: cada texto una vez, con las claves a las que aplica.
 * @param {{ symbol: string, reason?: string | null }[]} rows
 * @returns {{ reason: string, symbols: string[] }[]}
 */
export function groupReasons(rows) {
  /** @type {Map<string, string[]>} */
  const map = new Map()
  for (const row of rows) {
    if (!row.reason) continue
    map.set(row.reason, [...(map.get(row.reason) ?? []), row.symbol])
  }
  return [...map].map(([reason, symbols]) => ({ reason, symbols }))
}

/** Sectores presentes, en orden alfabético del español; "Sin sector" al final. @param {{ sector?: string | null }[]} rows */
export function sectorsOf(rows) {
  const set = new Set(rows.map((r) => r.sector || 'Sin sector'))
  const list = [...set].filter((s) => s !== 'Sin sector').sort((a, b) => a.localeCompare(b, 'es-MX'))
  return set.has('Sin sector') ? [...list, 'Sin sector'] : list
}

/** @param {{ sector?: string | null }[]} rows @param {string} sector '' = todos */
export function filterBySector(rows, sector) {
  return sector ? rows.filter((r) => (r.sector || 'Sin sector') === sector) : rows
}

/**
 * Lee la URL: ?universo=mx|us|propia&symbols=A,B&sector=...
 * @param {URLSearchParams} params
 * @returns {{ universe: 'mx' | 'us' | 'custom', symbols: string[], sector: string }}
 */
export function readParams(params) {
  const raw = params.get('universo')
  const universe = raw === 'us' ? 'us' : raw === 'propia' ? 'custom' : 'mx'
  const symbols = universe === 'custom' ? parseSymbols(params.get('symbols')).slice(0, CUSTOM_MAX) : []
  return { universe, symbols, sector: params.get('sector') ?? '' }
}

/**
 * Arma la URL de vuelta, sin llaves vacías.
 * @param {{ universe: 'mx' | 'us' | 'custom', symbols?: string[], sector?: string }} state
 */
export function writeParams({ universe, symbols = [], sector = '' }) {
  /** @type {Record<string, string>} */
  const out = {}
  if (universe !== 'mx') out.universo = UNIVERSE_PARAM[universe]
  if (universe === 'custom' && symbols.length) out.symbols = symbols.join(',')
  if (sector) out.sector = sector
  return out
}
