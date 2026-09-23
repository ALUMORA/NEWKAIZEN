// Galería de gráficas de C2. DevUiPage (C1) la monta sola como sección "Gráficas" con su <h2>;
// aquí los títulos empiezan en <h3>. Datos de muestra deterministas (semilla fija).
import { Card } from '../../components/ui/index.js'
import { createRng } from '../../lib/rng.js'
import { TimeSeries } from '../../components/charts/TimeSeries.jsx'
import { FanChart } from '../../components/charts/FanChart.jsx'
import { DrawdownChart } from '../../components/charts/DrawdownChart.jsx'
import { Donut } from '../../components/charts/Donut.jsx'
import { Bars } from '../../components/charts/Bars.jsx'
import { Heatmap } from '../../components/charts/Heatmap.jsx'
import { FrontierChart } from '../../components/charts/FrontierChart.jsx'
import { Sparkline } from '../../components/charts/Sparkline.jsx'
import { fmtPct } from '../../lib/format.js'
import { GALLERY_NOW } from './sample-data.js'

const DAY = 86400000
const START = Date.UTC(2025, 8, 22)

/** Caminata aleatoria diaria de días hábiles desde START. */
function walk(seed, days, start, drift, vol) {
  const rng = createRng(seed)
  const out = []
  let v = start
  for (let i = 0; out.length < days; i += 1) {
    const t = START + i * DAY
    const wd = new Date(t).getUTCDay()
    if (wd === 0 || wd === 6) continue
    v *= 1 + drift + vol * rng.normal()
    out.push({ date: new Date(t).toISOString().slice(0, 10), value: Number(v.toFixed(2)) })
  }
  return out
}

const IPC = walk('ipc', 250, 100, 0.0004, 0.009)
const SPX = walk('spx', 250, 100, 0.0006, 0.011)
const RETURNS = IPC.map((p) => ({ date: p.date, value: p.value / 100 - 1 }))
const LONG = (() => {
  const rng = createRng('largo')
  const out = []
  let v = 1000
  for (let y = 1995; y <= 2026; y += 1) {
    for (let m = 0; m < 12; m += 1) {
      if (y === 2026 && m > 8) break
      v *= 1 + 0.011 + 0.05 * rng.normal()
      out.push({ date: `${y}-${String(m + 1).padStart(2, '0')}-01`, value: Number(v.toFixed(2)) })
    }
  }
  return out
})()
const FAN = Array.from({ length: 21 }, (_, year) => {
  const base = 500000 * Math.pow(1.06, year) + 60000 * year
  const spread = 0.12 * Math.sqrt(year)
  return {
    x: year,
    p5: base * Math.exp(-1.645 * spread), p25: base * Math.exp(-0.674 * spread), p50: base,
    p75: base * Math.exp(0.674 * spread), p95: base * Math.exp(1.645 * spread),
  }
})
const CONTRIB = FAN.map((p) => ({ x: p.x, value: 500000 + 60000 * p.x }))
const MIX = [
  { label: 'Acciones México', value: 420000 }, { label: 'Acciones EUA', value: 310000 }, { label: 'CETES', value: 180000 },
  { label: 'FIBRAs', value: 95000 }, { label: 'Bonos M', value: 70000 }, { label: 'Efectivo', value: 25000 },
]
const MANY = ['WALMEX', 'GFNORTE', 'AMX', 'FEMSA', 'GMEXICO', 'CEMEX', 'BIMBO', 'KOF', 'AC', 'ASUR', 'GAP', 'OMA']
  .map((label, i) => ({ label, value: Math.round(100000 / (i + 1.4)) }))
