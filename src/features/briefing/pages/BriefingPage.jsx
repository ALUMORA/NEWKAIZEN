// Página provisional (prep M5): la reemplaza el stream dueño de src/features/briefing/.
import { ProvisionalPage } from '../../../app/ProvisionalPage.jsx'
import { PATHS } from '../../../app/paths.js'

export default function BriefingPage() {
  return (
    <ProvisionalPage
      title="Resumen del día"
      description="FIX, tasas cortas, índices, las que más se mueven, el calendario y los titulares en una hoja que puedes imprimir."
      eyebrow="Mercados"
      breadcrumbs={[{ label: 'Mercados', to: PATHS.markets }, { label: 'Resumen del día' }]}
    />
  )
}
