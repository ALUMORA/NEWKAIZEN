import { describe, expect, it } from 'vitest'
import { parseCSV, rowsToObjects } from '../../lib/csv.js'
import { validateTransaction } from '../../lib/storage.js'
import { SAMPLE_NAME, SAMPLE_TRANSACTIONS, rowsToRawTransactions } from './sample.js'

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
    expect(validateTransaction(raw[0]).reason).toBe('falta el símbolo')
  })
})
