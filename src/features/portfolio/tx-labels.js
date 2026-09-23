// Nombres en español de los tipos de movimiento del libro y qué campos pide cada uno.

/** @type {Record<string, string>} */
export const TX_LABELS = {
  buy: 'Compra',
  sell: 'Venta',
  dividend: 'Dividendo',
  deposit: 'Depósito',
  withdrawal: 'Retiro',
  split: 'Split',
  fee: 'Comisión',
}

/** @param {string} type */
export function fieldsFor(type) {
  return {
    symbol: type === 'buy' || type === 'sell' || type === 'dividend' || type === 'split',
    trade: type === 'buy' || type === 'sell',
    amount: type === 'dividend' || type === 'deposit' || type === 'withdrawal' || type === 'fee',
    ratio: type === 'split',
    currency: type !== 'split',
  }
}

/** Hoy en la Ciudad de México, AAAA-MM-DD. */
export function todayMx() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date())
}

/** Resta días a una fecha AAAA-MM-DD. @param {string} iso @param {number} days */
export function minusDays(iso, days) {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}
