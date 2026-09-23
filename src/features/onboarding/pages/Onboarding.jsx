// /bienvenida: tres formas de empezar. Un portafolio de EJEMPLO, importar un CSV o empezar vacío.
// Cualquiera de las tres guarda settings.onboardingDone y lleva al portafolio.
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Badge, Button, Card, PageHeader, useToast } from '../../../components/ui/index.js'
import { parseCSV, rowsToObjects } from '../../../lib/csv.js'
import { newId, update, validateTransaction } from '../../../lib/storage.js'
import { PATHS } from '../../../app/paths.js'
import { SAMPLE_NAME, SAMPLE_NOTE, SAMPLE_TRANSACTIONS, rowsToRawTransactions } from '../sample.js'
import '../onboarding.css'

function createPortfolio({ name, notes = '', transactions = [] }) {
  const id = newId('pf')
  update((state) => ({
    ...state,
    portfolios: [...(state.portfolios ?? []), { id, name, baseCurrency: 'MXN', createdAt: new Date().toISOString(), transactions, targets: {}, notes }],
    activePortfolioId: id,
    settings: { ...state.settings, onboardingDone: true },
  }))
  return id
}

export default function Onboarding() {
  const navigate = useNavigate()
  const toast = useToast()
  const [csv, setCsv] = useState(/** @type {null | { name: string, ok: any[], bad: { row: number, reason: string }[] }} */ (null))

  const finish = (message) => {
    toast.show({ title: message, tone: 'positive' })
    navigate(PATHS.portfolio)
  }

  const onFile = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    const text = await file.text()
    const raw = rowsToRawTransactions(rowsToObjects(parseCSV(text)))
    const ok = []
    const bad = []
    raw.forEach((r, i) => {
      const res = validateTransaction(r)
      if (res.tx) ok.push(res.tx)
      else bad.push({ row: i + 2, reason: res.reason })
    })
    setCsv({ name: file.name, ok, bad })
  }

  return (
    <div className="kz-container ob-page">
      <PageHeader
        eyebrow="Primeros pasos"
        title="Te damos la bienvenida a Kaizen"
        description="Elige cómo quieres empezar. Todo se guarda en este navegador y lo puedes cambiar después."
      />
      <div className="ob-options">
        <Card title="Explorar con un ejemplo" titleAs="h2" actions={<Badge tone="warning">EJEMPLO</Badge>}>
          <div className="ob-option">
            <p>Un portafolio con cifras inventadas, marcado como EJEMPLO, para ver cómo se leen las métricas sin capturar nada.</p>
            <ul>
              <li>Un depósito de 100 mil pesos</li>
              <li>Tres emisoras de la BMV y un dividendo</li>
            </ul>
            <Button className="ob-push" onClick={() => { createPortfolio({ name: SAMPLE_NAME, notes: SAMPLE_NOTE, transactions: SAMPLE_TRANSACTIONS.map((t) => validateTransaction(t).tx).filter(Boolean) }); finish('Listo: creamos el portafolio de EJEMPLO') }}>
              Usar el ejemplo
            </Button>
          </div>
        </Card>
        <Card title="Importar un CSV" titleAs="h2">
          <div className="ob-option">
            <p>Sube tus movimientos con columnas tipo, fecha, símbolo, cantidad, precio y moneda. El tipo puede ser compra, venta, dividendo, depósito o retiro.</p>
            <label className="ob-file">
              <span>Archivo CSV</span>
              <input type="file" accept=".csv,text/csv" onChange={onFile} />
            </label>
            {csv && (
              <>
                <p className="ob-summary" role="status">
                  {csv.name}: {csv.ok.length} {csv.ok.length === 1 ? 'movimiento válido' : 'movimientos válidos'}
                  {csv.bad.length > 0 && `, ${csv.bad.length} con problemas`}.
                </p>
                {csv.bad.length > 0 && (
                  <ul className="ob-errors">
                    {csv.bad.slice(0, 5).map((b) => (
                      <li key={b.row}>Fila {b.row}: {b.reason}</li>
                    ))}
                  </ul>
                )}
              </>
            )}
            <Button className="ob-push" variant="secondary" disabled={!csv?.ok.length} onClick={() => { createPortfolio({ name: 'Mi portafolio', transactions: csv?.ok ?? [] }); finish('Listo: importamos tus movimientos') }}>
              {csv?.ok.length ? `Crear portafolio con ${csv.ok.length} movimientos` : 'Crear portafolio'}
            </Button>
          </div>
        </Card>
        <Card title="Empezar vacío" titleAs="h2">
          <div className="ob-option">
            <p>Un portafolio en blanco para capturar tus movimientos a mano cuando quieras.</p>
            <Button className="ob-push" variant="secondary" onClick={() => { createPortfolio({ name: 'Mi portafolio' }); finish('Listo: creamos tu portafolio vacío') }}>
              Empezar vacío
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}
