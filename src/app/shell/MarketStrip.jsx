// Tira compacta de mercado en la barra superior: IPC, S&P 500, USD/MXN, CETES 28 y VIX con valor
// y cambio, y un DataStatus para toda la tira. En pantallas angostas se desplaza dentro de su
// propio contenedor, nunca empuja la página a lo ancho, y el borde con cifras ocultas se desvanece. Solo consulta cuando el API v2 está listo
// y anuncia la capacidad "markets.overview" en /health: la tira va completa o no va (CETES 28 sale
// además de /v2/rates/mx). Con el servidor viejo, dormido, caído o sin esa capacidad no manda nada
// y dice "Sin datos".
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { DataStatus, Delta } from '../../components/ui/index.js'
import { useCapabilities } from '../../lib/api/capabilities.js'
import { marketsOverviewQuery, ratesMxQuery } from '../../lib/api/queries.js'
import { MISSING, fmtNumber } from '../../lib/format.js'
import { mergeMeta, stripItems } from './strip-model.js'

/**
 * Sin valor tampoco hay cambio: un solo "s/d" y no "VIX s/d s/d".
 * @param {{ item: import('./strip-model.js').StripItem }} props
 */
export function StripCell({ item }) {
  const value = item.value === null ? MISSING : `${fmtNumber(item.value, { decimals: item.decimals })}${item.suffix ?? ''}`
  return (
    <li className="kz-strip__item" title={item.title}>
      <span className="kz-strip__label">{item.label}</span>
      <span className="kz-strip__value num" data-missing={item.value === null || undefined}>
        {value}
      </span>
      {item.value === null && item.change == null ? null : (
        <Delta className="kz-strip__delta" direction={item.direction} hint={item.hint} kind={item.changeKind} value={item.change} />
      )}
    </li>
  )
}

/**
 * Si la tira no cabe: tabIndex 0 para desplazarla con el teclado, y qué borde tiene cifras ocultas
 * ('end' al principio, 'start' al final, 'both' en medio) para desvanecer ese borde con una máscara.
 * @returns {[import('react').RefObject<HTMLDivElement | null>, boolean, 'start' | 'end' | 'both' | undefined]}
 */
function useOverflow() {
  const ref = useRef(/** @type {HTMLDivElement | null} */ (null))
  const [state, setState] = useState(/** @type {{ overflow: boolean, fade?: 'start' | 'end' | 'both' }} */ ({ overflow: false }))
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const check = () => {
      const overflow = el.scrollWidth > el.clientWidth + 1
      const hiddenStart = overflow && el.scrollLeft > 1
      const hiddenEnd = overflow && el.scrollLeft + el.clientWidth < el.scrollWidth - 1
      const fade = hiddenStart && hiddenEnd ? 'both' : hiddenStart ? 'start' : hiddenEnd ? 'end' : undefined
      setState((prev) => (prev.overflow === overflow && prev.fade === fade ? prev : { overflow, fade }))
    }
    const ro = new ResizeObserver(check)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    el.addEventListener('scroll', check, { passive: true })
    check()
    return () => {
      ro.disconnect()
      el.removeEventListener('scroll', check)
    }
  }, [])
  return [ref, state.overflow, state.fade]
}

export default function MarketStrip() {
  const [scrollRef, overflow, fade] = useOverflow()
  const { status, capabilities } = useCapabilities()
  const ready = status === 'ready' && Boolean(capabilities?.has('markets.overview'))
  const overview = useQuery({ ...marketsOverviewQuery(), enabled: ready })
  const rates = useQuery({ ...ratesMxQuery(), enabled: ready && Boolean(capabilities?.has('rates.mx')) })
  const items = stripItems(overview.data, rates.data)
  const meta = mergeMeta(overview.data?.meta, rates.data?.meta)
  const loading = ready && (overview.isFetching || rates.isFetching) && !overview.data
  return (
    <section aria-busy={loading || undefined} aria-label="Mercado en breve" className="kz-strip">
      <div
        aria-label={overflow ? 'Cifras del mercado, desplázate para ver todas' : 'Cifras del mercado'}
        className="kz-strip__scroll"
        data-fade={fade}
        ref={/** @type {import('react').RefObject<HTMLDivElement>} */ (scrollRef)}
        role="group"
        tabIndex={overflow ? 0 : undefined}
      >
        <ul className="kz-strip__list">
          {items.map((item) => (
            <StripCell item={item} key={item.id} />
          ))}
        </ul>
      </div>
      <div className="kz-strip__status">
        {meta ? <DataStatus {...meta} /> : <span className="kz-strip__empty">{loading ? 'Actualizando' : 'Sin datos'}</span>}
      </div>
    </section>
  )
}
