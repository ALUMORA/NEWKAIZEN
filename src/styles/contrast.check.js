// Verificación numérica de contraste de los tokens de color (C1).
//
//   node src/styles/contrast.check.js            # tabla completa y exit 0/1
//   node src/styles/contrast.check.js --fallos    # solo lo que no cumple
//
// También lo corre src/styles/contrast.test.js dentro de `npm run test`, así que
// un token que baje de AA tumba la compuerta sin que nadie tenga que acordarse.
//
// Lee los valores REALES de src/theme.css y src/styles/tokens.css, así que no se
// puede desfasar del CSS: si alguien cambia un token, el número cambia aquí.
// Resuelve cadenas de var() y color-mix(in srgb, A p%, B), que es como están
// escritos los bordes de las insignias.
//
// Umbrales (WCAG 2.1 AA): texto normal 4.5:1, texto grande (≥ 18.66px en 700 o
// ≥ 24px) y componentes de interfaz 3:1. Cada par dice cuál le toca y por qué.
//
// Los ámbitos son cuatro porque el tema no es lo único que cambia los tokens:
// la barra lateral y .dark-panel se quedan oscuras en los dos temas y reescriben
// --ink, --muted y compañía sobre su propio fondo.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FILES = [path.join(HERE, '..', 'theme.css'), path.join(HERE, 'tokens.css')]

// ─── lectura del CSS ────────────────────────────────────────────────────────

/**
 * Bloques `selector { ... }` de un CSS sin comentarios. Solo el primer nivel:
 * los @media y @keyframes no traen tokens de color, así que se saltan.
 * @param {string} css
 * @returns {{ selectors: string[], body: string }[]}
 */
function blocks(css) {
  const out = []
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean)
    out.push({ selectors, body: m[2] })
  }
  return out
}

/**
 * Declaraciones `--x: valor` de los bloques cuyo selector es EXACTAMENTE uno de
 * los pedidos, en el orden de los selectores y de los archivos (el último gana,
 * como en el navegador cuando la especificidad empata).
 * @param {string[]} selectors
 * @returns {Record<string, string>}
 */
export function readVars(selectors) {
  /** @type {Record<string, string>} */
  const out = {}
  const parsed = FILES.map((file) => blocks(readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')))
  for (const selector of selectors) {
    for (const list of parsed) {
      for (const block of list) {
        if (!block.selectors.includes(selector)) continue
        for (const decl of block.body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[decl[1]] = decl[2].trim()
      }
    }
  }
  return out
}

const SCOPES = {
  claro: readVars([':root']),
  oscuro: readVars([':root', ':root[data-theme="dark"]']),
  // La barra lateral es verde oscuro en los dos temas y se trae los tokens de
  // texto del tema oscuro; el caso que importa es el tema claro.
  'barra lateral': { ...readVars([':root', '.app-sidebar']) },
  // Los paneles que se quedan oscuros (Panorama, Resumen) en tema claro.
  'panel oscuro': { ...readVars([':root', '.dark-panel']) },
}

// ─── color ──────────────────────────────────────────────────────────────────

/** @param {string} hex @returns {[number, number, number]} */
function parseHex(hex) {
  let h = hex.trim().replace(/^#/, '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`No es un color hexadecimal: ${hex}`)
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
}

/**
 * Resuelve un valor de token hasta un rgb: sigue var(), calcula
 * color-mix(in srgb, A p%, B) y acepta #rgb, #rrggbb y rgb()/rgba().
 * @param {string} value
 * @param {Record<string, string>} scope
 * @param {number} depth
 * @returns {[number, number, number]}
 */
function toRgb(value, scope, depth = 0) {
  if (depth > 12) throw new Error(`Ciclo de var() en "${value}"`)
  const v = value.trim()

  const varMatch = /^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]+))?\)$/.exec(v)
  if (varMatch) {
    const resolved = scope[varMatch[1]]
    if (resolved === undefined) {
      if (varMatch[2]) return toRgb(varMatch[2], scope, depth + 1)
      throw new Error(`Token sin valor en este ámbito: ${varMatch[1]}`)
    }
    return toRgb(resolved, scope, depth + 1)
  }

  const mix = /^color-mix\(\s*in\s+srgb\s*,\s*([\s\S]+?)\s+(\d+(?:\.\d+)?)%\s*,\s*([\s\S]+?)\s*\)$/.exec(v)
  if (mix) {
    const a = toRgb(mix[1], scope, depth + 1)
    const b = toRgb(mix[3], scope, depth + 1)
    const p = Number(mix[2]) / 100
    return /** @type {[number, number, number]} */ (a.map((c, i) => c * p + b[i] * (1 - p)))
  }

  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(v)
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]

  return parseHex(v)
}

