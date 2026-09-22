// Prueba mínima del proyecto "node": confirma entorno, globals y storage en memoria.
import { MemoryStorage } from './setup.js'

describe('entorno node', () => {
  it('corre sin DOM', () => {
    expect(typeof document).toBe('undefined')
  })

  it('trae localStorage y sessionStorage utilizables', () => {
    localStorage.setItem('k', 'v')
    sessionStorage.setItem('k', 'w')
    expect(localStorage.getItem('k')).toBe('v')
    expect(sessionStorage.getItem('k')).toBe('w')
  })

  it('el storage queda vacío entre pruebas', () => {
    expect(localStorage.getItem('k')).toBeNull()
    expect(localStorage.length).toBe(0)
  })

  it('MemoryStorage guarda todo como texto', () => {
    const s = new MemoryStorage()
    s.setItem('n', 42)
    expect(s.getItem('n')).toBe('42')
    expect(s.key(0)).toBe('n')
    s.removeItem('n')
    expect(s.getItem('n')).toBeNull()
  })
})
