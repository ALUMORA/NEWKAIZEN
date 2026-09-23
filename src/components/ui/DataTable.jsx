import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { MISSING, fmtNumber } from '../../lib/format.js'
import { cn } from '../../cn.js'
import { EmptyState, ErrorState, Skeleton } from './Feedback.jsx'
import { InfoTip } from './InfoTip.jsx'
import { isMissing, nextSort, sortRows } from './table-sort.js'

/**
 * @typedef {object} DataTableColumn
 * @property {string} key llave en la fila (y del orden)
 * @property {import('react').ReactNode} header
 * @property {boolean} [numeric] alinea a la derecha con cifras tabulares; sin `format` pasa por fmtNumber
 * @property {'left'|'right'|'center'} [align] por omisión right si es numérica, left si no
 * @property {(value: any, row: any) => import('react').ReactNode} [format] cómo se pinta la celda
 * @property {boolean} [sortable]
 * @property {(row: any) => unknown} [sortValue] valor para ordenar (por omisión row[key])
 * @property {{ termKey?: string, term?: string, text?: import('react').ReactNode }} [info] InfoTip en el encabezado
 * @property {number|string} [minWidth]
 */

/**
 * Tabla de datos: encabezados que ordenan (aria-sort), cifras a la derecha, la
 * primera columna fija y el scroll horizontal DENTRO de su marco, nunca de la
 * página. Trae sus estados de carga, error y vacío.
 *
 * Con `onRowClick`, la primera celda es un botón (Tab llega a él, Enter o
 * Espacio lo activan y el lector de pantalla lo anuncia) y además la fila
 * entera responde al clic.
 *
 * @param {object} props
 * @param {DataTableColumn[]} props.columns
 * @param {any[]} [props.rows]
 * @param {string | ((row: any) => string)} props.rowKey
 * @param {string} props.caption qué es la tabla; obligatorio (nombra la tabla y su región)
 * @param {boolean} [props.captionHidden] el caption queda solo para lectores de pantalla
 * @param {{ key: string, direction: 'ascending'|'descending' } | null} [props.sort] orden controlado
 * @param {{ key: string, direction: 'ascending'|'descending' }} [props.defaultSort] orden inicial si no es controlado
 * @param {(sort: { key: string, direction: 'ascending'|'descending' }) => void} [props.onSortChange]
 * @param {(row: any) => void} [props.onRowClick]
 * @param {(row: any) => string} [props.rowLabel] nombre accesible del botón de fila ("Abrir WALMEX")
 * @param {boolean} [props.loading]
 * @param {number} [props.loadingRows] filas de esqueleto (5)
 * @param {import('react').ReactNode} [props.error] mensaje de error; muestra ErrorState
 * @param {() => void} [props.onRetry]
 * @param {{ title: import('react').ReactNode, text?: import('react').ReactNode, action?: import('react').ReactNode }} [props.empty]
 * @param {'comfortable'|'compact'} [props.density]
 * @param {boolean} [props.stickyFirstColumn] true por omisión
 * @param {number|string} [props.maxHeight] con alto máximo, el encabezado se queda fijo al hacer scroll
 * @param {string} [props.className]
 */
