// Alta de un movimiento del libro: Dialog con los campos que pide cada tipo. Con moneda USD
// prellena el tipo de cambio de la fecha desde /v2/fx/history y dice de dónde salió.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button, DataStatus, Dialog, ErrorState, Input, NumberInput, Select } from '../../components/ui/index.js'
import { fxHistoryQuery } from '../../lib/api/queries.js'
import { TX_TYPES, validateTransaction } from '../../lib/storage.js'
import { TX_LABELS, fieldsFor, minusDays, todayMx } from './tx-labels.js'

const TYPE_OPTIONS = TX_TYPES.map((t) => ({ value: t, label: TX_LABELS[t] }))
const CURRENCY_OPTIONS = [
  { value: 'MXN', label: 'Pesos (MXN)' },
  { value: 'USD', label: 'Dólares (USD)' },
]

function blank() {
  return {
    type: 'buy', date: todayMx(), symbol: '', quantity: null, price: null, amount: null,
    ratio: null, fees: null, currency: 'MXN', fxRate: null, note: '',
  }
}

/** @param {{ date: string, enabled: boolean }} p */
function useFxForDate({ date, enabled }) {
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date)
  return useQuery({ ...fxHistoryQuery({ start: valid ? minusDays(date, 10) : undefined, end: valid ? date : undefined }), enabled: enabled && valid })
}

/**
 * El padre le cambia la `key` cada vez que lo abre, así el formulario empieza en blanco.
 * @param {{ open: boolean, onClose: () => void, onSave: (tx: any) => void }} props
 */
export default function TransactionDialog({ open, onClose, onSave }) {
  const [form, setForm] = useState(blank)
  const [fxTouched, setFxTouched] = useState(false)
  const [errors, setErrors] = useState(/** @type {{ symbol?: string, form?: string }} */ ({}))
  const f = fieldsFor(form.type)
  const usd = f.currency && form.currency === 'USD'
  const fx = useFxForDate({ date: form.date, enabled: open && usd })
  const fxValues = fx.data?.values ?? []
  const fxSuggested = fxValues.length ? fxValues[fxValues.length - 1] : null

  // Mientras la persona no lo toque, el tipo de cambio es el de la fecha elegida.
  const fxRate = fxTouched ? form.fxRate : (fxSuggested ?? form.fxRate)

  /** @param {string} key @param {any} value */
  const set = (key, value) => setForm((s) => ({ ...s, [key]: value }))

  /** @param {React.FormEvent} e */
  function submit(e) {
    e.preventDefault()
    const raw = {
      type: form.type,
      date: form.date || null,
      symbol: f.symbol ? form.symbol.trim() : null,
      quantity: f.trade ? form.quantity : null,
      price: f.trade ? form.price : null,
      amount: f.amount ? form.amount : null,
      ratio: f.ratio ? form.ratio : null,
      fees: f.trade && form.fees != null ? form.fees : 0,
      currency: f.currency ? form.currency : 'MXN',
      fxRate: usd ? fxRate : null,
      note: form.note.trim(),
    }
    if (f.symbol && !raw.symbol) {
      setErrors({ symbol: 'Escribe la clave de pizarra, por ejemplo WALMEX.MX o AAPL.' })
      return
    }
    if (usd && (raw.fxRate == null || raw.fxRate <= 0)) {
      setErrors({ form: 'Falta el tipo de cambio en pesos por dólar de esa fecha.' })
      return
    }
    const res = validateTransaction(raw)
    if (!res.tx) {
      const reason = res.reason ?? 'revisa los datos'
      if (reason.includes('clave')) setErrors({ symbol: 'Esa clave no es válida. Usa letras, números y punto, como WALMEX.MX.' })
      else setErrors({ form: `No se pudo guardar: ${reason}.` })
      return
    }
    onSave(res.tx)
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Agregar movimiento"
      description="Se guarda solo en este navegador, en tu portafolio activo."
      footer={
        <div className="kz-row" data-justify="between" style={{ width: '100%' }}>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" form="kz-tx-form">Guardar movimiento</Button>
        </div>
      }
    >
      <form id="kz-tx-form" className="kz-col" data-gap="3" onSubmit={submit} noValidate>
        <div className="kz-metric-grid">
          <Select label="Tipo" options={TYPE_OPTIONS} value={form.type} onChange={(e) => { set('type', e.target.value); setErrors({}) }} />
          <Input label="Fecha" type="date" value={form.date} onChange={(e) => set('date', e.target.value)} required />
          {f.symbol && (
            <Input
              label="Clave de pizarra"
              value={form.symbol}
              onChange={(e) => { set('symbol', e.target.value.toUpperCase()); setErrors({}) }}
              error={errors.symbol}
              autoComplete="off"
              spellCheck={false}
              required
            />
          )}
          {f.trade && <NumberInput label="Cantidad de títulos" value={form.quantity} onChange={(v) => set('quantity', v)} required />}
          {f.trade && <NumberInput label="Precio por título" prefix="$" value={form.price} onChange={(v) => set('price', v)} decimals={2} />}
          {f.trade && <NumberInput label="Comisión" prefix="$" value={form.fees} onChange={(v) => set('fees', v)} decimals={2} />}
          {f.amount && <NumberInput label="Monto" prefix="$" value={form.amount} onChange={(v) => set('amount', v)} decimals={2} required />}
          {f.ratio && <NumberInput label="Títulos nuevos por cada uno" hint="2 significa 2 por 1" value={form.ratio} onChange={(v) => set('ratio', v)} required />}
          {f.currency && <Select label="Moneda" options={CURRENCY_OPTIONS} value={form.currency} onChange={(e) => set('currency', e.target.value)} />}
          {usd && (
            <NumberInput
              label="Tipo de cambio"
              suffix="MXN por USD"
              hint={fx.isLoading ? 'Buscando el tipo de cambio de esa fecha' : fx.isError ? 'No pudimos traer el tipo de cambio; escríbelo tú.' : fxSuggested != null && !fxTouched ? 'Prellenado con el dato de esa fecha' : undefined}
              value={fxRate}
              onChange={(v) => { setFxTouched(true); set('fxRate', v) }}
              decimals={4}
              required
            />
          )}
        </div>
        {usd && fx.data?.meta && (
          <div className="kz-row">
            <span>Tipo de cambio:</span>
            <DataStatus {...fx.data.meta} />
          </div>
        )}
        <Input label="Nota" value={form.note} onChange={(e) => set('note', e.target.value)} maxLength={140} />
        {errors.form && <ErrorState title="Revisa el movimiento" message={errors.form} size="sm" headingAs="p" />}
      </form>
    </Dialog>
  )
}
