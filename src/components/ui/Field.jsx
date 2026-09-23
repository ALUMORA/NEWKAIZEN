import { createContext, useContext, useId, useState } from 'react'
import { ChevronDown, CircleAlert } from 'lucide-react'
import { cn } from '../../cn.js'
import { formatForInput, parseNumber, sameNumber } from './number.js'

const FieldContext = createContext(
  /** @type {{ inputId: string, describedBy: string | undefined, invalid: boolean, required: boolean } | null} */ (null),
)

/**
 * Etiqueta, ayuda y error alrededor de un control. Conecta los ids solo: el
 * label apunta al control con htmlFor y el control apunta a la ayuda y al error
 * con aria-describedby, que es lo que hace que un lector de pantalla lea "Monto,
 * editable, en pesos, error: escribe un número".
 *
 * Se usa directo cuando el control es propio; Input, Select y NumberInput lo
 * ponen solos cuando les pasas label, hint o error.
 *
 * @param {object} props
 * @param {import('react').ReactNode} [props.label]
 * @param {import('react').ReactNode} [props.hint] ayuda que se ve siempre
 * @param {import('react').ReactNode} [props.error] mensaje de error; también marca aria-invalid
 * @param {boolean} [props.required] asterisco visual y required en el control
 * @param {string} [props.id] id del control (por omisión, uno único)
 * @param {string} [props.className]
 * @param {import('react').ReactNode} props.children
 */
