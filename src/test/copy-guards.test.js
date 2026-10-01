// Guardas del texto que llega a la pantalla, leídas del código fuente de src/ (sin las pruebas).
//
// - El % va pegado a la cifra, como lo escribe fmtPct ("+1.23%", docs/overhaul/specs/frontend-spec.md).
//   Un "10 %" escrito a mano junto a un "10%" formateado se ve como descuido. Los puntos porcentuales
//   ("1.5 pp") y los puntos base ("25 pb") sí llevan espacio, pero no tienen %.
// - Un mensaje de error no arma cifras con toFixed: un negativo saldría con el guion ASCII y no con
//   el signo menos U+2212 de format.js.
// - Las ligas a la metodología salen de pathMethodology() en src/app/paths.js, no escritas a mano.
//
// Se lee con el Linter de ESLint y una regla en línea, así que los comentarios quedan fuera: solo se
// revisan cadenas, plantillas y texto JSX.
import { readFileSync, readdirSync } from 'node:fs'
import { Linter } from 'eslint'
import { describe, expect, it } from 'vitest'

const SRC = new URL('../', import.meta.url)

// Cifra (o el cierre de un campo de plantilla) seguida de espacio y %, o un texto que empieza con
// espacio y % (un sufijo que se pega a una cifra armada aparte).
const SPACED_PCT = /(?:^|[0-9}])[ \u00a0\u2009\u202f]+%/
const METHODOLOGY = '/aprender/metodologia/'

/** @param {string} text */
const short = (text) => text.replace(/\s+/g, ' ').trim().slice(0, 90)

const guards = {
  create(context) {
    const filename = context.filename.replaceAll('\\', '/')
    const isPaths = filename.endsWith('src/app/paths.js')
    const check = (node, text) => {
      if (SPACED_PCT.test(text)) context.report({ node, message: `pct: ${short(text)}` })
      if (!isPaths && text.includes(METHODOLOGY)) context.report({ node, message: `metodologia: ${short(text)}` })
    }
    return {
      Literal(node) {
        if (typeof node.value === 'string') check(node, node.value)
      },
      TemplateLiteral(node) {
        check(node, node.quasis.map((q) => q.value.cooked ?? q.value.raw).join('}'))
      },
      JSXText(node) {
        check(node, node.value)
      },
      'CallExpression[callee.property.name="toFixed"]'(node) {
        const inError = context.sourceCode
          .getAncestors(node)
          .some((a) => a.type === 'ThrowStatement' || (a.type === 'NewExpression' && /Error$/.test(a.callee?.name ?? '')))
        if (inError) context.report({ node, message: `toFixed: ${short(context.sourceCode.getText(node))}` })
      },
    }
  },
}

const config = [
  {
    files: ['**/*.js', '**/*.jsx'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { copy: { rules: { guards } } },
    rules: { 'copy/guards': 'error' },
  },
]

/** @param {string} source @param {string} [filename] @returns {string[]} */
function findings(source, filename = 'src/x.jsx') {
  return new Linter().verify(source, config, { filename }).map((m) => (m.fatal ? `fatal: ${m.message}` : m.message))
}

/** Como findings(), con la línea de cada hallazgo para el reporte. */
function findingsWithLine(source, filename) {
  return new Linter().verify(source, config, { filename }).map((m) => `${m.line}: ${m.fatal ? `fatal: ${m.message}` : m.message}`)
}

function sourceFindings() {
  const out = []
  for (const name of readdirSync(SRC, { recursive: true })) {
    const rel = String(name).replaceAll('\\', '/')
    if (!/\.jsx?$/.test(rel) || /\.test\.jsx?$/.test(rel) || rel.startsWith('test/')) continue
    for (const f of findingsWithLine(readFileSync(new URL(rel, SRC), 'utf8'), `src/${rel}`)) out.push(`src/${rel}:${f}`)
  }
  return out
}

describe('guardas del texto visible', () => {
  it('el detector distingue los casos', () => {
    expect(findings("const a = 'Escribe un peso entre 0 % y 100 %.'")).toHaveLength(1)
    expect(findings('const a = `Suman ${t} %.`')).toHaveLength(1)
    expect(findings("const a = x + ' %'")).toHaveLength(1)
    expect(findings('const a = <p>Con 11 % a 28 días</p>')).toHaveLength(1)
    expect(findings('const a = <p>Suman {t} %.</p>')).toHaveLength(1)
    expect(findings("const a = 'Escribe un peso entre 0% y 100%.'")).toEqual([])
    expect(findings("const a = 'sube 1.5 pp y 25 pb'")).toEqual([])
    expect(findings('// 10 % en un comentario\nconst r = 10 % 3')).toEqual([])
    expect(findings('throw new RangeError(`suma ${s.toFixed(4)}`)')).toEqual(['toFixed: s.toFixed(4)'])
    expect(findings('const v = Number(x.toFixed(2))')).toEqual([])
    expect(findings("const to = '/aprender/metodologia/portafolio'")).toHaveLength(1)
    expect(findings('export const f = (s) => `/aprender/metodologia/${s}`', 'src/app/paths.js')).toEqual([])
  })

  it('las guías de docs/metodologia, que se pintan en /aprender, también pegan el % a la cifra', () => {
    const dir = new URL('../../docs/metodologia/', import.meta.url)
    const out = []
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.md'))) {
      readFileSync(new URL(name, dir), 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (SPACED_PCT.test(line)) out.push(`docs/metodologia/${name}:${i + 1}: ${short(line)}`)
        })
    }
    expect(out).toEqual([])
  })

  it('src/ no tiene % separado de su cifra, toFixed en errores ni ligas a metodología escritas a mano', () => {
    expect(sourceFindings()).toEqual([])
  })
})
