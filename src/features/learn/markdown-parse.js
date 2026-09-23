// Parser mínimo de Markdown para las guías de docs/metodologia. Devuelve bloques como datos y
// markdown.jsx los convierte a React. Sigue las reglas de CommonMark que esas guías usan:
// - Un elemento de lista abarca las líneas con sangría igual o mayor que su columna de contenido
//   (donde empieza el texto después del marcador) y las continuaciones sin sangría de su párrafo.
// - Dentro de un elemento, una línea con marcador y esa sangría abre una sublista.
// - Una lista numerada solo corta un párrafo si empieza en 1. Por eso "multiplicado por\n   52. Eso
//   no es" sigue siendo un solo párrafo y no un elemento nuevo que se come el 52.

const FENCE = /^```/
const HEADING = /^(#{1,4})\s+(.*)$/
const TABLE = /^\s*\|/
const ITEM = /^( *)(?:(\d{1,9})\.|([-*]))( +)(.*)$/

/** @typedef {{ number: number | null, blocks: Block[] }} ListItem */
/**
 * @typedef {{ type: 'heading', level: number, text: string }
 *   | { type: 'code', text: string }
 *   | { type: 'table', head: string[], rows: string[][] }
 *   | { type: 'paragraph', text: string }
 *   | { type: 'list', ordered: boolean, start: number, items: ListItem[] }} Block
 */

/** @param {string} line */
const indentOf = (line) => line.length - line.replace(/^ +/, '').length

/** @param {string} line */
function matchItem(line) {
  const m = line.match(ITEM)
  if (!m) return null
  const [, lead, num, , gap, text] = m
  const markerWidth = num != null ? num.length + 1 : 1
  return { indent: lead.length, ordered: num != null, number: num != null ? Number(num) : null, col: lead.length + markerWidth + gap.length, text }
}

/** ¿Termina el párrafo en curso? Como en CommonMark, una lista numerada solo lo corta si empieza en 1. @param {string} line */
function interruptsParagraph(line) {
  if (!line.trim() || FENCE.test(line) || HEADING.test(line) || TABLE.test(line)) return true
  const item = matchItem(line)
  return Boolean(item && (!item.ordered || item.number === 1))
}

/** @param {string} line */
const cells = (line) => line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim())

/** Índice de la siguiente línea con texto a partir de `i`. @param {string[]} lines @param {number} i */
function nextFilled(lines, i) {
  let j = i
  while (j < lines.length && !lines[j].trim()) j++
  return j
}

/**
 * Una lista que empieza en lines[start]. Junta las líneas de cada elemento, sin su sangría, y las
 * vuelve a leer como bloques: así salen igual el párrafo, sus continuaciones y las sublistas.
 * @param {string[]} lines @param {number} start
 * @returns {{ block: Block, next: number }}
 */
function parseList(lines, start) {
  const first = /** @type {NonNullable<ReturnType<typeof matchItem>>} */ (matchItem(lines[start]))
  /** @type {{ number: number | null, lines: string[] }[]} */
  const raw = []
  let col = 0
  let i = start
  let prevText = false
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      const j = nextFilled(lines, i)
      if (j >= lines.length) { i = j; break }
      const m = matchItem(lines[j])
      const sibling = m && m.indent < col && m.ordered === first.ordered
      if (!sibling && indentOf(lines[j]) < col) break
      if (!sibling) for (let k = i; k < j; k++) raw[raw.length - 1].lines.push('')
      i = j
      prevText = false
      continue
    }
    const indent = indentOf(line)
    const m = matchItem(line)
    if (raw.length === 0 || (m && indent < col)) {
      if (!m || m.ordered !== first.ordered) break
      raw.push({ number: m.number, lines: [m.text] })
      col = m.col
      prevText = true
      i++
      continue
    }
    if (indent >= col) {
      raw[raw.length - 1].lines.push(line.slice(col))
    } else if (prevText && !interruptsParagraph(line)) {
      // Continuación perezosa: el párrafo del elemento sigue en una línea sin sangría.
      raw[raw.length - 1].lines.push(line.trim())
    } else {
      break
    }
    prevText = true
    i++
  }
  return {
    block: {
      type: 'list',
      ordered: first.ordered,
      start: first.number ?? 1,
      items: raw.map((r) => ({ number: r.number, blocks: parseBlocks(r.lines) })),
    },
    next: i,
  }
}

/**
 * Texto Markdown (ya partido en líneas) → bloques.
 * @param {string[]} lines
 * @returns {Block[]}
 */
export function parseBlocks(lines) {
  /** @type {Block[]} */
  const blocks = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }
    if (FENCE.test(line)) {
      const body = []
      i++
      while (i < lines.length && !FENCE.test(lines[i])) body.push(lines[i++])
      i++
      blocks.push({ type: 'code', text: body.join('\n') })
      continue
    }
    const h = line.match(HEADING)
    if (h) {
      blocks.push({ type: 'heading', level: h[1].length, text: h[2].trim() })
      i++
      continue
    }
    if (TABLE.test(line)) {
      const rows = []
      while (i < lines.length && TABLE.test(lines[i])) rows.push(lines[i++])
      const [head = '', , ...body] = rows
      blocks.push({ type: 'table', head: cells(head), rows: body.map(cells) })
      continue
    }
    if (matchItem(line)) {
      const { block, next } = parseList(lines, i)
      blocks.push(block)
      i = next
      continue
    }
    const para = [line.trim()]
    i++
    while (i < lines.length && !interruptsParagraph(lines[i])) para.push(lines[i++].trim())
    blocks.push({ type: 'paragraph', text: para.join(' ') })
  }
  return blocks
}

/** @param {string} source */
export function parseMarkdown(source) {
  return parseBlocks(String(source ?? '').replace(/\r\n/g, '\n').split('\n'))
}
