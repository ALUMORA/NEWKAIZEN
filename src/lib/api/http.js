// Núcleo HTTP sin sesión ni reintentos: arma el request, aplica el timeout, lee el cuerpo y
// convierte cualquier falla en ApiError con un mensaje en español apto para la persona.
// client.js (sesión + reintentos por arranque en frío) y session.js (login) se apoyan en esto.

/** Mensaje genérico por status cuando el API no mandó uno propio. */
export function genericMessage(status) {
  if (status === 0) return 'No pudimos conectar con el servidor. Revisa tu conexión e intenta de nuevo.'
  if (status === 400) return 'La solicitud no es válida.'
  if (status === 401) return 'Tu sesión terminó. Vuelve a entrar.'
  if (status === 403) return 'No tienes permiso para ver esto.'
  if (status === 404) return 'No encontramos lo que buscabas.'
  if (status === 408) return 'El servidor tardó demasiado en responder.'
  if (status === 422) return 'Revisa los datos enviados.'
  if (status === 429) return 'Hiciste demasiadas solicitudes seguidas. Espera un momento e intenta de nuevo.'
  if (status === 501) return 'Esta función todavía no está disponible en el servidor.'
  if (status >= 500) return 'El servidor tuvo un problema. Intenta de nuevo en unos minutos.'
  return 'Algo salió mal con la solicitud.'
}

/** Código del contrato v2 que corresponde a un status cuando el cuerpo no trae uno. */
export function codeForStatus(status) {
  if (status === 0) return 'NETWORK_ERROR'
  if (status === 400) return 'BAD_REQUEST'
  if (status === 401) return 'UNAUTHORIZED'
  if (status === 403) return 'FORBIDDEN'
  if (status === 404) return 'NOT_FOUND'
  if (status === 422) return 'VALIDATION_ERROR'
  if (status === 429) return 'RATE_LIMITED'
  if (status === 501) return 'NOT_IMPLEMENTED'
  if (status === 502 || status === 503 || status === 504) return 'UPSTREAM_UNAVAILABLE'
  if (status >= 500) return 'INTERNAL'
  return 'HTTP_ERROR'
}

/**
 * Retry-After en segundos. Acepta segundos ("30") o fecha HTTP.
 * @param {string | null | undefined} value
 * @param {number} [now]
 * @returns {number | null}
 */
export function parseRetryAfter(value, now = Date.now()) {
  if (value == null || value === '') return null
  const trimmed = String(value).trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed)
  const when = Date.parse(trimmed)
  if (Number.isNaN(when)) return null
  return Math.max(0, Math.ceil((when - now) / 1000))
}

/** Error de cualquier llamada al API. `status` 0 = no hubo respuesta (red o timeout). */
export class ApiError extends Error {
  /**
   * @param {{ status?: number, code?: string, message?: string, details?: unknown,
   *   retryAfter?: number | null, fromApi?: boolean, url?: string, cause?: unknown }} [init]
   */
  constructor({ status = 0, code, message, details = null, retryAfter = null, fromApi = false, url, cause } = {}) {
    super(message || genericMessage(status), cause === undefined ? undefined : { cause })
    this.name = 'ApiError'
    /** @type {number} */
    this.status = status
    /** @type {string} */
    this.code = code || codeForStatus(status)
    /** @type {unknown} */
    this.details = details
    /** Segundos que pidió esperar el servidor (429), si los dijo. @type {number | null} */
    this.retryAfter = retryAfter
    /** true si el cuerpo traía el sobre de error del contrato: el servidor sí está despierto. */
    this.fromApi = fromApi
    /** @type {string | undefined} */
    this.url = url
  }

