import { describe, expect, it } from 'vitest'
import { detectDelimiter, parseCSV, rowsToObjects } from '../../lib/csv.js'
import { validateTransaction } from '../../lib/storage.js'
import { SAMPLE_NAME, SAMPLE_TRANSACTIONS, csvColumns, rowsToRawTransactions } from './sample.js'

describe('portafolio de ejemplo', () => {
  it('se llama EJEMPLO y todos sus movimientos son válidos', () => {
    expect(SAMPLE_NAME).toContain('EJEMPLO')
    for (const tx of SAMPLE_TRANSACTIONS) expect(validateTransaction(tx).reason).toBeUndefined()
  })
})

describe('rowsToRawTransactions', () => {
  it('acepta encabezados en español, tipos en español y montos con signo de pesos', () => {
    const csv = 'Tipo,Fecha,Símbolo,Cantidad,Precio,Moneda,Comisión\ncompra,2026-03-02,walmex.mx,10,"$1,060.50",mxn,5\ndepósito,2026-03-01,,,,MXN,\n'
    const raw = rowsToRawTransactions(rowsToObjects(parseCSV(csv)))
    expect(raw[0]).toMatchObject({ type: 'buy', date: '2026-03-02', symbol: 'walmex.mx', quantity: 10, price: 1060.5, currency: 'MXN', fees: 5 })
    expect(raw[1]).toMatchObject({ type: 'deposit', symbol: null, quantity: null })
    expect(validateTransaction(raw[0]).tx?.symbol).toBe('WALMEX.MX')
  })

  it('una fila sin símbolo en una compra se rechaza con motivo en español', () => {
    const raw = rowsToRawTransactions([{ tipo: 'compra', cantidad: '5', precio: '10' }])
    expect(validateTransaction(raw[0]).reason).toBe('falta la clave')
  })
})

describe('importación con coma decimal y columnas desconocidas (revisión RT)', () => {
  it('lee 1.234,56 y 1234,56 de un CSV separado por punto y coma', () => {
    const csv = 'Tipo;Fecha;Símbolo;Cantidad;Precio;Moneda;Comisión\ncompra;2026-03-02;WALMEX.MX;10;1.234,56;MXN;5,5\ncompra;2026-03-03;WALMEX.MX;2;1234,56;MXN;\n'
    const raw = rowsToRawTransactions(rowsToObjects(parseCSV(csv)), { decimalComma: detectDelimiter(csv) === ';' })
    expect(raw[0].price).toBeCloseTo(1234.56, 10)
    expect(raw[0].fees).toBeCloseTo(5.5, 10)
    expect(raw[1].price).toBeCloseTo(1234.56, 10)
  })

  it('con coma como separador, "1234,56" entre comillas también es decimal', () => {
    const csv = 'tipo,fecha,símbolo,cantidad,precio\ncompra,2026-03-02,WALMEX.MX,10,"1234,56"\n'
    expect(rowsToRawTransactions(rowsToObjects(parseCSV(csv)))[0].price).toBeCloseTo(1234.56, 10)
  })

  it('un número ilegible no se vuelve otro número: queda NaN y la fila se rechaza', () => {
    const raw = rowsToRawTransactions([{ tipo: 'compra', fecha: '2026-03-02', símbolo: 'WALMEX.MX', cantidad: '10', precio: 'diez' }])
    expect(raw[0].price).toBeNaN()
    expect(validateTransaction(raw[0]).tx).toBeUndefined()
  })

  it('reporta las columnas que no reconoce', () => {
    expect(csvColumns(['Tipo', 'Fecha', 'Símbolo', 'Broker', ' Notas internas ', ''])).toEqual({ known: ['Tipo', 'Fecha', 'Símbolo'], unknown: ['Broker', 'Notas internas'] })
  })
})