export function Field({ label, hint, error, required = false, id, className, children }) {
  const auto = useId()
  const inputId = id ?? `campo${auto}`
  const hintId = hint ? `${inputId}-ayuda` : undefined
  const errorId = error ? `${inputId}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <FieldContext.Provider value={{ inputId, describedBy, invalid: Boolean(error), required }}>
      <div className={cn('kz-form-field', className)}>
        {label && (
          <label className="kz-label" htmlFor={inputId}>
            {label}
            {required && (
              <span className="kz-label__required" aria-hidden="true">
                *
              </span>
            )}
          </label>
        )}
        {children}
        {hint && (
          <p className="kz-hint" id={hintId}>
            {hint}
          </p>
        )}
        {error && (
          <p className="kz-error-text" id={errorId}>
            <CircleAlert size={14} aria-hidden="true" />
            {error}
          </p>
        )}
      </div>
    </FieldContext.Provider>
  )
}

/** Ids y estado del Field de arriba, mezclados con lo que traiga el control. */
function useControl({ id, required, describedBy, invalid }) {
  const field = useContext(FieldContext)
  const auto = useId()
  const own = [describedBy, field?.describedBy].filter(Boolean).join(' ') || undefined
  return {
    id: id ?? field?.inputId ?? `ctrl${auto}`,
    describedBy: own,
    invalid: Boolean(invalid ?? field?.invalid),
    required: Boolean(required ?? field?.required),
  }
}

/** Envuelve en un Field solo cuando trae etiqueta, ayuda o error y no está ya dentro de uno. */
function useNeedsField({ label, hint, error }) {
  const field = useContext(FieldContext)
  return !field && Boolean(label || hint || error)
}

/**
 * Prefijo o sufijo pegado al campo ("$", "%", "MXN"). Lleva id para que el
 * control lo nombre en aria-describedby: "%" también es información.
 */
function Adorned({ prefix, suffix, baseId, invalid, disabled, children }) {
  if (!prefix && !suffix) return children
  return (
    <span className="kz-input-wrap" data-invalid={invalid || undefined} data-disabled={disabled || undefined}>
      {prefix && (
        <span className="kz-input-wrap__affix" id={`${baseId}-pre`}>
          {prefix}
        </span>
      )}
      {children}
      {suffix && (
        <span className="kz-input-wrap__affix" id={`${baseId}-suf`}>
          {suffix}
        </span>
      )}
    </span>
  )
}

const affixIds = (baseId, prefix, suffix) =>
  [prefix ? `${baseId}-pre` : null, suffix ? `${baseId}-suf` : null].filter(Boolean).join(' ') || undefined

/**
 * Campo de texto.
 * @param {object} props
 * @param {import('react').ReactNode} [props.label]
 * @param {import('react').ReactNode} [props.hint]
 * @param {import('react').ReactNode} [props.error]
 * @param {boolean} [props.required]
 * @param {boolean} [props.numeric] alinea a la derecha con cifras tabulares
 * @param {import('react').ReactNode} [props.prefix] texto corto antes del valor ("$")
 * @param {import('react').ReactNode} [props.suffix] texto corto después ("MXN", "%")
 * @param {string} [props.id]
 * @param {string} [props.className]
 */
export function Input({ label, hint, error, required, ...rest }) {
  const wrap = useNeedsField({ label, hint, error })
  if (wrap) {
    return (
      <Field label={label} hint={hint} error={error} required={required} id={rest.id}>
        <BareInput {...rest} />
      </Field>
    )
  }
  return <BareInput required={required} {...rest} />
}

function BareInput({ numeric = false, prefix, suffix, className, id, required, type = 'text', ...rest }) {
  const c = useControl({ id, required, describedBy: rest['aria-describedby'], invalid: rest['aria-invalid'] })
  return (
    <Adorned prefix={prefix} suffix={suffix} baseId={c.id} invalid={c.invalid} disabled={rest.disabled}>
      <input
        {...rest}
        id={c.id}
        type={type}
        className={cn('kz-input', className)}
        data-numeric={numeric || undefined}
        aria-describedby={[c.describedBy, affixIds(c.id, prefix, suffix)].filter(Boolean).join(' ') || undefined}
        aria-invalid={c.invalid || undefined}
        required={c.required || undefined}
      />
    </Adorned>
  )
}

/**
 * Lista de opciones. Es un <select> nativo a propósito: en celular abre la rueda
 * del sistema, que se usa mejor que cualquier lista hecha a mano.
 *
 * @param {object} props
 * @param {{ value: string, label: string, disabled?: boolean }[]} props.options
 * @param {string} [props.placeholder] primera opción vacía ("Elige una opción")
 * @param {import('react').ReactNode} [props.label]
 * @param {import('react').ReactNode} [props.hint]
 * @param {import('react').ReactNode} [props.error]
 * @param {boolean} [props.required]
 * @param {string} [props.id]
 * @param {string} [props.className]
 */
export function Select({ label, hint, error, required, ...rest }) {
  const wrap = useNeedsField({ label, hint, error })
  if (wrap) {
    return (
      <Field label={label} hint={hint} error={error} required={required} id={rest.id}>
        <BareSelect {...rest} />
      </Field>
    )
  }
  return <BareSelect required={required} {...rest} />
}

function BareSelect({ options, placeholder, className, id, required, ...rest }) {
  const c = useControl({ id, required, describedBy: rest['aria-describedby'], invalid: rest['aria-invalid'] })
  return (
    <span className="kz-select-wrap">
      <select
        {...rest}
        id={c.id}
        className={cn('kz-select', className)}
        aria-describedby={c.describedBy}
        aria-invalid={c.invalid || undefined}
        required={c.required || undefined}
      >
        {placeholder != null && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown className="kz-select-wrap__caret" size={16} aria-hidden="true" />
    </span>
  )
}

/**
 * Campo numérico en es-MX ("1,234.56"). No es <input type="number"> porque ese
 * no deja escribir la coma de miles, cambia el valor con la rueda del ratón y
 * cada navegador lo valida distinto.
 *
 * Mientras se teclea se respeta el texto tal cual y `onChange` recibe el número
 * leído, o null si no se entiende o está vacío; al salir del campo se reescribe
 * ya agrupado. Si `value` cambia desde afuera (un botón "usar máximo"), el
 * campo se vuelve a dibujar, salvo que la persona esté escribiendo en él.
 *
 * @param {object} props
 * @param {number | null} [props.value]
 * @param {(value: number | null) => void} props.onChange
 * @param {number} [props.decimals] decimales al reformatear al salir; por omisión los que traiga
 * @param {import('react').ReactNode} [props.label]
 * @param {import('react').ReactNode} [props.hint]
 * @param {import('react').ReactNode} [props.error]
 * @param {boolean} [props.required]
 * @param {import('react').ReactNode} [props.prefix]
 * @param {import('react').ReactNode} [props.suffix]
 * @param {string} [props.id]
 * @param {string} [props.className]
 */
export function NumberInput({ label, hint, error, required, ...rest }) {
  const wrap = useNeedsField({ label, hint, error })
  if (wrap) {
    return (
      <Field label={label} hint={hint} error={error} required={required} id={rest.id}>
        <BareNumberInput {...rest} />
      </Field>
    )
  }
  return <BareNumberInput required={required} {...rest} />
}

function BareNumberInput({ value, onChange, decimals, prefix, suffix, className, id, required, onFocus, onBlur, ...rest }) {
  const c = useControl({ id, required, describedBy: rest['aria-describedby'], invalid: rest['aria-invalid'] })
  const [text, setText] = useState(() => formatForInput(value, decimals))
  const [editing, setEditing] = useState(false)
  const [seen, setSeen] = useState(value)

  // Valor nuevo desde afuera: se ajusta el texto durante el render (patrón de
  // "estado derivado" de React), no en un efecto que pintaría dos veces.
  if (!editing && value !== seen) {
    setSeen(value)
    if (!sameNumber(text, value)) setText(formatForInput(value, decimals))
  }

  return (
    <Adorned prefix={prefix} suffix={suffix} baseId={c.id} invalid={c.invalid} disabled={rest.disabled}>
      <input
        {...rest}
        id={c.id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        className={cn('kz-input', className)}
        data-numeric="true"
        value={text}
        aria-describedby={[c.describedBy, affixIds(c.id, prefix, suffix)].filter(Boolean).join(' ') || undefined}
        aria-invalid={c.invalid || undefined}
        required={c.required || undefined}
        onFocus={(event) => {
          setEditing(true)
          onFocus?.(event)
        }}
        onChange={(event) => {
          const parsed = parseNumber(event.target.value)
          setText(event.target.value)
          setSeen(parsed)
          onChange(parsed)
        }}
        onBlur={(event) => {
          setEditing(false)
          const parsed = parseNumber(event.target.value)
          setText(formatForInput(parsed, decimals))
          onBlur?.(event)
        }}
      />
    </Adorned>
  )
}
