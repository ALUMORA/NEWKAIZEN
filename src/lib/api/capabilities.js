// Qué sabe hacer el backend al que apunta la app. Se sondea GET /health una vez al arrancar
// (CapabilitiesProvider) y el resultado queda en un store de módulo:
//
//   status: "probing"  todavía no contesta (menos de 3 s)
//           "waking"   tarda o falla con errores de arranque en frío (Render dormido); se
//                      reintenta hasta ~70 s y la UI muestra "Despertando el servidor…"
//           "ready"    API v2 (/health trae apiVersion)
//           "legacy"   API viejo: /health contesta {"status":"ok"} sin apiVersion
//           "down"     no contestó en ~70 s o contestó algo que no es /health
//
// Nunca bloquea la UI: las pantallas deciden qué hacer con cada estado.
import { useSyncExternalStore } from 'react'
import { API_BASE, buildUrl } from './config.js'
import { ApiError, isColdStartError, request, sleep } from './http.js'

/** A partir de cuánto tiempo sin respuesta se considera que el servidor está despertando. */
export const WAKING_AFTER_MS = 3_000
/** Esperas entre sondeos fallidos. Suman 67 s, más el último intento: ~70 s en total. */
export const PROBE_RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 20_000, 30_000]

/**
 * @typedef {'probing' | 'waking' | 'ready' | 'legacy' | 'down'} CapabilityStatus
 * @typedef {{
 *   status: CapabilityStatus,
 *   apiVersion: number | null,
 *   authRequired: boolean | null,
 *   capabilities: Set<string>,
 *   providers: Record<string, { ok?: boolean | null, configured?: boolean }>,
 *   version: string | null,
 *   commit: string | null,
 *   checkedAt: string | null,
 *   error: { status: number, code: string, message: string } | null,
 * }} CapabilitiesState
 */

/** @returns {CapabilitiesState} */
function initialState() {
  return {
    status: 'probing',
    apiVersion: null,
    authRequired: null,
    capabilities: new Set(),
    providers: {},
    version: null,
    commit: null,
    checkedAt: null,
    error: null,
  }
}

/** @type {CapabilitiesState} */
let state = initialState()
const listeners = new Set()
/** @type {Promise<CapabilitiesState> | null} */
let inflight = null
let generation = 0

function setState(patch) {
  state = { ...state, ...patch }
  for (const fn of [...listeners]) fn()
}

/** @returns {CapabilitiesState} */
export function getCapabilities() {
  return state
}

/** @param {() => void} fn @returns {() => void} */
export function subscribeCapabilities(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** @param {string} name p. ej. "history.dates" */
export function hasCapability(name) {
  return state.capabilities.has(name)
}

/**
 * Interpreta el cuerpo de /health.
 * @param {any} body
 * @returns {Omit<CapabilitiesState, 'checkedAt' | 'error'>}
 */
export function parseHealth(body) {
  if (!body || typeof body !== 'object' || body.status !== 'ok') {
    throw new ApiError({ status: 200, code: 'INVALID_HEALTH', message: 'El servidor respondió algo que no esperábamos.' })
  }
  const version = Number(body.apiVersion)
  if (body.apiVersion == null || !Number.isFinite(version)) {
    return {
      status: 'legacy',
      apiVersion: 1,
      // El API viejo no tiene sesiones: no se manda Authorization.
      authRequired: false,
      capabilities: new Set(),
      providers: {},
      version: null,
      commit: null,
    }
  }
  return {
    status: 'ready',
    apiVersion: version,
    authRequired: typeof body.authRequired === 'boolean' ? body.authRequired : true,
    capabilities: new Set(Array.isArray(body.capabilities) ? body.capabilities.filter((c) => typeof c === 'string') : []),
    providers: body.providers && typeof body.providers === 'object' ? body.providers : {},
    version: typeof body.version === 'string' ? body.version : null,
    commit: typeof body.commit === 'string' ? body.commit : null,
  }
}

/**
 * Un solo sondeo de /health, sin reintentos.
 * @param {{ signal?: AbortSignal, timeoutMs?: number, base?: string }} [options]
 */
export async function probeHealth({ signal, timeoutMs = 60_000, base = API_BASE } = {}) {
  const body = await request(buildUrl('/health', undefined, base), { signal, timeoutMs })
  return parseHealth(body)
}

async function runProbe(myGeneration, { delays = PROBE_RETRY_DELAYS_MS, wakingAfterMs = WAKING_AFTER_MS } = {}) {
  const wakingTimer = setTimeout(() => {
    if (generation === myGeneration && state.status === 'probing') setState({ status: 'waking' })
  }, wakingAfterMs)
  const started = Date.now()
  const budgetMs = delays.reduce((a, b) => a + b, 0) + 5_000
  try {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const remaining = Math.max(5_000, budgetMs - (Date.now() - started))
        const result = await probeHealth({ timeoutMs: remaining })
        if (generation === myGeneration) setState({ ...result, checkedAt: new Date().toISOString(), error: null })
        return state
      } catch (err) {
        const delay = delays[attempt]
        if (!isColdStartError(err) || delay === undefined) {
          if (generation === myGeneration) {
            const e = err instanceof ApiError ? err : new ApiError({ status: 0, code: 'NETWORK_ERROR' })
            setState({ status: 'down', checkedAt: new Date().toISOString(), error: { status: e.status, code: e.code, message: e.message } })
          }
          return state
        }
        if (generation === myGeneration && state.status !== 'waking') setState({ status: 'waking' })
        await sleep(delay)
        if (generation !== myGeneration) return state
      }
    }
  } finally {
    clearTimeout(wakingTimer)
  }
}

/**
 * Arranca el sondeo si no hay uno en curso. Idempotente: StrictMode lo llama dos veces.
 * @param {{ force?: boolean, delays?: number[], wakingAfterMs?: number }} [options]
 *   force: vuelve a sondear aunque ya haya resultado (botón "Reintentar", o un GET que falló
 *   por arranque en frío con el servidor marcado como listo).
 * @returns {Promise<CapabilitiesState>}
 */
export function startCapabilitiesProbe({ force = false, ...options } = {}) {
  if (inflight) return inflight
  if (!force && state.checkedAt) return Promise.resolve(state)
  generation += 1
  const mine = generation
  if (state.status !== 'waking' && state.status !== 'probing') setState({ status: 'probing' })
  inflight = runProbe(mine, options).finally(() => {
    if (generation === mine) inflight = null
  })
  return inflight
}

/** Hook: estado actual de capacidades. */
export function useCapabilities() {
  return useSyncExternalStore(subscribeCapabilities, getCapabilities, getCapabilities)
}

/** Solo pruebas: vuelve al estado inicial o fija uno. */
export function resetCapabilitiesForTests(patch) {
  generation += 1
  inflight = null
  state = { ...initialState(), ...(patch ?? {}) }
  for (const fn of [...listeners]) fn()
}
