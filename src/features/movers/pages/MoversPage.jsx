// Página provisional (prep M5): la reemplaza el stream dueño de src/features/movers/.
import { ProvisionalPage } from '../../../app/ProvisionalPage.jsx'
import { PATHS } from '../../../app/paths.js'

export default function MoversPage() {
  return (
    <ProvisionalPage
      title="Movimientos del día"
      description="Las emisoras que más suben, bajan y se operan en México y Estados Unidos, la amplitud del mercado y el mapa por sector."
      eyebrow="Mercados"
      breadcrumbs={[{ label: 'Mercados', to: PATHS.markets }, { label: 'Movimientos del día' }]}
    />
  )
}
