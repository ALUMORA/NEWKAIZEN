// Buscador de emisoras (C1): combobox con lista (patrón de ARIA 1.2). El foco se queda en el campo
// y la opción activa se anuncia con aria-activedescendant. Busca en /v2/search 200 ms después de
// la última tecla, solo si el servidor ya dijo que es v2. Lo usa la paleta ⌘K del shell (en modo
// `inline`, con sus grupos de rutas y acciones) y cualquier página que necesite elegir emisoras.
import { useQuery } from '@tanstack/react-query'
import { useEffect, useId, useMemo, useState } from 'react'
import { cn } from '../../cn.js'
import { useCapabilities } from '../../lib/api/capabilities.js'
import { searchQuery } from '../../lib/api/queries.js'
import { SEARCH_DEBOUNCE_MS, comboboxStatus, defaultGroups, moveActive } from './search-combobox.js'

/** @param {string} value @param {number} ms */
function useDebounced(value, ms) {
  const [out, setOut] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setOut(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return out
}

/**
 * @typedef {import('./search-combobox.js').ComboboxOption} ComboboxOption
 * @typedef {import('./search-combobox.js').ComboboxGroup} ComboboxGroup
 * @typedef {import('./search-combobox.js').SearchResult} SearchResult
 */

/**
 * @param {object} props
 * @param {string} props.label nombre del campo (visible, o solo accesible con hideLabel)
 * @param {boolean} [props.hideLabel]
 * @param {import('react').ReactNode} [props.hint]
 * @param {string} [props.value] texto controlado
 * @param {string} [props.defaultValue]
 * @param {(value: string) => void} [props.onValueChange]
 * @param {(option: ComboboxOption, context: { q: string, results: SearchResult[] }) => void} [props.onSelect]
 * @param {(input: { q: string, results: SearchResult[] }) => ComboboxGroup[]} [props.getGroups]
 * @param {(input: { q: string, activeOption: ComboboxOption | null, searching: boolean, results: SearchResult[] }) => boolean} [props.onEnter]
 * @param {(option: ComboboxOption, state: { selected: boolean }) => import('react').ReactNode} [props.renderOption]
 * @param {readonly string[]} [props.exclude] símbolos que no se ofrecen (solo con los grupos por omisión)
 * @param {number} [props.limit]
 * @param {boolean} [props.inline] lista siempre visible, en el flujo (la paleta)
 * @param {boolean} [props.clearOnSelect]
 * @param {string} [props.placeholder]
 * @param {import('react').Ref<HTMLInputElement>} [props.inputRef]
 * @param {string} [props.id] id del campo
 * @param {string} [props.className]
 * @param {string} [props.inputClassName]
 * @param {boolean} [props.disabled]
 */
export function SearchCombobox({
  label,
  hideLabel = false,
  hint,
  value,
  defaultValue = '',
  onValueChange,
  onSelect,
  getGroups,
  onEnter,
  renderOption,
  exclude,
  limit = 8,
  inline = false,
  clearOnSelect = !inline,
  placeholder = 'Nombre o clave, por ejemplo WALMEX',
  inputRef,
  id,
  className,
  inputClassName,
  disabled = false,
}) {
  const autoId = `kz-cb-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const inputId = id ?? autoId
  const listId = `${inputId}-lista`
  const hintId = hint ? `${inputId}-ayuda` : undefined
  const [inner, setInner] = useState(defaultValue)
  const q = value ?? inner
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [lastQ, setLastQ] = useState(q)
  if (lastQ !== q) {
    // La opción activa regresa a la primera cada vez que cambia el texto.
    setLastQ(q)
    setActive(0)
  }

  const debounced = useDebounced(q.trim(), SEARCH_DEBOUNCE_MS)
  const { status } = useCapabilities()
  const available = status === 'ready'
  const search = useQuery({ ...searchQuery(debounced, limit), enabled: available && debounced.length > 0 })
  const results = useMemo(() => (debounced && search.data ? (search.data.results ?? []) : []), [debounced, search.data])
  const groups = getGroups ? getGroups({ q, results }) : defaultGroups(results, { exclude })
  const flat = groups.flatMap((g) => g.options)
  const indexOf = new Map(flat.map((o, i) => [o.id, i]))
  const activeIndex = flat.length && active >= 0 ? Math.min(active, flat.length - 1) : -1
  const activeOption = activeIndex >= 0 ? flat[activeIndex] : null
  const searching = available && q.trim().length > 0 && (q.trim() !== debounced || search.isFetching)
  // Desplegable: el panel se ve con texto y foco; la lista, solo si hay opciones (un listbox vacío
  // no sirve de nada y axe lo marca). En línea, las dos siempre.
  const popupVisible = !inline && open && q.trim().length > 0
  const expanded = inline || (popupVisible && flat.length > 0)
  const optionDomId = (/** @type {string} */ optionId) => `${listId}-${optionId}`
  const statusText = comboboxStatus({ q, searching, error: search.isError, available, total: flat.length })
  const activeDomId = expanded && activeOption ? optionDomId(activeOption.id) : undefined

  useEffect(() => {
    if (activeDomId) document.getElementById(activeDomId)?.scrollIntoView?.({ block: 'nearest' })
  }, [activeDomId])

  /** @param {string} next */
  function setQ(next) {
    if (value === undefined) setInner(next)
    onValueChange?.(next)
  }

  /** @param {ComboboxOption} option */
  function select(option) {
    onSelect?.(option, { q: q.trim(), results })
    if (clearOnSelect) setQ('')
    if (!inline) setOpen(false)
  }

  /** @param {import('react').KeyboardEvent<HTMLInputElement>} event */
  function onKeyDown(event) {
    const { key } = event
    if (key === 'ArrowDown' || key === 'ArrowUp' || ((key === 'Home' || key === 'End') && event.ctrlKey)) {
      event.preventDefault()
      if (!inline) setOpen(true)
      if (flat.length) setActive(moveActive(activeIndex, key, flat.length))
    } else if (key === 'Enter') {
      if (onEnter?.({ q: q.trim(), activeOption: expanded ? activeOption : null, searching, results })) {
        event.preventDefault()
      } else if (expanded && activeOption) {
        event.preventDefault()
        select(activeOption)
      }
    } else if (key === 'Escape' && !inline) {
      // Primero cierra la lista y luego borra el texto; sin nada que hacer, Esc sigue su camino
      // (por ejemplo, cierra el diálogo que contiene al buscador).
      if (popupVisible) {
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
      } else if (q) {
        event.preventDefault()
        event.stopPropagation()
        setQ('')
      }
    }
  }

  const list = (
    <div aria-label="Resultados" className="kz-combobox__list" hidden={!expanded} id={listId} role="listbox">
      {groups.map((group) => (
        <div aria-labelledby={`${listId}-g-${group.id}`} className="kz-combobox__group" key={group.id} role="group">
          <p aria-hidden="true" className="kz-combobox__group-label kz-eyebrow" id={`${listId}-g-${group.id}`}>
            {group.label}
          </p>
          {group.options.map((option) => {
            const selected = option.id === activeOption?.id
            return (
              // El foco se queda en el campo; el clic elige y el cursor marca la activa.
              <div
                aria-selected={selected}
                className="kz-combobox__option"
                id={optionDomId(option.id)}
                key={option.id}
                onClick={() => select(option)}
                onMouseDown={(e) => e.preventDefault()}
                onMouseMove={() => {
                  if (!selected) setActive(indexOf.get(option.id) ?? 0)
                }}
                role="option"
              >
                {renderOption ? (
                  renderOption(option, { selected })
                ) : (
                  <>
                    <span className="kz-combobox__label">{option.label}</span>
                    {option.detail && <span className="kz-combobox__detail">{option.detail}</span>}
                  </>
                )}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )

  return (
    <div className={cn('kz-combobox', className)} data-inline={inline || undefined}>
      {!hideLabel && (
        <label className="kz-label" htmlFor={inputId}>
          {label}
        </label>
      )}
      <div className="kz-combobox__field">
        <input
          aria-activedescendant={activeDomId}
          aria-autocomplete="list"
          aria-controls={listId}
          aria-describedby={hintId}
          aria-expanded={expanded}
          aria-label={hideLabel ? label : undefined}
          autoComplete="off"
          className={cn('kz-input kz-combobox__input', inputClassName)}
          disabled={disabled}
          id={inputId}
          onBlur={() => setOpen(false)}
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          ref={inputRef}
          role="combobox"
          spellCheck={false}
          type="text"
          value={q}
        />
        {!inline && (
          <div className="kz-combobox__popup" hidden={!popupVisible}>
            {flat.length === 0 && (
              <p aria-hidden="true" className="kz-combobox__empty">
                {statusText}
              </p>
            )}
            {list}
          </div>
        )}
      </div>
      {hint && (
        <p className="kz-hint" id={hintId}>
          {hint}
        </p>
      )}
      <p aria-live="polite" className={inline ? 'kz-combobox__status' : 'sr-only'} role="status">
        {inline || popupVisible ? statusText : ''}
      </p>
      {inline && list}
    </div>
  )
}
