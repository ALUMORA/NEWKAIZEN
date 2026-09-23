// Minigráfica en línea. El SVG es decorativo (aria-hidden): el dato va en el texto hermano, que
// se pasa como children (visible) o label (solo para lector de pantalla).
import { useMemo } from 'react'
import { isNum } from '../../lib/format.js'
import { extent, linearScale } from './scale.js'
import { resolveColor } from './series.js'

/**
 * @param {{
 *   values: (number | null)[], width?: number, height?: number,
 *   color?: 'auto' | string | number, baseline?: boolean, label?: string,
 *   children?: import('react').ReactNode, className?: string,
 * }} props
 *   color 'auto': --up si el último valor supera al primero, --down si queda abajo, --flat si igual.
 */
export function Sparkline({ values, width = 80, height = 24, color = 'auto', baseline = true, label, children, className }) {
  const { d, first, stroke, last } = useMemo(() => {
    const nums = (values ?? []).map((v) => (isNum(v) ? v : null))
    const firstV = nums.find(isNum)
    const lastV = [...nums].reverse().find(isNum)
    const e = extent(nums) ?? [0, 1]
    const sx = linearScale([0, Math.max(1, nums.length - 1)], [1.5, width - 1.5])
    const sy = linearScale(e, [height - 2, 2])
    let path = ''
    let pen = false
    nums.forEach((v, i) => {
      if (!isNum(v)) { pen = false; return }
      path += `${pen ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`
      pen = true
    })
    const dir = !isNum(firstV) || !isNum(lastV) || lastV === firstV ? 'var(--flat)' : lastV > firstV ? 'var(--up)' : 'var(--down)'
    const lastI = nums.lastIndexOf(lastV ?? NaN)
    return {
      d: path,
      first: isNum(firstV) ? sy(firstV) : null,
      last: isNum(lastV) ? [sx(lastI), sy(lastV)] : null,
      stroke: color === 'auto' ? dir : resolveColor(color, 0),
    }
  }, [values, width, height, color])
  return (
    <span className={['kz-sparkline', className].filter(Boolean).join(' ')}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
        {baseline && first !== null && <line x1={0} x2={width} y1={first} y2={first} stroke="var(--axis)" strokeWidth="1" strokeDasharray="2 2" />}
        {d && <path d={d} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />}
        {last && <circle cx={last[0]} cy={last[1]} r="2" fill={stroke} />}
      </svg>
      {children}
      {label && <span className="sr-only">{label}</span>}
    </span>
  )
}
