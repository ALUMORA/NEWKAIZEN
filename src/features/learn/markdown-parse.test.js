import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseMarkdown } from './markdown-parse.js'

const DIR = new URL('../../../docs/metodologia/', import.meta.url)
const DOCS = readdirSync(DIR).filter((f) => f.endsWith('.md'))
const read = (file) => readFileSync(new URL(file, DIR), 'utf8')

/** Todos los bloques, recorriendo las listas por dentro. */
function* walk(blocks) {
  for (const b of blocks) {
    yield b
    if (b.type === 'list') for (const it of b.items) yield* walk(it.blocks)
  }
}

/** Texto de cada bloque, en orden, para comparar palabras con el original. */
function textOf(blocks) {
  const out = []
  for (const b of blocks) {
    if (b.type === 'table') out.push(...b.head, ...b.rows.flat())
    else if (b.type === 'list') for (const it of b.items) out.push(textOf(it.blocks))
    else out.push(b.text)
  }
  return out.join(' ')
}

// Referencia independiente del parser, válida para cómo están escritas estas guías: todo elemento
// de primer nivel empieza en la columna 0, y las sublistas llevan sangría y viñeta (o empiezan en 1).
const REF_ITEM = /^(?:(?:\d+\.|[-*]) | +(?:[-*]|1\.) )/
function reference(source) {
  let fenced = false
  let items = 0
  const text = []
  for (const line of source.replace(/\r\n/g, '\n').split('\n')) {
    if (line.startsWith('```')) { fenced = !fenced; continue }
    if (fenced) { text.push(line); continue }
    if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) continue
    if (REF_ITEM.test(line)) items++
    text.push(line.replace(/^#{1,4}\s+/, '').replace(REF_ITEM, ' ').replace(/\|/g, ' '))
  }
  return { items, text: text.join(' ') }
}

const words = (s) => s.split(/[^\p{L}\p{N}]+/u).filter(Boolean).sort()

describe('parseMarkdown con las guías de docs/metodologia', () => {
  it('encuentra las guías', () => {
    expect(DOCS.length).toBeGreaterThanOrEqual(10)
  })

  for (const file of DOCS) {
    it(`${file}: mismo número de elementos de lista que la referencia`, () => {
      const blocks = parseMarkdown(read(file))
      const items = [...walk(blocks)].filter((b) => b.type === 'list').reduce((n, l) => n + l.items.length, 0)
      expect(items).toBe(reference(read(file)).items)
    })

    it(`${file}: no se pierde ni se duplica ninguna palabra`, () => {
      expect(words(textOf(parseMarkdown(read(file))))).toEqual(words(reference(read(file)).text))
    })

    it(`${file}: las listas numeradas van seguidas`, () => {
      for (const list of [...walk(parseMarkdown(read(file)))].filter((b) => b.type === 'list' && b.ordered)) {
        expect(list.items.map((it) => it.number)).toEqual(list.items.map((_, k) => list.start + k))
      }
    })
  }

  it('backtest: el 52 sigue en el punto 1 y la lista tiene 3 puntos', () => {
    const blocks = parseMarkdown(read('backtest.md'))
    const at = blocks.findIndex((b) => b.type === 'heading' && b.text.startsWith('Qué cambió'))
    const list = blocks.slice(at).find((b) => b.type === 'list')
    expect(list.items).toHaveLength(3)
    expect(list.items[0].blocks).toHaveLength(1)
    expect(list.items[0].blocks[0].text).toContain('multiplicado por 52. Eso no es')
  })

  it('fuentes-de-datos: el punto 5 lleva una sublista de 2 viñetas, sin guiones sueltos en el texto', () => {
    const blocks = parseMarkdown(read('fuentes-de-datos.md'))
    const item = [...walk(blocks)].filter((b) => b.type === 'list' && b.ordered).flatMap((l) => l.items).find((it) => it.blocks[0]?.text?.startsWith('**Casi nunca se rellena'))
    expect(item.blocks.map((b) => b.type)).toEqual(['paragraph', 'list'])
    expect(item.blocks[0].text).not.toContain(' - ')
    expect(item.blocks[1]).toMatchObject({ ordered: false })
    expect(item.blocks[1].items).toHaveLength(2)
    expect(item.blocks[1].items[1].blocks[0].text).toContain('regresiones en exceso')
  })
})

describe('parseMarkdown, casos sueltos', () => {
  it('una línea en blanco entre elementos no parte la lista', () => {
    const [list] = parseMarkdown('1. uno\n\n2. dos\n')
    expect(list.items).toHaveLength(2)
  })

  it('un párrafo no se corta con un número que no es 1', () => {
    expect(parseMarkdown('Subió a\n2026. Y siguió.\n')).toEqual([{ type: 'paragraph', text: 'Subió a 2026. Y siguió.' }])
  })

  it('una lista de viñetas después de una numerada es otra lista', () => {
    const blocks = parseMarkdown('1. uno\n- viñeta\n')
    expect(blocks.map((b) => b.type === 'list' && b.ordered)).toEqual([true, false])
  })
})
