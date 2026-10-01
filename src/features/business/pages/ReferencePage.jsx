// Página provisional (prep M5): la reemplaza el stream dueño de src/features/business/.
import { ProvisionalPage } from '../../../app/ProvisionalPage.jsx'
import { PATHS } from '../../../app/paths.js'

export default function ReferencePage() {
  return (
    <ProvisionalPage
      title="Valores de referencia"
      description="UMA, salario mínimo y otros valores oficiales por año, con convertidor de UMA a pesos y liga a la publicación."
      eyebrow="Empresas"
      breadcrumbs={[{ label: 'Empresas', to: PATHS.business }, { label: 'Valores de referencia' }]}
    />
  )
}
