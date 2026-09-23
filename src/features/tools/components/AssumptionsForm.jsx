// Supuestos editables del optimizador: cómo se estiman los rendimientos, la prima de mercado, la
// tasa libre de riesgo, la caja de pesos y la covarianza. Ninguno se queda escondido en el código.
import { Button, NumberInput, SegmentedControl } from '../../../components/ui/index.js'
import { fmtDate, fmtPct } from '../../../lib/format.js'
import { ERP_SOURCE } from '../optimizer.js'

const MU_ITEMS = [
  { value: 'capm', label: 'CAPM' },
  { value: 'jamesStein', label: 'James y Stein' },
  { value: 'historical', label: 'Promedio' },
]
const COV_ITEMS = [
  { value: 'ledoitWolf', label: 'Ledoit y Wolf' },
  { value: 'sample', label: 'Muestral' },
]

const MU_HINT = {
  capm: 'Tasa libre de riesgo más beta por la prima de mercado. Es la opción por omisión porque solo estima betas.',
  jamesStein: 'El promedio histórico acercado al promedio de todas las emisoras. Menos ruidoso que el promedio solo.',
  historical: 'Promedio histórico semanal por 52. Con cinco años de datos su error es del tamaño del propio promedio.',
}

/**
 * @param {{ value: import('../assumptions.js').Assumptions, errors: Record<string, string>,
 *   onChange: (patch: Partial<import('../assumptions.js').Assumptions>) => void,
 *   apiRf: { yield: number, effective: number, date: string | null } | null, rfLoading: boolean }} props
 */
export function AssumptionsForm({ value, errors, onChange, apiRf, rfLoading }) {
  const rfShown = value.rfTouched ? value.rfPct : apiRf ? Math.round(apiRf.effective * 10000) / 100 : null
  const rfHint = value.rfTouched
    ? 'Tasa escrita por ti. La de CETES sigue abajo.'
    : apiRf
      ? `CETES 28 al ${fmtPct(apiRf.yield)} simple${apiRf.date ? ` del ${fmtDate(apiRf.date)}` : ''}, pasada a efectiva anual.`
      : rfLoading
        ? 'Trayendo la tasa de CETES 28.'
        : 'Escribe la tasa libre de riesgo anual.'

  return (
    <form className="kz-tool__form" onSubmit={(e) => e.preventDefault()} aria-label="Supuestos del optimizador">
      <fieldset className="kz-tool__group">
        <legend>Rendimientos esperados</legend>
        <SegmentedControl label="Método de rendimientos esperados" hideLabel items={MU_ITEMS} value={value.muMethod} onChange={(v) => onChange({ muMethod: v })} name="opt-mu" />
        <p className="kz-tool__hint" data-tone={value.muMethod === 'historical' ? 'warning' : undefined}>
          {value.muMethod === 'historical' && <strong>Ojo: </strong>}
          {MU_HINT[value.muMethod]}
        </p>
        <NumberInput
          id="opt-erp"
          label="Prima de riesgo de mercado"
          suffix="%"
          hint={`${ERP_SOURCE}. Solo la usa el CAPM.`}
          error={errors.erpPct}
          value={value.erpPct}
          onChange={(v) => onChange({ erpPct: v })}
          disabled={value.muMethod !== 'capm'}
        />
        <NumberInput id="opt-rf" label="Tasa libre de riesgo anual" suffix="%" hint={rfHint} error={errors.rfPct} value={rfShown} onChange={(v) => onChange({ rfPct: v, rfTouched: true })} />
        {value.rfTouched && apiRf && (
          <Button variant="ghost" size="sm" onClick={() => onChange({ rfPct: null, rfTouched: false })}>
            Volver a la tasa de CETES ({fmtPct(apiRf.effective)})
          </Button>
        )}
      </fieldset>
      <fieldset className="kz-tool__group">
        <legend>Caja de pesos</legend>
        <p className="kz-tool__hint">Límites por emisora para mínima varianza, máximo Sharpe y la frontera. La paridad de riesgo no los usa.</p>
        <div className="kz-tool__pair">
          <NumberInput id="opt-min" label="Peso mínimo" suffix="%" error={errors.minPct} value={value.minPct} onChange={(v) => onChange({ minPct: v })} />
          <NumberInput id="opt-max" label="Peso máximo" suffix="%" error={errors.maxPct} value={value.maxPct} onChange={(v) => onChange({ maxPct: v })} />
        </div>
      </fieldset>
      <fieldset className="kz-tool__group">
        <legend>Covarianza</legend>
        <SegmentedControl label="Estimador de covarianza" hideLabel items={COV_ITEMS} value={value.covMethod} onChange={(v) => onChange({ covMethod: v })} name="opt-cov" />
        <p className="kz-tool__hint" data-tone={value.covMethod === 'sample' ? 'warning' : undefined}>
          {value.covMethod === 'sample'
            ? 'Ojo: la muestral cruda exagera las correlaciones extremas y el optimizador las aprovecha. Úsala para comparar.'
            : 'Contracción hacia una correlación constante: más estable cuando hay muchas emisoras y pocos datos.'}
        </p>
      </fieldset>
    </form>
  )
}
