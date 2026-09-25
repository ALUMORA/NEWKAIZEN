import { useId } from 'react'
import { cn } from '../../cn.js'
import { DataStatus } from './DataStatus.jsx'
import { InfoTip } from './InfoTip.jsx'

/**
 * Contenedor con encabezado, cuerpo y pie. El encabezado solo aparece si hay
 * algo que poner. Con título, la tarjeta es una región con nombre (el título).
 *
 * El título sale como h2 por omisión. Dentro de una sección que ya tiene h2,
 * titleAs="h3" para no romper el orden de encabezados.
 *
 * @param {object} props
 * @param {import('react').ReactNode} [props.title]
 * @param {'h2'|'h3'|'h4'} [props.titleAs]
 * @param {import('react').ReactNode} [props.description]
 * @param {{ termKey?: string, term?: string, text?: import('react').ReactNode, label?: string, link?: boolean }} [props.info] props de InfoTip junto al título
 * @param {import('react').ReactNode} [props.actions] botones a la derecha del encabezado
 * @param {import('./status.js').DataStatusMeta} [props.status] meta v2 del dato: DataStatus en el encabezado.
 *   Si se pasa la prop pero todavía vale undefined/null (el dato viene en camino), el encabezado
 *   guarda el lugar de la insignia para que no brinque la página cuando llegue.
 * @param {import('react').ReactNode} [props.footer]
 * @param {'md'|'none'} [props.padding] none quita el relleno del cuerpo (tablas, gráficas a sangre)
 * @param {string} [props.className]
 * @param {import('react').ReactNode} props.children
 */
export function Card(props) {
  const { title, titleAs = 'h2', description, info, actions, status, footer, padding = 'md', className, children, ...rest } = props
  const Title = titleAs
  const titleId = useId()
  const reserveStatus = !status && !actions && Object.prototype.hasOwnProperty.call(props, 'status')
  const hasHeader = Boolean(title || description || actions || status)
  return (
    <section className={cn('kz-card', className)} data-padding={padding} aria-labelledby={title ? titleId : undefined} {...rest}>
      {hasHeader && (
        <div className="kz-card__header">
          <div className="kz-card__heading">
            {title && (
              <div className="kz-card__titleline">
                <Title className="kz-card__title" id={titleId}>
                  {title}
                </Title>
                {info && <InfoTip term={typeof title === 'string' ? title : undefined} {...info} />}
              </div>
            )}
            {description && <p className="kz-card__description">{description}</p>}
          </div>
          {reserveStatus && <div className="kz-card__actions" data-reserve="" aria-hidden="true" />}
          {(actions || status) && (
            <div className="kz-card__actions">
              {status && <DataStatus {...status} />}
              {actions}
            </div>
          )}
        </div>
      )}
      <div className="kz-card__body">{children}</div>
      {footer && <div className="kz-card__footer">{footer}</div>}
    </section>
  )
}
