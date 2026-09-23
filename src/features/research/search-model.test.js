import { describe, expect, it } from 'vitest'
import { marketLabel, pickSymbol, statusText, typeLabel } from './search-model.js'

const walmex = { symbol: 'WALMEX.MX', name: 'Wal-Mart de México' }
const apple = { symbol: 'AAPL', name: 'Apple Inc.' }

describe('search-model', () => {
  it('typeLabel en español, con respaldo', () => {
    expect(typeLabel('equity')).toBe('Acción')
    expect(typeLabel('fibra')).toBe('FIBRA')
    expect(typeLabel('commodity')).toBe('Materia prima')
    expect(typeLabel('otra-cosa')).toBe('Otro')
    expect(typeLabel(null)).toBe('Otro')
  })

  it('pickSymbol: coincidencia de clave, luego el primer resultado, luego lo tecleado', () => {
    expect(pickSymbol('walmex', [apple, walmex])).toBe('WALMEX.MX')
    expect(pickSymbol('walmart', [walmex, apple])).toBe('WALMEX.MX')
    expect(pickSymbol('msft', [])).toBe('MSFT')
    expect(pickSymbol('wal mart', [])).toBeNull()
    expect(pickSymbol('  ', [walmex])).toBeNull()
  })

  it('marketLabel junta bolsa y moneda, s/d si falta todo', () => {
    expect(marketLabel({ exchange: 'BMV', currency: 'MXN' })).toBe('BMV · MXN')
    expect(marketLabel({ exchange: null, currency: 'USD' })).toBe('USD')
    expect(marketLabel({ exchange: null, currency: null })).toBe('s/d')
  })

  it('statusText para la región viva', () => {
    expect(statusText({ q: '', searching: false, count: null })).toBe('')
    expect(statusText({ q: 'wal', searching: true, count: null })).toBe('Buscando…')
    expect(statusText({ q: 'wal', searching: false, count: 1 })).toBe('1 resultado para “wal”.')
    expect(statusText({ q: 'wal', searching: false, count: 3 })).toBe('3 resultados para “wal”.')
    expect(statusText({ q: 'zzz', searching: false, count: 0 })).toBe('Sin resultados para “zzz”.')
    expect(statusText({ q: 'wal', searching: false, count: null, failed: true })).toBe('No pudimos buscar en este momento.')
  })
})
