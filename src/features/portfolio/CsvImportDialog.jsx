// Vista previa de un CSV antes de agregarlo al libro: cuántos movimientos entran, cuáles ya
// estaban y qué filas no se entendieron, con su número de fila y el motivo.
import { Button, Dialog } from '../../components/ui/index.js'
import { fmtNumber } from '../../lib/format.js'

const count = (/** @type {number} */ n) => fmtNumber(n, { decimals: 0 })

/**
 * @param {{
 *   preview: null | { name: string, ok: any[], bad: { row: number, reason: string }[], repeated: number, empty: boolean },
 *   onCancel: () => void,
 *   onConfirm: () => void,
 * }} props
 */
export default function CsvImportDialog({ preview, onCancel, onConfirm }) {
  const n = preview?.ok.length ?? 0
  return (
    <Dialog
      open={preview != null}
      onClose={onCancel}
      title="Importar movimientos"
      description={preview ? `Archivo: ${preview.name}` : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>Cancelar</Button>
          <Button onClick={onConfirm} disabled={n === 0}>
            {n === 1 ? 'Agregar 1 movimiento' : `Agregar ${count(n)} movimientos`}
          </Button>
        </>
      }
    >
      {preview && (
        <div className="kz-col" data-gap="3">
          {preview.empty ? (
            <p>El archivo no trae filas de movimientos, solo el encabezado o nada.</p>
          ) : (
            <p>
              {n === 1 ? '1 movimiento listo para agregar' : `${count(n)} movimientos listos para agregar`}
              {preview.repeated > 0 && `, ${count(preview.repeated)} ya estaban en tu libro y no se repiten`}
              {preview.bad.length > 0 && `, ${count(preview.bad.length)} con problemas que se quedan fuera`}.
            </p>
          )}
          {preview.bad.length > 0 && (
            <ul className="kz-portfolio-list">
              {preview.bad.slice(0, 6).map((b) => (
                <li key={b.row}>{`Fila ${count(b.row)}: ${b.reason}.`}</li>
              ))}
              {preview.bad.length > 6 && <li>{`Y ${count(preview.bad.length - 6)} filas más.`}</li>}
            </ul>
          )}
          <p className="kz-portfolio-hint">
            Columnas que se leen: Fecha, Tipo, Clave, Títulos, Precio, Monto, Comisión, Moneda, Tipo de cambio, Proporción y Nota. También en inglés.
          </p>
        </div>
      )}
    </Dialog>
  )
}
