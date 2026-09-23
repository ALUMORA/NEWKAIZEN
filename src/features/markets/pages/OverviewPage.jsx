// /mercados: el panorama del día. Estado de la BMV y la NYSE, resumen factual, tablas sin
// duplicados, VIX con su percentil, tasas de EE. UU. en pb y el mundo en dólares. Cada sección pide
// solo lo que el servidor anuncia y tiene su propia carga, vacío y error.
import { Link } from 'react-router'
import { PageHeader } from '../../../components/ui/index.js'
import { PATHS } from '../../../app/paths.js'
import { ExchangesCard, SummaryCard } from '../overview/TodayCards.jsx'
import { GroupsSection } from '../overview/GroupsSection.jsx'
import { VixCard } from '../overview/VixCard.jsx'
import { UsRatesCard } from '../overview/UsRatesCard.jsx'
import { WorldCard } from '../overview/WorldCard.jsx'
import '../markets.css'

const MORE = [
  { to: PATHS.marketsMexico, title: 'México y tasas', text: 'Tasa objetivo de Banxico, TIIE, CETES, inflación, UDI y dólar FIX.' },
  { to: PATHS.marketsCetes, title: 'CETES', text: 'Tabla de la última subasta y calculadora con la retención de ISR.' },
  { to: PATHS.marketsNews, title: 'Noticias', text: 'Titulares de México y Estados Unidos con liga a la fuente.' },
]

function MoreLinks() {
  return (
    <nav className="kz-col" aria-labelledby="markets-more-title">
      <h2 id="markets-more-title" className="markets-more__title">
        Más de mercados
      </h2>
      <ul className="markets-more">
        {MORE.map((m) => (
          <li key={m.to}>
            <Link to={m.to} className="markets-more__link">
              <span className="markets-more__name">{m.title}</span>
              <span className="markets-more__text">{m.text}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export default function OverviewPage() {
  return (
    <div className="markets-page kz-container">
      <PageHeader
        eyebrow="Panorama"
        title="Mercados"
        description="Cómo van hoy México, Estados Unidos y el mundo. Cada cifra trae su fuente, su fecha y su retraso; si algo falta, lo decimos."
      />
      <div className="markets-top">
        <SummaryCard />
        <ExchangesCard />
      </div>
      <GroupsSection />
      <div className="markets-duo">
        <VixCard />
        <UsRatesCard />
      </div>
      <WorldCard />
      <MoreLinks />
      <p className="markets-formula">Esta página informa, no recomienda comprar ni vender nada.</p>
    </div>
  )
}
