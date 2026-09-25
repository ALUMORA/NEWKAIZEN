// Tendencia de un mes de la lista de seguimiento, con su meta: de qué fecha a qué fecha, con qué
// precios y en qué moneda. Pura para poder probarla sin navegador.
import { fmtDate, fmtPct } from '../../lib/format.js'

/**
 * @param {{ symbol?: string, currency?: string | null, interval?: string, adjusted?: boolean,
 *   dates?: string[], close?: (number | null)[] } | null | undefined} history respuesta de /v2/history
 * @returns {null | { change: number | null, start: string, end: string, label: string, note: string }}
 */
export function trendSummary(history) {
  const dates = history?.dates ?? []
  const close = history?.close ?? []
  if (!dates.length || !close.length) return null
  const first = close[0]
  const last = close[close.length - 1]
  const change = typeof first === 'number' && first > 0 && typeof last === 'number' ? last / first - 1 : null
  const start = dates[0]
  const end = dates[dates.length - 1]
  const period = `del ${fmtDate(start)} al ${fmtDate(end)}`
  const kind = `${history?.interval === '1wk' ? 'cierres semanales' : 'cierres diarios'}${history?.adjusted === false ? '' : ' ajustados'}`
  const label = `${history?.symbol ?? ''}: ${period}, ${kind}${history?.currency ? ` en ${history.currency}` : ''}, cambio de ${change === null ? 's/d' : fmtPct(change, { sign: true })}`
  const note = `Un mes: cambio entre el primer y el último ${kind.replace('cierres', 'cierre').replace('diarios', 'diario').replace('semanales', 'semanal').replace('ajustados', 'ajustado')}, ${period}, en la moneda de cada emisora.`
  return { change, start, end, label, note }
}
