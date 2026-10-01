// Página provisional (prep M5): la reemplaza el stream dueño de src/features/rates/.
import { ProvisionalPage } from '../../../app/ProvisionalPage.jsx'
import { PATHS } from '../../../app/paths.js'

export default function RatesPage() {
  return (
    <ProvisionalPage
      title="Tasas y curvas"
      description="Curvas de rendimiento de México y Estados Unidos, mercado de dinero, expectativas de la encuesta de Banxico y tasa real, cada nodo con su fecha."
      eyebrow="Mercados"
      breadcrumbs={[{ label: 'Mercados', to: PATHS.markets }, { label: 'Tasas y curvas' }]}
    />
  )
}
