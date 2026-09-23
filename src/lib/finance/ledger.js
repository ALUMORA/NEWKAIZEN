// Libro de movimientos del portafolio: posiciones por costo promedio, efectivo por moneda,
// ventas realizadas, flujos externos y validación. Módulo puro: sin React, sin fetch y sin
// Date.now(); la fecha de corte siempre entra por parámetro.
//
// Método: costo promedio de adquisición, que es el que usa la práctica mexicana para el ISR
// (LISR art. 129). Las comisiones suman al costo en las compras y restan al producto en las
// ventas. Un split multiplica la cantidad y divide el costo promedio, sin mover el costo total.
//
// COMPATIBILIDAD CON EL CONTRATO DE S2: `src/lib/portfolio/ledger.contract.test.js` compara la
// salida de `derivePositions` con `toEqual` contra objetos de exactamente cinco llaves, así que
// esta función conserva esa forma al pie de la letra. Lo que el spec pide de más (P&L realizado,
// primera compra, tipo de cambio promedio) vive en `derivePositionsDetailed`, que devuelve la
// misma posición con tres llaves extra. Está anotado en docs/requests/A4.md para que el
// orquestador decida si relaja esa prueba después del merge.

/** @typedef {import('../storage.js').Transaction} Transaction */
/** @typedef {'MXN' | 'USD'} Currency */

/**
 * Posición abierta, forma mínima del contrato de S2.
 * @typedef {{
 *   symbol: string,
 *   quantity: number,
 *   avgCost: number | null,
 *   currency: Currency,
 *   costBasis: number | null,
 * }} Position
 */

/**
 * Posición abierta con el detalle que pide el spec de finanzas.
 *   realizedPnl: utilidad realizada acumulada del lote abierto; null si alguna compra llegó sin
 *     precio y por eso el costo es desconocido. Las posiciones ya cerradas no salen aquí: su
 *     utilidad realizada está en `realizedPnlBySymbol` y en `realizedSales`.
 *   firstBuyDate: fecha de la primera compra con fecha del lote abierto; null si ninguna la trae.
 *   avgFx: tipo de cambio de las compras (pesos por unidad de la moneda del movimiento),
 *     ponderado por cantidad; null si alguna compra no lo trae. En posiciones en MXN suele ser
 *     null y no hace falta.
 * @typedef {Position & {
 *   realizedPnl: number | null,
 *   firstBuyDate: string | null,
 *   avgFx: number | null,
 * }} PositionDetail
 */

/**
 * Venta realizada, con el costo promedio vigente al momento de venderla.
 *   costDate: fecha de la primera compra del lote vendido. Con costo promedio no existe una
 *     fecha de adquisición única, así que esta es una aproximación y así la reporta tax-mx.
 * @typedef {{
 *   symbol: string,
 *   saleDate: string | null,
 *   quantity: number,
 *   proceeds: number | null,
 *   cost: number | null,
 *   costDate: string | null,
 *   gain: number | null,
 *   currency: Currency,
 * }} Sale
 */

/**
 * Flujo externo: dinero que entra o sale del portafolio.
 *   kind: 'deposit' | 'withdrawal' | 'funding' (compra que no tenía efectivo y se asume aportada).
 * @typedef {{
 *   date: string | null,
 *   currency: Currency,
 *   amount: number,
 *   kind: 'deposit' | 'withdrawal' | 'funding',
 * }} ExternalFlow
 */

/**
 * Corte del libro en una fecha.
 * @typedef {{
 *   date: string,
 *   positions: PositionDetail[],
 *   cash: Record<Currency, number>,
 *   fundedCash: Record<Currency, number>,
 *   external: ExternalFlow[],
 * }} LedgerSnapshot
 */

const EPSILON = 1e-9

/** Tipos de movimiento que entiende el libro. @type {string[]} */
export const TX_TYPES = ['buy', 'sell', 'dividend', 'deposit', 'withdrawal', 'split', 'fee']

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** @param {unknown} v */
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
/** @param {unknown} v @returns {number} */
const num = (v) => (isNum(v) ? /** @type {number} */ (v) : 0)
/** @param {unknown} v */
const isIsoDate = (v) => typeof v === 'string' && DATE_RE.test(v)

/** @param {unknown} v @returns {Currency} */
function currencyOf(v) {
  return v === 'USD' ? 'USD' : 'MXN'
}

/**
 * Movimientos en orden de aplicación: los que no traen fecha (saldos iniciales migrados) van
 * primero, luego por fecha y, a igualdad, en el orden en que llegaron.
 * @param {Transaction[] | undefined | null} transactions
 * @param {string | null} [asOf] fecha de corte AAAA-MM-DD, inclusive
 * @returns {Transaction[]}
 */
