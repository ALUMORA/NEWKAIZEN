// Buscador de claves con fichas (F3-2): el SearchCombobox de src/components/ui busca por nombre o
// clave y cada emisora elegida queda como ficha con su botón "Quitar" (clic, Enter, Espacio, Supr o
// Retroceso). El foco pasa a la ficha que queda en su lugar o, sin fichas, al campo. Sin búsqueda
// disponible, escribir claves separadas por coma y presionar Enter sigue funcionando. Lo que quede
// escrito sin Enter también cuenta: el formulario llama `pickerRef.current.commit()` al enviar.
import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useCapabilities } from '../../../lib/api/capabilities.js'
import { searchQuery } from '../../../lib/api/queries.js'
import { SearchCombobox } from '../../../components/ui/index.js'
import { addSymbols, removeSymbolAt, resolveEnter } from '../symbol-picker.js'

/** @typedef {{ commit: () => Promise<string[] | null> }} SymbolPickerHandle */

/**
 * @param {object} props
 * @param {string} props.label nombre del campo de búsqueda
 * @param {string} props.listLabel nombre de la lista de fichas
 * @param {readonly string[]} props.symbols claves elegidas
 * @param {(next: string[]) => void} props.onChange
 * @param {number} props.max
 * @param {import('react').ReactNode} [props.error] error de validación de quien envía el formulario
 * @param {import('react').Ref<SymbolPickerHandle>} [props.pickerRef] `commit()` suma lo escrito sin
 *   Enter y devuelve la lista completa, o null si lo escrito no se pudo tomar (el aviso queda a la vista)
 */
export function SymbolPicker({ label, listLabel, symbols, onChange, max, error, pickerRef }) {
  const { status } = useCapabilities()
  const queryClient = useQueryClient()
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
    return { next, overflow }
  }

  /**
   * Resuelve lo escrito: claves, una clave contra la búsqueda o un aviso. Si la búsqueda no ha
   * llegado, la pide en ese momento (como la paleta) antes de decidir.
   * @param {Parameters<typeof resolveEnter>[0]} input
   */
  async function resolveTyped(input) {
    const out = resolveEnter(input)
    if (!out.lookup) return out
    try {
      const data = await queryClient.fetchQuery(searchQuery(out.lookup))
      return resolveEnter({ q: out.lookup, activeOption: null, searching: false, available: true, results: data?.results ?? [] })
    } catch {
      // Sin búsqueda en este momento: lo escrito se toma como claves.
      return resolveEnter({ q: out.lookup, activeOption: null, searching: false, available: false, results: [] })
    }
  }

  /** @param {{ add: string[], message: string }} out */
  function applyTyped(out) {
    if (!out.add.length) {
      setMessage(out.message)
      return null
    }
    setText('')
    return add(out.add)
  }

  useImperativeHandle(pickerRef, () => ({
    async commit() {
      if (!text.trim()) return [...symbols]
      // Al enviar no hay opción activa que valga: lo escrito se resuelve igual que con Enter.
      const done = applyTyped(await resolveTyped({ q: text, activeOption: null, searching: true, available, results: [] }))
      if (!done || done.overflow.length) return null
      return done.next
    },
  }))

  /** @param {number} index */
  function remove(index) {
    const { next, focus } = removeSymbolAt(symbols, index)
    pendingFocus.current = focus
    setMessage('')
    onChange(next)
  }

  const connecting = status === 'probing' || status === 'waking'
  const hint = available
    ? `Busca por nombre o clave y elige de la lista, hasta ${max}. También puedes escribir claves separadas por coma y presionar Enter.`
    : connecting
      ? `Conectando con el servidor para buscar por nombre. Mientras, escribe las claves separadas por coma (hasta ${max}) y presiona Enter.`
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
          if (out.lookup) resolveTyped({ q, activeOption: null, searching, available, results }).then(applyTyped)
          else applyTyped(out)
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
