import { Fragment } from 'react'
import { ChevronRight } from 'lucide-react'
import { Link, useInRouterContext } from 'react-router'
import { cn } from '../../cn.js'
import { InfoTip } from './InfoTip.jsx'

/**
 * Encabezado de página: el único h1. Lleva tabIndex=-1 y data-page-title para
 * que el shell (C3) le mueva el foco al cambiar de ruta sin que quede en el
 * orden de tabulación.
 *
 * @param {object} props
 * @param {import('react').ReactNode} props.title
 * @param {import('react').ReactNode} [props.description]
 * @param {import('react').ReactNode} [props.eyebrow] etiqueta corta en versalitas arriba del título
 * @param {import('react').ReactNode} [props.actions]
 * @param {{ label: string, to?: string }[]} [props.breadcrumbs] el último es la página actual
 * @param {string} [props.className]
 */
export function PageHeader({ title, description, eyebrow, actions, breadcrumbs, className }) {
  const inRouter = useInRouterContext()
  return (
    <header className={cn('kz-page-header', className)}>
      <div className="kz-page-header__copy">
        {breadcrumbs?.length ? (
          <nav aria-label="Ruta de navegación">
            <ol className="kz-breadcrumbs">
              {breadcrumbs.map((crumb, i) => {
                const last = i === breadcrumbs.length - 1
                return (
                  <Fragment key={`${crumb.label}-${i}`}>
                    <li>
                      {last || !crumb.to ? (
                        <span aria-current={last ? 'page' : undefined}>{crumb.label}</span>
                      ) : inRouter ? (
                        <Link to={crumb.to}>{crumb.label}</Link>
                      ) : (
                        <a href={crumb.to}>{crumb.label}</a>
                      )}
                    </li>
                    {!last && (
                      <li className="kz-breadcrumbs__sep" aria-hidden="true">
                        <ChevronRight size={12} />
                      </li>
                    )}
                  </Fragment>
                )
              })}
            </ol>
          </nav>
        ) : null}
        {eyebrow && <span className="kz-eyebrow">{eyebrow}</span>}
        <h1 className="kz-page-header__title" tabIndex={-1} data-page-title="">
          {title}
        </h1>
        {description && <p className="kz-page-header__description">{description}</p>}
      </div>
      {actions && <div className="kz-page-header__actions">{actions}</div>}
    </header>
  )
}

/**
 * Encabezado de sección (h2 por omisión).
 *
 * @param {object} props
 * @param {import('react').ReactNode} props.title
 * @param {import('react').ReactNode} [props.description]
 * @param {{ termKey?: string, term?: string, text?: import('react').ReactNode, label?: string, link?: boolean }} [props.info]
 * @param {import('react').ReactNode} [props.actions]
 * @param {'h2'|'h3'} [props.as]
 * @param {string} [props.id] id del encabezado, para aria-labelledby de la sección
 * @param {string} [props.className]
 */
export function SectionHeading({ title, description, info, actions, as = 'h2', id, className }) {
  const Heading = as
  return (
    <div className={cn('kz-section', className)}>
      <div className="kz-section__copy">
        <div className="kz-section__titleline">
          <Heading className="kz-section__title" id={id}>
            {title}
          </Heading>
          {info && <InfoTip term={typeof title === 'string' ? title : undefined} {...info} />}
        </div>
        {description && <p className="kz-section__description">{description}</p>}
      </div>
      {actions && <div className="kz-section__actions">{actions}</div>}
    </div>
  )
}