export function orderTransactions(transactions, asOf = null) {
  return (Array.isArray(transactions) ? transactions : [])
    .map((tx, index) => ({ tx, index }))
    .filter(({ tx }) => tx && (asOf == null || tx.date == null || tx.date <= asOf))
    .sort((a, b) => {
      const da = a.tx.date ?? ''
      const db = b.tx.date ?? ''
      if (da !== db) return da < db ? -1 : 1
      return a.index - b.index
    })
    .map(({ tx }) => tx)
}

/**
 * @typedef {{
 *   quantity: number, cost: number | null, currency: Currency,
 *   realized: number | null, firstBuyDate: string | null,
 *   fxQty: number, fxSum: number, fxKnown: boolean,
 * }} Lot
 */

/** @returns {Lot} */
function emptyLot(/** @type {Currency} */ currency) {
  return {
    quantity: 0,
    cost: 0,
    currency,
    realized: 0,
    firstBuyDate: null,
    fxQty: 0,
    fxSum: 0,
    fxKnown: true,
  }
}

/**
 * Motor del libro. Recorre los movimientos una sola vez y, si se le pasan fechas, deja un corte
 * en cada una. `cash` es el saldo tal cual lo implican los movimientos (puede quedar negativo si
 * la persona registró compras sin depósitos); `funded` acumula lo que se asume aportado para
 * cubrir esas compras, y `cash + funded` es el efectivo que usa la valuación.
 * @param {Transaction[] | undefined | null} transactions
 * @param {{ asOf?: string | null, dates?: string[] | null }} [options]
 */
