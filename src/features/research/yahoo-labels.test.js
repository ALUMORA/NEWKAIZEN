import { readFileSync, readdirSync } from 'node:fs'
import { INDUSTRY_ES, countryEs, industryEs, looksEnglish, normalizeIndustry, sectorEs } from './yahoo-labels.js'

/** Guion de cifra, en, em y barra horizontal (U+2012 a U+2015), armados sin escribirlos. */
const GUIONES_LARGOS = new RegExp(`[${String.fromCodePoint(0x2012)}-${String.fromCodePoint(0x2015)}]`)

/** Las industrias que traen hoy las fixtures de replay de Yahoo (yf-*-info-*.json). */
function recordedIndustries() {
  const root = new URL('../../../tests/fixtures/recorded/', import.meta.url)
  const found = new Set()
  for (const file of readdirSync(root, { recursive: true })) {
    const name = String(file)
    if (!/(^|\/)yf-[^/]*info[^/]*\.json$/.test(name)) continue
    const industry = JSON.parse(readFileSync(new URL(name, root), 'utf8'))?.payload?.industry
    if (typeof industry === 'string' && industry.trim()) found.add(industry)
  }
  return [...found].sort()
}

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

  it('toda industria que traen las fixtures de replay sale en español', () => {
    const industries = recordedIndustries()
    expect(industries.length).toBeGreaterThanOrEqual(56)
    const sinTraducir = industries.filter((raw) => industryEs(raw)?.lang !== 'es')
    expect(sinTraducir).toEqual([])
    expect(industryEs('Discount Stores')).toEqual({ text: 'Tiendas de autoservicio y descuento', lang: 'es' })
  })

  it('la llave de la industria pliega mayúsculas, espacios y los tres guiones', () => {
    const em = String.fromCodePoint(0x2014)
    const en = String.fromCodePoint(0x2013)
    expect(normalizeIndustry(`Banks${em}Regional`)).toBe('banks-regional')
    expect(normalizeIndustry(`Banks ${en} Regional`)).toBe('banks-regional')
    expect(normalizeIndustry('  Banks  -   Regional ')).toBe('banks-regional')
    expect(normalizeIndustry('Beverages - Non-Alcoholic')).toBe('beverages-non-alcoholic')
    expect(normalizeIndustry('Oil & Gas  E&P')).toBe('oil & gas e&p')
    const regional = industryEs('Banks - Regional')
    expect(regional).toEqual({ text: 'Bancos regionales', lang: 'es' })
    expect(industryEs(`Banks${em}Regional`)).toEqual(regional)
    expect(industryEs(`BANKS ${en} REGIONAL`)).toEqual(regional)
  })

  it('lo que no está en la tabla se queda como llegó y marcado en inglés', () => {
    expect(industryEs('Space Mining')).toEqual({ text: 'Space Mining', lang: 'en' })
    expect(industryEs('  ')).toBeNull()
    expect(industryEs(null)).toBeNull()
    expect(industryEs(undefined)).toBeNull()
  })

  it('la tabla cubre la taxonomía de Yahoo, con llaves ya normalizadas y sin guiones largos', () => {
    const keys = Object.keys(INDUSTRY_ES)
    expect(keys.length).toBeGreaterThanOrEqual(140)
    expect(keys.filter((k) => normalizeIndustry(k) !== k)).toEqual([])
    expect(Object.values(INDUSTRY_ES).filter((v) => !v.trim() || GUIONES_LARGOS.test(v))).toEqual([])
    const fuente = readFileSync(new URL('./yahoo-labels.js', import.meta.url), 'utf8')
    expect(fuente.split('\n').findIndex((l) => GUIONES_LARGOS.test(l))).toBe(-1)
  })
})
