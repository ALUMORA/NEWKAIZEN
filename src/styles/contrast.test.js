// La compuerta de contraste corre con las pruebas: si un token nuevo o cambiado baja de AA
// (texto 4.5:1, texto grande y elementos de interfaz 3:1), `npm run test` falla con el par.
import { measureContrast } from './contrast.check.js'

describe('contraste de los tokens', () => {
  const rows = measureContrast()

  it('revisa los dos temas y los paneles que se quedan oscuros', () => {
    expect(new Set(rows.map((r) => r.scope))).toEqual(new Set(['claro', 'oscuro', 'barra lateral', 'panel oscuro']))
  })

  it('el tema oscuro lee sus propios valores, no los del claro', () => {
    const ink = (scope) => rows.find((r) => r.scope === scope && r.fg === '--ink' && r.bg === '--div-neg-2').got
    expect(ink('claro')).not.toBe(ink('oscuro'))
  })

  it.each(rows.map((r) => [r.scope, `${r.fg} sobre ${r.bg}`, r.min, r.got]))('%s: %s cumple %s:1 (mide %s:1)', (_s, _p, min, got) => {
    expect(got).toBeGreaterThanOrEqual(min)
  })
})