export function DataTable({
  columns,
  rows = [],
  rowKey,
  caption,
  captionHidden = false,
  sort: sortProp,
  defaultSort,
  onSortChange,
  onRowClick,
  rowLabel,
  loading = false,
  loadingRows = 5,
  error,
  onRetry,
  empty,
  density = 'comfortable',
  stickyFirstColumn = true,
  maxHeight,
  className,
}) {
  const captionId = useId()
  const [innerSort, setInnerSort] = useState(defaultSort ?? null)
  const sort = sortProp !== undefined ? sortProp : innerSort
  const sorted = useMemo(() => sortRows(rows, columns, sort), [rows, columns, sort])
  const scrollRef = useRef(/** @type {HTMLDivElement | null} */ (null))
  const [scrollable, setScrollable] = useState(false)

  // Solo cuando de verdad hay scroll horizontal el contenedor entra al orden de
  // tabulación (para moverlo con las flechas); si no, sería una parada vacía.
  useEffect(() => {
    const el = scrollRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(() => setScrollable(el.scrollWidth > el.clientWidth + 1))
    observer.observe(el)
    if (el.firstElementChild) observer.observe(el.firstElementChild)
    return () => observer.disconnect()
  }, [])

  const keyOf = (row, i) => (typeof rowKey === 'function' ? rowKey(row) : (row?.[rowKey] ?? i))
  const alignOf = (c) => c.align ?? (c.numeric ? 'right' : 'left')
  const showState = !loading && (error || sorted.length === 0)

  function activateSort(column) {
    const next = nextSort(sort, column)
    if (sortProp === undefined) setInnerSort(next)
    onSortChange?.(next)
  }

  function renderCell(column, row) {
    const value = row?.[column.key]
    if (column.format) return column.format(value, row)
    if (isMissing(value)) return MISSING
    return column.numeric && typeof value === 'number' ? fmtNumber(value) : value
  }

  return (
    <div className={cn('kz-table-frame', className)}>
      <div
        ref={scrollRef}
        className="kz-table-scroll"
        style={maxHeight ? { maxHeight } : undefined}
        tabIndex={scrollable ? 0 : undefined}
        role={scrollable ? 'region' : undefined}
        aria-labelledby={scrollable ? captionId : undefined}
        onScroll={(event) => {
          event.currentTarget.dataset.scrolled = event.currentTarget.scrollLeft > 0 ? 'true' : 'false'
        }}
      >
        <table
          className="kz-table"
          data-density={density}
          data-interactive={onRowClick ? 'true' : undefined}
          data-sticky-first={stickyFirstColumn ? 'true' : undefined}
          aria-busy={loading || undefined}
        >
          <caption id={captionId} className={captionHidden ? 'sr-only' : undefined}>
            {caption}
            {loading && <span className="sr-only"> (cargando)</span>}
          </caption>
          <thead>
            <tr>
              {columns.map((column) => {
                const active = sort?.key === column.key
                const Icon = !active ? ChevronsUpDown : sort.direction === 'ascending' ? ArrowUp : ArrowDown
                return (
                  <th
                    key={column.key}
                    scope="col"
                    data-align={alignOf(column)}
                    aria-sort={column.sortable && active ? sort.direction : undefined}
                    style={column.minWidth ? { minWidth: column.minWidth } : undefined}
                  >
                    <span className="kz-th">
                      {column.sortable ? (
                        <button type="button" className="kz-th-button" onClick={() => activateSort(column)}>
                          {column.header}
                          <Icon className="kz-sort-icon" size={12} aria-hidden="true" />
                        </button>
                      ) : (
                        column.header
                      )}
                      {column.info && <InfoTip term={typeof column.header === 'string' ? column.header : undefined} {...column.info} />}
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>
          {loading ? (
            <tbody>
              {Array.from({ length: loadingRows }, (_, i) => (
                <tr key={`sk-${i}`}>
                  {columns.map((column) => (
                    <td key={column.key} data-align={alignOf(column)}>
                      <Skeleton width={column.numeric ? 56 : 88} height={12} className="kz-table__skeleton" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ) : (
            !showState && (
              <tbody>
                {sorted.map((row, i) => (
                  <tr
                    key={keyOf(row, i)}
                    onClick={
                      onRowClick
                        ? (event) => {
                            const target = /** @type {HTMLElement} */ (event.target)
                            const hit = target.closest('a, button, input, select, textarea, [role="button"]')
                            if (hit && !hit.classList.contains('kz-table__rowbtn')) return
                            if (hit) return // el botón ya disparó su propio clic
                            onRowClick(row)
                          }
                        : undefined
                    }
                  >
                    {columns.map((column, c) => {
                      const content = renderCell(column, row)
                      const missing = content === MISSING
                      const Cell = c === 0 ? 'th' : 'td'
                      return (
                        <Cell key={column.key} scope={c === 0 ? 'row' : undefined} data-align={alignOf(column)} className={cn(missing && 'kz-missing')}>
                          {c === 0 && onRowClick ? (
                            <button
                              type="button"
                              className="kz-table__rowbtn"
                              aria-label={rowLabel ? rowLabel(row) : undefined}
                              onClick={() => onRowClick(row)}
                            >
                              {content}
                            </button>
                          ) : (
                            content
                          )}
                        </Cell>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            )
          )}
        </table>
      </div>
      {showState && (
        <div className="kz-table__state">
          {error ? (
            <ErrorState message={error === true ? undefined : error} onRetry={onRetry} size="sm" />
          ) : (
            <EmptyState size="sm" title={empty?.title ?? 'No hay datos que mostrar'} text={empty?.text} action={empty?.action} />
          )}
        </div>
      )}
    </div>
  )
}
