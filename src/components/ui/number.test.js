import { formatForInput, parseNumber, sameNumber } from './number.js'

describe('parseNumber (es-MX)', () => {
  it.each([
    ['1,234.56', 1234.56],
    ['1234.56', 1234.56],
    ['12,345,678', 12345678],
    ['−1,141.00', -1141],
    ['-1,141', -1141],
    ['+3.5', 3.5],
    ['$ 2 500', 2500],
    ['$1,000.5', 1000.5],
    ['-$20', -20],
    ['1 234.5', 1234.5],
    ['0,375', 0.375],
    ['1,5', 1.5],
    ['1,2345', 1.2345],
    ['.5', 0.5],
    ['0', 0],
    [7, 7],
  ])('%s → %s', (input, expected) => {
    expect(parseNumber(input)).toBe(expected)
  })

  it.each(['', ' ', '-', 'abc', '1,23,4', '1.2.3', '12a', NaN, Infinity, null, undefined, {}])('%s → null', (input) => {
    expect(parseNumber(input)).toBeNull()
  })
})

describe('formatForInput', () => {
  it('agrupa, usa el menos tipográfico y deja vacío lo faltante', () => {
    expect(formatForInput(1234.5, 2)).toBe('1,234.50')
    expect(formatForInput(-1141, 2)).toBe('−1,141.00')
    expect(formatForInput(null)).toBe('')
    expect(formatForInput(NaN)).toBe('')
  })

  it('sin decimales pedidos conserva los que trae el número', () => {
    expect(formatForInput(1234.567)).toBe('1,234.567')
    expect(formatForInput(1000)).toBe('1,000')
  })

  it('lo que formatea se vuelve a leer igual', () => {
    for (const v of [0, 1, -1, 1234.5, -987654.321, 0.0001]) expect(parseNumber(formatForInput(v))).toBe(v)
  })
})

describe('sameNumber', () => {
  it('compara el texto leído contra el valor', () => {
    expect(sameNumber('1,234', 1234)).toBe(true)
    expect(sameNumber('1,2', 1234)).toBe(false)
    expect(sameNumber('', null)).toBe(true)
  })
})
