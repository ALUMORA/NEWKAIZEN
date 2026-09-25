import { countryEs, looksEnglish, sectorEs } from './yahoo-labels.js'

describe('etiquetas de Yahoo en la ficha', () => {
  it('el sector y el país salen en español; lo desconocido se queda como llegó', () => {
    expect(sectorEs('Consumer Defensive')).toBe('Consumo básico')
    expect(sectorEs('Technology')).toBe('Tecnología')
    expect(sectorEs('Algo nuevo')).toBe('Algo nuevo')
    expect(sectorEs(null)).toBeNull()
    expect(countryEs('Mexico')).toBe('México')
    expect(countryEs('United States')).toBe('Estados Unidos')
    expect(countryEs('México')).toBe('México')
  })

  it('detecta la descripción en inglés de Yahoo y no confunde una en español', () => {
    expect(looksEnglish('Wal-Mart de México, S.A.B. de C.V. owns and operates self-service stores in Mexico and Central America. The company operates through two segments.')).toBe(true)
    expect(looksEnglish('Opera tiendas de autoservicio y clubes de precio en México y Centroamérica.')).toBe(false)
    expect(looksEnglish('')).toBe(false)
    expect(looksEnglish(null)).toBe(false)
  })
})
