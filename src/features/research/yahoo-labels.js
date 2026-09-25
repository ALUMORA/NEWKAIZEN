// La ficha recibe sector, país y descripción tal como los publica Yahoo Finance, en inglés. Aquí
// se pasan a español los que tienen un catálogo corto (sector y país) y se detecta si la
// descripción viene en inglés para decirlo en pantalla en vez de mezclar idiomas sin aviso.

/** Sector de Yahoo a español de México (el mismo catálogo que kaizen_api/domain/universe.py). */
export const SECTOR_ES = Object.freeze({
  Technology: 'Tecnología',
  Healthcare: 'Salud',
  'Financial Services': 'Servicios financieros',
  Financials: 'Servicios financieros',
  Energy: 'Energía',
  'Consumer Cyclical': 'Consumo discrecional',
  'Consumer Defensive': 'Consumo básico',
  Industrials: 'Industriales',
  Materials: 'Materiales',
  'Basic Materials': 'Materiales',
  'Real Estate': 'Bienes raíces',
  Utilities: 'Servicios públicos',
  'Communication Services': 'Comunicaciones',
})

/** Países que más aparecen en la BMV, el SIC y las bolsas de EE. UU. */
export const COUNTRY_ES = Object.freeze({
  Mexico: 'México',
  'United States': 'Estados Unidos',
  Canada: 'Canadá',
  Brazil: 'Brasil',
  Chile: 'Chile',
  Colombia: 'Colombia',
  Peru: 'Perú',
  Argentina: 'Argentina',
  Spain: 'España',
  'United Kingdom': 'Reino Unido',
  Germany: 'Alemania',
  France: 'Francia',
  Netherlands: 'Países Bajos',
  Switzerland: 'Suiza',
  Ireland: 'Irlanda',
  Japan: 'Japón',
  China: 'China',
  'Hong Kong': 'Hong Kong',
  Taiwan: 'Taiwán',
  'South Korea': 'Corea del Sur',
  India: 'India',
  Israel: 'Israel',
  Luxembourg: 'Luxemburgo',
  Bermuda: 'Bermudas',
})

/** @param {string | null | undefined} sector */
export function sectorEs(sector) {
  if (!sector) return null
  return SECTOR_ES[/** @type {keyof typeof SECTOR_ES} */ (sector)] ?? sector
}

/** @param {string | null | undefined} country */
export function countryEs(country) {
  if (!country) return null
  return COUNTRY_ES[/** @type {keyof typeof COUNTRY_ES} */ (country)] ?? country
}

const EN = /\b(the|and|its|is|are|company|provides|operates|through|segments?|products|services|which|was|with|headquartered|founded|incorporated)\b/gi
const ES = /\b(el|la|los|las|y|es|son|empresa|opera|ofrece|mediante|servicios|productos|con|sede|fundada)\b/gi

/**
 * true si el texto parece estar en inglés (más palabras funcionales del inglés que del español).
 * @param {string | null | undefined} text
 */
export function looksEnglish(text) {
  if (!text) return false
  const en = String(text).match(EN)?.length ?? 0
  const es = String(text).match(ES)?.length ?? 0
  return en >= 2 && en > es
}
