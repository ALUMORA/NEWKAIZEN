// Pie persistente: el aviso corto (Disclaimer de C1) y las ligas a /legal/*.
import { Link } from 'react-router'
import { Disclaimer } from '../../components/ui/index.js'
import { PATHS } from '../paths.js'

const LEGAL = [
  { to: PATHS.legalTerms, label: 'Términos de uso' },
  { to: PATHS.legalPrivacy, label: 'Aviso de privacidad' },
  { to: PATHS.legalNotice, label: 'Aviso legal' },
]

export default function Footer() {
  return (
    <footer className="kz-foot">
      <Disclaimer className="kz-foot__text" />
      <nav aria-label="Legal" className="kz-foot__nav">
        <ul className="kz-foot__links">
          {LEGAL.map((item) => (
            <li key={item.to}>
              <Link to={item.to}>{item.label}</Link>
            </li>
          ))}
        </ul>
      </nav>
    </footer>
  )
}
