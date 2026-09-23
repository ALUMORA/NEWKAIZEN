// Galería del sistema de diseño (/dev/ui, fuera de producción). Cada primitiva de
// src/components/ui en cada uno de sus estados, en el tema activo: el cambio de tema está arriba.
// La revisan e2e/dev-ui.spec.js (axe, teclado) y las capturas de C1.
//
// Si existe ./ChartsGallery.jsx (de C2), se agrega al final como una sección más. Se busca con
// import.meta.glob para que esta página compile aunque C2 todavía no lo haya entregado.
import { Suspense, lazy, useState } from 'react'
import { ArrowRight, Download, Plus, Search, Trash2 } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DataStatus,
  DataTable,
  Delta,
  Dialog,
  Disclaimer,
  EmptyState,
  ErrorState,
  IconButton,
  InfoTip,
  InlineLink,
  Input,
  Mark,
  Money,
  NumberInput,
  PageHeader,
  SectionHeading,
  SearchCombobox,
  SegmentedControl,
  Select,
  Sheet,
  Skeleton,
  SrOnly,
  Stat,
  TabPanel,
  Tabs,
  ThemeToggle,
  useConfirm,
  useToast,
} from '../../components/ui/index.js'
import { MISSING, describeMultiple, fmtMoney, fmtNumber, fmtPct } from '../../lib/format.js'
import { GALLERY_NOW, SAMPLE_ROWS, SPACING, SWATCH_GROUPS, TYPE_SCALE } from './sample-data.js'
import './dev-ui.css'

const chartModules = import.meta.glob('./ChartsGallery.jsx')
const ChartsGallery = chartModules['./ChartsGallery.jsx'] ? lazy(/** @type {any} */ (chartModules['./ChartsGallery.jsx'])) : null

const SECTIONS = [
  { id: 'tokens', label: 'Tokens' },
  { id: 'botones', label: 'Botones' },
  { id: 'estado', label: 'Insignias y estado del dato' },
  { id: 'cifras', label: 'Cifras' },
  { id: 'formularios', label: 'Formularios' },
  { id: 'tabla', label: 'Tabla de datos' },
  { id: 'dialogos', label: 'Diálogos y avisos' },
  { id: 'estados', label: 'Carga, vacío y error' },
  { id: 'textos', label: 'Encabezados y avisos legales' },
  ...(ChartsGallery ? [{ id: 'graficas', label: 'Gráficas' }] : []),
]

/** Sección de la galería con su h2. */
function GallerySection({ id, title, description, children }) {
  return (
    <section className="dev-section" aria-labelledby={`${id}-titulo`} id={id}>
      <SectionHeading id={`${id}-titulo`} title={title} description={description} />
      {children}
    </section>
  )
}

/** Etiqueta de un ejemplo dentro de una tarjeta. */
function Specimen({ label, children, wide = false }) {
  return (
    <div className="dev-specimen" data-wide={wide || undefined}>
      <span className="kz-eyebrow">{label}</span>
      <div className="dev-specimen__body">{children}</div>
    </div>
  )
}

// ─── Tokens ─────────────────────────────────────────────────────────────────

