// Contrato de derivePositions (src/lib/finance/ledger.js). S2 dejó un stub con costo promedio;
// el stream A reemplaza el interior y estas pruebas tienen que seguir pasando.
import { derivePositions } from '../finance/ledger.js'

const buy = (symbol, quantity, price, extra = {}) => ({
  id: `b-${symbol}-${quantity}-${price}`, type: 'buy', symbol, quantity, price,
  currency: symbol.endsWith('.MX') ? 'MXN' : 'USD', fees: 0, date: null, ...extra,
})
const sell = (symbol, quantity, price, extra = {}) => ({ ...buy(symbol, quantity, price, extra), id: `s-${symbol}-${quantity}`, type: 'sell' })

describe('derivePositions (contrato)', () => {
  it('sin movimientos no hay posiciones', () => {
    expect(derivePositions([])).toEqual([])
    expect(derivePositions(undefined)).toEqual([])
  })

  it('una compra: costo promedio = precio y costo total = precio × cantidad + comisión', () => {
    expect(derivePositions([buy('AAPL', 10, 150, { fees: 5 })])).toEqual([
      { symbol: 'AAPL', quantity: 10, avgCost: 150.5, currency: 'USD', costBasis: 1505 },
    ])
  })

  it('dos compras promedian el costo', () => {
    const [p] = derivePositions([buy('WALMEX.MX', 10, 60), buy('WALMEX.MX', 30, 80)])
    expect(p).toMatchObject({ symbol: 'WALMEX.MX', quantity: 40, currency: 'MXN', costBasis: 3000 })
    expect(p.avgCost).toBeCloseTo(75, 12)
  })

  it('una venta no cambia el costo promedio y quita costo proporcional', () => {
    const [p] = derivePositions([buy('AAPL', 10, 100), buy('AAPL', 10, 200), sell('AAPL', 5, 400)])
    expect(p.quantity).toBe(15)
    expect(p.avgCost).toBeCloseTo(150, 12)
    expect(p.costBasis).toBeCloseTo(2250, 9)
  })

  it('vender todo cierra la posición', () => {
    expect(derivePositions([buy('AAPL', 3, 10), sell('AAPL', 3, 12)])).toEqual([])
  })

  it('split 4 por 1: cuatro veces las acciones, costo total igual', () => {
    const [p] = derivePositions([
      buy('NVDA', 10, 400, { date: '2024-01-10' }),
      { id: 'sp', type: 'split', symbol: 'NVDA', ratio: 4, date: '2024-06-10', currency: 'USD', fees: 0 },
    ])
    expect(p.quantity).toBe(40)
    expect(p.avgCost).toBeCloseTo(100, 12)
    expect(p.costBasis).toBe(4000)
  })

  it('dividendos, depósitos, retiros y comisiones no mueven posiciones', () => {
    const out = derivePositions([
      buy('FUNO11.MX', 100, 20),
      { id: 'd', type: 'dividend', symbol: 'FUNO11.MX', amount: 50, currency: 'MXN', fees: 0, date: null },
      { id: 'dep', type: 'deposit', amount: 1000, currency: 'MXN', fees: 0, date: null },
      { id: 'w', type: 'withdrawal', amount: 10, currency: 'MXN', fees: 0, date: null },
      { id: 'f', type: 'fee', amount: 5, currency: 'MXN', fees: 0, date: null },
    ])
    expect(out).toEqual([{ symbol: 'FUNO11.MX', quantity: 100, avgCost: 20, currency: 'MXN', costBasis: 2000 }])
  })

  it('asOf ignora lo posterior y los saldos sin fecha van primero', () => {
    const txs = [
      buy('AAPL', 5, 100, { date: '2026-03-01' }),
      buy('AAPL', 5, 200, { date: null }),
      sell('AAPL', 2, 300, { date: '2026-06-01' }),
    ]
    expect(derivePositions(txs, { asOf: '2026-04-01' })[0]).toMatchObject({ quantity: 10, avgCost: 150 })
    expect(derivePositions(txs, { asOf: '2025-12-31' })[0]).toMatchObject({ quantity: 5, avgCost: 200 })
    expect(derivePositions(txs)[0]).toMatchObject({ quantity: 8 })
  })

  it('el orden de entrada no importa si las fechas lo definen', () => {
    const a = [buy('AAPL', 10, 100, { date: '2026-01-01' }), sell('AAPL', 10, 150, { date: '2026-02-01' }), buy('AAPL', 1, 300, { date: '2026-03-01' })]
    expect(derivePositions(a)).toEqual(derivePositions([a[2], a[1], a[0]]))
    expect(derivePositions(a)[0]).toMatchObject({ quantity: 1, avgCost: 300 })
  })

  it('una compra sin precio deja el costo como desconocido', () => {
    const [p] = derivePositions([buy('MSFT', 2, null), buy('MSFT', 1, 300)])
    expect(p).toMatchObject({ quantity: 3, avgCost: null, costBasis: null })
  })

  it('ordena por símbolo', () => {
    const out = derivePositions([buy('WALMEX.MX', 1, 1), buy('AAPL', 1, 1), buy('CEMEXCPO.MX', 1, 1)])
    expect(out.map((p) => p.symbol)).toEqual(['AAPL', 'CEMEXCPO.MX', 'WALMEX.MX'])
  })
})
