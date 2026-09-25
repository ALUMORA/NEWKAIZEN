// Estimación del ISR por ganancias en bolsa para personas físicas en México (LISR art. 129) y el
// dato informativo de la retención sobre dividendos. Módulo puro: sin React, sin fetch y sin
// Date.now().
//
// TODO LO QUE SALE DE AQUÍ ES UNA ESTIMACIÓN, no un cálculo fiscal ni una recomendación. El
// impuesto que de verdad se paga depende de la constancia del intermediario, de las pérdidas de
// ejercicios anteriores y de la declaración anual completa.
//
// Cómo se calcula:
// - Tasa del 10 % sobre la ganancia neta anual por enajenación de acciones en bolsas concesionadas
//   (BMV) o en el SIC, a través de un intermediario.
// - El costo promedio de adquisición se actualiza por INPC desde el mes de la compra hasta el mes
//   inmediato anterior al de la venta. Si falta alguno de los dos índices, el costo va sin
//   actualizar y queda anotado: la ganancia sale sobrestimada, nunca al revés.
// - Las pérdidas del mismo tipo restan a las ganancias del mismo ejercicio, y lo que sobra se
//   arrastra a ejercicios siguientes (la ley permite hasta diez).

/** Tasa del ISR sobre la ganancia anual por enajenación de acciones en bolsa. */
export const ISR_GAINS_RATE = 0.1
/** Retención sobre dividendos de emisoras mexicanas (LISR art. 140). */
export const DIVIDEND_WITHHOLDING_RATE = 0.1
/** Ejercicios en los que se puede amortizar la pérdida pendiente. */
export const LOSS_CARRY_YEARS = 10
/**
 * Tasa anual de retención provisional de ISR sobre el capital que genera intereses (LISR arts. 54
 * y 135). La fija cada año la Ley de Ingresos de la Federación: 0.90 % para 2026 (0.50 % en 2025).
 * Se expresa como fracción: 0.009 es 0.90 %.
 */
export const INTEREST_WITHHOLDING_RATE = 0.009
/** De dónde sale la tasa anterior, para mostrarlo junto al cálculo. */
export const INTEREST_WITHHOLDING_SOURCE =
  'Ley de Ingresos de la Federación 2026, art. 24: tasa anual de retención de 0.90 % sobre el capital (LISR arts. 54 y 135)'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const NO_YEAR = 'sin fecha'

/**
 * Venta que entra al cálculo. `factor` es opcional y, si viene, manda sobre el INPC (sirve para
 * capturar el factor de actualización tal como lo reporta la constancia del intermediario).
 * @typedef {{
 *   symbol?: string,
 *   proceeds: number,
 *   cost: number,
 *   costDate?: string | null,
 *   saleDate?: string | null,
 *   factor?: number | null,
 * }} TaxSale
 */

/**
 * @typedef {{
 *   year: string, gain: number, taxableGain: number, tax: number,
 *   lossUsed: number, lossCarry: number,
 * }} TaxYear
 */

/**
 * @typedef {{
 *   gain: number, taxableGain: number, tax: number, lossCarry: number,
 *   rate: number, years: TaxYear[],
 *   detail: { symbol: string | null, year: string, proceeds: number, cost: number,
 *             factor: number, indexedCost: number, gain: number, indexed: boolean }[],
 *   dropped: { index: number, reason: string }[],
 *   notes: string[],
 * }} IsrEstimate
 */

/** @param {unknown} v */
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
/** @param {unknown} v */
const isIsoDate = (v) => typeof v === 'string' && DATE_RE.test(v)

/**
 * Mes anterior a uno dado, en formato AAAA-MM.
 * @param {string} month AAAA-MM
 * @returns {string}
 */
function previousMonth(month) {
  const year = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  return m === 1 ? `${year - 1}-12` : `${year}-${String(m - 1).padStart(2, '0')}`
}

/**
 * Factor de actualización del costo: INPC del mes anterior a la venta entre INPC del mes de la
 * compra. Si falta cualquiera de los dos índices, o alguna de las dos fechas, devuelve factor 1 y
 * explica por qué.
 * @param {{ costDate?: string | null, saleDate?: string | null, inpc?: Record<string, number> }} input
 * @returns {{ factor: number, applied: boolean, from: string | null, to: string | null, reason: string | null }}
 */
