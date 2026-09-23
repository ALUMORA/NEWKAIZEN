// Piezas compartidas de las páginas de mercados (F2): formato por unidad y aviso de notas del API.
import { fmtMoney, fmtNumber, fmtPct } from '../../../lib/format.js'

/** Glosario por identificador de serie (coincidencia por fragmento). */
const TERMS = [
  ['objetivo', 'tasa-objetivo'],
  ['target', 'tasa-objetivo'],
  ['tiie', 'tiie'],
  ['cetes', 'cetes'],
  ['inpc', 'inpc'],
  ['udi', 'udi'],
  ['fix', 'tipo-de-cambio-fix'],
  ['vix', 'vix'],
  ['dxy', 'dxy'],
  ['spread10y2y', 'spread-10a-2a'],
]

/** @param {string} id @returns {string | undefined} */
export function termFor(id) {
  const low = String(id ?? '').toLowerCase()
  return TERMS.find(([frag]) => low.includes(frag))?.[1]
}

/** Valor de una serie según su unidad del API: fracción, índice, pesos o puntos base. */
export function fmtByUnit(value, unit) {
  if (unit === 'fraction') return fmtPct(value, { decimals: 2 })
  if (unit === 'mxn') return fmtMoney(value, 'MXN', { decimals: 4 })
  if (unit === 'bp') return `${fmtNumber(value, { decimals: 0 })} pb`
  return fmtNumber(value, { decimals: 4 })
}

/** Meta de DataStatus para un dato con su propia fecha y fuente dentro de una respuesta. */
export function itemStatus(item, meta) {
  return {
    asOf: item?.asOf ?? meta?.asOf ?? null,
    source: item?.source ?? meta?.source ?? '',
    delayMinutes: meta?.delayMinutes ?? null,
    stale: Boolean(item?.stale ?? meta?.stale),
    fallback: Boolean(meta?.fallback),
  }
}
