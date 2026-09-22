// Inicio de sesión mínimo y funcional: usuario + contraseña contra POST /auth/login
// (src/lib/auth/session.js). Al entrar vuelve a ?next (solo rutas internas). F5 lo rediseña.
import { useState } from 'react'
import { Navigate, useSearchParams } from 'react-router'
import { Eye, EyeOff, LineChart, Lock, Wallet } from 'lucide-react'
import { ApiError } from '../../../lib/api/http.js'
import { useCapabilities } from '../../../lib/api/capabilities.js'
import { isExpired, login, peekEndReason, useSession } from '../../../lib/auth/session.js'
import { safeNext } from '../../../app/paths.js'
import { Button, Mark } from '../../../ui.jsx'

const END_REASON_TEXT = {
  expired: 'Tu sesión venció. Vuelve a entrar para seguir.',
  unauthorized: 'Tu sesión ya no es válida. Vuelve a entrar para seguir.',
  logout: 'Cerraste tu sesión.',
}

/** "30 segundos", "1 minuto", "5 minutos", "2 horas". */
function humanWait(seconds) {
  if (seconds < 60) return seconds === 1 ? '1 segundo' : `${seconds} segundos`
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return minutes === 1 ? '1 minuto' : `${minutes} minutos`
  const hours = Math.ceil(minutes / 60)
  return hours === 1 ? '1 hora' : `${hours} horas`
}

/**
 * Mensaje para la persona según el error del login.
 * @param {unknown} err
 * @param {string} serverStatus estado de capabilities
 */
function loginErrorMessage(err, serverStatus) {
  if (!(err instanceof ApiError)) return 'No pudimos iniciar sesión. Intenta de nuevo.'
  if (err.status === 401) return 'Usuario o contraseña incorrectos.'
  if (err.status === 429) {
    return err.retryAfter
      ? `Demasiados intentos. Espera ${humanWait(err.retryAfter)} e intenta de nuevo.`
      : 'Demasiados intentos. Espera unos minutos e intenta de nuevo.'
  }
  if (err.status === 0) {
    return serverStatus === 'waking' || serverStatus === 'probing'
      ? 'El servidor está despertando. Espera unos segundos e intenta de nuevo.'
      : 'No pudimos conectar con el servidor. Revisa tu conexión e intenta de nuevo.'
  }
  if (serverStatus === 'legacy' || err.status === 404 || err.status === 405 || err.status === 501) {
    return 'El servidor todavía no tiene el nuevo inicio de sesión. Intenta más tarde.'
  }
  if (err.status >= 500) return 'El servidor tuvo un problema. Intenta de nuevo en unos minutos.'
  return err.message
}

export default function LoginPage() {
  const session = useSession()
  const [params] = useSearchParams()
  const { status: serverStatus } = useCapabilities()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(/** @type {string | null} */ (null))
  const next = safeNext(params.get('next'))

  if (session && !isExpired(session)) return <Navigate replace to={next} />

  const endReason = peekEndReason()
  const notice = !error && endReason ? END_REASON_TEXT[endReason] : null

  async function onSubmit(event) {
    event.preventDefault()
    if (submitting) return
    if (!username.trim() || !password) {
      setError('Escribe tu usuario y tu contraseña.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      // Al guardarse la sesión, este componente vuelve a renderizar y <Navigate> lleva a ?next.
      await login(username.trim(), password)
    } catch (err) {
      setError(loginErrorMessage(err, serverStatus))
      setSubmitting(false)
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <div className="auth-content">
          <div className="brand" style={{ marginBottom: 28 }}>
            <Mark size={64} />
            <span className="brand-wordmark">
              KAIZEN
              <small>Mercados, portafolio e investigación</small>
            </span>
          </div>
          <h1>Entra a Kaizen</h1>
          <p>Usa el usuario y la contraseña que te dio tu equipo o tu empresa.</p>
          <form className="auth-form" noValidate onSubmit={onSubmit}>
            {notice ? (
              <p className="kz-login-note" role="status">
                {notice}
              </p>
            ) : null}
            <label htmlFor="login-username">
              Usuario
              <input
                aria-describedby={error ? 'login-error' : undefined}
                aria-invalid={error ? true : undefined}
                autoCapitalize="none"
                autoComplete="username"
                autoCorrect="off"
                id="login-username"
                name="username"
                onChange={(e) => {
                  setUsername(e.target.value)
                  setError(null)
                }}
                required
                spellCheck={false}
                type="text"
                value={username}
              />
            </label>
            <div className="kz-field">
              <label htmlFor="login-password">Contraseña</label>
              <span className="password-field">
                <input
                  aria-describedby={error ? 'login-error' : undefined}
                  aria-invalid={error ? true : undefined}
                  autoComplete="current-password"
                  id="login-password"
                  name="password"
                  onChange={(e) => {
                    setPassword(e.target.value)
                    setError(null)
                  }}
                  required
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                />
                <button
                  aria-controls="login-password"
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  onClick={() => setShowPassword((v) => !v)}
                  type="button"
                >
                  {showPassword ? <EyeOff aria-hidden="true" size={17} /> : <Eye aria-hidden="true" size={17} />}
                </button>
              </span>
            </div>
            {error ? (
              <p className="form-error" id="login-error" role="alert">
                {error}
              </p>
            ) : null}
            <Button disabled={submitting} size="lg" type="submit">
              {submitting ? 'Entrando…' : 'Entrar'}
            </Button>
          </form>
        </div>
      </section>
      <aside aria-label="Qué encuentras en Kaizen" className="auth-aside">
        <div aria-hidden="true" className="auth-aside-orbit" />
        <blockquote>Datos claros para decidir con calma.</blockquote>
        <div className="auth-aside-proof">
          <span>
            <LineChart aria-hidden="true" size={18} />
            <span>
              <strong>Mercados de México y Estados Unidos</strong>
              Cada dato con su fuente y su fecha de actualización.
            </span>
          </span>
          <span>
            <Wallet aria-hidden="true" size={18} />
            <span>
              <strong>Tu portafolio en pesos</strong>
              Se guarda en este navegador; puedes exportarlo cuando quieras.
            </span>
          </span>
          <span>
            <Lock aria-hidden="true" size={18} />
            <span>
              <strong>Información, no recomendaciones</strong>
              Kaizen te ayuda a analizar; las decisiones son tuyas.
            </span>
          </span>
        </div>
      </aside>
    </main>
  )
}
