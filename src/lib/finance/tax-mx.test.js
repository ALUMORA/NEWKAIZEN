import { readFileSync } from 'node:fs'
import {
  DIVIDEND_WITHHOLDING_RATE,
  ISR_GAINS_RATE,
  dividendWithholding,
  inpcFactor,
  isrOnGains,
} from './tax-mx.js'

const golden = JSON.parse(readFileSync(new URL('../../../tests/golden/tax-mx.json', import.meta.url), 'utf8'))

describe('isrOnGains: respuesta conocida del spec', () => {
  it('costo 550 actualizado por 1.05 contra 650 de venta da 7.25 de impuesto', () => {
    const out = isrOnGains({
      sales: [{ proceeds: 650, cost: 550, costDate: '2026-01-15', saleDate: '2026-09-20' }],
      inpc: { '2026-01': 100, '2026-08': 105 },
    })
    expect(out.detail[0].factor).toBeCloseTo(1.05, 12)
    expect(out.detail[0].indexedCost).toBeCloseTo(577.5, 9)
    expect(out.gain).toBeCloseTo(72.5, 9)
    expect(out.taxableGain).toBeCloseTo(72.5, 9)
    expect(out.tax).toBeCloseTo(7.25, 9)
    expect(out.lossCarry).toBe(0)
  })

  it('el factor se puede capturar directo y da lo mismo', () => {
    const out = isrOnGains({ sales: [{ proceeds: 650, cost: 550, factor: 1.05, saleDate: '2026-09-20' }] })
    expect(out.tax).toBeCloseTo(7.25, 9)
    expect(out.detail[0].indexed).toBe(true)
  })

  it('la tasa es 10 %', () => {
    expect(ISR_GAINS_RATE).toBe(0.1)
    expect(DIVIDEND_WITHHOLDING_RATE).toBe(0.1)
  })
})

describe('inpcFactor', () => {
  it('usa el mes anterior a la venta contra el mes de la compra', () => {
    const out = inpcFactor({
      costDate: '2026-01-15',
      saleDate: '2026-09-20',
      inpc: { '2026-01': 100, '2026-08': 105 },
    })
    expect(out).toMatchObject({ applied: true, from: '2026-01', to: '2026-08', reason: null })
    expect(out.factor).toBeCloseTo(1.05, 12)
  })

  it('en enero el mes anterior es diciembre del año pasado', () => {
    const out = inpcFactor({
      costDate: '2025-03-02',
      saleDate: '2026-01-20',
      inpc: { '2025-03': 130, '2025-12': 136.5 },
    })
    expect(out.to).toBe('2025-12')
    expect(out.factor).toBeCloseTo(1.05, 12)
  })

  it('sin INPC no actualiza y dice por qué', () => {
    const out = inpcFactor({ costDate: '2026-01-15', saleDate: '2026-09-20', inpc: {} })
    expect(out).toMatchObject({ factor: 1, applied: false })
    expect(out.reason).toContain('Falta el INPC')
  })

  it('sin fechas tampoco actualiza', () => {
    expect(inpcFactor({ costDate: null, saleDate: '2026-09-20', inpc: {} })).toMatchObject({ factor: 1, applied: false })
    expect(inpcFactor({ costDate: '2026-01-15', saleDate: null, inpc: {} })).toMatchObject({ factor: 1, applied: false })
  })

  it('vender el mismo mes de la compra no actualiza', () => {
    const out = inpcFactor({
      costDate: '2026-05-04',
      saleDate: '2026-05-28',
      inpc: { '2026-04': 100, '2026-05': 101 },
    })
    expect(out).toMatchObject({ factor: 1, applied: false })
  })
})

describe('pérdidas, arrastre y ejercicios', () => {
  const inpc = { '2026-01': 100, '2026-02': 100, '2026-08': 100, '2026-11': 100, '2027-02': 100 }

  it('las pérdidas restan a las ganancias del mismo ejercicio', () => {
    const out = isrOnGains({
      sales: [
        { proceeds: 20000, cost: 12000, costDate: '2026-01-02', saleDate: '2026-03-10' },
        { proceeds: 4000, cost: 9000, costDate: '2026-01-02', saleDate: '2026-09-30' },
      ],
      inpc,
    })
    expect(out.gain).toBeCloseTo(3000, 9)
    expect(out.taxableGain).toBeCloseTo(3000, 9)
    expect(out.tax).toBeCloseTo(300, 9)
    expect(out.years).toHaveLength(1)
  })

  it('la pérdida de un ejercicio se arrastra al siguiente', () => {
    const out = isrOnGains({
      sales: [
        { proceeds: 5000, cost: 14000, costDate: '2026-01-02', saleDate: '2026-04-10' },
        { proceeds: 31000, cost: 20000, costDate: '2026-02-02', saleDate: '2027-03-15' },
      ],
      inpc,
    })
    expect(out.years.map((y) => y.year)).toEqual(['2026', '2027'])
    expect(out.years[0]).toMatchObject({ taxableGain: 0, tax: 0 })
    expect(out.years[0].lossCarry).toBeCloseTo(9000, 9)
    expect(out.years[1].lossUsed).toBeCloseTo(9000, 9)
    expect(out.years[1].taxableGain).toBeCloseTo(2000, 9)
    expect(out.tax).toBeCloseTo(200, 9)
  })

  it('una pérdida de ejercicios anteriores entra como lossCarryIn', () => {
    const out = isrOnGains({
      sales: [{ proceeds: 90000, cost: 60000, costDate: '2026-01-02', saleDate: '2026-12-15' }],
      inpc,
      lossCarryIn: 12000,
    })
    expect(out.taxableGain).toBeCloseTo(18000, 9)
    expect(out.tax).toBeCloseTo(1800, 9)
    expect(out.lossCarry).toBe(0)
  })

  it('si todo fue pérdida no hay impuesto y queda saldo por amortizar', () => {
    const out = isrOnGains({
      sales: [{ proceeds: 1000, cost: 4000, costDate: '2026-01-02', saleDate: '2026-12-15' }],
      inpc,
    })
    expect(out.tax).toBe(0)
    expect(out.taxableGain).toBe(0)
    expect(out.lossCarry).toBeCloseTo(3000, 9)
    expect(out.notes.join(' ')).toContain('pérdida pendiente de amortizar')
  })
})

