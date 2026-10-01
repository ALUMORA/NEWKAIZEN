// Página provisional (prep M5): la reemplaza el stream dueño de src/features/economy/.
import { ProvisionalPage } from '../../../app/ProvisionalPage.jsx'
import { PATHS } from '../../../app/paths.js'

export default function EconomyPage() {
  return (
    <ProvisionalPage
      title="Economía de México y Estados Unidos"
      description="Inflación, crecimiento, empleo y otros indicadores con su última cifra, su cambio anual y la comparación entre países."
      eyebrow="Mercados"
      breadcrumbs={[{ label: 'Mercados', to: PATHS.markets }, { label: 'Economía de México y Estados Unidos' }]}
    />
  )
}