function runLedger(transactions, { asOf = null, dates = null } = {}) {
  const ordered = orderTransactions(transactions, asOf)
  /** @type {Map<string, Lot>} */
  const book = new Map()
  /** @type {Record<Currency, number>} */
  const cash = { MXN: 0, USD: 0 }
  /** @type {Record<Currency, number>} */
  const funded = { MXN: 0, USD: 0 }
  /** @type {Sale[]} */
  const sales = []
  /** @type {ExternalFlow[]} */
  const external = []
  /** @type {Map<string, number | null>} */
  const realizedBySymbol = new Map()
  /** @type {LedgerSnapshot[]} */
  const snapshots = []

  const cutoffs = Array.isArray(dates) ? [...dates].sort() : []
  let cutoffIndex = 0
  let flowMark = 0

  /** @param {string} date */
  function snapshotAt(date) {
    snapshots.push({
      date,
      positions: positionsFrom(book, true),
      cash: { ...cash },
      fundedCash: { MXN: cash.MXN + funded.MXN, USD: cash.USD + funded.USD },
      external: external.slice(flowMark),
    })
    flowMark = external.length
  }

  for (const tx of ordered) {
    while (cutoffIndex < cutoffs.length && tx.date != null && cutoffs[cutoffIndex] < tx.date) {
      snapshotAt(cutoffs[cutoffIndex])
      cutoffIndex += 1
    }

    const type = tx.type
    const ccy = currencyOf(tx.currency)
    const fees = Math.max(0, num(tx.fees))

    if (type === 'deposit' || type === 'withdrawal' || type === 'fee' || type === 'dividend') {
      const amount = num(tx.amount)
      if (type === 'deposit') {
        cash[ccy] += amount - fees
        if (amount > 0) external.push({ date: tx.date ?? null, currency: ccy, amount, kind: 'deposit' })
      } else if (type === 'withdrawal') {
        cash[ccy] -= amount + fees
        if (amount > 0) external.push({ date: tx.date ?? null, currency: ccy, amount: -amount, kind: 'withdrawal' })
      } else if (type === 'fee') {
        cash[ccy] -= isNum(tx.amount) ? amount : fees
      } else {
        cash[ccy] += amount - fees
      }
      continue
    }

    const symbol = typeof tx.symbol === 'string' ? tx.symbol : ''
    if (!symbol) continue
    const lot = book.get(symbol) ?? emptyLot(ccy)

    if (type === 'buy') {
      const qty = num(tx.quantity)
      if (qty <= 0) continue
      if (lot.quantity <= EPSILON) {
        // Posición que vuelve a abrirse: el costo, el tipo de cambio y la primera compra parten
        // de cero. Lo realizado ya quedó guardado en realizedBySymbol y en sales.
        lot.cost = 0
        lot.currency = ccy
        lot.realized = 0
        lot.firstBuyDate = null
        lot.fxQty = 0
        lot.fxSum = 0
        lot.fxKnown = true
      }
      const price = isNum(tx.price) ? /** @type {number} */ (tx.price) : null
      const amount = price === null ? null : qty * price + fees
      const sameCurrency = ccy === lot.currency
      lot.quantity += qty
      // Sumar pesos sobre dólares daría un costo promedio inventado. Cuando la moneda no coincide
      // con la del lote, el costo pasa a desconocido y avgCost sale null, o sea "s/d".
      lot.cost = lot.cost === null || amount === null || !sameCurrency ? null : lot.cost + amount
      if (isIsoDate(tx.date) && (lot.firstBuyDate === null || tx.date < lot.firstBuyDate)) {
        lot.firstBuyDate = tx.date
      }
      if (isNum(tx.fxRate) && /** @type {number} */ (tx.fxRate) > 0) {
        lot.fxQty += qty
        lot.fxSum += qty * /** @type {number} */ (tx.fxRate)
      } else {
        lot.fxKnown = false
      }
      if (amount !== null) {
        // El faltante se mide contra el efectivo YA considerando lo que se dio por aportado antes
        // (cash + funded). Medirlo solo contra cash vuelve a financiar dinero ya financiado, porque
        // cash queda negativo después de la primera compra sin depósito.
        const short = Math.max(0, amount - (cash[ccy] + funded[ccy]))
        if (short > EPSILON) {
          funded[ccy] += short
          external.push({ date: tx.date ?? null, currency: ccy, amount: short, kind: 'funding' })
        }
        cash[ccy] -= amount
      }
      book.set(symbol, lot)
      continue
    }

    if (type === 'sell') {
      const qty = Math.min(num(tx.quantity), lot.quantity)
      if (qty <= 0) continue
      const avg = lot.cost === null ? null : lot.cost / lot.quantity
      const price = isNum(tx.price) ? /** @type {number} */ (tx.price) : null
      const proceeds = price === null ? null : qty * price - fees
      const cost = avg === null ? null : avg * qty
      const gain = proceeds === null || cost === null ? null : proceeds - cost
      sales.push({
        symbol,
        saleDate: tx.date ?? null,
        quantity: qty,
        proceeds,
        cost,
        costDate: lot.firstBuyDate,
        gain,
        currency: lot.currency,
      })
      const before = realizedBySymbol.has(symbol) ? realizedBySymbol.get(symbol) ?? null : 0
      realizedBySymbol.set(symbol, before === null || gain === null ? null : before + gain)
      lot.realized = lot.realized === null || gain === null ? null : lot.realized + gain
      lot.quantity -= qty
      if (lot.quantity <= EPSILON) {
        lot.quantity = 0
        lot.cost = 0
      } else if (avg !== null && lot.cost !== null) {
        lot.cost -= avg * qty
      }
      // El dinero entra en la moneda del movimiento, no en la del lote: abonarlo a lot.currency
      // convertiría 1,800 pesos en 1,800 dólares sin avisar. validateTransaction rechaza la mezcla
      // antes de guardar; aquí solo se respeta lo que de verdad se capturó.
      if (proceeds !== null) cash[ccy] += proceeds
      book.set(symbol, lot)
      continue
    }

    if (type === 'split') {
      const ratio = num(tx.ratio)
      if (!(ratio > 0)) continue
      lot.quantity *= ratio
      if (fees > 0) cash[lot.currency] -= fees
      book.set(symbol, lot)
      continue
    }
  }

  while (cutoffIndex < cutoffs.length) {
    snapshotAt(cutoffs[cutoffIndex])
    cutoffIndex += 1
  }

  return { book, cash, funded, sales, external, realizedBySymbol, snapshots }
}

/**
 * @param {Map<string, Lot>} book
 * @param {boolean} detailed
 * @returns {PositionDetail[]}
 */
function positionsFrom(book, detailed) {
  const out = []
  for (const [symbol, lot] of book.entries()) {
    if (lot.quantity <= EPSILON) continue
    /** @type {any} */
    const position = {
      symbol,
      quantity: lot.quantity,
      avgCost: lot.cost === null ? null : lot.cost / lot.quantity,
      currency: lot.currency,
      costBasis: lot.cost,
    }
    if (detailed) {
      position.realizedPnl = lot.realized
      position.firstBuyDate = lot.firstBuyDate
      position.avgFx = lot.fxKnown && lot.fxQty > 0 ? lot.fxSum / lot.fxQty : null
    }
    out.push(position)
  }
  return out.sort((a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0))
}

