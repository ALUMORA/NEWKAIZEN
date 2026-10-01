// Página provisional (prep M5): la reemplaza el stream dueño de src/features/business/.
import { ProvisionalPage } from '../../../app/ProvisionalPage.jsx'
import { PATHS } from '../../../app/paths.js'

export default function CreditPage() {
  return (
    <ProvisionalPage
      title="Crédito a TIIE"
      description="Tabla de pagos de un crédito a TIIE o SOFR más sobretasa, con escenarios de 100 pb arriba y abajo."
      eyebrow="Empresas"
      breadcrumbs={[{ label: 'Empresas', to: PATHS.business }, { label: 'Crédito a TIIE' }]}
    />
  )
}