export function inpcFactor({ costDate, saleDate, inpc = {} }) {
  if (!isIsoDate(costDate) || !isIsoDate(saleDate)) {
    return { factor: 1, applied: false, from: null, to: null, reason: 'Falta la fecha de compra o la de venta.' }
  }
  const from = /** @type {string} */ (costDate).slice(0, 7)
  const to = previousMonth(/** @type {string} */ (saleDate).slice(0, 7))
  const a = inpc[from]
  const b = inpc[to]
  if (!isNum(a) || !isNum(b) || a <= 0) {
    return { factor: 1, applied: false, from, to, reason: `Falta el INPC de ${!isNum(a) ? from : to}.` }
  }
  if (to < from) {
    return { factor: 1, applied: false, from, to, reason: 'La venta es del mismo mes de la compra o anterior.' }
  }
  return { factor: b / a, applied: true, from, to, reason: null }
}

/**
 * Estimación del ISR anual por ganancias en bolsa (LISR art. 129).
 *
 * Mínimo: `sales` tiene que ser un arreglo. Devuelve null si no lo es. Con el arreglo vacío
 * devuelve ceros, que es la respuesta correcta, no un dato faltante. Cada venta con montos que no
 * son números finitos se descarta y se reporta en `dropped`, sin tumbar el resto.
 *
 * @param {{
 *   sales: TaxSale[],
 *   inpc?: Record<string, number>,
 *   rate?: number,
 *   lossCarryIn?: number,
 * }} input
 * @returns {IsrEstimate | null}
 */
export function isrOnGains({ sales, inpc = {}, rate = ISR_GAINS_RATE, lossCarryIn = 0 }) {
  if (!Array.isArray(sales)) return null
  // Fracción entre 0 y 1: una tasa en porcentaje (10 en vez de .1) multiplicaría el impuesto por 100.
  const taxRate = isNum(rate) && rate >= 0 && rate <= 1 ? rate : ISR_GAINS_RATE

  /** @type {IsrEstimate['detail']} */
  const detail = []
  /** @type {IsrEstimate['dropped']} */
  const dropped = []
  /** @type {Map<string, number>} */
  const byYear = new Map()
  let withoutIndex = 0
  let withoutDate = 0

  sales.forEach((sale, index) => {
    if (!sale || !isNum(sale.proceeds) || !isNum(sale.cost)) {
      dropped.push({ index, reason: 'El producto de la venta o el costo no es un número.' })
      return
    }
    const year = isIsoDate(sale.saleDate) ? /** @type {string} */ (sale.saleDate).slice(0, 4) : NO_YEAR
    if (year === NO_YEAR) withoutDate += 1
    const override = isNum(sale.factor) && /** @type {number} */ (sale.factor) > 0
    const computed = inpcFactor({ costDate: sale.costDate, saleDate: sale.saleDate, inpc })
    const factor = override ? /** @type {number} */ (sale.factor) : computed.factor
    const indexed = override || computed.applied
    if (!indexed) withoutIndex += 1
    const indexedCost = sale.cost * factor
    const gain = sale.proceeds - indexedCost
    detail.push({
      symbol: sale.symbol ?? null,
      year,
      proceeds: sale.proceeds,
      cost: sale.cost,
      factor,
      indexedCost,
      gain,
      indexed,
    })
    byYear.set(year, (byYear.get(year) ?? 0) + gain)
  })

  const keys = [...byYear.keys()].sort((a, b) => {
    if (a === NO_YEAR) return 1
    if (b === NO_YEAR) return -1
    return a < b ? -1 : 1
  })

  /** @type {TaxYear[]} */
  const years = []
  // El arrastre se guarda por ejercicio de origen, porque caduca a los LOSS_CARRY_YEARS
  // ejercicios. Guardarlo como un solo número hacía que una pérdida de 2010 siguiera restándole a
  // una ganancia de 2026. Lo que entra por `lossCarryIn` no trae ejercicio de origen, así que se
  // toma como vigente: quien lo pase ya decidió que todavía sirve.
  /** @type {{ year: string, amount: number }[]} */
  const carryLots = []
  if (isNum(lossCarryIn) && /** @type {number} */ (lossCarryIn) > 0) {
    carryLots.push({ year: NO_YEAR, amount: /** @type {number} */ (lossCarryIn) })
  }
  let expired = 0
  let totalGain = 0
  let totalTaxable = 0
  let totalTax = 0
  for (const year of keys) {
    if (year !== NO_YEAR) {
      for (const lot of carryLots) {
        if (lot.year === NO_YEAR || lot.amount <= 0) continue
        if (Number(year) - Number(lot.year) > LOSS_CARRY_YEARS) {
          expired += lot.amount
          lot.amount = 0
        }
      }
    }
    const gain = byYear.get(year) ?? 0
    let lossUsed = 0
    let taxableGain = 0
    if (gain > 0) {
      let pending = gain
      for (const lot of carryLots) {
        if (pending <= 0) break
        const use = Math.min(lot.amount, pending)
        if (use <= 0) continue
        lot.amount -= use
        pending -= use
        lossUsed += use
      }
      taxableGain = gain - lossUsed
    } else if (gain < 0) {
      carryLots.push({ year, amount: -gain })
    }
    const carry = carryLots.reduce((acc, lot) => acc + lot.amount, 0)
    const tax = taxableGain * taxRate
    years.push({ year, gain, taxableGain, tax, lossUsed, lossCarry: carry })
    totalGain += gain
    totalTaxable += taxableGain
    totalTax += tax
  }
  const carry = carryLots.reduce((acc, lot) => acc + lot.amount, 0)

  /** @type {string[]} */
  const notes = [
    'Es una estimación, no un cálculo fiscal ni una recomendación. Confírmala con tu contador y con la constancia de tu casa de bolsa.',
    `Base: LISR art. 129, ${(taxRate * 100).toFixed(0)} % sobre la ganancia neta del ejercicio por acciones en BMV o en el SIC.`,
    'El costo se actualiza con el INPC del mes anterior a la venta entre el INPC del mes de la compra.',
  ]
  if (withoutIndex > 0) {
    notes.push(
      `En ${withoutIndex} de ${detail.length} ventas no se actualizó el costo por falta de INPC o de fechas, así que la ganancia estimada queda por arriba de la real.`,
    )
  }
  if (withoutDate > 0) {
    notes.push(`${withoutDate} ventas no traen fecha, así que quedaron en un grupo aparte y no se les asignó ejercicio.`)
  }
  if (dropped.length > 0) {
    notes.push(`Se descartaron ${dropped.length} ventas con datos incompletos.`)
  }
  if (expired > 0) {
    notes.push(
      `Caducaron ${expired.toFixed(2)} de pérdidas que ya pasaron los ${LOSS_CARRY_YEARS} ejercicios, así que dejaron de restar.`,
    )
  }
  if (carry > 0) {
    notes.push(
      `Queda una pérdida pendiente de amortizar; la ley permite aplicarla contra ganancias del mismo tipo hasta por ${LOSS_CARRY_YEARS} ejercicios, y aquí ya se aplica esa caducidad.`,
    )
  }
  notes.push('El costo promedio usa la fecha de la primera compra del lote, que es una aproximación cuando hubo varias compras.')

  return {
    gain: totalGain,
    taxableGain: totalTaxable,
    tax: totalTax,
    lossCarry: carry,
    rate: taxRate,
    years,
    detail,
    dropped,
    notes,
  }
}

