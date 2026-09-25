// Cálculo de la calculadora de CETES. Puro, para poder probarlo sin React.
import { cetesEffectiveAnnual, cetesPerPeriod } from '../../../lib/finance/index.js'

/**
 * Tasa anual de retención provisional de ISR sobre el capital invertido. La fija cada año la Ley de
 * Ingresos de la Federación (0.90 % en 2026); es editable en la calculadora.
 */
export const ISR_RETENTION_2026 = 0.009

/** Plazo en días a partir del identificador o la etiqueta de una serie ("cetes91" → 91). */
export function tenorOf(item) {
  const m = String(item?.id ?? '').match(/(\d{2,3})/) ?? String(item?.label ?? '').match(/(\d{2,3})/)
  return m ? Number(m[1]) : null
}

/**
 * Renglones de CETES de /v2/rates/mx, del plazo más corto al más largo. Desde la fase 3 cada
 * renglón trae `tenorDays` (28, 91, 182 o 364 en los CETES, null en lo demás) y con eso basta. Un
 * API anterior no trae el campo: entonces se reconoce por el texto ("cetes" en id o etiqueta) y el
 * plazo sale de tenorOf.
 * @param {any[] | undefined} items
 */
export function cetesRows(items) {
  return (items ?? [])
    .flatMap((it) => {
      if (it?.unit !== 'fraction') return []
      if (it.tenorDays !== undefined) return it.tenorDays != null ? [it] : []
      if (!/cetes/i.test(`${it.id} ${it.label}`)) return []
      const tenorDays = tenorOf(it)
      return tenorDays != null ? [{ ...it, tenorDays }] : []
    })
    .sort((a, b) => a.tenorDays - b.tenorDays)
}

/**
 * @param {{ amount: number | null, tenorDays: number, annualYield: number | null, retentionRate: number | null }} input
 *   annualYield y retentionRate como fracción
 */
export function cetesResult({ amount, tenorDays, annualYield, retentionRate }) {
  const ok = [amount, annualYield, retentionRate].every((v) => typeof v === 'number' && Number.isFinite(v))
  if (!ok || amount <= 0 || tenorDays <= 0) return null
  const periodYield = cetesPerPeriod(annualYield, tenorDays, tenorDays)
  if (periodYield == null) return null
  const gross = amount * periodYield
  const retention = amount * retentionRate * (tenorDays / 365)
  return {
    periodYield,
    gross,
    retention,
    net: gross - retention,
    effectiveAnnual: cetesEffectiveAnnual(annualYield, tenorDays),
  }
}