/** @param {[number, number, number]} rgb */
function luminance([r, g, b]) {
  const f = (c) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

/** Razón de contraste WCAG entre dos colores ya resueltos. */
function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// ─── pares a verificar ──────────────────────────────────────────────────────
// min 4.5 = texto normal; min 3 = texto grande o elemento de interfaz (borde de
// control, relleno de barra, marca de gráfica, anillo de foco).

/** @type {{ fg: string, bg: string, min: number, note: string, scopes?: string[] }[]} */
const PAIRS = [
  // Texto sobre los fondos de la app
  { fg: '--ink', bg: '--bg', min: 4.5, note: 'texto principal sobre el fondo' },
  { fg: '--ink', bg: '--surface', min: 4.5, note: 'texto principal en tarjeta' },
  { fg: '--ink', bg: '--surface-raised', min: 4.5, note: 'texto en tarjeta elevada' },
  { fg: '--ink', bg: '--surface-2', min: 4.5, note: 'texto en superficie 2' },
  { fg: '--ink', bg: '--surface-3', min: 4.5, note: 'texto en superficie 3' },
  { fg: '--ink-soft', bg: '--surface', min: 4.5, note: 'texto secundario en tarjeta' },
  { fg: '--ink-soft', bg: '--bg', min: 4.5, note: 'texto secundario sobre el fondo' },
  { fg: '--muted', bg: '--surface', min: 4.5, note: 'etiqueta apagada en tarjeta' },
  { fg: '--muted', bg: '--bg', min: 4.5, note: 'etiqueta apagada sobre el fondo' },
  { fg: '--muted', bg: '--surface-2', min: 4.5, note: 'etiqueta apagada en superficie 2' },
  { fg: '--muted-2', bg: '--surface-raised', min: 4.5, note: 'texto de marcador (placeholder)' },
  { fg: '--muted-2', bg: '--surface', min: 4.5, note: 'texto más apagado en tarjeta' },
  { fg: '--muted', bg: '--surface-raised', min: 4.5, note: 'texto apagado en popover, diálogo y aviso' },
  { fg: '--ink-soft', bg: '--surface-raised', min: 4.5, note: 'cuerpo de popover y diálogo' },
  { fg: '--ink-soft', bg: '--surface-2', min: 4.5, note: 'texto de insignia neutra' },

  // Acento
  { fg: '--accent', bg: '--surface', min: 4.5, note: 'liga y etiqueta de acento' },
  { fg: '--accent', bg: '--bg', min: 4.5, note: 'acento sobre el fondo' },
  { fg: '--accent', bg: '--accent-faint', min: 4.5, note: 'acento sobre su fondo tenue' },
  { fg: '--accent-strong', bg: '--accent-soft', min: 4.5, note: 'acento fuerte sobre su fondo suave' },
  { fg: '--on-accent', bg: '--accent', min: 4.5, note: 'texto del botón primario' },
  { fg: '--on-accent', bg: '--accent-strong', min: 4.5, note: 'texto del botón primario en reposo' },

  // Dirección del dato y estados
  { fg: '--up', bg: '--surface', min: 4.5, note: 'alza en tarjeta' },
  { fg: '--up', bg: '--bg', min: 4.5, note: 'alza sobre el fondo' },
  { fg: '--up', bg: '--up-soft', min: 4.5, note: 'alza en insignia' },
  { fg: '--up', bg: '--surface-2', min: 4.5, note: 'alza en fila de tabla bajo el cursor' },
  { fg: '--down', bg: '--surface', min: 4.5, note: 'baja en tarjeta' },
  { fg: '--down', bg: '--bg', min: 4.5, note: 'baja sobre el fondo' },
  { fg: '--down', bg: '--down-soft', min: 4.5, note: 'baja en insignia' },
  { fg: '--down', bg: '--surface-2', min: 4.5, note: 'baja en fila de tabla bajo el cursor' },
  { fg: '--down', bg: '--surface-raised', min: 4.5, note: 'mensaje de error de un campo' },
  { fg: '--flat', bg: '--surface', min: 4.5, note: 'sin cambio en tarjeta' },
  { fg: '--stale', bg: '--surface', min: 4.5, note: 'dato viejo o de respaldo' },
  { fg: '--stale', bg: '--stale-soft', min: 4.5, note: 'insignia de dato viejo' },
  { fg: '--neutral-dir', bg: '--surface', min: 4.5, note: 'movimiento sin signo bueno ni malo' },
  { fg: '--neutral-dir', bg: '--neutral-dir-soft', min: 4.5, note: 'insignia neutra (USD/MXN)' },
  { fg: '--stale', bg: '--surface-2', min: 4.5, note: 'dato viejo en fila de tabla bajo el cursor' },
  { fg: '--surface-raised', bg: '--negative', min: 4.5, note: 'texto del botón destructivo' },
  { fg: '--ink', bg: '--surface-2', min: 4.5, note: 'opción elegida del control segmentado (sobre su riel)' },

  // Elementos de interfaz
  { fg: '--control-border', bg: '--surface-raised', min: 3, note: 'borde del campo de formulario' },
  { fg: '--control-border', bg: '--surface', min: 3, note: 'borde de control secundario' },
  { fg: '--control-border', bg: '--bg', min: 3, note: 'borde de control sobre el fondo de la página' },
  { fg: '--focus', bg: '--surface-raised', min: 3, note: 'anillo de foco en diálogo y popover' },
  { fg: '--focus', bg: '--bg', min: 3, note: 'anillo de foco sobre el fondo' },
  { fg: '--focus', bg: '--surface', min: 3, note: 'anillo de foco en tarjeta' },
  { fg: '--focus', bg: '--surface-2', min: 3, note: 'anillo de foco en superficie 2' },
  { fg: '--accent', bg: '--surface-3', min: 3, note: 'relleno de barra de progreso' },

  // Marcas de gráfica sobre la superficie de la gráfica (3:1, no son texto)
  ...Array.from({ length: 8 }, (_, i) => ({
    fg: `--chart-${i + 1}`,
    bg: '--chart-surface',
    min: 3,
    note: `serie ${i + 1} sobre la superficie de la gráfica`,
  })),
  { fg: '--seq-1', bg: '--chart-surface', min: 2, note: 'paso corto de la rampa secuencial (relleno, con etiqueta)' },
  { fg: '--seq-5', bg: '--chart-surface', min: 3, note: 'paso largo de la rampa secuencial' },
  { fg: '--axis', bg: '--chart-surface', min: 1.4, note: 'línea de eje (gráfico decorativo)' },
  { fg: '--grid', bg: '--chart-surface', min: 1.05, note: 'retícula (gráfico decorativo, se ve pero no compite)' },
  { fg: '--crosshair', bg: '--chart-surface', min: 3, note: 'cruz del cursor' },

  // Texto dentro de las celdas de un mapa de calor divergente
  { fg: '--ink', bg: '--div-neg-2', min: 4.5, note: 'valor dentro de la celda más negativa' },
  { fg: '--ink', bg: '--div-neg-1', min: 4.5, note: 'valor dentro de la celda negativa' },
  { fg: '--ink', bg: '--div-0', min: 4.5, note: 'valor dentro de la celda neutra' },
  { fg: '--ink', bg: '--div-pos-1', min: 4.5, note: 'valor dentro de la celda positiva' },
  { fg: '--ink', bg: '--div-pos-2', min: 4.5, note: 'valor dentro de la celda más positiva' },
]

/** Los ámbitos oscuros fijos se revisan contra --bg-deep, que es su fondo real. */
const DEEP_PAIRS = [
  { fg: '--ink', bg: '--bg-deep', min: 4.5, note: 'texto sobre el panel siempre oscuro' },
  { fg: '--ink-soft', bg: '--bg-deep', min: 4.5, note: 'texto secundario sobre el panel oscuro' },
  { fg: '--muted', bg: '--bg-deep', min: 4.5, note: 'etiqueta apagada sobre el panel oscuro' },
  { fg: '--muted-2', bg: '--bg-deep', min: 4.5, note: 'texto más apagado sobre el panel oscuro' },
]

// ─── corrida ────────────────────────────────────────────────────────────────

/**
 * Mide todos los pares en todos los ámbitos.
 * @returns {{ scope: string, fg: string, bg: string, min: number, got: number, note: string }[]}
 */
export function measureContrast() {
  const rows = []
  for (const [scopeName, scope] of Object.entries(SCOPES)) {
    const list = scopeName === 'claro' || scopeName === 'oscuro' ? PAIRS : DEEP_PAIRS
    for (const pair of list) {
      const got = ratio(toRgb(`var(${pair.fg})`, scope), toRgb(`var(${pair.bg})`, scope))
      rows.push({ scope: scopeName, ...pair, got: Math.floor(got * 100) / 100 })
    }
  }
  return rows
}

/** Peor caso por ámbito y por umbral, para el resumen de docs/design.md. */
export function worstByScope(rows = measureContrast()) {
  /** @type {Record<string, Record<string, { pair: string, got: number }>>} */
  const out = {}
  for (const r of rows) {
    const key = r.min >= 4.5 ? 'texto' : r.min >= 3 ? 'interfaz' : 'decorativo'
    out[r.scope] ??= {}
    const prev = out[r.scope][key]
    if (!prev || r.got < prev.got) out[r.scope][key] = { pair: `${r.fg} sobre ${r.bg}`, got: r.got }
  }
  return out
}

function main() {
  const onlyFailures = process.argv.includes('--fallos')
  const rows = measureContrast()
  const failures = rows.filter((r) => r.got < r.min)
  const shown = onlyFailures ? failures : rows

  let currentScope = ''
  for (const r of shown) {
    if (r.scope !== currentScope) {
      currentScope = r.scope
      console.log(`\n── tema ${currentScope} ──`)
    }
    const mark = r.got < r.min ? '✗' : ' '
    const pair = `${r.fg} sobre ${r.bg}`.padEnd(42)
    console.log(`${mark} ${pair} ${String(r.got).padStart(6)}:1  (mín ${r.min})  ${r.note}`)
  }

  console.log('\nPeor caso por ámbito:')
  for (const [scope, kinds] of Object.entries(worstByScope(rows))) {
    for (const [kind, w] of Object.entries(kinds)) console.log(`  ${scope.padEnd(14)} ${kind.padEnd(9)} ${w.got}:1  ${w.pair}`)
  }

  console.log(`\n${rows.length} pares revisados en ${Object.keys(SCOPES).length} ámbitos.`)
  if (failures.length) {
    console.error(`✗ ${failures.length} par(es) por debajo del mínimo.`)
    process.exit(1)
  }
  console.log('✓ Todos cumplen: texto ≥ 4.5:1, texto grande y elementos de interfaz ≥ 3:1.')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