  /**
   * @param {{ status: number, headers?: { get(name: string): string | null } }} res
   * @param {unknown} data cuerpo ya leído (JSON o texto)
   * @param {string} [url]
   */
  static fromResponse(res, data, url) {
    const status = res.status
    // Retry-After solo se puede leer desde otro origen si el API manda
    // Access-Control-Expose-Headers: Retry-After; si no, se usa details.retryAfter del sobre.
    const headerRetry = parseRetryAfter(res.headers?.get?.('retry-after'))
    const envelope = data && typeof data === 'object' ? /** @type {any} */ (data).error : undefined
    const detailsRetry = envelope && typeof envelope === 'object' ? Number(envelope.details?.retryAfter) : Number.NaN
    const retryAfter = headerRetry ?? (Number.isFinite(detailsRetry) && detailsRetry >= 0 ? Math.ceil(detailsRetry) : null)
    if (envelope && typeof envelope === 'object') {
      return new ApiError({
        status,
        code: typeof envelope.code === 'string' ? envelope.code : undefined,
        message: typeof envelope.message === 'string' && envelope.message.trim() ? envelope.message : undefined,
        details: envelope.details ?? null,
        retryAfter,
        fromApi: true,
        url,
      })
    }
    // Sin sobre del contrato (proxy de Render, HTML, texto o el {"error": "..."} del API viejo):
    // el texto crudo puede traer detalles técnicos, así que no se muestra; queda en details.
    const raw = typeof envelope === 'string' ? envelope : typeof data === 'string' ? data.slice(0, 300) : null
    return new ApiError({ status, retryAfter, details: raw ? { raw } : null, url })
  }
}

/** true si el error parece de arranque en frío o de red y vale la pena reintentar un GET. */
export function isColdStartError(err) {
  if (!(err instanceof ApiError)) return false
  if (err.code === 'NETWORK_ERROR' || err.code === 'TIMEOUT') return true
  // Un 502/503/504 con el sobre del contrato viene del API despierto (p. ej. Banxico caído):
  // reintentar no ayuda. Sin sobre, es el proxy mientras el servicio arranca.
  return (err.status === 502 || err.status === 503 || err.status === 504) && !err.fromApi
}

/** true si el error es una cancelación pedida por quien llamó (no se envuelve en ApiError). */
export function isAbortError(err) {
  return Boolean(err) && typeof err === 'object' && /** @type {any} */ (err).name === 'AbortError'
}

async function readBody(res) {
  if (res.status === 204 || res.status === 205) return null
  const type = res.headers?.get?.('content-type') ?? ''
  const text = await res.text()
  if (!text) return null
  if (type.includes('json') || /^[[{]/.test(text.trim())) {
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }
  return text
}

/**
 * Un request al API. Devuelve el cuerpo ya parseado o lanza ApiError. Si `signal` se cancela,
 * relanza el AbortError tal cual para que TanStack Query lo trate como cancelación.
 * @param {string} url URL absoluta
 * @param {{ method?: string, body?: unknown, headers?: Record<string, string>,
 *   signal?: AbortSignal, timeoutMs?: number }} [options]
 * @returns {Promise<any>}
 */
export async function request(url, { method = 'GET', body, headers = {}, signal, timeoutMs = 20_000 } = {}) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Operación cancelada', 'AbortError')

  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const forwardAbort = () => controller.abort()
  signal?.addEventListener('abort', forwardAbort, { once: true })

  /** @type {Record<string, string>} */
  const finalHeaders = { Accept: 'application/json', ...headers }
  let payload
  if (body !== undefined) {
    if (typeof FormData !== 'undefined' && body instanceof FormData) payload = body
    else {
      payload = JSON.stringify(body)
      finalHeaders['Content-Type'] = 'application/json'
    }
  }

  try {
    let res
    try {
      res = await fetch(url, {
        method,
        headers: finalHeaders,
        body: payload,
        signal: controller.signal,
        credentials: 'omit',
      })
    } catch (err) {
      if (signal?.aborted) throw signal.reason ?? err
      if (timedOut) {
        throw new ApiError({ status: 0, code: 'TIMEOUT', message: 'El servidor tardó demasiado en responder.', url, cause: err })
      }
      throw new ApiError({ status: 0, code: 'NETWORK_ERROR', url, cause: err })
    }
    let data
    try {
      data = await readBody(res)
    } catch (err) {
      if (signal?.aborted) throw signal.reason ?? err
      if (timedOut) {
        throw new ApiError({ status: 0, code: 'TIMEOUT', message: 'El servidor tardó demasiado en responder.', url, cause: err })
      }
      throw new ApiError({ status: res.status || 0, code: 'NETWORK_ERROR', url, cause: err })
    }
    if (!res.ok) throw ApiError.fromResponse(res, data, url)
    return data
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', forwardAbort)
  }
}

/**
 * Espera `ms` o hasta que `signal` se cancele (en ese caso rechaza con su motivo).
 * @param {number} ms
 * @param {AbortSignal} [signal]
 */
export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Operación cancelada', 'AbortError'))
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason ?? new DOMException('Operación cancelada', 'AbortError'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve(undefined)
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
