// Lector mínimo de Markdown para las guías de docs/metodologia: títulos, párrafos, listas (con
// sublistas), tablas, bloques de código, negritas, código en línea y ligas. Los bloques salen de
// markdown-parse.js. Sin HTML crudo: todo pasa por React, así que nada del texto se interpreta
// como marcado.
import { Link } from 'react-router'
import { GUIDE_NAMES } from './guides.js'
import { parseMarkdown } from './markdown-parse.js'

const GUIDE_LINK = /^(?:\.\/)?([a-z0-9-]+)\.md(#.*)?$/

/**
 * Liga de una guía a otra. Si el texto visible es el nombre del archivo ("fibras.md"), se cambia por
 * el nombre de la guía: un nombre de archivo no le dice nada a quien lee.
 */
function linkFor(href, text, key) {
  const guide = href.match(GUIDE_LINK)
  if (guide) {
    const slug = guide[1]
    const label = /\.md$/.test(text) ? (slug === 'README' ? 'Aprender' : (GUIDE_NAMES[slug] ?? text)) : text
    return <Link key={key} to={slug === 'README' ? '/aprender' : `/aprender/metodologia/${slug}`}>{label}</Link>
  }
  if (/^https?:\/\//.test(href)) return <a key={key} href={href} rel="noopener noreferrer" target="_blank">{text}</a>
  return <span key={key}>{text}</span>
}

/** Negritas, código en línea y ligas. */
function inline(text) {
  const out = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g
  let last = 0
  let m
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    if (tok.startsWith('**')) out.push(<strong key={i++}>{tok.slice(2, -2)}</strong>)
    else if (tok.startsWith('`')) out.push(<code key={i++}>{tok.slice(1, -1)}</code>)
    else {
      const [, label, href] = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/) ?? []
      out.push(linkFor(href, label, i++))
    }
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** Un bloque de parseMarkdown → React. */
function renderBlock(b, key) {
  if (b.type === 'code') return <pre key={key} className="learn-formula">{b.text}</pre>
  if (b.type === 'heading') {
    if (b.level === 1) return null
    const Tag = b.level === 2 ? 'h2' : 'h3'
    return <Tag key={key}>{inline(b.text)}</Tag>
  }
  if (b.type === 'table') {
    return (
      <div key={key} className="learn-table" role="region" aria-label="Tabla" tabIndex={0}>
        <table>
          <thead><tr>{b.head.map((c, j) => <th key={j} scope="col">{inline(c)}</th>)}</tr></thead>
          <tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, x) => <td key={x}>{inline(c)}</td>)}</tr>)}</tbody>
        </table>
      </div>
    )
  }
  if (b.type === 'list') {
    const List = b.ordered ? 'ol' : 'ul'
    return (
      <List key={key} start={b.ordered && b.start !== 1 ? b.start : undefined}>
        {b.items.map((it, j) => <li key={j}>{renderItem(it.blocks)}</li>)}
      </List>
    )
  }
  return <p key={key}>{inline(b.text)}</p>
}

/** Contenido de un elemento de lista: el primer párrafo va suelto (lista compacta), lo demás en bloques. */
function renderItem(blocks) {
  const [first, ...rest] = blocks
  if (first?.type !== 'paragraph') return blocks.map(renderBlock)
  return [<span key="t">{inline(first.text)}</span>, ...rest.map((b, j) => renderBlock(b, j))]
}

/** Convierte el texto a bloques de React. El primer # se omite: la página ya trae su h1. */
export function Markdown({ source }) {
  return <div className="learn-md">{parseMarkdown(source).map(renderBlock)}</div>
}
