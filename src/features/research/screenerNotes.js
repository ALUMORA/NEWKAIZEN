// Utilidades puras de las notas (meta.notes) de los screeners de fórmula mágica y FIBRAs.
// El API escribe sus avisos como texto en español y nombra a las emisoras por su clave
// ("FMTY14.MX: LTV, ... van en s/d porque ..."), así que aquí se reparten por emisora.

/** @param {string} text */
function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * ¿La nota nombra a esa clave como palabra completa? "FMTY14.MX" no cuenta dentro de "XFMTY14.MX"
 * ni "FMTY14" dentro de "FMTY14.MX".
 * @param {string} note
 * @param {string} symbol
 */
export function mentions(note, symbol) {
  if (!note || !symbol) return false
  return new RegExp(`(^|[^A-Za-z0-9.])${escapeRe(symbol)}(?![A-Za-z0-9]|\\.[A-Za-z0-9])`).test(note)
}

/**
 * Notas que hablan de una emisora, en el orden en que llegaron.
 * @param {string} symbol
 * @param {readonly string[] | null | undefined} notes
 */
export function notesFor(symbol, notes) {
  return (notes ?? []).filter((n) => typeof n === 'string' && mentions(n, symbol))
}

/**
 * Notas que no nombran a ninguna de las emisoras de la tabla: las generales del cálculo.
 * @param {readonly string[] | null | undefined} notes
 * @param {readonly string[]} symbols
 */
export function generalNotes(notes, symbols) {
  return (notes ?? []).filter((n) => typeof n === 'string' && n && !symbols.some((s) => mentions(n, s)))
}

/**
 * Claves que la fórmula mágica calculó con el renglón EBIT de respaldo. El API las lista al final
 * de su nota: "Sin utilidad de operación reportada, se usó el renglón EBIT de Yahoo ...: A, B."
 * @param {readonly string[] | null | undefined} notes
 * @returns {Set<string>}
 */
export function ebitFallbackSymbols(notes) {
  const out = new Set()
  for (const note of notes ?? []) {
    if (typeof note !== 'string' || !/renglón EBIT/i.test(note)) continue
    const tail = note.slice(note.lastIndexOf(':') + 1)
    for (const raw of tail.split(',')) {
      const symbol = raw.trim().replace(/\.$/, '')
      if (/^[A-Z0-9][A-Z0-9.\-^=]*$/.test(symbol)) out.add(symbol)
    }
  }
  return out
}

const SOURCE_NAMES = Object.freeze({
  yahoo: 'Yahoo Finance',
  computed: 'cálculo de Kaizen',
  fred: 'FRED',
  banxico: 'Banxico',
  sec: 'SEC',
  stooq: 'Stooq',
})

/**
 * meta.source del API ("yahoo,computed,fred") en palabras: "Yahoo Finance, cálculo de Kaizen y FRED".
 * Lo que no se reconozca se deja tal cual; nada se esconde.
 * @param {string | null | undefined} source
 */
export function sourceLabel(source) {
  const names = String(source ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => SOURCE_NAMES[/** @type {keyof typeof SOURCE_NAMES} */ (t.toLowerCase().split('_')[0])] ?? t)
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`
}

/**
 * El meta tal cual, con la fuente en palabras para DataStatus. asOf, stale y fallback no cambian.
 * @template {{ source?: string | null } | null | undefined} M
 * @param {M} meta
 * @param {Partial<NonNullable<M>>} [over]
 * @returns {M}
 */
export function readableMeta(meta, over = {}) {
  if (!meta) return meta
  return { ...meta, source: sourceLabel(meta.source), ...over }
}
