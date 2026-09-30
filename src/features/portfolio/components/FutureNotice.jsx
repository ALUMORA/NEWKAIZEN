// Aviso de los movimientos con fecha futura que la página deja fuera por el corte del libro en hoy
// (lib/book-cut.js). Va en cada página de Mi portafolio que corta, para que nada desaparezca sin
// explicación.
import { futureNotice } from '../lib/book-cut.js'

/**
 * @param {{ count: number, where: string }} props `where`: a dónde entran, por ejemplo 'al plan'
 */
export default function FutureNotice({ count, where }) {
  const text = futureNotice(count, where)
  return text ? <p className="kz-portfolio-hint">{text}</p> : null
}
