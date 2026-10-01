// Página provisional de la fase 5: el orquestador la pone en cada ruta nueva para que la
// navegación, los títulos y las pruebas de rutas existan antes que la función. Cada stream
// reemplaza el archivo de su página (src/features/<x>/pages/*.jsx) y deja de usar esta.
import { Construction } from 'lucide-react'
import { EmptyState, PageHeader } from '../components/ui/index.js'

/**
 * @param {{ title: string, description: string, eyebrow?: string, breadcrumbs?: { label: string, to?: string }[] }} props
 */
export function ProvisionalPage({ title, description, eyebrow, breadcrumbs }) {
  return (
    <div className="kz-container kz-col" data-gap="6">
      <PageHeader title={title} description={description} eyebrow={eyebrow} breadcrumbs={breadcrumbs} />
      <EmptyState
        icon={<Construction size={20} />}
        title="Sección en construcción"
        text="Estamos armando esta página con datos públicos y gratuitos. Cuando esté lista aparecerá aquí, con su fuente y su fecha."
      />
    </div>
  )
}
