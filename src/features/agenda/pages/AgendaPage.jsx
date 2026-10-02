// /portafolio/agenda (V5PF): próximos reportes y dividendos de tu portafolio y tu lista, con la
// proyección de dividendos por mes, y la temporada de reportes de México o EE. UU. La pestaña y el
// universo viven en la URL (?vista=portafolio|temporada y ?universo=mx|us) para que se puedan
// compartir; con ?universo y sin ?vista abre directo la temporada.
import { useSearchParams } from 'react-router'
import { PageHeader, TabPanel, Tabs } from '../../../components/ui/index.js'
import { PATHS } from '../../../app/paths.js'
import PortfolioAgenda from '../components/PortfolioAgenda.jsx'
import SeasonAgenda from '../components/SeasonAgenda.jsx'
import '../agenda.css'

const TABS = [
  { id: 'portafolio', label: 'Mi portafolio y lista' },
  { id: 'temporada', label: 'Temporada de reportes' },
]

export default function AgendaPage() {
  const [params, setParams] = useSearchParams()
  const universe = params.get('universo') === 'us' ? 'us' : 'mx'
  const vista = params.get('vista')
  const tab = vista === 'temporada' || vista === 'portafolio' ? vista : params.has('universo') ? 'temporada' : 'portafolio'

  /** @param {Record<string, string>} patch */
  const patchParams = (patch) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const [k, v] of Object.entries(patch)) next.set(k, v)
        return next
      },
      { replace: true },
    )

  return (
    <div className="kz-page kz-col agenda-page" data-gap="6">
      <PageHeader
        title="Agenda de reportes y dividendos"
        description="Próximos reportes y dividendos de tu portafolio y tu lista, y la temporada de reportes de México y Estados Unidos."
        eyebrow="Mi portafolio"
        breadcrumbs={[{ label: 'Mi portafolio', to: PATHS.portfolio }, { label: 'Agenda de reportes y dividendos' }]}
      />
      <Tabs items={TABS} value={tab} onChange={(id) => patchParams({ vista: id })} label="Vistas de la agenda">
        <TabPanel id="portafolio">
          <PortfolioAgenda />
        </TabPanel>
        <TabPanel id="temporada">
          <SeasonAgenda universe={universe} onUniverseChange={(u) => patchParams({ vista: 'temporada', universo: u })} />
        </TabPanel>
      </Tabs>
    </div>
  )
}
