// Lógica pura de las primitivas: estado del dato, deltas y orden de tabla.
import { describeDelta } from './delta.js'
import { describeStatus } from './status.js'
import { nextSort, sortRows } from './table-sort.js'

const NOW = Date.parse('2026-09-22T20:52:00Z') // 14:52 en la Ciudad de México

describe('describeStatus', () => {
  it('al día muestra la hora si es de hoy y la fecha si no', () => {
    expect(describeStatus({ asOf: '2026-09-22T20:40:00Z', source: 'Yahoo' }, NOW)).toMatchObject({ tone: 'live', short: 'A las 14:40' })
    expect(describeStatus({ asOf: '2026-09-19', source: 'Banxico' }, NOW).short).toBe('Al 19 sep')
    expect(describeStatus({ asOf: '2025-12-31', source: 'INEGI' }, NOW).short).toBe('Al 31 dic 2025')
  })

  it('el retraso se dice en la insignia', () => {
    expect(describeStatus({ asOf: '2026-09-22T20:35:00Z', delayMinutes: 15 }, NOW)).toMatchObject({ tone: 'delayed', short: 'Retraso 15 min' })
  })

  it('stale y fallback nunca se esconden, ni juntos', () => {
    expect(describeStatus({ asOf: '2026-09-19', stale: true }, NOW)).toMatchObject({ tone: 'stale', short: 'Dato del 19 sep' })
    expect(describeStatus({ asOf: '2026-09-22T12:00:00Z', source: 'FRED', fallback: true }, NOW)).toMatchObject({ tone: 'stale', short: 'Respaldo: FRED' })
    const both = describeStatus({ asOf: '2026-09-18', source: 'FRED', fallback: true, stale: true, delayMinutes: 15 }, NOW)
    expect(both.short).toBe('Respaldo: FRED · Dato del 18 sep')
    expect(both.long).toMatch(/sustituta/)
    expect(both.long).toMatch(/último bueno/)
  })

  it('sin fecha lo dice en vez de presumir que está al día', () => {
    expect(describeStatus({ source: 'X' }, NOW)).toMatchObject({ tone: 'unknown', short: 'Sin fecha' })
    expect(describeStatus({ asOf: '2026-02-31' }, NOW)).toMatchObject({ tone: 'unknown', short: 'Sin fecha' })
  })

  it('no usa guiones largos', () => {
    const all = [
      describeStatus({ asOf: '2026-09-18', source: 'FRED', fallback: true, stale: true }, NOW),
      describeStatus({ asOf: '2026-09-22T20:35:00Z', delayMinutes: 5 }, NOW),
    ]
    for (const s of all) expect(`${s.short} ${s.long}`).not.toMatch(/[\u2013\u2014]/)
  })
})

describe('describeDelta', () => {
  it('signo y dirección salen del texto redondeado', () => {
    expect(describeDelta(0.0123)).toEqual({ text: '+1.23%', dir: 'up', missing: false })
    expect(describeDelta(-0.0045)).toEqual({ text: '−0.45%', dir: 'down', missing: false })
    expect(describeDelta(0.00001)).toEqual({ text: '0.00%', dir: 'flat', missing: false })
    expect(describeDelta(-0.00001)).toEqual({ text: '0.00%', dir: 'flat', missing: false })
  })

  it('pp, pb, dinero y número', () => {
    expect(describeDelta(0.0035, { kind: 'pp' }).text).toBe('+0.35 pp')
    expect(describeDelta(-25, { kind: 'bp' }).text).toBe('−25 pb')
    expect(describeDelta(1520.4, { kind: 'money', currency: 'USD' }).text).toBe('+$1,520.40 USD')
    expect(describeDelta(-3, { kind: 'number', decimals: 0 })).toMatchObject({ text: '−3', dir: 'down' })
  })

  it('neutral no pinta bueno ni malo, pero conserva el signo', () => {
    expect(describeDelta(0.0041, { direction: 'neutral' })).toEqual({ text: '+0.41%', dir: 'neutral', missing: false })
    expect(describeDelta(0, { direction: 'neutral' }).dir).toBe('flat')
  })

  it('faltante es s/d y plano', () => {
    expect(describeDelta(null)).toEqual({ text: 's/d', dir: 'flat', missing: true })
    expect(describeDelta(NaN, { kind: 'bp' })).toEqual({ text: 's/d', dir: 'flat', missing: true })
  })
})

describe('sortRows y nextSort', () => {
  const cols = [{ key: 'v' }, { key: 'n' }, { key: 'd', sortValue: (r) => r.d?.length ?? null }]
  const rows = [
    { id: 'a', v: 3, n: 'Ñandú', d: 'xx' },
    { id: 'b', v: null, n: 'avión', d: null },
    { id: 'c', v: -1, n: 'Árbol', d: 'x' },
    { id: 'd', v: 3, n: 'zeta', d: 'xxx' },
    { id: 'e', v: NaN, n: 'Beta', d: '' },
  ]
  const ids = (list) => list.map((r) => r.id).join('')

  it('numérico en las dos direcciones, estable y con faltantes al final', () => {
    expect(ids(sortRows(rows, cols, { key: 'v', direction: 'ascending' }))).toBe('cadbe')
    expect(ids(sortRows(rows, cols, { key: 'v', direction: 'descending' }))).toBe('adcbe')
  })

  it('texto con el orden del español (acentos y ñ)', () => {
    expect(ids(sortRows(rows, cols, { key: 'n', direction: 'ascending' }))).toBe('cbead')
  })

  it('usa sortValue y no toca el arreglo original', () => {
    const copy = [...rows]
    expect(ids(sortRows(rows, cols, { key: 'd', direction: 'descending' }))).toBe('daceb')
    expect(rows).toEqual(copy)
    expect(sortRows(rows, cols, null)).toBe(rows)
  })

  it('siguiente orden: alterna la misma columna; numérica empieza descendente', () => {
    expect(nextSort(null, { key: 'v', numeric: true })).toEqual({ key: 'v', direction: 'descending' })
    expect(nextSort(null, { key: 'n' })).toEqual({ key: 'n', direction: 'ascending' })
    expect(nextSort({ key: 'n', direction: 'ascending' }, { key: 'n' })).toEqual({ key: 'n', direction: 'descending' })
    expect(nextSort({ key: 'n', direction: 'descending' }, { key: 'v', numeric: true })).toEqual({ key: 'v', direction: 'descending' })
  })
})
