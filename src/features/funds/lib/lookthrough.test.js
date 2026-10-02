import { describe, expect, it } from 'vitest'
import { isBmvEtfWithoutData, lookthrough, overlap, overlapMatrix } from './lookthrough.js'

/** @param {Partial<import('../types.js').FundResponse>} over @returns {import('../types.js').FundResponse} */
const fund = (over) => ({
  symbol: 'X', mappedFrom: null, name: null, family: null, category: null, legalType: null, expenseRatio: null,
  totalNetAssets: null, totalNetAssetsUnit: null, turnover: null, assetClasses: null, sectors: [], topHoldings: [],
  coverage: { topHoldingsWeight: null }, meta: /** @type {any} */ ({}), ...over,
})

const SPY = fund({
  symbol: 'SPY',
  sectors: [{ sector: 'Tecnología', weight: 0.3869 }, { sector: 'Servicios financieros', weight: 0.1281 }],
  topHoldings: [
    { symbol: 'NVDA', name: 'NVIDIA', weight: 0.0808 },
    { symbol: 'AAPL', name: 'Apple', weight: 0.0703 },
    { symbol: 'MSFT', name: 'Microsoft', weight: 0.0569 },
    { symbol: 'AMZN', name: 'Amazon', weight: 0.0396 },
  ],
})
const QQQ = fund({
  symbol: 'QQQ',
  sectors: [{ sector: 'Tecnología', weight: 0.5915 }],
  topHoldings: [
    { symbol: 'NVDA', name: 'NVIDIA', weight: 0.0951 },
    { symbol: 'AAPL', name: 'Apple', weight: 0.0812 },
    { symbol: 'MSFT', name: 'Microsoft', weight: 0.0741 },
    { symbol: 'AVGO', name: 'Broadcom', weight: 0.0532 },
  ],
})

describe('lookthrough: respuestas conocidas', () => {
  it('50% SPY (tecnología 0.3869) y 50% QQQ (0.5915) dan 0.4892 en tecnología', () => {
    const out = lookthrough(
      [
        { symbol: 'SPY', weight: 0.5, kind: 'fund' },
        { symbol: 'QQQ', weight: 0.5, kind: 'fund' },
      ],
      { SPY, QQQ },
    )
    expect(out.sectors.find((s) => s.sector === 'Tecnología')?.weight).toBeCloseTo(0.4892, 10)
    expect(out.coverage.sectors).toBeCloseTo(1, 10)
  })

  it('AAPL directa 10% más 50% SPY con AAPL 0.0703 da 0.13515', () => {
    const out = lookthrough(
      [
        { symbol: 'AAPL', weight: 0.1, kind: 'direct', sector: 'Tecnología' },
        { symbol: 'SPY', weight: 0.5, kind: 'fund' },
      ],
      { SPY },
    )
    const aapl = out.issuers.find((i) => i.key === 'AAPL')
    expect(aapl?.weight).toBeCloseTo(0.13515, 10)
    expect(aapl?.direct).toBeCloseTo(0.1, 10)
    expect(aapl?.viaFunds).toBeCloseTo(0.03515, 10)
  })

  it('un ETF sin datos no cuenta en la cobertura y se lista', () => {
    const out = lookthrough(
      [
        { symbol: 'WALMEX.MX', weight: 0.62, kind: 'direct', sector: 'Consumo básico' },
        { symbol: 'NAFTRAC.MX', weight: 0.38, kind: 'fund' },
      ],
      { 'NAFTRAC.MX': null },
    )
    expect(out.coverage.sectors).toBeCloseTo(0.62, 10)
    expect(out.coverage.uncoveredFunds).toEqual(['NAFTRAC.MX'])
    expect(isBmvEtfWithoutData('naftrac.mx')).toBe(true)
  })
})

describe('traslape', () => {
  it('SPY con QQQ: NVDA, AAPL y MSFT compartidas con pesos mayores en QQQ suman al menos 0.2080', () => {
    const o = /** @type {number} */ (overlap(SPY, QQQ))
    expect(o).toBeCloseTo(0.0808 + 0.0703 + 0.0569, 10)
    expect(o).toBeGreaterThanOrEqual(0.208 - 1e-12)
    expect(overlap(QQQ, SPY)).toBeCloseTo(o, 12)
  })

  it('la matriz deja fuera a los fondos sin datos', () => {
    const m = overlapMatrix([
      { symbol: 'SPY', fund: SPY },
      { symbol: 'NAFTRAC.MX', fund: null },
      { symbol: 'QQQ', fund: QQQ },
    ])
    expect(m.labels).toEqual(['SPY', 'QQQ'])
    expect(m.values[0][1]).toBeCloseTo(0.208, 10)
  })
})
