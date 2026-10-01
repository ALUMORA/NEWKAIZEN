// Página provisional (prep M5): la reemplaza el stream dueño de src/features/funds/.
import { ProvisionalPage } from '../../../app/ProvisionalPage.jsx'
import { PATHS } from '../../../app/paths.js'

export default function XrayPage() {
  return (
    <ProvisionalPage
      title="Rayos X del portafolio"
      description="Exposición por sector y por emisora sumando tus acciones directas y lo que hay dentro de cada ETF, con la cobertura visible."
      eyebrow="Mi portafolio"
      breadcrumbs={[{ label: 'Mi portafolio', to: PATHS.portfolio }, { label: 'Rayos X del portafolio' }]}
    />
  )
}
