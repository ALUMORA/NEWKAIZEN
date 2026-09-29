import { describe, expect, it } from 'vitest'
import { BENCH_IPC, BENCH_SPX, computeRisk, panelSymbols, sectorExposure } from './risk-view.js'

const pos = (symbol, quantity, currency = 'MXN') => ({ symbol, quantity, currency })
// Cinco cierres por serie, alineados por fecha como los da /v2/panel.
const dates = ['2026-08-25', '2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22']
const NAF = [50, 51, 50.5, 52, 51]
const SPY = [11000, 11110, 10999, 11200, 11300]

describe('panelSymbols', () => {
  it('pide NAFTRAC.MX y SPY como referencias, sin repetir NAFTRAC si ya está en el portafolio', () => {
    expect(BENCH_IPC).toBe('NAFTRAC.MX')
    expect(BENCH_SPX).toBe('SPY')
    expect(panelSymbols([pos('WALMEX.MX', 10), pos('NAFTRAC.MX', 5)])).toEqual(['WALMEX.MX', 'NAFTRAC.MX', 'SPY'])
    expect(panelSymbols([pos('AAPL', 1, 'USD')])).toEqual(['AAPL', 'NAFTRAC.MX', 'SPY'])
    expect(panelSymbols([pos('WALMEX.MX', 10)])).not.toContain('^MXX')
  })
})

describe('computeRisk', () => {
  it('saca las betas contra NAFTRAC.MX y SPY, no contra los índices de precio', () => {
    // Una posición que se mueve el doble que NAFTRAC: beta 2 contra el IPC.
    const r = NAF.slice(1).map((v, i) => v / NAF[i] - 1)
    const twice = [100]
    for (const x of r) twice.push(twice[twice.length - 1] * (1 + 2 * x))
    const panel = { dates, prices: { X: twice, 'NAFTRAC.MX': NAF, SPY, '^MXX': [1, 2, 1, 2, 1], '^GSPC': [3, 1, 3, 1, 3] } }
    const risk = computeRisk([pos('X', 10)], panel)
    expect(risk?.betaIpc).toBeCloseTo(2, 9)
    expect(risk?.betaSpx).not.toBeNull()
    expect(risk?.weeks).toBe(4)
    // Sin NAFTRAC.MX ni SPY en el panel, no se cae a ^MXX ni a ^GSPC: la beta sale s/d.
    const old = computeRisk([pos('X', 10)], { dates, prices: { X: twice, '^MXX': NAF, '^GSPC': SPY } })
    expect(old?.betaIpc).toBeNull()
    expect(old?.betaSpx).toBeNull()
  })

  it('los valores en pesos de cada posición son los mismos que pesan en el riesgo', () => {
    const panel = { dates, prices: { A: [10, 10, 10, 10, 10], B: [20, 21, 20, 22, 30], 'NAFTRAC.MX': NAF, SPY } }
    const risk = computeRisk([pos('A', 10), pos('B', 10), pos('Z', 3)], panel)
    // Z no tiene panel y no cuenta.
    expect(risk?.values).toEqual([{ symbol: 'A', value: 100 }, { symbol: 'B', value: 300 }])
    expect(risk?.effectiveN).toBeCloseTo(1 / (0.25 ** 2 + 0.75 ** 2), 12)
  })
})

describe('sectorExposure', () => {
  const quotes = [
    { symbol: 'WALMEX.MX', type: 'equity', sector: 'Consumo básico', sectorKey: 'Consumer Defensive' },
    { symbol: 'FEMSAUBD.MX', type: 'equity', sector: 'Consumo básico', sectorKey: 'Consumer Defensive' },
    { symbol: 'GFNORTEO.MX', type: 'equity', sector: 'Servicios financieros', sectorKey: 'Financial Services' },
    { symbol: 'NAFTRAC.MX', type: 'fund', sector: null, sectorKey: null },
    { symbol: 'SPY', type: 'etf', sector: null, sectorKey: null },
    { symbol: 'RARA.MX', type: 'equity', sector: null, sectorKey: null },
  ]
  const values = [
    { symbol: 'WALMEX.MX', value: 300 },
    { symbol: 'FEMSAUBD.MX', value: 100 },
    { symbol: 'GFNORTEO.MX', value: 200 },
    { symbol: 'NAFTRAC.MX', value: 250 },
    { symbol: 'SPY', value: 50 },
    { symbol: 'RARA.MX', value: 100 },
  ]

  it('agrupa por sectorKey con el nombre en español del API, junta fondos y ETF y deja s/d lo que no trae sector', () => {
    const res = sectorExposure(values, quotes)
    expect(res?.groups.map((g) => [g.label, g.value, g.kind])).toEqual([
      ['Consumo básico', 400, 'sector'],
      ['Fondos y ETF', 300, 'funds'],
      ['Servicios financieros', 200, 'sector'],
      ['s/d', 100, 'unknown'],
    ])
    expect(res?.groups[0].weight).toBeCloseTo(0.4, 12)
    expect(res?.groups[0].symbols).toEqual(['WALMEX.MX', 'FEMSAUBD.MX'])
  })

  it('el HHI y la N efectiva por sector se miden sobre lo que tiene sector', () => {
    const res = sectorExposure(values, quotes)
    // Consumo 400 y financieros 200 de 600 con sector: HHI = (2/3)² + (1/3)² = 5/9.
    expect(res?.hhi).toBeCloseTo(5 / 9, 12)
    expect(res?.effectiveN).toBeCloseTo(9 / 5, 12)
    expect(res?.coverage).toBeCloseTo(0.6, 12)
  })

  it('dos llaves de Yahoo con la misma traducción siguen separadas por sectorKey', () => {
    const res = sectorExposure(
      [{ symbol: 'A', value: 1 }, { symbol: 'B', value: 1 }],
      [
        { symbol: 'A', type: 'equity', sector: 'Materiales', sectorKey: 'Materials' },
        { symbol: 'B', type: 'equity', sector: 'Materiales', sectorKey: 'Basic Materials' },
      ],
    )
    expect(res?.groups.map((g) => g.key).sort()).toEqual(['Basic Materials', 'Materials'])
  })

  it('sin cotizaciones o sin nada con sector no inventa', () => {
    expect(sectorExposure(values, undefined)).toBeNull()
    const funds = sectorExposure([{ symbol: 'NAFTRAC.MX', value: 10 }], quotes)
    expect(funds?.groups.map((g) => g.label)).toEqual(['Fondos y ETF'])
    expect(funds?.hhi).toBeNull()
    expect(funds?.effectiveN).toBeNull()
    expect(funds?.coverage).toBe(0)
  })
})
