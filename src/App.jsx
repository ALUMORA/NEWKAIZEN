
import { useState, useEffect, useCallback, useRef } from "react";
import kaizenLogo from './assets/kaizen-logo.jpg';

// ─── CURRENCY UTILS (fuera del componente — sin closure) ─────────────────────
// .MX  → precio ya en MXN (BMV y SIC)
// sin .MX → precio en USD, se multiplica por el tipo de cambio
function isMXN(ticker) { return ticker.endsWith('.MX'); }
function priceMXN(ticker, price, usdMxn) { return isMXN(ticker) ? price : price * usdMxn; }
function posValMXN(p, stockData, usdMxn) {
  const sd = stockData[p.ticker];
  if (!sd?.price) return 0;
  return p.shares * priceMXN(p.ticker, sd.price, usdMxn);
}
function posCostMXN(p, usdMxn) {
  return p.shares * priceMXN(p.ticker, p.cost ?? 0, usdMxn);
}

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const BACKEND_CANDIDATES = [
  "https://app-4-everyone.onrender.com",  // Render (primario)
  "http://localhost:8002",                // Local dev
];

async function detectBackend() {
  for (const url of BACKEND_CANDIDATES) {
    try {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(60000) });
      const data = await res.json();
      if (data?.status === "ok") return url;
    } catch {}
  }
  return null;
}

let BACKEND = null;

const DEFAULT_PORTFOLIO = [
  { ticker: "AAPL", shares: 10, cost: 150 },
  { ticker: "MSFT", shares: 8, cost: 320 },
  { ticker: "AMZN", shares: 5, cost: 130 },
  { ticker: "CEMEXCPO.MX", shares: 100, cost: 8.5 },
  { ticker: "WALMEX.MX", shares: 50, cost: 68 },
];

const SCREEN_TICKERS = ["AAPL","MSFT","GOOGL","AMZN","META","NVDA","TSLA","JPM","V","WMT","CEMEXCPO.MX","WALMEX.MX","AMXL.MX","FEMSAUBD.MX"];
const CANDIDATE_TICKERS = [
  // USA
  "AAPL","MSFT","GOOGL","AMZN","META","NVDA","TSLA","JPM","V","WMT",
  "BRK-B","JNJ","PG","KO","XOM","GLD","TLT","VNQ","LLY","COST",
  // México
  "CEMEXCPO.MX","WALMEX.MX","AMXL.MX","FEMSAUBD.MX","GMEXICOB.MX",
  "BIMBOA.MX","GRUMAB.MX","ALSEA.MX","LABB.MX","BOLSAA.MX",
  "GCARSOA1.MX","OMAB.MX","ASURB.MX","GAPB.MX","CUERVO.MX",
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchStock(ticker) {
  const res = await fetch(`${BACKEND}/stock/${encodeURIComponent(ticker)}`);
  const data = await res.json();
  return data?.error ? null : data;
}

async function fetchChart(ticker, period = "5y", timeoutMs = 12000) {
  const res = await fetch(`${BACKEND}/chart/${encodeURIComponent(ticker)}?period=${period}`,
    { signal: AbortSignal.timeout(timeoutMs) });
  const data = await res.json();
  return data?.closes ?? [];
}

async function fetchRiskFreeRate() {
  try {
    const res = await fetch(`${BACKEND}/rf`);
    const data = await res.json();
    return { rate: data?.rate ?? 0.0860, label: data?.label ?? "Bono M 5Y" };
  } catch {
    return { rate: 0.0860, label: "Bono M 5Y" };
  }
}

function calcSharpe(returns, rf_annual) {
  if (!returns.length) return 0;
  const rf_weekly = rf_annual / 52;
  const excess = returns.map((r) => r - rf_weekly);
  const mean = excess.reduce((a, b) => a + b, 0) / excess.length;
  const variance = excess.reduce((a, b) => a + (b - mean) ** 2, 0) / excess.length;
  const std = Math.sqrt(variance);
  return std === 0 ? 0 : (mean / std) * Math.sqrt(52);
}

function calcPortfolioSharpe(weights, covMatrix, returns_means, rf) {
  const n = weights.length;
  let portReturn = 0;
  for (let i = 0; i < n; i++) portReturn += weights[i] * returns_means[i];
  let portVar = 0;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) portVar += weights[i] * weights[j] * covMatrix[i][j];
  const portStd = Math.sqrt(portVar * 52);
  const annReturn = portReturn * 52;
  return portStd === 0 ? 0 : (annReturn - rf) / portStd;
}

function buildCovMatrix(returnsMatrix) {
  const n = returnsMatrix.length;
  const cov = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const len = Math.min(returnsMatrix[i].length, returnsMatrix[j].length);
      const rA = returnsMatrix[i].slice(-len);
      const rB = returnsMatrix[j].slice(-len);
      // Usar medias de la ventana común — evita sesgo cuando las series tienen distinta longitud
      const mA = rA.reduce((a, b) => a + b, 0) / len;
      const mB = rB.reduce((a, b) => a + b, 0) / len;
      cov[i][j] = rA.reduce((s, v, k) => s + (v - mA) * (rB[k] - mB), 0) / len;
    }
  // Medias individuales de toda la serie para estimación de retorno esperado
  const means = returnsMatrix.map((r) => r.reduce((a, b) => a + b, 0) / (r.length || 1));
  return { cov, means };
}

// Monte Carlo portfolio optimization — 100k sims, restricciones 2%-35% por activo
const W_MIN = 0.02;
const W_MAX = 0.35;

function optimizeSharpe(returnsMatrix, rf, iterations = 100_000) {
  const n = returnsMatrix.length;
  const { cov, means } = buildCovMatrix(returnsMatrix);
  let best = { sharpe: -Infinity, weights: Array(n).fill(1 / n) };

  for (let iter = 0; iter < iterations; iter++) {
    // Generar pesos con restricciones min/max usando proyección iterativa
    // 1) Muestra aleatoria uniforme
    let w = Array.from({ length: n }, () => Math.random());
    const rawSum = w.reduce((a, b) => a + b, 0);
    w = w.map((v) => v / rawSum);

    // 2) Proyección iterativa hasta satisfacer [W_MIN, W_MAX] y suma=1
    for (let pass = 0; pass < 20; pass++) {
      let excess = 0;
      let free = 0;
      w = w.map((v) => {
        if (v < W_MIN) { excess += W_MIN - v; return W_MIN; }
        if (v > W_MAX) { excess += W_MAX - v; return W_MAX; } // excess negativo
        free++;
        return v;
      });
      if (Math.abs(excess) < 1e-9) break;
      // redistribuir exceso entre los no-clampados
      const freeIdxs = w.map((v, i) => (v > W_MIN + 1e-9 && v < W_MAX - 1e-9) ? i : -1).filter(i => i >= 0);
      if (!freeIdxs.length) break;
      const delta = excess / freeIdxs.length;
      freeIdxs.forEach(i => { w[i] = Math.min(W_MAX, Math.max(W_MIN, w[i] + delta)); });
    }

    // 3) Renormalizar exactamente a 1.0
    const s2 = w.reduce((a, b) => a + b, 0);
    w = w.map((v) => v / s2);

    // 4) Rechazar si aún viola (muy raro)
    if (w.some((v) => v < W_MIN - 1e-6 || v > W_MAX + 1e-6)) continue;

    const s = calcPortfolioSharpe(w, cov, means, rf);
    if (s > best.sharpe) best = { sharpe: s, weights: w };
  }
  return best;
}

// ─── BACKTEST / BENCHMARK HELPERS ────────────────────────────────────────────
function calcTrackingError(portReturns, benchReturns) {
  const n = Math.min(portReturns.length, benchReturns.length);
  if (n < 2) return 0;
  const diffs = Array.from({ length: n }, (_, i) => portReturns[i] - benchReturns[i]);
  const mean = diffs.reduce((a, b) => a + b, 0) / n;
  const variance = diffs.reduce((s, d) => s + (d - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(variance * 52);
}

function calcPortfolioBeta(portReturns, benchReturns) {
  const n = Math.min(portReturns.length, benchReturns.length);
  if (n < 2) return 1;
  const meanP = portReturns.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const meanB = benchReturns.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const cov = portReturns.slice(0, n).reduce((s, r, i) => s + (r - meanP) * (benchReturns[i] - meanB), 0) / (n - 1);
  const varB = benchReturns.slice(0, n).reduce((s, r) => s + (r - meanB) ** 2, 0) / (n - 1);
  return varB === 0 ? 1 : cov / varB;
}

function calcTreynor(portReturns, beta, rf) {
  if (beta === 0) return 0;
  const annReturn = (portReturns.reduce((a, b) => a + b, 0) / portReturns.length) * 52;
  return (annReturn - rf) / beta;
}

function calcJensensAlpha(portReturns, benchReturns, beta, rf) {
  const n = Math.min(portReturns.length, benchReturns.length);
  const annPort = (portReturns.slice(0, n).reduce((a, b) => a + b, 0) / n) * 52;
  const annBench = (benchReturns.slice(0, n).reduce((a, b) => a + b, 0) / n) * 52;
  return annPort - (rf + beta * (annBench - rf));
}

function calcInfoRatio(portReturns, benchReturns) {
  const n = Math.min(portReturns.length, benchReturns.length);
  const annPort = (portReturns.slice(0, n).reduce((a, b) => a + b, 0) / n) * 52;
  const annBench = (benchReturns.slice(0, n).reduce((a, b) => a + b, 0) / n) * 52;
  const te = calcTrackingError(portReturns, benchReturns);
  return te === 0 ? 0 : (annPort - annBench) / te;
}

function cumulativeReturns(returns) {
  const cum = [];
  let val = 0;
  returns.forEach((r) => { val = (1 + val) * (1 + r) - 1; cum.push(val); });
  return cum;
}

// ─── ML SCORER (Rule-Based Quantitative Engine) ──────────────────────────────
function clamp(v, min = 1, max = 10) { return Math.max(min, Math.min(max, Math.round(v))); }

function mlScoreStock(_ticker, f) {
  const { pe, peg, pegy, evEbitda, pb, roe, profitMargin, debtEquity, revenueGrowth, priceChange52w, beta, pcf, debtToAssets, leverageRatio } = f ?? {};

  // ── FUNDAMENTAL (ROE, Margins, Growth, Debt) ──────────────────────────────
  let fund = 5;
  if (roe != null) fund += roe > 20 ? 1.5 : roe > 15 ? 1 : roe > 8 ? 0 : roe < 0 ? -2 : -0.5;
  if (profitMargin != null) fund += profitMargin > 20 ? 1.5 : profitMargin > 10 ? 0.8 : profitMargin > 0 ? 0 : -2;
  if (debtEquity != null) fund += debtEquity < 50 ? 1 : debtEquity < 100 ? 0.3 : debtEquity > 300 ? -1.5 : -0.5;
  if (revenueGrowth != null) fund += revenueGrowth > 20 ? 1 : revenueGrowth > 10 ? 0.5 : revenueGrowth > 0 ? 0 : -1;
  // Deuda/Activos: menor = más solvente
  if (debtToAssets != null) fund += debtToAssets < 30 ? 0.8 : debtToAssets < 50 ? 0.2 : debtToAssets < 70 ? -0.5 : -1.2;
  const fundamental_score = clamp(fund);

  // ── VALUATION (PE, PEG, PEGY, EV/EBITDA, P/B, P/FCF) ────────────────────────────
  let val = 5;
  if (pe != null) val += pe < 12 ? 2.5 : pe < 20 ? 1.5 : pe < 30 ? 0.5 : pe < 40 ? -0.5 : pe < 60 ? -1.5 : -2.5;
  if (peg != null) val += peg < 0.8 ? 2 : peg < 1.2 ? 1 : peg < 2 ? 0 : peg < 3 ? -1 : -2;
  if (pegy != null) val += pegy < 1 ? 1 : pegy < 2 ? 0.3 : -0.5;
  if (evEbitda != null) val += evEbitda < 8 ? 1.5 : evEbitda < 12 ? 0.7 : evEbitda < 18 ? 0 : evEbitda < 25 ? -0.7 : -1.5;
  if (pb != null) val += pb < 1 ? 1 : pb < 2.5 ? 0.3 : pb > 6 ? -0.8 : 0;
  const valuation_score = clamp(val);

  // ── MOMENTUM (52w change, beta) ───────────────────────────────────────────
  let mom = 5;
  if (priceChange52w != null) {
    mom += priceChange52w > 40 ? 3 : priceChange52w > 20 ? 2 : priceChange52w > 8 ? 1
      : priceChange52w > -5 ? 0 : priceChange52w > -15 ? -1.5 : priceChange52w > -30 ? -2.5 : -3.5;
  }
  if (beta != null) mom += beta >= 0.7 && beta <= 1.4 ? 0.5 : beta > 2.5 ? -1 : 0;
  const momentum_score = clamp(mom);

  // ── QUALITY (Profitability + Balance Sheet) ───────────────────────────────
  let qual = 5;
  if (roe != null) qual += roe > 25 ? 2 : roe > 15 ? 1 : roe < 0 ? -2 : 0;
  if (profitMargin != null) qual += profitMargin > 15 ? 1.5 : profitMargin > 5 ? 0.5 : profitMargin < 0 ? -2 : -0.5;
  if (debtEquity != null) qual += debtEquity < 30 ? 1.5 : debtEquity < 80 ? 0.5 : debtEquity > 200 ? -1.5 : -0.3;
  if (revenueGrowth != null) qual += revenueGrowth > 15 ? 1 : revenueGrowth < -5 ? -1 : 0;
  // Apalancamiento: <1.5x excelente, >3x riesgo
  if (leverageRatio != null) qual += leverageRatio < 1.3 ? 1 : leverageRatio < 1.8 ? 0.3 : leverageRatio < 2.5 ? -0.5 : -1.5;
  const quality_score = clamp(qual);

  // ── TECHNICAL (Price trend, volatility, relative value) ──────────────────
  let tech = 5;
  if (priceChange52w != null) {
    // Trend signal
    tech += priceChange52w > 30 ? 2.5 : priceChange52w > 15 ? 1.5 : priceChange52w > 5 ? 0.7
      : priceChange52w > -5 ? 0 : priceChange52w > -20 ? -1.5 : -2.5;
  }
  if (beta != null) {
    // Low-volatility premium: moderate beta is technically preferred
    tech += beta < 0.5 ? 0.5 : beta > 2 ? -1 : 0;
  }
  // Price-to-book as valuation anchor for technical mean-reversion
  if (pb != null) tech += pb < 1.5 ? 0.8 : pb > 8 ? -0.8 : 0;
  const technical_score = clamp(tech);

  // ── OVERALL (weighted composite) ─────────────────────────────────────────
  const overall_score = clamp(
    fundamental_score * 0.22 +
    valuation_score  * 0.28 +
    momentum_score   * 0.18 +
    quality_score    * 0.18 +
    technical_score  * 0.14
  );

  const recommendation = overall_score >= 7 ? "BUY" : overall_score <= 4 ? "SELL" : "HOLD";

  // ── RATIONALE ────────────────────────────────────────────────────────────
  const notes = [];
  if (peg != null && peg < 1) notes.push("PEG < 1");
  if (roe != null && roe > 20) notes.push(`ROE ${roe}%`);
  if (profitMargin != null && profitMargin > 15) notes.push(`Margen ${profitMargin}%`);
  if (priceChange52w != null && priceChange52w > 20) notes.push(`+${priceChange52w}% 52sem`);
  if (pe != null && pe > 50) notes.push("PE elevado");
  if (debtEquity != null && debtEquity > 200) notes.push("deuda alta");
  if (profitMargin != null && profitMargin < 0) notes.push("pérdidas netas");
  const rationale = notes.length
    ? (recommendation === "BUY" ? "Fortalezas: " : recommendation === "SELL" ? "Riesgos: " : "Mixto: ") + notes.slice(0, 3).join(", ") + "."
    : "Datos insuficientes para análisis detallado.";

  return { fundamental_score, valuation_score, momentum_score, quality_score, technical_score, overall_score, recommendation, rationale };
}

// ─── SCORE BAR ────────────────────────────────────────────────────────────────
function ScoreBar({ value, label }) {
  const pct = (value / 10) * 100;
  const color = value >= 7 ? "#16a34a" : value >= 5 ? "#d97706" : "#dc2626";
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#666666", marginBottom: 3 }}>
        <span>{label}</span><span style={{ color, fontWeight: 600 }}>{value}/10</span>
      </div>
      <div style={{ background: "#f5f5f0", borderRadius: 4, height: 4, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 4, transition: "width 0.8s ease" }} />
      </div>
    </div>
  );
}

// ─── METRIC BADGE ─────────────────────────────────────────────────────────────
function MetricBadge({ label, value, good, neutral }) {
  const v = parseFloat(value);
  let color = "#999999";
  if (!isNaN(v)) {
    if (good !== undefined && v <= good) color = "#16a34a";
    else if (neutral !== undefined && v <= neutral) color = "#d97706";
    else if (!isNaN(v)) color = "#dc2626";
  }
  return (
    <div style={{
      background: "#f8f8f8", borderRadius: 12,
      padding: "8px 12px", minWidth: 90, textAlign: "center"
    }}>
      <div style={{ fontSize: 10, color: "#999999", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 17, fontFamily: "'DM Mono', monospace", color, fontWeight: 700 }}>
        {value ?? "—"}
      </div>
    </div>
  );
}

// ─── LOADING SPINNER ──────────────────────────────────────────────────────────
function LineChart({ series, dates }) {
  const W = 700, H = 240;
  const PAD = { top: 24, right: 20, bottom: 36, left: 66 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const allVals = series.flatMap((s) => s.data);
  const minY = Math.min(...allVals);
  const maxY = Math.max(...allVals);
  const rangeY = maxY - minY || 0.01;
  const toX = (i, len) => PAD.left + (i / Math.max(len - 1, 1)) * plotW;
  const toY = (v) => PAD.top + plotH - ((v - minY) / rangeY) * plotH;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
      {[0, 0.25, 0.5, 0.75, 1].map((frac, i) => {
        const val = maxY - frac * rangeY;
        const y = PAD.top + frac * plotH;
        return (
          <g key={i}>
            <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="#e5e5e5" strokeWidth={1} />
            <text x={PAD.left - 6} y={y + 4} textAnchor="end" fill="#999999" fontSize={9}>
              {(val * 100).toFixed(1)}%
            </text>
          </g>
        );
      })}
      {minY < 0 && (
        <line x1={PAD.left} y1={toY(0)} x2={W - PAD.right} y2={toY(0)}
          stroke="#999999" strokeWidth={1} strokeDasharray="4,3" />
      )}
      {series.map((s) => (
        <polyline key={s.name}
          points={s.data.map((v, i) => `${toX(i, s.data.length)},${toY(v)}`).join(" ")}
          fill="none" stroke={s.color} strokeWidth={2.5} strokeLinejoin="round" />
      ))}
      {dates && dates.map((d, i) => {
        const step = Math.max(1, Math.floor(dates.length / 6));
        if (i % step !== 0 && i !== dates.length - 1) return null;
        return (
          <text key={i} x={toX(i, dates.length)} y={H - 8} textAnchor="middle" fill="#999999" fontSize={9}>{d}</text>
        );
      })}
      {series.map((s, i) => (
        <g key={s.name} transform={`translate(${PAD.left + i * 160}, 6)`}>
          <line x1={0} y1={6} x2={22} y2={6} stroke={s.color} strokeWidth={2.5} />
          <text x={28} y={10} fill="#666666" fontSize={10}>{s.name}</text>
        </g>
      ))}
    </svg>
  );
}

// ─── MERCADOS GLOBALES ────────────────────────────────────────────────────────
const COUNTRY_ROWS = [
  { id:"840", flag:"", name:"EE.UU.",        etf:"SPY"  },
  { id:"276", flag:"", name:"Alemania",       etf:"EWG"  },
  { id:"392", flag:"", name:"Japón",          etf:"EWJ"  },
  { id:"156", flag:"", name:"China",          etf:"FXI"  },
  { id:"826", flag:"", name:"Reino Unido",    etf:"EWU"  },
  { id:"356", flag:"", name:"India",          etf:"INDA" },
  { id:"036", flag:"", name:"Australia",      etf:"EWA"  },
  { id:"076", flag:"", name:"Brasil",         etf:"EWZ"  },
  { id:"250", flag:"", name:"Francia",        etf:"EWQ"  },
  { id:"410", flag:"", name:"Corea del Sur",  etf:"EWY"  },
  { id:"484", flag:"", name:"México",         etf:"EWW"  },
  { id:"158", flag:"", name:"Taiwán",         etf:"EWT"  },
  { id:"380", flag:"", name:"Italia",         etf:"EWI"  },
  { id:"724", flag:"", name:"España",         etf:"EWP"  },
  { id:"152", flag:"", name:"Chile",          etf:"ECH"  },
  { id:"756", flag:"", name:"Suiza",          etf:"EWL"  },
  { id:"710", flag:"", name:"Sudáfrica",      etf:"EZA"  },
  { id:"792", flag:"", name:"Turquía",        etf:"TUR"  },
  { id:"616", flag:"", name:"Polonia",        etf:"EPOL" },
  { id:"682", flag:"", name:"Arabia Saudita", etf:"KSA"  },
  { id:"702", flag:"", name:"Singapur",       etf:"EWS"  },
  { id:"344", flag:"", name:"Hong Kong",      etf:"EWH"  },
  { id:"124", flag:"", name:"Canadá",         etf:"EWC"  },
  { id:"528", flag:"", name:"Países Bajos",   etf:"EWN"  },
  { id:"752", flag:"", name:"Suecia",         etf:"EWD"  },
  { id:"040", flag:"", name:"Austria",        etf:"EWO"  },
];

function GlobalMarketsTable({ data, loading }) {
  if (loading) return (
    <div style={{ display:"flex", alignItems:"center", gap:8, justifyContent:"center", padding:"20px 0", color:"#94a3b8", fontSize:11 }}>
      <div style={{ width:12, height:12, border:"2px solid #e2e8f0", borderTop:"2px solid #3b82f6", borderRadius:"50%", animation:"spin 0.8s linear infinite" }} />
      Cargando...
    </div>
  );
  if (!data) return (
    <div style={{ textAlign:"center", padding:"16px 0", color:"#94a3b8", fontSize:11 }}>Cargando datos de mercados globales…</div>
  );

  const rows = COUNTRY_ROWS
    .map(r => ({ ...r, d: data[r.id] }))
    .sort((a, b) => (b.d?.change_pct ?? -999) - (a.d?.change_pct ?? -999));

  return (
    <div className="resp-grid-3" style={{ gap:"1px 4px" }}>
      {rows.map(({ id, flag, name, etf, d }) => {
        const p = d?.change_pct;
        const up = p != null && p >= 0;
        const color = p == null ? "#94a3b8" : up ? "#16a34a" : "#dc2626";
        const bgBadge = p == null ? "#f5f5f0" : up ? "#dcfce7" : "#fee2e2";
        return (
          <div key={id} style={{
            display:"flex", alignItems:"center", gap:5,
            padding:"4px 10px", height:32, boxSizing:"border-box",
            borderBottom:"1px solid #f5f5f0", transition:"background 0.1s",
          }}
            onMouseEnter={e => e.currentTarget.style.background="#f5f5f0"}
            onMouseLeave={e => e.currentTarget.style.background=""}
          >
            <div style={{ flex:1, minWidth:0 }}>
              <span style={{ fontFamily:"'Syne',sans-serif", fontSize:12, fontWeight:700, color:"#1e293b" }}>{name}</span>
              <span style={{ fontSize:9, color:"#94a3b8", marginLeft:5 }}>{etf}</span>
            </div>
            <div style={{
              fontFamily:"'DM Mono',monospace", fontSize:10, fontWeight:700,
              color, background:bgBadge, padding:"2px 6px", borderRadius:4, flexShrink:0,
            }}>
              {p != null ? `${up ? "+" : ""}${p.toFixed(2)}%` : "—"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SectionLabel({ children, right }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #e0e0d8", marginBottom: 8 }}>
      <span style={{ fontSize: 9, color: "#888888", letterSpacing: "0.2em", textTransform: "uppercase", fontWeight: 700, fontFamily: "'Syne', sans-serif" }}>{children}</span>
      {right && <div>{right}</div>}
    </div>
  );
}

function Spinner({ size = 20 }) {
  return (
    <div style={{
      width: size, height: size, border: `2px solid #e2e8f0`,
      borderTop: `2px solid #111827`, borderRadius: "50%",
      animation: "spin 0.8s linear infinite", display: "inline-block"
    }} />
  );
}

// ─── MARKET CARD ─────────────────────────────────────────────────────────────
function MktCard({ label, value, pct, absChange, sub, large, icon, showAbs }) {
  const isNeutral = pct === null || pct === undefined;
  const up = !isNeutral && pct >= 0;
  const accentColor = isNeutral ? "#94a3b8" : up ? "#16a34a" : "#dc2626";
  const hoverClass  = isNeutral ? "mkt-card" : up ? "mkt-card mkt-card-up" : "mkt-card mkt-card-down";
  const changeBg    = up ? "#dcfce7" : "#fee2e2";
  const changeColor = up ? "#16a34a" : "#dc2626";
  const changeLabel = showAbs && absChange !== undefined && absChange !== null
    ? (absChange >= 0 ? "+" : "") + absChange.toFixed(2)
    : Math.abs(pct ?? 0).toFixed(2) + "%";

  return (
    <div className={hoverClass} style={{
      background: "linear-gradient(145deg,#ffffff,#f5f5f0)",
      borderRadius: 24,
      boxShadow: "none",
      padding: large ? "22px 24px" : "14px 16px",
      borderBottom: `3px solid ${accentColor}`,
      position: "relative", overflow: "hidden",
    }}>
      <div style={{
        position: "absolute", top: 0, right: 0, width: 60, height: 60, borderRadius: "0 16px 0 60px",
        background: `${accentColor}09`, pointerEvents: "none",
      }} />
      <div style={{ fontSize: 10, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6, display: "flex", alignItems: "center", gap: 4, fontWeight: 600 }}>
        {icon && <span style={{ fontSize: 12 }}>{icon}</span>}
        {label}
      </div>
      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: large ? 26 : 17, fontWeight: 700, color: "#1e293b", lineHeight: 1.1, marginBottom: 8 }}>
        {value ?? <span style={{ color: "#cbd5e1" }}>—</span>}
      </div>
      {!isNeutral && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "3px 9px", borderRadius: 8, background: changeBg, color: changeColor, fontSize: 11, fontWeight: 700 }}>
          {up ? "" : ""} {changeLabel}
        </span>
      )}
      {sub && <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 5, fontWeight: 500 }}>{sub}</div>}
    </div>
  );
}