describe('avisos y texto', () => {
  it('siempre dice que es una estimación y cita el art. 129', () => {
    const out = isrOnGains({ sales: [] })
    expect(out.notes[0]).toContain('estimación')
    expect(out.notes[1]).toContain('art. 129')
  })

  it('avisa cuando no pudo actualizar el costo', () => {
    const out = isrOnGains({ sales: [{ proceeds: 650, cost: 550, costDate: '2026-01-15', saleDate: '2026-09-20' }] })
    expect(out.gain).toBeCloseTo(100, 9)
    expect(out.notes.join(' ')).toContain('no se actualizó el costo')
  })

  it('ningún aviso lleva guiones largos', () => {
    const out = isrOnGains({
      sales: [
        { proceeds: 1000, cost: 4000, saleDate: null },
        { proceeds: 'x', cost: 1 },
      ],
      lossCarryIn: 0,
    })
    for (const note of out.notes) expect(note).not.toMatch(/[—–]/)
    for (const note of dividendWithholding(100).notes) expect(note).not.toMatch(/[—–]/)
  })

  it('no usa lenguaje de recomendación', () => {
    const texto = [...isrOnGains({ sales: [] }).notes, ...dividendWithholding(100).notes].join(' ').toLowerCase()
    expect(texto).not.toMatch(/recomendamos|te conviene|deberías|conviene (comprar|vender)|\bcompra ahora\b/)
    // la palabra "recomendación" solo aparece negada
    expect(texto).not.toMatch(/(?<!no es una |ni una )recomendación/)
  })
})

describe('casos de borde', () => {
  it('sin ventas devuelve ceros, no null', () => {
    const out = isrOnGains({ sales: [] })
    expect(out).toMatchObject({ gain: 0, taxableGain: 0, tax: 0, lossCarry: 0 })
    expect(out.years).toEqual([])
  })

  it('devuelve null si sales no es un arreglo', () => {
    expect(isrOnGains({ sales: null })).toBeNull()
    expect(isrOnGains({})).toBeNull()
  })

  it('descarta las ventas con montos que no son números', () => {
    const out = isrOnGains({
      sales: [
        { proceeds: Number.NaN, cost: 100, saleDate: '2026-01-01' },
        { proceeds: 100, cost: '50', saleDate: '2026-01-01' },
        { proceeds: 200, cost: 100, factor: 1, saleDate: '2026-01-01' },
      ],
    })
    expect(out.dropped).toHaveLength(2)
    expect(out.gain).toBeCloseTo(100, 9)
    expect(out.notes.join(' ')).toContain('Se descartaron 2 ventas')
  })

  it('las ventas sin fecha van a un grupo aparte', () => {
    const out = isrOnGains({ sales: [{ proceeds: 200, cost: 100, saleDate: null }] })
    expect(out.years[0].year).toBe('sin fecha')
    expect(out.notes.join(' ')).toContain('no traen fecha')
  })

  it('una venta en cero no rompe nada', () => {
    const out = isrOnGains({ sales: [{ proceeds: 0, cost: 0, factor: 1, saleDate: '2026-01-01' }] })
    expect(out.tax).toBe(0)
  })
})

describe('dividendWithholding', () => {
  it('retiene el 10 % e informa el neto', () => {
    const out = dividendWithholding(1000)
    expect(out.withholding).toBeCloseTo(100, 9)
    expect(out.net).toBeCloseTo(900, 9)
    expect(out.notes[0]).toContain('estimación')
  })

  it('devuelve null si el monto no es número', () => {
    expect(dividendWithholding(Number.NaN)).toBeNull()
    expect(dividendWithholding(undefined)).toBeNull()
  })
})

describe('golden contra la referencia en Python (Decimal de 28 dígitos)', () => {
  it.each(golden.cases.map((c) => [c.name, c]))('%s', (_name, testCase) => {
    const out = isrOnGains(testCase.input)
    expect(out).not.toBeNull()
    for (const key of ['gain', 'taxableGain', 'tax', 'lossCarry']) {
      expect(Math.abs(out[key] - testCase.expected[key])).toBeLessThan(testCase.tol)
    }
    expect(out.years).toHaveLength(testCase.expected.years.length)
    out.years.forEach((year, i) => {
      const want = testCase.expected.years[i]
      expect(year.year).toBe(want.year)
      for (const key of ['gain', 'taxableGain', 'tax', 'lossUsed', 'lossCarry']) {
        expect(Math.abs(year[key] - want[key])).toBeLessThan(testCase.tol)
      }
    })
    out.detail.forEach((row, i) => {
      const want = testCase.expected.detail[i]
      expect(row.indexed).toBe(want.indexed)
      expect(Math.abs(row.factor - want.factor)).toBeLessThan(testCase.tol)
      expect(Math.abs(row.gain - want.gain)).toBeLessThan(testCase.tol)
    })
  })

  it('el golden trae el caso del spec', () => {
    expect(golden.cases.map((c) => c.name)).toContain('caso-conocido-factor-1.05')
    expect(golden.cases.length).toBeGreaterThanOrEqual(8)
  })
})
