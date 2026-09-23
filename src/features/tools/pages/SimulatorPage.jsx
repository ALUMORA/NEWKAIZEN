// /herramientas/simulador: Monte Carlo de un plan de ahorro, probabilidad de llegar a una meta y un
// escenario de retiro. Todo se calcula en el navegador con src/lib/finance (en su Web Worker); no
// hay datos del API, así que los supuestos son los que la persona escribe y se dicen como tales.
import { Suspense, lazy, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Card, EmptyState, ErrorState, NumberInput, PageHeader, SegmentedControl, Skeleton, Stat } from '../../../components/ui/index.js'
import { MISSING, fmtMoney, fmtPct } from '../../../lib/format.js'
import { PATHS } from '../../../app/paths.js'
import { DEFAULT_INPUTS, DEFAULT_PATHS, fanPoints, retirementFromSim, summarize, validateInputs } from '../simulator.js'
import { useSimulation } from '../useSimulation.js'
import '../tools.css'

const FanChart = lazy(() => import('../../../components/charts/FanChart.jsx').then((m) => ({ default: m.FanChart })))

const MONEY_FIELDS = [
  { key: 'initial', label: 'Saldo inicial', hint: 'Lo que ya tienes invertido hoy.' },
  { key: 'contribution', label: 'Aportación mensual', hint: 'Se suma al inicio de cada mes.' },
]
const PLAN_FIELDS = [
  { key: 'contributionGrowthPct', label: 'Crecimiento anual de la aportación', suffix: '%', hint: 'Cuánto subes tu aportación cada año. Igual a la inflación la mantiene en pesos de hoy.' },
  { key: 'years', label: 'Horizonte', suffix: 'años', decimals: 0, hint: 'Cuántos años vas a ahorrar.' },
  { key: 'inflationPct', label: 'Inflación anual', suffix: '%', hint: 'Sirve para pasar los montos a pesos de hoy.' },
]
const MARKET_FIELDS = [
  { key: 'returnPct', label: 'Rendimiento anual esperado', suffix: '%', hint: 'Promedio aritmético anual, antes de impuestos y comisiones.' },
  { key: 'volatilityPct', label: 'Volatilidad anual', suffix: '%', hint: 'Qué tanto se mueve el rendimiento de un año a otro.' },
]
const GOAL_FIELDS = [{ key: 'goal', label: 'Meta en pesos de hoy', prefix: '$', hint: 'El monto que quieres alcanzar, con el poder de compra de hoy.' }]
const RETIREMENT_FIELDS = [
  { key: 'withdrawalRatePct', label: 'Retiro del primer año', suffix: '% del saldo', hint: 'Después se ajusta cada año con la inflación.' },
  { key: 'retirementYears', label: 'Años de retiro', suffix: 'años', decimals: 0, hint: 'Cuántos años quieres que dure el dinero.' },
]

const VIEW_ITEMS = [
  { value: 'real', label: 'Pesos de hoy' },
  { value: 'nominal', label: 'Pesos del futuro' },
]

function Fields({ fields, values, errors, onChange }) {
  return fields.map((f) => (
    <NumberInput
      key={f.key}
      id={`sim-${f.key}`}
      label={f.label}
      hint={f.hint}
      error={errors[f.key]}
      value={values[f.key]}
      onChange={(v) => onChange(f.key, v)}
      prefix={f.prefix}
      suffix={f.suffix}
      decimals={f.decimals}
    />
  ))
}