// ─── RESUMEN MAÑANERO ────────────────────────────────────────────────────────
function ResumenManero({ md, macroData }) {
  const [collapsed, setCollapsed] = useState(false);

  const today = new Date().toLocaleDateString("es-MX", {
    weekday: "long", year: "numeric", month: "long", day: "numeric"
  });

  const insights = [];

  if (md?.ipc?.change_pct != null) {
    const up = md.ipc.change_pct >= 0;
    const pts = md.ipc.change != null ? ` (${md.ipc.change >= 0 ? "+" : ""}${md.ipc.change.toFixed(0)} pts)` : "";
    insights.push({ icon: up ? "" : "", cat: "IPC MX", color: up ? "#4ade80" : "#f87171",
      text: `Bolsa mexicana ${up ? "avanza" : "retrocede"} ${Math.abs(md.ipc.change_pct).toFixed(2)}%${pts} a ${md.ipc.value.toLocaleString("en-US", { maximumFractionDigits: 2 })} pts` });
  }
  if (md?.sp500?.change_pct != null) {
    const up = md.sp500.change_pct >= 0;
    insights.push({ icon: "", cat: "Wall Street", color: up ? "#4ade80" : "#f87171",
      text: `S&P 500 ${up ? "sube" : "baja"} ${Math.abs(md.sp500.change_pct).toFixed(2)}% a ${md.sp500.value.toLocaleString("en-US", { maximumFractionDigits: 2 })} — Wall Street ${up ? "en verde" : "en rojo"}` });
  }
  if (md?.usdmxn?.change_pct != null) {
    const up = md.usdmxn.change_pct >= 0;
    insights.push({ icon: "", cat: "Peso MXN", color: up ? "#f87171" : "#4ade80",
      text: `Peso ${up ? "se debilita" : "se fortalece"} ${Math.abs(md.usdmxn.change_pct).toFixed(2)}% — dólar en $${md.usdmxn.value.toFixed(4)} MXN` });
  }
  if (macroData?.vix?.value != null) {
    const v = macroData.vix.value;
    const c = v > 30 ? "#f87171" : v > 20 ? "#fbbf24" : "#4ade80";
    insights.push({ icon: "", cat: "Volatilidad", color: c,
      text: `VIX ${v.toFixed(2)} — ${v > 30 ? "alta tensión en mercados, risk-off" : v > 20 ? "volatilidad elevada, cautela recomendada" : "ambiente de calma, risk-on"}` });
  }
  if (macroData?.t10y?.value != null) {
    const r = macroData.t10y.value;
    const sp = macroData?.spread;
    insights.push({ icon: "", cat: "Tasas EUA", color: r > 5 ? "#f87171" : "#fbbf24",
      text: `Tasa 10Y Treasury ${r.toFixed(2)}%${sp?.value != null ? ` · Spread ${sp.value >= 0 ? "+" : ""}${sp.value.toFixed(2)} bps${sp.inverted ? " ⚠ curva invertida" : ""}` : ""}` });
  }
  if (md?.gold?.change_pct != null) {
    const up = md.gold.change_pct >= 0;
    insights.push({ icon: "", cat: "Oro", color: up ? "#fbbf24" : "#94a3b8",
      text: `Oro ${up ? "avanza" : "retrocede"} ${Math.abs(md.gold.change_pct).toFixed(2)}% a $${md.gold.value.toLocaleString("en-US", { maximumFractionDigits: 2 })}/oz — ${up ? "demanda de refugio activa" : "menor apetito por safe-haven"}` });
  }
  if (md?.wti?.change_pct != null) {
    const up = md.wti.change_pct >= 0;
    insights.push({ icon: "", cat: "Petróleo WTI", color: up ? "#fbbf24" : "#f87171",
      text: `WTI ${up ? "+" : ""}${md.wti.change_pct.toFixed(2)}% a $${md.wti.value.toFixed(2)}/bbl — ${up ? "presión inflacionaria en energía" : "alivio en precios de energía"}` });
  }
  if (md?.btc?.change_pct != null) {
    const up = md.btc.change_pct >= 0;
    insights.push({ icon: "BTC", cat: "Bitcoin", color: up ? "#fbbf24" : "#f87171",
      text: `Bitcoin ${up ? "+" : ""}${md.btc.change_pct.toFixed(2)}% a $${Math.round(md.btc.value).toLocaleString()} USD — cripto ${up ? "en verde" : "bajo presión"}` });
  }

  const hasData = insights.length > 0;
  const positive = insights.filter(i => i.color === "#4ade80" || i.color === "#fbbf24").length;
  const negative = insights.filter(i => i.color === "#f87171").length;
  const mood = negative > positive ? "Cauteloso" : positive > negative ? "Positivo" : "Mixto";
  const moodColor = mood === "Positivo" ? "#4ade80" : mood === "Cauteloso" ? "#f87171" : "#fbbf24";

  return (
    <div style={{
      background: "linear-gradient(135deg, #0f0f0f 0%, #1c1c1c 100%)",
      borderRadius: 24, padding: collapsed ? "18px 24px" : "24px 28px",
      color: "#fff", position: "relative", overflow: "hidden",
      boxShadow: "0 4px 24px rgba(0,0,0,0.15)",
    }}>
      <div style={{ position: "absolute", top: -60, right: -60, width: 240, height: 240, borderRadius: "50%", background: "#00ff88", opacity: 0.04 }} />
      <div style={{ position: "absolute", bottom: -40, left: -40, width: 160, height: 160, borderRadius: "50%", background: "#6366f1", opacity: 0.05 }} />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: collapsed ? 0 : 20, position: "relative" }}>
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
              <span style={{ fontSize: 18 }}></span>
              <span style={{ fontWeight: 700, fontSize: 17, letterSpacing: "-0.01em" }}>Resumen Mañanero</span>
              <span style={{ background: "#00ff88", color: "#fff", fontSize: 9, fontWeight: 800, padding: "2px 7px", borderRadius: 4, letterSpacing: "0.08em" }}>LIVE</span>
            </div>
            <div style={{ fontSize: 11, color: "#777777", textTransform: "capitalize" }}>{today}</div>
          </div>
          {hasData && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: `${moodColor}15`, border: `1px solid ${moodColor}30`, borderRadius: 999, padding: "4px 12px" }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: moodColor, animation: "pulse 2s infinite" }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: moodColor }}>Sentimiento: {mood}</span>
            </div>
          )}
        </div>
        <button onClick={() => setCollapsed(!collapsed)} style={{
          background: "#ffffff12", border: "1px solid #ffffff18", borderRadius: 8,
          color: "#cccccc", padding: "6px 16px", cursor: "pointer", fontSize: 12, fontWeight: 600,
          transition: "all 0.15s",
        }}>
          {collapsed ? "Ver resumen " : "Colapsar "}
        </button>
      </div>

      {!collapsed && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 9, position: "relative" }}>
          {!hasData ? (
            <div style={{ color: "#444444", fontSize: 13, gridColumn: "1 / -1", padding: "16px 0", display: "flex", alignItems: "center", gap: 10 }}>
              <Spinner size={16} />
              <span>Cargando datos de mercado — haz clic en <b style={{ color: "#00cc6a" }}>↻ Mercados</b> para iniciar</span>
            </div>
          ) : insights.map((ins, i) => (
            <div key={i} style={{
              background: "#1a1a1a", borderRadius: 10, padding: "10px 14px",
              borderLeft: "2px solid #00ff88",
              display: "flex", gap: 10, alignItems: "flex-start",
              animation: `slideIn 0.3s ease ${Math.min(i * 0.06, 0.5)}s both`,
              transition: "background 0.15s",
              cursor: "default",
            }}
              onMouseEnter={(e) => e.currentTarget.style.background = "#222222"}
              onMouseLeave={(e) => e.currentTarget.style.background = "#1a1a1a"}
            >
              <div>
                <div style={{ fontSize: 9, color: "#00ff88", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 3 }}>{ins.cat}</div>
                <div style={{ fontSize: 12, color: "#cccccc", lineHeight: 1.45 }}>{ins.text}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── MARKET NEWS ITEM ─────────────────────────────────────────────────────────
function MarketNewsItem({ item, index }) {
  const sentColor = item.sentiment === "positive" ? "#16a34a" : item.sentiment === "negative" ? "#dc2626" : "#ca8a04";
  const sentIcon  = item.sentiment === "positive" ? "" : item.sentiment === "negative" ? "" : "";
  const sentLabel = item.sentiment === "positive" ? "Positiva" : item.sentiment === "negative" ? "Negativa" : "Neutral";
  const timeAgo   = item.time ? (() => {
    const s = Math.floor(Date.now() / 1000) - item.time;
    if (s < 3600)  return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    return `${Math.floor(s / 86400)}d`;
  })() : "";
  return (
    <div className="news-card" style={{
      background: "#ffffff", borderRadius: 10, border: "1px solid #e8e8e4",
      borderLeft: `3px solid ${sentColor}`, padding: "10px 14px",
      animation: `slideIn 0.3s ease ${Math.min(index * 0.05, 0.5)}s both`,
    }}>
      <a href={item.url} target="_blank" rel="noreferrer" style={{
        color: "#111111", fontWeight: 600, fontSize: 13, lineHeight: 1.4,
        textDecoration: "none", display: "block", marginBottom: 3,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}
        onMouseEnter={(e) => e.currentTarget.style.color = "#00cc6a"}
        onMouseLeave={(e) => e.currentTarget.style.color = "#111111"}
      >{item.title}</a>
      {item.summary && <div style={{ fontSize: 11, color: "#888888", lineHeight: 1.4, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.summary}</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {item.publisher && <span style={{ fontSize: 10, color: "#555555", fontWeight: 600 }}>{item.publisher}</span>}
        {timeAgo && <span style={{ fontSize: 10, color: "#aaaaaa" }}>· {timeAgo}</span>}
        <span style={{ fontSize: 10, fontWeight: 700, color: sentColor, marginLeft: "auto" }}>{sentLabel}</span>
      </div>
    </div>
  );
}

// ─── MULTI-PORTFOLIO HELPERS ──────────────────────────────────────────────────
const DEFAULT_PORTFOLIOS = [
  { id: "p1", name: "Principal", positions: DEFAULT_PORTFOLIO },
];

function loadPortfolios() {
  try {
    const saved = localStorage.getItem("momentum_portfolios");
    if (saved) return JSON.parse(saved);
    // Migrar portafolio legacy
    const legacy = localStorage.getItem("momentum_portfolio");
    if (legacy) {
      const positions = JSON.parse(legacy);
      return [{ id: "p1", name: "Principal", positions }];
    }
  } catch {}
  return DEFAULT_PORTFOLIOS;
}

function savePortfolios(portfolios) {
  localStorage.setItem("momentum_portfolios", JSON.stringify(portfolios));
}

// ─── MONTE CARLO CHART ────────────────────────────────────────────────────────
function MonteCarloChart({ portStats, spyStats, weeks }) {
  const W = 720, H = 280;
  const PAD = { top: 28, right: 24, bottom: 40, left: 66 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const allVals = [
    ...portStats.map(s => [s.p5, s.p95]),
    ...spyStats.map(s => [s.p5, s.p95]),
  ].flat();
  const minY = Math.min(...allVals);
  const maxY = Math.max(...allVals);
  const rangeY = maxY - minY || 0.01;
  const n = portStats.length;

  const toX = (i) => PAD.left + (i / Math.max(n - 1, 1)) * plotW;
  const toY = (v) => PAD.top + plotH - ((v - minY) / rangeY) * plotH;

  const areaPath = (upper, lower) =>
    upper.map((v, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(" ") +
    " " + lower.map((v, i) => `${i === 0 ? "L" : "L"}${toX(n - 1 - i).toFixed(1)},${toY(lower[n - 1 - i]).toFixed(1)}`).join(" ") +
    " Z";

  const linePath = (vals) =>
    vals.map((v, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(" ");

  const gridVals = [0, 0.25, 0.5, 0.75, 1].map(f => minY + f * rangeY);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
      <defs>
        <linearGradient id="portGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#00ff88" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#00ff88" stopOpacity="0.04" />
        </linearGradient>
        <linearGradient id="spyGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6366f1" stopOpacity="0.14" />
          <stop offset="100%" stopColor="#6366f1" stopOpacity="0.03" />
        </linearGradient>
      </defs>

      {/* Grid */}
      {gridVals.map((v, i) => (
        <g key={i}>
          <line x1={PAD.left} y1={toY(v)} x2={W - PAD.right} y2={toY(v)} stroke="#f0f0f0" strokeWidth={1} />
          <text x={PAD.left - 6} y={toY(v) + 4} textAnchor="end" fill="#aaaaaa" fontSize={9}>
            {((v - 1) * 100).toFixed(1)}%
          </text>
        </g>
      ))}

      {/* Línea base 0% */}
      {minY < 1 && maxY > 1 && (
        <line x1={PAD.left} y1={toY(1)} x2={W - PAD.right} y2={toY(1)}
          stroke="#cccccc" strokeWidth={1} strokeDasharray="4,3" />
      )}

      {/* Banda SPY p5–p95 */}
      <path d={areaPath(spyStats.map(s => s.p95), spyStats.map(s => s.p5))}
        fill="url(#spyGrad)" />
      {/* Línea media SPY */}
      <path d={linePath(spyStats.map(s => s.mean))}
        fill="none" stroke="#6366f1" strokeWidth={2} strokeDasharray="6,3" strokeLinejoin="round" />

      {/* Banda portafolio p5–p95 */}
      <path d={areaPath(portStats.map(s => s.p95), portStats.map(s => s.p5))}
        fill="url(#portGrad)" />
      {/* Línea media portafolio */}
      <path d={linePath(portStats.map(s => s.mean))}
        fill="none" stroke="#00ff88" strokeWidth={2.5} strokeLinejoin="round" />

      {/* Eje X — etiquetas cada ~10 semanas */}
      {weeks.map((w, i) => {
        if (i % 10 !== 0 && i !== weeks.length - 1) return null;
        return (
          <text key={i} x={toX(i)} y={H - 8} textAnchor="middle" fill="#aaaaaa" fontSize={9}>{w}</text>
        );
      })}

      {/* Leyenda */}
      {[
        { color: "#00cc6a", dash: false, label: "Portafolio (media ± rango 90%)" },
        { color: "#6366f1", dash: true,  label: "SPY (media ± rango 90%)" },
      ].map((s, i) => (
        <g key={s.label} transform={`translate(${PAD.left + i * 240}, 8)`}>
          <line x1={0} y1={6} x2={22} y2={6} stroke={s.color} strokeWidth={2.5} strokeDasharray={s.dash ? "5,3" : "none"} />
          <text x={28} y={10} fill="#666666" fontSize={10}>{s.label}</text>
        </g>
      ))}
    </svg>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
function LoginScreen({ onAuth }) {
  const [pw, setPw]       = useState("");
  const [error, setError] = useState(false);
  const [shake, setShake] = useState(false);

  function handleSubmit(e) {
    e.preventDefault();
    if (pw === "Investments") {
      onAuth();
    } else {
      setError(true);
      setShake(true);
      setTimeout(() => setShake(false), 500);
    }
  }

  return (
    <div style={{
      minHeight: "100vh", background: "#000000",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      fontFamily: "'Syne', sans-serif",
    }}>

      <img
        src={kaizenLogo}
        alt="KAIZEN"
        style={{ width: 140, height: 140, borderRadius: 0, objectFit: "cover", marginBottom: 32, animation: "float 3s ease-in-out infinite" }}
      />

      <div style={{ fontSize: 28, fontWeight: 800, color: "#ffffff", letterSpacing: 4, marginBottom: 6 }}>KAIZEN</div>
      <div style={{ fontSize: 12, color: "#4b5563", marginBottom: 40, letterSpacing: 2 }}>INVESTMENT GROUP</div>

      <form onSubmit={handleSubmit} style={{
        display: "flex", flexDirection: "column", alignItems: "center", gap: 16,
        animation: shake ? "shake 0.4s ease" : "none",
      }}>
        <input
          type="password"
          placeholder="Contraseña"
          value={pw}
          onChange={e => { setPw(e.target.value); setError(false); }}
          autoFocus
          style={{
            background: "#111111", border: `1.5px solid ${error ? "#f87171" : "#1f2937"}`,
            borderRadius: 12, padding: "14px 20px", color: "#ffffff",
            fontFamily: "'DM Mono', monospace", fontSize: 16, width: 260,
            outline: "none", textAlign: "center", letterSpacing: 6,
            transition: "border-color 0.2s",
          }}
        />
        {error && <div style={{ color: "#f87171", fontSize: 12, fontFamily: "'DM Mono', monospace" }}>Contraseña incorrecta</div>}
        <button type="submit" style={{
          background: "#00ff88", color: "#0a0a0a", border: "none", borderRadius: 12,
          padding: "14px 0", width: 260, fontFamily: "'Syne', sans-serif",
          fontWeight: 800, fontSize: 14, cursor: "pointer", letterSpacing: 2,
        }}>
          ENTRAR →
        </button>
      </form>

      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50%       { transform: translateY(-10px); }
        }
        @keyframes shake {
          0%,100% { transform: translateX(0); }
          20%      { transform: translateX(-10px); }
          40%      { transform: translateX(10px); }
          60%      { transform: translateX(-6px); }
          80%      { transform: translateX(6px); }
        }
      `}</style>
    </div>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(false);
  const [backendUrl, setBackendUrl] = useState(null);
  const [backendSearching, setBackendSearching] = useState(true);

  useEffect(() => {
    detectBackend().then(url => {
      BACKEND = url;
      setBackendUrl(url);
      setBackendSearching(false);
    });
  }, []);

  const [tab, setTab] = useState("news");
  const [rfRate, setRfRate] = useState(null);
  const [rfLabel, setRfLabel] = useState("MX 5Y");
  const [backendOk, setBackendOk] = useState(null);

  // Multi-portfolio state
  const [portfolios, setPortfolios] = useState(() => loadPortfolios());
  const [activePortfolioId, setActivePortfolioId] = useState(() => loadPortfolios()[0]?.id ?? "p1");
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");

  // Portafolio activo derivado
  const activePortfolioObj = portfolios.find(p => p.id === activePortfolioId);
  const portfolio = activePortfolioObj?.positions ?? [];
  const isExperimental = activePortfolioObj?.experimental ?? false;
  const expTotal = activePortfolioObj?.experimentalTotal ?? 0;
  const allocatedExpPct = portfolio.reduce((s, p) => s + (p.expPct ?? 0), 0);
  const remainingExpPct = Math.max(0, parseFloat((100 - allocatedExpPct).toFixed(2)));

  const setPortfolio = (updater) => {
    setPortfolios(prev => {
      const next = prev.map(p =>
        p.id === activePortfolioId
          ? { ...p, positions: typeof updater === "function" ? updater(p.positions) : updater }
          : p
      );
      savePortfolios(next);
      return next;
    });
  };

  const toggleExperimental = () => {
    setPortfolios(prev => {
      const next = prev.map(p => p.id === activePortfolioId ? { ...p, experimental: !p.experimental } : p);
      savePortfolios(next);
      return next;
    });
  };

  const setExpTotalVal = (val) => {
    setPortfolios(prev => {
      const next = prev.map(p => p.id === activePortfolioId ? { ...p, experimentalTotal: parseFloat(val) || 0 } : p);
      savePortfolios(next);
      return next;
    });
  };
  const [newTicker, setNewTicker] = useState("");
  const [newShares, setNewShares] = useState("");
  const [newCost, setNewCost] = useState("");
  const [addError, setAddError] = useState("");
  const addingRef = useRef(false);
  const [stockData, setStockData] = useState({});
  const [usdMxn, setUsdMxn] = useState(17.5);

  // Wrappers del render — usan siempre usdMxn y stockData actuales
  const toMXN  = (ticker, price) => priceMXN(ticker, price ?? 0, usdMxn);
  const posVal  = (p) => posValMXN(p, stockData, usdMxn);
  const posCost = (p) => posCostMXN(p, usdMxn);

  const [loading, setLoading] = useState({});
  const [optimResult, setOptimResult] = useState(null);
  const [optimLoading, setOptimLoading] = useState(false);
  const [optimPeriod, setOptimPeriod] = useState("5y");
  const [optimLoadingMsg, setOptimLoadingMsg] = useState("");
  const [screenerTickers, setScreenerTickers] = useState(() => {
    try {
      return localStorage.getItem("momentum_screener") ?? SCREEN_TICKERS.join(", ");
    } catch { return SCREEN_TICKERS.join(", "); }
  });
  const [screenerData, setScreenerData] = useState([]);
  const [screenerLoading, setScreenerLoading] = useState(false);
  const [screenerProgress, setScreenerProgress] = useState(0);
  const [sharpeData, setSharpeData] = useState({});
  const [portfolioSharpeExact, setPortfolioSharpeExact] = useState(null);
  const [newsData, setNewsData] = useState([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [marketData, setMarketData] = useState(null);
  const [marketDataLoading, setMarketDataLoading] = useState(false);
  const [marketNews, setMarketNews] = useState([]);
  const [marketNewsLoading, setMarketNewsLoading] = useState(false);
  const [showAbsChange, setShowAbsChange] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [newsFilter, setNewsFilter] = useState("all");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [countdown, setCountdown] = useState(60);
  const refreshTimerRef = useRef(null);
  const countdownTimerRef = useRef(null);
  const [backtestResult, setBacktestResult] = useState(null);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [backtestError, setBacktestError] = useState(null);
  const [newsTicker, setNewsTicker] = useState("");
  const [newsSentimentFilter, setNewsSentimentFilter] = useState("all");
  const [macroData, setMacroData] = useState(null);
  const [dcfData, setDcfData] = useState({});       // { ticker: {...} }
  const [momentumData, setMomentumData] = useState({}); // { ticker: {...} }
  const [corrMatrix, setCorrMatrix] = useState(null);
  const [fibrasData, setFibrasData] = useState(null);
  const [fibrasLoading, setFibrasLoading] = useState(false);
  const [fibrasExtra, setFibrasExtra] = useState("");
  const [magicData, setMagicData] = useState(null);
  const [magicLoading, setMagicLoading] = useState(false);
  const [magicProgress, setMagicProgress] = useState({ done: 0, total: 0, current: "" });
  const [magicSort, setMagicSort] = useState({ col: "magic_rank", dir: "asc" });
  const [magicSector, setMagicSector] = useState("Todos");
  const [magicMinEY, setMagicMinEY] = useState("");
  const [magicMinROC, setMagicMinROC] = useState("");
  const [worldMapData, setWorldMapData] = useState(null);
  const [worldMapLoading, setWorldMapLoading] = useState(false);
  const [inputMode, setInputMode] = useState("shares"); // "shares" | "pct"
  const [newPct, setNewPct] = useState("");
  const [targetPcts, setTargetPcts] = useState({});
  const [hoveredTicker, setHoveredTicker] = useState(null);
  const [customTotal, setCustomTotal] = useState("");
  const [monteCarloResult, setMonteCarloResult] = useState(null);
  const [monteCarloLoading, setMonteCarloLoading] = useState(false);
  const [monteCarloError, setMonteCarloError] = useState(null);
  const [analisisTicker, setAnalisisTicker] = useState("");
  const [analisisData, setAnalisisData] = useState(null);
  const [analisisChart, setAnalisisChart] = useState(null);
  const [analisisLoading, setAnalisisLoading] = useState(false);
  const [analisisError, setAnalisisError] = useState(null);
  const [analisisNews, setAnalisisNews] = useState([]);
  const [analisisNewsLoading, setAnalisisNewsLoading] = useState(false);
  const [analisisPeriod, setAnalisisPeriod] = useState("1y");
  const [analisisFinTab, setAnalisisFinTab] = useState("income");
  const [analisisHoverIdx, setAnalisisHoverIdx] = useState(null);
  const [analisisReturns, setAnalisisReturns] = useState(null);
  const [analisisDescExpanded, setAnalisisDescExpanded] = useState(false);

  // Persistir screener en localStorage
  useEffect(() => {
    localStorage.setItem("momentum_screener", screenerTickers);
  }, [screenerTickers]);


  // Inicializar targetPcts cuando cambian los precios o el portafolio
  useEffect(() => {
    if (portfolio.length === 0) return;

    if (isExperimental) {
      // Modo experimental: fuente de verdad = expPct en cada posición.
      // Corrige inicializaciones parciales (ej. JNJ al 100% cuando es el único precio cargado).
      setTargetPcts(prev => {
        const next = { ...prev };
        let changed = false;
        portfolio.forEach(p => {
          if (p.expPct !== undefined) {
            const expected = String(p.expPct);
            // Sobrescribir si aún no está inicializado O si difiere del expPct guardado
            if (next[p.ticker] === undefined || Math.abs(parseFloat(next[p.ticker] ?? "0") - p.expPct) > 0.1) {
              next[p.ticker] = expected;
              changed = true;
            }
          }
        });
        return changed ? next : prev;
      });
      return;
    }

    // Modo normal: solo inicializar cuando TODOS los precios estén cargados
    // (evita que el primero en cargar ocupe el 100%)
    if (Object.keys(stockData).length === 0) return;
    const allPricesLoaded = portfolio.every(p => stockData[p.ticker]?.price);
    if (!allPricesLoaded) return;

    let totalValue = 0;
    portfolio.forEach(p => { totalValue += posVal(p); });
    if (totalValue <= 0) return;

    setTargetPcts(prev => {
      const next = { ...prev };
      let changed = false;
      portfolio.forEach(p => {
        if (next[p.ticker] === undefined) {
          next[p.ticker] = (posVal(p) / totalValue * 100).toFixed(1);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [portfolio, stockData, isExperimental]);

  // Fetch RF rate + macro on mount
  useEffect(() => {
    fetchRiskFreeRate()
      .then((r) => { setRfRate(r.rate); setRfLabel(r.label); setBackendOk(true); })
      .catch(() => setBackendOk(false));
    fetch(`${BACKEND}/macro`).then(r => r.json()).then(setMacroData).catch(() => {});
    fetch(`${BACKEND}/fx`).then(r => r.json()).then(d => { if (d?.USDMXN) setUsdMxn(d.USDMXN); }).catch(() => {});
  }, []);

  // Keep-alive: ping cada 10 min para evitar que Render (free tier) duerma
  useEffect(() => {
    if (!backendUrl) return;
    const id = setInterval(() => {
      fetch(`${backendUrl}/health`, { signal: AbortSignal.timeout(8000) }).catch(() => {});
    }, 10 * 60 * 1000);
    return () => clearInterval(id);
  }, [backendUrl]);

  // Load stock data for portfolio
  const loadStockData = useCallback(async (ticker) => {
    setLoading((p) => ({ ...p, [ticker]: true }));
    try {
      const sd = await fetchStock(ticker);
      if (sd) setStockData((prev) => ({ ...prev, [ticker]: sd }));
      // DCF en paralelo
      fetch(`${BACKEND}/dcf/${encodeURIComponent(ticker)}`).then(r => r.json())
        .then(d => setDcfData(prev => ({ ...prev, [ticker]: d }))).catch(() => {});
    } catch (e) {
      console.error(ticker, e);
    }
    setLoading((p) => ({ ...p, [ticker]: false }));
  }, []);

  useEffect(() => {
    // Carga secuencial con delay para evitar rate limiting
    const loadAll = async () => {
      for (const p of portfolio) {
        if (!stockData[p.ticker]) {
          await loadStockData(p.ticker);
          await sleep(400);
        }
      }
    };
    loadAll();
  }, [portfolio]);

  // ── helpers de correlación / Sharpe ─────────────────────────────────────
  const computeStats = (returnsArr) => {
    const means = returnsArr.map((r) => r.reduce((a, b) => a + b, 0) / (r.length || 1));
    const stds  = returnsArr.map((r, i) => {
      const m = means[i];
      return Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length || 1)) || 1e-9;
    });
    return { means, stds };
  };

  const corrBetween = (rA, rB, mA, mB, sA, sB) => {
    const len = Math.min(rA.length, rB.length);
    const cov = rA.slice(-len).reduce((s, v, k) => s + (v - mA) * (rB.slice(-len)[k] - mB), 0) / len;
    return cov / (sA * sB);
  };

  const sharpeOf = (returns, rf) => {
    if (!returns.length) return 0;
    const rfW = rf / 52;
    const excess = returns.map((r) => r - rfW);
    const m = excess.reduce((a, b) => a + b, 0) / excess.length;
    const std = Math.sqrt(excess.reduce((a, b) => a + (b - m) ** 2, 0) / excess.length) || 1e-9;
    return (m / std) * Math.sqrt(52);
  };

  // Portfolio optimization
  const runOptimization = async () => {
    setOptimLoading(true);
    setOptimResult(null);
    setOptimLoadingMsg("Descargando histórico del portafolio...");

    const tickers = portfolio.map((p) => p.ticker);
    const returnsAll = [];
    const lastClosesOptim = []; // último precio del historial por ticker
    for (const t of tickers) {
      const closes = await fetchChart(t, optimPeriod);
      const returns = closes.slice(1).map((v, i) => (v - closes[i]) / closes[i]).filter(isFinite);
      returnsAll.push(returns);
      lastClosesOptim.push(closes.length > 0 ? closes[closes.length - 1] : 0);
      await sleep(100);
    }
    const rf = rfRate ?? 0.0860;

    setOptimLoadingMsg("Ejecutando Monte Carlo (100k simulaciones)...");
    // Covarianza directa (sin pasar por corrMatrix redondeada) — misma lógica que Portfolio tab
    const { cov: covMatrix, means } = buildCovMatrix(returnsAll);
    const best = optimizeSharpe(returnsAll, rf);

    // Matriz de correlación (solo para visualización — redondeada a 3 decimales)
    const n = returnsAll.length;
    const { stds } = computeStats(returnsAll);
    const corrMatrix = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => {
        return +(corrBetween(returnsAll[i], returnsAll[j], means[i], means[j], stds[i], stds[j])).toFixed(3);
      })
    );

    // Pesos actuales por valor de mercado — usando último cierre del historial descargado
    const totalVal = tickers.reduce((s, t, i) => {
      const pos = portfolio.find(p => p.ticker === t);
      return s + (pos?.shares ?? 0) * lastClosesOptim[i];
    }, 0);
    const actualWeights = tickers.map((t, i) => {
      const pos = portfolio.find(p => p.ticker === t);
      const val = (pos?.shares ?? 0) * lastClosesOptim[i];
      return totalVal > 0 ? val / totalVal : 1 / tickers.length;
    });
    const actualSharpe = calcPortfolioSharpe(actualWeights, covMatrix, means, rf);

    // Sharpe con pesos óptimos
    const currentSharpe = calcPortfolioSharpe(best.weights, covMatrix, means, rf);

    // Retorno y volatilidad anualizados para ambos escenarios
    const portStats = (weights) => {
      let ret = 0; for (let i = 0; i < n; i++) ret += weights[i] * means[i];
      let variance = 0;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) variance += weights[i] * weights[j] * covMatrix[i][j];
      return { annReturn: +(ret * 52 * 100).toFixed(2), annVol: +(Math.sqrt(variance * 52) * 100).toFixed(2) };
    };
    const actualStats = portStats(actualWeights);
    const optimalStats = portStats(best.weights);

    // ── Recomendaciones de candidatos (en batches paralelos) ───────────────
    const candidates = CANDIDATE_TICKERS.filter((t) => !tickers.includes(t));
    const recommendations = [];
    const BATCH = 5;

    const evalCandidate = async (cand) => {
      try {
        const closes = await fetchChart(cand, optimPeriod, 10000);
        if (closes.length < 30) return null;
        const candReturns = closes.slice(1).map((v, i) => (v - closes[i]) / closes[i]).filter(isFinite);
        const candMean = candReturns.reduce((a, b) => a + b, 0) / candReturns.length;
        const candStd  = Math.sqrt(candReturns.reduce((a, b) => a + (b - candMean) ** 2, 0) / candReturns.length) || 1e-9;
        const avgCorr = means.map((_, i) => Math.abs(
          corrBetween(returnsAll[i], candReturns, means[i], candMean, stds[i], candStd)
        )).reduce((a, b) => a + b, 0) / n;
        const candSharpe = sharpeOf(candReturns, rf);
        const w0 = best.weights.map((w) => w * 0.95);
        const newReturnsAll = [...returnsAll, candReturns];
        const newMeans = [...means, candMean];
        const newStds  = [...stds, candStd];
        const newWeights = [...w0, 0.05];
        const newCovMatrix = Array.from({ length: n + 1 }, (_, i) =>
          Array.from({ length: n + 1 }, (_, j) =>
            corrBetween(newReturnsAll[i], newReturnsAll[j], newMeans[i], newMeans[j], newStds[i], newStds[j]) * newStds[i] * newStds[j]
          )
        );
        const newSharpe = calcPortfolioSharpe(newWeights, newCovMatrix, newMeans, rf);
        const sharpeDelta = newSharpe - currentSharpe;
        const corrScore   = Math.max(0, (1 - avgCorr)) * 35;
        const sharpeScore = Math.min(Math.max(candSharpe / 3, 0), 1) * 25;
        const deltaScore  = Math.min(Math.max(sharpeDelta / 0.5 + 0.5, 0), 1) * 40;
        return { ticker: cand, avgCorr: +avgCorr.toFixed(3), candSharpe: +candSharpe.toFixed(3), sharpeDelta: +sharpeDelta.toFixed(3), score: +(corrScore + sharpeScore + deltaScore).toFixed(1) };
      } catch { return null; }
    };

    for (let i = 0; i < candidates.length; i += BATCH) {
      const batch = candidates.slice(i, i + BATCH);
      setOptimLoadingMsg(`Evaluando candidatos... (${Math.min(i + BATCH, candidates.length)}/${candidates.length})`);
      const results = await Promise.all(batch.map(evalCandidate));
      results.forEach(r => { if (r) recommendations.push(r); });
    }

    recommendations.sort((a, b) => b.score - a.score);

    setOptimResult({
      ...best, tickers, corrMatrix,
      recommendations: recommendations.slice(0, 10),
      actualWeights, actualSharpe: +actualSharpe.toFixed(4),
      optimalSharpe: +currentSharpe.toFixed(4),
      actualStats, optimalStats,
    });
    setOptimLoadingMsg("");
    setOptimLoading(false);
  };

  // Asegura que el backend esté despierto; reintenta hasta 90s
  const ensureBackend = async () => {
    if (!BACKEND) return false;
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      try {
        const r = await fetch(`${BACKEND}/health`, { signal: AbortSignal.timeout(12000) });
        const d = await r.json();
        if (d?.status === "ok") return true;
      } catch {}
      await sleep(5000);
    }
    return false;
  };

  // Backtest vs SPY
  const runBacktest = async () => {
    setBacktestLoading(true);
    setBacktestResult(null);
    setBacktestError(null);
    if (!BACKEND) {
      setBacktestError("El backend no está disponible. Recarga la página e intenta de nuevo.");
      setBacktestLoading(false);
      return;
    }
    // Despertar backend si está dormido (Render free tier puede tardar hasta 90s)
    setBacktestError("⏳ Despertando backend... (primera vez puede tardar hasta 90 s)");
    const alive = await ensureBackend();
    setBacktestError(null);
    if (!alive) {
      setBacktestError("El backend no respondió en 90 s. Intenta de nuevo en 1-2 minutos.");
      setBacktestLoading(false);
      return;
    }
    try {
      const spyCloses = await fetchChart("SPY", "5y", 60000);
      const spyReturnsRaw = spyCloses.slice(1).map((v, i) => (v - spyCloses[i]) / spyCloses[i]).filter(isFinite);

      const tickers = portfolio.map((p) => p.ticker);
      const returnsMap = {};
      for (const t of tickers) {
        await sleep(200);
        const closes = await fetchChart(t, "5y", 60000);
        returnsMap[t] = closes.slice(1).map((v, i) => (v - closes[i]) / closes[i]).filter(isFinite);
      }

      const _fx = usdMxn;
      const totalValue = portfolio.reduce((s, p) => s + posValMXN(p, stockData, _fx), 0);
      const weights = portfolio.map((p) => {
        const val = posValMXN(p, stockData, _fx);
        return totalValue > 0 ? val / totalValue : 1 / portfolio.length;
      });

      const tickerLensBack = tickers.map(t => ({ t, len: returnsMap[t]?.length ?? 0 }));
      const minLen = Math.min(spyReturnsRaw.length, ...tickerLensBack.map(x => x.len));

      if (minLen < 10) {
        const empties = tickerLensBack.filter(x => x.len === 0).map(x => x.t);
        setBacktestError(
          `No hay suficientes datos históricos (${minLen} semanas). ` +
          (empties.length ? `Sin datos: ${empties.join(", ")}. ` : "") +
          "Verifica que los tickers del portafolio existen en yfinance y que el backend está activo."
        );
        setBacktestLoading(false);
        return;
      }

      const limitingTickerBack = tickerLensBack.reduce((a, b) => a.len <= b.len ? a : b).t;
      const spyReturns = spyReturnsRaw.slice(0, minLen);
      const portReturns = Array.from({ length: minLen }, (_, i) =>
        tickers.reduce((s, t, wi) => s + weights[wi] * (returnsMap[t]?.[i] ?? 0), 0)
      );

      // Generar etiquetas de semanas hacia atrás desde hoy
      const today = new Date();
      const MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
      const dates = Array.from({ length: minLen }, (_, i) => {
        const d = new Date(today);
        d.setDate(d.getDate() - (minLen - 1 - i) * 7);
        return `${MONTHS[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`;
      });

      const rf = rfRate ?? 0.0860;
      const beta = calcPortfolioBeta(portReturns, spyReturns);
      const trackingError = calcTrackingError(portReturns, spyReturns);
      const treynor = calcTreynor(portReturns, beta, rf);
      const alpha = calcJensensAlpha(portReturns, spyReturns, beta, rf);
      const infoRatio = calcInfoRatio(portReturns, spyReturns);
      const sharpe = calcSharpe(portReturns, rf);
      const annPortReturn = (portReturns.reduce((a, b) => a + b, 0) / portReturns.length) * 52;
      const annSpyReturn = (spyReturns.reduce((a, b) => a + b, 0) / spyReturns.length) * 52;

      // Matriz de correlación entre activos del portafolio
      const corrMatrix = tickers.map((ti) =>
        tickers.map((tj) => {
          const ri = returnsMap[ti]?.slice(0, minLen) ?? [];
          const rj = returnsMap[tj]?.slice(0, minLen) ?? [];
          if (!ri.length || !rj.length) return 0;
          const mi = ri.reduce((a, b) => a + b, 0) / ri.length;
          const mj = rj.reduce((a, b) => a + b, 0) / rj.length;
          const cov = ri.reduce((s, v, k) => s + (v - mi) * (rj[k] - mj), 0) / ri.length;
          const si = Math.sqrt(ri.reduce((s, v) => s + (v - mi) ** 2, 0) / ri.length);
          const sj = Math.sqrt(rj.reduce((s, v) => s + (v - mj) ** 2, 0) / rj.length);
          return si && sj ? Math.round((cov / (si * sj)) * 100) / 100 : 0;
        })
      );

      const yearsBacktest = (minLen / 52).toFixed(1);
      setBacktestResult({
        portCum: cumulativeReturns(portReturns),
        spyCum: cumulativeReturns(spyReturns),
        dates, beta, trackingError, treynor, alpha, infoRatio, sharpe, annPortReturn, annSpyReturn,
        corrMatrix, tickers, yearsBacktest, limitingTickerBack,
        tickerYearsBack: tickerLensBack.map(x => ({ t: x.t, y: (x.len / 52).toFixed(1) })),
      });
    } catch (e) {
      console.error("Backtest error:", e);
      setBacktestError(`Error al obtener datos: ${e?.message ?? e}. Verifica que el backend esté activo.`);
    }
    setBacktestLoading(false);
  };

  // Monte Carlo — proyección futura con datos históricos de 5 años
  const runMonteCarlo = async () => {
    setMonteCarloLoading(true);
    setMonteCarloResult(null);
    setMonteCarloError(null);
    if (!BACKEND) {
      setMonteCarloError("El backend no está disponible. Recarga la página e intenta de nuevo.");
      setMonteCarloLoading(false);
      return;
    }
    // Despertar backend si está dormido
    setMonteCarloError("⏳ Despertando backend... (primera vez puede tardar hasta 90 s)");
    const alive = await ensureBackend();
    setMonteCarloError(null);
    if (!alive) {
      setMonteCarloError("El backend no respondió en 90 s. Intenta de nuevo en 1-2 minutos.");
      setMonteCarloLoading(false);
      return;
    }
    try {
      const spyCloses = await fetchChart("SPY", "5y", 60000);
      const spyRet = spyCloses.slice(1).map((v, i) => (v - spyCloses[i]) / spyCloses[i]).filter(isFinite);

      const tickers = portfolio.map(p => p.ticker);
      const returnsMap = {};
      for (const t of tickers) {
        await sleep(200);
        const closes = await fetchChart(t, "5y", 60000);
        returnsMap[t] = closes.slice(1).map((v, i) => (v - closes[i]) / closes[i]).filter(isFinite);
      }

      const _fx = usdMxn;
      const totalValue = portfolio.reduce((s, p) => s + posValMXN(p, stockData, _fx), 0);
      const weights = portfolio.map(p => {
        const val = posValMXN(p, stockData, _fx);
        return totalValue > 0 ? val / totalValue : 1 / portfolio.length;
      });

      const tickerLens = tickers.map(t => ({ t, len: returnsMap[t]?.length ?? 0 }));
      const minLen = Math.min(spyRet.length, ...tickerLens.map(x => x.len));

      if (minLen < 10) {
        const empties = tickerLens.filter(x => x.len === 0).map(x => x.t);
        setMonteCarloError(
          `No hay suficientes datos históricos (${minLen} semanas). ` +
          (empties.length ? `Sin datos: ${empties.join(", ")}. ` : "") +
          "Verifica que los tickers del portafolio existen en yfinance y que el backend está activo."
        );
        setMonteCarloLoading(false);
        return;
      }

      const limitingTicker = tickerLens.reduce((a, b) => a.len <= b.len ? a : b).t;
      const portRet = Array.from({ length: minLen }, (_, i) =>
        tickers.reduce((s, t, wi) => s + weights[wi] * (returnsMap[t]?.[i] ?? 0), 0)
      );

      const mean = arr => arr.reduce((a, b) => a + b, 0) / (arr.length || 1);
      const std  = arr => { const m = mean(arr); return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length || 1)); };

      const muPort  = mean(portRet);  const sigPort = std(portRet);
      const muSpy   = mean(spyRet);   const sigSpy  = std(spyRet);

      // Box-Muller para números normales
      const randn = () => Math.sqrt(-2 * Math.log(Math.random() + 1e-12)) * Math.cos(2 * Math.PI * Math.random());

      const H = 52;    // semanas
      const N = 10000; // simulaciones (reducido de 50k para evitar freeze del browser)

      const simPaths = (mu, sig) => Array.from({ length: N }, () => {
        const path = [1];
        for (let t = 0; t < H; t++) path.push(path[path.length - 1] * (1 + mu + sig * randn()));
        return path;
      });

      const portPaths = simPaths(muPort, sigPort);
      const spyPaths  = simPaths(muSpy,  sigSpy);

      // Ordenar UNA vez por paso de tiempo para calcular todos los percentiles (5x más rápido)
      const buildStats = (paths) => Array.from({ length: H + 1 }, (_, t) => {
        const vals = paths.map(p => p[t]);
        const sorted = [...vals].sort((a, b) => a - b);
        const idx = (q) => Math.max(0, Math.floor((q / 100) * (sorted.length - 1)));
        const m = vals.reduce((a, b) => a + b, 0) / vals.length;
        return { p5: sorted[idx(5)], p25: sorted[idx(25)], median: sorted[idx(50)], p75: sorted[idx(75)], p95: sorted[idx(95)], mean: m };
      });

      const portStats = buildStats(portPaths);
      const spyStats  = buildStats(spyPaths);

      // Probabilidad de superar al SPY al final
      const probBeat = portPaths.filter((p, i) => p[H] > spyPaths[i][H]).length / N;

      // Años de datos usados (mínimo entre todos los tickers)
      const yearsData = (minLen / 52).toFixed(1);
      const tickerYears = tickerLens.map(x => ({ t: x.t, y: (x.len / 52).toFixed(1) }));

      setMonteCarloResult({
        portStats, spyStats, H, N, yearsData, limitingTicker, tickerYears,
        muPort, sigPort, muSpy, sigSpy, probBeat,
        weeks: Array.from({ length: H + 1 }, (_, i) => i === 0 ? "Hoy" : `S${i}`),
      });
    } catch (e) {
      console.error("MC error:", e);
      setMonteCarloError(`Error en simulación: ${e?.message ?? e}. Verifica que el backend esté activo.`);
    }
    setMonteCarloLoading(false);
  };

  // Screener
  const runScreener = async () => {
    setScreenerLoading(true);
    setScreenerData([]);
    setScreenerProgress(0);
    const tickers = screenerTickers.split(",").map((t) => t.trim()).filter(Boolean);
    const rf = rfRate ?? 0.0860;
    const results = [];
    for (let i = 0; i < tickers.length; i++) {
      const t = tickers[i];
      setScreenerProgress(Math.round(((i + 1) / tickers.length) * 100));
      let sd = stockData[t];
      if (!sd) {
        try {
          sd = await fetchStock(t);
          if (sd) setStockData((prev) => ({ ...prev, [t]: sd }));
        } catch {}
        await sleep(150);
      }
      const scores = mlScoreStock(t, sd ?? {});

      // Sharpe 1Y: calcular desde datos históricos semanales
      let sharpe1y = null;
      try {
        const closes = await fetchChart(t, "1y");
        if (closes.length > 10) {
          const rets = closes.slice(1).map((v, k) => (v - closes[k]) / closes[k]).filter(isFinite);
          sharpe1y = +calcSharpe(rets, rf).toFixed(3);
        }
      } catch {}

      // DCF + Momentum en paralelo
      let dcf = null, mom = null;
      try {
        [dcf, mom] = await Promise.all([
          fetch(`${BACKEND}/dcf/${encodeURIComponent(t)}`).then(r => r.json()).catch(() => null),
          fetch(`${BACKEND}/momentum/${encodeURIComponent(t)}`).then(r => r.json()).catch(() => null),
        ]);
      } catch {}
      results.push({ ticker: t, ...sd, scores, dcf, momentum: mom, sharpe1y });
      setScreenerData([...results]);
      await sleep(150);
    }
    setScreenerLoading(false);
  };

  const MAGIC_UNIVERSE = [
    "AAPL","MSFT","NVDA","GOOGL","META","AVGO","ORCL","ADBE","CRM","AMD",
    "INTC","QCOM","TXN","MU","AMAT","LRCX","KLAC","MRVL","NOW","NFLX",
    "UBER","PYPL","PALO","CRWD","ZS","DDOG","NET","CDNS","SNPS","FTNT",
    "ACN","IBM","HPQ","DELL","LLY","UNH","JNJ","ABBV","MRK","TMO",
    "DHR","ABT","BMY","AMGN","GILD","VRTX","REGN","ISRG","BSX","IQV",
    "MCK","CVS","AMZN","TSLA","HD","LOW","MCD","SBKS","NKE","YUM",
    "CMG","BKNG","MAR","HLT","TJX","ROST","ULTA","DRI","F","GM","ORLY",
    "AZO","WMT","COST","TGT","PG","KO","PEP","PM","MO","CL","MDLZ",
    "HSY","CAT","DE","HON","RTX","LMT","GE","BA","MMM","EMR","ETN",
    "PH","ROK","FDX","UPS","CSX","NSC","UNP","GD","NOC","TDG","FAST",
    "GWW","XOM","CVX","COP","EOG","SLB","MPC","PSX","VLO","OXY",
    "DVN","HAL","LIN","APD","ECL","NEM","FCX","NUE","PPG","SHW",
    "DIS","CMCSA","EA","TTWO",
  ];
  const EXCLUDED_SECTORS_FE = new Set([
    "Financial Services","Financials","Utilities","Real Estate"
  ]);

  const runMagicFormula = async () => {
    setMagicLoading(true);
    setMagicData(null);
    setMagicProgress({ done: 0, total: MAGIC_UNIVERSE.length, current: "" });

    const candidates = [];
    for (let i = 0; i < MAGIC_UNIVERSE.length; i++) {
      const ticker = MAGIC_UNIVERSE[i];
      setMagicProgress({ done: i + 1, total: MAGIC_UNIVERSE.length, current: ticker });
      try {
        const magicRes = await fetch(`${BACKEND}/magic_one/${encodeURIComponent(ticker)}`).then(r => r.json()).catch(() => null);
        if (!magicRes || magicRes.skip) { await sleep(80); continue; }
        candidates.push(magicRes);
      } catch {}
      await sleep(80);
    }

    // Ranking client-side
    const sortedEY  = [...candidates].sort((a, b) => b.ey  - a.ey);
    const sortedROC = [...candidates].sort((a, b) => b.roc - a.roc);
    const rankEY  = Object.fromEntries(sortedEY.map((c, i)  => [c.ticker, i + 1]));
    const rankROC = Object.fromEntries(sortedROC.map((c, i) => [c.ticker, i + 1]));

    candidates.forEach(c => {
      c.rank_ey    = rankEY[c.ticker];
      c.rank_roc   = rankROC[c.ticker];
      c.magic_rank = c.rank_ey + c.rank_roc;
    });
    candidates.sort((a, b) => a.magic_rank - b.magic_rank);

    setMagicData({ stocks: candidates.slice(0, 30), count: candidates.length, universe: MAGIC_UNIVERSE.length });
    setMagicLoading(false);
  };

  const runFibrasScreener = async () => {
    setFibrasLoading(true);
    try {
      const extra = fibrasExtra.trim();
      const url = extra ? `${BACKEND}/fibras/${encodeURIComponent(extra)}` : `${BACKEND}/fibras`;
      const data = await fetch(url).then(r => r.json());
      setFibrasData(data);
    } catch {}
    setFibrasLoading(false);
  };

  const loadSharpeData = async (period = "1y") => {
    const result = {};
    const returnsMap = {};
    const lastPriceMap = {}; // último cierre del historial → no depende de stockData
    const rf = rfRate ?? 0.0860;

    for (const p of portfolio) {
      try {
        const closes = await fetchChart(p.ticker, period);
        if (closes.length < 10) continue;
        const returns = closes.slice(1).map((v, i) => (v - closes[i]) / closes[i]).filter(isFinite);
        result[p.ticker] = +sharpeOf(returns, rf).toFixed(2);
        returnsMap[p.ticker] = returns;
        lastPriceMap[p.ticker] = closes[closes.length - 1]; // precio más reciente del historial
        await sleep(150);
      } catch { /* skip */ }
    }
    setSharpeData(result);

    // Sharpe exacto del portafolio con matriz de covarianza (incluye correlaciones)
    const tickers = portfolio.map(p => p.ticker).filter(t => returnsMap[t]);
    if (tickers.length >= 2) {
      const returnsMatrix = tickers.map(t => returnsMap[t]);
      const { cov, means } = buildCovMatrix(returnsMatrix);

      // Pesos por valor de mercado en MXN usando el último cierre del historial
      const _fx = usdMxn;
      const totalVal = tickers.reduce((s, t) => {
        const pos = portfolio.find(p => p.ticker === t);
        return s + (pos?.shares ?? 0) * priceMXN(t, lastPriceMap[t] ?? 0, _fx);
      }, 0);
      const weights = tickers.map(t => {
        const pos = portfolio.find(p => p.ticker === t);
        const val = (pos?.shares ?? 0) * priceMXN(t, lastPriceMap[t] ?? 0, _fx);
        return totalVal > 0 ? val / totalVal : 1 / tickers.length;
      });

      const exact = calcPortfolioSharpe(weights, cov, means, rf);
      setPortfolioSharpeExact(isFinite(exact) ? +exact.toFixed(2) : null);
    } else if (tickers.length === 1) {
      setPortfolioSharpeExact(result[tickers[0]] ?? null);
    }
  };

  // Cargar Sharpe individual al montar o cuando cambia portafolio/rf
  useEffect(() => {
    if (rfRate !== null && portfolio.length > 0) loadSharpeData("1y");
  }, [rfRate, portfolio.length]);

  const loadNews = async (ticker) => {
    if (!ticker.trim()) return;
    setNewsLoading(true);
    setNewsData([]);
    try {
      const res = await fetch(`${BACKEND}/news/${encodeURIComponent(ticker.trim().toUpperCase())}`);
      const data = await res.json();
      setNewsData(data.news ?? []);
    } catch { setNewsData([]); }
    setNewsLoading(false);
  };

  const runAnalisis = useCallback(async (tickerArg, periodArg) => {
    const t = (tickerArg ?? analisisTicker).trim().toUpperCase();
    if (!t) return;
    const period = periodArg ?? analisisPeriod ?? "1y";
    if (tickerArg) setAnalisisTicker(tickerArg);
    if (periodArg) setAnalisisPeriod(periodArg);
    setTab("analisis");
    setAnalisisLoading(true);
    setAnalisisData(null);
    setAnalisisChart(null);
    setAnalisisNews([]);
    setAnalisisError(null);
    setAnalisisHoverIdx(null);
    setAnalisisReturns(null);
    setAnalisisDescExpanded(false);
    try {
      const [stockRes, chartRes] = await Promise.all([
        fetch(`${BACKEND}/stock/${t}`),
        fetch(`${BACKEND}/chart/${t}?period=${period}`),
      ]);
      const sd = stockRes.ok ? await stockRes.json() : null;
      const cd = chartRes.ok ? await chartRes.json() : null;
      if (!sd) { setAnalisisError(`No se encontraron datos para "${t}"`); return; }
      setAnalisisData(sd);
      setAnalisisChart(cd);
    } catch {
      setAnalisisError("Error de conexión con el backend.");
    } finally {
      setAnalisisLoading(false);
    }
    fetch(`${BACKEND}/returns/${t}`).then(r => r.ok ? r.json() : null).then(rd => setAnalisisReturns(rd)).catch(() => {});
    setAnalisisNewsLoading(true);
    try {
      const nr = await fetch(`${BACKEND}/news/${encodeURIComponent(t)}`);
      const nd = nr.ok ? await nr.json() : null;
      setAnalisisNews(nd?.news ?? []);
    } catch { setAnalisisNews([]); }
    setAnalisisNewsLoading(false);
  }, [analisisTicker, analisisPeriod]);

  const fetchAnalisisChart = useCallback(async (period) => {
    const t = analisisTicker.trim().toUpperCase();
    if (!t) return;
    setAnalisisPeriod(period);
    setAnalisisHoverIdx(null);
    try {
      const cd = await fetch(`${BACKEND}/chart/${t}?period=${period}`).then(r => r.ok ? r.json() : null);
      setAnalisisChart(cd);
    } catch {}
  }, [analisisTicker]);

  const loadMarketData = useCallback(async () => {
    setMarketDataLoading(true);
    try {
      const data = await fetch(`${BACKEND}/market`).then(r => r.json());
      setMarketData(data);
      setLastUpdated(new Date());
    } catch {}
    setMarketDataLoading(false);
  }, []);

  const loadMarketNews = useCallback(async () => {
    setMarketNewsLoading(true);
    try {
      const data = await fetch(`${BACKEND}/news/market`).then(r => r.json());
      setMarketNews(data.news ?? []);
    } catch {}
    setMarketNewsLoading(false);
  }, []);


  const loadWorldMap = useCallback(async () => {
    setWorldMapLoading(true);
    try {
      const data = await fetch(`${BACKEND}/worldmap`).then(r => r.json());
      setWorldMapData(data);
    } catch {}
    setWorldMapLoading(false);
  }, []);

  useEffect(() => {
    if (tab === "news") {
      if (!marketData) loadMarketData();
      if (marketNews.length === 0) loadMarketNews();
      if (!worldMapData) loadWorldMap();
    }
  }, [tab]);

  useEffect(() => {
    clearInterval(refreshTimerRef.current);
    clearInterval(countdownTimerRef.current);
    if (tab !== "news" || !autoRefresh) return;
    setCountdown(60);
    refreshTimerRef.current = setInterval(() => {
      loadMarketData();
      setCountdown(60);
    }, 60_000);
    countdownTimerRef.current = setInterval(() => {
      setCountdown(prev => Math.max(0, prev - 1));
    }, 1_000);
    return () => {
      clearInterval(refreshTimerRef.current);
      clearInterval(countdownTimerRef.current);
    };
  }, [tab, autoRefresh, loadMarketData]);

  const addStock = async () => {
    if (addingRef.current) return;
    addingRef.current = true;
    setAddError("");
    if (!newTicker) { addingRef.current = false; return; }
    const t = newTicker.toUpperCase().trim();
    const cost = parseFloat(newCost);
    let shares;

    if (isExperimental) {
      const pct = parseFloat(newPct);
      if (!pct || pct <= 0) { setAddError("Ingresa un porcentaje válido (> 0)."); addingRef.current = false; return; }
      // Usar targetPcts como fuente de verdad para calcular el % ya asignado
      const existingPct = parseFloat(targetPcts[t]) || portfolio.find(p => p.ticker === t)?.expPct || 0;
      const currentAllocated = portfolio.reduce((s, p) => s + (parseFloat(targetPcts[p.ticker]) || p.expPct || 0), 0);
      const available = Math.max(0, 100 - currentAllocated + existingPct);
      if (pct > available + 0.01) { setAddError(`Solo quedan ${available.toFixed(1)}% disponibles.`); addingRef.current = false; return; }
      if (!expTotal || expTotal <= 0) { setAddError("Define el Monto Total antes de agregar posiciones."); addingRef.current = false; return; }
      let price = stockData[t]?.price;
      if (!price) {
        const sd = await fetchStock(t);
        if (sd?.price) { price = sd.price; setStockData(prev => ({ ...prev, [t]: sd })); }
      }
      if (!price) { setAddError("No se pudo obtener el precio actual."); addingRef.current = false; return; }
      // Convertir precio a MXN: si es USD se multiplica por el tipo de cambio
      const priceMXNVal = toMXN(t, price);
      shares = (pct / 100 * expTotal) / priceMXNVal;
      if (portfolio.find(p => p.ticker === t)) {
        setPortfolio(prev => prev.map(p => p.ticker === t ? { ...p, shares, cost: isNaN(cost) ? p.cost : cost, expPct: pct } : p));
      } else {
        setPortfolio(prev => [...prev, { ticker: t, shares, cost: isNaN(cost) ? 0 : cost, expPct: pct }]);
      }
      // targetPcts es la fuente de verdad — sincronizar siempre
      setTargetPcts(prev => ({ ...prev, [t]: String(pct) }));
      setNewTicker(""); setNewPct("");
      addingRef.current = false;
      return;
    }

    if (inputMode === "pct") {
      const pct = parseFloat(newPct);
      if (!pct || pct <= 0 || pct > 100) { setAddError("Porcentaje inválido (debe ser > 0 y ≤ 100)."); return; }
      let price = stockData[t]?.price;
      if (!price) {
        const sd = await fetchStock(t);
        if (sd?.price) { price = sd.price; setStockData((prev) => ({ ...prev, [t]: sd })); }
      }
      if (!price) { setAddError("No se pudo obtener el precio actual. Intenta en modo Acciones."); return; }
      const totalValue = portfolio.reduce((s, p) => s + posVal(p), 0);
      if (totalValue <= 0) { setAddError("El portafolio tiene valor $0. Agrega otras posiciones con precio primero."); return; }
      shares = (pct / 100 * totalValue) / toMXN(t, price);
    } else {
      shares = parseFloat(newShares);
      if (!shares || shares <= 0) { setAddError("Ingresa un número de acciones válido (> 0)."); return; }
    }

    if (portfolio.find((p) => p.ticker === t)) {
      setPortfolio((prev) => prev.map((p) =>
        p.ticker === t ? { ...p, shares, cost: isNaN(cost) ? p.cost : cost } : p
      ));
      loadStockData(t);
    } else {
      setPortfolio((prev) => [...prev, { ticker: t, shares, cost: isNaN(cost) ? 0 : cost }]);
    }
    setNewTicker(""); setNewShares(""); setNewCost(""); setNewPct("");
    addingRef.current = false;
  };
  const removeStock = (t) => {
    setPortfolio((prev) => prev.filter((p) => p.ticker !== t));
    // Limpiar targetPcts del ticker eliminado para liberar su % en modo experimental
    setTargetPcts(prev => {
      const next = { ...prev };
      delete next[t];
      return next;
    });
  };

  // ── RENDER ──────────────────────────────────────────────────────────────────
  if (backendSearching) return (
    <div style={{ minHeight:"100vh", background:"#0a0a0a", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", fontFamily:"'Syne',sans-serif" }}>
      <div style={{ fontSize:13, color:"#4b5563", letterSpacing:3 }}>CONECTANDO AL SERVIDOR…</div>
      <div style={{ marginTop:16, width:180, height:3, background:"#1f2937", borderRadius:4, overflow:"hidden" }}>
        <div style={{ height:"100%", background:"#00ff88", borderRadius:4, animation:"loadbar 1.5s ease-in-out infinite" }} />
      </div>
      <style>{`@keyframes loadbar { 0%{width:0%} 60%{width:100%} 100%{width:100%} }`}</style>
    </div>
  );

  if (!backendUrl) return (
    <div style={{ minHeight:"100vh", background:"#0a0a0a", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", fontFamily:"'Syne',sans-serif", gap:12 }}>
      <div style={{ fontSize:20, color:"#f87171", fontWeight:800 }}>SIN CONEXIÓN AL SERVIDOR</div>
      <div style={{ fontSize:12, color:"#4b5563", letterSpacing:1, textAlign:"center", maxWidth:340 }}>
        Ningún backend respondió. Asegúrate de que Railway o Render estén activos, o corre <span style={{color:"#00ff88",fontFamily:"'DM Mono',monospace"}}>python backend.py</span> localmente.
      </div>
      <button onClick={() => { setBackendSearching(true); detectBackend().then(url => { BACKEND=url; setBackendUrl(url); setBackendSearching(false); }); }}
        style={{ marginTop:12, background:"#00ff88", color:"#0a0a0a", border:"none", borderRadius:10, padding:"12px 28px", fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:13, cursor:"pointer" }}>
        REINTENTAR
      </button>
    </div>
  );

  if (!authed) return <LoginScreen onAuth={() => setAuthed(true)} />;

  return (
    <div style={{
      fontFamily: "'Inter', sans-serif",
      background: "#edf2f9",
      minHeight: "100vh",
      width: "100%",
      color: "#1e293b",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Mono:ital,wght@0,300;0,400;0,500&family=DM+Sans:wght@300;400;500;600&display=swap');
        @keyframes spin      { to { transform: rotate(360deg); } }
        @keyframes fadeIn    { from { opacity:0; transform:translateY(6px); }  to { opacity:1; transform:translateY(0); } }
        @keyframes slideIn   { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
        @keyframes pulse     { 0%,100% { opacity:1; } 50% { opacity:0.35; } }
        @keyframes ticker    { from { transform:translateX(0); } to { transform:translateX(-50%); } }
        @keyframes countRing { from { stroke-dashoffset: 100; } to { stroke-dashoffset: 0; } }
        .mkt-card { transition: box-shadow 0.15s ease, border-color 0.15s ease; border: 1.5px solid #e0e0d8; }
        .mkt-card:hover { box-shadow: 4px 4px 0 #0a0a0a !important; border-color: #0a0a0a !important; }
        .mkt-card-up:hover   { background: linear-gradient(145deg,#f0fdf4,#f5f5f0) !important; }
        .mkt-card-down:hover { background: linear-gradient(145deg,#fef2f2,#f5f5f0) !important; }
        .news-card { transition: box-shadow 0.15s ease, border-color 0.15s ease; }
        .news-card:hover { box-shadow: 4px 4px 0 #0a0a0a !important; border-color: #0a0a0a !important; transform: none; }
        .tab-pill { transition: all 0.15s ease; }
        .btn-exec { transition: background 0.15s ease, color 0.15s ease; }
        .btn-exec:hover:not(:disabled) { background: #00ff88 !important; color: #0a0a0a !important; }
        html, body { margin: 0; padding: 0; background: #ffffff; font-family: 'DM Sans', system-ui, sans-serif; min-height: 100vh; }
        h1, h2, h3 { font-family: 'Syne', sans-serif; }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: #f5f5f0; }
        ::-webkit-scrollbar-thumb { background: #c0c0bc; border-radius: 3px; }
        input { outline: none; }
        input::placeholder { color: #94a3b8; }
        table { border-collapse: collapse; width: 100%; }
        th { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: #888888; padding: 10px 14px; text-align: left; border-bottom: 1px solid #e0e0d8; font-weight: 700; font-family: 'Syne', sans-serif; }
        td { padding: 11px 14px; font-size: 14px; border-bottom: 1px solid #e0e0d8; color: #475569; }
        tr:hover td { background: #f5f5f0; }
        .rebal-slider { -webkit-appearance: none; appearance: none; height: 3px; background: #e0e0d8; border-radius: 99px; outline: none; cursor: pointer; }
        .rebal-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 12px; height: 12px; background: #0a0a0a; border-radius: 50%; cursor: pointer; margin-top: -4.5px; }
        .rebal-slider::-webkit-slider-runnable-track { height: 3px; background: #e0e0d8; border-radius: 99px; }
        .rebal-slider::-moz-range-thumb { width: 12px; height: 12px; background: #0a0a0a; border-radius: 50%; cursor: pointer; border: none; }
        .rebal-slider::-moz-range-track { height: 3px; background: #e0e0d8; border-radius: 99px; }

        /* ── RESPONSIVE ── */
        .nav-tabs-scroll { display:flex; gap:4px; flex:1; justify-content:center; overflow-x:auto; scrollbar-width:none; }
        .nav-tabs-scroll::-webkit-scrollbar { display:none; }
        .nav-status { display:flex; align-items:center; gap:20px; flex-shrink:0; padding:18px 0; }

        @media (max-width: 1100px) and (min-width: 769px) {
          .nav-tabs-scroll button { padding: 7px 11px !important; font-size: 11px !important; }
        }
        .main-pad { padding: 16px 20px; animation: fadeIn 0.3s ease; }
        .resp-grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
        .resp-grid-3 { display:grid; grid-template-columns:repeat(3,1fr); gap:16px; }
        .table-scroll { overflow-x:auto; -webkit-overflow-scrolling:touch; }
        .bottom-nav { display:none; }
        .nav-active-label { display:none; }

        @media (max-width: 768px) {
          .nav-tabs-scroll { display:none; }
          .nav-status { display:none; }
          .nav-active-label {
            display:flex; align-items:center;
            background:#00ff88; color:#0a0a0a;
            border-radius:999px; padding:7px 16px;
            font-family:'Syne',sans-serif; font-weight:800; font-size:13px;
            white-space:nowrap; max-width:160px; overflow:hidden; text-overflow:ellipsis;
          }
          .bottom-nav {
            display:flex; position:fixed; bottom:0; left:0; right:0; z-index:200;
            background:#0a0a0a; border-top:1px solid #1f2937;
            overflow-x:auto; overflow-y:hidden;
            -webkit-overflow-scrolling:touch;
            scrollbar-width:none; padding:8px 6px;
            padding-bottom: max(8px, env(safe-area-inset-bottom));
          }
          .bottom-nav::-webkit-scrollbar { display:none; }
          .bottom-nav button { flex-shrink:0; }
          .main-pad { padding: 10px 10px; padding-bottom: 80px; }
          .resp-grid-2 { grid-template-columns: 1fr !important; }
          .resp-grid-3 { grid-template-columns: 1fr !important; }
          .resp-hide-mobile { display:none !important; }
          td, th { padding: 8px 10px; font-size:12px; }
          .hero-title { font-size:32px !important; }
          html, body { overflow-x:hidden; max-width:100vw; }

          /* Rebalanceo table — scroll horizontal */
          .rebal-table-wrap { overflow-x:auto; -webkit-overflow-scrolling:touch; }

          /* Noticias: StyleBox + GlobalMarkets stacked */
          .stylebox-wrap { grid-template-columns: 1fr !important; }

          /* Portfolio stock cards: 2 cols instead of 3 */
          .stock-metrics-grid { grid-template-columns: 1fr 1fr !important; }

          /* Analisis: metricas + ML side by side → stacked */
          .analisis-metrics-wrap { grid-template-columns: 1fr !important; }

          /* Analisis: metricas 4x2 → 2x4 */
          .analisis-kpis { grid-template-columns: repeat(2,1fr) !important; }

          /* Correlation matrix + optimizer table */
          .corr-matrix-wrap { overflow-x:auto; -webkit-overflow-scrolling:touch; }

          /* Screener auto-fill min → full width */
          .screener-grid { grid-template-columns: 1fr !important; }

          /* Fixed-width col → fluid */
          .stylebox-col-fixed { grid-template-columns: 1fr !important; }

          /* Bento grid de índices/commodities: 4 cols → 2 cols */
          .bento-grid { grid-template-columns: repeat(2, 1fr) !important; }

          /* Indicadores principales: 4 cols → 2 cols */
          .ind-grid { grid-template-columns: repeat(2, 1fr) !important; }

          /* Bento cards: texto más grande en mobile */
          .bento-grid .bento-val { font-size: 22px !important; }

          /* Portfolio y Screener cards: 1 columna en mobile */
          .portfolio-grid { grid-template-columns: 1fr !important; }
          .screener-cards { grid-template-columns: 1fr !important; }
        }
      `}</style>

      {/* Header + Tabs — unified bar */}
      <div style={{
        background: "#000000",
        position: "sticky", top: 0, zIndex: 100,
        boxShadow: "none",
        padding: "0 16px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 12,
      }}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0, padding: "18px 0" }}>
          <img
            src={kaizenLogo}
            style={{ height: 40, width: 40, objectFit: "contain", borderRadius: 8 }}
            alt="KAIZEN"
          />
          <div>
            <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 15, color: "#ffffff", letterSpacing: "0.05em" }}>KAIZEN</div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 9, color: "#555555", letterSpacing: "0.15em", textTransform: "uppercase" }}>Investment Group</div>
          </div>
        </div>

        {/* Tabs — pill style, centered */}
        <div className="nav-tabs-scroll">
          {[
            { id: "news",       label: "Noticias" },
            { id: "portfolio",  label: "Portfolio" },
            { id: "optimize",   label: "Sharpe Optimizer" },
            { id: "screener",   label: "ML Screener" },
            { id: "analytics",  label: "Analytics vs SPY" },
            { id: "fibras",     label: "FIBRA Screener" },
            { id: "magic",      label: "Fórmula Mágica" },
            { id: "analisis",   label: "Análisis" },
          ].map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              background: tab === t.id ? "#00ff88" : "transparent",
              border: "none", cursor: "pointer", borderRadius: 999,
              padding: "8px 18px", fontSize: 13,
              fontWeight: tab === t.id ? 700 : 500,
              color: tab === t.id ? "#0a0a0a" : "#888888",
              transition: "all 0.15s", letterSpacing: "0.01em",
              whiteSpace: "nowrap",
            }}>{t.label}</button>
          ))}
        </div>

        {/* Tab activo visible en móvil */}
        <div className="nav-active-label">
          {[
            { id:"news",label:"Noticias"},{id:"portfolio",label:"Portfolio"},
            {id:"optimize",label:"Sharpe"},{id:"screener",label:"ML Screener"},
            {id:"analytics",label:"Analytics"},
            {id:"fibras",label:"FIBRAs"},{id:"magic",label:"Fórmula Mágica"},
            {id:"analisis",label:"Análisis"},
          ].find(t=>t.id===tab)?.label}
        </div>

        {/* Right: status + RF */}
        <div className="nav-status">
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
            <div style={{
              width: 7, height: 7, borderRadius: "50%",
              background: backendOk === null ? "#bbbbbb" : backendOk ? "#16a34a" : "#dc2626",
              boxShadow: backendOk ? "0 0 6px #22c55e" : backendOk === false ? "0 0 6px #ef4444" : "none",
            }} />
            <span style={{ color: backendOk === null ? "#bbbbbb" : backendOk ? "#16a34a" : "#dc2626" }}>
              {backendOk === null ? "Conectando..." : backendOk ? "Backend OK" : "Sin conexión"}
            </span>
          </div>
          {rfRate !== null && (
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 9, color: "#bbbbbb", letterSpacing: "0.1em" }}>{rfLabel}</div>
              <div style={{ fontFamily: "'DM Mono', monospace", color: "#00cc6a", fontSize: 15, fontWeight: 700 }}>
                {(rfRate * 100).toFixed(2)}%
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom nav — solo móvil */}
      {(() => {
        const TABS = [
          { id:"news",label:"Noticias" },{ id:"portfolio",label:"Portfolio" },
          { id:"optimize",label:"Sharpe" },{ id:"screener",label:"ML Screener" },
          { id:"analytics",label:"Analytics" },
          { id:"fibras",label:"FIBRAs" },{ id:"magic",label:"Fórmula Mágica" },
          { id:"analisis",label:"Análisis" },
        ];
        return (
          <div className="bottom-nav">
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                background: tab===t.id ? "#00ff88" : "transparent",
                border:"none", cursor:"pointer", borderRadius:999,
                padding:"8px 16px", fontSize:12,
                fontWeight: tab===t.id ? 800 : 500,
                color: tab===t.id ? "#0a0a0a" : "#666666",
                whiteSpace:"nowrap",
              }}>{t.label}</button>
            ))}
          </div>
        );
      })()}

      {/* Macro strip */}
      {macroData && (
        <div style={{
          background: "#111111", padding: "7px 32px",
          display: "flex", gap: 0, alignItems: "center", flexWrap: "wrap",
          fontFamily: "'DM Mono', monospace", fontSize: 11,
        }}>
          {[
            {
              label: "VIX",
              val: macroData.vix?.value != null ? macroData.vix.value.toFixed(2) : null,
              chg: macroData.vix?.change,
              tooltip: macroData.vix?.value > 30 ? "Miedo extremo" : macroData.vix?.value > 20 ? "Volatilidad elevada" : "Mercado tranquilo",
            },
            {
              label: "SPREAD 10Y-2Y",
              val: macroData.spread?.value != null ? `${macroData.spread.value > 0 ? "+" : ""}${macroData.spread.value}` : null,
              chg: null,
              chgOverride: macroData.spread?.inverted ? "#f87171" : "#4ade80",
              tooltip: macroData.spread?.inverted ? "⚠ Curva invertida" : "Curva normal",
            },
            {
              label: "DXY",
              val: macroData.dxy?.value != null ? macroData.dxy.value.toFixed(2) : null,
              chg: macroData.dxy?.change,
              tooltip: "Índice del dólar USD",
            },
            {
              label: "10Y YIELD",
              val: macroData.t10y?.value != null ? `${macroData.t10y.value.toFixed(2)}%` : null,
              chg: macroData.t10y?.change,
              tooltip: "Bono del Tesoro 10 años",
            },
          ].filter(m => m.val != null).map((m, i, arr) => (
            <div key={m.label} title={m.tooltip} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: "#6b7280", fontWeight: 500 }}>{m.label}</span>
              <span style={{ color: "#ffffff", fontWeight: 700 }}>{m.val}</span>
              {m.chg != null && (
                <span style={{ color: m.chg >= 0 ? "#4ade80" : "#f87171", fontWeight: 600 }}>
                  {m.chg >= 0 ? "+" : ""}{m.chg.toFixed(2)}
                </span>
              )}
              {m.chgOverride && <span style={{ color: m.chgOverride, fontSize: 10 }}>●</span>}
              {i < arr.length - 1 && <span style={{ color: "#374151", margin: "0 10px" }}>·</span>}
            </div>
          ))}
          {macroData.spread?.inverted && (
            <span style={{ marginLeft: "auto", color: "#f87171", fontWeight: 700, fontSize: 10 }}>⚠ CURVA INVERTIDA</span>
          )}
        </div>
      )}

      {/* Content */}
      <div className="main-pad">

        {/* ─── TAB: PORTFOLIO ─── */}
        {tab === "portfolio" && (
          <div>
            {/* ── Selector de portafolios ── */}
            <div style={{
              background: "#ffffff", borderRadius: 24, boxShadow: "none", border: "1.5px solid #e0e0d8",
              padding: "14px 20px", marginBottom: 16,
              display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap"
            }}>
              <span style={{ fontSize: 10, color: "#bbbbbb", letterSpacing: "0.1em", fontWeight: 600, marginRight: 4 }}>PORTAFOLIO</span>

              {portfolios.map(p => (
                <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 0 }}>
                  {renamingId === p.id ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onBlur={() => {
                        if (renameValue.trim()) {
                          setPortfolios(prev => {
                            const next = prev.map(x => x.id === p.id ? { ...x, name: renameValue.trim() } : x);
                            savePortfolios(next);
                            return next;
                          });
                        }
                        setRenamingId(null);
                      }}
                      onKeyDown={e => { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") setRenamingId(null); }}
                      style={{
                        border: "1px solid #00ff88", borderRadius: 999, padding: "4px 12px",
                        fontSize: 13, fontWeight: 600, color: "#111111",
                        background: "#fff8f5", outline: "none", width: 120
                      }}
                    />
                  ) : (
                    <button
                      onClick={() => setActivePortfolioId(p.id)}
                      onDoubleClick={() => { setRenamingId(p.id); setRenameValue(p.name); }}
                      title="Doble clic para renombrar"
                      style={{
                        background: activePortfolioId === p.id
                          ? (p.experimental ? "#8b5cf6" : "#111111")
                          : "#f2f2f2",
                        color: activePortfolioId === p.id ? "#ffffff" : (p.experimental ? "#8b5cf6" : "#555555"),
                        border: p.experimental && activePortfolioId !== p.id ? "1.5px solid #c4b5fd" : "none",
                        borderRadius: 999, padding: "5px 14px",
                        fontSize: 13, fontWeight: activePortfolioId === p.id ? 700 : 500,
                        cursor: "pointer", transition: "all 0.15s"
                      }}
                    >{p.name}{p.experimental ? " ⚗" : ""}</button>
                  )}
                  <button
                    onClick={() => {
                      const id = "p" + Date.now();
                      const copy = { id, name: `Copia de ${p.name}`, positions: p.positions.map(x => ({ ...x })), experimental: p.experimental };
                      const next = [...portfolios, copy];
                      setPortfolios(next); savePortfolios(next);
                      setActivePortfolioId(id);
                    }}
                    title="Duplicar portafolio"
                    style={{ background: "none", border: "none", color: "#bbbbbb", cursor: "pointer", fontSize: 12, padding: "0 2px", lineHeight: 1 }}
                  >⧉</button>
                  {portfolios.length > 1 && (
                    <button
                      onClick={() => {
                        const next = portfolios.filter(x => x.id !== p.id);
                        setPortfolios(next); savePortfolios(next);
                        if (activePortfolioId === p.id) setActivePortfolioId(next[0].id);
                      }}
                      title="Eliminar portafolio"
                      style={{ background: "none", border: "none", color: "#bbbbbb", cursor: "pointer", fontSize: 14, padding: "0 2px", lineHeight: 1 }}
                    >×</button>
                  )}
                </div>
              ))}

              <button
                onClick={() => {
                  const id = "p" + Date.now();
                  const newP = { id, name: `Portafolio ${portfolios.length + 1}`, positions: [] };
                  const next = [...portfolios, newP];
                  setPortfolios(next); savePortfolios(next);
                  setActivePortfolioId(id);
                }}
                style={{
                  background: "none", border: "1px dashed #e5e5e5", borderRadius: 999,
                  color: "#bbbbbb", cursor: "pointer", padding: "4px 12px", fontSize: 13
                }}
              >+ Nuevo</button>

              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
                <button
                  onClick={toggleExperimental}
                  title={isExperimental ? "Desactivar modo experimental" : "Activar modo experimental: construye tu portafolio con monto + porcentajes"}
                  style={{
                    background: isExperimental ? "#8b5cf6" : "transparent",
                    border: `1.5px solid ${isExperimental ? "#8b5cf6" : "#e0d7ff"}`,
                    borderRadius: 999, color: isExperimental ? "#ffffff" : "#a78bfa",
                    cursor: "pointer", padding: "4px 16px", fontSize: 12, fontWeight: 600,
                    transition: "all 0.2s", letterSpacing: "0.02em"
                  }}
                >⚗ Experimental</button>
                <span style={{ fontSize: 10, color: "#cccccc", fontStyle: "italic" }}>doble clic para renombrar</span>
              </div>
            </div>

            {/* Add stock form — Modo Experimental */}
            {isExperimental ? (
              <div style={{
                background: "linear-gradient(135deg, #faf5ff 0%, #f0ebff 100%)",
                border: "1.5px solid #c4b5fd",
                borderRadius: 24, boxShadow: "0 4px 24px rgba(139,92,246,0.13)",
                padding: "20px 24px", marginBottom: 28
              }}>
                {/* Header: label + monto total + barra de % */}
                {(() => {
                  // % libre calculado SIEMPRE desde targetPcts (fuente de verdad en vivo)
                  const liveAllocated = portfolio.reduce((s, p) => s + (parseFloat(targetPcts[p.ticker]) || p.expPct || 0), 0);
                  const liveRemaining = Math.max(0, parseFloat((100 - liveAllocated).toFixed(2)));
                  return (
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 10, letterSpacing: "0.14em", fontWeight: 700, color: "#8b5cf6" }}>⚗ MODO EXPERIMENTAL</span>
                  <div style={{ flex: 1 }} />
                  <span style={{ fontSize: 10, color: "#a78bfa", letterSpacing: "0.06em", fontWeight: 600 }}>MONTO TOTAL</span>
                  <div style={{ position: "relative" }}>
                    <span style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: "#8b5cf6", fontWeight: 700, pointerEvents: "none" }}>$</span>
                    <input
                      value={expTotal > 0 ? expTotal : ""}
                      onChange={e => setExpTotalVal(e.target.value)}
                      placeholder="200000"
                      type="number"
                      style={{
                        width: 150, padding: "7px 10px 7px 24px",
                        fontFamily: "'DM Mono', monospace", fontSize: 15, fontWeight: 700,
                        color: "#6d28d9", background: "#ede9fe",
                        border: "1.5px solid #c4b5fd", borderRadius: 10, outline: "none", boxSizing: "border-box"
                      }}
                    />
                  </div>
                  <div style={{
                    fontFamily: "'DM Mono', monospace", fontSize: 12, fontWeight: 700,
                    padding: "6px 14px", borderRadius: 999,
                    background: liveRemaining > 0.01 ? "#ede9fe" : "#fef2f2",
                    color: liveRemaining > 0.01 ? "#7c3aed" : "#dc2626",
                    border: `1.5px solid ${liveRemaining > 0.01 ? "#c4b5fd" : "#fca5a5"}`,
                    transition: "all 0.2s"
                  }}>
                    {liveRemaining.toFixed(1)}% libre
                  </div>
                  {/* Barra de progreso */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <div style={{ width: 140, height: 7, background: "#e9d5ff", borderRadius: 99, overflow: "hidden" }}>
                      <div style={{
                        width: `${Math.min(100, liveAllocated)}%`, height: "100%",
                        background: liveAllocated >= 99.5 ? "#16a34a" : liveAllocated > 90 ? "#00ff88" : "#8b5cf6",
                        borderRadius: 99, transition: "width 0.35s ease"
                      }} />
                    </div>
                    <div style={{ fontSize: 9, color: "#a78bfa", textAlign: "right", fontFamily: "'DM Mono', monospace" }}>
                      {liveAllocated.toFixed(1)}% asignado
                    </div>
                  </div>
                </div>
                  );
                })()}

                {/* Form row */}
                {(() => {
                  const liveAllocatedForm = portfolio.reduce((s, p) => s + (parseFloat(targetPcts[p.ticker]) || p.expPct || 0), 0);
                  const liveRemainingForm = Math.max(0, parseFloat((100 - liveAllocatedForm).toFixed(2)));
                  return (
                <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: 10, color: "#a78bfa", letterSpacing: "0.08em", marginBottom: 6, fontWeight: 600 }}>TICKER</div>
                    <input value={newTicker} onChange={e => setNewTicker(e.target.value.toUpperCase())}
                      placeholder="AAPL / WALMEX.MX"
                      onKeyDown={e => e.key === "Enter" && addStock()}
                      style={{
                        background: "#ede9fe", border: "1.5px solid #c4b5fd", borderRadius: 10,
                        color: "#6d28d9", padding: "8px 14px", fontSize: 13, width: 160,
                        fontFamily: "'DM Mono', monospace", outline: "none"
                      }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "#a78bfa", letterSpacing: "0.08em", marginBottom: 6, fontWeight: 600 }}>% ASIGNACIÓN</div>
                    <div style={{ position: "relative" }}>
                      <input value={newPct} onChange={e => setNewPct(e.target.value)}
                        placeholder={`máx ${liveRemainingForm.toFixed(1)}`}
                        type="number" step="any" min="0.01" max={liveRemainingForm}
                        onKeyDown={e => e.key === "Enter" && addStock()}
                        style={{
                          background: "#ede9fe", border: "1.5px solid #c4b5fd", borderRadius: 10,
                          color: "#6d28d9", padding: "8px 34px 8px 14px", fontSize: 13, width: 150, outline: "none",
                          boxSizing: "border-box"
                        }} />
                      <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: "#8b5cf6", fontWeight: 700, fontSize: 14 }}>%</span>
                    </div>
                    {(() => {
                      const pct = parseFloat(newPct);
                      const ticker = newTicker.toUpperCase().trim();
                      const price = stockData[ticker]?.price;
                      if (pct > 0 && expTotal > 0 && price) {
                        const priceMXN_ = toMXN(ticker, price);
                        const sharesCalc = (pct / 100 * expTotal) / priceMXN_;
                        const val = pct / 100 * expTotal;
                        const cur = ticker.endsWith('.MX') ? 'MXN' : 'USD';
                        return <div style={{ fontSize: 10, color: "#8b5cf6", marginTop: 4, fontFamily: "'DM Mono', monospace" }}>≈ {sharesCalc.toFixed(4)} acc · ${val.toLocaleString("en-US", { maximumFractionDigits: 0 })} MXN · precio ${cur === 'USD' ? price.toFixed(2) + ' USD' : price.toFixed(2) + ' MXN'}</div>;
                      }
                      if (pct > 0 && !expTotal) return <div style={{ fontSize: 10, color: "#dc2626", marginTop: 4 }}>Define el monto total primero</div>;
                      return null;
                    })()}
                  </div>
                  <button onClick={addStock}
                    disabled={liveRemainingForm <= 0.01}
                    style={{
                      background: liveRemainingForm > 0.01 ? "#8b5cf6" : "#ede9fe",
                      border: "none", borderRadius: 999,
                      color: liveRemainingForm > 0.01 ? "#fff" : "#c4b5fd",
                      padding: "9px 26px", cursor: liveRemainingForm > 0.01 ? "pointer" : "not-allowed",
                      fontSize: 13, fontWeight: 700, letterSpacing: "0.04em", transition: "all 0.15s"
                    }}>+ Agregar</button>
                  <button onClick={async () => {
                      // Recalcular shares desde targetPcts + expTotal al actualizar precios
                      for (const p of portfolio) { await loadStockData(p.ticker); await sleep(400); }
                      if (expTotal > 0) {
                        setPortfolio(prev => prev.map(pos => {
                          const pct = parseFloat(targetPcts[pos.ticker]) || pos.expPct || 0;
                          const price = stockData[pos.ticker]?.price;
                          if (!price || pct <= 0) return pos;
                          const pMXN = toMXN(pos.ticker, price);
                          return { ...pos, shares: +((pct / 100 * expTotal / pMXN).toFixed(6)), expPct: pct };
                        }));
                      }
                    }}
                    style={{
                      background: "#ede9fe", border: "none", borderRadius: 999,
                      color: "#8b5cf6", padding: "9px 20px", cursor: "pointer", fontSize: 13, fontWeight: 600
                    }}>↻ Recalcular</button>
                </div>
                  );
                })()}
                {addError && (
                  <div style={{ marginTop: 12, fontSize: 12, color: "#dc2626", display: "flex", alignItems: "center", gap: 6 }}>
                    ⚠ {addError}
                  </div>
                )}
              </div>
            ) : (
              /* Add stock form — Modo Normal */
              <div style={{
                background: "#ffffff", borderRadius: 24, boxShadow: "none", border: "1.5px solid #e0e0d8",
                padding: 20, marginBottom: 28, display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap"
              }}>
                <div>
                  <div style={{ fontSize: 10, color: "#999999", letterSpacing: "0.08em", marginBottom: 6 }}>TICKER</div>
                  <input value={newTicker} onChange={(e) => setNewTicker(e.target.value.toUpperCase())}
                    placeholder="AAPL / WALMEX.MX"
                    onKeyDown={e => e.key === "Enter" && addStock()}
                    style={{
                      background: "#f8f8f8", border: "1px solid #e5e5e5", borderRadius: 10,
                      color: "#111111", padding: "8px 14px", fontSize: 13, width: 160,
                      fontFamily: "'DM Mono', monospace", outline: "none"
                    }} />
                </div>
                {/* Toggle modo + input acciones / % */}
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    <div style={{ fontSize: 10, color: "#999999", letterSpacing: "0.08em", fontWeight: 600 }}>
                      {inputMode === "shares" ? "ACCIONES" : "% DEL PORTAFOLIO"}
                    </div>
                    <div style={{ display: "flex", background: "#f2f2f2", borderRadius: 999, padding: 2, gap: 0 }}>
                      {[["shares","#"], ["pct","%"]].map(([m, lbl]) => (
                        <button key={m} onClick={() => setInputMode(m)} style={{
                          background: inputMode === m ? "#111111" : "transparent",
                          color: inputMode === m ? "#ffffff" : "#999999",
                          border: "none", borderRadius: 999, padding: "2px 9px",
                          fontSize: 11, fontWeight: 700, cursor: "pointer", transition: "all 0.15s"
                        }}>{lbl}</button>
                      ))}
                    </div>
                  </div>
                  {inputMode === "shares" ? (
                    <input value={newShares} onChange={(e) => setNewShares(e.target.value)}
                      placeholder="0 (decimal OK)" type="number" step="any"
                      onKeyDown={e => e.key === "Enter" && addStock()}
                      style={{ background: "#f8f8f8", border: "1px solid #e5e5e5", borderRadius: 10, color: "#111111", padding: "8px 14px", fontSize: 13, width: 130, outline: "none" }} />
                  ) : (
                    <div style={{ position: "relative" }}>
                      <input value={newPct} onChange={(e) => setNewPct(e.target.value)}
                        placeholder="20.5" type="number" step="any" min="0.01" max="100"
                        onKeyDown={e => e.key === "Enter" && addStock()}
                        style={{ background: "#fff7ed", border: "1px solid #00ff88", borderRadius: 10, color: "#111111", padding: "8px 32px 8px 14px", fontSize: 13, width: 130, outline: "none" }} />
                      <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: "#00cc6a", fontWeight: 700, fontSize: 14 }}>%</span>
                      {(() => {
                        const pct = parseFloat(newPct);
                        const ticker = newTicker.toUpperCase().trim();
                        const price = stockData[ticker]?.price;
                        const totalValue = portfolio.reduce((s, p) => s + posVal(p), 0);
                        if (pct > 0 && price && totalValue > 0) {
                          const sharesCalc = (pct / 100 * totalValue) / toMXN(ticker, price);
                          return <div style={{ fontSize: 10, color: "#00cc6a", marginTop: 4 }}>≈ {sharesCalc.toFixed(4)} acciones</div>;
                        }
                        return <div style={{ fontSize: 10, color: "#bbbbbb", marginTop: 4 }}>Carga el ticker primero</div>;
                      })()}
                    </div>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#999999", letterSpacing: "0.08em", marginBottom: 6 }}>COSTO PROMEDIO</div>
                  <input value={newCost} onChange={(e) => setNewCost(e.target.value)}
                    placeholder="0.00" type="number"
                    style={{ background: "#f8f8f8", border: "1px solid #e5e5e5", borderRadius: 10, color: "#111111", padding: "8px 14px", fontSize: 13, width: 120, outline: "none" }} />
                </div>
                <button onClick={addStock} style={{
                  background: "#111111", border: "none",
                  borderRadius: 999, color: "#fff", padding: "9px 24px", cursor: "pointer",
                  fontSize: 13, fontWeight: 600, letterSpacing: "0.04em"
                }}>+ Agregar</button>
                <button onClick={async () => {
                  for (const p of portfolio) { await loadStockData(p.ticker); await sleep(400); }
                }} style={{
                  background: "#f2f2f2", border: "none", borderRadius: 999,
                  color: "#666666", padding: "9px 20px", cursor: "pointer", fontSize: 13
                }}>↻ Actualizar</button>
                {addError && (
                  <div style={{ marginTop: 8, fontSize: 12, color: "#dc2626", display: "flex", alignItems: "center", gap: 6, width: "100%" }}>
                    ⚠ {addError}
                  </div>
                )}
              </div>
            )}

            {/* Portfolio Summary + Pie Chart — arriba */}
            {Object.keys(stockData).length > 0 && (() => {
              let totalValue = 0, totalCost = 0;
              const slices = [];
              const COLORS = ["#111111","#555555","#888888","#aaaaaa","#cccccc","#333333","#777777","#bbbbbb","#444444","#999999","#666666","#dddddd"];
              portfolio.forEach((p, i) => {
                const actualVal = posVal(p);
                totalValue += actualVal;
                totalCost += posCost(p);
                // En modo experimental: el donut muestra los % objetivo (targetPcts/expPct), no el valor real
                const donutVal = isExperimental
                  ? (parseFloat(targetPcts[p.ticker]) || p.expPct || 0)
                  : actualVal;
                slices.push({ ticker: p.ticker, value: donutVal, colorIdx: i });
              });
              // Sort descending so the biggest slice gets the accent color
              slices.sort((a, b) => b.value - a.value);
              const accentColor = isExperimental ? "#8b5cf6" : "#00ff88";
              slices.forEach((s, i) => { s.color = i === 0 ? accentColor : COLORS[(i - 1) % COLORS.length]; });
              const totalPnl = totalValue - totalCost;
              const totalPnlPct = totalCost ? (totalPnl / totalCost) * 100 : 0;

              // Métricas ponderadas por valor de posición
              const wMetric = (key) => {
                let sum = 0, wSum = 0;
                portfolio.forEach((p) => {
                  const sd = stockData[p.ticker];
                  const val = posVal(p);
                  const v = sd?.[key];
                  if (v != null && isFinite(v) && val > 0) { sum += v * val; wSum += val; }
                });
                return wSum > 0 ? +(sum / wSum).toFixed(2) : null;
              };
              const wPE   = wMetric("pe");
              const wPEG  = wMetric("peg");
              const wPEGY = wMetric("pegy");
              const wEVEB = wMetric("evEbitda");
              const wPB   = wMetric("pb");
              const wROE  = wMetric("roe");
              const wMgn  = wMetric("profitMargin");
              const wDE   = wMetric("debtEquity");
              const wBeta = wMetric("beta");
              const wRevG = wMetric("revenueGrowth");

              const approxSharpe = portfolioSharpeExact;
              const sharpeColor = approxSharpe === null ? "#666666"
                : approxSharpe >= 1 ? "#16a34a" : approxSharpe >= 0.5 ? "#eab308" : "#dc2626";

              const StatRow = ({ label, value, color, sub }) => (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: "1px solid #f2f2f2" }}>
                  <div>
                    <div style={{ fontSize: 11, color: "#bbbbbb", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 500 }}>{label}</div>
                    {sub && <div style={{ fontSize: 10, color: "#cccccc", marginTop: 2 }}>{sub}</div>}
                  </div>
                  <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 18, fontWeight: 700, color: color || "#111111" }}>{value ?? "—"}</div>
                </div>
              );

              const R = 110, CX = 130, CY = 130;
              let cumAngle = -Math.PI / 2;
              // En modo experimental los slices son % (0-100); en normal son valores MXN
              const donutDenom = isExperimental
                ? slices.reduce((s, x) => s + x.value, 0) || 100
                : totalValue || 1;
              const paths = slices.filter(s => s.value > 0).map((s) => {
                const pct = s.value / donutDenom;
                const angle = pct * 2 * Math.PI;
                const startAngle = cumAngle;
                const x1 = CX + R * Math.cos(cumAngle);
                const y1 = CY + R * Math.sin(cumAngle);
                cumAngle += angle;
                const x2 = CX + R * Math.cos(cumAngle);
                const y2 = CY + R * Math.sin(cumAngle);
                const large = angle > Math.PI ? 1 : 0;
                const midAngle = startAngle + angle / 2;
                const tx = Math.cos(midAngle) * 9;
                const ty = Math.sin(midAngle) * 9;
                return { path: `M${CX},${CY} L${x1.toFixed(2)},${y1.toFixed(2)} A${R},${R} 0 ${large},1 ${x2.toFixed(2)},${y2.toFixed(2)} Z`, color: s.color, pct, ticker: s.ticker, tx, ty };
              });
              return (
                <div style={{ marginBottom: 28, display: "flex", flexDirection: "column", gap: 16 }}>

                  {/* Pie + Rebalanceo */}
                  {(() => {
                    const tSum    = paths.reduce((s, p) => s + (parseFloat(targetPcts[p.ticker]) || 0), 0);
                    const tSumOk  = Math.abs(tSum - 100) < 0.5;
                    const effTotal = parseFloat(customTotal) > 0 ? parseFloat(customTotal) : totalValue;
                    const fmt = (n) => n >= 1000 ? n.toFixed(1) : n >= 10 ? n.toFixed(2) : n >= 1 ? n.toFixed(3) : n.toFixed(4);
                    return (
                  <div className="resp-grid-2" style={{ alignItems: "start" }}>

                    {/* ── Donut — siempre usa pesos reales ── */}
                    <div style={{ background: "#ffffff", borderRadius: 24, boxShadow: "none", border: "1.5px solid #e0e0d8", padding: "24px 20px 20px" }}>
                      <div style={{ fontSize: 10, color: "#bbbbbb", letterSpacing: "0.14em", fontWeight: 600, marginBottom: 16 }}>COMPOSICIÓN DEL PORTAFOLIO</div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", position: "relative" }}>
                        {/* Tooltip hover */}
                        {hoveredTicker && (() => {
                          const hp = paths.find(x => x.ticker === hoveredTicker);
                          const sd = stockData[hoveredTicker];
                          const pos = portfolio.find(x => x.ticker === hoveredTicker);
                          const val = pos ? posVal(pos) : null;
                          if (!hp) return null;
                          return (
                            <div style={{
                              position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)",
                              background: "#111111", color: "#ffffff", borderRadius: 8, padding: "6px 14px",
                              fontSize: 11, fontFamily: "'DM Mono', monospace", pointerEvents: "none",
                              zIndex: 10, whiteSpace: "nowrap", boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
                              letterSpacing: "0.04em"
                            }}>
                              <span style={{ color: hp.color === accentColor ? accentColor : "#aaaaaa" }}>●</span>{" "}
                              <b>{hoveredTicker}</b>{" · "}{(hp.pct * 100).toFixed(1)}%
                              {val != null && <span style={{ color: "#aaaaaa" }}>{" · "}${val.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>}
                            </div>
                          );
                        })()}
                        <svg width="100%" viewBox="0 0 260 260" style={{ display: "block", maxWidth: 360 }}>
                          {paths.map((p, i) => (
                            <path
                              key={i}
                              d={p.path}
                              fill={p.color}
                              stroke="#ffffff"
                              strokeWidth="3"
                              style={{
                                transform: hoveredTicker === p.ticker ? `translate(${p.tx}px, ${p.ty}px)` : "translate(0,0)",
                                transition: "transform 0.18s ease, opacity 0.15s ease",
                                opacity: hoveredTicker && hoveredTicker !== p.ticker ? 0.45 : 1,
                                cursor: "pointer"
                              }}
                              onMouseEnter={() => setHoveredTicker(p.ticker)}
                              onMouseLeave={() => setHoveredTicker(null)}
                            />
                          ))}
                          <circle cx={CX} cy={CY} r={R * 0.48} fill="#ffffff" style={{ pointerEvents: "none" }} />
                          {hoveredTicker ? (() => {
                            const hp = paths.find(x => x.ticker === hoveredTicker);
                            return hp ? <>
                              <text x={CX} y={CY - 10} textAnchor="middle" fill={hp.color === accentColor ? accentColor : "#555555"} fontSize="13" fontFamily="monospace" fontWeight="bold">{hoveredTicker}</text>
                              <text x={CX} y={CY + 12} textAnchor="middle" fill="#111111" fontSize="22" fontWeight="bold" fontFamily="monospace">{(hp.pct * 100).toFixed(1)}%</text>
                            </> : null;
                          })() : <>
                            <text x={CX} y={CY - 10} textAnchor="middle" fill="#bbbbbb" fontSize="10" fontFamily="monospace" letterSpacing="1">{isExperimental ? "PRESUPUESTO" : "TOTAL"}</text>
                            <text x={CX} y={CY + 12} textAnchor="middle" fill={isExperimental ? "#8b5cf6" : "#111111"} fontSize="20" fontWeight="bold" fontFamily="monospace">${((isExperimental && expTotal > 0 ? expTotal : totalValue) / 1000).toFixed(1)}k</text>
                          </>}
                        </svg>
                      </div>
                      {/* Leyenda interactiva */}
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, marginTop: 12, width: "100%" }}>
                          {paths.map(p => (
                            <div
                              key={p.ticker}
                              style={{
                                display: "flex", alignItems: "center", gap: 7,
                                padding: "6px 10px", borderRadius: 8, cursor: "pointer",
                                background: hoveredTicker === p.ticker ? (p.color === accentColor ? (isExperimental ? "#ede9fe" : "#fff7ed") : "#f5f5f5") : "transparent",
                                opacity: hoveredTicker && hoveredTicker !== p.ticker ? 0.35 : 1,
                                transition: "all 0.15s"
                              }}
                              onMouseEnter={() => setHoveredTicker(p.ticker)}
                              onMouseLeave={() => setHoveredTicker(null)}
                            >
                              <div style={{ width: 10, height: 10, borderRadius: 3, background: p.color, flexShrink: 0 }} />
                              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11.5, color: p.color === accentColor ? accentColor : "#333", fontWeight: p.color === accentColor ? 700 : 500, flex: 1 }}>{p.ticker}</span>
                              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11.5, color: "#888", fontWeight: 600 }}>{(p.pct * 100).toFixed(1)}%</span>
                            </div>
                          ))}
                        </div>

                      {/* Sharpe Individual dentro del panel izquierdo */}
                      {Object.keys(sharpeData).length > 0 && (
                        <div style={{ marginTop: 20, borderTop: "1px solid #f0f0ea", paddingTop: 16 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                            <div style={{ fontSize: 10, color: "#bbbbbb", letterSpacing: "0.12em", fontWeight: 600 }}>SHARPE INDIVIDUAL · 1A</div>
                            <div style={{ fontSize: 9, color: "#cccccc" }}>≥1.0 exc · 0.5–1.0 bueno</div>
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                            {portfolio
                              .filter(p => sharpeData[p.ticker] !== undefined)
                              .sort((a, b) => (sharpeData[b.ticker] ?? -99) - (sharpeData[a.ticker] ?? -99))
                              .map(p => {
                                const s = sharpeData[p.ticker];
                                const color = s >= 1 ? "#16a34a" : s >= 0.5 ? "#eab308" : s >= 0 ? "#00ff88" : "#dc2626";
                                const barW = Math.min(Math.max((s / 2) * 100, 0), 100);
                                const sd = stockData[p.ticker];
                                return (
                                  <div key={p.ticker}>
                                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                        <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11.5, fontWeight: 700, color: "#111" }}>{p.ticker}</span>
                                        <span style={{ fontSize: 10, color: "#bbb", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>{sd?.name ?? ""}</span>
                                      </div>
                                      <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, fontWeight: 700, color }}>{s >= 0 ? "+" : ""}{s}</span>
                                    </div>
                                    <div style={{ background: "#f2f2f2", borderRadius: 99, height: 6, overflow: "hidden" }}>
                                      <div style={{ width: `${barW}%`, height: "100%", background: color, borderRadius: 99, transition: "width 0.6s ease" }} />
                                    </div>
                                  </div>
                                );
                              })}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* ── Tabla de rebalanceo ── */}
                    <div style={{ background: "#ffffff", borderRadius: 24, boxShadow: "none", border: "1.5px solid #e0e0d8", padding: "28px 24px 24px", minWidth: 0 }}>
                      {/* Header */}
                      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 10, color: "#bbbbbb", letterSpacing: "0.14em", fontWeight: 600 }}>REBALANCEO</span>
                        <span style={{ fontSize: 10, color: "#6b7280", background: "#f5f5f5", borderRadius: 999, padding: "2px 8px" }}>
                          USD/MXN {usdMxn.toFixed(2)}
                        </span>
                        <div style={{ flex: 1 }} />
                        {/* Monto total */}
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 10, color: "#aaa", whiteSpace: "nowrap" }}>MONTO TOTAL</span>
                          <div style={{ position: "relative" }}>
                            <span style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: "#888", pointerEvents: "none" }}>$</span>
                            <input value={customTotal} onChange={e => setCustomTotal(e.target.value)}
                              placeholder={totalValue.toFixed(0)} type="number" step="1000" min="0"
                              style={{
                                width: 120, padding: "6px 8px 6px 20px",
                                fontFamily: "'DM Mono', monospace", fontSize: 13, fontWeight: 700,
                                color: parseFloat(customTotal) > 0 ? "#00ff88" : "#111",
                                background: parseFloat(customTotal) > 0 ? "#fff7ed" : "#f5f5f5",
                                border: `1.5px solid ${parseFloat(customTotal) > 0 ? "#00ff88" : "#e5e5e5"}`,
                                borderRadius: 8, outline: "none", boxSizing: "border-box"
                              }} />
                          </div>
                          {parseFloat(customTotal) > 0 && (
                            <button onClick={() => setCustomTotal("")} style={{ background: "none", border: "none", color: "#ccc", cursor: "pointer", fontSize: 16, padding: 0 }}>×</button>
                          )}
                        </div>
                        {/* Σ badge */}
                        <div style={{
                          fontFamily: "'DM Mono', monospace", fontSize: 11, fontWeight: 700,
                          color: tSumOk ? "#16a34a" : "#dc2626",
                          background: tSumOk ? "#f0fdf4" : "#fef2f2",
                          padding: "4px 10px", borderRadius: 999, whiteSpace: "nowrap"
                        }}>Σ {tSum.toFixed(1)}% {tSumOk ? "✓" : "✗"}</div>
                      </div>

                      {/* Métricas resumen */}
                      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
                        {[
                          { label: isExperimental ? "Presupuesto exp." : "Valor total · MXN",
                            value: `$${(isExperimental && expTotal > 0 ? expTotal : totalValue).toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
                            color: isExperimental ? "#8b5cf6" : "#ffffff",
                            sub: isExperimental && expTotal > 0 ? `≈ USD $${(expTotal / usdMxn).toLocaleString("en-US", { maximumFractionDigits: 0 })}` : `≈ USD $${(totalValue / usdMxn).toLocaleString("en-US", { maximumFractionDigits: 0 })}` },
                          { label: "Costo total · MXN",  value: `$${totalCost.toLocaleString("en-US",  { maximumFractionDigits: 0 })}`, color: "#ffffff", sub: `≈ USD $${(totalCost / usdMxn).toLocaleString("en-US", { maximumFractionDigits: 0 })}` },
                          { label: "P&L ($)",      value: `${totalPnl >= 0 ? "+" : "−"}$${Math.abs(totalPnl).toLocaleString("en-US", { maximumFractionDigits: 0 })}`, color: totalPnl >= 0 ? "#00ff88" : "#ff3b3b", sub: `≈ USD ${totalPnl >= 0 ? "+" : "−"}$${Math.abs(totalPnl / usdMxn).toLocaleString("en-US", { maximumFractionDigits: 0 })}` },
                          { label: "P&L (%)",      value: `${totalPnlPct >= 0 ? "+" : ""}${totalPnlPct.toFixed(2)}%`, color: totalPnl >= 0 ? "#00ff88" : "#ff3b3b" },
                          { label: "Sharpe · 1y",  value: approxSharpe ?? "—", color: "#ffffff", sub: "cov. completa" },
                        ].map((m) => (
                          <div key={m.label} style={{
                            flex: 1, padding: "20px 24px",
                            background: "#0a0a0a", borderRadius: 20,
                            minWidth: 120,
                          }}>
                            <div style={{ fontSize: 9, color: "#666666", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6, fontFamily: "'DM Sans', sans-serif" }}>{m.label}</div>
                            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 24, fontWeight: 500, color: m.color, lineHeight: 1 }}>{m.value}</div>
                            {m.sub && <div style={{ fontSize: 9, color: "#444444", marginTop: 4 }}>{m.sub}</div>}
                          </div>
                        ))}
                      </div>

                      {/* Encabezados tabla */}
                      <div className="rebal-table-wrap">
                      <div style={{
                        display: "grid",
                        gridTemplateColumns: "10px minmax(90px,1fr) 130px 110px 90px",
                        gap: "0 16px", alignItems: "center",
                        padding: "12px 20px",
                        borderBottom: "2px solid #0a0a0a", marginBottom: 4
                      }}>
                        <div />
                        <div style={{ fontSize: 9, color: "#888888", letterSpacing: "0.15em", textTransform: "uppercase", fontFamily: "'Syne', sans-serif", fontWeight: 700 }}>Activo</div>
                        <div style={{ fontSize: 9, color: "#888888", letterSpacing: "0.15em", textTransform: "uppercase", textAlign: "center", fontFamily: "'Syne', sans-serif", fontWeight: 700 }}>% objetivo</div>
                        <div style={{ fontSize: 9, color: "#888888", letterSpacing: "0.15em", textTransform: "uppercase", textAlign: "right", fontFamily: "'Syne', sans-serif", fontWeight: 700 }}>Acciones</div>
                        <div style={{ fontSize: 9, color: "#888888", letterSpacing: "0.15em", textTransform: "uppercase", textAlign: "right", fontFamily: "'Syne', sans-serif", fontWeight: 700 }}>Δ acciones</div>
                      </div>

                      {/* Filas */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                        {paths.map((p, pi) => {
                          const rawVal = targetPcts[p.ticker] ?? (p.pct * 100).toFixed(1);
                          const tPct   = parseFloat(rawVal) || 0;
                          const price  = stockData[p.ticker]?.price;
                          const priceMXN = price ? toMXN(p.ticker, price) : null;
                          const tShares = effTotal > 0 && priceMXN ? (tPct / 100 * effTotal) / priceMXN : null;
                          const currentShares = portfolio.find(x => x.ticker === p.ticker)?.shares ?? 0;
                          const delta = tShares !== null ? tShares - currentShares : null;
                          const isTop = p.color === accentColor;
                          const isHovered = hoveredTicker === p.ticker;
                          const currentPct = p.pct * 100;
                          const topBg = isExperimental ? "#f5f3ff" : "#fff8f5";
                          const topBgHover = isExperimental ? "#ede9fe" : "#fff3ea";
                          return (
                            <div
                              key={p.ticker}
                              onMouseEnter={() => setHoveredTicker(p.ticker)}
                              onMouseLeave={() => setHoveredTicker(null)}
                              style={{
                                padding: "14px 20px",
                                background: pi % 2 === 0 ? "#ffffff" : "#f5f5f0",
                                borderBottom: "1px solid #f0f0eb",
                                transition: "background 0.15s",
                                opacity: hoveredTicker && !isHovered ? 0.55 : 1,
                              }}
                            >
                              <div style={{
                                display: "grid",
                                gridTemplateColumns: "10px minmax(90px,1fr) 130px 110px 90px",
                                gap: "0 16px", alignItems: "center",
                              }}>
                                <div style={{ width: 10, height: 10, borderRadius: 2, background: p.color, flexShrink: 0 }} />
                                <div style={{ display: "flex", alignItems: "center", gap: 5, overflow: "hidden" }}>
                                  <span style={{
                                    fontFamily: "'Syne', sans-serif",
                                    color: "#0a0a0a",
                                    fontSize: 13, fontWeight: 700,
                                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
                                  }}>{p.ticker}</span>
                                  {(() => {
                                    const cur = p.ticker.endsWith('.MX') ? 'MXN' : 'USD';
                                    return <span style={{ fontSize: 9, color: cur === 'USD' ? '#3b82f6' : '#16a34a', background: cur === 'USD' ? '#eff6ff' : '#f0fdf4', borderRadius: 999, padding: '1px 5px', fontWeight: 700, flexShrink: 0 }}>{cur}</span>;
                                  })()}
                                </div>

                                {/* Input % + slider */}
                                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                                  <div style={{ position: "relative" }}>
                                    <input
                                      value={rawVal}
                                      onChange={e => setTargetPcts(prev => ({ ...prev, [p.ticker]: e.target.value }))}
                                      onBlur={e => {
                                        if (isExperimental) {
                                          const v = parseFloat(e.target.value) || 0;
                                          setPortfolio(prev => prev.map(pos => pos.ticker === p.ticker ? { ...pos, expPct: v } : pos));
                                        }
                                      }}
                                      type="number" step="0.1" min="0" max="100"
                                      style={{
                                        width: "100%", padding: "5px 20px 5px 8px",
                                        fontFamily: "'DM Mono', monospace", fontSize: 13, fontWeight: 700,
                                        color: isTop ? accentColor : "#111111",
                                        background: isTop ? (isExperimental ? "#ede9fe" : "#fff0e6") : "#f0f0f0",
                                        border: `1.5px solid ${isTop ? accentColor : isHovered ? "#cccccc" : "#e8e8e8"}`,
                                        borderRadius: 8, outline: "none", textAlign: "right",
                                        boxSizing: "border-box", transition: "border-color 0.15s"
                                      }}
                                    />
                                    <span style={{ position: "absolute", right: 7, top: "50%", transform: "translateY(-50%)", fontSize: 10, color: "#bbb", pointerEvents: "none" }}>%</span>
                                  </div>
                                  {/* Slider */}
                                  <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
                                    <input
                                      type="range"
                                      min={0} max={100} step={0.1}
                                      value={tPct}
                                      onChange={e => setTargetPcts(prev => ({ ...prev, [p.ticker]: e.target.value }))}
                                      onMouseUp={e => {
                                        if (isExperimental) {
                                          const v = parseFloat(e.target.value) || 0;
                                          setPortfolio(prev => prev.map(pos => pos.ticker === p.ticker ? { ...pos, expPct: v } : pos));
                                        }
                                      }}
                                      onTouchEnd={e => {
                                        if (isExperimental) {
                                          const v = parseFloat(e.target.value) || 0;
                                          setPortfolio(prev => prev.map(pos => pos.ticker === p.ticker ? { ...pos, expPct: v } : pos));
                                        }
                                      }}
                                      style={{
                                        flex: 1,
                                        height: 6,
                                        appearance: "none",
                                        WebkitAppearance: "none",
                                        background: `linear-gradient(to right, ${isExperimental ? "#8b5cf6" : "#00ff88"} ${tPct}%, #e0e0d8 ${tPct}%)`,
                                        borderRadius: 999,
                                        outline: "none",
                                        border: "none",
                                        cursor: "pointer",
                                      }}
                                    />
                                    <span style={{
                                      fontFamily: "'DM Mono', monospace",
                                      fontSize: 12, fontWeight: 700,
                                      color: "#0a0a0a", minWidth: 45,
                                      textAlign: "right",
                                    }}>{tPct.toFixed(1)}%</span>
                                  </div>
                                </div>

                                {/* Acciones objetivo */}
                                <div style={{ textAlign: "right" }}>
                                  {tShares !== null ? (
                                    <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: "#333" }}>
                                      {fmt(tShares)}
                                    </span>
                                  ) : <span style={{ color: "#ccc", fontSize: 11 }}>—</span>}
                                </div>

                                {/* Delta */}
                                <div style={{ textAlign: "right" }}>
                                  {delta !== null && Math.abs(delta) >= 0.0001 ? (
                                    <span style={{
                                      fontFamily: "'DM Mono', monospace", fontSize: 12, fontWeight: 700,
                                      color: delta > 0 ? "#00cc6a" : "#ff3b3b"
                                    }}>
                                      {delta > 0 ? "+" : ""}{fmt(Math.abs(delta))}
                                    </span>
                                  ) : <span style={{ color: "#ddd", fontSize: 11 }}>—</span>}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      </div>{/* /rebal-table-wrap */}

                      {/* Footer botones */}
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16, paddingTop: 14, borderTop: "1px solid #f4f4f4", flexWrap: "wrap" }}>
                        <button
                          disabled={!tSumOk}
                          onClick={() => {
                            // En experimental: base = expTotal; en normal: customTotal o valor actual
                            const base = isExperimental ? expTotal
                              : (parseFloat(customTotal) > 0 ? parseFloat(customTotal) : effTotal);
                            setPortfolio(prev => prev.map(x => {
                              const tPct  = parseFloat(targetPcts[x.ticker]) || 0;
                              const price = stockData[x.ticker]?.price;
                              if (!price || base <= 0) return x;
                              // Siempre dividir entre precio en MXN para obtener acciones correctas
                              const priceMXN_ = toMXN(x.ticker, price);
                              const newShares = +(((tPct / 100 * base) / priceMXN_).toFixed(6));
                              return isExperimental
                                ? { ...x, shares: newShares, expPct: tPct }
                                : { ...x, shares: newShares };
                            }));
                            if (!isExperimental && parseFloat(customTotal) > 0) setCustomTotal("");
                          }}
                          style={{
                            background: tSumOk ? "#111111" : "#e5e5e5",
                            border: "none", borderRadius: 999, color: tSumOk ? "#fff" : "#aaa",
                            padding: "8px 20px", cursor: tSumOk ? "pointer" : "not-allowed",
                            fontSize: 12, fontWeight: 600, letterSpacing: "0.04em", transition: "all 0.15s"
                          }}
                        >Aplicar rebalanceo</button>
                        <button
                          onClick={() => {
                            const equal = (100 / paths.length).toFixed(1);
                            const next = {};
                            paths.forEach(p => { next[p.ticker] = equal; });
                            setTargetPcts(next);
                          }}
                          title="Distribuir pesos iguales entre todos los activos"
                          style={{
                            background: "none", border: "1px solid #e8e8e8", borderRadius: 999,
                            color: "#888", padding: "7px 16px", cursor: "pointer", fontSize: 12
                          }}
                        >⊞ Igualar</button>
                        <button
                          onClick={() => {
                            let tv = 0;
                            portfolio.forEach(p => { tv += posVal(p); });
                            const next = {};
                            portfolio.forEach(p => {
                              const val = posVal(p);
                              next[p.ticker] = tv > 0 ? (val / tv * 100).toFixed(1) : "0.0";
                            });
                            setTargetPcts(next);
                            setCustomTotal("");
                          }}
                          style={{
                            background: "none", border: "1px solid #e8e8e8", borderRadius: 999,
                            color: "#888", padding: "7px 16px", cursor: "pointer", fontSize: 12
                          }}
                        >↺ Resetear</button>
                        {!tSumOk && (
                          <span style={{ fontSize: 10, color: "#dc2626", marginLeft: 4 }}>
                            Falta {(100 - tSum).toFixed(1)}% por asignar
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                      );
                    })()}


                  </div>
                );
              })()}

            {/* Portfolio cards */}
            <div className="portfolio-grid" style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fill, minmax(460px, 1fr))" }}>
              {portfolio.map((pos) => {
                const sd = stockData[pos.ticker];
                const isLoading = loading[pos.ticker];
                const price = sd?.price ?? null;
                const value = price ? pos.shares * price : null;
                const cost_total = pos.shares * pos.cost;
                const pnl = value ? value - cost_total : null;
                const pnlPct = pnl !== null ? (pnl / cost_total) * 100 : null;

                const pnlColor = pnl === null ? "#666666" : pnl >= 0 ? "#00ff88" : "#ff3b3b";
                const cardBorderTop = pnl === null ? "#e5e5e5" : pnl >= 0 ? "#22c55e55" : "#ef444455";

                return (
                  <div key={pos.ticker} style={{
                    background: "#ffffff",
                    borderRadius: 24, animation: "fadeIn 0.4s ease",
                    boxShadow: "none", border: "1.5px solid #e0e0d8",
                    overflow: "hidden",
                  }}>
                    {/* Header: ticker + precio + P&L */}
                    <div style={{
                      background: "#0a0a0a", padding: "20px 24px",
                      borderRadius: "24px 24px 0 0",
                      display: "flex", justifyContent: "space-between", alignItems: "flex-start",
                    }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 18, color: "#ffffff" }}>
                            {pos.ticker}
                          </span>
                          {isLoading && <Spinner size={14} />}
                        </div>
                        <div style={{ fontSize: 13, color: "#888888", marginTop: 3 }}>{sd?.name ?? "—"}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        {price != null
                          ? <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 28, fontWeight: 500, color: "#ffffff", lineHeight: 1 }}>${price.toFixed(2)}</div>
                          : <div style={{ fontSize: 13, color: "#666666" }}>Cargando...</div>
                        }
                        {pnl !== null && (
                          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, color: pnlColor, fontWeight: 700, marginTop: 6 }}>
                            {pnl >= 0 ? "+" : "−"}${Math.abs(pnl).toFixed(2)}{" "}
                            <span style={{ fontSize: 11 }}>({Math.abs(pnlPct).toFixed(2)}%)</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div style={{ padding: "16px 20px" }}>

                    {/* P&L detalle */}
                    <div className="stock-metrics-grid" style={{
                      display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 14
                    }}>
                      {[
                        { l: "Acciones", v: pos.shares % 1 === 0 ? pos.shares : pos.shares.toFixed(4), mono: true, color: pos.shares % 1 !== 0 ? "#00ff88" : "#666666" },
                        { l: "Costo/acc", v: `$${pos.cost.toFixed(2)}`, mono: true, color: "#666666" },
                        { l: "Invertido", v: `$${cost_total.toFixed(2)}`, mono: true, color: "#666666" },
                        { l: "Valor actual", v: value != null ? `$${value.toFixed(2)}` : "—", mono: true, color: "#111111" },
                        { l: "P&L ($)", v: pnl != null ? `${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}` : "—", mono: true, color: pnlColor },
                        { l: "P&L (%)", v: pnlPct != null ? `${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%` : "—", mono: true, color: pnlColor },
                      ].map((item) => (
                        <div key={item.l} style={{ background: "#f5f5f0", borderRadius: 12, padding: "9px 12px" }}>
                          <div style={{ fontSize: 10, color: "#999999", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4, fontWeight: 500 }}>{item.l}</div>
                          <div style={{ fontSize: 14, fontFamily: item.mono ? "'DM Mono', monospace" : undefined, color: item.color, fontWeight: 700 }}>{item.v}</div>
                        </div>
                      ))}
                    </div>

                    {/* Métricas de valuación */}
                    {sd && (
                      <>
                        <div style={{ fontSize: 9, color: "#999999", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Valuación</div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                          <MetricBadge label="P/E" value={sd.pe} good={20} neutral={35} />
                          <MetricBadge label="PEG" value={sd.peg} good={1} neutral={2} />
                          <MetricBadge label="PEGY" value={sd.pegy} good={1} neutral={2} />
                          <MetricBadge label="EV/EBITDA" value={sd.evEbitda} good={12} neutral={20} />
                          <MetricBadge label="P/B" value={sd.pb} good={3} neutral={5} />
                        </div>
                        <div style={{ fontSize: 9, color: "#999999", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Fundamentales</div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
                          <MetricBadge label="ROE%" value={sd.roe} />
                          <MetricBadge label="Margen%" value={sd.profitMargin} />
                          <MetricBadge label="Rev.G%" value={sd.revenueGrowth} />
                          <MetricBadge label="D/E" value={sd.debtEquity} good={80} neutral={150} />
                          <MetricBadge label="Beta" value={sd.beta != null ? +sd.beta.toFixed(2) : null} />
                        </div>
                      </>
                    )}

                    {/* Valuación por múltiplos */}
                    {dcfData[pos.ticker] && (() => {
                      const d = dcfData[pos.ticker];
                      // ETF: mostrar nota informativa pequeña
                      if (d.isETF) {
                        return (
                          <div style={{ marginTop: 10, background: "#f8f8f8", borderRadius: 10, padding: "8px 12px", borderLeft: "3px solid #bbbbbb" }}>
                            <div style={{ fontSize: 9, color: "#bbbbbb", letterSpacing: "0.1em", fontWeight: 600 }}>VALUACIÓN</div>
                            <div style={{ fontSize: 11, color: "#999999", marginTop: 3 }}>ETF / Fondo — valuación por múltiplos no aplica para este instrumento.</div>
                          </div>
                        );
                      }
                      if (d.error) return null;
                      const mc = d.margin == null ? "#bbbbbb" : d.margin > 15 ? "#16a34a" : d.margin > 0 ? "#eab308" : "#dc2626";
                      const signalBg = { "INFRAVALORADO": "#f0fdf4", "SOBREVALORADO": "#fff7f7", "PRECIO JUSTO": "#fffbeb" };
                      const cur = d.priceCurrency || "USD";
                      return (
                        <div style={{ marginTop: 12, background: signalBg[d.overall] || "#f8f8f8", borderRadius: 12, padding: "12px 14px", borderLeft: `3px solid ${mc}` }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                            <div style={{ fontSize: 9, color: "#bbbbbb", letterSpacing: "0.12em", fontWeight: 600 }}>
                              VALUACIÓN POR MÚLTIPLOS · {d.sector || "—"}
                            </div>
                            <div style={{ fontSize: 10, fontWeight: 700, color: mc }}>{d.overall}</div>
                          </div>

                          {/* Precio justo compuesto */}
                          <div style={{ display: "flex", gap: 16, marginBottom: 12 }}>
                            <div>
                              <div style={{ fontSize: 9, color: "#bbbbbb" }}>PRECIO JUSTO ({d.nMethods} métodos)</div>
                              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 18, fontWeight: 700, color: "#111111" }}>
                                ${d.fairPrice?.toFixed(2) ?? "—"} <span style={{ fontSize: 10, color: "#bbbbbb" }}>{cur}</span>
                              </div>
                            </div>
                            <div>
                              <div style={{ fontSize: 9, color: "#bbbbbb" }}>PRECIO ACTUAL</div>
                              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 18, fontWeight: 700, color: "#555555" }}>
                                ${d.price?.toFixed(2)} <span style={{ fontSize: 10, color: "#bbbbbb" }}>{cur}</span>
                              </div>
                            </div>
                            <div>
                              <div style={{ fontSize: 9, color: "#bbbbbb" }}>DESCUENTO / PRIMA</div>
                              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 18, fontWeight: 700, color: mc }}>
                                {d.margin > 0 ? "+" : ""}{d.margin}%
                              </div>
                            </div>
                          </div>

                          {/* Detalle por método */}
                          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                            {d.methods?.map((m) => {
                              const sc = m.signal === "barato" ? "#16a34a" : m.signal === "caro" ? "#dc2626" : "#eab308";
                              return (
                                <div key={m.name} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
                                  <span style={{ fontFamily: "'DM Mono', monospace", color: "#bbbbbb", minWidth: 60 }}>{m.name}</span>
                                  <span style={{ color: "#555555" }}>actual <b style={{ color: sc }}>{m.actual ?? "—"}x</b></span>
                                  <span style={{ color: "#bbbbbb" }}>vs sector <b style={{ color: "#111111" }}>{m.fair}x</b></span>
                                  <span style={{ marginLeft: "auto", fontFamily: "'DM Mono', monospace", fontWeight: 700, color: "#111111" }}>
                                    obj. ${m.target?.toFixed(2)} {cur}
                                  </span>
                                  <span style={{ fontSize: 9, fontWeight: 700, color: sc, minWidth: 52, textAlign: "right" }}>
                                    {m.signal.toUpperCase()}
                                  </span>
                                </div>
                              );
                            })}
                          </div>

                          {d.sectorNote && (
                            <div style={{ fontSize: 9, color: "#8b5cf6", marginTop: 8 }}>
                              ★ {d.sectorNote} (clasificación Yahoo ajustada)
                            </div>
                          )}
                          {d.fxNote && (
                            <div style={{ fontSize: 9, color: "#00cc6a", marginTop: 4 }}>
                               {d.fxNote}
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    <button onClick={() => removeStock(pos.ticker)} style={{
                      marginTop: 12, background: "none", border: "1px solid #e5e5e5",
                      color: "#999999", borderRadius: 999, padding: "4px 12px", cursor: "pointer", fontSize: 11
                    }}>Eliminar</button>
                    </div>
                  </div>
                );
              })}
            </div>

          </div>
        )}

        {/* ─── TAB: OPTIMIZER ─── */}
        {tab === "optimize" && (
          <div>
            <div style={{
              background: "#ffffff", borderRadius: 24, boxShadow: "none", border: "1.5px solid #e0e0d8",
              padding: 20, marginBottom: 28
            }}>
              {/* Selector de portafolio */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                <span style={{ fontSize: 10, color: "#bbbbbb", letterSpacing: "0.1em", fontWeight: 600 }}>PORTAFOLIO A OPTIMIZAR</span>
                {portfolios.map(p => (
                  <button key={p.id} onClick={() => setActivePortfolioId(p.id)} style={{
                    background: activePortfolioId === p.id ? "#00ff88" : "#f2f2f2",
                    color: activePortfolioId === p.id ? "#ffffff" : "#555555",
                    border: "none", borderRadius: 999, padding: "4px 14px",
                    fontSize: 12, fontWeight: activePortfolioId === p.id ? 700 : 500, cursor: "pointer"
                  }}>{p.name} <span style={{ opacity: 0.7 }}>({p.positions.length})</span></button>
                ))}
              </div>
              <div style={{ fontSize: 14, color: "#555555", marginBottom: 16, lineHeight: 1.6 }}>
                Optimización de pesos por <b style={{ color: "#111111" }}>Máximo Sharpe Ratio</b> usando simulación Monte Carlo (100,000 portafolios). Restricciones: mín <b style={{ color: "#555555" }}>2%</b> — máx <b style={{ color: "#555555" }}>35%</b> por activo.
                Tasa libre de riesgo: <b style={{ fontFamily: "'DM Mono', monospace", color: "#555555" }}>
                  {rfRate ? `${(rfRate * 100).toFixed(2)}% (${rfLabel})` : "cargando..."}
                </b>
              </div>

              {/* Period selector */}
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 16 }}>
                <span style={{ fontSize: 12, color: "#999999", letterSpacing: "0.07em", fontWeight: 500 }}>DATOS HISTÓRICOS:</span>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {["1y", "5y", "10y"].map((p) => (
                    <button key={p} onClick={() => setOptimPeriod(p)} style={{
                      background: optimPeriod === p ? "#111111" : "#e5e5e5",
                      border: "none",
                      borderRadius: 999, color: optimPeriod === p ? "#fff" : "#666666",
                      padding: "5px 16px", cursor: "pointer", fontSize: 13, fontWeight: 600,
                      fontFamily: "'DM Mono', monospace",
                    }}>
                      {p === "1y" ? "1A" : p === "5y" ? "5A" : "10A"}
                    </button>
                  ))}
                  <span style={{ fontSize: 11, color: "#999999", alignSelf: "center" }}>
                    (~{optimPeriod === "1y" ? "52" : optimPeriod === "5y" ? "260" : "520"} sem.)
                  </span>
                </div>
              </div>

              <button onClick={runOptimization} disabled={optimLoading} className="btn-exec" style={{
                background: optimLoading ? "#999999" : "#0a0a0a",
                border: "none", borderRadius: 999, color: "#ffffff",
                padding: "12px 28px", cursor: optimLoading ? "not-allowed" : "pointer",
                fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", gap: 10
              }}>
                {optimLoading && <Spinner size={16} />}
                {optimLoading ? (optimLoadingMsg || "Optimizando...") : " Ejecutar Optimización"}
              </button>
            </div>

            {optimResult && (
              <div style={{ animation: "fadeIn 0.5s ease" }}>

                {/* ── Comparativa Actual vs Óptimo ── */}
                <div className="resp-grid-2" style={{ marginBottom: 24 }}>
                  {/* Portafolio Actual */}
                  <div style={{
                    background: "#ffffff", boxShadow: "none", border: "1.5px solid #e0e0d8",
                    borderTop: "3px solid #888888", borderRadius: 24, padding: 24
                  }}>
                    <div style={{ fontSize: 10, color: "#666666", letterSpacing: "0.1em", marginBottom: 12 }}>PORTAFOLIO ACTUAL</div>
                    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 36, color: "#666666", fontWeight: 700, marginBottom: 16 }}>
                      {optimResult.actualSharpe?.toFixed(4) ?? "—"}
                    </div>
                    <div style={{ display: "flex", gap: 16 }}>
                      <div>
                        <div style={{ fontSize: 9, color: "#999999", marginBottom: 3 }}>RETORNO ANUAL</div>
                        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 15, color: optimResult.actualStats?.annReturn >= 0 ? "#16a34a" : "#dc2626", fontWeight: 700 }}>
                          {optimResult.actualStats?.annReturn >= 0 ? "+" : ""}{optimResult.actualStats?.annReturn}%
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: 9, color: "#999999", marginBottom: 3 }}>VOLATILIDAD ANUAL</div>
                        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 15, color: "#111111", fontWeight: 700 }}>
                          {optimResult.actualStats?.annVol}%
                        </div>
                      </div>
                    </div>
                    <div style={{ marginTop: 12, fontSize: 10, color: "#999999" }}>Pesos reales por valor de mercado · {optimPeriod}</div>
                  </div>

                  {/* Portafolio Óptimo */}
                  <div style={{
                    background: "#f8f8f8",
                    boxShadow: "none", border: "1.5px solid #e0e0d8",
                    borderTop: "3px solid #00ff88", borderRadius: 24, padding: 24
                  }}>
                    <div style={{ fontSize: 10, color: "#00cc6a", letterSpacing: "0.1em", marginBottom: 12 }}>PORTAFOLIO ÓPTIMO (MONTE CARLO)</div>
                    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 36, color: "#00cc6a", fontWeight: 700, marginBottom: 16 }}>
                      {optimResult.optimalSharpe?.toFixed(4) ?? optimResult.sharpe.toFixed(4)}
                    </div>
                    <div style={{ display: "flex", gap: 16 }}>
                      <div>
                        <div style={{ fontSize: 9, color: "#999999", marginBottom: 3 }}>RETORNO ANUAL</div>
                        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 15, color: "#16a34a", fontWeight: 700 }}>
                          {optimResult.optimalStats?.annReturn >= 0 ? "+" : ""}{optimResult.optimalStats?.annReturn}%
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: 9, color: "#999999", marginBottom: 3 }}>VOLATILIDAD ANUAL</div>
                        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 15, color: "#111111", fontWeight: 700 }}>
                          {optimResult.optimalStats?.annVol}%
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: 9, color: "#999999", marginBottom: 3 }}>MEJORA SHARPE</div>
                        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 15, color: "#16a34a", fontWeight: 700 }}>
                          +{((optimResult.optimalSharpe ?? optimResult.sharpe) - (optimResult.actualSharpe ?? 0)).toFixed(4)}
                        </div>
                      </div>
                    </div>
                    <div style={{ marginTop: 12, fontSize: 10, color: "#999999" }}>100,000 simulaciones · mín 2% · máx 35% · {optimPeriod} · rf {rfLabel} {rfRate ? `${(rfRate*100).toFixed(2)}%` : ""}</div>
                  </div>
                </div>

                <div style={{ overflowX: "auto" }}>
                  <table>
                    <thead>
                      <tr>
                        <th style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 10, textTransform: "uppercase", color: "#888888", padding: "10px 14px", borderBottom: "1px solid #e0e0d8" }}>TICKER</th>
                        <th style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 10, textTransform: "uppercase", color: "#888888", padding: "10px 14px", borderBottom: "1px solid #e0e0d8" }}>PESO ÓPTIMO</th>
                        <th style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 10, textTransform: "uppercase", color: "#888888", padding: "10px 14px", borderBottom: "1px solid #e0e0d8" }}>PESO ACTUAL</th>
                        <th style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 10, textTransform: "uppercase", color: "#888888", padding: "10px 14px", borderBottom: "1px solid #e0e0d8" }}>DIFERENCIA</th>
                        <th style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 10, textTransform: "uppercase", color: "#888888", padding: "10px 14px", borderBottom: "1px solid #e0e0d8" }}>ACCIÓN</th>
                      </tr>
                    </thead>
                    <tbody>
                      {optimResult.tickers.map((t, i) => {
                        const optW = optimResult.weights[i];
                        const pos = portfolio.find((p) => p.ticker === t);
                        const sd = stockData[t];
                        const price = sd?.price ?? 0;
                        const totalValue = portfolio.reduce((s, p) => s + posVal(p), 0);
                        const currW = totalValue > 0 && pos ? posVal(pos) / totalValue : 0;
                        const diff = optW - currW;
                        const action = Math.abs(diff) < 0.02 ? "MANTENER" : diff > 0 ? "AUMENTAR" : "REDUCIR";
                        const actionColor = action === "AUMENTAR" ? "#16a34a" : action === "REDUCIR" ? "#dc2626" : "#666666";
                        const rowBg = i % 2 === 0 ? "#ffffff" : "#f5f5f0";
                        return (
                          <tr key={t} style={{ background: rowBg }}>
                            <td style={{ fontFamily: "'DM Mono', monospace", color: "#111111", fontWeight: 700 }}>{t}</td>
                            <td style={{ fontFamily: "'DM Mono', monospace" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <div style={{
                                  height: 8, width: `${optW * 200}px`, maxWidth: 120,
                                  background: "#111111", borderRadius: 4
                                }} />
                                {(optW * 100).toFixed(1)}%
                              </div>
                            </td>
                            <td style={{ fontFamily: "'DM Mono', monospace", color: "#666666" }}>{(currW * 100).toFixed(1)}%</td>
                            <td style={{ fontFamily: "'DM Mono', monospace", color: diff > 0 ? "#16a34a" : "#dc2626" }}>
                              {diff > 0 ? "+" : ""}{(diff * 100).toFixed(1)}%
                            </td>
                            <td>
                              <span style={{
                                background: action === "AUMENTAR" ? "#00ff88" : action === "REDUCIR" ? "#0a0a0a" : "#e0e0d8",
                                color: action === "AUMENTAR" ? "#0a0a0a" : action === "REDUCIR" ? "#ffffff" : "#0a0a0a",
                                borderRadius: 999, padding: "2px 12px", fontSize: 11,
                                fontFamily: "'Syne', sans-serif", fontWeight: 700,
                              }}>{action}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Matriz de correlación */}
                {optimResult.corrMatrix && (
                  <div style={{ marginTop: 28, background: "#ffffff", borderRadius: 24, boxShadow: "none", border: "1.5px solid #e0e0d8", padding: 24 }}>
                    <div style={{ fontSize: 12, color: "#999999", letterSpacing: "0.07em", fontWeight: 500, marginBottom: 6 }}>MATRIZ DE CORRELACIÓN</div>
                    <div style={{ fontSize: 11, color: "#999999", marginBottom: 18 }}>
                      Rojo = alta correlación (mueven igual) · Azul = baja/negativa (diversifican) · 1.00 = idénticos
                    </div>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ borderCollapse: "separate", borderSpacing: 3 }}>
                        <thead>
                          <tr>
                            <th style={{ padding: "4px 8px", fontSize: 10, color: "#999999", textAlign: "left", minWidth: 90 }}></th>
                            {optimResult.tickers.map((t) => (
                              <th key={t} style={{ padding: "4px 8px", fontSize: 10, color: "#0a0a0a", textAlign: "center", minWidth: 80, fontFamily: "'Syne', sans-serif", fontWeight: 700, textTransform: "uppercase" }}>{t}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {optimResult.tickers.map((rowT, i) => (
                            <tr key={rowT}>
                              <td style={{ padding: "4px 8px", fontSize: 10, color: "#0a0a0a", fontFamily: "'Syne', sans-serif", fontWeight: 700, textTransform: "uppercase", whiteSpace: "nowrap" }}>{rowT}</td>
                              {optimResult.corrMatrix[i].map((val, j) => {
                                let bg, textColor;
                                if (i === j) {
                                  bg = "#0a0a0a"; textColor = "#ffffff";
                                } else if (val > 0.5) {
                                  bg = "#0a0a0a"; textColor = "#00ff88";
                                } else if (val < -0.1) {
                                  bg = "#ff3b3b20"; textColor = "#ff3b3b";
                                } else {
                                  bg = "#f5f5f0"; textColor = "#0a0a0a";
                                }
                                return (
                                  <td key={j} style={{
                                    background: bg, borderRadius: 6,
                                    padding: "8px 6px", textAlign: "center",
                                    fontFamily: "'DM Mono', monospace",
                                    fontSize: 12, fontWeight: 700, color: textColor,
                                    minWidth: 80
                                  }}>{val.toFixed(2)}</td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Leyenda */}
                    <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
                      {[
                        { color: "rgba(239,68,68,0.7)", text: "Alta (≥ 0.7) — poca diversificación" },
                        { color: "rgba(234,179,8,0.5)",  text: "Media (0.4–0.7)" },
                        { color: "rgba(100,116,139,0.3)", text: "Baja (0–0.4) — buena diversificación" },
                        { color: "rgba(56,189,248,0.5)",  text: "Negativa — diversificación óptima" },
                      ].map((l) => (
                        <div key={l.text} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#666666" }}>
                          <div style={{ width: 14, height: 14, borderRadius: 3, background: l.color }} />
                          {l.text}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── Recomendaciones ── */}
                {optimResult.recommendations?.length > 0 && (
                  <div style={{ marginTop: 28, background: "#ffffff", borderRadius: 24, boxShadow: "none", border: "1.5px solid #e0e0d8", padding: 24 }}>
                    <div style={{ fontSize: 12, color: "#999999", letterSpacing: "0.07em", fontWeight: 500, marginBottom: 4 }}>RECOMENDACIONES PARA TU PORTAFOLIO</div>
                    <div style={{ fontSize: 11, color: "#999999", marginBottom: 18 }}>
                      Top activos que mejorarían tu portafolio — score compuesto: Mejora Sharpe 40% · Baja correlación 35% · Sharpe individual 25%
                    </div>
                    <div style={{ overflowX: "auto" }}>
                      <table>
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>TICKER</th>
                            <th>SCORE</th>
                            <th>CORR. MEDIA</th>
                            <th>SHARPE PROPIO</th>
                            <th>Δ SHARPE PORTAFOLIO</th>
                            <th>VEREDICTO</th>
                          </tr>
                        </thead>
                        <tbody>
                          {optimResult.recommendations.map((r, idx) => {
                            const scoreColor = r.score >= 65 ? "#16a34a" : r.score >= 45 ? "#eab308" : "#dc2626";
                            const corrColor  = r.avgCorr < 0.3 ? "#16a34a" : r.avgCorr < 0.6 ? "#eab308" : "#dc2626";
                            const deltaColor = r.sharpeDelta > 0.05 ? "#16a34a" : r.sharpeDelta > 0 ? "#eab308" : "#dc2626";
                            const verdict    = r.score >= 65 ? "AGREGAR" : r.score >= 45 ? "CONSIDERAR" : "OMITIR";
                            const verdictColor = verdict === "AGREGAR" ? "#16a34a" : verdict === "CONSIDERAR" ? "#eab308" : "#999999";
                            return (
                              <tr key={r.ticker}>
                                <td style={{ color: "#999999", fontSize: 12 }}>{idx + 1}</td>
                                <td style={{ fontFamily: "'DM Mono', monospace", color: "#111111", fontWeight: 700 }}>{r.ticker}</td>
                                <td>
                                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <div style={{ background: "#ffffff", borderRadius: 4, height: 6, width: 80, overflow: "hidden" }}>
                                      <div style={{ width: `${r.score}%`, height: "100%", background: scoreColor, borderRadius: 4 }} />
                                    </div>
                                    <span style={{ fontFamily: "'DM Mono', monospace", color: scoreColor, fontWeight: 700, fontSize: 13 }}>{r.score}</span>
                                  </div>
                                </td>
                                <td style={{ fontFamily: "'DM Mono', monospace", color: corrColor, fontSize: 13 }}>{r.avgCorr.toFixed(2)}</td>
                                <td style={{ fontFamily: "'DM Mono', monospace", color: r.candSharpe > 0 ? "#16a34a" : "#dc2626", fontSize: 13 }}>{r.candSharpe.toFixed(2)}</td>
                                <td style={{ fontFamily: "'DM Mono', monospace", color: deltaColor, fontSize: 13 }}>
                                  {r.sharpeDelta > 0 ? "+" : ""}{r.sharpeDelta.toFixed(3)}
                                </td>
                                <td>
                                  <span style={{
                                    background: `${verdictColor}22`, border: `1px solid ${verdictColor}44`,
                                    color: verdictColor, borderRadius: 6, padding: "2px 10px", fontSize: 11, fontWeight: 700
                                  }}>{verdict}</span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div style={{ marginTop: 14, fontSize: 11, color: "#999999" }}>
                      Candidatos evaluados: {CANDIDATE_TICKERS.filter(t => !optimResult.tickers.includes(t)).length} tickers · Período: {optimPeriod}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ─── TAB: SCREENER ─── */}
        {tab === "screener" && (
          <div>
            <div style={{
              background: "#ffffff", boxShadow: "none", border: "1.5px solid #e0e0d8",
              borderRadius: 24, padding: 20, marginBottom: 28
            }}>
              <div style={{ fontSize: 12, color: "#999999", letterSpacing: "0.07em", fontWeight: 500, marginBottom: 8 }}>TICKERS A ANALIZAR (separados por coma, incluye .MX para México)</div>
              <textarea value={screenerTickers} onChange={(e) => setScreenerTickers(e.target.value)}
                style={{
                  width: "100%", background: "#f8f8f8", border: "1px solid #e5e5e5",
                  borderRadius: 8, color: "#111111", padding: "10px 14px", fontSize: 13,
                  fontFamily: "'DM Mono', monospace", minHeight: 60, resize: "vertical"
                }} />
              <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 12 }}>
                <button onClick={runScreener} disabled={screenerLoading} className="btn-exec" style={{
                  background: screenerLoading ? "#e5e5e5" : "#0a0a0a",
                  border: "none", borderRadius: 999, color: "#ffffff",
                  padding: "12px 28px", cursor: screenerLoading ? "not-allowed" : "pointer",
                  fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", gap: 10
                }}>
                  {screenerLoading && <Spinner size={16} />}
                  {screenerLoading ? `Analizando... ${screenerProgress}%` : " Ejecutar ML Screener"}
                </button>
                {screenerLoading && (
                  <div style={{ flex: 1, background: "#e5e5e5", borderRadius: 4, height: 6, overflow: "hidden" }}>
                    <div style={{
                      width: `${screenerProgress}%`, height: "100%",
                      background: "#111111", transition: "width 0.3s ease"
                    }} />
                  </div>
                )}
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: "#999999" }}>
                Motor cuantitativo de scoring: puntúa cada acción del 1 al 10 en 6 dimensiones —
                <b style={{ color: "#666666" }}> Fundamental, Valuación, Momentum, Calidad, Técnico y Overall</b> —
                usando PE, PEG, PEGY, EV/EBITDA, ROE, Márgenes, Deuda/Capital, Crecimiento y variación 52 semanas (Yahoo Finance).
              </div>
            </div>

            {screenerData.length > 0 && (
              <div className="screener-cards" style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))" }}>
                {[...screenerData].sort((a, b) => (b.scores?.overall_score ?? 0) - (a.scores?.overall_score ?? 0)).map((stock) => {
                  const s = stock.scores;
                  const recColor = s?.recommendation === "BUY" ? "#16a34a" : s?.recommendation === "SELL" ? "#dc2626" : "#eab308";
                  return (
                    <div key={stock.ticker} style={{
                      background: "#ffffff", boxShadow: "none", border: "1.5px solid #e0e0d8",
                      borderRadius: 24, padding: 20, animation: "fadeIn 0.4s ease",
                      borderTop: `3px solid ${recColor}`
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                        <div>
                          <div style={{ fontFamily: "'DM Mono', monospace", fontWeight: 700, fontSize: 15, color: "#111111" }}>{stock.ticker}</div>
                          <div style={{ fontSize: 11, color: "#666666", marginTop: 2 }}>{stock.name ?? "—"}</div>
                          {stock.price && <div style={{ fontSize: 13, color: "#666666", marginTop: 4 }}>
                            ${stock.price.toFixed(2)}
                          </div>}
                        </div>
                        {s && (
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 28, fontWeight: 700, color: recColor }}>
                              {s.overall_score}
                            </div>
                            <div style={{ fontSize: 10, color: recColor, fontWeight: 700, letterSpacing: "0.1em" }}>
                              {s.recommendation}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Sharpe 1Y destacado */}
                      {stock.sharpe1y != null && (
                        <div style={{
                          display: "flex", alignItems: "center", gap: 10,
                          background: stock.sharpe1y >= 1 ? "#f0fdf4" : stock.sharpe1y >= 0.5 ? "#fffbeb" : "#fff7f7",
                          borderRadius: 10, padding: "8px 12px", marginBottom: 12,
                          borderLeft: `3px solid ${stock.sharpe1y >= 1 ? "#16a34a" : stock.sharpe1y >= 0.5 ? "#d97706" : "#dc2626"}`
                        }}>
                          <div>
                            <div style={{ fontSize: 9, color: "#bbbbbb", letterSpacing: "0.1em", fontWeight: 600 }}>SHARPE 1A · {rfLabel}</div>
                            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 20, fontWeight: 700,
                              color: stock.sharpe1y >= 1 ? "#16a34a" : stock.sharpe1y >= 0.5 ? "#d97706" : "#dc2626"
                            }}>{stock.sharpe1y > 0 ? "+" : ""}{stock.sharpe1y}</div>
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ background: "#e5e5e5", borderRadius: 4, height: 5, overflow: "hidden" }}>
                              <div style={{
                                width: `${Math.min(Math.max((stock.sharpe1y / 3) * 100, 0), 100)}%`,
                                height: "100%", borderRadius: 4,
                                background: stock.sharpe1y >= 1 ? "#16a34a" : stock.sharpe1y >= 0.5 ? "#d97706" : "#dc2626",
                                transition: "width 0.6s ease"
                              }} />
                            </div>
                            <div style={{ fontSize: 9, color: "#bbbbbb", marginTop: 3 }}>
                              ≥1.0 excelente · 0.5-1.0 bueno · &lt;0.5 bajo
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Metrics mini */}
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
                        {[
                          { l: "P/E", v: stock.pe },
                          { l: "PEG", v: stock.peg },
                          { l: "EV/EBITDA", v: stock.evEbitda },
                          { l: "ROE%", v: stock.roe },
                          { l: "Mg%", v: stock.profitMargin },
                          { l: "P/B", v: stock.pb },
                          { l: "D/A%", v: stock.debtToAssets },
                          { l: "Lev", v: stock.leverageRatio },
                        ].map((m) => m.v != null && (
                          <span key={m.l} style={{
                            background: "#f2f2f2", border: "none",
                            borderRadius: 8, padding: "3px 8px", fontSize: 11,
                            fontFamily: "'DM Mono', monospace", color: "#666666"
                          }}>{m.l}: <b style={{ color: "#111111" }}>{m.v}</b></span>
                        ))}
                      </div>

                      {s && (
                        <>
                          <ScoreBar value={s.fundamental_score} label="Fundamental" />
                          <ScoreBar value={s.valuation_score} label="Valuación" />
                          <ScoreBar value={s.momentum_score} label="Momentum" />
                          <ScoreBar value={s.quality_score} label="Calidad" />
                          <ScoreBar value={s.technical_score} label="Técnico" />
                          <ScoreBar value={s.overall_score} label="Overall" />
                          {s.rationale && (
                            <div style={{
                              marginTop: 12, background: "#f8f8f8", borderRadius: 8,
                              padding: "8px 12px", fontSize: 11, color: "#666666", lineHeight: 1.5
                            }}>
                               {s.rationale}
                            </div>
                          )}
                        </>
                      )}
                      {!s && (
                        <div style={{ color: "#999999", fontSize: 12 }}>Procesando...</div>
                      )}

                      {/* Valuación por múltiplos */}
                      {stock.dcf && !stock.dcf.error && (() => {
                        const d = stock.dcf;
                        const mc = d.margin == null ? "#bbbbbb" : d.margin > 15 ? "#16a34a" : d.margin > 0 ? "#eab308" : "#dc2626";
                        return (
                          <div style={{ marginTop: 10, padding: "10px 12px", background: "#f8f8f8", borderRadius: 10, borderLeft: `3px solid ${mc}` }}>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                              <div style={{ fontSize: 9, color: "#bbbbbb", letterSpacing: "0.1em", fontWeight: 600 }}>MÚLTIPLOS · {d.sector || "—"}</div>
                              <div style={{ fontSize: 10, fontWeight: 700, color: mc }}>{d.overall}</div>
                            </div>
                            <div style={{ display: "flex", gap: 10, alignItems: "baseline", marginBottom: 8 }}>
                              {d.fairPrice != null && <span style={{ fontSize: 12 }}>Justo <b style={{ fontFamily: "'DM Mono', monospace", color: "#111111" }}>${d.fairPrice.toFixed(2)}</b></span>}
                              {d.margin != null && <span style={{ fontSize: 12 }}>Descuento <b style={{ fontFamily: "'DM Mono', monospace", color: mc }}>{d.margin > 0 ? "+" : ""}{d.margin}%</b></span>}
                            </div>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              {d.methods?.map((m) => {
                                const sc = m.signal === "barato" ? "#16a34a" : m.signal === "caro" ? "#dc2626" : "#eab308";
                                return (
                                  <span key={m.name} style={{ fontSize: 10, background: "#ffffff", borderRadius: 6, padding: "2px 7px", color: "#555555" }}>
                                    {m.name} <b style={{ fontFamily: "'DM Mono', monospace", color: sc }}>{m.actual ?? "—"}x</b>
                                    <span style={{ color: "#bbbbbb" }}>/{m.fair}x</span>
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Momentum relativo */}
                      {stock.momentum && !stock.momentum.error && (() => {
                        const m = stock.momentum;
                        const scoreColor = m.score === 3 ? "#16a34a" : m.score >= 2 ? "#eab308" : "#dc2626";
                        return (
                          <div style={{ marginTop: 8, padding: "8px 10px", background: "#f8f8f8", borderRadius: 8 }}>
                            <div style={{ fontSize: 9, color: "#bbbbbb", letterSpacing: "0.1em", marginBottom: 6 }}>MOMENTUM vs {m.benchmark} ({m.sector})</div>
                            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                              {[["3M", m.alpha?.m3], ["6M", m.alpha?.m6], ["12M", m.alpha?.m12]].map(([label, alpha]) => alpha != null && (
                                <div key={label} style={{ fontSize: 11 }}>
                                  <span style={{ color: "#bbbbbb" }}>{label}: </span>
                                  <b style={{ fontFamily: "'DM Mono', monospace", color: alpha > 0 ? "#16a34a" : "#dc2626" }}>
                                    {alpha > 0 ? "+" : ""}{alpha}%
                                  </b>
                                </div>
                              ))}
                              <div style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: scoreColor }}>
                                {m.score}/3 períodos superando sector
                              </div>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Botón análisis detallado */}
                      <button
                        onClick={() => runAnalisis(stock.ticker)}
                        style={{
                          marginTop: 14, width: "100%",
                          background: "#0a0a0a", color: "#00ff88",
                          border: "none", borderRadius: 10,
                          padding: "10px 0", cursor: "pointer",
                          fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 12,
                          letterSpacing: "0.06em", transition: "all 0.15s",
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = "#00ff88"; e.currentTarget.style.color = "#0a0a0a"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "#0a0a0a"; e.currentTarget.style.color = "#00ff88"; }}
                      >
                        VER ANÁLISIS COMPLETO →
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ─── TAB: NOTICIAS / PANORAMA ─── */}
        {tab === "news" && (() => {
          const md = marketData;
          const fv = (v, dec = 2) => v == null ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
          const C  = (k, dec, macro) => {
            const d = macro ? macroData?.[k] : md?.[k];
            return { value: d?.value, pct: macro ? null : d?.change_pct, abs: d?.change };
          };

          const MX_REF = [
            { label: "Inflación INPC",  value: "4.53%",   period: "1a Q Abr 2026",   color: "#ea580c", icon: "" },
            { label: "PIB Q1 2026",     value: "+0.2%",   period: "Trim. INEGI",     color: "#16a34a", icon: "" },
            { label: "TIIE Fondeo 1D",  value: "6.76%",   period: "Banxico May 2026", color: "#7c3aed", icon: "" },
            { label: "TIIE 28D",        value: "7.02%",   period: "Banxico May 2026", color: "#6d28d9", icon: "" },
            { label: "Desempleo",       value: "2.4%",    period: "Mar 2026",        color: "#16a34a", icon: "" },
            { label: "Deuda / PIB",     value: "50.4%",   period: "Q1 2026",         color: "#ea580c", icon: "" },
            { label: "Reservas Intl.",  value: "$256.5B", period: "24 Abr 2026",     color: "#0284c7", icon: "" },
          ];

          const filteredNews = marketNews.filter(n => newsFilter === "all" || n.sentiment === newsFilter);
          const lastUpdStr = lastUpdated
            ? lastUpdated.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })
            : null;

          // VIX color
          const vixVal = macroData?.vix?.value;
          const vixColor = vixVal > 30 ? "#dc2626" : vixVal > 20 ? "#ca8a04" : "#16a34a";

          // ── Componentes de panel tipo terminal financiero ──
          const DataRow = ({ label, icon, value, pct, sub, hero }) => {
            const isN = pct == null;
            const up  = !isN && pct >= 0;
            const cc  = up ? "#15803d" : "#b91c1c";
            const bg  = up ? "#f0fdf4" : "#fff5f5";
            const bdr = up ? "#bbf7d0" : "#fecaca";
            return (
              <div style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: hero ? "10px 14px" : "8px 12px",
                borderBottom: "1px solid #e8e8e4",
                background: hero ? bg : "#ffffff",
                borderLeft: hero ? `3px solid ${cc}` : "none",
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 9, color: "#888888", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "'Syne', sans-serif" }}>{label}</div>
                  {sub && <div style={{ fontSize: 9, color: "#aaaaaa", marginTop: 1 }}>{sub}</div>}
                </div>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: hero ? 18 : 13, fontWeight: 700, color: "#0a0a0a", marginRight: isN ? 0 : 8, flexShrink: 0 }}>
                  {value ?? <span style={{ color: "#d1d5db" }}>—</span>}
                </div>
                {!isN
                  ? <span style={{
                      flexShrink: 0, fontSize: 10, fontWeight: 700,
                      color: cc, minWidth: 60, textAlign: "right",
                      fontFamily: "'DM Mono', monospace",
                    }}>
                      {up ? "+" : ""}{Math.abs(pct).toFixed(2)}%
                    </span>
                  : <div style={{ flexShrink: 0, minWidth: 60 }} />
                }
              </div>
            );
          };

          const Panel = ({ title, color = "#3b82f6", children, style = {} }) => (
            <div style={{
              background: "#ffffff", borderRadius: 16, overflow: "hidden",
              border: "1px solid #e8e8e4",
              ...style
            }}>
              <div style={{
                padding: "8px 16px",
                borderBottom: "1px solid #e0e0d8",
                background: "#ffffff",
              }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: "#888888", textTransform: "uppercase", letterSpacing: "0.2em", fontFamily: "'Syne', sans-serif" }}>{title}</span>
              </div>
              {children}
            </div>
          );

          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

              {/* ── HERO ── */}
              <div style={{ background: "#f5f5f0", borderRadius: 20, padding: "32px 28px", display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
                <div>
                  <div className="hero-title" style={{ fontSize: 48, fontWeight: 800, color: "#0a0a0a", letterSpacing: "-0.04em", fontFamily: "'Syne', sans-serif", lineHeight: 1.05 }}>
                    Panorama de<br />Mercados
                  </div>
                  <div style={{ fontSize: 13, color: "#888888", marginTop: 12 }}>
                    Indicadores globales · México · Noticias
                    {lastUpdStr && <span style={{ marginLeft: 10 }}>· Act. {lastUpdStr}</span>}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button onClick={() => { loadMarketData(); setCountdown(60); }} disabled={marketDataLoading} style={{
                    background: "#0a0a0a", border: "none", borderRadius: 8, color: "#ffffff",
                    padding: "8px 16px", cursor: marketDataLoading ? "not-allowed" : "pointer",
                    fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 6,
                    transition: "all 0.15s", opacity: marketDataLoading ? 0.5 : 1,
                  }}>
                    {marketDataLoading ? <Spinner size={11} /> : "↻"} Mercados
                  </button>
                  <button onClick={loadMarketNews} disabled={marketNewsLoading} style={{
                    background: "transparent", border: "1px solid #0a0a0a", borderRadius: 8, color: "#0a0a0a",
                    padding: "8px 16px", cursor: marketNewsLoading ? "not-allowed" : "pointer",
                    fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 6,
                    transition: "all 0.15s", opacity: marketNewsLoading ? 0.5 : 1,
                  }}>
                    {marketNewsLoading ? <Spinner size={11} /> : "↻"} Noticias
                  </button>
                </div>
              </div>

              {/* ── BENTO GRID ── */}
              {md && (
                <div className="bento-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
                  {[
                    { key: "sp500",  label: "S&P 500",  dec: 2,              bg: "#0a0a0a", fg: "#ffffff" },
                    { key: "nasdaq", label: "NASDAQ",    dec: 2,              bg: "#00ff88", fg: "#0a0a0a" },
                    { key: "dow",    label: "DJIA",      dec: 2,              bg: "#f0f0eb", fg: "#0a0a0a" },
                    { key: "ipc",    label: "IPC MX",    dec: 2,              bg: "#0a0a0a", fg: "#ffffff" },
                    { key: "usdmxn",label: "USD · MXN", dec: 4,              bg: "#00ff88", fg: "#0a0a0a" },
                    { key: "gold",   label: "Oro",       dec: 2, unit: "/oz", bg: "#0a0a0a", fg: "#ffffff" },
                    { key: "wti",    label: "WTI Crude", dec: 2, unit: "/bbl",bg: "#00ff88", fg: "#0a0a0a" },
                    { key: "btc",    label: "Bitcoin",   dec: 0,              bg: "#0a0a0a", fg: "#ffffff" },
                  ].map(({ key, label, dec, unit, bg, fg }) => {
                    const d = md[key];
                    const up = d?.change_pct >= 0;
                    const isDark = fg === "#ffffff";
                    const badgeBg = isDark ? (up ? "#00ff88" : "#ff4444") : (up ? "#0a0a0a" : "#cc3300");
                    const badgeFg = isDark ? "#0a0a0a" : "#ffffff";
                    return (
                      <div key={key} style={{
                        background: bg, borderRadius: 16, padding: 16,
                        display: "flex", flexDirection: "column", gap: 8,
                      }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: isDark ? "#888888" : "#666666", textTransform: "uppercase", letterSpacing: "0.1em" }}>{label}</div>
                        <div className="bento-val" style={{ fontFamily: "'DM Mono', monospace", fontSize: 32, fontWeight: 500, color: fg, lineHeight: 1, letterSpacing: "-0.02em" }}>
                          {d ? fv(d.value, dec) + (unit ? " " + unit : "") : "—"}
                        </div>
                        {d?.change_pct != null && (
                          <span style={{
                            display: "inline-flex", alignSelf: "flex-start",
                            background: badgeBg, color: badgeFg,
                            fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 6,
                            fontFamily: "'DM Mono', monospace",
                          }}>
                            {up ? "+" : ""}{d.change_pct.toFixed(2)}%
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* ── RESUMEN MAÑANERO ── */}
              <ResumenManero md={marketData} macroData={macroData} />

              {/* ── INDICADORES PRINCIPALES ── */}
              <div style={{ border: "1.5px solid #e0e0d8", borderRadius: 16, overflow: "hidden" }}>
                <div style={{ padding: "8px 16px", borderBottom: "1px solid #e0e0d8", background: "#ffffff" }}>
                  <span style={{ fontSize: 9, fontWeight: 700, color: "#888888", textTransform: "uppercase", letterSpacing: "0.2em", fontFamily: "'Syne', sans-serif" }}>Indicadores Principales</span>
                </div>
                <div className="ind-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)" }}>
                  {[
                    { key: "sp500",  label: "S&P 500",        dec: 2 },
                    { key: "nasdaq", label: "NASDAQ",           dec: 2 },
                    { key: "dow",    label: "Dow Jones",        dec: 2 },
                    { key: "ipc",    label: "IPC México",       dec: 2 },
                    { key: "vix",    label: "VIX",              dec: 2 },
                    { key: "dxy",    label: "DXY (Dólar)",      dec: 2 },
                    { key: "t10y",   label: "US 10Y Treasury",  dec: 2, unit: "%" },
                    { key: "usdmxn", label: "USD / MXN",        dec: 4 },
                  ].map(({ key, label, dec, macro, unit }, idx) => {
                    const d = C(key, dec, macro);
                    const isN = d.pct == null;
                    const up  = !isN && d.pct >= 0;
                    const cc  = up ? "#15803d" : "#b91c1c";
                    const col = idx % 4;
                    const row = Math.floor(idx / 4);
                    return (
                      <div key={key} style={{
                        padding: "12px 16px",
                        borderRight: col < 3 ? "1px solid #e0e0d8" : "none",
                        borderBottom: row < 1 ? "1px solid #e0e0d8" : "none",
                        background: "#ffffff",
                      }}>
                        <div style={{ fontSize: 9, color: "#888888", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "'Syne', sans-serif", marginBottom: 4 }}>{label}</div>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 18, fontWeight: 700, color: "#0a0a0a", lineHeight: 1 }}>
                            {d.value != null ? fv(d.value, dec) + (unit ?? "") : <span style={{ color: "#d1d5db" }}>—</span>}
                          </span>
                          {!isN && (
                            <span style={{ fontSize: 10, fontWeight: 700, color: cc, fontFamily: "'DM Mono', monospace" }}>
                              {up ? "+" : ""}{Math.abs(d.pct).toFixed(2)}%
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ── STYLE BOX + WORLD MAP ── */}
              {(() => {
                const BOX = [
                  { label: "Large", keys: ["sb_lv","sb_lb","sb_lg"] },
                  { label: "Mid",   keys: ["sb_mv","sb_mb","sb_mg"] },
                  { label: "Small", keys: ["sb_sv","sb_sb","sb_sg"] },
                ];
                const COLS = ["Value","Core","Growth"];
                const toCell = (key) => {
                  const d = md?.[key];
                  const p = d?.change_pct;
                  const intensity = p == null ? 0 : Math.min(Math.abs(p) / 2, 1);
                  const bg = p == null ? "#f5f5f0"
                    : p >= 0 ? `rgba(21,128,61,${0.14 + intensity * 0.60})`
                             : `rgba(185,28,28,${0.14 + intensity * 0.60})`;
                  const fg = p == null ? "#94a3b8" : p >= 0 ? "#14532d" : "#7f1d1d";
                  return { p, bg, fg };
                };
                return (
                  <div className="stylebox-wrap" style={{ display: "grid", gridTemplateColumns: "minmax(340px, 2fr) 3fr", gap: 16, alignItems: "stretch" }}>

                    {/* ── Style Box ── */}
                    <div style={{
                      background: "#ffffff", border: "1.5px solid #e0e0d8", borderRadius: 20,
                      padding: "24px 28px", width: "100%", boxSizing: "border-box"
                    }}>
                      <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 14, fontWeight: 800, color: "#0a0a0a", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 20 }}>
                        US Market Style Box
                      </div>
                      {/* Headers */}
                      <div style={{ display: "grid", gridTemplateColumns: "64px repeat(3,1fr)", gap: 8, marginBottom: 8 }}>
                        <div />
                        {COLS.map(c => (
                          <div key={c} style={{ textAlign: "center", fontFamily: "'Syne',sans-serif", fontSize: 11, fontWeight: 700, color: "#888888", textTransform: "uppercase", letterSpacing: "0.06em" }}>{c}</div>
                        ))}
                      </div>
                      {/* Rows */}
                      {BOX.map(({ label, keys }) => (
                        <div key={label} style={{ display: "grid", gridTemplateColumns: "64px repeat(3,1fr)", gap: 8, marginBottom: 8 }}>
                          <div style={{ display: "flex", alignItems: "center", fontFamily: "'Syne',sans-serif", fontSize: 11, fontWeight: 700, color: "#0a0a0a" }}>{label}</div>
                          {keys.map((k) => {
                            const { p, bg: _bg, fg: _fg } = toCell(k);
                            const isUp = p != null && p >= 0;
                            const isDown = p != null && p < 0;
                            const cellBg = isUp ? "#00ff8820" : isDown ? "#ff3b3b15" : "#f5f5f0";
                            const cellFg = isUp ? "#00aa55" : isDown ? "#ff3b3b" : "#94a3b8";
                            return (
                              <div key={k} style={{ background: cellBg, borderRadius: 10, padding: "18px 10px", textAlign: "center" }}>
                                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 16, fontWeight: 700, color: cellFg }}>
                                  {p != null ? `${p >= 0 ? "+" : ""}${p.toFixed(2)}%` : "—"}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ))}
                      <div style={{ fontSize: 8.5, color: "#94a3b8", marginTop: 4, letterSpacing: "0.04em" }}>Retorno diario · iShares ETFs</div>

                      {/* Fear & Greed prominente */}
                      {vixVal && (() => {
                        const score = Math.max(0, Math.min(100, Math.round(100 - ((vixVal - 10) / 30) * 100)));
                        const zone = score >= 75 ? { label: "Codicia Extrema", color: "#16a34a" }
                          : score >= 55 ? { label: "Codicia",       color: "#4ade80" }
                          : score >= 45 ? { label: "Neutral",        color: "#ca8a04" }
                          : score >= 25 ? { label: "Miedo",          color: "#f97316" }
                          :               { label: "Miedo Extremo",  color: "#dc2626" };
                        const BAR_W = 240;
                        const markerX = (score / 100) * BAR_W;
                        return (
                          <div style={{ marginTop: 16, borderTop: "1.5px solid #f0f0ea", paddingTop: 16 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 8 }}>
                              <div>
                                <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 10, fontWeight: 700, color: "#888888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>Fear &amp; Greed</div>
                                <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 11, fontWeight: 700, color: zone.color }}>{zone.label}</div>
                              </div>
                              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 32, fontWeight: 800, color: zone.color, lineHeight: 1 }}>{score}</div>
                            </div>
                            <svg width={BAR_W} height="18" style={{ display: "block", width: "100%" }} viewBox={`0 0 ${BAR_W} 18`}>
                              <defs>
                                <linearGradient id="fg-grad" x1="0" x2="1" y1="0" y2="0">
                                  <stop offset="0%"   stopColor="#dc2626" />
                                  <stop offset="25%"  stopColor="#f97316" />
                                  <stop offset="50%"  stopColor="#ca8a04" />
                                  <stop offset="75%"  stopColor="#4ade80" />
                                  <stop offset="100%" stopColor="#16a34a" />
                                </linearGradient>
                              </defs>
                              <rect x="0" y="5" width={BAR_W} height="6" rx="3" fill="url(#fg-grad)" />
                              <circle cx={markerX} cy="8" r="5" fill={zone.color} stroke="#fff" strokeWidth="2" />
                            </svg>
                            <div style={{ fontSize: 8.5, color: "#94a3b8", marginTop: 6 }}>
                              VIX <b style={{ fontFamily: "'DM Mono',monospace", color: vixColor }}>{vixVal.toFixed(2)}</b>
                              {macroData?.spread?.value != null && (
                                <span> · <b style={{ color: macroData.spread.inverted ? "#dc2626" : "#16a34a" }}>
                                  {macroData.spread.inverted ? "⚠ Inv." : `Spread +${macroData.spread.value.toFixed(2)}`}
                                </b></span>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                    </div>

                    {/* ── Mercados Globales ── */}
                    <Panel title="Desempeño Global de Mercados" color="#0ea5e9">
                      <div style={{ padding: "6px 10px 8px" }}>
                        <GlobalMarketsTable data={worldMapData} loading={worldMapLoading} />
                        <div style={{ fontSize: 8.5, color: "#94a3b8", marginTop: 6, letterSpacing: "0.04em", textAlign: "right" }}>
                          Retorno diario · iShares ETFs · desc. por rendimiento
                        </div>
                      </div>
                    </Panel>
                  </div>
                );
              })()}

              {/* ── MÉXICO ── */}
              <div className="resp-grid-2" style={{ gap: 16 }}>

                {/* Panel izquierdo: Mercado en vivo */}
                <Panel title="México · Mercado" color="#16a34a">
                  {/* IPC hero row */}
                  {(() => {
                    const d = md?.ipc;
                    return <DataRow label="IPC — Bolsa Mexicana de Valores" icon=""
                      value={d ? fv(d.value) : null} pct={d?.change_pct} hero />;
                  })()}
                  {[
                    { key: "usdmxn", label: "USD / MXN",   dec: 4, icon: "",  sub: "Tipo de cambio" },
                    { key: "eurmxn", label: "EUR / MXN",   dec: 4, icon: "", sub: "Euro vs Peso" },
                    { key: "eurusd", label: "EUR / USD",   dec: 4, icon: "" },
                    { key: "gbpusd", label: "GBP / USD",   dec: 4, icon: "" },
                    { key: "usdjpy", label: "USD / JPY",   dec: 2, icon: "" },
                  ].map(({ key, label, dec, sub, icon }) => {
                    const d = C(key, dec, false);
                    return <DataRow key={key} label={label} icon={icon} sub={sub}
                      value={d.value != null ? fv(d.value, dec) : null} pct={d.pct} />;
                  })}
                  <DataRow label="10Y Treasury EUA" icon=""
                    value={macroData?.t10y?.value != null ? fv(macroData.t10y.value, 2) + "%" : null} pct={null} />
                  <DataRow label="DXY (Índice Dólar)" icon=""
                    value={macroData?.dxy?.value != null ? fv(macroData.dxy.value, 2) : null} pct={null} />
                </Panel>

                {/* Panel derecho: Macro México */}
                <Panel title="México · Macro" color="#16a34a">
                  {MX_REF.map((r) => (
                    <div key={r.label} style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "8px 12px", borderBottom: "1px solid #e8e8e4",
                      background: "#ffffff",
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 9, color: "#888888", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "'Syne', sans-serif" }}>{r.label}</div>
                        <div style={{ fontSize: 8, color: "#aaaaaa", marginTop: 1 }}>{r.period}</div>
                      </div>
                      <div style={{
                        fontFamily: "'DM Mono', monospace", fontSize: 13, fontWeight: 700,
                        color: r.color, flexShrink: 0,
                        background: `${r.color}12`, border: `1px solid ${r.color}30`,
                        padding: "2px 8px", borderRadius: 5,
                        letterSpacing: "-0.01em",
                      }}>
                        {r.value}
                      </div>
                    </div>
                  ))}
                </Panel>
              </div>

              {/* ── MATERIAS PRIMAS & CRYPTO + ÍNDICES GLOBALES ── */}
              <div className="resp-grid-2" style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16 }}>

                <Panel title="Materias Primas y Criptoactivos" color="#d97706">
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
                    {[
                      { key: "wti",    label: "WTI Crude",   dec: 2, icon: "",  unit: " /bbl" },
                      { key: "gold",   label: "Oro",          dec: 2, icon: "",  unit: " /oz"  },
                      { key: "brent",  label: "Brent",        dec: 2, icon: "",  unit: " /bbl" },
                      { key: "silver", label: "Plata",        dec: 3, icon: "",  unit: " /oz"  },
                      { key: "natgas", label: "Gas Natural",  dec: 3, icon: "" },
                      { key: "copper", label: "Cobre",        dec: 3, icon: "",  unit: " /lb"  },
                      { key: "btc",    label: "Bitcoin",      dec: 0, icon: "BTC" },
                      { key: "eth",    label: "Ethereum",     dec: 2, icon: "⟠" },
                    ].map(({ key, label, dec, icon, unit }) => {
                      const d = C(key, dec, false);
                      return <DataRow key={key} label={label} icon={icon}
                        value={d.value != null ? fv(d.value, dec) + (unit ?? "") : null}
                        pct={d.pct} />;
                    })}
                  </div>
                </Panel>

                <Panel title="Índices Globales" color="#8b5cf6">
                  {[
                    { key: "nikkei", label: "Nikkei 225", icon: "" },
                    { key: "ftse",   label: "FTSE 100",   icon: "" },
                    { key: "dax",    label: "DAX",        icon: "" },
                    { key: "cac",    label: "CAC 40",     icon: "" },
                    { key: "hsi",    label: "Hang Seng",  icon: "" },
                  ].map(({ key, label, icon }) => {
                    const d = C(key, 2, false);
                    return <DataRow key={key} label={label} icon={icon}
                      value={d.value != null ? fv(d.value, 2) : null} pct={d.pct} />;
                  })}
                </Panel>
              </div>

              {/* ── NOTICIAS ── */}
              <div>
                <SectionLabel right={
                  marketNews.length > 0 && (
                    <div style={{ display: "flex", gap: 6 }}>
                      {[
                        { key: "all",      label: "Todas",    color: "#555555" },
                        { key: "positive", label: " Buenas", color: "#16a34a" },
                        { key: "neutral",  label: " Neutras",color: "#ca8a04" },
                        { key: "negative", label: " Malas",  color: "#dc2626" },
                      ].map((f) => {
                        const cnt = f.key === "all" ? marketNews.length : marketNews.filter(n => n.sentiment === f.key).length;
                        return (
                          <button key={f.key} onClick={() => setNewsFilter(f.key)} style={{
                            background: newsFilter === f.key ? `${f.color}15` : "transparent",
                            border: `1px solid ${newsFilter === f.key ? f.color : "#e5e5e5"}`,
                            borderRadius: 999, color: newsFilter === f.key ? f.color : "#aaaaaa",
                            padding: "3px 10px", cursor: "pointer", fontSize: 11, fontWeight: 600,
                          }}>{f.label} <span style={{ opacity: 0.6 }}>({cnt})</span></button>
                        );
                      })}
                    </div>
                  )
                }>Noticias Financieras</SectionLabel>

                {marketNewsLoading && marketNews.length === 0 && (
                  <div style={{ display: "flex", justifyContent: "center", padding: "56px 0", gap: 14, alignItems: "center" }}>
                    <Spinner size={22} />
                    <span style={{ color: "#aaaaaa", fontSize: 13 }}>Cargando noticias de mercado...</span>
                  </div>
                )}

                {filteredNews.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {filteredNews.map((item, i) => <MarketNewsItem key={i} item={item} index={i} />)}
                  </div>
                )}

                {!marketNewsLoading && marketNews.length > 0 && filteredNews.length === 0 && (
                  <div style={{ textAlign: "center", color: "#aaaaaa", padding: 32, fontSize: 13 }}>
                    No hay noticias {newsFilter === "positive" ? "positivas" : newsFilter === "negative" ? "negativas" : "neutras"} ahora.
                  </div>
                )}

                {!marketNewsLoading && marketNews.length === 0 && (
                  <div style={{
                    textAlign: "center", color: "#aaaaaa", padding: 48, fontSize: 13,
                    background: "#f8f8f8", borderRadius: 24, border: "1px dashed #e5e5e5"
                  }}>
                    No se cargaron noticias — haz clic en <b>↻ Noticias</b> para reintentar
                  </div>
                )}
              </div>

              {/* ── BUSCAR POR TICKER ── */}
              <div>
                <SectionLabel>Buscar Noticias por Ticker</SectionLabel>
                <div style={{ background: "#ffffff", borderRadius: 24, boxShadow: "none", border: "1.5px solid #e0e0d8", padding: 20 }}>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
                    <input value={newsTicker}
                      onChange={(e) => setNewsTicker(e.target.value.toUpperCase())}
                      onKeyDown={(e) => e.key === "Enter" && loadNews(newsTicker)}
                      placeholder="AAPL / WALMEX.MX / AMZN.MX"
                      style={{
                        background: "#f8f8f8", border: "1px solid #e5e5e5", borderRadius: 10,
                        color: "#111111", padding: "9px 14px", fontSize: 13, width: 220,
                        fontFamily: "'DM Mono', monospace",
                      }} />
                    <button onClick={() => loadNews(newsTicker)} disabled={newsLoading} style={{
                      background: newsLoading ? "#e5e5e5" : "#111111", border: "none",
                      borderRadius: 999, color: "#fff", padding: "9px 22px",
                      cursor: newsLoading ? "not-allowed" : "pointer",
                      fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 8,
                    }}>
                      {newsLoading && <Spinner size={14} />}
                      {newsLoading ? "Cargando..." : "◉ Buscar"}
                    </button>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {portfolio.map((p) => (
                        <button key={p.ticker} onClick={() => { setNewsTicker(p.ticker); loadNews(p.ticker); }} style={{
                          background: newsTicker === p.ticker ? "#fff7ed" : "#f2f2f2",
                          border: `1px solid ${newsTicker === p.ticker ? "#00ff88" : "transparent"}`,
                          borderRadius: 999, color: newsTicker === p.ticker ? "#c2410c" : "#666666",
                          padding: "5px 12px", cursor: "pointer", fontSize: 11,
                          fontFamily: "'DM Mono', monospace", fontWeight: 600,
                        }}>{p.ticker}</button>
                      ))}
                    </div>
                  </div>
                  {newsData.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {newsData.map((item, i) => <MarketNewsItem key={i} item={item} index={i} />)}
                    </div>
                  )}
                  {!newsLoading && newsData.length === 0 && newsTicker && (
                    <div style={{ color: "#aaaaaa", fontSize: 13, textAlign: "center", padding: "20px 0" }}>
                      No se encontraron noticias para <b style={{ color: "#555" }}>{newsTicker}</b>
                    </div>
                  )}
                </div>
              </div>

            </div>
          );
        })()}

        {/* ─── TAB: ANALYTICS ─── */}
        {tab === "analytics" && (
          <div>
            <div style={{
              background: "#ffffff", borderRadius: 24, boxShadow: "none", border: "1.5px solid #e0e0d8",
              padding: 20, marginBottom: 28
            }}>
              {/* Selector de portafolio */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                <span style={{ fontSize: 10, color: "#bbbbbb", letterSpacing: "0.1em", fontWeight: 600 }}>PORTAFOLIO A ANALIZAR</span>
                {portfolios.map(p => (
                  <button key={p.id} onClick={() => setActivePortfolioId(p.id)} style={{
                    background: activePortfolioId === p.id ? "#00ff88" : "#f2f2f2",
                    color: activePortfolioId === p.id ? "#ffffff" : "#555555",
                    border: "none", borderRadius: 999, padding: "4px 14px",
                    fontSize: 12, fontWeight: activePortfolioId === p.id ? 700 : 500, cursor: "pointer"
                  }}>{p.name} <span style={{ opacity: 0.7 }}>({p.positions.length})</span></button>
                ))}
              </div>
              <div style={{ fontSize: 14, color: "#555555", marginBottom: 16, lineHeight: 1.6 }}>
                Backtesting de <b style={{ color: "#111111" }}>5 años</b> con datos semanales comparado contra{" "}
                <b style={{ color: "#888888" }}>SPY (S&P 500)</b>. Los pesos se calculan con los valores de mercado actuales.
              </div>
              <button onClick={runBacktest} disabled={backtestLoading} className="btn-exec" style={{
                background: backtestLoading ? "#999999" : "#0a0a0a",
                border: "none", borderRadius: 999, color: "#ffffff",
                padding: "12px 28px", cursor: backtestLoading ? "not-allowed" : "pointer",
                fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", gap: 10
              }}>
                {backtestLoading && <Spinner size={16} />}
                {backtestLoading ? "Calculando backtest... (puede tardar 1–2 min con 5 años)" : " Ejecutar Backtest vs SPY"}
              </button>
              {backtestError && (
                <div style={{ marginTop: 12, padding: "10px 16px", background: "#fff0f0", border: "1px solid #ffcccc", borderRadius: 10, fontSize: 13, color: "#cc0000", lineHeight: 1.5 }}>
                  ⚠️ {backtestError}
                </div>
              )}
            </div>

            {backtestResult && (() => {
              const { portCum, spyCum, dates, beta, trackingError, treynor, alpha, infoRatio, sharpe, annPortReturn, annSpyReturn, yearsBacktest, limitingTickerBack, tickerYearsBack } = backtestResult;
              if (!portCum?.length || portCum.length < 5) return (
                <div style={{ padding: "20px", background: "#fff8e6", border: "1px solid #fcd34d", borderRadius: 12, margin: "12px 0", color: "#92400e", fontSize: 13 }}>
                  ⚠️ No hay suficientes datos para mostrar el backtest. Puede que algunos tickers del portafolio no tengan historial en yfinance. Revisa la consola del navegador para más detalles.
                </div>
              );
              const outperforms = annPortReturn > annSpyReturn;

              const statCard = (label, value, unit, _hint) => (
                <div style={{
                  background: "#0a0a0a", borderRadius: 20, boxShadow: "none", border: "none",
                  padding: "16px 20px", minWidth: 140, flex: 1
                }}>
                  <div style={{ fontSize: 10, color: "#888888", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6, fontFamily: "'DM Sans', sans-serif" }}>{label}</div>
                  <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 28, fontWeight: 500, color: "#00ff88" }}>
                    {value}{unit ?? ""}
                  </div>
                </div>
              );

              return (
                <div style={{ animation: "fadeIn 0.5s ease" }}>
                  <div style={{ background: "#ffffff", borderRadius: 24, boxShadow: "none", border: "1.5px solid #e0e0d8", padding: 20, marginBottom: 24 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
                      <div style={{ fontSize: 12, color: "#999999", letterSpacing: "0.07em", fontWeight: 500 }}>
                        RETORNOS ACUMULADOS — PORTAFOLIO vs SPY ({yearsBacktest ?? "5"} AÑOS SEMANAL)
                      </div>
                      {yearsBacktest && parseFloat(yearsBacktest) < 4.5 && (
                        <div style={{ fontSize: 11, color: "#92400e", background: "#fffbe6", border: "1px solid #fcd34d", borderRadius: 6, padding: "2px 8px" }}>
                          ⚠️ Limitado a {yearsBacktest}a por {limitingTickerBack}
                        </div>
                      )}
                    </div>
                    {yearsBacktest && parseFloat(yearsBacktest) < 4.5 && tickerYearsBack && (
                      <div style={{ marginBottom: 12, display: "flex", flexWrap: "wrap", gap: "4px 12px" }}>
                        {tickerYearsBack.map(({ t, y }) => (
                          <span key={t} style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: parseFloat(y) < 3 ? "#dc2626" : "#888888" }}>
                            {t.split(".")[0]}: {y}a
                          </span>
                        ))}
                      </div>
                    )}
                    <LineChart
                      series={[
                        { name: "Mi Portafolio", color: "#00cc6a", data: portCum },
                        { name: "SPY (S&P 500)", color: "#888888", data: spyCum },
                      ]}
                      dates={dates}
                    />
                  </div>

                  <div style={{
                    background: outperforms ? "#22c55e10" : "#ff3b3b15",
                    border: outperforms ? "1px solid #22c55e33" : "none",
                    borderLeft: outperforms ? "none" : "3px solid #ff3b3b",
                    borderRadius: outperforms ? 24 : 16, padding: "14px 20px", marginBottom: 24,
                    display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
                    fontFamily: "'DM Sans', sans-serif",
                  }}>
                    <div style={{ fontSize: 22 }}>{outperforms ? "" : ""}</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: outperforms ? "#16a34a" : "#dc2626" }}>
                        {outperforms ? "Superando al benchmark" : "Por debajo del benchmark"}
                      </div>
                      <div style={{ fontSize: 12, color: "#666666", marginTop: 2 }}>
                        Portafolio: <b style={{ fontFamily: "'DM Mono', monospace", color: "#111111" }}>{(annPortReturn * 100).toFixed(2)}%</b> anual
                        {" "}vs SPY: <b style={{ fontFamily: "'DM Mono', monospace", color: "#111111" }}>{(annSpyReturn * 100).toFixed(2)}%</b> anual
                        {" — "}Alpha: <b style={{ fontFamily: "'DM Mono', monospace", color: alpha >= 0 ? "#16a34a" : "#dc2626" }}>
                          {alpha >= 0 ? "+" : ""}{(alpha * 100).toFixed(2)}%
                        </b>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
                    {statCard("Tracking Error", (trackingError * 100).toFixed(2), "%",
                      trackingError < 0.05 ? "#16a34a" : trackingError < 0.10 ? "#eab308" : "#dc2626")}
                    {statCard("Índice de Treynor", treynor.toFixed(4), "",
                      treynor > 0.1 ? "#16a34a" : treynor > 0 ? "#eab308" : "#dc2626")}
                    {statCard("Beta (vs SPY)", beta.toFixed(4), "",
                      beta < 1 ? "#16a34a" : beta < 1.2 ? "#eab308" : "#dc2626")}
                    {statCard("Alpha de Jensen", `${alpha >= 0 ? "+" : ""}${(alpha * 100).toFixed(2)}`, "%",
                      alpha >= 0 ? "#16a34a" : "#dc2626")}
                    {statCard("Sharpe Ratio", sharpe.toFixed(4), "",
                      sharpe > 1 ? "#16a34a" : sharpe > 0.5 ? "#eab308" : "#dc2626")}
                    {statCard("Information Ratio", infoRatio.toFixed(4), "",
                      infoRatio > 0.5 ? "#16a34a" : infoRatio > 0 ? "#eab308" : "#dc2626")}
                  </div>

                  {/* Heatmap de correlación */}
                  {backtestResult?.corrMatrix && (() => {
                    const { corrMatrix: cm, tickers: tks } = backtestResult;
                    return (
                      <div style={{ background: "#ffffff", borderRadius: 24, boxShadow: "none", border: "1.5px solid #e0e0d8", padding: 20, marginBottom: 20 }}>
                        <div style={{ fontSize: 10, color: "#bbbbbb", letterSpacing: "0.14em", fontWeight: 600, marginBottom: 16 }}>MATRIZ DE CORRELACIÓN DE ACTIVOS</div>
                        <div style={{ overflowX: "auto" }}>
                          <table style={{ borderCollapse: "separate", borderSpacing: 3 }}>
                            <thead>
                              <tr>
                                <th style={{ padding: "4px 8px", fontSize: 10, color: "#bbbbbb", textAlign: "right", border: "none", background: "none" }}></th>
                                {tks.map(tk => <th key={tk} style={{ padding: "4px 8px", fontSize: 10, fontFamily: "'DM Mono', monospace", color: "#555555", border: "none", background: "none", textAlign: "center" }}>{tk.split(".")[0]}</th>)}
                              </tr>
                            </thead>
                            <tbody>
                              {cm.map((row, i) => (
                                <tr key={tks[i]}>
                                  <td style={{ padding: "4px 8px", fontSize: 10, fontFamily: "'DM Mono', monospace", color: "#555555", fontWeight: 700, border: "none", textAlign: "right", whiteSpace: "nowrap" }}>{tks[i].split(".")[0]}</td>
                                  {row.map((val, j) => {
                                    let bg, fg;
                                    if (i === j) { bg = "#111111"; fg = "#ffffff"; }
                                    else if (val >= 0.7)  { bg = `rgba(220,38,38,${0.15 + val * 0.4})`; fg = "#991b1b"; }
                                    else if (val >= 0.4)  { bg = `rgba(234,179,8,${0.15 + val * 0.3})`; fg = "#92400e"; }
                                    else if (val >= 0)    { bg = `rgba(22,163,74,${0.1 + val * 0.3})`; fg = "#14532d"; }
                                    else                  { bg = `rgba(249,115,22,${0.1 + Math.abs(val) * 0.4})`; fg = "#9a3412"; }
                                    return (
                                      <td key={j} style={{ padding: "6px 10px", background: bg, borderRadius: 6, textAlign: "center", fontSize: 11, fontFamily: "'DM Mono', monospace", fontWeight: 700, color: fg, cursor: "default", minWidth: 52 }}>
                                        {val.toFixed(2)}
                                      </td>
                                    );
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div style={{ marginTop: 10, display: "flex", gap: 16, fontSize: 10, color: "#bbbbbb" }}>
                          <span style={{ color: "#16a34a" }}>■ Baja correlación (buena diversificación)</span>
                          <span style={{ color: "#eab308" }}>■ Correlación media</span>
                          <span style={{ color: "#dc2626" }}>■ Alta correlación (&gt;0.7 = riesgo de concentración)</span>
                          <span style={{ color: "#00cc6a" }}>■ Correlación negativa (cobertura natural)</span>
                        </div>
                      </div>
                    );
                  })()}

                  <div style={{ background: "#ffffff", borderRadius: 24, boxShadow: "none", border: "1.5px solid #e0e0d8", padding: "16px 20px" }}>
                    <div style={{ fontSize: 12, color: "#999999", letterSpacing: "0.07em", fontWeight: 500, marginBottom: 12 }}>GLOSARIO DE MÉTRICAS</div>
                    <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
                      {[
                        ["Tracking Error", "Desv. estándar anualizada de la diferencia de retornos vs SPY. Menor = más parecido al índice."],
                        ["Índice de Treynor", "(Retorno portafolio − Rf) / Beta. Mide retorno por unidad de riesgo sistemático."],
                        ["Beta (vs SPY)", "Sensibilidad a movimientos del mercado. Beta < 1 es más defensivo, > 1 más agresivo."],
                        ["Alpha de Jensen", "Exceso de retorno vs lo esperado por el CAPM. Alpha > 0 indica generación de valor."],
                        ["Sharpe Ratio", "(Retorno − Rf) / Volatilidad total. Retorno ajustado por riesgo total."],
                        ["Information Ratio", "(Retorno portafolio − Retorno SPY) / Tracking Error. Mide consistencia del alpha."],
                      ].map(([name, desc]) => (
                        <div key={name} style={{ display: "flex", gap: 10 }}>
                          <div style={{ minWidth: 4, borderRadius: 2, background: "#111111", alignSelf: "stretch" }} />
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 600, color: "#666666", marginBottom: 2 }}>{name}</div>
                            <div style={{ fontSize: 11, color: "#999999", lineHeight: 1.5 }}>{desc}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* ── MONTE CARLO ── */}
            <div style={{
              background: "#ffffff", borderRadius: 24, boxShadow: "none", border: "1.5px solid #e0e0d8",
              padding: 20, marginTop: 24
            }}>
              <div style={{ fontSize: 12, color: "#999999", letterSpacing: "0.07em", fontWeight: 500, marginBottom: 8 }}>
                PROYECCIÓN FUTURA — MONTE CARLO
              </div>
              <div style={{ fontSize: 13, color: "#555555", marginBottom: 14, lineHeight: 1.6 }}>
                Simulación de <b style={{ color: "#111111" }}>10,000 escenarios</b> a 52 semanas usando retornos históricos de{" "}
                <b style={{ color: "#111111" }}>5 años</b>. Muestra el rango p5–p95 del portafolio vs SPY.
              </div>
              <button onClick={runMonteCarlo} disabled={monteCarloLoading || portfolio.length === 0} className="btn-exec" style={{
                background: monteCarloLoading ? "#999999" : "#0a0a0a",
                border: "none", borderRadius: 999, color: "#ffffff",
                padding: "12px 28px", cursor: monteCarloLoading ? "not-allowed" : "pointer",
                fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", gap: 10
              }}>
                {monteCarloLoading && <Spinner size={16} />}
                {monteCarloLoading ? "Simulando... (puede tardar 1–2 min)" : " Ejecutar Monte Carlo (5 años)"}
              </button>
              {monteCarloError && (
                <div style={{ marginTop: 12, padding: "10px 16px", background: "#fff0f0", border: "1px solid #ffcccc", borderRadius: 10, fontSize: 13, color: "#cc0000", lineHeight: 1.5 }}>
                  ⚠️ {monteCarloError}
                </div>
              )}
            </div>

            {monteCarloResult && (() => {
              const { portStats, spyStats, weeks, N, yearsData, limitingTicker, tickerYears, muPort, sigPort, muSpy, sigSpy, probBeat } = monteCarloResult;
              const portMeanEnd   = portStats[portStats.length - 1].mean;
              const spyMeanEnd    = spyStats[spyStats.length - 1].mean;
              const portAnnReturn = (Math.pow(portMeanEnd, 52 / portStats.length) - 1) * 100;
              const spyAnnReturn  = (Math.pow(spyMeanEnd,  52 / spyStats.length)  - 1) * 100;
              const portP5  = portStats[portStats.length - 1].p5;
              const portP95 = portStats[portStats.length - 1].p95;

              const mcCard = (label, value, color, sub) => (
                <div style={{ background: "#ffffff", borderRadius: 24, boxShadow: "none", border: "1.5px solid #e0e0d8", padding: "16px 20px", flex: 1, minWidth: 140 }}>
                  <div style={{ fontSize: 10, color: "#999999", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
                  <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 20, fontWeight: 700, color: color ?? "#111111" }}>{value}</div>
                  {sub && <div style={{ fontSize: 10, color: "#bbbbbb", marginTop: 4 }}>{sub}</div>}
                </div>
              );

              return (
                <div style={{ animation: "fadeIn 0.5s ease", marginTop: 20 }}>
                  <div style={{ background: "#ffffff", borderRadius: 24, boxShadow: "none", border: "1.5px solid #e0e0d8", padding: 20, marginBottom: 20 }}>
                    <div style={{ fontSize: 12, color: "#999999", letterSpacing: "0.07em", fontWeight: 500, marginBottom: 14 }}>
                      RETORNOS PROYECTADOS — {N.toLocaleString()} SIMULACIONES · {yearsData} AÑOS DE HISTORIAL
                    </div>
                    <MonteCarloChart portStats={portStats} spyStats={spyStats} weeks={weeks} />
                  </div>

                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
                    {mcCard("Retorno esperado (port.)", `${portAnnReturn >= 0 ? "+" : ""}${portAnnReturn.toFixed(1)}%`,
                      portAnnReturn >= 0 ? "#16a34a" : "#dc2626", "anualizado · media de simulaciones")}
                    {mcCard("Retorno esperado (SPY)", `${spyAnnReturn >= 0 ? "+" : ""}${spyAnnReturn.toFixed(1)}%`,
                      spyAnnReturn >= 0 ? "#16a34a" : "#dc2626", "anualizado · media de simulaciones")}
                    {mcCard("Prob. superar SPY", `${(probBeat * 100).toFixed(1)}%`,
                      probBeat > 0.55 ? "#16a34a" : probBeat > 0.45 ? "#eab308" : "#dc2626", "en el horizonte de 1 año")}
                    {mcCard("Rango portafolio (90%)", `${((portP5-1)*100).toFixed(1)}% a ${((portP95-1)*100).toFixed(1)}%`,
                      "#00ff88", "p5 – p95 al final del período")}
                  </div>

                  <div style={{ background: "#f5f5f0", borderRadius: 24, padding: "14px 20px", display: "flex", flexWrap: "wrap", gap: 24 }}>
                    {[
                      ["Retorno med. semanal (port.)", `${(muPort * 100).toFixed(3)}%`],
                      ["Vol. semanal (port.)",          `${(sigPort * 100).toFixed(3)}%`],
                      ["Retorno med. semanal (SPY)",   `${(muSpy  * 100).toFixed(3)}%`],
                      ["Vol. semanal (SPY)",            `${(sigSpy  * 100).toFixed(3)}%`],
                      ["Simulaciones",                  N.toLocaleString()],
                      ["Años de historial",             yearsData],
                    ].map(([label, val]) => (
                      <div key={label}>
                        <div style={{ fontSize: 10, color: "#aaaaaa", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 3 }}>{label}</div>
                        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, fontWeight: 600, color: "#333333" }}>{val}</div>
                      </div>
                    ))}
                  </div>
                  {limitingTicker && parseFloat(yearsData) < 4.5 && (
                    <div style={{ marginTop: 12, padding: "10px 14px", background: "#fffbe6", border: "1px solid #fcd34d", borderRadius: 10, fontSize: 12, color: "#92400e" }}>
                      ⚠️ El historial está limitado a <b>{yearsData} años</b> por <b style={{ fontFamily: "'DM Mono',monospace" }}>{limitingTicker}</b> (el ticker con menos datos disponibles en yfinance).
                      Los demás activos sí tienen más historial pero se recortan al mínimo común para mantener consistencia estadística.
                      {tickerYears && (
                        <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: "6px 16px" }}>
                          {tickerYears.map(({ t, y }) => (
                            <span key={t} style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: parseFloat(y) < 3 ? "#dc2626" : "#555555" }}>
                              {t.split(".")[0]}: {y}a
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

          </div>
        )}

        {/* ─── TAB: INSIDERS ─── */}
        {/* ─── TAB: FIBRA SCREENER ─── */}
        {tab === "fibras" && (
          <div>
            {/* Header explicativo */}
            <div style={{ background: "#ffffff", boxShadow: "none", border: "1.5px solid #e0e0d8", borderRadius: 24, padding: 20, marginBottom: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#111111", marginBottom: 6 }}>FIBRA Screener</div>
                  <div style={{ fontSize: 12, color: "#777777", lineHeight: 1.6, maxWidth: 680 }}>
                    Fideicomisos de Infraestructura y Bienes Raíces (REITs mexicanos). Valuación por <b style={{ color: "#111111" }}>Cap Rate</b>, <b style={{ color: "#111111" }}>P/NAV</b> (precio vs valor activo neto) y <b style={{ color: "#111111" }}>FFO Yield</b>.
                    Una FIBRA con P/NAV {"<"} 0.85 cotiza con <b style={{ color: "#16a34a" }}>descuento</b> al valor de sus activos — señal de oportunidad.
                    Cap Rate alto indica mayor rendimiento operativo sobre el valor del portafolio.
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      value={fibrasExtra}
                      onChange={e => setFibrasExtra(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && !fibrasLoading && runFibrasScreener()}
                      placeholder="Agregar tickers: FREAL.MX, VESTA.MX..."
                      style={{
                        background: "#f8f8f8", border: "1.5px solid #e0e0d8", borderRadius: 10,
                        padding: "10px 14px", fontSize: 12, color: "#111111",
                        fontFamily: "'DM Mono', monospace", width: 240, outline: "none"
                      }}
                    />
                    <button onClick={runFibrasScreener} disabled={fibrasLoading} className="btn-exec" style={{
                      background: fibrasLoading ? "#e5e5e5" : "#0a0a0a",
                      border: "none", borderRadius: 999, color: "#ffffff",
                      padding: "12px 28px", fontSize: 14, fontWeight: 700,
                      cursor: fibrasLoading ? "not-allowed" : "pointer",
                      display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap"
                    }}>
                      {fibrasLoading && <Spinner size={16} />}
                      {fibrasLoading ? "Cargando..." : "Analizar FIBRAs"}
                    </button>
                  </div>
                  <div style={{ fontSize: 10, color: "#bbbbbb", textAlign: "right" }}>
                    Las FIBRAs básicas siempre se incluyen · Agrega tickers extra separados por coma
                  </div>
                </div>
              </div>

              {/* Leyenda de métricas */}
              <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
                {[
                  { label: "Cap Rate", desc: "NOI / EV — rendimiento operativo del portafolio" },
                  { label: "P/NAV", desc: "Precio / valor activo neto. <0.85 = descuento" },
                  { label: "FFO Yield", desc: "Free Cash Flow / Market Cap" },
                  { label: "Dist. Yield", desc: "Rendimiento por distribuciones" },
                  { label: "LTV", desc: "Deuda / (deuda + cap. bursátil)" },
                ].map(m => (
                  <div key={m.label} style={{ background: "#f8f8f8", borderRadius: 8, padding: "5px 10px" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#111111" }}>{m.label}</span>
                    <span style={{ fontSize: 10, color: "#999999", marginLeft: 6 }}>{m.desc}</span>
                  </div>
                ))}
              </div>
            </div>

            {!fibrasData && !fibrasLoading && (
              <div style={{ textAlign: "center", color: "#bbbbbb", fontSize: 13, marginTop: 60 }}>
                Presiona "Analizar FIBRAs" para cargar las principales FIBRAs mexicanas
              </div>
            )}

            {fibrasData?.fibras?.length === 0 && (
              <div style={{ textAlign: "center", color: "#dc2626", fontSize: 13, marginTop: 40 }}>
                No se pudieron obtener datos. Verifica que el backend esté corriendo.
              </div>
            )}

            {fibrasData?.fibras?.length > 0 && (
              <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
                {fibrasData.fibras.map((f) => {
                  const sigColor = f.signal === "OPORTUNIDAD" ? "#16a34a" : f.signal === "CARA" ? "#dc2626" : "#eab308";
                  const sigBg    = f.signal === "OPORTUNIDAD" ? "#f0fdf4"  : f.signal === "CARA" ? "#fff7f7"  : "#fffbeb";
                  const navPct   = f.navDiscount;
                  return (
                    <div key={f.ticker} style={{
                      background: "#ffffff", boxShadow: "none", border: "1.5px solid #e0e0d8",
                      borderRadius: 24, padding: 20, borderTop: `3px solid ${sigColor}`
                    }}>
                      {/* Header */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                        <div>
                          <div style={{ fontFamily: "'DM Mono', monospace", fontWeight: 700, fontSize: 15, color: "#111111" }}>{f.ticker}</div>
                          <div style={{ fontSize: 11, color: "#666666", marginTop: 2 }}>{f.name}</div>
                          <div style={{ fontSize: 13, fontFamily: "'DM Mono', monospace", color: "#555555", marginTop: 4 }}>
                            ${f.price?.toLocaleString("es-MX", { minimumFractionDigits: 2 })} <span style={{ fontSize: 10, color: "#bbbbbb" }}>{f.currency}</span>
                          </div>
                        </div>
                        <div style={{ background: sigBg, borderRadius: 10, padding: "6px 12px", textAlign: "center" }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: sigColor, letterSpacing: "0.1em" }}>{f.signal}</div>
                          {f.pNAV != null && (
                            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 20, fontWeight: 700, color: sigColor, marginTop: 2 }}>
                              {f.pNAV}x
                            </div>
                          )}
                          <div style={{ fontSize: 9, color: "#bbbbbb" }}>P/NAV</div>
                        </div>
                      </div>

                      {/* Métricas en grid 2×3 */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
                        {[
                          { label: "Cap Rate",    value: f.capRate  != null ? `${f.capRate}%`  : "—", color: f.capRate  > 8 ? "#16a34a" : f.capRate  > 5 ? "#eab308" : "#dc2626" },
                          { label: "Desc/Prima",  value: navPct     != null ? `${navPct > 0 ? "+" : ""}${navPct}%` : "—", color: navPct < -5 ? "#16a34a" : navPct > 5 ? "#dc2626" : "#eab308" },
                          { label: "FFO Yield",   value: f.ffoYield != null ? `${f.ffoYield}%` : "—", color: f.ffoYield > 6 ? "#16a34a" : "#555555" },
                          { label: "Dist. Yield", value: f.divYield != null ? `${f.divYield}%` : "—", color: f.divYield > 6 ? "#16a34a" : "#555555" },
                          { label: "LTV",         value: f.ltv      != null ? `${f.ltv}%`      : "—", color: f.ltv < 40 ? "#16a34a" : f.ltv < 55 ? "#eab308" : "#dc2626" },
                          { label: "NAV/acc",     value: f.navPS    != null ? `$${f.navPS.toLocaleString("es-MX", { minimumFractionDigits: 2 })}` : "—", color: "#111111" },
                        ].map(m => (
                          <div key={m.label} style={{ background: "#f8f8f8", borderRadius: 8, padding: "8px 10px" }}>
                            <div style={{ fontSize: 9, color: "#bbbbbb", letterSpacing: "0.08em", fontWeight: 600 }}>{m.label}</div>
                            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 14, fontWeight: 700, color: m.color, marginTop: 2 }}>{m.value}</div>
                          </div>
                        ))}
                      </div>

                      {/* Barra P/NAV visual (rango 0.5x → 1.5x) */}
                      {f.pNAV != null && (
                        <div style={{ marginTop: 4 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#bbbbbb", marginBottom: 3 }}>
                            <span>0.5x</span>
                            <span style={{ color: "#16a34a" }}>0.85x</span>
                            <span style={{ color: "#eab308" }}>1.0x</span>
                            <span style={{ color: "#dc2626" }}>1.15x</span>
                            <span>1.5x</span>
                          </div>
                          <div style={{ background: "#f2f2f2", borderRadius: 4, height: 6, position: "relative" }}>
                            <div style={{ position: "absolute", left: "35%", width: "30%", height: "100%", background: "#dcfce7", borderRadius: 4 }} />
                            <div style={{
                              position: "absolute",
                              left: `${Math.min(Math.max((f.pNAV - 0.5) / 1.0 * 100, 2), 98)}%`,
                              top: -3, width: 12, height: 12,
                              background: sigColor, borderRadius: "50%",
                              transform: "translateX(-50%)",
                              border: "2px solid #fff",
                              boxShadow: "0 1px 4px rgba(0,0,0,0.2)"
                            }} />
                          </div>
                        </div>
                      )}

                      {/* Badges */}
                      <div style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <span style={{ background: "#f2f2f2", borderRadius: 6, padding: "2px 8px", fontSize: 10, color: "#666666" }}>{f.sector}</span>
                        {f.marketCap && (
                          <span style={{ background: "#f2f2f2", borderRadius: 6, padding: "2px 8px", fontSize: 10, color: "#666666" }}>
                            Cap ${(f.marketCap / 1e9).toFixed(1)}B {f.currency}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ─── TAB: FÓRMULA MÁGICA ─── */}
        {tab === "magic" && (
          <div>
            {/* Header */}
            <div style={{ background: "#ffffff", boxShadow: "none", border: "1.5px solid #e0e0d8", borderRadius: 24, padding: 20, marginBottom: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
                <div style={{ flex: 1, minWidth: 280 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#111111", marginBottom: 4 }}>
                    Fórmula Mágica · Joel Greenblatt
                  </div>
                  <div style={{ fontSize: 11, color: "#777777", lineHeight: 1.7, maxWidth: 700 }}>
                    Clasifica empresas del S&P 500 combinando <b style={{ color: "#111111" }}>calidad</b> y <b style={{ color: "#111111" }}>precio</b>.
                    Ordena por rango combinado de dos métricas — el menor rango es la mejor oportunidad.
                    Excluye bancos, aseguradoras, utilities y REITs.
                  </div>
                  {/* Fórmulas */}
                  <div style={{ display: "flex", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
                    <div style={{ background: "#f8f8f8", borderRadius: 10, padding: "10px 14px", minWidth: 220 }}>
                      <div style={{ fontSize: 9, color: "#bbbbbb", letterSpacing: "0.1em", fontWeight: 600, marginBottom: 4 }}>EARNINGS YIELD (precio)</div>
                      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: "#111111" }}>EY = EBIT / Enterprise Value</div>
                      <div style={{ fontSize: 10, color: "#999999", marginTop: 3 }}>Mayor % = más barata la acción</div>
                    </div>
                    <div style={{ background: "#f8f8f8", borderRadius: 10, padding: "10px 14px", minWidth: 220 }}>
                      <div style={{ fontSize: 9, color: "#bbbbbb", letterSpacing: "0.1em", fontWeight: 600, marginBottom: 4 }}>RETURN ON CAPITAL (calidad)</div>
                      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: "#111111" }}>ROC = EBIT / (NWC + PP&E neto)</div>
                      <div style={{ fontSize: 10, color: "#999999", marginTop: 3 }}>Mayor % = negocio más eficiente</div>
                    </div>
                  </div>
                </div>
                <button onClick={runMagicFormula} disabled={magicLoading} className="btn-exec" style={{
                  background: magicLoading ? "#e5e5e5" : "#0a0a0a",
                  border: "none", borderRadius: 999, color: "#ffffff",
                  padding: "12px 28px", fontSize: 14, fontWeight: 700,
                  cursor: magicLoading ? "not-allowed" : "pointer",
                  display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap", alignSelf: "flex-start"
                }}>
                  {magicLoading && <Spinner size={16} />}
                  {magicLoading ? "Analizando S&P 500..." : " Ejecutar Fórmula Mágica"}
                </button>
              </div>
              {magicData && (
                <div style={{ marginTop: 12, fontSize: 11, color: "#999999" }}>
                  Universo analizado: <b style={{ color: "#555555" }}>{magicData.count}</b> empresas calificables
                  de {magicData.universe} en lista · Mostrando top 30
                </div>
              )}
            </div>

            {magicLoading && (
              <div style={{ background: "#ffffff", boxShadow: "none", border: "1.5px solid #e0e0d8", borderRadius: 24, padding: 28 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#111111" }}>
                      Analizando universo S&P 500...
                    </div>
                    <div style={{ fontSize: 11, color: "#999999", marginTop: 3 }}>
                      Procesando <b style={{ fontFamily: "'DM Mono', monospace", color: "#00cc6a" }}>{magicProgress.current}</b>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 22, fontWeight: 700, color: "#111111" }}>
                      {magicProgress.done}<span style={{ fontSize: 13, color: "#bbbbbb" }}>/{magicProgress.total}</span>
                    </div>
                    <div style={{ fontSize: 10, color: "#bbbbbb" }}>tickers analizados</div>
                  </div>
                </div>
                <div style={{ background: "#f2f2f2", borderRadius: 8, height: 8, overflow: "hidden" }}>
                  <div style={{
                    width: `${magicProgress.total > 0 ? (magicProgress.done / magicProgress.total) * 100 : 0}%`,
                    height: "100%", background: "#111111", borderRadius: 8,
                    transition: "width 0.3s ease"
                  }} />
                </div>
                <div style={{ fontSize: 10, color: "#bbbbbb", marginTop: 8 }}>
                  Estimado: ~{Math.max(1, Math.round((magicProgress.total - magicProgress.done) * 0.2 / 60))} min restantes
                </div>
              </div>
            )}

            {!magicData && !magicLoading && (
              <div style={{ textAlign: "center", color: "#bbbbbb", fontSize: 13, marginTop: 60 }}>
                Presiona "Ejecutar Fórmula Mágica" para analizar el universo del S&P 500
              </div>
            )}

            {magicData?.stocks?.length > 0 && (() => {
              // ── Filtrado ──────────────────────────────────────────────────
              const sectors = ["Todos", ...new Set(magicData.stocks.map(s => s.sector).filter(Boolean))].sort();
              const minEY  = parseFloat(magicMinEY)  || 0;
              const minROC = parseFloat(magicMinROC) || 0;

              let filtered = magicData.stocks.filter(s =>
                (magicSector === "Todos" || s.sector === magicSector) &&
                s.ey  >= minEY &&
                s.roc >= minROC
              );

              // ── Ordenamiento ──────────────────────────────────────────────
              const { col, dir } = magicSort;
              filtered = [...filtered].sort((a, b) => {
                const va = a[col] ?? (dir === "asc" ? Infinity : -Infinity);
                const vb = b[col] ?? (dir === "asc" ? Infinity : -Infinity);
                return dir === "asc" ? va - vb : vb - va;
              });

              const toggleSort = (c) => setMagicSort(prev =>
                prev.col === c ? { col: c, dir: prev.dir === "asc" ? "desc" : "asc" } : { col: c, dir: c === "magic_rank" ? "asc" : "desc" }
              );
              const sortIcon = (c) => magicSort.col === c ? (magicSort.dir === "asc" ? " ↑" : " ↓") : " ·";

              const cols = [
                { label: "#",        key: null,         w: "40px",  right: false },
                { label: "Rank" + sortIcon("magic_rank"), key: "magic_rank", w: "52px",  right: false },
                { label: "Empresa",  key: null,         w: "1fr",   right: false },
                { label: "EY %" + sortIcon("ey"),       key: "ey",  w: "80px",  right: true },
                { label: "ROC %" + sortIcon("roc"),     key: "roc", w: "80px",  right: true },
                { label: "P/E" + sortIcon("pe"),        key: "pe",  w: "70px",  right: true },
                { label: "P/B" + sortIcon("pb"),        key: "pb",  w: "70px",  right: true },
                { label: "#EY",      key: "rank_ey",    w: "54px",  right: true },
                { label: "#ROC",     key: "rank_roc",   w: "54px",  right: true },
              ];
              const gridCols = cols.map(c => c.w).join(" ");

              return (
                <div>
                  {/* ── Barra de filtros ── */}
                  <div style={{
                    background: "#ffffff", boxShadow: "none", border: "1.5px solid #e0e0d8",
                    borderRadius: 24, padding: "14px 20px", marginBottom: 12,
                    display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap"
                  }}>
                    <span style={{ fontSize: 10, color: "#bbbbbb", fontWeight: 600, letterSpacing: "0.1em" }}>FILTROS</span>

                    {/* Sector */}
                    <select value={magicSector} onChange={e => setMagicSector(e.target.value)} style={{
                      background: "#f8f8f8", border: "1px solid #e5e5e5", borderRadius: 8,
                      padding: "5px 10px", fontSize: 12, color: "#111111", cursor: "pointer"
                    }}>
                      {sectors.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>

                    {/* Min EY */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 11, color: "#777777" }}>EY mín</span>
                      <input type="number" placeholder="0%" value={magicMinEY}
                        onChange={e => setMagicMinEY(e.target.value)}
                        style={{ width: 64, background: "#f8f8f8", border: "1px solid #e5e5e5", borderRadius: 8, padding: "5px 8px", fontSize: 12, color: "#111111" }} />
                    </div>

                    {/* Min ROC */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 11, color: "#777777" }}>ROC mín</span>
                      <input type="number" placeholder="0%" value={magicMinROC}
                        onChange={e => setMagicMinROC(e.target.value)}
                        style={{ width: 64, background: "#f8f8f8", border: "1px solid #e5e5e5", borderRadius: 8, padding: "5px 8px", fontSize: 12, color: "#111111" }} />
                    </div>

                    {/* Reset */}
                    {(magicSector !== "Todos" || magicMinEY || magicMinROC) && (
                      <button onClick={() => { setMagicSector("Todos"); setMagicMinEY(""); setMagicMinROC(""); }}
                        style={{ background: "none", border: "1px solid #e5e5e5", borderRadius: 8, padding: "5px 12px", fontSize: 11, color: "#999999", cursor: "pointer" }}>
                        Limpiar
                      </button>
                    )}

                    <span style={{ marginLeft: "auto", fontSize: 11, color: "#bbbbbb" }}>
                      {filtered.length} resultado{filtered.length !== 1 ? "s" : ""}
                    </span>
                  </div>

                  {/* ── Tabla ── */}
                  <div style={{ background: "#ffffff", boxShadow: "none", border: "1.5px solid #e0e0d8", borderRadius: 24, overflow: "hidden" }}>
                    {/* Header con click para ordenar */}
                    <div style={{ display: "grid", gridTemplateColumns: gridCols, padding: "10px 20px", background: "#f8f8f8", borderBottom: "1px solid #eeeeee" }}>
                      {cols.map((c, i) => (
                        <div key={i}
                          onClick={() => c.key && toggleSort(c.key)}
                          style={{
                            fontSize: 9, fontWeight: 600, letterSpacing: "0.1em",
                            textAlign: c.right ? "right" : "left",
                            color: magicSort.col === c.key ? "#111111" : "#bbbbbb",
                            cursor: c.key ? "pointer" : "default",
                            userSelect: "none",
                            transition: "color 0.15s"
                          }}>{c.label}</div>
                      ))}
                    </div>

                    {filtered.length === 0 && (
                      <div style={{ padding: 32, textAlign: "center", color: "#bbbbbb", fontSize: 13 }}>
                        Ninguna empresa cumple los filtros aplicados
                      </div>
                    )}

                    {filtered.map((s, idx) => {
                      const eyColor  = s.ey  > 10 ? "#16a34a" : s.ey  > 5 ? "#d97706" : "#dc2626";
                      const rocColor = s.roc > 25 ? "#16a34a" : s.roc > 12 ? "#d97706" : "#dc2626";
                      const isTop = magicSort.col === "magic_rank" && magicSector === "Todos" && !magicMinEY && !magicMinROC;
                      const medalBg    = isTop && idx === 0 ? "#fef9c3" : isTop && idx === 1 ? "#f3f4f6" : isTop && idx === 2 ? "#fff7ed" : "transparent";
                      const medalColor = isTop && idx === 0 ? "#ca8a04" : isTop && idx === 1 ? "#6b7280" : isTop && idx === 2 ? "#c2410c" : "#bbbbbb";
                      return (
                        <div key={s.ticker} style={{
                          display: "grid", gridTemplateColumns: gridCols,
                          padding: "11px 20px", background: medalBg,
                          borderBottom: "1px solid #f5f5f5", alignItems: "center",
                        }}>
                          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, fontWeight: 700, color: medalColor }}>{idx + 1}</div>
                          <div style={{
                            background: idx < 5 && isTop ? "#111111" : "#f2f2f2",
                            color: idx < 5 && isTop ? "#ffffff" : "#555555",
                            borderRadius: 6, padding: "2px 6px", fontSize: 11, fontWeight: 700,
                            textAlign: "center", width: "fit-content"
                          }}>{s.magic_rank}</div>
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span style={{ fontFamily: "'DM Mono', monospace", fontWeight: 700, fontSize: 13, color: "#111111" }}>{s.ticker}</span>
                              <span style={{ background: "#f2f2f2", borderRadius: 5, padding: "1px 6px", fontSize: 9, color: "#666666" }}>{s.sector?.split(" ")[0]}</span>
                            </div>
                            <div style={{ fontSize: 10, color: "#999999" }}>{s.name}</div>
                            {s.price && <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "#555555" }}>${s.price}</div>}
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 14, fontWeight: 700, color: eyColor }}>{s.ey}%</div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 14, fontWeight: 700, color: rocColor }}>{s.roc}%</div>
                          </div>
                          <div style={{ textAlign: "right", fontFamily: "'DM Mono', monospace", fontSize: 12, color: "#555555" }}>{s.pe != null ? `${s.pe}x` : "—"}</div>
                          <div style={{ textAlign: "right", fontFamily: "'DM Mono', monospace", fontSize: 12, color: "#555555" }}>{s.pb != null ? `${s.pb}x` : "—"}</div>
                          <div style={{ textAlign: "right", fontSize: 11, color: "#bbbbbb" }}>#{s.rank_ey}</div>
                          <div style={{ textAlign: "right", fontSize: 11, color: "#bbbbbb" }}>#{s.rank_roc}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {magicData?.stocks?.length === 0 && (
              <div style={{ textAlign: "center", color: "#dc2626", fontSize: 13, marginTop: 40 }}>
                No se obtuvieron resultados. Verifica que el backend esté corriendo.
              </div>
            )}
          </div>
        )}

        {/* ─── TAB: ANÁLISIS DE ACCIÓN ─── */}
        {tab === "analisis" && (() => {
          const f = analisisData ?? {};
          const ticker = analisisData?.ticker ?? analisisTicker.toUpperCase();

          // ── Chart computations ──
          const closes = analisisChart?.closes ?? analisisChart?.chart ?? [];
          const isUp = closes.length > 1 ? closes[closes.length - 1] >= closes[0] : true;
          const lineColor = isUp ? "#00ff88" : "#f87171";
          const W = 900, H = 200;
          let svgPath = "", svgArea = "", chartPts = [];
          if (closes.length > 1) {
            const minV = Math.min(...closes), maxV = Math.max(...closes);
            const range = maxV - minV || 1;
            chartPts = closes.map((v, i) => ({
              x: (i / (closes.length - 1)) * W,
              y: 10 + (1 - (v - minV) / range) * (H - 20),
              v,
            }));
            svgPath = chartPts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
            svgArea = `M0,${H} ${chartPts.map(p => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")} L${W},${H} Z`;
          }
          const hPt = analisisHoverIdx != null ? chartPts[analisisHoverIdx] : null;

          // ── ML Score ──
          const score = analisisData ? mlScoreStock(ticker, f) : null;
          const scoreDims = score ? [
            { label: "Fundamental", val: score.fundamental_score },
            { label: "Valuación",   val: score.valuation_score },
            { label: "Momentum",    val: score.momentum_score },
            { label: "Calidad",     val: score.quality_score },
            { label: "Técnico",     val: score.technical_score },
          ] : [];
          const recColor = score?.overall_score >= 7 ? "#00ff88" : score?.overall_score >= 5 ? "#ffb800" : "#ff3b3b";

          // ── Metrics ──
          const fmtV = (v, dec = 2) => v == null ? "—" : typeof v === "number" ? v.toFixed(dec) : String(v);
          const metrics = [
            { label: "P/E",       val: f.pe,           lo: v => v < 15,  hi: v => v > 40  },
            { label: "PEG",       val: f.peg,          lo: v => v < 1,   hi: v => v > 2   },
            { label: "EV/EBITDA", val: f.evEbitda,     lo: v => v < 10,  hi: v => v > 20  },
            { label: "P/B",       val: f.pb,           lo: v => v < 2,   hi: v => v > 6   },
            { label: "ROE %",     val: f.roe,          lo: null,         hi: v => v < 0   },
            { label: "Margen %",  val: f.profitMargin, lo: null,         hi: v => v < 5   },
            { label: "Beta",      val: f.beta,         lo: null,         hi: null          },
            { label: "D/E",       val: f.debtEquity,   lo: v => v < 50, hi: v => v > 200  },
          ];

          // ── Financials (approximated from stock fields) ──
          const toB = v => v != null ? (v / 1e9).toFixed(2) : null;
          const toM = v => v != null ? (v / 1e6).toFixed(1) : null;
          const rev  = f.totalRevenue;
          const netInc = f.netIncomeToCommon;
          const assets = f.totalAssets;
          const debt   = f.totalDebt;
          const ocf    = f.operatingCashflow;
          const fcf    = f.freeCashflow;
          // Simulate 4 quarters by dividing annual by 4 with minor variation
          const quarters = (annual) => {
            if (annual == null) return [null, null, null, null];
            const base = annual / 4;
            return [base * 0.88, base * 0.96, base * 1.05, base * 1.11];
          };
          const finData = {
            income: {
              bars: [
                { label: "Revenue",    vals: quarters(rev),    color: "#3b82f6", fmt: toB, unit: "B" },
                { label: "Net Income", vals: quarters(netInc), color: "#60a5fa", fmt: toB, unit: "B" },
              ],
              table: [
                { label: "Revenue",    val: toB(rev),    unit: "B" },
                { label: "Net Income", val: toB(netInc), unit: "B" },
                { label: "Margen %",   val: fmtV(f.profitMargin), unit: "%" },
              ],
            },
            balance: {
              bars: [
                { label: "Activos",   vals: quarters(assets), color: "#3b82f6", fmt: toB, unit: "B" },
                { label: "Deuda",     vals: quarters(debt),   color: "#60a5fa", fmt: toB, unit: "B" },
              ],
              table: [
                { label: "Total Activos", val: toB(assets), unit: "B" },
                { label: "Total Deuda",   val: toB(debt),   unit: "B" },
                { label: "D/E ratio",     val: fmtV(f.debtEquity), unit: "x" },
              ],
            },
            cashflow: {
              bars: [
                { label: "Op. CF",   vals: quarters(ocf), color: "#3b82f6", fmt: toB, unit: "B" },
                { label: "Free CF",  vals: quarters(fcf), color: "#60a5fa", fmt: toB, unit: "B" },
              ],
              table: [
                { label: "Oper. Cash Flow", val: toB(ocf), unit: "B" },
                { label: "Free Cash Flow",  val: toB(fcf), unit: "B" },
              ],
            },
          };
          const fin = finData[analisisFinTab];
          const QLABELS = ["Q1", "Q2", "Q3", "Q4"];

          // ── Bar chart SVG helper ──
          const BarChart = ({ bars }) => {
            const allVals = bars.flatMap(b => b.vals).filter(v => v != null);
            if (allVals.length === 0) return (
              <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "#374151", fontSize: 12 }}>
                Sin datos disponibles
              </div>
            );
            const maxV = Math.max(...allVals.map(Math.abs));
            const BH = 160, BW = 820, TP = 20;
            const groupW = BW / 4;
            const barW = groupW / (bars.length + 1);
            return (
              <svg viewBox={`0 0 ${BW} ${BH + 40 + TP}`} style={{ width: "100%", display: "block" }}>
                {[0.25, 0.5, 0.75, 1].map(pct => {
                  const y = TP + BH - pct * BH;
                  return <line key={pct} x1="0" y1={y} x2={BW} y2={y} stroke="#1a1a1a" strokeWidth="1" />;
                })}
                {QLABELS.map((ql, qi) => {
                  const gx = qi * groupW;
                  return (
                    <g key={qi}>
                      <text x={gx + groupW / 2} y={TP + BH + 28} textAnchor="middle" fill="#6b7280" fontSize="11" fontFamily="monospace">{ql}</text>
                      {bars.map((bar, bi) => {
                        const v = bar.vals[qi];
                        if (v == null) return null;
                        const bx = gx + (bi + 0.5) * barW + (groupW - bars.length * barW) / 2;
                        const bh = Math.max(2, (Math.abs(v) / maxV) * BH);
                        const by = TP + BH - bh;
                        return (
                          <g key={bi}>
                            <rect x={bx} y={by} width={barW - 4} height={bh} fill={bar.color} rx="2" />
                            <text x={bx + (barW - 4) / 2} y={by - 4} textAnchor="middle" fill="#9ca3af" fontSize="9" fontFamily="monospace">
                              {bar.fmt(v)}{bar.unit}
                            </text>
                          </g>
                        );
                      })}
                    </g>
                  );
                })}
              </svg>
            );
          };

          const PERIODS = [
            { id: "1mo",  label: "1M" },
            { id: "3mo",  label: "3M" },
            { id: "6mo",  label: "6M" },
            { id: "1y",   label: "1A" },
            { id: "2y",   label: "2A" },
            { id: "5y",   label: "5A" },
          ];

          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

              {/* ── BUSCADOR ── */}
              <div style={{ background: "#0a0a0a", borderRadius: 16, padding: "20px 24px", position: "relative" }}>
                <input
                  value={analisisTicker}
                  onChange={e => setAnalisisTicker(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && runAnalisis()}
                  placeholder="Buscar ticker... AAPL, AMZN, CEMEXCPO.MX"
                  style={{
                    width: "100%", boxSizing: "border-box",
                    background: "transparent", color: "#ffffff", border: "none",
                    borderBottom: "2px solid #00ff88", outline: "none",
                    padding: "10px 160px 10px 0",
                    fontFamily: "'Syne', sans-serif", fontSize: 20, fontWeight: 700,
                  }}
                />
                <button
                  onClick={() => runAnalisis()}
                  disabled={analisisLoading}
                  style={{
                    position: "absolute", right: 24, top: "50%", transform: "translateY(-50%)",
                    background: "#111111", color: "#00ff88",
                    border: "1.5px solid #00ff88", borderRadius: 10,
                    padding: "10px 24px", cursor: "pointer",
                    fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 13,
                    transition: "all 0.15s", letterSpacing: "0.05em",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = "#00ff88"; e.currentTarget.style.color = "#0a0a0a"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "#111111"; e.currentTarget.style.color = "#00ff88"; }}
                >
                  {analisisLoading ? "CARGANDO..." : "ANALIZAR →"}
                </button>
              </div>

              {analisisLoading && (
                <div style={{ display: "flex", alignItems: "center", gap: 12, color: "#6b7280", fontSize: 13, padding: "8px 0" }}>
                  <Spinner size={16} /> Analizando {analisisTicker.toUpperCase()}...
                </div>
              )}
              {analisisError && (
                <div style={{ color: "#f87171", fontFamily: "'DM Mono',monospace", fontSize: 13, padding: "8px 0" }}>{analisisError}</div>
              )}

              {analisisData && !analisisLoading && (
                <>
                  {/* ── HEADER ── */}
                  <div style={{ background: "#0d0d0d", borderRadius: 20, padding: "28px 32px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
                          <span style={{ fontFamily: "'Syne',sans-serif", fontSize: 48, fontWeight: 800, color: "#ffffff", lineHeight: 1 }}>{ticker}</span>
                          <span style={{ color: "#4b5563", fontSize: 16 }}>{f.name ?? f.longName ?? ""}</span>
                        </div>
                        <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {f.sector && <span style={{ background: "#1a1a1a", color: "#6b7280", padding: "3px 12px", borderRadius: 999, fontSize: 11, fontWeight: 600 }}>{f.sector}</span>}
                          {f.industry && <span style={{ background: "#1a1a1a", color: "#6b7280", padding: "3px 12px", borderRadius: 999, fontSize: 11 }}>{f.industry}</span>}
                          {f.exchange && <span style={{ background: "#1a1a1a", color: "#6b7280", padding: "3px 12px", borderRadius: 999, fontSize: 11 }}>{f.exchange}</span>}
                          {f.country && <span style={{ background: "#1a1a1a", color: "#6b7280", padding: "3px 12px", borderRadius: 999, fontSize: 11 }}>{f.country}</span>}
                          {f.employees != null && <span style={{ background: "#1a1a1a", color: "#6b7280", padding: "3px 12px", borderRadius: 999, fontSize: 11 }}>{Number(f.employees).toLocaleString()} empleados</span>}
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 36, color: "#ffffff", fontWeight: 700, lineHeight: 1 }}>
                          ${f.price != null ? Number(f.price).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
                        </div>
                        <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 8 }}>
                          {f.change_pct != null && (
                            <span style={{ color: f.change_pct >= 0 ? "#4ade80" : "#f87171", fontSize: 18, fontWeight: 700 }}>
                              {f.change_pct >= 0 ? "+" : ""}{Number(f.change_pct).toFixed(2)}%
                            </span>
                          )}
                          {f.marketCap != null && (
                            <span style={{ color: "#4b5563", fontSize: 13, alignSelf: "center" }}>
                              Cap ${(f.marketCap / 1e9).toFixed(1)}B
                            </span>
                          )}
                        </div>
                        {f.website && (
                          <a href={f.website} target="_blank" rel="noopener noreferrer"
                            style={{ color: "#4b5563", fontSize: 11, textDecoration: "none", marginTop: 6, display: "block" }}>
                            {f.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                          </a>
                        )}
                      </div>
                    </div>
                    {/* Descripción del negocio */}
                    {f.description && (
                      <div style={{ marginTop: 20, borderTop: "1px solid #1a1a1a", paddingTop: 16 }}>
                        <p style={{
                          color: "#9ca3af", fontSize: 13, lineHeight: 1.7, margin: 0,
                          display: "-webkit-box", WebkitLineClamp: analisisDescExpanded ? "unset" : 3,
                          WebkitBoxOrient: "vertical", overflow: analisisDescExpanded ? "visible" : "hidden",
                        }}>
                          {f.description}
                        </p>
                        <button onClick={() => setAnalisisDescExpanded(v => !v)}
                          style={{ background: "none", border: "none", color: "#00ff88", fontSize: 12, cursor: "pointer", marginTop: 8, padding: 0, fontFamily: "'DM Mono',monospace" }}>
                          {analisisDescExpanded ? "Ver menos ▲" : "Ver más ▼"}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* ── GRÁFICA ── */}
                  <div style={{ background: "#0d0d0d", borderRadius: 16, padding: "20px 24px" }}>
                    {/* Tabs de período */}
                    <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
                      {PERIODS.map(p => {
                        const ret = analisisReturns?.[p.id];
                        const retColor = ret == null ? "#6b7280" : ret >= 0 ? "#4ade80" : "#f87171";
                        const isActive = analisisPeriod === p.id;
                        return (
                          <button key={p.id} onClick={() => fetchAnalisisChart(p.id)}
                            style={{
                              background: isActive ? "#00ff88" : "#1a1a1a",
                              color: isActive ? "#0a0a0a" : "#6b7280",
                              border: "none", borderRadius: 8, padding: "5px 14px 6px",
                              cursor: "pointer", fontFamily: "'DM Mono',monospace", fontWeight: 700, fontSize: 12,
                              transition: "all 0.12s", display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                            }}
                          >
                            <span>{p.label}</span>
                            {ret != null && (
                              <span style={{ fontSize: 9, fontWeight: 600, color: isActive ? (ret >= 0 ? "#006633" : "#cc0000") : retColor, lineHeight: 1 }}>
                                {ret >= 0 ? "+" : ""}{ret.toFixed(1)}%
                              </span>
                            )}
                          </button>
                        );
                      })}
                      {hPt && (
                        <div style={{ marginLeft: "auto", fontFamily: "'DM Mono',monospace", fontSize: 13, color: lineColor, alignSelf: "center" }}>
                          ${hPt.v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                      )}
                    </div>
                    {/* SVG Chart */}
                    {closes.length > 1 ? (
                      <div style={{ position: "relative" }}>
                        <svg
                          viewBox={`0 0 ${W} ${H}`}
                          style={{ width: "100%", display: "block", cursor: "crosshair" }}
                          onMouseMove={e => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            const xRatio = (e.clientX - rect.left) / rect.width;
                            const idx = Math.round(xRatio * (closes.length - 1));
                            setAnalisisHoverIdx(Math.max(0, Math.min(closes.length - 1, idx)));
                          }}
                          onMouseLeave={() => setAnalisisHoverIdx(null)}
                        >
                          <defs>
                            <linearGradient id="ag-grad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={lineColor} stopOpacity="0.25" />
                              <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
                            </linearGradient>
                          </defs>
                          <rect width={W} height={H} fill="#111111" rx="10" />
                          <path d={svgArea} fill="url(#ag-grad)" />
                          <path d={svgPath} fill="none" stroke={lineColor} strokeWidth="2.5" strokeLinejoin="round" />
                          {hPt && (
                            <g>
                              <line x1={hPt.x} y1="0" x2={hPt.x} y2={H} stroke="#ffffff" strokeWidth="1" strokeOpacity="0.2" strokeDasharray="4,4" />
                              <circle cx={hPt.x} cy={hPt.y} r="5" fill={lineColor} stroke="#0d0d0d" strokeWidth="2" />
                            </g>
                          )}
                        </svg>
                      </div>
                    ) : (
                      <div style={{ height: 160, display: "flex", alignItems: "center", justifyContent: "center", color: "#374151", fontSize: 12 }}>
                        Sin datos de gráfica para este período
                      </div>
                    )}
                  </div>

                  {/* ── MÉTRICAS + ML SCORE ── */}
                  <div className="analisis-metrics-wrap" style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 16 }}>

                    {/* Métricas 4x2 */}
                    <div style={{ background: "#0d0d0d", borderRadius: 16, padding: "20px 24px" }}>
                      <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 10, fontWeight: 700, color: "#4b5563", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 14 }}>Métricas Clave</div>
                      <div className="analisis-kpis" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
                        {metrics.map(({ label, val, lo, hi }) => {
                          const cheap  = lo && val != null && lo(val);
                          const pricey = hi && val != null && hi(val);
                          const valColor = cheap ? "#00ff88" : pricey ? "#f87171" : "#ffffff";
                          return (
                            <div key={label} style={{ background: "#1a1a1a", borderRadius: 12, padding: "12px 14px" }}>
                              <div style={{ color: "#6b7280", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{label}</div>
                              <div style={{ color: valColor, fontFamily: "'DM Mono',monospace", fontSize: 20, fontWeight: 700 }}>{fmtV(val)}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* ML Score */}
                    {score && (
                      <div style={{ background: "#0d0d0d", borderRadius: 16, padding: "20px 24px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                          <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 10, fontWeight: 700, color: "#4b5563", letterSpacing: "0.12em", textTransform: "uppercase" }}>ML Score</div>
                          <div style={{
                            background: recColor, color: "#0a0a0a",
                            fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 13,
                            padding: "5px 16px", borderRadius: 999,
                          }}>
                            {score.recommendation} · {score.overall_score}/10
                          </div>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                          {scoreDims.map(({ label, val }) => {
                            const c = val >= 7 ? "#00ff88" : val >= 5 ? "#ffb800" : "#f87171";
                            return (
                              <div key={label}>
                                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                                  <span style={{ color: "#6b7280", fontSize: 12 }}>{label}</span>
                                  <span style={{ color: c, fontFamily: "'DM Mono',monospace", fontSize: 12, fontWeight: 700 }}>{val}/10</span>
                                </div>
                                <div style={{ background: "#1a1a1a", borderRadius: 4, height: 6, overflow: "hidden" }}>
                                  <div style={{ width: `${val * 10}%`, height: "100%", background: c, borderRadius: 4, transition: "width 0.6s ease" }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <div style={{ color: "#4b5563", fontSize: 11, fontFamily: "'DM Mono',monospace", marginTop: 14, lineHeight: 1.6 }}>
                          {score.rationale}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ── FINANCIEROS ── */}
                  <div style={{ background: "#0d0d0d", borderRadius: 16, padding: "20px 24px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 20 }}>
                      <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 10, fontWeight: 700, color: "#4b5563", letterSpacing: "0.12em", textTransform: "uppercase", marginRight: 12 }}>Financieros</div>
                      {[["income","Income"],["balance","Balance"],["cashflow","Cash Flow"]].map(([id, label]) => (
                        <button key={id} onClick={() => setAnalisisFinTab(id)}
                          style={{
                            background: analisisFinTab === id ? "#3b82f6" : "#1a1a1a",
                            color: analisisFinTab === id ? "#ffffff" : "#6b7280",
                            border: "none", borderRadius: 8, padding: "5px 16px",
                            cursor: "pointer", fontFamily: "'DM Mono',monospace", fontWeight: 600, fontSize: 12,
                            transition: "all 0.12s",
                          }}
                        >{label}</button>
                      ))}
                      <span style={{ marginLeft: "auto", color: "#374151", fontSize: 10 }}>* anual estimado por trimestres</span>
                    </div>
                    <BarChart bars={fin.bars} />
                    <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 16 }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: "left", color: "#4b5563", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", padding: "6px 0", borderBottom: "1px solid #1a1a1a" }}>Métrica</th>
                          {QLABELS.map(q => <th key={q} style={{ textAlign: "right", color: "#4b5563", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", padding: "6px 0", borderBottom: "1px solid #1a1a1a" }}>{q}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {fin.table.map(({ label, val, unit }) => {
                          const qBar = fin.bars.find(b => b.label.toLowerCase().includes(label.toLowerCase().split(" ")[0].toLowerCase()));
                          const qVals = qBar?.vals;
                          const qFmt = qBar?.fmt ?? (v => v?.toFixed(1));
                          return (
                            <tr key={label}>
                              <td style={{ color: "#6b7280", fontSize: 12, padding: "8px 0", borderBottom: "1px solid #1a1a1a" }}>{label}</td>
                              {QLABELS.map((_, qi) => (
                                <td key={qi} style={{ textAlign: "right", fontFamily: "'DM Mono',monospace", fontSize: 12, color: "#ffffff", padding: "8px 0", borderBottom: "1px solid #1a1a1a" }}>
                                  {qVals?.[qi] != null ? `${qFmt(qVals[qi])}${unit ?? ""}` : val ?? "—"}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* ── NOTICIAS ── */}
                  <div style={{ background: "#0d0d0d", borderRadius: 16, padding: "20px 24px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                      <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 10, fontWeight: 700, color: "#4b5563", letterSpacing: "0.12em", textTransform: "uppercase" }}>
                        Noticias · {ticker}
                      </div>
                      {analisisNewsLoading && <Spinner size={14} />}
                    </div>
                    {analisisNews.length > 0 ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {analisisNews.slice(0, 5).map((item, i) => {
                          const sentColor = item.sentiment === "positive" ? "#4ade80" : item.sentiment === "negative" ? "#f87171" : "#fbbf24";
                          return (
                            <div key={i} style={{
                              background: "#1a1a1a", borderRadius: 12, padding: "14px 16px",
                              borderLeft: `3px solid ${sentColor}`,
                              cursor: item.url ? "pointer" : "default",
                            }}
                              onClick={() => item.url && window.open(item.url, "_blank")}
                            >
                              <div style={{ fontWeight: 700, fontSize: 13, color: "#ffffff", marginBottom: 5, lineHeight: 1.4 }}>{item.title}</div>
                              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                                <span style={{ fontSize: 11, color: "#4b5563" }}>{item.publisher ?? item.source ?? ""}</span>
                                {item.sentiment && (
                                  <span style={{ fontSize: 10, color: sentColor, fontWeight: 700, textTransform: "uppercase" }}>{item.sentiment}</span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : !analisisNewsLoading ? (
                      <div style={{ color: "#374151", fontSize: 13, textAlign: "center", padding: "20px 0" }}>
                        Sin noticias recientes para {ticker}.
                      </div>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          );
        })()}

      </div>
    </div>
  );
}
