// Cálculo de la calculadora de CETES. Puro, para poder probarlo sin React.
// La retención de ISR (tasa de la ley vigente y fórmula) vive en src/lib/finance/tax-mx.js; aquí no
// se repite.
import { cetesEffectiveAnnual, cetesPerPeriod } from '../../../lib/finance/index.js'
import { INTEREST_WITHHOLDING_RATE, INTEREST_WITHHOLDING_SOURCE, interestWithholding } from '../../../lib/finance/tax-mx.js'
import { fmtPct } from '../../../lib/format.js'

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
 *   annualYield y retentionRate como fracción; la retención es la de interestWithholding de tax-mx
 */
export function cetesResult({ amount, tenorDays, annualYield, retentionRate }) {
  const ok = [amount, annualYield, retentionRate].every((v) => typeof v === 'number' && Number.isFinite(v))
  if (!ok || amount <= 0 || tenorDays <= 0) return null
  // Fuera de 0 a 100 %, interestWithholding usaría la tasa de la ley en silencio y el resultado no
  // correspondería a lo que dice el campo: mejor s/d.
  if (retentionRate < 0 || retentionRate > 1) return null
  const periodYield = cetesPerPeriod(annualYield, tenorDays, tenorDays)
  if (periodYield == null) return null
  const gross = amount * periodYield
  const retention = interestWithholding(amount, tenorDays, { rate: retentionRate })
  if (retention == null) return null
  return {
    periodYield,
    gross,
    retention,
    net: gross - retention,
    effectiveAnnual: cetesEffectiveAnnual(annualYield, tenorDays),
  }
}

/** Ayuda del campo de retención: la tasa y la ley salen de tax-mx, no de un texto escrito a mano. */
export function retentionHint() {
  return `${fmtPct(INTEREST_WITHHOLDING_RATE)} al año, según la ${INTEREST_WITHHOLDING_SOURCE.split(':')[0]}.`
}
