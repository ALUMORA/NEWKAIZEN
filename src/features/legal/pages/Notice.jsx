// /legal/aviso
import { Disclaimer } from '../../../components/ui/index.js'
import { LegalLayout } from '../LegalLayout.jsx'

export default function Notice() {
  return (
    <LegalLayout title="Aviso legal" description="Kaizen es una herramienta informativa: no da recomendaciones de inversión.">
      <Disclaimer variant="long" />
      <h2>Información, no asesoría</h2>
      <p>
        Kaizen no es una entidad financiera ni un asesor en inversiones. El contenido tiene fines educativos e
        informativos y no toma en cuenta tu situación, tus objetivos ni tu tolerancia al riesgo.
      </p>
      <h2>Riesgos</h2>
      <p>
        Invertir implica riesgo, incluida la pérdida del capital. Los instrumentos en otras monedas además cargan el
        riesgo del tipo de cambio.
      </p>
      <h2>Fuentes</h2>
      <p>
        Los datos de mercado vienen de fuentes públicas de terceros, como Banxico y proveedores de precios. Cada cifra
        indica su fuente y su fecha, y puede tener retraso.
      </p>
    </LegalLayout>
  )
}
