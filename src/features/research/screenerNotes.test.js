import { describe, expect, it } from 'vitest'
import { ebitFallbackSymbols, generalNotes, mentions, notesFor, readableMeta, sourceLabel } from './screenerNotes.js'

// Notas con la redacción real de kaizen_api/domain/screeners/{fibras,magic}.py.
const FMTY = 'FMTY14.MX: LTV, deuda entre capitalización, cap rate y flujo van en s/d porque los estados financieros que publica Yahoo no son de esta FIBRA o ya no la describen. Yahoo la clasifica como banco (Banks - Regional); su balance es idéntico al de FHIPO14.MX, así que es el del fiduciario que comparten.'
const NAV = 'Sin NAV para calcular P/NAV: FIBRAPL14.MX.'
const GENERAL = 'Señal por P/NAV: descuento abajo de 0.90, prima arriba de 1.10 y en línea entre las dos.'

describe('mentions', () => {
  it('encuentra la clave como palabra completa, también al final de la oración', () => {
    expect(mentions(FMTY, 'FMTY14.MX')).toBe(true)
    expect(mentions(FMTY, 'FHIPO14.MX')).toBe(true)
    expect(mentions(NAV, 'FIBRAPL14.MX')).toBe(true)
  })
  it('no confunde una clave con parte de otra', () => {
    expect(mentions('XFMTY14.MX tiene datos.', 'FMTY14.MX')).toBe(false)
    expect(mentions(FMTY, 'FMTY14')).toBe(false)
    expect(mentions('AAPL y MSFT.', 'AAP')).toBe(false)
    expect(mentions('', 'AAPL')).toBe(false)
  })
})

describe('notesFor y generalNotes', () => {
  const notes = [GENERAL, FMTY, NAV]
  it('reparte las notas por emisora', () => {
    expect(notesFor('FMTY14.MX', notes)).toEqual([FMTY])
    expect(notesFor('FHIPO14.MX', notes)).toEqual([FMTY])
    expect(notesFor('FUNO11.MX', notes)).toEqual([])
    expect(notesFor('FUNO11.MX', null)).toEqual([])
  })
  it('deja como generales las que no nombran a nadie de la tabla', () => {
    expect(generalNotes(notes, ['FMTY14.MX', 'FIBRAPL14.MX'])).toEqual([GENERAL])
    expect(generalNotes(undefined, [])).toEqual([])
  })
})

describe('ebitFallbackSymbols', () => {
  it('saca las claves de la nota del EBIT de respaldo', () => {
    const note =
      'Sin utilidad de operación reportada, se usó el renglón EBIT de Yahoo (antes de impuestos más intereses), que puede incluir partidas no operativas: AMXB.MX, KOFUBL.MX.'
    expect([...ebitFallbackSymbols(['8 de 23 emisoras quedaron fuera, cada una con su motivo.', note])]).toEqual(['AMXB.MX', 'KOFUBL.MX'])
  })
  it('sin esa nota no marca a nadie', () => {
    expect(ebitFallbackSymbols([GENERAL]).size).toBe(0)
    expect(ebitFallbackSymbols(null).size).toBe(0)
  })
})

describe('sourceLabel y readableMeta', () => {
  it('pone la fuente en palabras y deja lo desconocido tal cual', () => {
    expect(sourceLabel('yahoo,computed,fred')).toBe('Yahoo Finance, cálculo de Kaizen y FRED')
    expect(sourceLabel('yahoo,computed')).toBe('Yahoo Finance y cálculo de Kaizen')
    expect(sourceLabel('fred_ir3tib')).toBe('FRED')
    expect(sourceLabel('eodhd')).toBe('eodhd')
    expect(sourceLabel(null)).toBe('')
  })
  it('conserva fecha, retraso, viejo y respaldo', () => {
    const meta = { asOf: '2026-09-22', source: 'yahoo,computed,fred', delayMinutes: 15, stale: false, fallback: true, generatedAt: 'x', notes: [] }
    expect(readableMeta(meta)).toEqual({ ...meta, source: 'Yahoo Finance, cálculo de Kaizen y FRED' })
    expect(readableMeta(meta, { source: 'FRED', asOf: '2026-08-01' })).toMatchObject({ source: 'FRED', asOf: '2026-08-01', fallback: true })
    expect(readableMeta(undefined)).toBe(undefined)
  })
})
