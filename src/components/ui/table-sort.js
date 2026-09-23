// Orden de DataTable sin React: comparación estable, faltantes siempre al final.
import { isNum } from '../../lib/format.js'

/** @typedef {{ key: string, direction: 'ascending'|'descending' }} SortState */

const collator = new Intl.Collator('es-MX', { numeric: true, sensitivity: 'base' })

/** ¿Falta el dato? null, undefined, '' y números no finitos cuentan como faltantes. */
export function isMissing(value) {
  return value === null || value === undefined || value === '' || (typeof value === 'number' && !Number.isFinite(value))
}

/**
 * Valor por el que se ordena una fila en una columna.
 * @param {any} row
 * @param {{ key: string, sortValue?: (row: any) => unknown }} column
 */
export function sortValueOf(row, column) {
  return column.sortValue ? column.sortValue(row) : row?.[column.key]
}

/**
 * Filas ordenadas (copia). Los faltantes van al final en las dos direcciones:
 * "s/d" arriba de una tabla ordenada por rendimiento engaña.
 * @template T
 * @param {T[]} rows
 * @param {{ key: string, sortValue?: (row: T) => unknown }[]} columns
 * @param {SortState | null | undefined} sort
 * @returns {T[]}
 */
export function sortRows(rows, columns, sort) {
  if (!sort) return rows
  const column = columns.find((c) => c.key === sort.key)
  if (!column) return rows
  const factor = sort.direction === 'descending' ? -1 : 1
  return rows
    .map((row, index) => ({ row, index, value: sortValueOf(row, column) }))
    .sort((a, b) => {
      const am = isMissing(a.value)
      const bm = isMissing(b.value)
      if (am || bm) return am && bm ? a.index - b.index : am ? 1 : -1
      let cmp
      if (isNum(a.value) && isNum(b.value)) cmp = a.value - b.value
      else if (a.value instanceof Date && b.value instanceof Date) cmp = a.value.getTime() - b.value.getTime()
      else cmp = collator.compare(String(a.value), String(b.value))
      return cmp === 0 ? a.index - b.index : cmp * factor
    })
    .map((entry) => entry.row)
}

/**
 * Siguiente orden al activar una columna: la misma alterna; otra empieza
 * descendente si es numérica (lo más alto arriba) y ascendente si es texto.
 * @param {SortState | null | undefined} current
 * @param {{ key: string, numeric?: boolean }} column
 * @returns {SortState}
 */
export function nextSort(current, column) {
  if (current?.key === column.key) {
    return { key: column.key, direction: current.direction === 'ascending' ? 'descending' : 'ascending' }
  }
  return { key: column.key, direction: column.numeric ? 'descending' : 'ascending' }
}
