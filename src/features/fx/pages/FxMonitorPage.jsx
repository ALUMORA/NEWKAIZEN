// Página provisional (prep M5): la reemplaza el stream dueño de src/features/fx/.
import { ProvisionalPage } from '../../../app/ProvisionalPage.jsx'
import { PATHS } from '../../../app/paths.js'

export default function FxMonitorPage() {
  return (
    <ProvisionalPage
      title="Tipo de cambio"
      description="El peso frente al dólar: FIX, rango de 52 semanas, volatilidad, promedios mensuales y cruces con otras monedas."
      eyebrow="Mercados"
      breadcrumbs={[{ label: 'Mercados', to: PATHS.markets }, { label: 'Tipo de cambio' }]}
    />
  )
}