const SECTORS = [
  { label: 'Materiales', value: 0.084 }, { label: 'Financiero', value: 0.051 }, { label: 'Consumo básico', value: -0.023 },
  { label: 'Telecomunicaciones', value: 0.012 }, { label: 'Industrial', value: -0.047 }, { label: 'Bienes raíces (FIBRAs)', value: 0.003 },
]
const YEARS = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025].map((y, i) => ({ label: String(y), value: [0.081, -0.157, 0.046, 0.012, 0.209, -0.07, 0.182, -0.139, 0.227][i] }))
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'].map((m, i) => ({ label: `${m} 2025`, value: 12000 + ((i * 7919) % 9000) }))
const TICKERS = ['WALMEX', 'GFNORTE', 'AMX', 'FEMSA', 'GMEXICO', 'CEMEX', 'CETES', 'USD/MXN']
const CORR = (() => {
  const rng = createRng('corr')
  const n = TICKERS.length
  const m = Array.from({ length: n }, () => Array(n).fill(1))
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const base = i >= 6 || j >= 6 ? -0.35 : 0.45
      const v = Math.max(-0.95, Math.min(0.95, base + 0.3 * rng.normal()))
      m[i][j] = Number(v.toFixed(2))
      m[j][i] = m[i][j]
    }
  }
  m[2][7] = null
  m[7][2] = null
  return m
})()
const ASSETS = [
  { label: 'CETES', risk: 0.01, ret: 0.1 }, { label: 'Bonos M', risk: 0.07, ret: 0.095 }, { label: 'IPC', risk: 0.16, ret: 0.11 },
  { label: 'S&P 500', risk: 0.19, ret: 0.13 }, { label: 'FIBRAs', risk: 0.21, ret: 0.09 }, { label: 'Oro', risk: 0.15, ret: 0.07 },
]
// Hipérbola de Markowitz: riesgo = sqrt(σ0² + k (r − r0)²), con mínima varianza en (σ0, r0).
const FRONT = Array.from({ length: 30 }, (_, i) => {
  const ret = 0.1 + (i / 29) * 0.045
  return { ret, risk: Math.sqrt(0.045 ** 2 + 12 * (ret - 0.1) ** 2) }
})
const SPARKS = [
  { label: 'IPC', values: IPC.slice(-30).map((p) => p.value) },
  { label: 'S&P 500', values: SPX.slice(-30).map((p) => p.value) },
  { label: 'Plano', values: [5, 5, 5, 5] },
  { label: 'Con hueco', values: [3, 4, null, 5, 4, 6] },
]
const GAPPY = IPC.slice(0, 60).map((p, i) => ({ date: p.date, value: i >= 20 && i < 28 ? null : p.value * 1000 - 100000 }))
const FOUR = ['uno', 'dos', 'tres', 'cuatro'].map((seed, k) => ({ label: `Fondo ${k + 1}`, points: walk(seed, 90, 100, 0.0003 * k, 0.008) }))
const STATUS = { asOf: '2026-09-22T20:40:00Z', source: 'BMV', delayMinutes: 15, now: GALLERY_NOW }
const STALE = { asOf: '2026-09-19', source: 'FRED', fallback: true, stale: true, now: GALLERY_NOW }

