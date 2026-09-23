import { cn } from '../../cn.js'

/**
 * Etiqueta corta de estado. El tono nunca es la única señal: el texto de adentro
 * tiene que decir lo mismo que el color.
 *
 * @param {object} props
 * @param {'neutral'|'accent'|'positive'|'negative'|'warning'|'info'} [props.tone]
 * @param {'sm'|'md'} [props.size] sm 20px de alto, md 24px; las dos en 12px
 * @param {boolean} [props.dot] punto de color al inicio (decorativo)
 * @param {import('react').ReactNode} [props.icon] (decorativo)
 * @param {string} [props.className]
 * @param {import('react').ReactNode} props.children
 */
export function Badge({ tone = 'neutral', size = 'sm', dot = false, icon, className, children, ...rest }) {
  return (
    <span className={cn('kz-badge', className)} data-tone={tone} data-size={size} {...rest}>
      {dot && <span className="kz-badge__dot" aria-hidden="true" />}
      {icon && (
        <span className="kz-badge__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      {children}
    </span>
  )
}
