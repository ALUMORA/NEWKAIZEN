// /legal/terminos
import { LegalLayout } from '../LegalLayout.jsx'

export default function Terms() {
  return (
    <LegalLayout title="Términos de uso" description="Las reglas para usar Kaizen, en corto y sin letra chiquita.">
      <h2>Qué es Kaizen</h2>
      <p>
        Kaizen es una herramienta educativa y de análisis para inversionistas de a pie. Te ayuda a ver tus
        inversiones, entender métricas y hacer cuentas. No es una casa de bolsa, no ejecuta operaciones y no
        administra dinero de nadie.
      </p>
      <h2>No es una recomendación de inversión</h2>
      <p>
        Nada de lo que ves en Kaizen es una recomendación para comprar, vender o mantener un instrumento. Las
        cifras, gráficas, simulaciones y filtros sirven para entender y comparar. Las decisiones son tuyas; si
        necesitas asesoría personalizada, busca a un asesor autorizado.
      </p>
      <h2>Los datos pueden fallar</h2>
      <ul>
        <li>Los precios vienen de fuentes públicas y pueden llegar con retraso, incompletos o con errores.</li>
        <li>Cuando un dato es viejo o viene de un respaldo, Kaizen te lo dice junto al número.</li>
        <li>Los rendimientos pasados no garantizan rendimientos futuros, y las simulaciones son escenarios, no promesas.</li>
      </ul>
      <h2>Tu parte</h2>
      <p>
        Usa Kaizen de buena fe, revisa las cifras importantes contra tu estado de cuenta y no intentes afectar el
        servicio ni a otras personas.
      </p>
      <h2>Cambios</h2>
      <p>Estos términos pueden cambiar. Cuando pase, actualizaremos la fecha de esta página.</p>
    </LegalLayout>
  )
}
