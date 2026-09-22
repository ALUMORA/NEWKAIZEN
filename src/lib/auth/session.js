// Sesión de la persona: token del API v2 guardado en sessionStorage (dura lo que la pestaña) y
// copiado en memoria. Forma guardada en sessionStorage["kaizen.session"]:
//
//   { token: string | null, expiresAt: ISO, user: { username, displayName } }
//
// En `npm run dev` con VITE_SKIP_LOGIN=true hay una sesión sintética (token null, 12 h) si no
// hay una guardada. import.meta.env.DEV es false en cualquier build, así que esa rama no existe
// en producción.
import { useSyncExternalStore } from 'react'
import { buildUrl } from '../api/config.js'
import { ApiError, request } from '../api/http.js'

export const SESSION_KEY = 'kaizen.session'
const DEV_SESSION_HOURS = 12
/** El login puede caer en un arranque en frío de Render: se le da más margen que a un GET. */
const LOGIN_TIMEOUT_MS = 60_000

/**
 * @typedef {{ username: string, displayName: string }} SessionUser
 * @typedef {{ token: string | null, expiresAt: string, user: SessionUser, dev?: boolean }} Session
 * @typedef {'expired' | 'unauthorized' | 'logout'} EndReason
 */

/** @type {Session | null | undefined} undefined = todavía no se lee el storage */
let current
/** @type {EndReason | null} */
let endReason = null
const listeners = new Set()

function storage() {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

/**
 * Valida y normaliza una sesión (la que manda /auth/login o la guardada). null si no sirve.
 * @param {any} raw
 * @returns {Session | null}
 */
export function normalizeSession(raw) {
  if (!raw || typeof raw !== 'object') return null
  const token = raw.token
  if (token !== null && (typeof token !== 'string' || token === '')) return null
  if (typeof raw.expiresAt !== 'string' || Number.isNaN(Date.parse(raw.expiresAt))) return null
  const user = raw.user
  if (!user || typeof user !== 'object' || typeof user.username !== 'string' || !user.username) return null
  const displayName = typeof user.displayName === 'string' && user.displayName.trim() ? user.displayName : user.username
  /** @type {Session} */
  const session = { token, expiresAt: new Date(Date.parse(raw.expiresAt)).toISOString(), user: { username: user.username, displayName } }
  if (raw.dev === true) session.dev = true
  return Object.freeze(session)
}

/** @param {Session | null | undefined} session @param {number} [now] */
export function isExpired(session, now = Date.now()) {
  return !session || Date.parse(session.expiresAt) <= now
}

/** @returns {Session | null} */
function devSession() {
  if (import.meta.env.DEV && import.meta.env.VITE_SKIP_LOGIN === 'true') {
    return Object.freeze({
      token: null,
      expiresAt: new Date(Date.now() + DEV_SESSION_HOURS * 3_600_000).toISOString(),
      user: { username: 'dev', displayName: 'Dev' },
      dev: true,
    })
  }
  return null
}

function readStored() {
  const store = storage()
  if (!store) return null
  try {
    const raw = store.getItem(SESSION_KEY)
    if (!raw) return null
    const session = normalizeSession(JSON.parse(raw))
    if (!session || isExpired(session)) {
      store.removeItem(SESSION_KEY)
      return null
    }
    return session
  } catch {
    return null
  }
}

function ensureLoaded() {
  if (current === undefined) current = readStored() ?? devSession()
  return current
}

function notify() {
  for (const fn of [...listeners]) fn()
}

/** @param {Session} session */
function persist(session) {
  current = session
  endReason = null
  const store = storage()
  if (store && !session.dev) {
    try {
      store.setItem(SESSION_KEY, JSON.stringify(session))
    } catch {
      /* storage bloqueado: la sesión dura lo que la página */
    }
  }
  notify()
}

/**
 * Sesión vigente o null. Si ya venció, la cierra (motivo "expired").
 * @returns {Session | null}
 */
export function getSession() {
  const session = ensureLoaded()
  if (session && isExpired(session)) {
    clearSession('expired')
    return null
  }
  return session ?? null
}

/** Token para el header Authorization, o null. */
export function getToken() {
  return getSession()?.token ?? null
}

export function isAuthenticated() {
  return getSession() !== null
}

/**
 * Cierra la sesión y avisa a los suscriptores.
 * @param {EndReason} [reason]
 */
export function clearSession(reason = 'logout') {
  const had = ensureLoaded() != null
  current = null
  endReason = reason
  const store = storage()
  try {
    store?.removeItem(SESSION_KEY)
  } catch {
    /* nada que borrar */
  }
  if (had) notify()
}

export function logout() {
  clearSession('logout')
}

/**
 * Por qué terminó la última sesión, sin consumirlo (se puede leer en render). Se limpia al
 * entrar de nuevo.
 * @returns {EndReason | null}
 */
export function peekEndReason() {
  return endReason
}

/**
 * Por qué terminó la última sesión (para el aviso de la pantalla de login). Se consume: la
 * segunda llamada devuelve null.
 * @returns {EndReason | null}
 */
export function consumeEndReason() {
  const reason = endReason
  endReason = null
  return reason
}

/** @param {() => void} fn @returns {() => void} */
export function subscribeSession(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/**
 * POST /auth/login. Guarda la sesión si sale bien; si no, lanza ApiError (401 credenciales,
 * 429 demasiados intentos con retryAfter, status 0 sin red).
 * @param {string} username
 * @param {string} password
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<Session>}
 */
export async function login(username, password, { signal } = {}) {
  const data = await request(buildUrl('/auth/login'), {
    method: 'POST',
    body: { username, password },
    signal,
    timeoutMs: LOGIN_TIMEOUT_MS,
  })
  const session = normalizeSession(data)
  if (!session || session.token === null) {
    throw new ApiError({ status: 200, code: 'INVALID_RESPONSE', message: 'El servidor respondió algo inesperado al iniciar sesión.' })
  }
  if (isExpired(session)) {
    throw new ApiError({ status: 200, code: 'INVALID_RESPONSE', message: 'La sesión que mandó el servidor ya venció. Revisa la hora de tu equipo.' })
  }
  persist(session)
  return session
}

function snapshot() {
  return ensureLoaded() ?? null
}

/**
 * Hook: sesión actual (o null). Se actualiza al entrar, salir, vencer o recibir un 401.
 * Ojo: no cierra por vencimiento en render; eso lo hace SessionProvider con un timer.
 * @returns {Session | null}
 */
export function useSession() {
  return useSyncExternalStore(subscribeSession, snapshot, snapshot)
}

/** Solo pruebas: olvida la copia en memoria para volver a leer el storage. */
export function resetSessionForTests() {
  current = undefined
  endReason = null
  listeners.clear()
}
