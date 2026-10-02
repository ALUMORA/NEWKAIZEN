import { describe, expect, it } from 'vitest'
import { buildIcs, escapeText, icsInstant } from './ics.js'
import { countdownText, fmtEventValue, fmtIndicator, fmtWorld, groupByDay, mondayOf, parseAnchor, parseCountries, shiftAnchor, windowFor } from './model.js'

const decision = {
  id: 'banxico-decision-2026-11-05', country: 'MX', kind: 'decision', title: 'Decisión de política monetaria de Banxico', period: null,
  date: '2026-11-05', timeLocal: '13:00', datetimeUtc: '2026-11-05T19:00:00Z', source: 'curated', seriesId: 'SF61745', unit: 'fraction',
  previous: 0.07, actual: null, consensus: null,
}

describe('ics', () => {
  it('la decisión del 5 nov a las 13:00 hora del centro sale DTSTART:20261105T190000Z', () => {
    const text = buildIcs([decision], { now: new Date('2026-10-01T12:00:00Z') })
    expect(text).toContain('DTSTART:20261105T190000Z')
    expect(text).toContain('DTEND:20261105T193000Z')
    expect(text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(text.trimEnd().endsWith('END:VCALENDAR')).toBe(true)
  })
  it('un evento sin hora va como día completo', () => {
    const text = buildIcs([{ ...decision, id: 'x', timeLocal: null, datetimeUtc: null, date: '2026-12-31' }])
    expect(text).toContain('DTSTART;VALUE=DATE:20261231')
    expect(text).toContain('DTEND;VALUE=DATE:20270101')
  })
  it('escapa comas y punto y coma', () => {
    expect(escapeText('a, b; c')).toBe('a\\, b\\; c')
    expect(icsInstant('2026-10-14T12:30:00Z')).toBe('20261014T123000Z')
  })
})

describe('semanas y meses', () => {
  it('lunes y ventanas', () => {
    expect(mondayOf('2026-10-01')).toBe('2026-09-28')
    expect(windowFor('semana', '2026-10-01')).toEqual({ start: '2026-09-28', end: '2026-10-04' })
    expect(windowFor('mes', '2026-02-10')).toEqual({ start: '2026-02-01', end: '2026-02-28' })
    expect(shiftAnchor('semana', '2026-10-01', 1)).toBe('2026-10-05')
    expect(shiftAnchor('mes', '2026-12-15', 1)).toBe('2027-01-01')
  })
  it('lee la URL sin romperse', () => {
    expect(parseAnchor('2026-02-31', '2026-10-01')).toBe('2026-10-01')
    expect(parseAnchor('2026-11-02', '2026-10-01')).toBe('2026-11-02')
    expect(parseCountries('us')).toEqual(['us'])
    expect(parseCountries('xx')).toEqual(['mx', 'us'])
  })
  it('agrupa por día en orden', () => {
    const groups = groupByDay([{ ...decision, date: '2026-11-06' }, decision])
    expect(groups.map((g) => g.date)).toEqual(['2026-11-05', '2026-11-06'])
  })
})

describe('formatos', () => {
  it('por unidad, con s/d y signo menos', () => {
    expect(fmtEventValue(0.0326, 'fraction')).toBe('3.26%')
    expect(fmtEventValue(122, 'thousandsPersons')).toBe('+122 mil')
    expect(fmtEventValue(-35, 'thousandsPersons')).toBe('−35 mil')
    expect(fmtEventValue(null, 'fraction')).toBe('s/d')
    expect(fmtIndicator(0.041, 'fraction')).toBe('4.10%')
    expect(fmtWorld(null, 'fraction')).toBe('s/d')
    expect(fmtWorld(0.038067, 'fraction')).toBe('3.8%')
    expect(countdownText(35)).toBe('35 días')
    expect(countdownText(0)).toBe('Hoy')
  })
})
