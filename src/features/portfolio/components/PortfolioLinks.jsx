// Ligas del resumen a las demás páginas de Mi portafolio, con una línea de qué hay en cada una.
import { Link } from 'react-router'
import { Card } from '../../../components/ui/index.js'
import { PATHS } from '../../../app/paths.js'

const LINKS = [
  { to: PATHS.portfolioTransactions, label: 'Movimientos', text: 'Compras, ventas, dividendos y depósitos. Importa o exporta tu libro en CSV.' },
  { to: PATHS.portfolioPerformance, label: 'Rendimiento', text: 'TWR y XIRR contra tu referencia, efecto del tipo de cambio e ISR estimado.' },
  { to: PATHS.portfolioRisk, label: 'Riesgo', text: 'Caídas, volatilidad, concentración y exposición al dólar.' },
  { to: PATHS.portfolioRebalance, label: 'Rebalanceo', text: 'Qué tan lejos estás de tus metas y el plan en títulos enteros.' },
]

export default function PortfolioLinks() {
  return (
    <Card title="Más de tu portafolio">
      <ul className="kz-portfolio-links">
        {LINKS.map((l) => (
          <li key={l.to}>
            <Link to={l.to} className="kz-portfolio-links__link">{l.label}</Link>
            <p className="kz-portfolio-hint">{l.text}</p>
          </li>
        ))}
      </ul>
    </Card>
  )
}