function TokensSection() {
  return (
    <GallerySection
      id="tokens"
      title="Tokens"
      description="Todo color, tamaño y espacio sale de un token. Los de color cambian con el tema y pasan la revisión numérica de contraste (npm run test)."
    >
      <div className="dev-grid">
        {SWATCH_GROUPS.map((group) => (
          <Card key={group.title} title={group.title} titleAs="h3">
            <ul className="dev-swatches">
              {group.tokens.map((token, i) => (
                <li key={token} className="dev-swatch">
                  <span className="dev-swatch__chip" style={{ background: `var(${token})` }} aria-hidden="true">
                    {group.title.startsWith('Gráficas: categórica') ? <span className="dev-swatch__index">{i + 1}</span> : null}
                  </span>
                  <code className="dev-swatch__name">{token}</code>
                </li>
              ))}
            </ul>
          </Card>
        ))}
        <Card title="Escala tipográfica" titleAs="h3" description="Plus Jakarta Sans para la interfaz, JetBrains Mono para claves y cifras clave.">
          <ul className="dev-type">
            {TYPE_SCALE.map((row) => (
              <li key={row.token} className="dev-type__row">
                <code className="dev-type__token">
                  {row.token} · {row.px}px
                </code>
                <span className={row.caps ? 'kz-eyebrow' : undefined} style={row.caps ? undefined : { fontSize: `var(${row.token})`, lineHeight: 'var(--leading-tight)' }}>
                  {row.sample}
                </span>
              </li>
            ))}
            <li className="dev-type__row">
              <code className="dev-type__token">.mono .num</code>
              <span className="mono">WALMEX.MX 61.84 · AAPL 228.40</span>
            </li>
          </ul>
        </Card>
        <Card title="Espaciado" titleAs="h3" description="Base de 4px: --space-1 a --space-12.">
          <ul className="dev-spacing">
            {SPACING.map((step) => (
              <li key={step} className="dev-spacing__row">
                <code>--space-{step}</code>
                <span className="dev-spacing__bar" style={{ width: `var(--space-${step})` }} aria-hidden="true" />
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </GallerySection>
  )
}

// ─── Botones ────────────────────────────────────────────────────────────────

function ButtonsSection() {
  const [loading, setLoading] = useState(false)
  return (
    <GallerySection id="botones" title="Botones" description="Cuatro variantes y dos tamaños. En pantalla chica el tamaño normal llega a 44px de alto.">
      <Card title="Variantes y estados" titleAs="h3">
        <div className="dev-stack">
          <Specimen label="Variantes">
            <Button>Guardar</Button>
            <Button variant="secondary">Cancelar</Button>
            <Button variant="ghost">Ver detalle</Button>
            <Button variant="danger" icon={<Trash2 size={16} />}>
              Borrar
            </Button>
          </Specimen>
          <Specimen label="Tamaño chico">
            <Button size="sm">Aplicar</Button>
            <Button size="sm" variant="secondary" icon={<Download size={14} />}>
              Exportar CSV
            </Button>
            <Button size="sm" variant="ghost" iconEnd={<ArrowRight size={14} />}>
              Ver más
            </Button>
          </Specimen>
          <Specimen label="Carga y deshabilitado">
            <Button
              loading={loading}
              onClick={() => {
                setLoading(true)
                setTimeout(() => setLoading(false), 1500)
              }}
            >
              {loading ? 'Calculando' : 'Calcular'}
            </Button>
            <Button loading variant="secondary">
              Cargando
            </Button>
            <Button disabled>No disponible</Button>
          </Specimen>
          <Specimen label="Solo icono (nombre accesible obligatorio)">
            <IconButton label="Buscar emisora">
              <Search size={18} />
            </IconButton>
            <IconButton label="Agregar a la lista" variant="outline">
              <Plus size={18} />
            </IconButton>
            <IconButton label="Borrar" size="sm">
              <Trash2 size={16} />
            </IconButton>
            <ThemeToggle />
          </Specimen>
        </div>
      </Card>
    </GallerySection>
  )
}

// ─── Insignias y estado del dato ────────────────────────────────────────────

const STATUS_CASES = [
  { label: 'Al día, hoy', meta: { asOf: '2026-09-22T20:40:00Z', source: 'Yahoo Finance' } },
  { label: 'Con retraso', meta: { asOf: '2026-09-22T20:35:00Z', source: 'BMV vía Yahoo', delayMinutes: 15 } },
  { label: 'Viejo (stale)', meta: { asOf: '2026-09-19', source: 'Banxico', stale: true } },
  { label: 'Respaldo (fallback)', meta: { asOf: '2026-09-22T12:00:00Z', source: 'FRED', fallback: true } },
  { label: 'Respaldo y viejo', meta: { asOf: '2026-09-18', source: 'FRED', fallback: true, stale: true } },
  { label: 'Sin fecha', meta: { source: 'Proveedor desconocido' } },
  { label: 'Otro año', meta: { asOf: '2025-12-31', source: 'INEGI' } },
]

function StatusSection() {
  return (
    <GallerySection
      id="estado"
      title="Insignias y estado del dato"
      description="DataStatus nunca esconde que un dato es de respaldo o viejo. Toca una insignia para ver fuente, fecha y retraso."
    >
      <div className="dev-grid dev-grid--2">
        <Card title="Insignias" titleAs="h3">
          <div className="dev-stack">
            <Specimen label="Tonos">
              <Badge>Neutra</Badge>
              <Badge tone="accent">Nuevo</Badge>
              <Badge tone="positive" dot>
                Mercado abierto
              </Badge>
              <Badge tone="negative" dot>
                Mercado cerrado
              </Badge>
              <Badge tone="warning">Dato viejo</Badge>
              <Badge tone="info">EJEMPLO</Badge>
            </Specimen>
            <Specimen label="Tamaño mediano">
              <Badge size="md">12 emisoras</Badge>
              <Badge size="md" tone="accent">
                Portafolio activo
              </Badge>
            </Specimen>
          </div>
        </Card>
        <Card title="Estado del dato" titleAs="h3" description="Meta v2: asOf, source, delayMinutes, stale y fallback.">
          <ul className="dev-status-list">
            {STATUS_CASES.map((c) => (
              <li key={c.label}>
                <span className="dev-status-list__label">{c.label}</span>
                <DataStatus {...c.meta} now={GALLERY_NOW} />
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </GallerySection>
  )
}

// ─── Cifras ─────────────────────────────────────────────────────────────────

function FiguresSection() {
  return (
    <GallerySection
      id="cifras"
      title="Cifras"
      description="Todo número pasa por src/lib/format.js: signo menos U+2212, s/d para faltantes y el color nunca va solo."
    >
      <Card title="Métricas" titleAs="h3" status={{ asOf: '2026-09-22T20:40:00Z', source: 'Yahoo Finance', delayMinutes: 15, now: GALLERY_NOW }}>
        <div className="kz-metric-grid">
          <Stat
            label="Valor del portafolio"
            info={{ termKey: 'rendimiento-total', term: 'Rendimiento total' }}
            value={<Money value={1234567.89} />}
            delta={<Delta value={0.0123} arrow />}
            sublabel="Contra el cierre de ayer"
          />
          <Stat label="Ganancia no realizada" value={<Money value={-11410.5} />} delta={<Delta value={-0.0345} arrow />} sublabel="Desde el costo promedio" />
          <Stat
            label="USD/MXN (FIX)"
            info={{ termKey: 'tipo-de-cambio-fix', term: 'Tipo de cambio FIX' }}
            value={<span className="num">18.9215</span>}
            delta={<Delta value={0.0041} direction="neutral" arrow hint="peso más débil" />}
            status={{ asOf: '2026-09-22T18:00:00Z', source: 'Banxico', now: GALLERY_NOW }}
          />
          <Stat
            label="Índice de Sharpe"
            info={{ termKey: 'sharpe', term: 'Índice de Sharpe' }}
            value={<span className="num">{fmtNumber(0.87)}</span>}
            sublabel="3 años, contra CETES 28"
          />
          <Stat label="Rendimiento por dividendo" value={null} sublabel="La emisora no reporta dividendos" />
          <Stat label="Volatilidad anual" loading />
        </div>
      </Card>
      <div className="dev-grid dev-grid--2">
        <Card title="Delta" titleAs="h3" description="Variación con signo; la flecha es opcional y decorativa.">
          <dl className="dev-pairs">
            <dt>Porcentaje, sube</dt>
            <dd>
              <Delta value={0.0123} arrow />
            </dd>
            <dt>Porcentaje, baja</dt>
            <dd>
              <Delta value={-0.0045} arrow />
            </dd>
            <dt>Redondea a cero</dt>
            <dd>
              <Delta value={0.00001} arrow />
            </dd>
            <dt>Puntos porcentuales</dt>
            <dd>
              <Delta value={0.0035} kind="pp" />
            </dd>
            <dt>Puntos base</dt>
            <dd>
              <Delta value={-25} kind="bp" />
            </dd>
            <dt>Dinero</dt>
            <dd>
              <Delta value={1520.4} kind="money" currency="USD" />
            </dd>
            <dt>Sin bueno ni malo</dt>
            <dd>
              <Delta value={0.0041} direction="neutral" hint="peso más débil" />
            </dd>
            <dt>Sin dato</dt>
            <dd>
              <Delta value={null} />
            </dd>
          </dl>
        </Card>
        <Card title="Dinero" titleAs="h3" description="Código de moneda siempre al final; compacto guarda el monto exacto en el title.">
          <dl className="dev-pairs">
            <dt>Pesos</dt>
            <dd>
              <Money value={1234.56} />
            </dd>
            <dt>Dólares, negativo</dt>
            <dd>
              <Money value={-1141} currency="USD" />
            </dd>
            <dt>Compacto</dt>
            <dd>
              <Money value={1_078_000_000_000} compact />
            </dd>
            <dt>Con signo</dt>
            <dd>
              <Money value={250} sign />
            </dd>
            <dt>Sin dato</dt>
            <dd>
              <Money value={undefined} />
            </dd>
            <dt>Porcentaje suelto</dt>
            <dd className="num">{fmtPct(0.1175)}</dd>
          </dl>
        </Card>
      </div>
    </GallerySection>
  )
}

// ─── Formularios ────────────────────────────────────────────────────────────

/** Buscador de emisoras: lo elegido sale de la lista (exclude) para no repetirlo. */
function ComboboxDemo() {
  const [picked, setPicked] = useState(/** @type {string[]} */ ([]))
  return (
    <Card title="Buscador de emisoras" titleAs="h3">
      <div className="dev-stack">
        <SearchCombobox
          label="Agregar emisora"
          hint="Nombre o clave. Busca en /v2/search 200 ms después de la última tecla."
          exclude={picked}
          onSelect={(option) => setPicked((list) => [...list, String(option.symbol)])}
        />
        <p className="dev-note" data-testid="combobox-picked">
          {picked.length ? `Elegidas: ${picked.join(', ')}` : 'Todavía no eliges ninguna emisora.'}
        </p>
      </div>
    </Card>
  )
}

function FormsSection() {
  const [amount, setAmount] = useState(/** @type {number | null} */ (25000))
  const [rate, setRate] = useState(/** @type {number | null} */ (null))
  const [symbol, setSymbol] = useState('')
  const [currency, setCurrency] = useState('MXN')
  const [range, setRange] = useState('1a')
  const [tab, setTab] = useState('resumen')

  return (
    <GallerySection id="formularios" title="Formularios" description="Etiqueta, ayuda y error conectados solos. Los números se escriben como en México: 1,234.56.">
      <div className="dev-grid dev-grid--2">
        <Card title="Campos" titleAs="h3">
          <div className="dev-form">
            <Input label="Emisora" hint="Clave de pizarra, por ejemplo WALMEX.MX" value={symbol} onChange={(e) => setSymbol(e.target.value)} />
            <NumberInput
              label="Monto a invertir"
              prefix="$"
              suffix="MXN"
              decimals={2}
              value={amount}
              onChange={setAmount}
              hint={`Leído: ${amount === null ? MISSING : fmtMoney(amount, 'MXN')}`}
              required
            />
            <NumberInput
              label="Tasa anual esperada"
              suffix="%"
              value={rate}
              onChange={setRate}
              error={rate === null ? 'Escribe una tasa, por ejemplo 7.5' : rate > 100 ? 'La tasa no puede pasar de 100%' : undefined}
            />
            <Select
              label="Moneda base"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              options={[
                { value: 'MXN', label: 'Pesos mexicanos (MXN)' },
                { value: 'USD', label: 'Dólares (USD)' },
              ]}
            />
            <Input label="Nota (deshabilitado)" value="Saldo inicial migrado" disabled readOnly />
          </div>
        </Card>
        <ComboboxDemo />
        <Card title="Selección" titleAs="h3">
          <div className="dev-stack">
            <SegmentedControl
              label="Periodo"
              value={range}
              onChange={setRange}
              items={[
                { value: '1m', label: '1M' },
                { value: '3m', label: '3M' },
                { value: '1a', label: '1A' },
                { value: '5a', label: '5A' },
                { value: 'max', label: 'Máx', disabled: true },
              ]}
            />
            <p className="dev-note">
              Periodo elegido: <strong>{range.toUpperCase()}</strong>
            </p>
            <Tabs
              label="Secciones de la emisora"
              value={tab}
              onChange={setTab}
              items={[
                { id: 'resumen', label: 'Resumen' },
                { id: 'finanzas', label: 'Estados financieros', badge: 4 },
                { id: 'dividendos', label: 'Dividendos' },
                { id: 'insiders', label: 'Insiders', disabled: true },
              ]}
            >
              <TabPanel id="resumen">
                <p className="dev-note">Precio, variación, múltiplos y la ficha de la emisora.</p>
              </TabPanel>
              <TabPanel id="finanzas">
                <p className="dev-note">Estados reales de los últimos cuatro trimestres; nunca trimestres inventados.</p>
              </TabPanel>
              <TabPanel id="dividendos">
                <p className="dev-note">Pagos de los últimos doce meses y su rendimiento.</p>
              </TabPanel>
            </Tabs>
          </div>
        </Card>
      </div>
    </GallerySection>
  )
}

// ─── Tabla ──────────────────────────────────────────────────────────────────

const TABLE_COLUMNS = [
  { key: 'symbol', header: 'Emisora', sortable: true, format: (v) => <span className="mono">{v}</span> },
  { key: 'name', header: 'Nombre', sortable: true },
  { key: 'sector', header: 'Sector' },
  { key: 'price', header: 'Precio', numeric: true, sortable: true, format: (v, row) => fmtMoney(v, row.currency) },
  { key: 'change', header: 'Día', numeric: true, sortable: true, format: (v) => <Delta value={v} /> },
  { key: 'ytd', header: 'En el año', numeric: true, sortable: true, format: (v) => <Delta value={v} /> },
  {
    key: 'pe',
    header: 'P/U',
    numeric: true,
    sortable: true,
    info: { termKey: 'p-u', term: 'P/U' },
    format: (v) => {
      const { text, title } = describeMultiple(v)
      return (
        <span title={title} className={text === MISSING || title ? 'kz-missing' : undefined}>
          {text}
        </span>
      )
    },
  },
  { key: 'marketCap', header: 'Valor de mercado', numeric: true, sortable: true, format: (v, row) => fmtMoney(v, row.currency, { compact: true }) },
  { key: 'volume', header: 'Volumen', numeric: true, sortable: true, format: (v) => fmtNumber(v, { compact: true }) },
]

function TableSection() {
  const toast = useToast()
  const [state, setState] = useState('datos')
  return (
    <GallerySection
      id="tabla"
      title="Tabla de datos"
      description="Ordena con los encabezados (clic, Enter o Espacio). La primera columna se queda fija y el scroll horizontal vive dentro del marco."
    >
      <Card
        title="Emisoras de muestra"
        titleAs="h3"
        description="Datos inventados para ver formatos; no son cotizaciones."
        padding="none"
        actions={
          <SegmentedControl
            label="Estado de la tabla"
            hideLabel
            value={state}
            onChange={setState}
            items={[
              { value: 'datos', label: 'Con datos' },
              { value: 'cargando', label: 'Cargando' },
              { value: 'vacia', label: 'Vacía' },
              { value: 'error', label: 'Error' },
            ]}
          />
        }
        footer={<DataStatus asOf="2026-09-22T20:35:00Z" source="Yahoo Finance" delayMinutes={15} now={GALLERY_NOW} />}
      >
        <DataTable
          caption="Emisoras de muestra con precio, variación y múltiplos"
          captionHidden
          columns={TABLE_COLUMNS}
          rows={state === 'vacia' ? [] : SAMPLE_ROWS}
          rowKey="symbol"
          defaultSort={{ key: 'marketCap', direction: 'descending' }}
          loading={state === 'cargando'}
          error={state === 'error' ? 'El proveedor no respondió. Tus datos guardados no se perdieron.' : undefined}
          onRetry={() => setState('datos')}
          empty={{ title: 'Tu lista está vacía', text: 'Agrega emisoras desde el buscador para seguirlas aquí.' }}
          onRowClick={(row) => toast.show({ title: `Abrirías ${row.symbol}`, description: 'En la app, la fila lleva a la ficha de la emisora.', tone: 'info' })}
          rowLabel={(row) => `Abrir ${row.symbol}, ${row.name}`}
        />
      </Card>
    </GallerySection>
  )
}

// ─── Diálogos y avisos ──────────────────────────────────────────────────────

const INITIAL_MOVES = [
  { id: 'm1', text: 'Compra de 100 WALMEX.MX' },
  { id: 'm2', text: 'Depósito de $5,000.00 MXN' },
  { id: 'm3', text: 'Dividendo de GFNORTEO.MX' },
]

function DialogsSection() {
  const toast = useToast()
  const confirm = useConfirm()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [toDelete, setToDelete] = useState(/** @type {typeof INITIAL_MOVES[number] | null} */ (null))
  const [moves, setMoves] = useState(INITIAL_MOVES)
  const [confirmResult, setConfirmResult] = useState('')
  const [qty, setQty] = useState(/** @type {number | null} */ (100))

  function removeMove(move) {
    const index = moves.findIndex((m) => m.id === move.id)
    setMoves((list) => list.filter((m) => m.id !== move.id))
    setToDelete(null)
    toast.show({
      title: 'Movimiento borrado',
      description: move.text,
      action: {
        label: 'Deshacer',
        onClick: () => {
          setMoves((list) => {
            const next = [...list]
            next.splice(Math.min(index, next.length), 0, move)
            return next
          })
          toast.show({ title: 'Movimiento restaurado', tone: 'positive' })
        },
      },
    })
  }

  return (
    <GallerySection
      id="dialogos"
      title="Diálogos y avisos"
      description="Diálogos nativos con el foco atrapado adentro, Esc para cerrar y el foco de regreso a su botón. Los avisos se anuncian con aria-live."
    >
      <div className="dev-grid dev-grid--2">
        <Card title="Movimientos" titleAs="h3" description="Borrar pide confirmación y el aviso ofrece Deshacer.">
          <p className="dev-note" data-testid="moves-count">
            {moves.length === 1 ? '1 movimiento' : `${moves.length} movimientos`}
          </p>
          <ul className="dev-moves">
            {moves.map((move) => (
              <li key={move.id}>
                <span>{move.text}</span>
                <IconButton label={`Borrar ${move.text}`} size="sm" onClick={() => setToDelete(move)}>
                  <Trash2 size={16} />
                </IconButton>
              </li>
            ))}
          </ul>
          <ConfirmDialog
            open={toDelete !== null}
            title="¿Borrar este movimiento?"
            message={toDelete ? `${toDelete.text}. Tu portafolio se recalcula sin él.` : undefined}
            confirmLabel="Borrar"
            destructive
            onConfirm={() => toDelete && removeMove(toDelete)}
            onCancel={() => setToDelete(null)}
          />
        </Card>
        <Card title="Otros diálogos" titleAs="h3">
          <div className="dev-stack">
            <Specimen label="Dialog">
              <Button variant="secondary" onClick={() => setDialogOpen(true)}>
                Editar movimiento
              </Button>
            </Specimen>
            <Specimen label="Sheet (hoja de abajo)">
              <Button variant="secondary" onClick={() => setSheetOpen(true)}>
                Abrir menú Más
              </Button>
            </Specimen>
            <Specimen label="useConfirm">
              <Button
                variant="secondary"
                onClick={async () => {
                  const ok = await confirm({ title: '¿Cambiar la moneda base a USD?', message: 'Los totales se van a mostrar en dólares.', confirmLabel: 'Cambiar' })
                  setConfirmResult(ok ? 'Confirmado' : 'Cancelado')
                }}
              >
                Pedir confirmación
              </Button>
              {confirmResult && <span className="dev-note">Resultado: {confirmResult}</span>}
            </Specimen>
            <Specimen label="Avisos">
              <Button size="sm" variant="secondary" onClick={() => toast.show({ title: 'Lista guardada' })}>
                Neutro
              </Button>
              <Button size="sm" variant="secondary" onClick={() => toast.show({ title: 'Portafolio importado', description: '12 movimientos leídos del CSV.', tone: 'positive' })}>
                Éxito
              </Button>
              <Button size="sm" variant="secondary" onClick={() => toast.show({ title: 'No se pudo guardar', description: 'Revisa tu conexión e inténtalo otra vez.', tone: 'negative' })}>
                Error
              </Button>
            </Specimen>
          </div>
        </Card>
      </div>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="Editar movimiento"
        description="Compra de WALMEX.MX del 19 sep 2026."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                setDialogOpen(false)
                toast.show({ title: 'Movimiento actualizado', tone: 'positive' })
              }}
            >
              Guardar cambios
            </Button>
          </>
        }
      >
        <div className="dev-form">
          <NumberInput label="Títulos" value={qty} onChange={setQty} decimals={0} />
          <NumberInput label="Precio por título" prefix="$" suffix="MXN" value={61.84} onChange={() => {}} decimals={2} />
        </div>
      </Dialog>

      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Más opciones">
        <div className="dev-stack">
          <ul className="dev-sheet-links">
            <li>
              <a href="#tabla" onClick={() => setSheetOpen(false)}>
                Watchlist
              </a>
            </li>
            <li>
              <a href="#textos" onClick={() => setSheetOpen(false)}>
                Aprender
              </a>
            </li>
          </ul>
          <ThemeToggle variant="segmented" />
        </div>
      </Sheet>
    </GallerySection>
  )
}

// ─── Carga, vacío y error ───────────────────────────────────────────────────

function StatesSection() {
  return (
    <GallerySection id="estados" title="Carga, vacío y error">
      <div className="dev-grid dev-grid--3">
        <Card title="Esqueleto" titleAs="h3">
          <div className="dev-stack" aria-busy="true">
            <Skeleton width="40%" height={12} />
            <Skeleton height={28} width="70%" />
            <Skeleton lines={3} />
            <SrOnly>Cargando</SrOnly>
          </div>
        </Card>
        <Card title="Vacío" titleAs="h3">
          <EmptyState
            title="Todavía no tienes un portafolio"
            text="Crea uno desde cero o importa tus movimientos de un CSV."
            action={<Button icon={<Plus size={16} />}>Crear portafolio</Button>}
          />
        </Card>
        <Card title="Error" titleAs="h3">
          <ErrorState message="El servidor tardó demasiado en responder. Puede estar despertando." onRetry={() => {}} />
        </Card>
      </div>
    </GallerySection>
  )
}

// ─── Encabezados y avisos legales ───────────────────────────────────────────

function TextsSection() {
  return (
    <GallerySection id="textos" title="Encabezados y avisos legales">
      <div className="dev-grid dev-grid--2">
        <Card title="Encabezado de sección" titleAs="h3">
          <div className="dev-stack">
            <SectionHeading
              as="h3"
              title="Riesgo del portafolio"
              description="Volatilidad, caída máxima y contribución de cada emisora."
              info={{ termKey: 'volatilidad', term: 'Volatilidad' }}
              actions={
                <Button size="sm" variant="ghost">
                  Metodología
                </Button>
              }
            />
            <Specimen label="InfoTip">
              <span className="dev-inline">
                Término del glosario <InfoTip termKey="cetes" term="CETES" />
              </span>
              <span className="dev-inline">
                Texto propio <InfoTip term="Costo promedio" text="Lo que pagaste por título en promedio, con comisiones." link={false} />
              </span>
            </Specimen>
            <Specimen label="InlineLink">
              <p className="dev-note">
                Lee la <InlineLink to="/aprender/volatilidad">metodología de la volatilidad</InlineLink> o consulta la fuente en el{' '}
                <InlineLink href="https://www.banxico.org.mx/">sitio de Banxico</InlineLink>.
              </p>
            </Specimen>
          </div>
        </Card>
        <Card title="Marca y avisos" titleAs="h3">
          <div className="dev-stack">
            <Specimen label="Mark">
              <Mark size={24} />
              <Mark size={32} />
              <Mark size={48} label="Kaizen" />
            </Specimen>
            <Disclaimer />
            <Disclaimer variant="long" />
          </div>
        </Card>
      </div>
    </GallerySection>
  )
}

export default function DevUiPage() {
  return (
    <main className="dev-page kz-page" id="contenido">
      <PageHeader
        eyebrow="Solo desarrollo"
        title="Sistema de diseño"
        description="Cada primitiva de src/components/ui en cada estado. Cambia el tema para revisar los dos; las props exactas están en docs/design.md."
        breadcrumbs={[{ label: 'Kaizen', to: '/' }, { label: 'Desarrollo' }, { label: 'Sistema de diseño' }]}
        actions={<ThemeToggle variant="segmented" />}
      />
      <nav aria-label="Secciones de la galería" className="dev-toc">
        <ul>
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`}>{s.label}</a>
            </li>
          ))}
        </ul>
      </nav>
      <TokensSection />
      <ButtonsSection />
      <StatusSection />
      <FiguresSection />
      <FormsSection />
      <TableSection />
      <DialogsSection />
      <StatesSection />
      <TextsSection />
      {ChartsGallery && (
        <GallerySection id="graficas" title="Gráficas">
          <Suspense fallback={<Skeleton height={240} />}>
            <ChartsGallery />
          </Suspense>
        </GallerySection>
      )}
      <footer className="dev-footer">
        <Disclaimer />
      </footer>
    </main>
  )
}