/**
 * Posiciones abiertas por símbolo con el método de costo promedio.
 * Forma del contrato de S2 (cinco llaves). Para el P&L realizado, la primera compra y el tipo de
 * cambio promedio usa `derivePositionsDetailed`.
 * Mínimo: con cero movimientos devuelve un arreglo vacío, nunca null.
 * @param {Transaction[] | undefined | null} transactions
 * @param {{ asOf?: string | null }} [options] fecha de corte AAAA-MM-DD (inclusive)
 * @returns {Position[]}
 */
export function derivePositions(transactions, { asOf = null } = {}) {
  const { book } = runLedger(transactions, { asOf })
  return positionsFrom(book, false)
}

/**
 * Igual que `derivePositions`, más `realizedPnl`, `firstBuyDate` y `avgFx`.
 * @param {Transaction[] | undefined | null} transactions
 * @param {{ asOf?: string | null }} [options]
 * @returns {PositionDetail[]}
 */
export function derivePositionsDetailed(transactions, { asOf = null } = {}) {
  const { book } = runLedger(transactions, { asOf })
  return positionsFrom(book, true)
}

/**
 * Saldo de efectivo por moneda tal como lo implican los movimientos. Puede quedar negativo si se
 * registraron compras sin depósitos; `valueSeries` trata ese faltante como aportación externa.
 * @param {Transaction[] | undefined | null} transactions
 * @param {{ asOf?: string | null }} [options]
 * @returns {Record<Currency, number>}
 */
export function cashBalances(transactions, { asOf = null } = {}) {
  const { cash } = runLedger(transactions, { asOf })
  return cash
}

/**
 * Ventas realizadas, en orden cronológico, con el costo promedio vigente al venderlas.
 * @param {Transaction[] | undefined | null} transactions
 * @param {{ asOf?: string | null }} [options]
 * @returns {Sale[]}
 */
export function realizedSales(transactions, { asOf = null } = {}) {
  const { sales } = runLedger(transactions, { asOf })
  return sales
}

/**
 * Utilidad realizada acumulada por símbolo, incluidas las posiciones ya cerradas.
 * El valor es null cuando alguna compra llegó sin precio y el costo quedó desconocido.
 * @param {Transaction[] | undefined | null} transactions
 * @param {{ asOf?: string | null }} [options]
 * @returns {Record<string, number | null>}
 */
export function realizedPnlBySymbol(transactions, { asOf = null } = {}) {
  const { realizedBySymbol } = runLedger(transactions, { asOf })
  /** @type {Record<string, number | null>} */
  const out = {}
  for (const symbol of [...realizedBySymbol.keys()].sort()) out[symbol] = realizedBySymbol.get(symbol) ?? null
  return out
}

/**
 * Flujos externos: depósitos (positivos), retiros (negativos) y el faltante de efectivo de las
 * compras que nadie financió con un depósito previo, que se asume aportado.
 * @param {Transaction[] | undefined | null} transactions
 * @param {{ asOf?: string | null }} [options]
 * @returns {ExternalFlow[]}
 */
export function externalFlows(transactions, { asOf = null } = {}) {
  const { external } = runLedger(transactions, { asOf })
  return external
}

/**
 * Cortes del libro en varias fechas, en una sola pasada. Es la costura que usa
 * `performance-ledger.js` para armar la serie de valor.
 * Cada corte trae las posiciones a esa fecha, el efectivo crudo, el efectivo ya considerando las
 * aportaciones implícitas y los flujos externos ocurridos desde el corte anterior (para el primer
 * corte, todos los anteriores o iguales a esa fecha).
 * @param {Transaction[] | undefined | null} transactions
 * @param {string[]} dates fechas AAAA-MM-DD
 * @returns {LedgerSnapshot[]}
 */
export function ledgerSnapshots(transactions, dates) {
  if (!Array.isArray(dates) || dates.length === 0) return []
  const { snapshots } = runLedger(transactions, { dates })
  return snapshots
}