export default function SimulatorPage() {
  const [values, setValues] = useState(/** @type {Record<string, number | null>} */ (DEFAULT_INPUTS))
  const [view, setView] = useState('real')
  const errors = useMemo(() => validateInputs(values), [values])
  const valid = Object.keys(errors).length === 0
  const inputs = valid ? /** @type {Record<string, number>} */ (values) : null
  const { sim, status, error } = useSimulation(inputs)
  const real = view === 'real'

  const onChange = (key, v) => setValues((prev) => ({ ...prev, [key]: v }))
  const summary = useMemo(() => (sim && inputs ? summarize(sim, inputs.goal, real) : null), [sim, inputs, real])
  const chart = useMemo(() => fanPoints(sim, real), [sim, real])
  const retirement = useMemo(() => (sim && inputs ? retirementFromSim(sim, inputs) : null), [sim, inputs])
  const loading = !sim && status !== 'error'
  const unit = real ? 'pesos de hoy' : 'pesos del futuro'

  return (
    <div className="kz-sim">
      <PageHeader
        eyebrow="Herramientas"
        title="Simulador de metas y retiro"
        description="Miles de escenarios posibles para tu plan de ahorro, con los supuestos a la vista para que los cambies."
      />

      <div className="kz-sim__layout">
        <Card title="Tu plan" description="Cada cambio vuelve a simular." className="kz-sim__inputs">
          <form className="kz-sim__form" onSubmit={(e) => e.preventDefault()} aria-label="Supuestos del plan">
            <fieldset className="kz-sim__group">
              <legend>Ahorro</legend>
              <Fields fields={MONEY_FIELDS.map((f) => ({ ...f, prefix: '$' }))} values={values} errors={errors} onChange={onChange} />
              <Fields fields={PLAN_FIELDS} values={values} errors={errors} onChange={onChange} />
            </fieldset>
            <fieldset className="kz-sim__group">
              <legend>Supuestos de mercado</legend>
              <Fields fields={MARKET_FIELDS} values={values} errors={errors} onChange={onChange} />
              <p className="kz-sim__source">
                Fuente de los valores iniciales: son supuestos de ejemplo de Kaizen para un portafolio mixto en pesos, no una
                estimación del mercado ni una promesa. Cámbialos por los tuyos.
              </p>
            </fieldset>
            <fieldset className="kz-sim__group">
              <legend>Meta y retiro</legend>
              <Fields fields={GOAL_FIELDS} values={values} errors={errors} onChange={onChange} />
              <Fields fields={RETIREMENT_FIELDS} values={values} errors={errors} onChange={onChange} />
            </fieldset>
          </form>
        </Card>

        <div className="kz-sim__results">
          {!valid ? (
            <Card title="Resultado">
              <EmptyState title="Revisa los campos marcados" text="Cuando todos los supuestos tengan un valor válido, simulamos de nuevo." />
            </Card>
          ) : status === 'error' ? (
            <Card title="Resultado">
              <ErrorState title="No pudimos simular este plan" message={error ?? undefined} />
            </Card>
          ) : (
            <>
              <Card
                title="Resultado al final del horizonte"
                description={`${DEFAULT_PATHS.toLocaleString('es-MX')} escenarios, montos en ${unit}.`}
                actions={<SegmentedControl label="Mostrar montos en" hideLabel items={VIEW_ITEMS} value={view} onChange={setView} name="sim-view" />}
              >
                <div className="kz-sim__stats" aria-busy={loading}>
                  <Stat
                    label="Escenario mediano"
                    value={summary ? fmtMoney(summary.median, 'MXN', { decimals: 0 }) : MISSING}
                    sublabel="La mitad de los escenarios termina arriba y la mitad abajo."
                    info={{ termKey: 'monte-carlo', term: 'Monte Carlo' }}
                    loading={loading}
                    size="lg"
                  />
                  <Stat
                    label="Probabilidad de llegar a la meta"
                    value={summary && summary.probability !== null ? fmtPct(summary.probability, { decimals: 0 }) : MISSING}
                    sublabel={inputs ? `Meta de ${fmtMoney(inputs.goal, 'MXN', { decimals: 0 })} en pesos de hoy.` : undefined}
                    loading={loading}
                    size="lg"
                  />
                  <Stat
                    label="Lo que aportaste"
                    value={summary ? fmtMoney(summary.contributed, 'MXN', { decimals: 0 }) : MISSING}
                    sublabel="Saldo inicial más todas las aportaciones."
                    loading={loading}
                  />
                  <Stat
                    label="Rango probable"
                    value={summary ? `${fmtMoney(summary.p5, 'MXN', { decimals: 0, compact: true })} a ${fmtMoney(summary.p95, 'MXN', { decimals: 0, compact: true })}` : MISSING}
                    sublabel="Entre el percentil 5 y el 95 de los escenarios."
                    info={{ termKey: 'real-vs-nominal', term: 'Real contra nominal' }}
                    loading={loading}
                  />
                </div>
              </Card>

              <Card title="Cómo puede crecer tu saldo" padding="md">
                {loading ? (
                  <Skeleton height={300} />
                ) : (
                  <Suspense fallback={<Skeleton height={300} />}>
                    <FanChart
                      title={`Saldo por año, en ${unit}`}
                      titleAs="h3"
                      points={chart.points}
                      extra={[{ label: 'Lo aportado', points: chart.contributed }]}
                      format="money"
                      decimals={0}
                      xType="number"
                      xLabel="Año"
                      xFormat={(x) => `Año ${Math.round(x)}`}
                      source="Simulación de Kaizen con tus supuestos (rendimientos lognormales mensuales)."
                    />
                  </Suspense>
                )}
              </Card>

              <Card title="Escenario de retiro" description="Qué pasaría si al final del horizonte empiezas a retirar del saldo mediano.">
                {loading ? (
                  <Skeleton lines={3} />
                ) : retirement ? (
                  <div className="kz-sim__stats">
                    <Stat label="Retiro mensual del primer año" value={fmtMoney(retirement.firstMonthWithdrawal, 'MXN', { decimals: 0 })} sublabel="En pesos del futuro." />
                    <Stat label="El mismo retiro en pesos de hoy" value={fmtMoney(retirement.firstMonthReal, 'MXN', { decimals: 0 })} sublabel="Para compararlo con tus gastos actuales." />
                    <Stat
                      label="¿Alcanza el dinero?"
                      value={retirement.depletedYear === null ? `Sí, ${inputs?.retirementYears} años` : `Se agota en el año ${retirement.depletedYear}`}
                      sublabel={`Saldo final en pesos de hoy: ${fmtMoney(retirement.finalBalanceReal, 'MXN', { decimals: 0 })}.`}
                    />
                  </div>
                ) : (
                  <EmptyState title="Sin saldo para retirar" text="Con estos supuestos el saldo mediano es cero, así que no hay escenario de retiro." />
                )}
              </Card>
            </>
          )}

          <Card title="Qué supone esta simulación">
            <ul className="kz-sim__notes">
              <li>Cada mes el rendimiento se sortea de una distribución lognormal con el rendimiento y la volatilidad que escribiste. El saldo nunca baja de cero.</li>
              <li>Las aportaciones entran al inicio de cada mes y crecen una vez al año con el porcentaje que elegiste.</li>
              <li>Los pesos de hoy descuentan la inflación: te dicen qué podrías comprar con ese dinero a precios de ahora.</li>
              <li>No incluye impuestos, comisiones ni cambios en tus ingresos. El pasado y los supuestos no garantizan resultados.</li>
              <li>Es una herramienta para explorar escenarios, no una recomendación de inversión.</li>
            </ul>
            <p className="kz-sim__more">
              <Link to={PATHS.learn}>Lee la metodología en Aprender</Link>
            </p>
          </Card>
        </div>
      </div>
    </div>
  )
}
