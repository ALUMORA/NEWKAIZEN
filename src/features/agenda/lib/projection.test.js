import { describe, expect, it } from 'vitest'
import { groupByMonth, nextTwelveMonths, originMap, projectDividends, upcomingEvents } from './projection.js'

const TODAY = '2026-10-01'

describe('projectDividends: respuestas conocidas', () => {
  it('100 títulos con 0.50 MXN trimestral en ene, abr, jul y oct: 4 pagos de 50 = 200 al año y 180 netos', () => {
    const out = projectDividends({
      positions: [{ symbol: 'WALMEX.MX', quantity: 100 }],
      summaries: [{ symbol: 'WALMEX.MX', currency: 'MXN', lastPaidAmount: 0.5, lastPaidDate: '2026-07-15', frequency: 'trimestral', paidMonths: [1, 4, 7, 10] }],
      usdmxn: null,
      today: TODAY,
    })
    const pagos = out.months.filter((m) => m.gross > 0)
    expect(pagos).toHaveLength(4)
    for (const m of pagos) expect(m.gross).toBeCloseTo(50, 10)
    expect(out.totalGross).toBeCloseTo(200, 10)
    expect(out.totalNet).toBeCloseTo(180, 10)
    expect(out.rows[0].missing).toBe(false)
  })

  it('emisora sin dividendos: proyección 0 y marcada como s/d', () => {
    const out = projectDividends({
      positions: [{ symbol: 'AMZN', quantity: 10 }],
      summaries: [{ symbol: 'AMZN', currency: 'USD', lastPaidAmount: null, lastPaidDate: null, frequency: null, paidMonths: [] }],
      usdmxn: 18,
      today: TODAY,
    })
    expect(out.totalGross).toBe(0)
    expect(out.rows[0].annualGross).toBe(0)
    expect(out.rows[0].missing).toBe(true)
    expect(out.rows[0].perPayment).toBeNull()
  })

  it('emisora sin resumen también da 0 y s/d', () => {
    const out = projectDividends({ positions: [{ symbol: 'X', quantity: 5 }], summaries: null, usdmxn: 18, today: TODAY })
    expect(out.rows[0].missing).toBe(true)
    expect(out.totalGross).toBe(0)
  })

  it('emisora del SIC con 0.25 USD y FIX de prueba 18.00: 4.50 MXN por título por pago', () => {
    const out = projectDividends({
      positions: [{ symbol: 'AAPL', quantity: 1 }],
      summaries: [{ symbol: 'AAPL', currency: 'USD', lastPaidAmount: 0.25, lastPaidDate: '2026-08-14', frequency: 'trimestral', paidMonths: [2, 5, 8, 11] }],
      usdmxn: 18,
      today: TODAY,
    })
    expect(out.rows[0].perPaymentMxn).toBeCloseTo(4.5, 10)
    expect(out.months.find((m) => m.month === 11)?.gross).toBeCloseTo(4.5, 10)
    expect(out.totalGross).toBeCloseTo(18, 10)
  })

  it('dividendo en dólares sin tipo de cambio: queda fuera y lo avisa', () => {
    const out = projectDividends({
      positions: [{ symbol: 'AAPL', quantity: 1 }],
      summaries: [{ symbol: 'AAPL', currency: 'USD', lastPaidAmount: 0.25, lastPaidDate: null, frequency: 'trimestral', paidMonths: [2, 5, 8, 11] }],
      usdmxn: null,
      today: TODAY,
    })
    expect(out.fxMissing).toBe(true)
    expect(out.rows[0].fxMissing).toBe(true)
    expect(out.totalGross).toBe(0)
  })
})

describe('meses y eventos', () => {
  it('doce meses desde el de hoy, cruzando el año', () => {
    const m = nextTwelveMonths('2026-10-01')
    expect(m).toHaveLength(12)
    expect(m[0].key).toBe('2026-10')
    expect(m[3].key).toBe('2027-01')
    expect(m[11].key).toBe('2027-09')
  })

  it('filtra la ventana, ordena por fecha y respeta el origen', () => {
    const origins = originMap(['WALMEX.MX'], ['AAPL', 'WALMEX.MX', 'MSFT'])
    expect(origins.get('WALMEX.MX')).toBe('ambos')
    expect(origins.get('AAPL')).toBe('lista')
    const items = [
      { symbol: 'AAPL', type: 'earnings', date: '2026-10-30', estimate: 1.7, amount: null, currency: 'USD' },
      { symbol: 'WALMEX.MX', type: 'earnings', date: '2026-10-27T00:00:00', estimate: 0.7129, amount: null, currency: 'MXN' },
      { symbol: 'MSFT', type: 'earnings', date: '2027-03-01', estimate: 3, amount: null, currency: 'USD' },
      { symbol: 'AAPL', type: 'exDividend', date: '2026-09-01', estimate: null, amount: null, currency: null },
    ]
    const all = upcomingEvents(/** @type {any} */ (items), { today: TODAY, days: 90, origins })
    expect(all.map((e) => e.symbol)).toEqual(['WALMEX.MX', 'AAPL'])
    expect(all[0].date).toBe('2026-10-27')
    const soloPortafolio = upcomingEvents(/** @type {any} */ (items), { today: TODAY, days: 90, origins, filter: 'portafolio' })
    expect(soloPortafolio.map((e) => e.symbol)).toEqual(['WALMEX.MX'])
    expect(groupByMonth(all).map((g) => g.key)).toEqual(['2026-10'])
  })
})
