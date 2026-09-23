import { ExternalLink } from 'lucide-react'
import { Link, useInRouterContext } from 'react-router'
import { cn } from '../../cn.js'

const ABSOLUTE_URL = /^[a-z][a-z\d+.-]*:\/\//i
const SAFE_REL = ['noopener', 'noreferrer']

/**
 * `rel` para una liga que abre otra pestaña: lo que traiga el llamador más noopener y noreferrer,
 * sin repetir. Así la página de destino no alcanza `window.opener` ni recibe el Referer.
 * @param {string | undefined} rel
 * @returns {string}
 */
function safeRel(rel) {
  const tokens = String(rel ?? '')
    .split(/\s+/)
    .filter(Boolean)
  for (const token of SAFE_REL) if (!tokens.includes(token)) tokens.push(token)
  return tokens.join(' ')
}

/**
 * Liga dentro de un párrafo: color de acento y subrayado, para que no dependa solo del color.
 *
 * - `to`: ruta interna. Con router es un `<Link>` de react-router; sin router, un `<a href>`.
 * - `href`: liga cruda (ancla, correo o sitio de fuera). Si es absoluta (`https://...`) se trata
 *   como externa salvo `external={false}`.
 * - Externa: `target="_blank"`, `rel` con `noopener noreferrer` (se suman a lo que venga), icono
 *   decorativo y el aviso "(se abre en otra pestaña)" solo para lectores de pantalla.
 *
 * @param {object} props
 * @param {string} [props.to] ruta interna
 * @param {string} [props.href] liga cruda
 * @param {boolean} [props.external] fuerza (true) o evita (false) abrir en otra pestaña
 * @param {string} [props.rel]
 * @param {string} [props.className]
 * @param {import('react').ReactNode} props.children
 */
export function InlineLink({ to, href, external, rel, className, children, ...rest }) {
  const inRouter = useInRouterContext()
  const target = href ?? to ?? ''
  const isExternal = external ?? (href !== undefined && ABSOLUTE_URL.test(href))
  const classes = cn('kz-link', className)

  if (isExternal) {
    return (
      <a {...rest} className={classes} href={target} target="_blank" rel={safeRel(rel)}>
        {children}
        <ExternalLink className="kz-link__icon" size={12} aria-hidden="true" focusable="false" />
        <span className="sr-only"> (se abre en otra pestaña)</span>
      </a>
    )
  }
  if (to !== undefined && href === undefined && inRouter) {
    return (
      <Link {...rest} className={classes} to={to} rel={rel}>
        {children}
      </Link>
    )
  }
  return (
    <a {...rest} className={classes} href={target} rel={rest.target === '_blank' ? safeRel(rel) : rel}>
      {children}
    </a>
  )
}
