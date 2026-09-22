import {
  MINUS,
  MISSING,
  NOT_MEANINGFUL,
  NOT_MEANINGFUL_TITLE,
  describeMultiple,
  fmtBp,
  fmtDate,
  fmtDateTime,
  fmtInt,
  fmtMoney,
  fmtMultiple,
  fmtNumber,
  fmtPct,
  fmtPp,
  fmtRelative,
  isNum,
  signOf,
} from './format.js'

const M = '\u2212'

describe('constantes', () => {
  it('el menos es U+2212 y el faltante es s/d', () => {
    expect(MINUS).toBe(M)
    expect(MINUS.codePointAt(0)).toBe(0x2212)
    expect(MISSING).toBe('s/d')
  })
})

describe('faltantes', () => {
  const missing = [null, undefined, NaN, Infinity, -Infinity, '', '  ', 'abc', {}, [], true]
  it.each(missing.map((v) => [v]))('%s → s/d en todos los formatos', (v) => {
    expect(fmtNumber(v)).toBe('s/d')
    expect(fmtMoney(v, 'MXN')).toBe('s/d')
    expect(fmtPct(v)).toBe('s/d')
    expect(fmtPp(v)).toBe('s/d')
    expect(fmtBp(v)).toBe('s/d')
    expect(fmtMultiple(v)).toBe('s/d')
    expect(fmtDate(v)).toBe('s/d')
    expect(fmtDateTime(v)).toBe('s/d')
    expect(fmtRelative(v)).toBe('s/d')
  })

  it('ningún formato produce guiones largos ni "NaN"', () => {
    const outputs = [fmtNumber(NaN), fmtMoney(undefined), fmtPct(null), fmtDate('no-es-fecha')]
    for (const out of outputs) {
      expect(out).not.toMatch(/[\u2014\u2013]|NaN|undefined/)
    }
  })
})

describe('fmtNumber', () => {
  it.each([
    [1234.5, {}, '1,234.50'],
    [1234567.891, {}, '1,234,567.89'],
    [0, {}, '0.00'],
    [-1141, {}, `${M}1,141.00`],
    [-0.004, {}, '0.00'],
    [-0.004, { sign: true }, '0.00'],
    [0.004, { sign: true }, '0.00'],
    [12.345, { decimals: 1 }, '12.3'],
    [12.35, { decimals: 1, sign: true }, '+12.4'],
    [7, { decimals: 0 }, '7'],
    ['42.5', {}, '42.50'],
  ])('%s %o → %s', (value, options, expected) => {
    expect(fmtNumber(value, options)).toBe(expected)
  })

  it.each([
    [153_900, '153.9 mil'],
    [1_200_000, '1.2 M'],
    [3_400_000_000, '3.4 mil M'],
    [2_500_000_000_000, '2.5 B'],
    [999, '999'],
    [950.44, '950.4'],
    [999.96, '1 mil'],
    [999_960, '1 M'],
    [1_000, '1 mil'],
    [-153_900, `${M}153.9 mil`],
    [12_345_678_901, '12.3 mil M'],
  ])('compacto %s → %s', (value, expected) => {
    expect(fmtNumber(value, { compact: true })).toBe(expected)
  })

  it('compacto con signo y decimales propios', () => {
    expect(fmtNumber(1_234_000, { compact: true, sign: true, decimals: 2 })).toBe('+1.23 M')
    expect(fmtNumber(0, { compact: true, sign: true })).toBe('0')
  })

  it('fmtInt agrupa sin decimales', () => {
    expect(fmtInt(12345.6)).toBe('12,346')
    expect(fmtInt(-3)).toBe(`${M}3`)
  })
})

describe('fmtMoney', () => {
  it.each([
    [1234.56, 'MXN', {}, '$1,234.56 MXN'],
    [-1141, 'USD', {}, `${M}$1,141.00 USD`],
    [0, 'MXN', {}, '$0.00 MXN'],
    [99.5, 'usd', { sign: true }, '+$99.50 USD'],
    [-99.5, 'USD', { sign: true }, `${M}$99.50 USD`],
    [1_234_567, 'MXN', { compact: true }, '$1.2 M MXN'],
    [85_000_000_000_000, 'MXN', { compact: true }, '$85 B MXN'],
    [10, 'EUR', {}, '€10.00 EUR'],
    [10, 'CHF', {}, '10.00 CHF'],
    [1.23456, 'MXN', { decimals: 4 }, '$1.2346 MXN'],
  ])('%s %s %o → %s', (value, currency, options, expected) => {
    expect(fmtMoney(value, currency, options)).toBe(expected)
  })

  it('MXN por defecto', () => {
    expect(fmtMoney(5)).toBe('$5.00 MXN')
  })

  it('usa U+2212 y no el guion ASCII', () => {
    const out = fmtMoney(-1, 'MXN')
    expect(out.startsWith(M)).toBe(true)
    expect(out).not.toContain('-')
  })
})

