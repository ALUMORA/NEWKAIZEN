// Paridad de la importación de CSV: el mismo archivo por la bienvenida y por Movimientos tiene
// que dar los mismos movimientos y las mismas filas con problema. Antes eran dos parsers y
// diferían en esto (cada caso de abajo cubre una diferencia real):
//   1. Fechas DD/MM/AAAA: Movimientos las convertía, la bienvenida las rechazaba.
//   2. Columna Proporción (ratio) de los splits: solo Movimientos la leía.
//   3. Alias de encabezado (ticker, emisora, shares, comisiones, fee, fx, factor, notas, con guion
//      o guion bajo): solo Movimientos.
//   4. Coma decimal en archivos con punto y coma: la bienvenida la forzaba siempre ("60.5" daba
//      605) y Movimientos nunca ("17,125" de tipo de cambio daba 17,125).
//   5. Celdas protegidas con apóstrofo al exportar ('-nota): solo Movimientos lo quitaba.
//   6. Tipo desconocido: la bienvenida lo reportaba en minúsculas, Movimientos tal cual.
//   7. Sin columna Tipo: la bienvenida daba un error por fila, Movimientos uno solo en la fila 1.
//   8. Columnas no reconocidas: la bienvenida las avisaba, Movimientos las tiraba en silencio.
import { describe, expect, it } from 'vitest'
import { parseTransactionsCSV } from '../portfolio/lib/tx-csv.js'
import { readOnboardingCsv } from './sample.js'

const strip = (/** @type {any[]} */ txs) => txs.map((t) => ({ ...t, id: undefined }))

/** @param {string} text */
function both(text) {
  const bienvenida = readOnboardingCsv(text)
  const movimientos = parseTransactionsCSV(text)
  return { bienvenida, movimientos }
}

const CASES = {
  'el CSV de la bienvenida': 'tipo,fecha,símbolo,cantidad,precio,moneda\ncompra,2026-03-02,WALMEX.MX,10,60.5,MXN\ncompra,2026-03-02,,5,10,MXN\n',
  'Excel en español con coma decimal y una columna de más':
    'tipo;fecha;símbolo;cantidad;precio;moneda;casa de bolsa\ncompra;2026-03-02;WALMEX.MX;10;1.234,56;MXN;GBM\ncompra;2026-03-03;WALMEX.MX;2;60,5;MXN;GBM\n',
  'fechas DD/MM/AAAA': 'Tipo,Fecha,Clave,Títulos,Precio\nCompra,02/09/2026,NAFTRAC.MX,10,55\n',
  'split con proporción': 'Tipo,Fecha,Clave,Títulos,Precio,Proporción\nCompra,2026-01-02,NVDA,10,400\nSplit,2026-06-10,NVDA,,,4\n',
  'alias de encabezado':
    'type,date,ticker,shares,price,comisiones,currency,fx,notas\nbuy,2026-01-02,AAPL,2,230.5,1.5,USD,18.4125,mía\n',
  'punto y coma con punto decimal y miles con coma': 'Type;Date;Symbol;Quantity;Price;Currency\nBuy;02/09/2026;walmex.mx;1,000;60.5;mxn\n',
  'punto y coma de Excel en España con cifras ambiguas':
    'Tipo;Fecha;Clave;Títulos;Precio;Moneda;Tipo de cambio\nCompra;2026-01-02;AAPL;1.500;60,5;USD;17,125\n',
  'nota protegida con apóstrofo': "Tipo,Fecha,Clave,Proporción,Moneda,Nota\nSplit,2026-01-02,AAPL,2,USD,'-nota que parece fórmula\n",
  'tipo desconocido': 'Tipo,Fecha,Clave,Títulos,Precio\nRegalo,2026-01-02,X,1,1\n',
  'sin columna Tipo': 'fecha,clave\n2026-01-01,X\n2026-01-02,Y\n',
}

describe('la bienvenida y Movimientos leen igual el mismo CSV', () => {
  it.each(Object.entries(CASES))('%s', (_name, text) => {
    const { bienvenida, movimientos } = both(text)
    expect(strip(bienvenida.ok)).toEqual(strip(movimientos.ok))
    expect(bienvenida.bad).toEqual(movimientos.bad)
    expect(bienvenida.unknown).toEqual(movimientos.ignored)
  })

  it('las cifras ambiguas se leen con la marca decimal que el propio archivo deja ver', () => {
    expect(parseTransactionsCSV(CASES['punto y coma con punto decimal y miles con coma']).ok[0]).toMatchObject({ quantity: 1000, price: 60.5 })
    expect(parseTransactionsCSV(CASES['punto y coma de Excel en España con cifras ambiguas']).ok[0]).toMatchObject({
      quantity: 1500,
      price: 60.5,
      fxRate: 17.125,
    })
  })
})
