// Lector mínimo de Markdown para las guías de docs/metodologia: títulos, párrafos, listas, tablas,
// bloques de código, negritas, código en línea y ligas. Sin HTML crudo: todo pasa por React, así
// que nada del texto se interpreta como marcado.
import { Link } from 'react-router'

const GUIDE_LINK = /^(?:\.\/)?([a-z0-9-]+)\.md(#.*)?$/

function linkFor(href, text, key) {
  const guide = href.match(GUIDE_LINK)
  if (guide) return <Link key={key} to={guide[1] === 'README' ? '/aprender' : `/aprender/metodologia/${guide[1]}`}>{text}</Link>
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

const cells = (line) => line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim())

/** Convierte el texto a bloques de React. El primer # se omite: la página ya trae su h1. */
export function Markdown({ source }) {
  const lines = String(source ?? '').replace(/\r\n/g, '\n').split('\n')
  const blocks = []
  let i = 0
  let k = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }
    if (line.startsWith('```')) {
      const body = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) body.push(lines[i++])
      i++
      blocks.push(<pre key={k++} className="learn-formula">{body.join('\n')}</pre>)
      continue
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      const level = h[1].length
      if (level > 1) {
        const Tag = level === 2 ? 'h2' : 'h3'
        blocks.push(<Tag key={k++}>{inline(h[2])}</Tag>)
      }
      i++
      continue
    }
    if (/^\s*\|/.test(line)) {
      const rows = []
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++])
      const [head, , ...body] = rows
      blocks.push(
        <div key={k++} className="learn-table" role="region" aria-label="Tabla" tabIndex={0}>
          <table>
            <thead><tr>{cells(head).map((c, j) => <th key={j} scope="col">{inline(c)}</th>)}</tr></thead>
            <tbody>{body.map((r, j) => <tr key={j}>{cells(r).map((c, x) => <td key={x}>{inline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      )
      continue
    }
    const ordered = /^\s*\d+\.\s+/
    const bullet = /^\s*[-*]\s+/
    if (ordered.test(line) || bullet.test(line)) {
      const isOrdered = ordered.test(line)
      const marker = isOrdered ? ordered : bullet
      const items = []
      while (i < lines.length && lines[i].trim()) {
        if (marker.test(lines[i])) items.push(lines[i].replace(marker, ''))
        else if (items.length) items[items.length - 1] += ` ${lines[i].trim()}`
        i++
      }
      const List = isOrdered ? 'ol' : 'ul'
      blocks.push(<List key={k++}>{items.map((it, j) => <li key={j}>{inline(it)}</li>)}</List>)
      continue
    }
    const para = []
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*\||\s*\d+\.\s|\s*[-*]\s)/.test(lines[i])) para.push(lines[i++].trim())
    blocks.push(<p key={k++}>{inline(para.join(' '))}</p>)
  }
  return <div className="learn-md">{blocks}</div>
}
