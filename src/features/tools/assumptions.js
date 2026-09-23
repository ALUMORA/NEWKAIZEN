// Supuestos editables del optimizador y su validación. Los campos van en porcentaje, como los
// escribe la persona; el cálculo los recibe como fracción.
import { DEFAULT_ERP } from './optimizer.js'

export const DEFAULT_ASSUMPTIONS = Object.freeze({
  muMethod: /** @type {'capm' | 'jamesStein' | 'historical'} */ ('capm'),
  covMethod: /** @type {'ledoitWolf' | 'sample'} */ ('ledoitWolf'),
  erpPct: /** @type {number | null} */ (Math.round(DEFAULT_ERP * 10000) / 100),
  /** Solo cuenta si `rfTouched`; si no, manda la de CETES 28 del API. */
  rfPct: /** @type {number | null} */ (null),
  rfTouched: false,
  minPct: /** @type {number | null} */ (0),
  maxPct: /** @type {number | null} */ (100),
})

/** @typedef {typeof DEFAULT_ASSUMPTIONS} Assumptions */

/**
 * Tasa libre de riesgo en porcentaje: la escrita si la persona tocó el campo, si no la del API.
 * @param {Assumptions} a
 * @param {number | null} apiRfPct
 */
export function riskFreePct(a, apiRfPct) {
  return a.rfTouched ? a.rfPct : apiRfPct
}

/** @param {number} x */
const fmt = (x) => (Math.round(x * 100) / 100).toLocaleString('es-MX')

/**
 * Errores por campo, en español. Un objeto vacío quiere decir que todo sirve.
 * @param {Assumptions} a
 * @param {number} n cuántas emisoras entran a la optimización
 * @param {number | null} apiRfPct la tasa del API en porcentaje, o null si no llegó
 * @returns {Partial<Record<'erpPct' | 'rfPct' | 'minPct' | 'maxPct', string>>}
 */
export function validateAssumptions(a, n, apiRfPct) {
  /** @type {Partial<Record<'erpPct' | 'rfPct' | 'minPct' | 'maxPct', string>>} */
  const errors = {}
  if (a.muMethod === 'capm' && (a.erpPct === null || a.erpPct < 0 || a.erpPct > 20)) {
    errors.erpPct = 'Escribe una prima entre 0 % y 20 %.'
  }
  const rf = riskFreePct(a, apiRfPct)
  if (rf === null) errors.rfPct = a.rfTouched ? 'Escribe una tasa entre 0 % y 50 %.' : 'No llegó la tasa de CETES. Escribe una para seguir.'
  else if (rf < 0 || rf > 50) errors.rfPct = 'Escribe una tasa entre 0 % y 50 %.'
  if (a.minPct === null || a.minPct < 0 || a.minPct > 100) errors.minPct = 'Escribe un mínimo entre 0 % y 100 %.'
  if (a.maxPct === null || a.maxPct <= 0 || a.maxPct > 100) errors.maxPct = 'Escribe un máximo mayor que 0 % y hasta 100 %.'
  if (errors.minPct || errors.maxPct) return errors
  const min = /** @type {number} */ (a.minPct)
  const max = /** @type {number} */ (a.maxPct)
  if (min > max) errors.minPct = 'El mínimo no puede pasar del máximo.'
  else if (n > 0 && min * n > 100 + 1e-9) errors.minPct = `Con ${n} emisoras el mínimo puede ser hasta ${fmt(100 / n)} %, para que los pesos sumen 100 %.`
  else if (n > 0 && max * n < 100 - 1e-9) errors.maxPct = `Con ${n} emisoras el máximo tiene que ser de al menos ${fmt(100 / n)} %, para que los pesos sumen 100 %.`
  return errors
}
