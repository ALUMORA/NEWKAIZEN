// Web Worker de la simulación. Diez mil trayectorias por 360 pasos tardan unos 210 ms; correrlas
// en el hilo principal congela la interfaz ese rato, así que aquí se sacan a un hilo aparte.
//
// El cascarón es a propósito de cuatro líneas: toda la lógica (validar, simular, empacar el
// resultado, empacar el error) vive en `handleWorkerRequest` de montecarlo.js, que sí se prueba
// sin levantar un worker.
//
// Cómo se usa desde una feature (Vite resuelve la URL en build):
//
//   const worker = new Worker(new URL('../../lib/finance/montecarlo.worker.js', import.meta.url),
//                             { type: 'module' })
//   worker.addEventListener('message', (e) => {
//     if (!e.data.ok) return mostrarError(e.data.error)
//     const sim = fromMessage(e.data.result)   // vuelve a traer probabilityAbove
//   })
//   worker.postMessage({ id: 1, options: { years: 30, mu: 0.08, sigma: 0.15, ... } })
//
// El `id` va y regresa tal cual, para poder ignorar respuestas de peticiones que ya se
// cancelaron (por ejemplo cuando alguien mueve un control y se disparan varias simulaciones).

import { handleWorkerRequest } from './montecarlo.js'

// `self` aquí es un DedicatedWorkerGlobalScope, que no está en la lib DOM que usa el typecheck:
// su postMessage recibe (mensaje, transferibles) y no lleva targetOrigin.
const scope = /** @type {any} */ (self)

scope.addEventListener('message', (/** @type {MessageEvent} */ event) => {
  const { message, transfer } = handleWorkerRequest(event.data)
  scope.postMessage(message, transfer)
})
