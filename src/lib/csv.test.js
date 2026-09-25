import { BOM, csvCell, detectDelimiter, objectsToCSV, parseCSV, parseLocaleNumber, rowsToObjects, toCSV } from './csv.js'

describe('csvCell', () => {
  it.each([
    [null, ''],
    [undefined, ''],
    [12.5, '12.5'],
    [-5, '-5'],
    [NaN, ''],
    ['AAPL', 'AAPL'],
    ['a,b', '"a,b"'],
    ['dijo "hola"', '"dijo ""hola"""'],
    ['línea 1\nlínea 2', '"línea 1\nlínea 2"'],
    ['a;b', '"a;b"'],
    [' espacio', '" espacio"'],
    [new Date('2026-09-22T00:00:00Z'), '2026-09-22T00:00:00.000Z'],
  ])('%o → %s', (value, expected) => {
    expect(csvCell(value)).toBe(expected)
  })

  it.each([
    ['=SUM(A1:A9)', "'=SUM(A1:A9)"],
    ['+52 55 1234', "'+52 55 1234"],
    ['-1+1', "'-1+1"],
    ['@SUM(1)', "'@SUM(1)"],
    ['\t=1', "'\t=1"],
    ["'=1", "''=1"],
    ['=HYPERLINK("http://x","clic")', '"\'=HYPERLINK(""http://x"",""clic"")"'],
  ])('neutraliza la fórmula %s', (value, expected) => {
    expect(csvCell(value)).toBe(expected)
  })

  it('no toca números negativos reales', () => {
    expect(csvCell(-1141.5)).toBe('-1141.5')
  })
})

describe('toCSV', () => {
  it('lleva BOM y CRLF', () => {
    const out = toCSV([
      ['Símbolo', 'Cantidad'],
      ['AAPL', 10],
    ])
    expect(out.startsWith(BOM)).toBe(true)
    expect(out).toBe(`${BOM}Símbolo,Cantidad\r\nAAPL,10\r\n`)
  })

  it('sin BOM y con punto y coma', () => {
    expect(toCSV([['a', 'b;c']], { bom: false, delimiter: ';' })).toBe('a;"b;c"\r\n')
  })

  it('objectsToCSV con columnas por llave o función', () => {
    const out = objectsToCSV(
      [{ s: 'AAPL', q: 2, p: 10 }],
      [
        { key: 's', label: 'Símbolo' },
        { key: (r) => r.q * r.p, label: 'Total' },
      ],
      { bom: false },
    )
    expect(out).toBe('Símbolo,Total\r\nAAPL,20\r\n')
  })
})

describe('parseCSV', () => {
  it('quita el BOM y acepta CRLF y LF', () => {
    expect(parseCSV(`${BOM}a,b\r\n1,2\n3,4`)).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ])
  })

  it('comillas, comillas escapadas y saltos de línea dentro de comillas', () => {
    expect(parseCSV('"a,b","dijo ""sí""","x\ny"\r\n')).toEqual([['a,b', 'dijo "sí"', 'x\ny']])
  })

  it('celdas vacías y fila final sin salto', () => {
    expect(parseCSV('a,,c\n,,')).toEqual([
      ['a', '', 'c'],
      ['', '', ''],
    ])
  })

  it('omite líneas vacías por defecto', () => {
    expect(parseCSV('a\n\n\nb\n')).toEqual([['a'], ['b']])
    expect(parseCSV('a\n\nb', { skipEmptyLines: false })).toEqual([['a'], [''], ['b']])
  })

  it('detecta punto y coma y tabulador', () => {
    expect(parseCSV('a;b\n1;2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
    expect(parseCSV('a\tb\n1\t2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('texto vacío → sin filas', () => {
    expect(parseCSV('')).toEqual([])
    expect(parseCSV(BOM)).toEqual([])
  })

  it('unguard quita el apóstrofo de las fórmulas neutralizadas y nada más', () => {
    const text = toCSV([["'=1", "'normal", '=2']])
    expect(parseCSV(text)).toEqual([["''=1", "'normal", "'=2"]])
    expect(parseCSV("'=1,x", { unguard: true })).toEqual([['=1', 'x']])
    expect(parseCSV(text, { unguard: true })).toEqual([["'=1", "'normal", '=2']])
  })
})

describe('ida y vuelta', () => {
  it('parseCSV(toCSV(filas)) devuelve las mismas celdas de texto', () => {
    const rows = [
      ['Fecha', 'Símbolo', 'Nota'],
      ['2026-09-22', 'WALMEX.MX', 'compra "inicial", con coma'],
      ['2026-09-23', 'AAPL', 'varias\nlíneas\r\ny CRLF'],
      ['', 'FUNO11.MX', ' con espacios '],
      ['2026-09-24', 'NAFTRAC.MX', 'ñandú, acentos: áéíóú'],
    ]
    expect(parseCSV(toCSV(rows))).toEqual(rows)
  })

  it('con fórmulas, la ida y vuelta con unguard recupera el texto original', () => {
    const rows = [['=1+1', '+5', '-3', '@x', 'ok', "'=ya con apóstrofo", "''+dos"]]
    expect(parseCSV(toCSV(rows), { unguard: true })).toEqual(rows)
  })

  it('rowsToObjects usa la primera fila como encabezado', () => {
    expect(rowsToObjects(parseCSV(' Símbolo ,Cantidad\nAAPL,10\nMSFT'))).toEqual([
      { Símbolo: 'AAPL', Cantidad: '10' },
      { Símbolo: 'MSFT', Cantidad: '' },
    ])
    expect(rowsToObjects([])).toEqual([])
  })
})

describe('detectDelimiter y parseLocaleNumber (revisión RT)', () => {
  it('reconoce el punto y coma de Excel en español', () => {
    expect(detectDelimiter('Tipo;Fecha;Precio\ncompra;2026-01-02;1234,56')).toBe(';')
    expect(detectDelimiter('Tipo,Fecha\ncompra,2026-01-02')).toBe(',')
  })

  it.each([
    ['1234.56', {}, 1234.56],
    ['1,234.56', {}, 1234.56],
    ['$1,060.50', {}, 1060.5],
    ['1.234,56', {}, 1234.56],
    ['1234,56', {}, 1234.56],
    ['1,234', {}, 1234],
    ['1.234.567', {}, 1234567],
    ['1.234.567,5', {}, 1234567.5],
    ['−12,5', {}, -12.5],
    ['1 234,56', {}, 1234.56],
    ['1234,56', { decimalComma: true }, 1234.56],
    ['1,5', { decimalComma: true }, 1.5],
    ['1.234', { decimalComma: true }, 1234],
    ['1.234,56', { decimalComma: true }, 1234.56],
    ['12', {}, 12],
  ])('%s %o → %d', (text, opts, expected) => {
    expect(parseLocaleNumber(text, opts)).toBeCloseTo(expected, 10)
  })

  it('vacío es null y lo que no es número es NaN', () => {
    expect(parseLocaleNumber('')).toBeNull()
    expect(parseLocaleNumber('  ')).toBeNull()
    expect(parseLocaleNumber(null)).toBeNull()
    expect(parseLocaleNumber('abc')).toBeNaN()
    expect(parseLocaleNumber('1,2,3')).toBeNaN()
    expect(parseLocaleNumber('1,5', { decimalComma: true })).toBe(1.5)
    expect(parseLocaleNumber('1,2,3', { decimalComma: true })).toBeNaN()
  })
})
