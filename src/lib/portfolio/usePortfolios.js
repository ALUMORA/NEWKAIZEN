// Hook de portafolios sobre el store local (src/lib/storage.js).
//
//   const { portfolios, active, positions, actions } = usePortfolios()
//   actions.create({ name: 'Retiro' })
//   actions.addTransaction(active.id, { type: 'buy', symbol: 'NAFTRAC.MX', quantity: 10, price: 58.2, currency: 'MXN', date: '2026-09-22' })
//
// `positions` sale de derivePositions (src/lib/finance/ledger.js) sobre el portafolio activo.
// Las acciones lanzan PortfolioError con mensaje en español si la entrada no sirve.
import { useMemo } from 'react'
import { update, useStore } from '../storage.js'
import { derivePositions } from '../finance/ledger.js'
import * as ops from './portfolios.js'

export { PortfolioError } from './portfolios.js'

/** Acciones estables (no dependen del render): se pueden pasar a hijos sin useCallback. */
export const portfolioActions = Object.freeze({
  /** @param {{ name: string, id?: string, transactions?: any[], notes?: string }} input */
  create(input) {
    let created
    update((s) => {
      const res = ops.createPortfolio(s, input)
      created = res.portfolio
      return res.state
    })
    return created
  },
  /** @param {string} id @param {string} name */
  rename: (id, name) => update((s) => ops.renamePortfolio(s, id, name)),
  /** @param {string} id */
  remove: (id) => update((s) => ops.deletePortfolio(s, id)),
  /** @param {string} id */
  setActive: (id) => update((s) => ops.setActivePortfolio(s, id)),
  /** @param {string} portfolioId @param {any} tx */
  addTransaction(portfolioId, tx) {
    let added
    update((s) => {
      const res = ops.addTransaction(s, portfolioId, tx)
      added = res.transaction
      return res.state
    })
    return added
  },
  /** @param {string} portfolioId @param {string} txId @param {any} patch */
  updateTransaction: (portfolioId, txId, patch) => update((s) => ops.updateTransaction(s, portfolioId, txId, patch)),
  /** @param {string} portfolioId @param {string} txId */
  removeTransaction: (portfolioId, txId) => update((s) => ops.removeTransaction(s, portfolioId, txId)),
  /** @param {string} portfolioId @param {Record<string, number>} targets */
  setTargets: (portfolioId, targets) => update((s) => ops.setTargets(s, portfolioId, targets)),
})

/**
 * @param {{ asOf?: string | null }} [options] fecha de corte para las posiciones
 */
export function usePortfolios({ asOf = null } = {}) {
  const portfolios = useStore((s) => s.portfolios)
  const activeId = useStore((s) => s.activePortfolioId)
  const active = portfolios.find((p) => p.id === activeId) ?? null
  const positions = useMemo(() => (active ? derivePositions(active.transactions, { asOf }) : []), [active, asOf])
  return { portfolios, active, activeId, positions, actions: portfolioActions }
}

/** Solo las listas de seguimiento. */
export function useWatchlists() {
  return useStore((s) => s.watchlists)
}

/** Ajustes (benchmark, perfil de riesgo, bienvenida terminada). */
export function useSettings() {
  return useStore((s) => s.settings)
}
