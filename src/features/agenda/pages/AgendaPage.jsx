// Página provisional (prep M5): la reemplaza el stream dueño de src/features/agenda/.
import { ProvisionalPage } from '../../../app/ProvisionalPage.jsx'
import { PATHS } from '../../../app/paths.js'

export default function AgendaPage() {
  return (
    <ProvisionalPage
      title="Agenda de reportes y dividendos"
      description="Próximos reportes y dividendos de tu portafolio y tu lista, y la temporada de reportes de México y Estados Unidos."
      eyebrow="Mi portafolio"
      breadcrumbs={[{ label: 'Mi portafolio', to: PATHS.portfolio }, { label: 'Agenda de reportes y dividendos' }]}
    />
  )
}
