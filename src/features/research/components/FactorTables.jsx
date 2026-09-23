// Tablas del screener de factores: puntajes (con el dato crudo junto a cada puntaje), pruebas
// "cumple / no cumple" con su umbral escrito, las doce métricas crudas y las emisoras que
// quedaron fuera. Ninguna columna dice qué hacer.
import { Check, Minus, X } from 'lucide-react'
import { Link } from 'react-router'
import { Badge, DataTable } from '../../../components/ui/index.js'
import { pathInstrument } from '../../../app/paths.js'
import {
  FACTORS,
  METRICS,
  checkValueText,
  checksOf,
  checksText,
  coverageOf,
  fmtMetric,
  fmtZ,
  reasonTag,
  shortName,
} from '../screener-model.js'

/** @typedef {{ symbol: string, name: string | null, sector: string | null, scores: Record<string, number | null> | null,
 *   coverage: number, excluded: boolean, reason: string | null,
 *   checks: { id: string, label: string, pass: boolean | null, value: unknown, threshold: unknown }[],
 *   metrics: Record<string, number | null> }} FactorRow */

const DEFAULT_SORT = /** @type {const} */ ({ key: 'composite', direction: 'descending' })

/** Clave con liga a la ficha y nombre; con `sector`, también el sector y su nota corta. @param {{ row: FactorRow, sector?: boolean }} props */
function Emisora({ row, sector = false }) {
  const tag = sector ? reasonTag(row.reason) : null
  return (
    <span className="kz-screener-emisora">
      <Link className="kz-screener-link mono" to={pathInstrument(row.symbol)}>
        {row.symbol}
      </Link>
      <span className="kz-screener-name">{shortName(row.name) || 's/d'}</span>
      {sector ? (
        <span className="kz-screener-tag">
          {row.sector || 'Sin sector'}
          {tag ? ` · ${tag}` : ''}
        </span>
      ) : null}
    </span>
  )
}

const emisoraColumn = {
  key: 'symbol',
  header: 'Emisora',
  sortable: true,
  minWidth: 150,
  format: (_v, /** @type {FactorRow} */ row) => <Emisora row={row} />,
}

/** @param {{ z: number | null | undefined, raw?: string }} props */
function Score({ z, raw }) {
  const missing = typeof z !== 'number'
  return (
    <span className="kz-screener-score">
      <span className={missing ? 'num kz-missing' : 'num'}>{fmtZ(z)}</span>
      {raw ? <span className="kz-screener-raw num">{raw}</span> : null}
    </span>
  )
}

/** Barra divergente de −3 a +3 junto al compuesto; decorativa, el número dice lo mismo. @param {{ z: number | null | undefined }} props */
function ZBar({ z }) {
  if (typeof z !== 'number') return null
  const share = Math.min(Math.abs(z), 3) / 3
  return (
    <span className="kz-screener-zbar" aria-hidden="true">
      <span className="kz-screener-zbar__fill" data-side={z < 0 ? 'neg' : 'pos'} style={{ width: `${share * 50}%` }} />
    </span>
  )
}

/** Encabezado largo que se parte en renglones en vez de ensanchar la tabla. @param {{ children: string }} props */
function Wrap({ children }) {
  return <span className="kz-screener-wrap">{children}</span>
}

/** @param {{ label: string, sub: string }} props */
function Header({ label, sub }) {
  return (
    <span className="kz-screener-th">
      {label}
      <small>{sub}</small>
    </span>
  )
}

/** @param {{ rows: FactorRow[], caption: string }} props */
export function ScoresTable({ rows, caption }) {
  const columns = [
    { ...emisoraColumn, header: 'Emisora y sector', format: (_v, /** @type {FactorRow} */ row) => <Emisora row={row} sector /> },
    {
      key: 'composite',
      header: 'Compuesto',
      numeric: true,
      sortable: true,
      sortValue: (/** @type {FactorRow} */ row) => row.scores?.composite,
      format: (_v, /** @type {FactorRow} */ row) => (
        <span className="kz-screener-composite">
          <ZBar z={row.scores?.composite} />
          <Score z={row.scores?.composite} />
        </span>
      ),
    },
    ...FACTORS.map((f) => ({
      key: `f-${f.key}`,
      header: <Header label={f.label} sub={f.rawLabel} />,
      numeric: true,
      sortable: true,
      minWidth: 90,
      info: { termKey: 'termKey' in f ? f.termKey : undefined, term: f.label, text: f.text },
      sortValue: (/** @type {FactorRow} */ row) => row.scores?.[f.key],
      format: (_v, /** @type {FactorRow} */ row) => <Score z={row.scores?.[f.key]} raw={fmtMetric(f.raw, row.metrics?.[f.raw])} />,
    })),
    {
      key: 'coverage',
      header: 'Cobertura',
      numeric: true,
      sortable: true,
      format: (_v, /** @type {FactorRow} */ row) => {
        const c = coverageOf(row)
        return `${c.have} de ${c.total}`
      },
    },
  ]
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey="symbol"
      caption={caption}
      defaultSort={DEFAULT_SORT}
      density="compact"
      empty={{ title: 'Sin emisoras con este filtro', text: 'Elige otro sector o todos los sectores.' }}
    />
  )
}

