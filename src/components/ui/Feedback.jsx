import { CircleAlert, Inbox, RotateCw } from 'lucide-react'
import { cn } from '../../cn.js'
import { Button } from './Button.jsx'

/**
 * Bloque gris que ocupa el lugar del dato mientras carga, con la misma altura
 * que tendrá el contenido para que nada brinque al llegar. Es decorativo
 * (aria-hidden): quien lo usa anuncia la carga con aria-busy o un texto.
 *
 * @param {object} props
 * @param {number|string} [props.width] 100% por omisión
 * @param {number|string} [props.height] 14px por omisión
 * @param {number} [props.lines] varias líneas; la última queda al 60%
 * @param {'sm'|'full'} [props.radius] sm por omisión, full para círculos y pastillas
 * @param {string} [props.className]
 */
export function Skeleton({ width = '100%', height = 14, lines, radius = 'sm', className }) {
  if (lines && lines > 1) {
    return (
      <span className={cn('kz-skeleton-lines', className)} aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => (
          <span key={i} className="kz-skeleton" data-radius={radius} style={{ width: i === lines - 1 ? '60%' : width, height }} />
        ))}
      </span>
    )
  }
  return <span className={cn('kz-skeleton', className)} data-radius={radius} style={{ width, height }} aria-hidden="true" />
}

/**
 * Estado vacío que dice qué pasa y qué hacer, no solo "no hay nada".
 *
 * @param {object} props
 * @param {import('react').ReactNode} props.title
 * @param {import('react').ReactNode} [props.text]
 * @param {import('react').ReactNode} [props.icon] lucide u otro; Inbox por omisión
 * @param {import('react').ReactNode} [props.action] normalmente un <Button>
 * @param {'h2'|'h3'|'h4'|'p'} [props.headingAs] p por omisión, para no romper el orden de encabezados
 * @param {'md'|'sm'} [props.size]
 * @param {string} [props.className]
 */
export function EmptyState({ title, text, icon, action, headingAs = 'p', size = 'md', className }) {
  const Heading = headingAs
  return (
    <div className={cn('kz-empty', className)} data-size={size}>
      <span className="kz-empty__icon" aria-hidden="true">
        {icon ?? <Inbox size={20} />}
      </span>
      <Heading className="kz-empty__title">{title}</Heading>
      {text && <p className="kz-empty__text">{text}</p>}
      {action && <div className="kz-empty__action">{action}</div>}
    </div>
  )
}

/**
 * Algo falló al traer datos. Dice qué, en español llano, y ofrece reintentar.
 * Va con role="alert" para que el lector de pantalla lo anuncie al aparecer.
 *
 * @param {object} props
 * @param {import('react').ReactNode} [props.title] "No pudimos cargar los datos" por omisión
 * @param {import('react').ReactNode} [props.message] causa o siguiente paso
 * @param {() => void} [props.onRetry] muestra el botón de reintentar
 * @param {string} [props.retryLabel] "Reintentar" por omisión
 * @param {boolean} [props.retrying] pone el botón en carga
 * @param {'h2'|'h3'|'h4'|'p'} [props.headingAs]
 * @param {'md'|'sm'} [props.size]
 * @param {string} [props.className]
 */
export function ErrorState({
  title = 'No pudimos cargar los datos',
  message,
  onRetry,
  retryLabel = 'Reintentar',
  retrying = false,
  headingAs = 'p',
  size = 'md',
  className,
}) {
  const Heading = headingAs
  return (
    <div className={cn('kz-errorstate', className)} data-size={size} role="alert">
      <span className="kz-errorstate__icon" aria-hidden="true">
        <CircleAlert size={20} />
      </span>
      <Heading className="kz-errorstate__title">{title}</Heading>
      {message && <p className="kz-errorstate__text">{message}</p>}
      {onRetry && (
        <div className="kz-errorstate__action">
          <Button variant="secondary" size="sm" icon={<RotateCw size={14} />} loading={retrying} onClick={onRetry}>
            {retryLabel}
          </Button>
        </div>
      )}
    </div>
  )
}
