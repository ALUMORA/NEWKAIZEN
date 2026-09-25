import { describe, expect, it } from 'vitest'
import { BOM } from '../../../lib/csv.js'
import { parseCell, parseDateCell, parseTransactionsCSV, transactionsToCSV } from './tx-csv.js'

const LEDGER = [
  { id: 'a', type: 'deposit', date: '2026-09-01', symbol: null, quantity: null, price: null, currency: 'MXN', fxRate: null, fees: 0, amount: 20000, ratio: null, note: '' },
  { id: 'b', type: 'buy', date: '2026-09-02', symbol: 'WALMEX.MX', quantity: 100, price: 60.5, currency: 'MXN', fxRate: null, fees: 12.3, amount: null, ratio: null, note: 'primera, con coma' },
  { id: 'c', type: 'buy', date: '2026-09-03', symbol: 'AAPL', quantity: 2, price: 230.5, currency: 'USD', fxRate: 18.4125, fees: 0, amount: null, ratio: null, note: '' },
  { id: 'd', type: 'split', date: '2026-09-04', symbol: 'AAPL', quantity: null, price: null, currency: 'USD', fxRate: null, fees: 0, amount: null, ratio: 2, note: '-nota que parece fórmula' },
]

describe('transactionsToCSV y parseTransactionsCSV', () => {
  it('exporta con BOM y encabezado en español', () => {
    const text = transactionsToCSV(LEDGER)
    expect(text.startsWith(BOM)).toBe(true)
    expect(text.split('\r\n')[0]).toBe(`${BOM}Fecha,Tipo,Clave,Títulos,Precio,Monto,Comisión,Moneda,Tipo de cambio,Proporción,Nota`)
    expect(text).toContain('2026-09-02,Compra,WALMEX.MX,100,60.5,,12.3,MXN,,,"primera, con coma"')
  })

  it('ida y vuelta: lo exportado se importa igual en un libro vacío', () => {
    const { ok, bad, repeated } = parseTransactionsCSV(transactionsToCSV(LEDGER))
    expect(bad).toEqual([])
    expect(repeated).toBe(0)
    const strip = (/** @type {any} */ t) => ({ ...t, id: undefined })
    expect(ok.map(strip)).toEqual(LEDGER.map(strip))
    expect(ok.every((t) => typeof t.id === 'string' && !['a', 'b', 'c', 'd'].includes(t.id))).toBe(true)
  })

  it('reimportar sobre el mismo libro no duplica', () => {
    const res = parseTransactionsCSV(transactionsToCSV(LEDGER), LEDGER)
    expect(res.ok).toEqual([])
    expect(res.repeated).toBe(4)
  })

  it('dos filas idénticas del archivo entran las dos', () => {
    const text = 'tipo,fecha,símbolo,cantidad,precio\ncompra,2026-09-02,NAFTRAC.MX,10,55\ncompra,2026-09-02,NAFTRAC.MX,10,55\n'
    expect(parseTransactionsCSV(text).ok).toHaveLength(2)
  })

  it('acepta encabezados en inglés, fechas DD/MM/AAAA y reporta filas malas con su número', () => {
    const text = 'Type;Date;Symbol;Quantity;Price;Currency\nBuy;02/09/2026;walmex.mx;1,000;60.5;mxn\nventa;2026-09-03;;5;61;MXN\nregalo;2026-09-03;X;1;1;MXN\n'
    const { ok, bad } = parseTransactionsCSV(text)
    expect(ok).toHaveLength(1)
    expect(ok[0]).toMatchObject({ type: 'buy', date: '2026-09-02', symbol: 'WALMEX.MX', quantity: 1000, price: 60.5, currency: 'MXN' })
    expect(bad).toEqual([
      { row: 3, reason: 'falta la clave' },
      { row: 4, reason: 'tipo desconocido (regalo)' },
    ])
  })

  it('sin columna Tipo o sin filas lo dice', () => {
    expect(parseTransactionsCSV('fecha,clave\n2026-01-01,X\n').bad).toEqual([{ row: 1, reason: 'falta la columna Tipo' }])
    expect(parseTransactionsCSV('Fecha,Tipo\n').empty).toBe(true)
  })
})

describe('parseCell y parseDateCell', () => {
  it('entiende los formatos comunes', () => {
    expect(parseCell('1,234.56')).toBe(1234.56)
    expect(parseCell('1.234,56')).toBe(1234.56)
    expect(parseCell('1.234.567,5')).toBe(1234567.5)
    expect(parseCell('1.234', { decimalComma: true })).toBe(1234)
    expect(parseCell('12,5', { decimalComma: true })).toBe(12.5)
    expect(parseCell('$ 2 500')).toBe(2500)
    expect(parseCell('−5')).toBe(-5)
    expect(parseCell('0,375')).toBe(0.375)
    expect(parseCell('')).toBeNull()
    expect(parseCell('abc')).toBeNaN()
    expect(parseDateCell('7/3/2026')).toBe('2026-03-07')
    expect(parseDateCell('2026-03-07')).toBe('2026-03-07')
  })
})
