// CSV para exportar (Excel en español abre bien UTF-8 con BOM) e importar movimientos.
//
//   const text = toCSV([['Símbolo', 'Cantidad'], ['AAPL', 10]])
//   downloadCSV('movimientos.csv', text)
//   const rows = parseCSV(text)            // [['Símbolo', 'Cantidad'], ['AAPL', '10']]
//   const objects = rowsToObjects(rows)    // [{ Símbolo: 'AAPL', Cantidad: '10' }]
//
// Inyección de fórmulas: una celda de texto que empieza con = + - @ (o tabulador / retorno de
// carro) se exporta con un apóstrofo delante para que la hoja de cálculo no la ejecute. Una celda
// que ya empezaba con apóstrofos antes de esos caracteres recibe uno más, así parseCSV con
// `unguard` siempre recupera el texto original. Los números se escriben tal cual (−5 sale como
// "-5", que Excel lee como número).

export const BOM = '\uFEFF'
const DANGEROUS_START = /^'*[=+\-@\t\r]/

/**
 * Texto seguro de una celda.
 * @param {unknown} value
 * @returns {string}
 */
export function csvCell(value) {
  if (value === null || value === undefined) return ''
  let text
  if (typeof value === 'number') text = Number.isFinite(value) ? String(value) : ''
  else if (value instanceof Date) text = Number.isNaN(value.getTime()) ? '' : value.toISOString()
  else {
    text = String(value)
    if (DANGEROUS_START.test(text)) text = `'${text}`
  }
  if (/[",;\r\n]/.test(text) || /^\s|\s$/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

/**
 * Filas → texto CSV con BOM y fin de línea CRLF.
 * @param {unknown[][]} rows
 * @param {{ bom?: boolean, delimiter?: string }} [options]
 */
export function toCSV(rows, { bom = true, delimiter = ',' } = {}) {
  const body = rows.map((row) => row.map(csvCell).join(delimiter)).join('\r\n')
  return `${bom ? BOM : ''}${body}\r\n`
}

/**
 * Objetos → CSV con las columnas indicadas (encabezado = label).
 * @template T
 * @param {T[]} items
 * @param {{ key: keyof T | ((item: T) => unknown), label: string }[]} columns
 * @param {{ bom?: boolean }} [options]
 */
export function objectsToCSV(items, columns, options) {
  const header = columns.map((c) => c.label)
  const rows = items.map((item) => columns.map((c) => (typeof c.key === 'function' ? c.key(item) : item[c.key])))
  return toCSV([header, ...rows], options)
}

/**
 * Adivina el separador con la primera línea: coma, punto y coma o tabulador. Excel en español
 * guarda con punto y coma porque la coma es su separador decimal.
 * @param {string} text
 * @returns {',' | ';' | '\t'}
 */
export function detectDelimiter(text) {
  let src = String(text ?? '')
  if (src.startsWith(BOM)) src = src.slice(1)
  const firstLine = src.split(/\r?\n/, 1)[0] ?? ''
  const counts = /** @type {const} */ ([',', ';', '\t']).map((d) => ({ d, n: firstLine.split(d).length - 1 }))
  counts.sort((a, b) => b.n - a.n)
  return counts[0].n > 0 ? counts[0].d : ','
}

/**
 * Número escrito como lo escribe una persona en México o en Europa: "1,234.56", "1.234,56",
 * "1234,56", "$1,060.50", "−12,5". Con las dos marcas, la que va al final es la decimal. Con una
 * sola coma: si agrupa de tres en tres ("1,234") son miles; si no ("1234,56"), es decimal. Con
 * `decimalComma` (archivos separados por punto y coma) la coma siempre es decimal y el punto
 * siempre agrupa miles, así que "1.234" es mil doscientos treinta y cuatro.
 * @param {unknown} text
 * @param {{ decimalComma?: boolean }} [options]
 * @returns {number | null} null si la celda está vacía; NaN si no se puede leer como número
 */
export function parseLocaleNumber(text, { decimalComma = false } = {}) {
  if (text === null || text === undefined) return null
  let s = String(text)
    .trim()
    .replace(/\u2212/g, '-')
    .replace(/[$\s\u00a0\u202f]|MXN|USD/gi, '')
  if (s === '') return null
  if (!/^[-+]?[\d.,]+$/.test(s)) return Number.NaN
  const commas = (s.match(/,/g) ?? []).length
  const dots = (s.match(/\./g) ?? []).length
  const unsigned = s.replace(/^[-+]/, '')
  // Un grupo de miles no empieza en 0: "0,375" es decimal, no trescientos setenta y cinco.
  const grouped = (/** @type {string} */ mark) => new RegExp(`^[1-9]\\d{0,2}(\\${mark}\\d{3})+$`).test(unsigned)
  if (commas && dots) {
    const decimal = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.'
    const group = decimal === ',' ? '.' : ','
    if ((decimal === ',' ? commas : dots) > 1) return Number.NaN
    s = s.split(group).join('').replace(decimal, '.')
  } else if (commas) {
    if (decimalComma) {
      if (commas > 1) return Number.NaN
      s = s.replace(',', '.')
    } else if (grouped(',')) s = s.replace(/,/g, '')
    else if (commas === 1) s = s.replace(',', '.')
    else return Number.NaN
  } else if (dots) {
    if (grouped('.') && (decimalComma || dots > 1)) s = s.replace(/\./g, '')
    else if (dots > 1) return Number.NaN
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : Number.NaN
}

/**
 * Texto CSV → filas de texto. Quita el BOM, respeta comillas (con "" escapadas) y saltos de
 * línea dentro de comillas, y acepta CRLF o LF. Con `unguard` quita el apóstrofo que toCSV
 * agrega a las celdas que parecían fórmula.
 * @param {string} text
 * @param {{ delimiter?: string, unguard?: boolean, skipEmptyLines?: boolean }} [options]
 * @returns {string[][]}
 */
export function parseCSV(text, { delimiter, unguard = false, skipEmptyLines = true } = {}) {
  let src = String(text ?? '')
  if (src.startsWith(BOM)) src = src.slice(1)
  const sep = delimiter ?? detectDelimiter(src)
  /** @type {string[][]} */
  const rows = []
  /** @type {string[]} */
  let row = []
  let cell = ''
  let quoted = false
  let i = 0
  const pushCell = () => {
    row.push(unguard && /^'+[=+\-@\t\r]/.test(cell) ? cell.slice(1) : cell)
    cell = ''
  }
  const pushRow = () => {
    pushCell()
    if (!(skipEmptyLines && row.length === 1 && row[0] === '')) rows.push(row)
    row = []
  }
  while (i < src.length) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i += 2
          continue
        }
        quoted = false
        i += 1
        continue
      }
      cell += ch
      i += 1
      continue
    }
    if (ch === '"' && cell === '') {
      quoted = true
      i += 1
      continue
    }
    if (ch === sep) {
      pushCell()
      i += 1
      continue
    }
    if (ch === '\r' || ch === '\n') {
      pushRow()
      i += ch === '\r' && src[i + 1] === '\n' ? 2 : 1
      continue
    }
    cell += ch
    i += 1
  }
  if (cell !== '' || row.length > 0) pushRow()
  return rows
}

/**
 * Primera fila como encabezado → objetos. Encabezados sin espacios alrededor.
 * @param {string[][]} rows
 * @returns {Record<string, string>[]}
 */
export function rowsToObjects(rows) {
  if (rows.length === 0) return []
  const header = rows[0].map((h) => h.trim())
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
}

/**
 * Descarga un CSV en el navegador.
 * @param {string} filename
 * @param {string} text resultado de toCSV
 */
export function downloadCSV(filename, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
