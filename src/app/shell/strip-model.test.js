import { mergeMeta, stripItems } from './strip-model.js'

const overview = {
  groups: [
    { id: 'mx', label: 'México', items: [{ symbol: '^MXX', label: 'S&P/BMV IPC', price: 61234.5, change: 300, changePct: 0.0049, currency: 'MXN', asOf: '2026-09-22' }] },
    {
      id: 'us',
      label: 'Estados Unidos',
      items: [
        { symbol: '^GSPC', label: 'S&P 500', price: 6650.1, change: -20, changePct: -0.003, currency: 'USD', asOf: '2026-09-22' },
        { symbol: '^VIX', label: 'VIX', price: 15.2, change: 0.4, changePct: 0.027, currency: null, asOf: '2026-09-22' },
      ],
    },
    { id: 'fx', label: 'Divisas', items: [{ symbol: 'USDMXN=X', label: 'Dólar frente al peso', price: 18.4321, change: 0.05, changePct: 0.0027, currency: 'MXN', asOf: '2026-09-22' }] },
  ],
}
const rates = { items: [{ id: 'cetes28', label: 'CETES 28', value: 0.0725, unit: 'fraction', changeBp: -5, asOf: '2026-09-18' }] }

describe('stripItems', () => {
  it('cinco cifras en el orden del brief', () => {
    expect(stripItems(overview, rates).map((i) => i.label)).toEqual(['IPC', 'S&P 500', 'USD/MXN', 'CETES 28', 'VIX'])
  })

  it('USD/MXN, CETES y VIX van en neutral; el peso más débil se dice con texto', () => {
    const by = Object.fromEntries(stripItems(overview, rates).map((i) => [i.id, i]))
    expect(by.ipc.direction).toBe('auto')
    expect(by.usdmxn).toMatchObject({ direction: 'neutral', hint: 'peso más débil', value: 18.4321 })
    expect(by.cetes28).toMatchObject({ direction: 'neutral', changeKind: 'bp', change: -5 })
    expect(by.cetes28.value).toBeCloseTo(7.25)
    expect(by.vix.direction).toBe('neutral')
  })

  it('sin datos: valores nulos, sin romperse', () => {
    const items = stripItems(undefined, undefined)
    expect(items).toHaveLength(5)
    expect(items.every((i) => i.value === null && i.change === null)).toBe(true)
  })
})

describe('mergeMeta', () => {
  it('toma la fecha más vieja, junta fuentes y avisos', () => {
    const m = mergeMeta(
      { asOf: '2026-09-22T14:00:00Z', source: 'yahoo', delayMinutes: 15, stale: false, fallback: false },
      { asOf: '2026-09-18', source: 'banxico', delayMinutes: null, stale: false, fallback: true },
    )
    expect(m).toEqual({ asOf: '2026-09-18', source: 'yahoo, banxico', delayMinutes: 15, stale: false, fallback: true })
  })
  it('null sin respuestas', () => {
    expect(mergeMeta(undefined, null)).toBeNull()
  })
})
