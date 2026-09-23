import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme } from '../../theme.js'
import { IconButton } from './Button.jsx'
import { SegmentedControl } from './SegmentedControl.jsx'

/**
 * Cambio de tema. `icon` (por omisión) es un botón de alternar para la barra
 * superior: "Tema oscuro" con aria-pressed. `segmented` ofrece Claro, Oscuro y
 * Sistema, para la hoja "Más" o ajustes.
 *
 * @param {object} props
 * @param {'icon'|'segmented'} [props.variant]
 * @param {string} [props.className]
 */
export function ThemeToggle({ variant = 'icon', className }) {
  const { mode, dark, setTheme, toggle } = useTheme()
  if (variant === 'segmented') {
    return (
      <SegmentedControl
        className={className}
        label="Tema"
        value={mode}
        onChange={(next) => setTheme(/** @type {'light'|'dark'|'system'} */ (next))}
        items={[
          { value: 'light', label: 'Claro', icon: <Sun size={14} /> },
          { value: 'dark', label: 'Oscuro', icon: <Moon size={14} /> },
          { value: 'system', label: 'Sistema', icon: <Monitor size={14} /> },
        ]}
      />
    )
  }
  return (
    <IconButton className={className} label="Tema oscuro" pressed={dark} onClick={toggle}>
      {dark ? <Moon size={18} /> : <Sun size={18} />}
    </IconButton>
  )
}
