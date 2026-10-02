// Tipo de cambio contable (V5FX): FIX de Banxico por fecha o con la regla del DOF (art. 20 del CFF),
// cierres de mes del último año y conversión por lote de un CSV de pagos en dólares. La regla del
// DOF se explica y no se recomienda: elegirla es decisión fiscal de cada empresa.
import { useId, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ApiNotes, Button, Card, DataTable, Dialog, EmptyState, ErrorState, Field, Input, PageHeader, SegmentedControl, Stat,
} from '../../../components/ui/index.js'
import { fixQuery, fixTableQuery } from '../../../lib/api/queries.js'
import { useFeature } from '../../../lib/api/useFeature.js'
import { downloadBlob } from '../../../lib/csv.js'
import { PATHS } from '../../../app/paths.js'
import { fmtDate, fmtMoney, fmtNumber } from '../../../lib/format.js'
import { batchRange, batchToCSV, batchTotals, convertBatch, parseBatch } from '../lib/batch.js'
import { fmtMonth, fmtRate, todayMx, yearsBefore } from '../lib/labels.js'
import '../fx.css'

/** @typedef {import('../types.js').FixLookupResponse} FixLookupResponse */
/** @typedef {import('../types.js').FixTableResponse} FixTableResponse */
/** @typedef {import('../types.js').FixRule} FixRule */

const RULES = [
  { value: 'fecha', label: 'Fecha del FIX' },
  { value: 'dof', label: 'Regla del DOF (art. 20 CFF)' },
]
const RULE_TEXT = { fecha: 'fecha del FIX', dof: 'regla del DOF' }

