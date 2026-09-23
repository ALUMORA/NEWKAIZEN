import { cn } from '../../cn.js'

/**
 * Botón. El tipo es 'button' salvo que se pida otro: un botón sin type dentro
 * de un formulario lo manda sin querer.
 *
 * @param {object} props
 * @param {'primary'|'secondary'|'ghost'|'danger'} [props.variant] primary por omisión
 * @param {'sm'|'md'} [props.size] md mide 38px (44px en pantalla chica), sm 30px (36px)
 * @param {boolean} [props.loading] deshabilita, marca aria-busy y cambia el icono por un giro
 * @param {import('react').ReactNode} [props.icon] icono al inicio (va aria-hidden)
 * @param {import('react').ReactNode} [props.iconEnd] icono al final (va aria-hidden)
 * @param {boolean} [props.block] ocupa todo el ancho
 * @param {'button'|'submit'|'reset'} [props.type]
 * @param {boolean} [props.disabled]
 * @param {string} [props.className]
 * @param {import('react').ReactNode} [props.children]
 */
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  iconEnd,
  block = false,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}) {
  return (
    <button
      type={type}
      className={cn('kz-button', className)}
      data-variant={variant}
      data-size={size}
      data-block={block || undefined}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <span className="kz-button__spinner" aria-hidden="true" />
      ) : (
        icon && (
          <span className="kz-button__icon" aria-hidden="true">
            {icon}
          </span>
        )
      )}
      {children}
      {iconEnd && !loading && (
        <span className="kz-button__icon" aria-hidden="true">
          {iconEnd}
        </span>
      )}
    </button>
  )
}

/**
 * Botón de solo icono. `label` es obligatorio: es el nombre accesible
 * (aria-label) y el title. Sin él el botón no dice qué hace.
 *
 * @param {object} props
 * @param {string} props.label
 * @param {'md'|'sm'} [props.size] md 38px (44px en pantalla chica), sm 30px; ninguno baja de 24px
 * @param {'plain'|'outline'} [props.variant]
 * @param {boolean} [props.pressed] para botones de alternar: pone aria-pressed
 * @param {string} [props.className]
 * @param {import('react').ReactNode} props.children icono
 */
export function IconButton({ label, size = 'md', variant = 'plain', pressed, className, children, type = 'button', ...rest }) {
  if (import.meta.env.DEV && !label) console.warn('IconButton sin label: el botón no tiene nombre accesible.')
  return (
    <button
      type={type}
      className={cn('kz-icon-button', className)}
      data-size={size}
      data-variant={variant}
      aria-label={label}
      aria-pressed={typeof pressed === 'boolean' ? pressed : undefined}
      title={label}
      {...rest}
    >
      <span className="kz-icon-button__icon" aria-hidden="true">
        {children}
      </span>
    </button>
  )
}
