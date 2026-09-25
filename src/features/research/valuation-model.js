// Lógica sin React de la valuación de la ficha: en qué moneda va cada bloque y qué supuestos acepta
// el API antes de mandarlos.

/**
 * Rangos que acepta GET /v2/valuation (kaizen_api/routers/valuation.py), en porcentaje como los
 * escribe la persona. Fuera de ellos el API responde 422, así que se detienen aquí con su mensaje.
 */
export const ASSUMPTION_LIMITS = {
  erp: { min: 0, max: 20, label: 'La prima de mercado va' },
  crp: { min: 0, max: 20, label: 'El riesgo país va' },
  growth: { min: -50, max: 100, label: 'El crecimiento inicial va' },
  terminalGrowth: { min: -2, max: 6, label: 'El crecimiento terminal va' },
  years: { min: 1, max: 15, label: 'Los años de proyección van' },
}

const fmtBound = (n) => String(n).replace('-', '−')

/**
 * Valida el borrador del formulario y lo pasa a parámetros del API (porcentajes a fracción).
 * @param {Record<string, number | null | undefined>} draft
 * @returns {{ params: Record<string, number>, errors: Record<string, string> }}
 */
export function validateAssumptions(draft) {
  /** @type {Record<string, number>} */
  const params = {}
  /** @type {Record<string, string>} */
  const errors = {}
  for (const [key, lim] of Object.entries(ASSUMPTION_LIMITS)) {
    const v = draft?.[key]
    if (v === null || v === undefined) continue
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      errors[key] = 'Escribe un número.'
      continue
    }
    const value = key === 'years' ? Math.round(v) : v
    if (value < lim.min || value > lim.max) {
      errors[key] = `${lim.label} de ${fmtBound(lim.min)} a ${fmtBound(lim.max)}${key === 'years' ? '' : ' %'}.`
      continue
    }
    params[key] = key === 'years' ? value : value / 100
  }
  return { params, errors }
}

/**
 * Moneda del bloque del DCF: la de los estados financieros, que el API manda en
 * `dcf.inputs.currency`. Los múltiplos y el P/VL justificado van en la moneda de cotización.
 * @param {{ currency?: string, dcf?: { inputs?: Record<string, unknown> } } | undefined} data
 */
export function dcfCurrency(data) {
  const c = data?.dcf?.inputs?.currency
  return typeof c === 'string' && c ? c : data?.currency
}
