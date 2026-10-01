// Página provisional (prep M5): la reemplaza el stream dueño de src/features/business/.
import { ProvisionalPage } from '../../../app/ProvisionalPage.jsx'
import { PATHS } from '../../../app/paths.js'

export default function CapitalPage() {
  return (
    <ProvisionalPage
      title="Costo de capital"
      description="Costo de capital y WACC de tu empresa con la beta de su industria, la prima de mercado y la prima país."
      eyebrow="Empresas"
      breadcrumbs={[{ label: 'Empresas', to: PATHS.business }, { label: 'Costo de capital' }]}
    />
  )
}
