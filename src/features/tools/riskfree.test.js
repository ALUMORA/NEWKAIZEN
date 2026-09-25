import { describe, expect, it } from 'vitest'
import { runBacktest, IPC_SYMBOL, SPX_SYMBOL } from './backtester.js'
import { assetBetas, latestRiskFree } from './optimizer.js'
import { rfLabel } from './riskfree.js'

// Sin token de Banxico, /v2/rates/rf sirve la interbancaria a 3 meses de FRED con tenorDays 91 y
// fallback true (kaizen_api/domain/rates.py). Antes se trataba como CETES 28 y se decía CETES 28.
const FRED = { tenorDays: 91, convention: 'simple_act360', dates: ['2026-08-01'], values: [0.1], source: 'fred_ir3tib', fallback: true, meta: { fallback: true, source: 'fred' } }
const CETES = { tenorDays: 28, convention: 'simple_act360', dates: ['2026-08-01'], values: [0.1], source: 'banxico', fallback: false, meta: { fallback: false, source: 'banxico' } }

describe('tasa libre de riesgo del API', () => {
  it('usa el plazo que trae la respuesta: 10 % a 91 días no es lo mismo que a 28', () => {
    const fred = latestRiskFree(FRED)
    expect(fred.effective).toBeCloseTo((1 + (0.1 * 91) / 360) ** (365 / 91) - 1, 10)
    expect(fred.fallback).toBe(true)
    expect(fred.tenorDays).toBe(91)
    const cetes = latestRiskFree(CETES)
    expect(cetes.effective).toBeCloseTo((1 + (0.1 * 28) / 360) ** (365 / 28) - 1, 10)
    expect(cetes.fallback).toBe(false)
  })

  it('el respaldo de FRED no se nombra CETES 28', () => {
    expect(rfLabel(latestRiskFree(CETES))).toBe('CETES 28')
    expect(rfLabel(latestRiskFree(FRED))).not.toMatch(/CETES 28/)
    expect(rfLabel(latestRiskFree(FRED))).toMatch(/interbancaria a 3 meses/)
  })

  it('las betas y el backtest convierten la serie con su plazo', () => {
    const dates = ['2026-08-07', '2026-08-14', '2026-08-21']
    const panel = { dates, prices: { A: [1, 1.01, 1.02], [IPC_SYMBOL]: [1, 1.01, 1.02], [SPX_SYMBOL]: [1, 1, 1] } }
    const base = { weights: { A: 1 }, strategy: /** @type {const} */ ('buyAndHold'), rebalance: /** @type {const} */ ('weekly'), benchmark: /** @type {const} */ ('ipc'), blendIpc: 0.5 }
    const withFred = runBacktest(panel, { ...base, rfSeries: FRED })
    const withCetes = runBacktest(panel, { ...base, rfSeries: CETES })
    expect(withFred.rfFallback).toBe(true)
    expect(withCetes.rfFallback).toBe(false)
    // Mismas tasas, distinto plazo: el Sharpe tiene que cambiar.
    expect(withFred.portfolio.sharpe).not.toBeCloseTo(withCetes.portfolio.sharpe, 8)
    const d5 = ['2026-08-07', '2026-08-14', '2026-08-21', '2026-08-28', '2026-09-04', '2026-09-11']
    const bench = [0.01, -0.02, 0.015, 0.005, -0.01]
    const prep = { assets: ['A'], bench, matrix: bench.map((b, i) => [1.5 * b + (i % 2 ? 0.004 : -0.002)]), priceDates: d5, dates: d5.slice(1) }
    const b91 = assetBetas(/** @type {any} */ (prep), FRED)
    const b28 = assetBetas(/** @type {any} */ (prep), CETES)
    expect(b91[0].n).toBe(5)
    expect(b28[0].n).toBe(5)
  })
})
