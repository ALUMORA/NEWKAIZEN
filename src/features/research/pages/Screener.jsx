// Screener de factores (/screener): un universo (México, Estados Unidos o una lista propia)
// ordenado por puntajes z relativos al sector, con la cobertura de cada emisora y pruebas
// "cumple / no cumple" contra umbrales escritos. Nunca dice qué hacer. La URL guarda universo,
// claves y sector (?universo=propia&symbols=A,B&sector=...).
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { factorScreenerQuery } from '../../../lib/api/queries.js'
import { useStore } from '../../../lib/storage.js'
import { Button, Card, EmptyState, Input, PageHeader, SegmentedControl, Select, TabPanel, Tabs } from '../../../components/ui/index.js'
import { PATHS } from '../../../app/paths.js'
import { QueryBlock } from '../components/QueryBlock.jsx'
import { ChecksTable, ExcludedTable, MetricsTable, ScoresTable } from '../components/FactorTables.jsx'
import { FactorGuide } from '../components/FactorGuide.jsx'
import { parseSymbols } from '../symbols.js'
import { CUSTOM_MAX, CUSTOM_MIN, UNIVERSES, checkDefs, filterBySector, groupReasons, readParams, sectorsOf, writeParams } from '../screener-model.js'
import '../research.css'
import '../screener.css'

const EMPTY = /** @type {never[]} */ ([])
const TABS = [
  { id: 'scores', label: 'Puntajes' },
  { id: 'checks', label: 'Pruebas' },
  { id: 'metrics', label: 'Métricas' },
]

