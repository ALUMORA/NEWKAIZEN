// Qué se prueba en el backtest: de dónde salen los pesos, la estrategia, el referente y el periodo.
import { Button, NumberInput, SegmentedControl, Select } from '../../../components/ui/index.js'
import { BENCHMARKS, RANGES, REBALANCE } from '../backtester.js'
import { SymbolPicker } from './SymbolPicker.jsx'

export const MAX_BT_ASSETS = 20

const STRATEGIES = [
  { value: 'buyAndHold', label: 'Comprar y mantener' },
  { value: 'constantMix', label: 'Mezcla constante' },
]

/**
 * @param {{ state: any, set: (patch: any) => void, hasPortfolio: boolean, portfolioSymbols: string[],
 *   onSymbols: (next: string[]) => void, manual: { errors: Record<string, string>, sumError: string | null, total: number },
 *   blendError: string | null, onEqual: () => void }} props
 */
export function BacktestForm({ state, set, hasPortfolio, portfolioSymbols, onSymbols, manual, blendError, onEqual }) {
  const modes = [
    { value: 'portfolio', label: 'Mi portafolio hoy', disabled: !hasPortfolio },
    { value: 'manual', label: 'Los escribo yo' },
  ]
  return (
    // Un div y no un <form>: adentro vive el formulario de búsqueda de emisoras y los formularios
    // no se anidan (Enter mandaría el de afuera y recargaría la página).
    <div className="kz-tool__form">
      <fieldset className="kz-tool__group">
        <legend>Pesos</legend>
        <SegmentedControl label="De dónde salen los pesos" hideLabel items={modes} value={state.mode} onChange={(v) => set({ mode: v })} name="bt-mode" />
        {state.mode === 'portfolio' ? (
          <p className="kz-tool__hint">Cada emisora pesa lo que vale hoy en tu portafolio activo. Esos pesos se aplican desde el inicio del periodo.</p>
        ) : (
          <>
            <SymbolPicker id="bt-symbols" selected={state.symbols} onChange={onSymbols} max={MAX_BT_ASSETS} portfolioSymbols={portfolioSymbols} />
            {state.symbols.length > 0 && (
              <div className="kz-tool__weights">
                {state.symbols.map((s) => (
                  <NumberInput
                    key={s}
                    id={`bt-w-${s}`}
                    label={`Peso de ${s}`}
                    suffix="%"
                    error={manual.errors[s]}
                    value={state.percents[s] ?? null}
                    onChange={(v) => set({ percents: { ...state.percents, [s]: v } })}
                  />
                ))}
                <p className="kz-tool__hint" role={manual.sumError ? 'alert' : undefined} data-tone={manual.sumError ? 'warning' : undefined}>
                  {manual.sumError ?? `Suman ${Math.round(manual.total * 100) / 100} %.`}
                </p>
                <Button variant="ghost" size="sm" onClick={onEqual}>
                  Repartir parejo
                </Button>
              </div>
            )}
          </>
        )}
      </fieldset>
      <fieldset className="kz-tool__group">
        <legend>Estrategia</legend>
        <SegmentedControl label="Estrategia" hideLabel items={STRATEGIES} value={state.strategy} onChange={(v) => set({ strategy: v })} name="bt-strategy" />
        {state.strategy === 'constantMix' ? (
          <Select id="bt-rebalance" label="Regresar a los pesos" options={[...REBALANCE]} value={state.rebalance} onChange={(e) => set({ rebalance: e.target.value })} />
        ) : (
          <p className="kz-tool__hint">Se compra una vez al inicio y no se toca: los pesos se mueven solos con los precios.</p>
        )}
      </fieldset>
      <fieldset className="kz-tool__group">
        <legend>Referente y periodo</legend>
        <Select id="bt-benchmark" label="Referente" hint="Los dos en pesos: IPC con NAFTRAC y S&P 500 con SPY por el tipo de cambio de cada fecha." options={BENCHMARKS.map((b) => ({ value: b.value, label: b.label }))} value={state.benchmark} onChange={(e) => set({ benchmark: e.target.value })} />
        {state.benchmark === 'blend' && (
          <NumberInput id="bt-blend" label="Parte del IPC en la mezcla" suffix="%" hint="El resto es S&P 500 en pesos. La mezcla se rebalancea cada mes." error={blendError ?? undefined} value={state.blendIpcPct} onChange={(v) => set({ blendIpcPct: v })} />
        )}
        <SegmentedControl label="Periodo" items={[...RANGES]} value={state.range} onChange={(v) => set({ range: v })} name="bt-range" />
      </fieldset>
    </div>
  )
}
