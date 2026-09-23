// Ganchos compartidos de las gráficas: ancho por ResizeObserver, movimiento reducido y un
// despachador por requestAnimationFrame para el puntero (un cálculo por cuadro, a 60 fps).
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/**
 * Ancho del elemento en px, medido antes de pintar y actualizado con ResizeObserver. El alto lo
 * fija la gráfica, así que medir el ancho no mueve nada alrededor.
 * @returns {[import('react').RefObject<HTMLDivElement>, number]}
 */
export function useWidth() {
  const ref = useRef(/** @type {HTMLDivElement | null} */ (null))
  const [width, setWidth] = useState(0)
  useIsoLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const measure = () => setWidth(Math.round(el.getBoundingClientRect().width))
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    let frame = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    })
    ro.observe(el)
    return () => {
      cancelAnimationFrame(frame)
      ro.disconnect()
    }
  }, [])
  return [ref, width]
}

/** true si el sistema pide menos movimiento. */
export function useReducedMotion() {
  const query = '(prefers-reduced-motion: reduce)'
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches)
  useEffect(() => {
    const mq = window.matchMedia?.(query)
    if (!mq) return undefined
    const on = () => setReduced(mq.matches)
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [])
  return reduced
}

/**
 * Envuelve un manejador para que corra a lo más una vez por cuadro con el último evento.
 * @template T
 * @param {(arg: T) => void} fn
 * @returns {(arg: T) => void}
 */
export function useRafHandler(fn) {
  const fnRef = useRef(fn)
  const frame = useRef(0)
  const last = useRef(/** @type {T | null} */ (null))
  useIsoLayoutEffect(() => {
    fnRef.current = fn
  })
  useEffect(() => () => cancelAnimationFrame(frame.current), [])
  return useCallback((arg) => {
    last.current = arg
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      fnRef.current(/** @type {T} */ (last.current))
    })
  }, [])
}