/** @param {{ check: FactorRow['checks'][number] | undefined }} props */
function CheckCell({ check }) {
  if (!check || check.pass == null) {
    return (
      <span className="kz-screener-check">
        <Badge icon={<Minus size={12} />}>Sin dato</Badge>
      </span>
    )
  }
  return (
    <span className="kz-screener-check">
      {check.pass ? (
        <Badge tone="positive" icon={<Check size={12} />}>
          Cumple
        </Badge>
      ) : (
        <Badge icon={<X size={12} />}>No cumple</Badge>
      )}
      <span className="kz-screener-raw num">{checkValueText(check)}</span>
    </span>
  )
}

/** @param {{ rows: FactorRow[], defs: FactorRow['checks'], caption: string }} props */
export function ChecksTable({ rows, defs, caption }) {
  const columns = [
    emisoraColumn,
    ...defs.map((d) => ({
      key: `c-${d.id}`,
      header: <Wrap>{d.label}</Wrap>,
      align: /** @type {const} */ ('left'),
      sortable: true,
      minWidth: 104,
      sortValue: (/** @type {FactorRow} */ row) => {
        const pass = row.checks?.find((c) => c.id === d.id)?.pass
        return pass == null ? null : pass ? 1 : 0
      },
      format: (_v, /** @type {FactorRow} */ row) => <CheckCell check={row.checks?.find((c) => c.id === d.id)} />,
    })),
    {
      key: 'checks',
      header: <Wrap>Total que cumple</Wrap>,
      numeric: true,
      sortable: true,
      sortValue: (/** @type {FactorRow} */ row) => checksOf(row).pass,
      format: (_v, /** @type {FactorRow} */ row) => checksText(row),
    },
  ]
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey="symbol"
      caption={caption}
      defaultSort={{ key: 'checks', direction: 'descending' }}
      density="compact"
      empty={{ title: 'Sin emisoras con este filtro', text: 'Elige otro sector o todos los sectores.' }}
    />
  )
}

/** @param {{ rows: FactorRow[], caption: string }} props */
export function MetricsTable({ rows, caption }) {
  const columns = [
    emisoraColumn,
    ...METRICS.map((m) => ({
      key: `m-${m.key}`,
      header: <Wrap>{m.label}</Wrap>,
      numeric: true,
      sortable: true,
      minWidth: 90,
      info: { termKey: 'termKey' in m ? m.termKey : undefined, term: m.label, text: 'text' in m ? m.text : undefined },
      sortValue: (/** @type {FactorRow} */ row) => row.metrics?.[m.key],
      format: (_v, /** @type {FactorRow} */ row) => {
        const text = fmtMetric(m.key, row.metrics?.[m.key])
        return text === 's/d' ? <span className="kz-missing">s/d</span> : text
      },
    })),
  ]
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey="symbol"
      caption={caption}
      density="compact"
      empty={{ title: 'Sin emisoras con este filtro', text: 'Elige otro sector o todos los sectores.' }}
    />
  )
}

/** @param {{ rows: FactorRow[] }} props */
export function ExcludedTable({ rows }) {
  const columns = [
    emisoraColumn,
    { key: 'sector', header: 'Sector', format: (/** @type {string | null} */ v) => v || 'Sin sector' },
    {
      key: 'coverage',
      header: 'Cobertura',
      numeric: true,
      format: (_v, /** @type {FactorRow} */ row) => {
        const c = coverageOf(row)
        return `${c.have} de ${c.total}`
      },
    },
    { key: 'reason', header: 'Motivo', minWidth: 240, format: (/** @type {string | null} */ v) => v || 's/d' },
  ]
  return <DataTable columns={columns} rows={rows} rowKey="symbol" caption="Emisoras fuera del tablero" captionHidden density="compact" />
}