describe('fmtPct', () => {
  it.each([
    [0.0123, {}, '1.23%'],
    [0.0123, { sign: true }, '+1.23%'],
    [-0.0045, {}, `${M}0.45%`],
    [-0.0045, { sign: true }, `${M}0.45%`],
    [0, { sign: true }, '0.00%'],
    [-0.00001, { sign: true }, '0.00%'],
    [1.5, { decimals: 0 }, '150%'],
    [0.08601, { decimals: 1 }, '8.6%'],
    [12.3456, {}, '1,234.56%'],
  ])('%s %o → %s', (value, options, expected) => {
    expect(fmtPct(value, options)).toBe(expected)
  })
})

describe('fmtPp y fmtBp', () => {
  it.each([
    [0.0035, '+0.35 pp'],
    [-0.012, `${M}1.20 pp`],
    [0, '0.00 pp'],
  ])('fmtPp %s → %s', (value, expected) => {
    expect(fmtPp(value)).toBe(expected)
  })

  it.each([
    [12, '+12 pb'],
    [-25, `${M}25 pb`],
    [0, '0 pb'],
    [12.6, '+13 pb'],
  ])('fmtBp %s → %s', (value, expected) => {
    expect(fmtBp(value)).toBe(expected)
  })

  it('fmtBp con decimales', () => {
    expect(fmtBp(-3.25, { decimals: 1 })).toBe(`${M}3.3 pb`)
  })
})

describe('fmtMultiple', () => {
  it.each([
    [15.63, '15.6x'],
    [0, '0.0x'],
    [1234.5, '1,234.5x'],
    [-4.2, NOT_MEANINGFUL],
  ])('%s → %s', (value, expected) => {
    expect(fmtMultiple(value)).toBe(expected)
  })

  it('describeMultiple da title solo para n/s', () => {
    expect(describeMultiple(-1)).toEqual({ text: 'n/s', title: NOT_MEANINGFUL_TITLE })
    expect(describeMultiple(8)).toEqual({ text: '8.0x', title: undefined })
    expect(describeMultiple(null)).toEqual({ text: 's/d', title: undefined })
  })
})

