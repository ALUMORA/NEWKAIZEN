// Corre la simulación en el Web Worker de la librería financiera cuando el navegador lo tiene, y en
// este hilo cuando no (pruebas, navegadores viejos). Espera un momento después de cada tecla para no
// disparar una simulación por carácter, y descarta respuestas de peticiones que ya se reemplazaron.
import { useEffect, useRef, useState } from 'react'
import { fromMessage } from '../../lib/finance/montecarlo.js'
import { runSimulation, toSimulateOptions } from './simulator.js'

const DEBOUNCE_MS = 250

/**
 * @param {Record<string, number> | null} inputs `null` cuando hay campos inválidos
 * @returns {{ sim: any, status: 'idle' | 'running' | 'done' | 'error', error: string | null }}
 */
export function useSimulation(inputs) {
  const [state, setState] = useState({ sim: null, status: 'idle', error: null })
  const workerRef = useRef(/** @type {Worker | null} */ (null))
  const idRef = useRef(0)
  const key = inputs ? JSON.stringify(inputs) : ''

  useEffect(() => {
    return () => {
      workerRef.current?.terminate()
      workerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!key) return undefined
    const parsed = JSON.parse(key)
    const id = (idRef.current += 1)
    const timer = setTimeout(() => {
      setState((s) => ({ ...s, status: 'running' }))
      if (typeof Worker === 'undefined') {
        try {
          setState({ sim: runSimulation(parsed), status: 'done', error: null })
        } catch (err) {
          setState({ sim: null, status: 'error', error: err instanceof Error ? err.message : String(err) })
        }
        return
      }
      if (!workerRef.current) {
        workerRef.current = new Worker(new URL('../../lib/finance/montecarlo.worker.js', import.meta.url), { type: 'module' })
      }
      const worker = workerRef.current
      const onMessage = (/** @type {MessageEvent} */ event) => {
        if (event.data?.id !== id) return
        worker.removeEventListener('message', onMessage)
        if (!event.data.ok) {
          setState({ sim: null, status: 'error', error: String(event.data.error) })
          return
        }
        setState({ sim: fromMessage(event.data.result), status: 'done', error: null })
      }
      worker.addEventListener('message', onMessage)
      worker.postMessage({ id, options: toSimulateOptions(parsed) })
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [key])

  return state
}
