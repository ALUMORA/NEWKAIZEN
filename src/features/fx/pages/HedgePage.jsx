// Página provisional (prep M5): la reemplaza el stream dueño de src/features/fx/.
import { ProvisionalPage } from '../../../app/ProvisionalPage.jsx'
import { PATHS } from '../../../app/paths.js'

export default function HedgePage() {
  return (
    <ProvisionalPage
      title="Forward y presupuesto en dólares"
      description="Forward teórico del dólar por paridad de tasas y el impacto en pesos de tu presupuesto en dólares. No es cotización."
      eyebrow="Empresas"
      breadcrumbs={[{ label: 'Empresas', to: PATHS.business }, { label: 'Forward y presupuesto en dólares' }]}
    />
  )
}