describe('fechas en America/Mexico_City', () => {
  it('fecha de calendario sin mover de zona', () => {
    expect(fmtDate('2026-09-19')).toBe('19 sep 2026')
    expect(fmtDate('2026-01-01')).toBe('1 ene 2026')
    expect(fmtDate('2026-12-31')).toBe('31 dic 2026')
    expect(fmtDate('2026-13-01')).toBe('s/d')
  })

  it('un instante se muestra con la fecha de CDMX (UTC−6)', () => {
    // 03:00 UTC del 20 de septiembre todavía es 19 de septiembre en CDMX
    expect(fmtDate('2026-09-20T03:00:00Z')).toBe('19 sep 2026')
    expect(fmtDate('2026-09-20T06:00:00Z')).toBe('20 sep 2026')
  })

  it('meses de tres letras fijos (sep, no sept)', () => {
    const months = Array.from({ length: 12 }, (_, i) => fmtDate(`2026-${String(i + 1).padStart(2, '0')}-15`).split(' ')[1])
    expect(months).toEqual(['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'])
  })

  it('fecha y hora de 24 h en CDMX', () => {
    expect(fmtDateTime('2026-09-19T20:05:00Z')).toBe('19 sep 2026, 14:05')
    expect(fmtDateTime('2026-09-20T05:59:00Z')).toBe('19 sep 2026, 23:59')
    expect(fmtDateTime('2026-09-20T06:00:00Z')).toBe('20 sep 2026, 00:00')
    expect(fmtDateTime(Date.UTC(2026, 0, 1, 18, 0))).toBe('1 ene 2026, 12:00')
    expect(fmtDateTime(new Date('2026-09-19T20:05:00-06:00'))).toBe('19 sep 2026, 20:05')
  })

  it('acepta Date inválido como faltante', () => {
    expect(fmtDate(new Date('x'))).toBe('s/d')
  })

  it('una fecha de calendario que no existe da s/d, no la corre al mes siguiente', () => {
    // new Date('2026-02-31') da el 3 de marzo: dibujarla sería inventar un dato.
    expect(fmtDate('2026-02-31')).toBe('s/d')
    expect(fmtDate('2025-02-29')).toBe('s/d')
    expect(fmtDate('2026-04-31')).toBe('s/d')
    expect(fmtDate('2026-06-31')).toBe('s/d')
    expect(fmtDate('2026-00-10')).toBe('s/d')
    expect(fmtDate('2026-13-01')).toBe('s/d')
    expect(fmtDate('2026-09-00')).toBe('s/d')
    expect(fmtDate('2026-09-32')).toBe('s/d')
  })

  it('los años bisiestos de verdad sí pasan', () => {
    expect(fmtDate('2024-02-29')).toBe('29 feb 2024')
    expect(fmtDate('2000-02-29')).toBe('29 feb 2000')
    expect(fmtDate('1900-02-29')).toBe('s/d')
  })

  it('fmtDateTime y fmtRelative usan la misma validación estricta', () => {
    expect(fmtDateTime('2026-02-31')).toBe('s/d')
    expect(fmtRelative('2026-02-31', Date.UTC(2026, 8, 19))).toBe('s/d')
    expect(fmtDateTime('2026-02-28')).toBe('27 feb 2026, 18:00')
  })

  // Las fechas del API (meta.asOf entre otras) llegan como instantes ISO completos: la validación
  // tiene que mirar el prefijo YYYY-MM-DD aunque la cadena siga con la hora.
  it('un instante ISO con fecha imposible también da s/d', () => {
    expect(fmtDateTime('2026-02-31T10:00:00Z')).toBe('s/d')
    expect(fmtDate('2026-02-30T00:00:00Z')).toBe('s/d')
    expect(fmtDate('2026-02-31T10:00:00-06:00')).toBe('s/d')
    expect(fmtDateTime('2025-02-29T12:00:00Z')).toBe('s/d')
    expect(fmtDateTime('2026-04-31T12:00:00Z')).toBe('s/d')
    expect(fmtRelative('2026-02-31T10:00:00Z', Date.parse('2026-03-03T10:00:00Z'))).toBe('s/d')
  })

  it('los instantes ISO buenos siguen pasando', () => {
    expect(fmtDateTime('2026-09-19T14:05:00Z')).toBe('19 sep 2026, 08:05')
    expect(fmtDate('2024-02-29T18:00:00Z')).toBe('29 feb 2024')
    expect(fmtDateTime('2026-09-19T14:05:00.250Z')).toBe('19 sep 2026, 08:05')
    expect(fmtRelative('2026-09-22T14:55:00Z', Date.parse('2026-09-22T15:00:00Z'))).toBe('hace 5 min')
  })
})

describe('fmtRelative', () => {
  const now = Date.parse('2026-09-22T15:00:00Z')
  it.each([
    ['2026-09-22T14:59:40Z', 'hace unos segundos'],
    ['2026-09-22T14:55:00Z', 'hace 5 min'],
    ['2026-09-22T14:59:00Z', 'hace 1 min'],
    ['2026-09-22T12:00:00Z', 'hace 3 h'],
    ['2026-09-21T15:00:00Z', 'hace 1 día'],
    ['2026-09-19T15:00:00Z', 'hace 3 días'],
    ['2026-09-22T15:05:00Z', 'en 5 min'],
    ['2026-09-22T15:00:10Z', 'en unos segundos'],
    ['2026-07-01T15:00:00Z', '1 jul 2026'],
  ])('%s → %s', (iso, expected) => {
    expect(fmtRelative(iso, now)).toBe(expected)
  })

  it('acepta now como Date', () => {
    expect(fmtRelative('2026-09-22T14:30:00Z', new Date(now))).toBe('hace 30 min')
  })
})

describe('signOf', () => {
  it.each([
    [1, 'up'],
    [-0.0001, 'down'],
    [0, 'flat'],
    [null, 'flat'],
    [NaN, 'flat'],
  ])('%s → %s', (value, expected) => {
    expect(signOf(value)).toBe(expected)
  })

  it('epsilon trata lo casi cero como plano', () => {
    expect(signOf(0.00001, 0.0001)).toBe('flat')
    expect(signOf(-0.001, 0.0001)).toBe('down')
  })
})

describe('isNum', () => {
  it('solo números finitos', () => {
    expect(isNum(1)).toBe(true)
    expect(isNum(0)).toBe(true)
    expect(isNum(NaN)).toBe(false)
    expect(isNum('1')).toBe(false)
  })
})