export default function ChartsGallery() {
  return (
    <div className="dev-stack">
      <Card>
        <TimeSeries title="IPC contra S&P 500" description="Base 100 al 22 sep 2025, cierre diario." source="BMV y S&P" status={STATUS}
          series={[{ label: 'IPC', points: IPC }, { label: 'S&P 500', points: SPX }]} />
      </Card>
      <div className="dev-grid dev-grid--2">
        <Card>
          <TimeSeries title="Rendimiento acumulado del IPC" description="Base en 0 con área." format="pct" zeroBaseline area
            series={[{ label: 'IPC', points: RETURNS }]} height={220} />
        </Card>
        <Card>
          <TimeSeries title="Índice largo en escala log" description="Mensual desde 1995." log series={[{ label: 'Índice', points: LONG }]} height={220} status={STALE} source="FRED" />
        </Card>
        <Card>
          <TimeSeries title="Serie sin datos" series={[{ label: 'IPC', points: [] }]} height={160} />
        </Card>
        <Card>
          <TimeSeries title="Un solo punto" series={[{ label: 'CETES 28', points: [{ date: '2026-09-18', value: 0.0752 }] }]} format="pct" height={160} />
        </Card>
      </div>
      <div className="dev-grid dev-grid--2">
        <Card>
          <FanChart title="Simulación a 20 años" description="Valor del portafolio, 5,000 trayectorias." format="money" xType="number"
            xFormat={(v) => `Año ${v}`} xLabel="Año" points={FAN} extra={[{ label: 'Aportado', points: CONTRIB }]} height={260} />
        </Card>
        <Card>
          <DrawdownChart title="Caída desde el máximo" description="IPC, calculada de los cierres." points={IPC} fromPrices height={260} />
        </Card>
      </div>
      <div className="dev-grid dev-grid--2">
        <Card>
          <Donut title="Mezcla del portafolio" description="Valor por clase de activo." centerLabel="Valor total" data={MIX} source="Tus movimientos" />
        </Card>
        <Card>
          <Donut title="Doce emisoras" description="Las menores se juntan en Otros." data={MANY} format="number" centerLabel="Acciones" />
        </Card>
        <Card>
          <Bars title="Rendimiento por sector" description="Últimos 30 días." data={SECTORS} signed format="pct" categoryLabel="Sector" valueLabel="Rendimiento" />
        </Card>
        <Card>
          <Bars title="Rendimiento anual del IPC" data={YEARS} signed format="pct" orientation="vertical" categoryLabel="Año" valueLabel="Rendimiento" />
        </Card>
        <Card>
          <Bars title="Aportaciones por mes" data={MONTHS} format="money" orientation="vertical" height={200} categoryLabel="Mes" valueLabel="Aportación" />
        </Card>
        <Card>
          <Donut title="Dona vacía" data={[]} size={140} />
        </Card>
      </div>
      <div className="dev-grid dev-grid--2">
        <Card>
          <Heatmap title="Correlaciones a un año" description="Rendimientos diarios; AMX con USD/MXN sin dato." rows={TICKERS} columns={TICKERS} values={CORR} max={1} />
        </Card>
        <Card>
          <FrontierChart title="Frontera eficiente" description="Riesgo y rendimiento anuales esperados." assets={ASSETS} frontier={FRONT}
            markers={{ minVar: FRONT[0], tangency: FRONT[14], current: { risk: 0.12, ret: 0.105 } }} />
        </Card>
      </div>
      <h3 className="dev-note" style={{ margin: 0 }}><strong>Casos borde</strong></h3>
      <div className="dev-grid dev-grid--2">
        <Card>
          <TimeSeries title="Serie con hueco y negativos" description="Sin dato del 20 al 29 de octubre; dinero con signo." format="money" zeroBaseline
            series={[{ label: 'Resultado', points: GAPPY }]} height={200} />
        </Card>
        <Card>
          <TimeSeries title="Cuatro fondos" description="Cuatro series con la paleta en orden fijo." series={FOUR} height={200} />
        </Card>
        <Card>
          <Bars title="Barras con un faltante" data={[{ label: 'Enero', value: 0.02 }, { label: 'Febrero', value: null }, { label: 'Marzo', value: -0.011 }]} signed format="pct" />
        </Card>
        <Card>
          <FrontierChart title="Solo activos" assets={ASSETS} height={240} />
        </Card>
        <Card>
          <Heatmap title="Mapa sin datos" rows={[]} columns={[]} values={[]} />
        </Card>
        <Card>
          <Bars title="Barras sin datos" data={[]} />
        </Card>
      </div>
      <Card title="Sparkline" titleAs="h3" description="Decorativa: el dato va en el texto de al lado.">
        <ul className="dev-stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 'var(--space-2)' }}>
          {SPARKS.map((sp) => {
            const nums = sp.values.filter((v) => typeof v === 'number')
            const change = nums.at(-1) / nums[0] - 1
            return (
              <li key={sp.label} className="dev-inline">
                <span style={{ minWidth: '7ch' }}>{sp.label}</span>
                <Sparkline values={sp.values}>
                  <span className="num">{fmtPct(change, { sign: true })}</span>
                </Sparkline>
                <span className="sr-only">en 30 días</span>
              </li>
            )
          })}
        </ul>
      </Card>
    </div>
  )
}
