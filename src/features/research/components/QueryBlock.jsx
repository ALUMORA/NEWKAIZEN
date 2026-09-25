// Estados de una consulta dentro de una sección: carga, error con reintento y vacío. Cada bloque
// de la ficha usa el suyo, así que una sección caída no tumba la página.
import { EmptyState, ErrorState, Skeleton, SrOnly } from '../../../components/ui/index.js'

/**
 * @param {{ query: { isPending: boolean, isError: boolean, error?: unknown, refetch: () => unknown, isFetching?: boolean },
 *   isEmpty?: boolean, emptyTitle?: string, emptyText?: string, lines?: number,
 *   children: import('react').ReactNode | (() => import('react').ReactNode) }} props
 */
export function QueryBlock({ query, isEmpty = false, emptyTitle = 'Sin datos', emptyText, lines = 4, reserve, children }) {
  if (query.isPending) {
    return (
      <div aria-busy="true" className={reserve ? 'kz-research-reserve' : undefined} data-reserve={reserve}>
        <SrOnly>Cargando</SrOnly>
        <Skeleton lines={lines} />
      </div>
    )
  }
  if (query.isError) {
    const message = query.error instanceof Error ? query.error.message : undefined
    return <ErrorState size="sm" message={message} onRetry={() => query.refetch()} retrying={Boolean(query.isFetching)} />
  }
  if (isEmpty) return <EmptyState size="sm" title={emptyTitle} text={emptyText} />
  return <>{typeof children === 'function' ? children() : children}</>
}
