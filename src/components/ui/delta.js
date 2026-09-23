// Lógica de Delta sin React: texto con signo y dirección para el color.
import { MINUS, MISSING, fmtBp, fmtMoney, fmtNumber, fmtPct, fmtPp } from '../../lib/format.js'

/** Formateadores por tipo. pct y pp reciben fracciones; bp, puntos base; money y number, montos. */
const FORMATTERS = {
  pct: (value, o) => fmtPct(value, { sign: true, ...(o.decimals !== undefined && { decimals: o.decimals }) }),
  pp: (value, o) => fmtPp(value, o.decimals !== undefined ? { decimals: o.decimals } : undefined),
  bp: (value, o) => fmtBp(value, o.decimals !== undefined ? { decimals: o.decimals } : undefined),
  money: (value, o) => fmtMoney(value, o.currency ?? 'MXN', { sign: true, decimals: o.decimals, compact: o.compact }),
  number: (value, o) => fmtNumber(value, { sign: true, decimals: o.decimals, compact: o.compact }),
}

/**
 * Texto y dirección de una variación. La dirección sale del texto ya
 * redondeado, no del número crudo: 0.00001 se muestra "0.00%" y por eso va
 * plano, no verde con un cero.
 *
 * @param {unknown} value
 * @param {{ kind?: 'pct'|'pp'|'bp'|'money'|'number', currency?: string, decimals?: number, compact?: boolean, direction?: 'auto'|'neutral' }} [options]
 * @returns {{ text: string, dir: 'up'|'down'|'flat'|'neutral', missing: boolean }}
 */
export function describeDelta(value, { kind = 'pct', currency, decimals, compact, direction = 'auto' } = {}) {
  const format = FORMATTERS[kind] ?? FORMATTERS.number
  const text = format(value, { currency, decimals, compact })
  if (text === MISSING) return { text, dir: 'flat', missing: true }
  const sign = text.startsWith('+') ? 'up' : text.startsWith(MINUS) ? 'down' : 'flat'
  const dir = direction === 'neutral' && sign !== 'flat' ? 'neutral' : sign
  return { text, dir, missing: false }
}
