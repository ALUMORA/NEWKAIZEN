import { describe, expect, it } from 'vitest'
import { validateTransaction } from '../../lib/storage.js'
import { SAMPLE_NAME, SAMPLE_TRANSACTIONS, readOnboardingCsv } from './sample.js'

describe('portafolio de ejemplo', () => {
  it('se llama EJEMPLO y todos sus movimientos son válidos', () => {
    expect(SAMPLE_NAME).toContain('EJEMPLO')
    for (const tx of SAMPLE_TRANSACTIONS) expect(validateTransaction(tx).reason).toBeUndefined()
  })
})

describe('readOnboardingCsv', () => {
  it('acepta encabezados en español, tipos en español y montos con signo de pesos', () => {
    const csv = 'Tipo,Fecha,Símbolo,Cantidad,Precio,Moneda,Comisión,Monto\ncompra,2026-03-02,walmex.mx,10,"$1,060.50",mxn,5,\ndepósito,2026-03-01,,,,MXN,,"$20,000"\n'
    const { ok, bad } = readOnboardingCsv(csv)
    expect(bad).toEqual([])
    expect(ok[0]).toMatchObject({ type: 'buy', date: '2026-03-02', symbol: 'WALMEX.MX', quantity: 10, price: 1060.5, currency: 'MXN', fees: 5 })
    expect(ok[1]).toMatchObject({ type: 'deposit', symbol: null, quantity: null, amount: 20000 })
  })

  it('una fila sin símbolo en una compra se rechaza con motivo en español', () => {
    expect(readOnboardingCsv('tipo,cantidad,precio\ncompra,5,10\n').bad).toEqual([{ row: 2, reason: 'falta la clave' }])
  })
})

describe('importación con coma decimal y columnas desconocidas (revisión RT)', () => {
  it('lee 1.234,56 y 1234,56 de un CSV separado por punto y coma', () => {
    const csv = 'Tipo;Fecha;Símbolo;Cantidad;Precio;Moneda;Comisión\ncompra;2026-03-02;WALMEX.MX;10;1.234,56;MXN;5,5\ncompra;2026-03-03;WALMEX.MX;2;1234,56;MXN;\n'
    const { ok } = readOnboardingCsv(csv)
    expect(ok[0].price).toBeCloseTo(1234.56, 10)
    expect(ok[0].fees).toBeCloseTo(5.5, 10)
    expect(ok[1].price).toBeCloseTo(1234.56, 10)
  })

  it('con coma como separador, "1234,56" entre comillas también es decimal', () => {
    const csv = 'tipo,fecha,símbolo,cantidad,precio\ncompra,2026-03-02,WALMEX.MX,10,"1234,56"\n'
    expect(readOnboardingCsv(csv).ok[0].price).toBeCloseTo(1234.56, 10)
  })

  it('un número ilegible no se vuelve otro número: la fila se rechaza', () => {
    const { ok, bad } = readOnboardingCsv('tipo,fecha,símbolo,cantidad,precio\ncompra,2026-03-02,WALMEX.MX,10,diez\n')
    expect(ok).toEqual([])
    expect(bad).toHaveLength(1)
  })

  it('reporta las columnas que no reconoce', () => {
    expect(readOnboardingCsv('Tipo,Fecha,Símbolo,Broker, Notas internas ,\n').unknown).toEqual(['Broker', 'Notas internas'])
  })
})