/** Lista propia: claves escritas a mano o tomadas de una watchlist. */
function CustomForm({ initial, onApply }) {
  const lists = useStore((s) => s.watchlists) ?? EMPTY
  const [text, setText] = useState(initial.join(', '))
  const [error, setError] = useState('')

  /** @param {string[]} next */
  function apply(next) {
    if (next.length < CUSTOM_MIN || next.length > CUSTOM_MAX) {
      setError(`Escribe de ${CUSTOM_MIN} a ${CUSTOM_MAX} claves separadas por coma, por ejemplo WALMEX.MX, AAPL, MSFT.`)
      return
    }
    setError('')
    onApply(next)
  }

  const usable = lists.filter((l) => l.symbols?.length).slice(0, 3)
  return (
    <div className="kz-col" data-gap="3">
      <form
        className="kz-screener-custom"
        onSubmit={(e) => {
          e.preventDefault()
          apply(parseSymbols(text))
        }}
      >
        <Input
          label="Claves de tu lista"
          hint={`De ${CUSTOM_MIN} a ${CUSTOM_MAX}, separadas por coma. Con tan pocas emisoras por sector, casi todas se comparan contra toda la lista.`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          error={error || undefined}
          autoComplete="off"
          spellCheck={false}
        />
        <Button type="submit">Calcular</Button>
      </form>
      {usable.length ? (
        <div className="kz-row" data-gap="2">
          <span className="kz-research-muted">Usar una watchlist:</span>
          {usable.map((l) => (
            <Button
              key={l.id}
              variant="secondary"
              size="sm"
              onClick={() => {
                setText(l.symbols.join(', '))
                apply(l.symbols.slice(0, CUSTOM_MAX))
              }}
            >
              {`${l.name} (${l.symbols.length})`}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** @param {{ notes: string[] }} props */
function Notes({ notes }) {
  if (!notes.length) return null
  return (
    <div className="kz-research-warning kz-screener-notes" role="note" aria-label="Avisos del tablero">
      <ul>
        {notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </div>
  )
}

/** @param {{ rows: { symbol: string, reason?: string | null }[] }} props */
function RowNotes({ rows }) {
  const groups = groupReasons(rows)
  if (!groups.length) return null
  return (
    <div className="kz-screener-rownotes">
      <h3>Notas por emisora</h3>
      <ul>
        {groups.map((g) => (
          <li key={g.reason}>
            {g.reason} <span className="mono">{g.symbols.join(', ')}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function Screener() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { universe, symbols, sector } = readParams(params)
  const [tab, setTab] = useState('scores')

  const ready = universe !== 'custom' || symbols.length >= CUSTOM_MIN
  const query = useQuery({ ...factorScreenerQuery(universe === 'custom' ? { universe, symbols } : { universe }), enabled: ready })
  const data = query.data
  const rows = data?.rows ?? EMPTY
  const comparable = rows.filter((r) => !r.excluded)
  const excluded = rows.filter((r) => r.excluded)
  const sectors = sectorsOf(rows)
  const activeSector = data ? (sectors.includes(sector) ? sector : '') : sector
  const shown = filterBySector(comparable, activeSector)
  const shownExcluded = filterBySector(excluded, activeSector)
  const defs = checkDefs(rows)

  /**
   * Cambia la URL; las comas de la lista quedan legibles (?symbols=AAPL,MSFT), como en el comparador.
   * @param {{ universe?: 'mx' | 'us' | 'custom', symbols?: string[], sector?: string }} patch @param {boolean} [replace]
   */
  const go = (patch, replace = false) => {
    const qs = new URLSearchParams(writeParams({ universe, symbols, sector: activeSector, ...patch })).toString().replaceAll('%2C', ',')
    navigate({ search: qs ? `?${qs}` : '' }, { replace })
  }

  const where = activeSector ? ` en ${activeSector}` : ''
  const summary = data
    ? `${data.universe.name}: ${comparable.length} de ${data.universe.size} emisoras comparables${activeSector ? `, ${shown.length}${where}` : ''}.`
    : undefined

  return (
    <div className="kz-container kz-col kz-research-page" data-gap="6">
      <PageHeader
        title="Screener de factores"
        eyebrow="Investigar"
        description="Ordena un universo de emisoras por valor, calidad, momentum, baja volatilidad y crecimiento, cada una contra la mediana de su sector. Son criterios que puedes leer y revisar, no recomendaciones."
        breadcrumbs={[{ label: 'Investigar', to: PATHS.research }, { label: 'Screener de factores' }]}
      />
      <Card title="Universo y filtros">
        <div className="kz-col" data-gap="4">
          <div className="kz-screener-controls">
            <SegmentedControl
              label="Universo"
              items={UNIVERSES.map((u) => ({ value: u.value, label: u.label }))}
              value={universe}
              onChange={(value) => go({ universe: /** @type {'mx' | 'us' | 'custom'} */ (value), sector: '' })}
            />
            <Select
              label="Sector"
              value={activeSector}
              onChange={(e) => go({ sector: e.target.value }, true)}
              options={[{ value: '', label: 'Todos los sectores' }, ...sectors.map((s) => ({ value: s, label: s }))]}
              disabled={!data}
            />
          </div>
          {universe === 'custom' ? <CustomForm key={symbols.join(',')} initial={symbols} onApply={(next) => go({ symbols: next, sector: '' })} /> : null}
        </div>
      </Card>
      {ready ? (
        <Card title="Tablero" description={summary} status={data?.meta}>
          <QueryBlock
            query={query}
            isEmpty={rows.length === 0}
            emptyTitle="Este universo no trajo emisoras"
            emptyText="Prueba con otro universo o revisa las claves de tu lista."
            lines={8}
          >
            {() => (
              <div className="kz-col" data-gap="4">
                <Notes notes={data?.meta?.notes ?? EMPTY} />
                <Tabs items={TABS} value={tab} onChange={setTab} label="Vistas del tablero">
                  <TabPanel id="scores">
                    <p className="kz-research-muted kz-screener-lead">
                      Puntaje z de cada factor contra la mediana de su sector, con su dato crudo principal abajo. El compuesto promedia los factores con dato y la cobertura cuenta cuántas de las doce métricas trae cada emisora; todo se explica abajo, en “Qué mide cada factor”. Ordena con los encabezados.
                    </p>
                    <ScoresTable rows={shown} caption={`Puntajes por factor${where}`} />
                  </TabPanel>
                  <TabPanel id="checks">
                    <p className="kz-research-muted kz-screener-lead">
                      Seis criterios fijos, iguales para todas las emisoras, con el umbral escrito en cada encabezado. “Cumple” solo dice que el dato pasa ese umbral; no es una recomendación.
                    </p>
                    <ChecksTable rows={shown} defs={defs} caption={`Pruebas cumple o no cumple${where}`} />
                  </TabPanel>
                  <TabPanel id="metrics">
                    <p className="kz-research-muted kz-screener-lead">
                      Las doce métricas crudas detrás de los puntajes. Rendimientos, márgenes y crecimientos en porcentaje; deuda entre capital como razón.
                    </p>
                    <MetricsTable rows={shown} caption={`Métricas crudas${where}`} />
                  </TabPanel>
                </Tabs>
                <RowNotes rows={shown} />
                <p className="kz-research-muted">
                  La fecha del tablero es la del último cierre de precio. Los estados financieros salen con semanas de retraso, así que los fundamentales pueden ser más viejos.
                </p>
              </div>
            )}
          </QueryBlock>
        </Card>
      ) : (
        <EmptyState headingAs="h2" title="Arma tu lista" text={`Escribe de ${CUSTOM_MIN} a ${CUSTOM_MAX} claves arriba, o usa una de tus watchlists.`} />
      )}
      {ready && shownExcluded.length ? (
        <Card title="Fuera del tablero" description="Sin datos suficientes para compararlas. Se muestran con su motivo en vez de esconderlas." padding="none">
          <ExcludedTable rows={shownExcluded} />
        </Card>
      ) : null}
      <FactorGuide method={data?.method} />
    </div>
  )
}
