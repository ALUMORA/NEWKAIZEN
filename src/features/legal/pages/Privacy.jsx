// /legal/privacidad
import { LegalLayout } from '../LegalLayout.jsx'

export default function Privacy() {
  return (
    <LegalLayout title="Aviso de privacidad" description="Qué datos guarda Kaizen, dónde viven y para qué se usan.">
      <h2>Tus datos se quedan en tu navegador</h2>
      <p>
        Tu portafolio, tu lista de seguimiento y tus preferencias se guardan en el almacenamiento local de este
        navegador. No los mandamos a un servidor de Kaizen ni los compartimos con nadie. Si borras los datos del
        sitio o cambias de navegador, esa información no viaja contigo.
      </p>
      <h2>La sesión dura lo que dura la pestaña</h2>
      <p>
        Cuando inicias sesión, el permiso se guarda en el almacenamiento de sesión del navegador y se borra al
        cerrar la pestaña.
      </p>
      <h2>Qué sí sale de tu equipo</h2>
      <ul>
        <li>Las claves de los instrumentos que consultas, para pedir su precio o su historia al servidor de datos.</li>
        <li>Los datos técnicos normales de cualquier conexión, como la dirección IP, que el servidor puede registrar para operar y protegerse.</li>
      </ul>
      <p>No usamos cookies de publicidad ni vendemos información.</p>
      <h2>Tus derechos</h2>
      <p>
        Como casi todo vive en tu navegador, tú controlas esos datos: puedes exportarlos o borrarlos cuando quieras.
        Para cualquier duda sobre este aviso, escríbenos por el canal de contacto del proyecto.
      </p>
    </LegalLayout>
  )
}
