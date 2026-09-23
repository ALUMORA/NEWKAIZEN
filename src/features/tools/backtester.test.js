import { IPC_SYMBOL, SPX_SYMBOL, benchmarkLabel, marketWeights, runBacktest } from './backtester.js'

const PANEL = {
  dates: ['2026-01-02', '2026-01-09', '2026-01-16'],
  prices: { A: [1, 1.1, 0.99], B: [1, 1, 1], [IPC_SYMBOL]: [50, 51, 52], [SPX_SYMBOL]: [100, 99, 101] },
}
const BASE = { weights: { A: 0.5, B: 0.5 }, strategy: /** @type {const} */ ('buyAndHold'), rebalance: /** @type {const} */ ('weekly'), benchmark: /** @type {const} */ ('ipc'), blendIpc: 0.5 }

describe('backtest', () => {
  it('comprar y mantener termina en .995 y mezcla constante semanal en .9975', () => {
    const bh = runBacktest(PANEL, BASE)
    expect(bh.growth.portfolio.at(-1).value).toBeCloseTo(0.995, 10)
    expect(bh.turnover).toBeNull()
    const cm = runBacktest(PANEL, { ...BASE, strategy: 'constantMix' })
    expect(cm.growth.portfolio.at(-1).value).toBeCloseTo(0.9975, 10)
    expect(cm.turnover.total).toBeGreaterThan(0)
  })

  it('el referente va en las mismas fechas y la comparación sale de las dos trayectorias', () => {
    const out = runBacktest(PANEL, BASE)
    expect(out.growth.benchmark.map((p) => p.date)).toEqual(PANEL.dates)
    expect(out.growth.benchmark.at(-1).value).toBeCloseTo(52 / 50, 10)
    expect(out.comparison.excess).toBeCloseTo(0.995 - 1.04, 10)
    expect(out.periods).toBe(2)
  })

  it('la mezcla de referentes pesa cada índice como se pidió', () => {
    const out = runBacktest(PANEL, { ...BASE, benchmark: 'blend', blendIpc: 1 })
    expect(out.growth.benchmark.at(-1).value).toBeCloseTo(52 / 50, 10)
    expect(benchmarkLabel('blend', 0.6)).toBe('Mezcla: 60 % IPC y 40 % S&P 500')
  })

  it('caída máxima con fechas de pico y fondo', () => {
    const out = runBacktest(PANEL, BASE)
    expect(out.drawdown.portfolio.maxDrawdown).toBeCloseTo(0.995 / 1.05 - 1, 10)
    expect(out.drawdown.portfolio.peak).toBe('2026-01-09')
    expect(out.drawdown.portfolio.trough).toBe('2026-01-16')
    expect(out.drawdown.portfolio.recovery).toBeNull()
  })

  it('una emisora sin historia se reporta y las demás se renormalizan', () => {
    const out = runBacktest(PANEL, { ...BASE, weights: { A: 0.5, ZZZ: 0.5 } })
    expect(out.missing).toEqual(['ZZZ'])
    expect(out.weights).toEqual({ A: 1 })
  })

  it('sin la tasa de CETES completa, Sharpe se mide contra cero y se avisa', () => {
    const out = runBacktest(PANEL, { ...BASE, rfSeries: { dates: ['2026-01-02'], values: [0.07] } })
    expect(out.rfComplete).toBe(true)
    const none = runBacktest(PANEL, BASE)
    expect(none.rfComplete).toBe(false)
  })

  it('sin referente en el panel es un error con mensaje', () => {
    const panel = { dates: PANEL.dates, prices: { A: PANEL.prices.A } }
    expect(runBacktest(panel, BASE).error).toMatch(/referente/)
  })

  it('pesos de hoy por valor de mercado con el último precio', () => {
    const w = marketWeights([{ symbol: 'A', quantity: 10 }, { symbol: 'B', quantity: 30 }, { symbol: 'Z', quantity: 5 }], PANEL.prices)
    expect(w.A).toBeCloseTo(9.9 / 39.9, 10)
    expect(w.B).toBeCloseTo(30 / 39.9, 10)
    expect(w.Z).toBeUndefined()
  })
})