/**
 * Revisa un movimiento antes de guardarlo. Si se le pasan los movimientos que ya existen, además
 * comprueba que no se venda ni se parta más de lo que hay a esa fecha.
 * @param {Partial<Transaction> | null | undefined} tx
 * @param {Transaction[]} [existing] movimientos ya registrados (sin incluir `tx`)
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateTransaction(tx, existing = []) {
  /** @type {string[]} */
  const errors = []
  if (!tx || typeof tx !== 'object') return { ok: false, errors: ['El movimiento viene vacío.'] }

  const type = tx.type
  if (!type) errors.push('El movimiento no trae tipo.')
  else if (!TX_TYPES.includes(type)) errors.push(`Tipo de movimiento desconocido: "${type}".`)

  if (tx.date != null && !isIsoDate(tx.date)) errors.push('La fecha tiene que ir como AAAA-MM-DD.')
  if (tx.currency != null && tx.currency !== 'MXN' && tx.currency !== 'USD') {
    errors.push('La moneda tiene que ser MXN o USD.')
  }
  if (tx.fees != null && !isNum(tx.fees)) errors.push('Las comisiones tienen que ser un número.')
  else if (num(tx.fees) < 0) errors.push('Las comisiones no pueden ser negativas.')
  if (tx.fxRate != null && !(isNum(tx.fxRate) && /** @type {number} */ (tx.fxRate) > 0)) {
    errors.push('El tipo de cambio tiene que ser un número mayor que cero.')
  }

  const needsSymbol = type === 'buy' || type === 'sell' || type === 'split' || type === 'dividend'
  if (needsSymbol && !tx.symbol) errors.push('Falta el símbolo.')

  if (type === 'buy' || type === 'sell') {
    if (!(isNum(tx.quantity) && /** @type {number} */ (tx.quantity) > 0)) {
      errors.push('La cantidad tiene que ser un número mayor que cero.')
    }
    if (tx.price != null && !(isNum(tx.price) && /** @type {number} */ (tx.price) >= 0)) {
      errors.push('El precio tiene que ser un número mayor o igual que cero.')
    }
    if (type === 'buy' && tx.price == null) {
      errors.push('Falta el precio de la compra: sin él no se puede calcular el costo.')
    }
  }

  if (type === 'split' && !(isNum(tx.ratio) && /** @type {number} */ (tx.ratio) > 0)) {
    errors.push('El factor del split tiene que ser un número mayor que cero (2 = dos por una).')
  }

  if (type === 'dividend' || type === 'deposit' || type === 'withdrawal' || type === 'fee') {
    if (!(isNum(tx.amount) && /** @type {number} */ (tx.amount) > 0)) {
      errors.push('El monto tiene que ser un número mayor que cero.')
    }
  }

  if (type === 'buy' || type === 'sell' || type === 'split') {
    const symbol = typeof tx.symbol === 'string' ? tx.symbol : ''
    if (symbol) {
      const held = derivePositions(existing, { asOf: tx.date ?? null }).find((p) => p.symbol === symbol)
      const quantity = held?.quantity ?? 0
      if (type === 'sell' && isNum(tx.quantity) && /** @type {number} */ (tx.quantity) > quantity + EPSILON) {
        errors.push(`No puedes vender ${tx.quantity} de ${symbol}: a esa fecha tienes ${quantity}.`)
      }
      if (type === 'split' && quantity <= EPSILON) {
        errors.push(`No tienes ${symbol} a esa fecha, así que el split no aplica.`)
      }
      // Nunca se mezclan monedas dentro de un mismo símbolo. El selector de moneda va por
      // movimiento, así que equivocarse es un clic, y el saldo queda irrecuperable si pasa.
      if (held && (tx.currency === 'MXN' || tx.currency === 'USD') && tx.currency !== held.currency) {
        errors.push(
          `Ya tienes ${symbol} en ${held.currency}, así que este movimiento también va en ${held.currency}. Si es de otra bolsa, captúralo con el símbolo de esa bolsa.`,
        )
      }
    }
  }

  return { ok: errors.length === 0, errors }
}

/**
 * Descomposición de la utilidad de una posición en efecto precio y efecto tipo de cambio, en la
 * moneda base (pesos si el tipo de cambio va en pesos por dólar).
 *   efecto precio = q (P1 − P0) X0
 *   efecto tipo de cambio = q P1 (X1 − X0)
 * El cruce queda dentro del efecto tipo de cambio porque se valúa al precio final, así que
 * `cross` siempre es 0 y la suma cuadra exacto con el total.
 * Devuelve null si falta cualquiera de los cinco datos o si alguno no es un número finito.
 * @param {{ quantity: number, price0: number | null, price1: number | null, fx0: number | null, fx1: number | null }} input
 * @returns {{ total: number, priceEffect: number, fxEffect: number, cross: number } | null}
 */
export function positionPnl({ quantity, price0, price1, fx0, fx1 }) {
  if (![quantity, price0, price1, fx0, fx1].every(isNum)) return null
  const q = /** @type {number} */ (quantity)
  const p0 = /** @type {number} */ (price0)
  const p1 = /** @type {number} */ (price1)
  const x0 = /** @type {number} */ (fx0)
  const x1 = /** @type {number} */ (fx1)
  const priceEffect = q * (p1 - p0) * x0
  const fxEffect = q * p1 * (x1 - x0)
  return { total: q * (p1 * x1 - p0 * x0), priceEffect, fxEffect, cross: 0 }
}
