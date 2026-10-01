// Página provisional (prep M5): la reemplaza el stream dueño de src/features/economy/.
import { ProvisionalPage } from '../../../app/ProvisionalPage.jsx'
import { PATHS } from '../../../app/paths.js'

export default function CalendarPage() {
  return (
    <ProvisionalPage
      title="Calendario económico"
      description="Publicaciones de indicadores y decisiones de Banxico y la Fed de México y Estados Unidos, por semana o por mes."
      eyebrow="Mercados"
      breadcrumbs={[{ label: 'Mercados', to: PATHS.markets }, { label: 'Calendario económico' }]}
    />
  )
}
