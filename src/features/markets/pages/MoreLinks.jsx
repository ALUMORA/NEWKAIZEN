// "Más de mercados": ligas a las otras páginas de Mercados, con una línea de qué hay en cada una.
// Lo usan el panorama y México; cada página pasa cuáles mostrar.
import { Link } from 'react-router'
import { PATHS } from '../../../app/paths.js'

/** Todas las páginas hermanas, en el orden de la navegación. */
const MARKETS_MORE = Object.freeze([
  { id: 'mexico', to: PATHS.marketsMexico, title: 'México', text: 'Tasa objetivo de Banxico, TIIE, CETES, inflación, UDI y dólar FIX.' },
  { id: 'resumen', to: PATHS.marketsBriefing, title: 'Resumen del día', text: 'FIX, tasas, índices, movimientos y calendario en una hoja que puedes imprimir.' },
  { id: 'tasas', to: PATHS.marketsRates, title: 'Tasas y curvas', text: 'Curvas de México y Estados Unidos, mercado de dinero y expectativas.' },
  { id: 'tipo-de-cambio', to: PATHS.marketsFx, title: 'Tipo de cambio', text: 'El peso frente al dólar y otras monedas, con su rango y su volatilidad.' },
  { id: 'economia', to: PATHS.marketsEconomy, title: 'Economía', text: 'Inflación, crecimiento y empleo de México y Estados Unidos.' },
  { id: 'calendario', to: PATHS.marketsCalendar, title: 'Calendario', text: 'Qué indicadores se publican esta semana y cuándo deciden Banxico y la Fed.' },
  { id: 'movimientos', to: PATHS.marketsMovers, title: 'Movimientos del día', text: 'Las que más suben, bajan y se operan, y el mapa por sector.' },
  { id: 'cetes', to: PATHS.marketsCetes, title: 'CETES', text: 'Tabla de la última subasta y calculadora con la retención de ISR.' },
  { id: 'noticias', to: PATHS.marketsNews, title: 'Noticias', text: 'Titulares de México y Estados Unidos con liga a la fuente.' },
])

/** @param {{ only?: string[] }} props ids de MARKETS_MORE que se muestran (todas sin la lista) */
export function MoreLinks({ only }) {
  const items = only ? MARKETS_MORE.filter((m) => only.includes(m.id)) : MARKETS_MORE
  return (
    <nav className="kz-col" aria-labelledby="markets-more-title">
      <h2 id="markets-more-title" className="markets-more__title">
        Más de mercados
      </h2>
      <ul className="markets-more">
        {items.map((m) => (
          <li key={m.to}>
            <Link to={m.to} className="markets-more__link">
              <span className="markets-more__name">{m.title}</span>
              <span className="markets-more__text">{m.text}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
