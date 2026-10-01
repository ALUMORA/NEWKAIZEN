// Página provisional (prep M5): la reemplaza el stream dueño de src/features/business/.
import { ProvisionalPage } from '../../../app/ProvisionalPage.jsx'
import { PATHS } from '../../../app/paths.js'

export default function CounterpartiesPage() {
  return (
    <ProvisionalPage
      title="Salud financiera de contrapartes"
      description="Razones de liquidez, deuda y cobertura de intereses de clientes y proveedores que cotizan, lado a lado."
      eyebrow="Empresas"
      breadcrumbs={[{ label: 'Empresas', to: PATHS.business }, { label: 'Salud financiera de contrapartes' }]}
    />
  )
}
