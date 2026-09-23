// Datos y cálculo del backtest: panel semanal en pesos con las emisoras y los dos referentes
// (así cambiar de referente no vuelve a pedir nada), la serie de CETES 28 desde antes del inicio
// y la corrida de src/lib/finance.
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { panelQuery, riskFreeQuery } from '../../lib/api/queries.js'
import { IPC_SYMBOL, SPX_SYMBOL, marketWeights, runBacktest } from './backtester.js'
import { shiftDays } from './useOptimizer.js'

/**
 * Pesos escritos a mano, en porcentaje: cada uno entre 0 y 100 y que sumen 100.
 * @param {string[]} symbols
 * @param {Record<string, number | null>} percents
 * @returns {{ errors: Record<string, string>, sumError: string | null, total: number }}
 */
export function validatePercents(symbols, percents) {
  /** @type {Record<string, string>} */
  const errors = {}
  let total = 0
  for (const s of symbols) {
    const v = percents[s]
    if (v === null || v === undefined || v < 0 || v > 100) errors[s] = 'Escribe un peso entre 0 % y 100 %.'
    else total += v
  }
  const sumError = Object.keys(errors).length === 0 && Math.abs(total - 100) > 0.05 ? `Los pesos suman ${Math.round(total * 100) / 100} % y tienen que sumar 100 %.` : null
  return { errors, sumError, total }
}

/**
 * @param {{ symbols: string[], mode: 'portfolio' | 'manual', percents: Record<string, number | null>,
 *   positions: { symbol: string, quantity: number }[], strategy: 'buyAndHold' | 'constantMix',
 *   rebalance: 'weekly' | 'monthly' | 'quarterly' | 'annual', benchmark: 'ipc' | 'spx' | 'blend',
 *   blendIpcPct: number | null, range: string }} input
 */
export function useBacktest({ symbols, mode, percents, positions, strategy, rebalance, benchmark, blendIpcPct, range }) {
  const assets = mode === 'portfolio' ? positions.map((p) => p.symbol) : symbols
  const request = useMemo(() => [...new Set([...assets, IPC_SYMBOL, SPX_SYMBOL])], [assets])
  const enabled = assets.length >= 1
  const panel = useQuery({ ...panelQuery(request, { range, interval: '1wk', ccy: 'MXN' }), enabled })
  const start = panel.data?.dates?.[0] ? shiftDays(panel.data.dates[0], -60) : null
  const rf = useQuery({ ...riskFreeQuery({ start }), enabled: Boolean(start) })

  const manual = useMemo(() => validatePercents(symbols, percents), [symbols, percents])
  const blendError = benchmark === 'blend' && (blendIpcPct === null || blendIpcPct < 0 || blendIpcPct > 100) ? 'Escribe un porcentaje entre 0 % y 100 %.' : null

  const weights = useMemo(() => {
    if (mode === 'portfolio') return panel.data ? marketWeights(positions, panel.data.prices) : null
    if (Object.keys(manual.errors).length || manual.sumError) return null
    return Object.fromEntries(symbols.map((s) => [s, /** @type {number} */ (percents[s]) / 100]))
  }, [mode, panel.data, positions, manual, symbols, percents])

  const result = useMemo(() => {
    if (!panel.data || !weights || blendError) return null
    return runBacktest(panel.data, { weights, strategy, rebalance, benchmark, blendIpc: (blendIpcPct ?? 50) / 100, rfSeries: rf.data ?? null })
  }, [panel.data, weights, blendError, strategy, rebalance, benchmark, blendIpcPct, rf.data])

  return { panel, rf, manual, blendError, weights, result, enabled }
}
