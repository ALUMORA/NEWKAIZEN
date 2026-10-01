// Página provisional (prep M5): la reemplaza el stream dueño de src/features/business/.
import { ProvisionalPage } from '../../../app/ProvisionalPage.jsx'
import { PATHS } from '../../../app/paths.js'

export default function UpdatePage() {
  return (
    <ProvisionalPage
      title="Actualización por INPC"
      description="Factor de actualización con el INPC, recargos y ajuste de rentas o contratos, con la fórmula y las fechas a la vista."
      eyebrow="Empresas"
      breadcrumbs={[{ label: 'Empresas', to: PATHS.business }, { label: 'Actualización por INPC' }]}
    />
  )
}
