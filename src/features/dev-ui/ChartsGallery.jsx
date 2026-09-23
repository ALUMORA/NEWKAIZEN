// Galería de gráficas de C2. DevUiPage (C1) la monta sola como sección "Gráficas" con su <h2>;
// aquí los títulos empiezan en <h3>. Datos de muestra deterministas (semilla fija).
import { Card } from '../../components/ui/index.js'
import { createRng } from '../../lib/rng.js'
import { TimeSeries } from '../../components/charts/TimeSeries.jsx'
import { FanChart } from '../../components/charts/FanChart.jsx'
import { DrawdownChart } from '../../components/charts/DrawdownChart.jsx'
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
    </div>
  )
}
