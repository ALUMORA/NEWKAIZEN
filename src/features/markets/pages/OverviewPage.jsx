// /mercados: el panorama del día. Estado de la BMV y la NYSE, resumen factual, tablas sin
// duplicados, VIX con su percentil, tasas de EE. UU. en pb y el mundo en dólares. Cada sección pide
// solo lo que el servidor anuncia y tiene su propia carga, vacío y error.
import { Link } from 'react-router'
import { PageHeader } from '../../../components/ui/index.js'
import { pathMethodology } from '../../../app/paths.js'
import { ExchangesCard, SummaryCard } from '../overview/TodayCards.jsx'
import { GroupsSection } from '../overview/GroupsSection.jsx'
import { VixCard } from '../overview/VixCard.jsx'
import { UsRatesCard } from '../overview/UsRatesCard.jsx'
import { WorldCard } from '../overview/WorldCard.jsx'
import { FirstSteps } from '../overview/FirstSteps.jsx'
import { MoreLinks } from './MoreLinks.jsx'
import '../markets.css'

export default function OverviewPage() {
  return (
    <div className="markets-page kz-container">
      <PageHeader
        eyebrow="Panorama"
        title="Mercados"
        description="Cómo van hoy México, Estados Unidos y el mundo. Cada cifra trae su fuente, su fecha y su retraso; si algo falta, lo decimos."
        actions={
          <Link className="kz-button" data-variant="secondary" data-size="sm" to={pathMethodology('mercados')}>
            Cómo se calcula
          </Link>
        }
      />
      <FirstSteps />
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
