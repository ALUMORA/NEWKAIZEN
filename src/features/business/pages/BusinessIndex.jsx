// /empresas: índice de las herramientas para empresas. No tiene lista propia: lee la sección
// 'Empresas' de nav.js, así una página nueva aparece aquí en cuanto entra a la navegación.
import { Link } from 'react-router'
import { Card, PageHeader } from '../../../components/ui/index.js'
import { NAV_SECTIONS } from '../../../app/nav.js'

const SECTION = NAV_SECTIONS.find((s) => s.id === 'empresas')

export default function BusinessIndex() {
  const items = SECTION?.items ?? []
  return (
    <div className="kz-container kz-col" data-gap="6">
      <PageHeader
        title="Empresas"
        description="Herramientas para empresas chicas y medianas con datos públicos: tipo de cambio contable, actualización por INPC, costo de capital, crédito y contrapartes."
      />
      <Card title="Herramientas" titleAs="h2">
        <ul className="kz-col" data-gap="2">
          {items.map((item) => (
            <li key={item.id}>
              <Link to={item.to}>{item.label}</Link>
            </li>
          ))}
        </ul>
      </Card>
      <p className="kz-muted">Es información para decidir mejor, no asesoría fiscal ni financiera.</p>
    </div>
  )
}
