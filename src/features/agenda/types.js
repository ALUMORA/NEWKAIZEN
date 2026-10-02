// Tipos de la agenda (V5PF): lo que mandan /v2/events (con dividendSummary) y /v2/events/season,
// y lo que arma src/features/agenda/lib/projection.js. Solo JSDoc: no exporta código.

/** @typedef {import('../../lib/api/types.js').Meta} Meta */

/**
 * Evento de /v2/events. `amount` sigue null por contrato: el monto futuro no se conoce.
 * @typedef {{
 *   symbol: string,
 *   type: 'earnings' | 'exDividend' | 'dividendPay',
 *   date: string,
 *   estimate: number | null,
 *   amount: null,
 *   currency: string | null,
 *   estimateLow?: number | null,
 *   estimateHigh?: number | null,
 * }} AgendaEvent
 */

/**
 * Resumen de dividendos por emisora (capacidad 'events.dividends').
 * @typedef {{
 *   symbol: string,
 *   currency: string | null,
 *   lastPaidAmount: number | null,
 *   lastPaidDate: string | null,
 *   frequency: 'mensual' | 'trimestral' | 'semestral' | 'anual' | 'irregular' | null,
 *   paidMonths: number[],
 * }} DividendSummary
 */

/**
 * @typedef {{ items: AgendaEvent[], dividendSummary?: DividendSummary[] | null, meta: Meta }} AgendaEventsResponse
 */

/**
 * Reporte de la temporada (/v2/events/season).
 * @typedef {{
 *   symbol: string, name: string | null, date: string, kind: 'earnings',
 *   estimateAvg: number | null, estimateLow: number | null, estimateHigh: number | null, currency: string | null,
 * }} SeasonEvent
 * @typedef {{
 *   universe: 'mx' | 'us', events: SeasonEvent[], missing: { symbol: string, reason: string }[],
 *   universeSize: number, meta: Meta,
 * }} SeasonResponse
 */

/** De dónde sale un símbolo de la agenda. @typedef {'portafolio' | 'lista' | 'ambos'} AgendaOrigin */

/**
 * Fila de la proyección de dividendos de una posición.
 *   perPayment: último dividendo pagado en su moneda, por título.
 *   perPaymentMxn: lo mismo en pesos (null si es en dólares y no hay tipo de cambio).
 *   missing: true si no hay dividendo conocido (la proyección es 0 y se muestra s/d).
 * @typedef {{
 *   symbol: string, quantity: number, currency: string | null, perPayment: number | null,
 *   perPaymentMxn: number | null, paidMonths: number[], frequency: string | null,
 *   annualGross: number, annualNet: number, missing: boolean, fxMissing: boolean,
 * }} ProjectionRow
 */

/**
 * @typedef {{ key: string, label: string, month: number, gross: number, net: number }} ProjectionMonth
 * @typedef {{
 *   months: ProjectionMonth[], rows: ProjectionRow[], totalGross: number, totalNet: number,
 *   fxMissing: boolean, rate: number,
 * }} Projection
 */

export {}
