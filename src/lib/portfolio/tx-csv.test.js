import { describe, expect, it } from 'vitest'
import { csvColumns, fieldOfHeader, parseTransactionsCSV } from './tx-csv.js'

describe('parseTransactionsCSV: columnas que no se leen', () => {
  it('devuelve en ignored el nombre de cada columna no reconocida, tal como viene en el archivo', () => {
    const text = 'Tipo,Fecha,Clave,Títulos,Precio,Casa de bolsa, Folio ,\nCompra,2026-03-02,WALMEX.MX,10,60.5,GBM,123,\n'
    const res = parseTransactionsCSV(text)
    expect(res.ok).toHaveLength(1)
    expect(res.ignored).toEqual(['Casa de bolsa', 'Folio'])
  })

  it('sin columnas de más, ignored va vacío; también sin filas o sin columna Tipo', () => {
    expect(parseTransactionsCSV('Tipo,Fecha,Clave,Títulos,Precio\nCompra,2026-03-02,X,1,1\n').ignored).toEqual([])
    expect(parseTransactionsCSV('Fecha,Tipo,Broker\n')).toMatchObject({ empty: true, ignored: ['Broker'] })
    expect(parseTransactionsCSV('fecha,clave,broker\n2026-01-01,X,GBM\n')).toMatchObject({ bad: [{ row: 1, reason: 'falta la columna Tipo' }], ignored: ['broker'] })
  })

  it('reconoce los encabezados con o sin acentos, guiones y mayúsculas', () => {
    for (const h of ['Símbolo', 'SIMBOLO', 'tipo_de_cambio', 'Tipo-de-cambio', 'Proporción', 'Comisiones', 'shares']) expect(fieldOfHeader(h), h).not.toBeNull()
    expect(csvColumns(['Tipo', 'Fecha', 'Símbolo', 'Broker', ' Notas internas ', ''])).toEqual({ known: ['Tipo', 'Fecha', 'Símbolo'], unknown: ['Broker', 'Notas internas'] })
  })

  it('una cifra ambigua sin otra que la aclare se lee por el separador', () => {
    expect(parseTransactionsCSV('Tipo;Clave;Títulos;Precio\nCompra;X;1.500;25\n').ok[0].quantity).toBe(1500)
    expect(parseTransactionsCSV('Tipo,Clave,Títulos,Precio\nCompra,X,"1,500",25\n').ok[0].quantity).toBe(1500)
  })
})