export default function FxAccountingPage() {
  const feature = useFeature(['fxdesk.fix'])
  const today = todayMx()
  const [date, setDate] = useState(today)
  const [rule, setRule] = useState(/** @type {FixRule} */ ('fecha'))
  const [batchOpen, setBatchOpen] = useState(false)
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= '1991-11-12'
  const fix = useQuery({ ...fixQuery({ date, rule }), enabled: feature.enabled && validDate })
  const tableParams = { start: yearsBefore(today, 1), end: today, rule, monthEnd: true }
  const table = useQuery({ ...fixTableQuery(tableParams), enabled: feature.enabled })
  const loading = feature.waiting || (feature.enabled && validDate && fix.isPending)
  /** @type {FixLookupResponse | undefined} */
  const fx = fix.data
  /** @type {FixTableResponse | undefined} */
  const tableData = table.data

  return (
    <div className="kz-page kz-col fx-page" data-gap="6">
      <PageHeader
        eyebrow="Empresas"
        title="Tipo de cambio contable"
        description="El FIX de Banxico para una fecha, con la fecha del FIX o con la regla del DOF, los cierres de mes y la conversión por lote de tus pagos en dólares."
        breadcrumbs={[{ label: 'Empresas', to: PATHS.business }, { label: 'Tipo de cambio contable' }]}
        actions={<Button variant="secondary" onClick={() => setBatchOpen(true)} disabled={!feature.enabled}>Convertir un lote</Button>}
      />

      {!feature.waiting && !feature.enabled ? <EmptyState title="El FIX contable no está disponible" text={feature.reason} /> : null}

      <Card title="FIX para una fecha" status={fx?.meta}>
        <div className="kz-col" data-gap="5">
          <div className="fx-controls">
            <Input
              type="date"
              label="Fecha de la operación"
              value={date}
              min="1991-11-12"
              onChange={(e) => setDate(e.target.value)}
              error={date && !validDate ? 'Escribe una fecha desde el 12 nov 1991.' : undefined}
            />
            <SegmentedControl label="Qué tipo de cambio usar" items={RULES} value={rule} onChange={(v) => setRule(/** @type {FixRule} */ (v))} />
          </div>
          {fix.isError ? <ErrorState size="sm" message="No pudimos traer el FIX de esa fecha." onRetry={() => fix.refetch()} retrying={fix.isFetching} /> : null}
          <div className="kz-metric-grid">
            <Stat
              size="lg"
              label={`FIX aplicable con la ${RULE_TEXT[rule]}`}
              value={fx ? (fx.value == null ? 's/d' : `${fmtRate(fx.value)} pesos por dólar`) : undefined}
              loading={loading}
              status={fx?.meta}
              sublabel={fx ? (fx.fixDate ? `Determinado el ${fmtDate(fx.fixDate)}` : 'Aún no hay FIX para esa fecha') : undefined}
            />
            {rule === 'dof' ? (
              <Stat label="Publicado en el DOF" value={fx ? fmtDate(fx.dofPublicationDate) : undefined} loading={loading} />
            ) : null}
          </div>
          <p className="fx-explanation" aria-live="polite">{fx ? fx.explanation : loading ? 'Buscando el FIX de esa fecha…' : 's/d'}</p>
          {fx ? <ApiNotes meta={fx.meta} label="Avisos del FIX" /> : null}
        </div>
      </Card>

      <Card title="Cómo funciona la regla del DOF" titleAs="h2">
        <p className="fx-prose">
          El artículo 20 del Código Fiscal de la Federación dice que, para operaciones en dólares, se usa el tipo de cambio
          publicado en el Diario Oficial de la Federación el día anterior a la fecha de la operación. Si ese día no hubo
          publicación, se usa la última publicada antes.
        </p>
        <p className="fx-prose">
          Lo que publica el DOF en un día hábil bancario es el FIX que Banxico determinó el día hábil anterior. Por eso un
          pago del lunes 5 de octubre de 2026 usa el DOF del viernes 2, que trae el FIX del jueves 1. Los días hábiles se
          infieren de las fechas en que Banxico publicó FIX.
        </p>
        <p className="fx-prose">
          Usar la fecha del FIX o la regla del DOF es una decisión fiscal de cada empresa con su contador. Aquí solo se muestran
          las dos para que compares.
        </p>
      </Card>

      <Card title="Cierres de mes del último año" description={`Con la ${RULE_TEXT[rule]}. El promedio es el del FIX de todo el mes.`} status={tableData?.meta} padding="none">
        {table.isError ? <ErrorState size="sm" message="No pudimos traer los cierres de mes." onRetry={() => table.refetch()} retrying={table.isFetching} /> : null}
        {feature.enabled || feature.waiting ? (
          <DataTable
            caption="Cierres de mes del FIX"
            captionHidden
            rowKey="month"
            loading={feature.waiting || table.isPending}
            loadingRows={12}
            defaultSort={{ key: 'month', direction: 'descending' }}
            rows={tableData?.monthEnds ?? []}
            columns={[
              { key: 'month', header: 'Mes', format: (v) => fmtMonth(v), sortable: true },
              { key: 'fixDate', header: 'FIX del día', format: (v) => fmtDate(v) },
              { key: 'value', header: 'Cierre', numeric: true, format: (v) => fmtRate(v) },
              { key: 'average', header: 'Promedio del mes', numeric: true, format: (v) => fmtRate(v) },
            ]}
            empty={{ title: 'Sin cierres de mes', text: 'La fuente no devolvió meses para este periodo.' }}
          />
        ) : null}
        {tableData ? <div className="fx-pad"><ApiNotes meta={tableData.meta} label="Avisos de los cierres" /></div> : null}
      </Card>

      <BatchDialog open={batchOpen} onClose={() => setBatchOpen(false)} rule={rule} />
    </div>
  )
}

/**
 * Conversión por lote: el CSV (fecha, monto en USD) se lee en el navegador, se pide una sola tabla
 * de FIX para su rango de fechas y se descarga el resultado.
 */