/**
 * Retención informativa sobre dividendos de emisoras mexicanas: 10 % adicional (LISR art. 140).
 * No calcula nada más que el monto retenido y el neto.
 * Mínimo: un monto que sea número finito. Devuelve null si no.
 * @param {number} amount dividendo bruto
 * @param {{ rate?: number }} [options]
 * @returns {{ amount: number, rate: number, withholding: number, net: number, notes: string[] } | null}
 */
export function dividendWithholding(amount, { rate = DIVIDEND_WITHHOLDING_RATE } = {}) {
  if (!isNum(amount)) return null
  const applied = isNum(rate) && rate >= 0 && rate <= 1 ? rate : DIVIDEND_WITHHOLDING_RATE
  const withholding = amount * applied
  return {
    amount,
    rate: applied,
    withholding,
    net: amount - withholding,
    notes: [
      'Es una estimación informativa, no un cálculo fiscal.',
      `Dato: ${(applied * 100).toFixed(0)} % de retención sobre dividendos de emisoras mexicanas (LISR art. 140). Los dividendos del extranjero siguen otras reglas.`,
    ],
  }
}

/**
 * Retención provisional de ISR sobre intereses: capital × tasa anual × días ÷ 365. La retención se
 * calcula sobre el capital invertido, no sobre el interés ganado, y es un pago a cuenta del impuesto
 * anual, no el impuesto definitivo.
 * Mínimo: capital y días como números finitos no negativos. Devuelve null si no. Una tasa que no
 * sea número finito no negativo se sustituye por la de la ley vigente.
 * @param {number} capital monto invertido que genera los intereses
 * @param {number} days días que el capital estuvo invertido
 * @param {{ rate?: number }} [options] tasa anual como fracción (0.009 es 0.90 %)
 * @returns {number | null}
 */
export function interestWithholding(capital, days, { rate = INTEREST_WITHHOLDING_RATE } = {}) {
  if (!isNum(capital) || !isNum(days) || capital < 0 || days < 0) return null
  const applied = isNum(rate) && rate >= 0 && rate <= 1 ? rate : INTEREST_WITHHOLDING_RATE
  return (capital * applied * days) / 365
}
