// Setup común de Vitest. Corre en los dos proyectos (node y jsdom), así que todo lo que toca
// `window` va detrás de un guard. Qué deja listo:
// - matchers de jest-dom (toBeInTheDocument, toHaveTextContent, ...)
// - localStorage y sessionStorage en memoria cuando el entorno no los trae o vienen rotos
//   (Node 25+ expone un localStorage que es undefined sin --localstorage-file)
// - en jsdom: matchMedia, scrollTo/scrollIntoView, URL.createObjectURL/revokeObjectURL y
//   ResizeObserver, que jsdom no implementa
// - limpieza entre pruebas: DOM desmontado, storage vacío
import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'

export class MemoryStorage {
  #data = new Map()
  get length() { return this.#data.size }
  key(i) { return [...this.#data.keys()][i] ?? null }
  getItem(k) { return this.#data.has(String(k)) ? this.#data.get(String(k)) : null }
  setItem(k, v) { this.#data.set(String(k), String(v)) }
  removeItem(k) { this.#data.delete(String(k)) }
  clear() { this.#data.clear() }
}

function storageWorks(storage) {
  try {
    if (!storage || typeof storage.setItem !== 'function') return false
    storage.setItem('__kaizen_probe__', '1')
    const ok = storage.getItem('__kaizen_probe__') === '1'
    storage.removeItem('__kaizen_probe__')
    return ok
  } catch {
    return false
  }
}

// En jsdom, Vitest deja en globalThis el localStorage de Node (roto sin --localstorage-file)
// porque la llave ya existe; el Storage real de jsdom vive en globalThis.jsdom.window. Se usa
// ese cuando sirve (así vi.spyOn(Storage.prototype, 'setItem') funciona) y si no, uno en
// memoria. En node no se sondea globalThis.localStorage: leerlo imprime un ExperimentalWarning.
function installStorage(name) {
  const fromJsdom = globalThis.jsdom?.window?.[name]
  const storage = storageWorks(fromJsdom) ? fromJsdom : new MemoryStorage()
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: storage })
}

installStorage('localStorage')
installStorage('sessionStorage')

const hasWindow = typeof window !== 'undefined'

if (hasWindow) {
  if (typeof window.matchMedia !== 'function') {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: (query) => ({
        matches: false,
        media: String(query),
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    })
  }

  // jsdom define window.scrollTo pero lanza "Not implemented"; se reemplaza por un no-op.
  window.scrollTo = () => {}
  window.scroll = () => {}
  if (typeof Element !== 'undefined') {
    Element.prototype.scrollTo = function scrollTo() {}
    Element.prototype.scrollIntoView = function scrollIntoView() {}
  }

  // El URL global es el de Node y su createObjectURL no acepta el Blob de jsdom; se reemplaza
  // siempre por un stub que devuelve URLs blob: únicas.
  let blobCount = 0
  URL.createObjectURL = () => `blob:kaizen-test/${++blobCount}`
  URL.revokeObjectURL = () => {}

  if (typeof globalThis.ResizeObserver !== 'function') {
    globalThis.ResizeObserver = class ResizeObserver {
      constructor(callback) { this.callback = callback }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
}

afterEach(async () => {
  if (hasWindow) {
    const { cleanup } = await import('@testing-library/react')
    cleanup()
  }
  try { globalThis.localStorage?.clear() } catch { /* storage bloqueado a propósito por la prueba */ }
  try { globalThis.sessionStorage?.clear() } catch { /* idem */ }
  vi.useRealTimers()
})
