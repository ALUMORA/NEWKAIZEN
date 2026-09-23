// Utilidades puras de la página de la fórmula mágica (/screener/formula-magica). El ranking lo
// calcula el API (kaizen_api/domain/screeners/magic.py); aquí solo se prepara para mostrarlo.

export const UNIVERSES = Object.freeze([
  { value: 'mx', label: 'México (BMV)' },
  { value: 'us', label: 'Estados Unidos' },
])

/** Universo por omisión: el de la Bolsa Mexicana, que es el que más le importa a quien usa Kaizen. */
export const DEFAULT_UNIVERSE = 'mx'

/**
 * Lo que venga en ?universo= a un universo válido.
 * @param {string | null | undefined} value
 * @returns {'mx' | 'us'}
 */
export function parseUniverse(value) {
  const v = String(value ?? '').trim().toLowerCase()
  return v === 'us' ? 'us' : v === 'mx' ? 'mx' : DEFAULT_UNIVERSE
}

/**
 * Reglas de exclusión, las mismas de docs/metodologia/formula-magica.md y de
 * kaizen_api/domain/screeners/magic.py. Se muestran siempre, haya o no emisoras fuera.
 */
export const EXCLUSION_RULES = Object.freeze([
  'Financieras: bancos, aseguradoras y casas de bolsa. Su deuda es materia prima, no financiamiento.',
  'Servicios públicos regulados: su rentabilidad la fija un regulador, no el mercado.',
  'Sector inmobiliario y FIBRAs: tienen su propia pantalla.',
  'Utilidad de operación de cero o negativa, o sin utilidad de operación reportada: no se estima.',
  'Capital empleado o valor de empresa de cero o negativo: el cociente no tiene lectura.',
  'Capitalización debajo del piso del universo: 2,000 millones de dólares en Estados Unidos y 5,000 millones de pesos en México.',
  'Emisoras que reportan en una moneda y cotizan en otra: no se mezclan monedas.',
])

/**
 * Valores que se repiten en una columna: son empates, porque el API da el mismo lugar al mismo
 * valor (ranking de competencia 1, 2, 2, 4) y la suma de lugares también puede coincidir.
 * @template T
 * @param {readonly T[]} rows
 * @param {keyof T} key
 * @returns {Set<unknown>}
 */
export function sharedValues(rows, key) {
  const seen = new Set()
  const shared = new Set()
  for (const row of rows) {
    const value = row[key]
    if (value == null) continue
    if (seen.has(value)) shared.add(value)
    seen.add(value)
  }
  return shared
}

/**
 * Renglones del API con su posición en el orden del API (1, 2, 3...). El orden ya viene resuelto:
 * suma de lugares, luego lugar por EY y luego la clave. La posición se conserva aunque la tabla se
 * reordene por otra columna.
 * @template T
 * @param {readonly T[]} rows
 * @returns {(T & { position: number })[]}
 */
export function withPositions(rows) {
  return rows.map((row, i) => ({ ...row, position: i + 1 }))
}

/**
 * Emisoras fuera del ranking agrupadas por motivo, del motivo más frecuente al menos frecuente
 * (y, entre iguales, en el orden en que aparecieron).
 * @param {readonly { symbol: string, reason: string }[] | null | undefined} excluded
 * @returns {{ reason: string, symbols: string[] }[]}
 */
export function groupExclusions(excluded) {
  /** @type {Map<string, string[]>} */
  const groups = new Map()
  for (const item of excluded ?? []) {
    const reason = String(item?.reason ?? '').trim() || 'Sin motivo escrito por el servidor.'
    const list = groups.get(reason) ?? []
    list.push(item.symbol)
    groups.set(reason, list)
  }
  return [...groups.entries()]
    .map(([reason, symbols], order) => ({ reason, symbols, order }))
    .sort((a, b) => b.symbols.length - a.symbols.length || a.order - b.order)
    .map(({ reason, symbols }) => ({ reason, symbols }))
}
