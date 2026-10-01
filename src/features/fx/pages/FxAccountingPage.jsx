// Página provisional (prep M5): la reemplaza el stream dueño de src/features/fx/.
import { ProvisionalPage } from '../../../app/ProvisionalPage.jsx'
import { PATHS } from '../../../app/paths.js'

export default function FxAccountingPage() {
  return (
    <ProvisionalPage
      title="Tipo de cambio contable"
      description="FIX de Banxico por fecha o con la regla del DOF, cierres de mes y conversión por lote para tu contabilidad."
      eyebrow="Empresas"
      breadcrumbs={[{ label: 'Empresas', to: PATHS.business }, { label: 'Tipo de cambio contable' }]}
    />
  )
}
