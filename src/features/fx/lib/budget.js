// Presupuesto en dólares contra el forward teórico (V5FX, /empresas/cobertura). Todo se calcula en
// el navegador y es descriptivo: dónde cae el nivel presupuestal en la historia, cuánto cambia el
// costo en pesos por cada movimiento del tipo de cambio y cómo se compara con el forward teórico
// por mes. No hay probabilidades ni sugerencias de cubrirse.

/** Choques del tipo de cambio que se muestran, en pesos por dólar. */
export const SHOCKS = [-1, -0.5, 0.5, 1]

/**
 * Fracción de observaciones menores o iguales al nivel ([17, 18, 19, 20] y 19 → 0.75). Ignora
 * huecos; null si no hay ventana o el nivel no es número.
 * @param {number | null | undefined} level
 * @param {(number | null | undefined)[]} window
 * @returns {number | null}
 */
export function percentileOf(level, window) {
  if (level == null || !Number.isFinite(level)) return null
  const values = (window ?? []).filter((v) => v != null && Number.isFinite(v))
  if (!values.length) return null
  let below = 0
  for (const v of values) if (v <= level) below += 1
  return below / values.length
}

/**
 * Cambio en pesos de un flujo en dólares ante un choque del tipo de cambio:
 * 100,000 USD y +0.50 → +50,000 MXN.
 * @param {number | null | undefined} flowUsd
 * @param {number} shock pesos por dólar
 * @returns {number | null}
 */
export function impactMxn(flowUsd, shock) {
  if (flowUsd == null || !Number.isFinite(flowUsd) || !Number.isFinite(shock)) return null
  return Math.round(flowUsd * shock * 100) / 100
}

/**
 * Barras de impacto para un flujo total.
 * @param {number | null | undefined} flowUsd
 * @param {number[]} [shocks]
 */
export function impactBars(flowUsd, shocks = SHOCKS) {
  return shocks.map((s) => ({
    label: `${s > 0 ? '+' : '−'}${Math.abs(s).toFixed(2)} por dólar`,
    shock: s,
    value: impactMxn(flowUsd, s),
  }))
}

/** @param {string} iso @param {number} months fin del mes `months` meses después */
export function monthEnd(iso, months) {
  const d = new Date(`${iso}T00:00:00Z`)
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months + 1, 0))
  return end.toISOString().slice(0, 10)
}

/** @param {string} a @param {string} b */
function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

/**
 * Forward teórico a `days` días, interpolado en línea recta entre el spot (día 0) y los plazos que
 * trae el API. Más allá del último plazo no se extrapola: null.
 * @param {{ days: number, forward: number | null }[]} rows
 * @param {number} spot
 * @param {number} days
 * @returns {number | null}
 */
export function forwardAt(rows, spot, days) {
  const pts = [{ days: 0, forward: spot }, ...(rows ?? []).filter((r) => r.forward != null && Number.isFinite(r.forward))]
    .sort((a, b) => a.days - b.days)
  if (!Number.isFinite(spot) || days < 0) return null
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1]
    const b = pts[i]
    if (days <= b.days) {
      if (b.days === a.days) return b.forward
      const t = (days - a.days) / (b.days - a.days)
      return a.forward + t * (b.forward - a.forward)
    }
  }
  return days === 0 ? spot : null
}

/**
 * @typedef {{ month: string, date: string, days: number, forward: number | null, budget: number,
 *   flowUsd: number, diffPerUsd: number | null, diffMxn: number | null }} BudgetMonth
 */

/**
 * Proyección por mes: el forward teórico al cierre de cada mes contra el tipo presupuestal y la
 * diferencia en pesos del flujo de ese mes (positiva: el forward queda arriba del presupuesto).
 * @param {{ spot: number, asOf: string, rows: { days: number, forward: number | null }[],
 *   budgetRate: number, flowUsd: number, months: number }} input
 * @returns {BudgetMonth[]}
 */
export function projectBudget({ spot, asOf, rows, budgetRate, flowUsd, months }) {
  if (!asOf || !Number.isFinite(spot) || !Number.isFinite(budgetRate)) return []
  const out = []
  const offset = monthEnd(asOf, 0) <= asOf ? 1 : 0
  for (let m = 0; m < months; m += 1) {
    const date = monthEnd(asOf, m + offset)
    const days = daysBetween(asOf, date)
    const forward = forwardAt(rows, spot, days)
    const flow = Number.isFinite(flowUsd) ? flowUsd : 0
    const diffPerUsd = forward == null ? null : forward - budgetRate
    out.push({
      month: date.slice(0, 7),
      date,
      days,
      forward,
      budget: budgetRate,
      flowUsd: flow,
      diffPerUsd,
      diffMxn: diffPerUsd == null ? null : Math.round(diffPerUsd * flow * 100) / 100,
    })
  }
  return out
}
