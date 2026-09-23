import markBlack from '../../assets/kaizen-mark-black.jpg'
import markWhite from '../../assets/kaizen-mark-white.jpg'
import { useTheme } from '../../theme.js'
import { cn } from '../../cn.js'

/**
 * Marca de Kaizen (sin texto). Por omisión sigue al tema; `on` la fija para un
 * fondo que no cambia con el tema (la barra lateral siempre oscura).
 *
 * El JPG trae su fondo horneado, así que se funde con el real (multiply en
 * claro, screen en oscuro) en vez de verse como una caja pegada.
 *
 * @param {object} props
 * @param {number} [props.size] lado en px; 32 por omisión
 * @param {'auto'|'light'|'dark'} [props.on] fondo sobre el que va
 * @param {string} [props.label] con texto, la marca es una imagen con nombre ("Kaizen");
 *   sin él es decorativa, para cuando ya hay texto al lado
 * @param {string} [props.className]
 */
export function Mark({ size = 32, on = 'auto', label, className }) {
  const { dark } = useTheme()
  const onDark = on === 'dark' || (on === 'auto' && dark)
  return (
    <span className={cn('kz-mark', className)} data-on={onDark ? 'dark' : 'light'} style={{ width: size, height: size }}>
      <img src={onDark ? markWhite : markBlack} alt={label ?? ''} width={size} height={size} decoding="async" />
    </span>
  )
}
