// Envoltura común de las páginas legales: encabezado, aviso de borrador y ligas entre ellas.
import { Link } from 'react-router'
import { Badge, PageHeader } from '../../components/ui/index.js'
import { PATHS } from '../../app/paths.js'
import './legal.css'

const LINKS = [
  { to: PATHS.legalTerms, label: 'Términos de uso' },
  { to: PATHS.legalPrivacy, label: 'Aviso de privacidad' },
  { to: PATHS.legalNotice, label: 'Aviso legal' },
]

export function LegalLayout({ title, description, updated = '23 de septiembre de 2026', children }) {
  return (
    <article className="legal-page">
      <PageHeader eyebrow="Legales" title={title} description={description} />
      <p className="legal-draft">
        <Badge tone="warning">Borrador</Badge>
        <span>Texto pendiente de revisión legal. Última actualización: {updated}.</span>
      </p>
      {children}
      <nav aria-label="Otros documentos legales">
        <ul className="legal-links">
          {LINKS.map((link) => (
            <li key={link.to}>
              <Link to={link.to}>{link.label}</Link>
            </li>
          ))}
        </ul>
      </nav>
    </article>
  )
}
