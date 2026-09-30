import { describe, expect, it } from 'vitest'
import { checkNewSymbol } from './add-symbol.js'

describe('checkNewSymbol: la clave que se escribe a mano en la lista de seguimiento', () => {
  it('normaliza a mayúsculas y sin espacios', () => {
    expect(checkNewSymbol([], '  walmex.mx ')).toEqual({ symbol: 'WALMEX.MX', error: null })
    expect(checkNewSymbol(['AAPL'], '^mxx')).toEqual({ symbol: '^MXX', error: null })
  })
  it('una repetida lo dice, sin importar mayúsculas', () => {
    expect(checkNewSymbol(['WALMEX.MX'], 'walmex.mx')).toEqual({ symbol: null, error: 'WALMEX.MX ya está en tu lista.' })
  })
  it('lo que no es clave lo dice', () => {
    for (const raw of ['', '   ', 'no es clave', 'ABC/DEF', 'X'.repeat(21)]) {
      expect(checkNewSymbol([], raw)).toEqual({ symbol: null, error: 'Escribe una clave válida, por ejemplo WALMEX.MX o AAPL.' })
    }
  })
})
