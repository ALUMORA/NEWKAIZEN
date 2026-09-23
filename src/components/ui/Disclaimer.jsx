import { Info } from 'lucide-react'
import { cn } from '../../cn.js'

export const DISCLAIMER_SHORT = 'Kaizen es una herramienta educativa y de análisis. No es recomendación de inversión.'

/**
 * Aviso legal. `short` es la línea que va en el pie de toda página; `long` va
 * en simuladores, optimizador y backtest, donde un número podría leerse como
 * promesa.
 *
 * @param {object} props
 * @param {'short'|'long'} [props.variant] short por omisión
 * @param {import('react').ReactNode} [props.children] texto propio en lugar del estándar
 * @param {string} [props.className]
 */
export function Disclaimer({ variant = 'short', children, className }) {
  if (variant === 'long') {
    return (
      <aside className={cn('kz-disclaimer', className)} data-variant="long" aria-label="Aviso importante">
        <Info size={16} aria-hidden="true" />
        <div>
          {children ?? (
            <>
              <p>{DISCLAIMER_SHORT}</p>
              <p>
                Los resultados pasados no garantizan resultados futuros. Las simulaciones y los backtests parten de supuestos
                que pueden no cumplirse, y los datos pueden llegar con retraso o de una fuente de respaldo. Antes de decidir
                con tu dinero, considera tu situación y, si lo necesitas, busca asesoría de un profesional certificado.
              </p>
            </>
          )}
        </div>
      </aside>
    )
  }
  return <p className={cn('kz-disclaimer', className)}>{children ?? DISCLAIMER_SHORT}</p>
}
