// Buscador de claves con fichas (F3-2): el SearchCombobox de src/components/ui busca por nombre o
// clave y cada emisora elegida queda como ficha con su botón "Quitar" (clic, Enter, Espacio, Supr o
// Retroceso). El foco pasa a la ficha que queda en su lugar o, sin fichas, al campo. Sin búsqueda
// disponible, escribir claves separadas por coma y presionar Enter sigue funcionando.
import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useCapabilities } from '../../../lib/api/capabilities.js'
import { SearchCombobox } from '../../../components/ui/index.js'
import { addSymbols, removeSymbolAt, resolveEnter } from '../symbol-picker.js'

/**
 * @param {object} props
 * @param {string} props.label nombre del campo de búsqueda
 * @param {string} props.listLabel nombre de la lista de fichas
 * @param {readonly string[]} props.symbols claves elegidas
 * @param {(next: string[]) => void} props.onChange
 * @param {number} props.max
 * @param {import('react').ReactNode} [props.error] error de validación de quien envía el formulario
 */
export function SymbolPicker({ label, listLabel, symbols, onChange, max, error }) {
  const { status } = useCapabilities()
  const available = status === 'ready'
  const [text, setText] = useState('')
  const [message, setMessage] = useState('')
  const inputRef = useRef(/** @type {HTMLInputElement | null} */ (null))
  const chipRefs = useRef(/** @type {(HTMLButtonElement | null)[]} */ ([]))
  const pendingFocus = useRef(/** @type {number | null} */ (null))

  useEffect(() => {
    const target = pendingFocus.current
    if (target === null) return
    pendingFocus.current = null
    if (target >= 0) chipRefs.current[target]?.focus()
    else inputRef.current?.focus()
  }, [symbols])

  /** @param {string[]} incoming */
  function add(incoming) {
    const { next, repeated, overflow } = addSymbols(symbols, incoming, max)
    const notes = []
    if (repeated.length) notes.push(`${repeated.join(', ')} ya ${repeated.length === 1 ? 'está' : 'están'} en la lista.`)
    if (overflow.length) notes.push(`Caben hasta ${max} emisoras; ${overflow.join(', ')} ${overflow.length === 1 ? 'quedó' : 'quedaron'} fuera.`)
    setMessage(notes.join(' '))
    if (next.length !== symbols.length) onChange(next)
  }

  /** @param {number} index */
  function remove(index) {
    const { next, focus } = removeSymbolAt(symbols, index)
    pendingFocus.current = focus
    setMessage('')
    onChange(next)
  }

  const hint = available
    ? `Busca por nombre o clave y elige de la lista, hasta ${max}. También puedes escribir claves separadas por coma y presionar Enter.`
    : `La búsqueda por nombre no está disponible ahora: escribe las claves separadas por coma (hasta ${max}) y presiona Enter.`
  const shown = error || message

  return (
    <div className="kz-col kz-symbol-picker" data-gap="2">
      <SearchCombobox
        label={label}
        hint={hint}
        value={text}
        onValueChange={(v) => {
          setText(v)
          if (message) setMessage('')
        }}
        exclude={symbols}
        inputRef={inputRef}
        onSelect={(option) => add([String(option.symbol ?? option.label)])}
        onEnter={({ q, activeOption, searching, results }) => {
          const out = resolveEnter({ q, activeOption, searching, available, results })
          if (!out.handled) return false
          if (out.add.length) {
            add(out.add)
            setText('')
          } else {
            setMessage(out.message)
          }
          return true
        }}
      />
      {shown ? (
        <p className="kz-error-text" role="alert">
          {shown}
        </p>
      ) : null}
      {symbols.length ? (
        <ul className="kz-symbol-chips" aria-label={listLabel}>
          {symbols.map((s, i) => (
            <li key={s} className="kz-symbol-chip">
              <span className="mono">{s}</span>
              <button
                type="button"
                className="kz-symbol-chip__remove"
                aria-label={`Quitar ${s}`}
                ref={(el) => {
                  chipRefs.current[i] = el
                }}
                onClick={() => remove(i)}
                onKeyDown={(e) => {
                  if (e.key === 'Delete' || e.key === 'Backspace') {
                    e.preventDefault()
                    remove(i)
                  }
                }}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
