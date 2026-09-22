// Cambios puros sobre el estado v2 (src/lib/storage.js): reciben un estado y devuelven otro, sin
// tocar el storage. usePortfolios.js los envuelve con update(). Todos lanzan PortfolioError con
// un mensaje en español cuando la entrada no es válida.
import { newId, validateTransaction } from '../storage.js'

/** @typedef {import('../storage.js').KaizenState} KaizenState */
/** @typedef {import('../storage.js').Portfolio} Portfolio */
/** @typedef {import('../storage.js').Transaction} Transaction */

export class PortfolioError extends Error {
  constructor(message) {
    super(message)
    this.name = 'PortfolioError'
  }
}

function cleanName(name) {
  const n = typeof name === 'string' ? name.trim() : ''
  if (!n) throw new PortfolioError('El portafolio necesita un nombre.')
  return n.slice(0, 80)
}

function mapPortfolio(state, id, fn) {
  let found = false
  const portfolios = state.portfolios.map((p) => {
    if (p.id !== id) return p
    found = true
    return fn(p)
  })
  if (!found) throw new PortfolioError('No encontramos ese portafolio.')
  return { ...state, portfolios }
}

/**
 * @param {KaizenState} state
 * @param {{ name: string, id?: string, transactions?: Transaction[], notes?: string }} input
 * @returns {{ state: KaizenState, portfolio: Portfolio }}
 */
export function createPortfolio(state, { name, id, transactions = [], notes = '' }) {
  /** @type {Portfolio} */
  const portfolio = {
    id: id ?? newId('pf'),
    name: cleanName(name),
    baseCurrency: 'MXN',
    createdAt: new Date().toISOString(),
    transactions: transactions.map((t) => {
      const res = validateTransaction(t)
      if (!res.tx) throw new PortfolioError(`Movimiento inválido: ${res.reason}.`)
      return res.tx
    }),
    targets: {},
    notes,
  }
  if (state.portfolios.some((p) => p.id === portfolio.id)) throw new PortfolioError('Ya existe un portafolio con ese id.')
  return {
    state: { ...state, portfolios: [...state.portfolios, portfolio], activePortfolioId: state.activePortfolioId ?? portfolio.id },
    portfolio,
  }
}

/** @param {KaizenState} state @param {string} id @param {string} name */
export function renamePortfolio(state, id, name) {
  const clean = cleanName(name)
  return mapPortfolio(state, id, (p) => ({ ...p, name: clean }))
}

/** @param {KaizenState} state @param {string} id */
export function deletePortfolio(state, id) {
  if (!state.portfolios.some((p) => p.id === id)) throw new PortfolioError('No encontramos ese portafolio.')
  const portfolios = state.portfolios.filter((p) => p.id !== id)
  const activePortfolioId = state.activePortfolioId === id ? (portfolios[0]?.id ?? null) : state.activePortfolioId
  return { ...state, portfolios, activePortfolioId }
}

/** @param {KaizenState} state @param {string} id */
export function setActivePortfolio(state, id) {
  if (!state.portfolios.some((p) => p.id === id)) throw new PortfolioError('No encontramos ese portafolio.')
  return { ...state, activePortfolioId: id }
}

/**
 * @param {KaizenState} state
 * @param {string} portfolioId
 * @param {Partial<Transaction>} tx
 * @returns {{ state: KaizenState, transaction: Transaction }}
 */
export function addTransaction(state, portfolioId, tx) {
  const res = validateTransaction({ ...tx, id: tx.id ?? newId('tx') })
  if (!res.tx) throw new PortfolioError(`Movimiento inválido: ${res.reason}.`)
  const transaction = res.tx
  return {
    state: mapPortfolio(state, portfolioId, (p) => ({ ...p, transactions: [...p.transactions, transaction] })),
    transaction,
  }
}

/**
 * @param {KaizenState} state
 * @param {string} portfolioId
 * @param {string} txId
 * @param {Partial<Transaction>} patch
 */
export function updateTransaction(state, portfolioId, txId, patch) {
  return mapPortfolio(state, portfolioId, (p) => {
    const current = p.transactions.find((t) => t.id === txId)
    if (!current) throw new PortfolioError('No encontramos ese movimiento.')
    const res = validateTransaction({ ...current, ...patch, id: txId })
    if (!res.tx) throw new PortfolioError(`Movimiento inválido: ${res.reason}.`)
    return { ...p, transactions: p.transactions.map((t) => (t.id === txId ? res.tx : t)) }
  })
}

/** @param {KaizenState} state @param {string} portfolioId @param {string} txId */
export function removeTransaction(state, portfolioId, txId) {
  return mapPortfolio(state, portfolioId, (p) => {
    if (!p.transactions.some((t) => t.id === txId)) throw new PortfolioError('No encontramos ese movimiento.')
    return { ...p, transactions: p.transactions.filter((t) => t.id !== txId) }
  })
}

/**
 * Pesos objetivo como fracciones que suman a lo más 1 (tolerancia de redondeo 1e-6).
 * @param {KaizenState} state
 * @param {string} portfolioId
 * @param {Record<string, number>} targets
 */
export function setTargets(state, portfolioId, targets) {
  const clean = {}
  let total = 0
  for (const [symbol, w] of Object.entries(targets ?? {})) {
    if (typeof w !== 'number' || !Number.isFinite(w) || w < 0 || w > 1) throw new PortfolioError(`Peso inválido para ${symbol}.`)
    if (w === 0) continue
    clean[symbol.trim().toUpperCase()] = w
    total += w
  }
  if (total > 1 + 1e-6) throw new PortfolioError('Los pesos objetivo suman más de 100%.')
  return mapPortfolio(state, portfolioId, (p) => ({ ...p, targets: clean }))
}
