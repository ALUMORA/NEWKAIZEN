// La app legada no tiene pruebas unitarias propias (se cubre con el baseline visual y los e2e),
// pero su acceso a red sí se vigila aquí: todo request al backend tiene que pasar por
// authorizedFetch (src/lib/api/client.js), que manda el token de la sesión y cierra la sesión con
// un 401. Un fetch directo nuevo se saltaría las dos cosas y el API v2 le contestaría 401.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SOURCE = readFileSync(fileURLToPath(new URL('./App.legacy.jsx', import.meta.url)), 'utf8')

describe('App.legacy.jsx: acceso a red', () => {
  it('no llama a fetch directo', () => {
    const direct = SOURCE.split('\n')
      .map((line, i) => ({ line: i + 1, text: line.trim() }))
      .filter(({ text }) => /(^|[^\w.$])fetch\s*\(/.test(text))
    expect(direct).toEqual([])
  })

  it('importa authorizedFetch del cliente y lo usa', () => {
    expect(SOURCE).toMatch(/import \{ authorizedFetch \} from '\.\.\/lib\/api\/client\.js'/)
    expect(SOURCE.match(/\bauthorizedFetch\(/g)?.length ?? 0).toBeGreaterThanOrEqual(20)
  })

  it('no usa otras vías de red hacia el backend (XHR, EventSource, sendBeacon)', () => {
    expect(SOURCE).not.toMatch(/XMLHttpRequest|EventSource|sendBeacon|new WebSocket/)
  })
})
