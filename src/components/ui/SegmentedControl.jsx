import { useId } from 'react'
import { cn } from '../../cn.js'

/**
 * Elegir una opción entre pocas y excluyentes (1M / 3M / 1A, MXN / USD).
 *
 * Por dentro son radios nativos dentro de un fieldset: el navegador ya trae el
 * grupo, las flechas y el anuncio de "1 de 4", que es justo lo que se rompe
 * cuando esto se escribe con divs. El radio va transparente encima de su
 * etiqueta, así que el área que se toca es toda la pastilla.
 *
 * @param {object} props
 * @param {string} props.label nombre del grupo (va en el legend)
 * @param {boolean} [props.hideLabel] deja el legend solo para lectores de pantalla
 * @param {{ value: string, label: import('react').ReactNode, icon?: import('react').ReactNode, disabled?: boolean }[]} props.items
 * @param {string} props.value
 * @param {(value: string) => void} props.onChange
 * @param {string} [props.name] nombre del grupo de radios; por omisión uno único
 * @param {string} [props.className]
 */
export function SegmentedControl({ label, hideLabel = false, items, value, onChange, name, className }) {
  const auto = useId()
  const group = name ?? `seg-${auto}`
  return (
    <fieldset className={cn('kz-seg', className)}>
      <legend className={hideLabel ? 'sr-only' : 'kz-label'}>{label}</legend>
      <div className="kz-seg__track">
        {items.map((item) => {
          const id = `${group}-${item.value}`
          return (
            <span className="kz-seg__item" key={item.value}>
              <input
                className="kz-seg__input"
                type="radio"
                id={id}
                name={group}
                value={item.value}
                checked={item.value === value}
                disabled={item.disabled}
                onChange={() => onChange(item.value)}
              />
              <label className="kz-seg__label" htmlFor={id}>
                {item.icon && (<span className="kz-seg__icon" aria-hidden="true">{item.icon}</span>)}
                {item.label}
              </label>
            </span>
          )
        })}
      </div>
    </fieldset>
  )
}
