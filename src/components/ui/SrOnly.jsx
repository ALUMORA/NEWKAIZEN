/**
 * Texto solo para lectores de pantalla (usa .sr-only de theme.css).
 * @param {object} props
 * @param {'span'|'div'|'p'|'h2'|'h3'} [props.as]
 * @param {string} [props.id]
 * @param {import('react').ReactNode} props.children
 */
export function SrOnly({ as = 'span', children, ...rest }) {
  const Tag = as
  return (
    <Tag className="sr-only" {...rest}>
      {children}
    </Tag>
  )
}