function BatchDialog({ open, onClose, rule }) {
  const qc = useQueryClient()
  const fileId = useId()
  const textId = useId()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /** @type {[import('../lib/batch.js').BatchError[], Function]} */
  const [lineErrors, setLineErrors] = useState([])
  /** @type {[import('../lib/batch.js').ConvertedRow[] | null, Function]} */
  const [result, setResult] = useState(null)
  const [resultRule, setResultRule] = useState(rule)

  const reset = () => {
    setResult(null)
    setError('')
    setLineErrors([])
  }

  const onFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setText(await file.text())
    reset()
  }

  const convert = async () => {
    reset()
    const parsed = parseBatch(text)
    setLineErrors(parsed.errors)
    if (!parsed.rows.length) {
      setError('No encontramos renglones con fecha y monto.')
      return
    }
    const range = batchRange(parsed.rows)
    if (!range || range.tooLong) {
      setError('El lote abarca más de 3 años. Divídelo en lotes más cortos.')
      return
    }
    setBusy(true)
    try {
      /** @type {FixTableResponse} */
      const data = await qc.fetchQuery(fixTableQuery({ start: range.start, end: range.end, rule, monthEnd: false }))
      setResult(convertBatch(parsed.rows, data.rows))
      setResultRule(rule)
    } catch {
      setError('No pudimos traer el FIX para esas fechas. Intenta de nuevo en un momento.')
    } finally {
      setBusy(false)
    }
  }

  const totals = result ? batchTotals(result) : null
  const download = () => {
    if (!result) return
    downloadBlob(`fix-lote-${resultRule}.csv`, batchToCSV(result), 'text/csv;charset=utf-8')
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Convertir un lote a pesos"
      description={`Sube o pega un CSV con dos columnas, fecha y monto en dólares. Se usa la ${RULE_TEXT[rule]}, la misma que elegiste en la página.`}
      footer={
        <div className="fx-dialog-actions">
          <Button onClick={convert} loading={busy} disabled={!text.trim()}>Calcular</Button>
          <Button variant="secondary" onClick={download} disabled={!result}>Descargar CSV</Button>
        </div>
      }
    >
      <div className="kz-col" data-gap="4">
        <Field label="Archivo CSV" id={fileId} hint="Columnas fecha y monto. La fecha como AAAA-MM-DD o DD/MM/AAAA.">
          <input id={fileId} aria-describedby={`${fileId}-ayuda`} className="kz-input" type="file" accept=".csv,text/csv,text/plain" onChange={onFile} />
        </Field>
        <Field label="O pega el contenido" id={textId} hint="Ejemplo: fecha,monto en la primera línea y 2026-10-05,1000 en la siguiente.">
          <textarea id={textId} aria-describedby={`${textId}-ayuda`} className="kz-input fx-textarea" value={text} onChange={(e) => { setText(e.target.value); reset() }} spellCheck={false} />
        </Field>
        {error ? <p className="fx-batch-errors" role="alert">{error}</p> : null}
        {lineErrors.length ? (
          <ul className="fx-batch-errors" aria-label="Renglones que no se leyeron">
            {lineErrors.slice(0, 10).map((e) => <li key={`${e.line}-${e.message}`}>{e.message}</li>)}
            {lineErrors.length > 10 ? <li>Y {lineErrors.length - 10} renglones más.</li> : null}
          </ul>
        ) : null}
        {result && totals ? (
          <div className="kz-col" data-gap="3">
            <p className="fx-note" role="status">
              {`${totals.count} renglones: ${fmtMoney(totals.usd, 'USD')} son ${fmtMoney(totals.mxn, 'MXN')}`}
              {totals.missing ? `. ${totals.missing} sin FIX (s/d), no suman.` : '.'}
            </p>
            <DataTable
              caption="Previa del lote convertido"
              rowKey={(r) => `${r.line}`}
              maxHeight={320}
              density="compact"
              rows={result.slice(0, 200)}
              columns={[
                { key: 'date', header: 'Fecha', format: (v) => fmtDate(v) },
                { key: 'amountUsd', header: 'Monto USD', numeric: true, format: (v) => fmtNumber(v) },
                { key: 'fixDate', header: 'FIX del día', format: (v) => fmtDate(v) },
                { key: 'rate', header: 'Tipo de cambio', numeric: true, format: (v) => fmtRate(v) },
                { key: 'amountMxn', header: 'Monto MXN', numeric: true, format: (v) => fmtNumber(v) },
              ]}
            />
            {result.length > 200 ? <p className="fx-note">La previa muestra 200 renglones; el CSV trae los {result.length}.</p> : null}
          </div>
        ) : null}
      </div>
    </Dialog>
  )
}
