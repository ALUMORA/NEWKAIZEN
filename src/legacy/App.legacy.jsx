
import { useState, useEffect, useCallback, useRef } from "react";
import { useTheme } from '../theme.js';
import { Badge, Button, IconButton, Card, KpiTile, Mark, ThemeToggle } from '../ui.jsx';
import { cn } from '../cn.js';
// Todo request al backend pasa por authorizedFetch: lleva el token de la sesión (el API v2 exige
// sesión también en sus rutas v1) y un 401 cierra la sesión y manda a /login. Nunca fetch directo.
import { authorizedFetch } from '../lib/api/client.js';
import {
  Menu, X,
  Newspaper, Briefcase, Gauge, ListFilter, LineChart as LineChartIcon,
  Landmark, Sparkles, ChartNoAxesCombined, Download, FileText, LogOut,
} from 'lucide-react';

// ─── CURRENCY UTILS (fuera del componente — sin closure) ─────────────────────
// .MX  → precio ya en MXN (BMV y SIC)
// sin .MX → precio en USD, se multiplica por el tipo de cambio
function isMXN(ticker) { return ticker.endsWith('.MX') || ticker === '$MXN'; }
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
// VITE_API_URL (en .env.local) fija un solo backend; sin él se prueban Render y luego local.
// Solo en dev, igual que VITE_SKIP_LOGIN: Vite lee .env.local también al hacer build, y un
// dist/ armado en local apuntaría producción a localhost.
const BACKEND_CANDIDATES = import.meta.env.DEV && import.meta.env.VITE_API_URL
  ? [import.meta.env.VITE_API_URL]
  : [
      "https://app-4-everyone.onrender.com",  // Render (primario)
      "http://localhost:8002",                // Local dev
    ];

async function detectBackend(candidates = BACKEND_CANDIDATES) {
  for (const url of candidates) {
    try {
      const res = await authorizedFetch(`${url}/health`, { signal: AbortSignal.timeout(60000) });
      const data = await res.json();
      if (data?.status === "ok") return url;
    } catch { /* sin dato: se conserva el valor previo */ }
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

// Exporta los financieros de SEC EDGAR (series por concepto/año) a un CSV descargable.
function downloadEdgarCsv(edgar) {
  if (!edgar?.series?.length) return;
  const years = [...new Set(edgar.series.flatMap((s) => s.values.map((v) => v.fy)))].sort();
  const rows = [["Concepto", "Unidad", ...years]];
  for (const s of edgar.series) {
    const byYear = Object.fromEntries(s.values.map((v) => [v.fy, v.val]));
    rows.push([s.label, s.unit, ...years.map((y) => byYear[y] ?? "")]);
  }
  const csv = rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${edgar.ticker}_SEC_EDGAR_financieros.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function fetchStock(ticker, timeoutMs = 30000) {
  // Reintenta automáticamente en caso de fallo de red/respuesta no-JSON (Render cold start)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await authorizedFetch(`${BACKEND}/stock/${encodeURIComponent(ticker)}`, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return data?.error ? null : data;
    } catch (e) {
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 8000 * (attempt + 1))); // 8s, 16s
      } else {
        throw e;
      }
    }
  }
}

// Último USD/MXN conocido. Respaldo para un backend anterior que ignora ccy=MXN y devuelve
// dólares: sin esto los pesos por valor de mercado volvían a mezclar USD con MXN.
let USDMXN_SPOT = 17.5;

// Siempre en MXN: todo lo que usa fetchChart (Sharpe, optimizador, backtest, Monte Carlo,
// screener) resta la tasa libre de riesgo mexicana, así que los retornos deben ser en pesos.
async function fetchChart(ticker, period = "5y", timeoutMs = 90000) {
  // Reintenta automáticamente en caso de fallo de red (Render cold start)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await authorizedFetch(`${BACKEND}/chart/${encodeURIComponent(ticker)}?period=${period}&ccy=MXN`,
        { signal: AbortSignal.timeout(timeoutMs) });
      const data = await res.json();
      const closes = data?.closes ?? [];
      if (data?.currency !== "MXN" && !isMXN(ticker)) return closes.map(c => c * USDMXN_SPOT);
      return closes;
    } catch (e) {
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, 8000 * (attempt + 1))); // 8s, 16s
      } else {
        throw e;
      }
    }
  }
}

async function fetchRiskFreeRate() {
  try {
    const res = await authorizedFetch(`${BACKEND}/rf`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data?.rate == null) throw new Error("respuesta sin rate");
    return { rate: data.rate, label: data.label ?? "Bono M", ok: true };
  } catch {
    // ok:false para que la UI no muestre "Backend OK" sobre un valor que no vino del backend
    return { rate: 0.0860, label: "Bono M 10Y (ref. fija, sin backend)", ok: false };
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
const W_MAX_DEFAULT = 0.35;

function optimizeSharpe(returnsMatrix, rf, iterations = 100_000) {
  const n = returnsMatrix.length;
  // Con n·W_MAX < 1 (2 activos a 35%) ningún vector cumple y se devolvía Sharpe -Infinity
  const W_MAX = n * W_MAX_DEFAULT >= 1 ? W_MAX_DEFAULT : 1;
  const { cov, means } = buildCovMatrix(returnsMatrix);
  let best = { sharpe: -Infinity, weights: Array(n).fill(1 / n), wMax: W_MAX };

  for (let iter = 0; iter < iterations; iter++) {
    // Generar pesos con restricciones min/max usando proyección iterativa
    // 1) Muestra aleatoria uniforme
    let w = Array.from({ length: n }, () => Math.random());
    const rawSum = w.reduce((a, b) => a + b, 0);
    w = w.map((v) => v / rawSum);

    // 2) Proyección iterativa hasta satisfacer [W_MIN, W_MAX] y suma=1
    for (let pass = 0; pass < 20; pass++) {
      let excess = 0;
      w = w.map((v) => {
        if (v < W_MIN) { excess += W_MIN - v; return W_MIN; }
        if (v > W_MAX) { excess += W_MAX - v; return W_MAX; } // excess negativo
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
    if (s > best.sharpe) best = { sharpe: s, weights: w, wMax: W_MAX };
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

// Retornos semanales del portafolio, alineados por el final (la semana más reciente).
// weights va índice a índice con positions; la caja ($MXN) pesa en el total pero rinde 0.
function weightedReturns(positions, weights, returnsMap, n) {
  return Array.from({ length: n }, (_, i) =>
    positions.reduce((s, p, wi) => {
      if (p.ticker === "$MXN") return s;
      const r = returnsMap[p.ticker];
      return s + weights[wi] * (r?.[r.length - n + i] ?? 0);
    }, 0)
  );
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
  if (pcf != null && pcf > 0) val += pcf < 15 ? 1 : pcf < 25 ? 0.3 : pcf > 40 ? -0.8 : 0;
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
  const color = value >= 7 ? "var(--positive)" : value >= 5 ? "var(--warning)" : "var(--negative)";
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--muted-2)", marginBottom: 3 }}>
        <span>{label}</span><span style={{ color, fontWeight: 600 }}>{value}/10</span>
      </div>
      <div style={{ background: "var(--surface-2)", borderRadius: 4, height: 4, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 4, transition: "width 0.8s ease" }} />
      </div>
    </div>
  );
}

// ─── METRIC BADGE ─────────────────────────────────────────────────────────────
function MetricBadge({ label, value, good, neutral }) {
  const v = parseFloat(value);
  let color = "var(--muted)";
  if (!isNaN(v)) {
    if (good !== undefined && v <= good) color = "var(--positive)";
    else if (neutral !== undefined && v <= neutral) color = "var(--warning)";
    else if (!isNaN(v)) color = "var(--negative)";
  }
  return (
    <div className="kpi-hover" style={{
      background: "var(--surface-2)", borderRadius: 12,
      padding: "8px 12px", minWidth: 90, textAlign: "center"
    }}>
      <div style={{ fontSize: 10, color: "var(--muted)", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 17, fontFamily: "var(--font-mono)", color, fontWeight: 700 }}>
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
    <svg className="dark-panel" viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block", background: "var(--bg-deep)", borderRadius: 12 }}>
      {[0, 0.25, 0.5, 0.75, 1].map((frac, i) => {
        const val = maxY - frac * rangeY;
        const y = PAD.top + frac * plotH;
        return (
          <g key={i}>
            <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="var(--border)" strokeWidth={1} />
            <text x={PAD.left - 6} y={y + 4} textAnchor="end" fill="var(--muted-2)" fontSize={9}>
              {(val * 100).toFixed(1)}%
            </text>
          </g>
        );
      })}
      {minY < 0 && (
        <line x1={PAD.left} y1={toY(0)} x2={W - PAD.right} y2={toY(0)}
          stroke="var(--border-strong)" strokeWidth={1} strokeDasharray="4,3" />
      )}
      {series.map((s, si) => {
        const pts = s.data.map((v, i) => `${toX(i, s.data.length)},${toY(v)}`);
        const lastX = toX(s.data.length - 1, s.data.length);
        const areaPath = `M${pts[0]} L${pts.join(" L")} L${lastX},${PAD.top + plotH} L${PAD.left},${PAD.top + plotH} Z`;
        return (
          <g key={s.name}>
            <path className="chart-fade-in" d={areaPath} fill={s.color} fillOpacity={0.08} />
            <polyline className="chart-draw-line" pathLength={1} points={pts.join(" ")} fill="none" stroke={s.color} strokeWidth={2.5} strokeLinejoin="round"
              style={{ animationDelay: `${si * 0.15}s` }} />
          </g>
        );
      })}
      {dates && dates.map((d, i) => {
        const step = Math.max(1, Math.floor(dates.length / 6));
        if (i % step !== 0 && i !== dates.length - 1) return null;
        return (
          <text key={i} x={toX(i, dates.length)} y={H - 8} textAnchor="middle" fill="var(--muted-2)" fontSize={9}>{d}</text>
        );
      })}
      {series.map((s, i) => (
        <g key={s.name} transform={`translate(${PAD.left + i * 160}, 6)`}>
          <line x1={0} y1={6} x2={22} y2={6} stroke={s.color} strokeWidth={2.5} />
          <text x={28} y={10} fill="var(--muted)" fontSize={10}>{s.name}</text>
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
    <div style={{ display:"flex", alignItems:"center", gap:8, justifyContent:"center", padding:"20px 0", color:"var(--muted)", fontSize:11 }}>
      <div style={{ width:12, height:12, border:"2px solid var(--ink)", borderTop:"2px solid #3b82f6", borderRadius:"50%", animation:"spin 0.8s linear infinite" }} />
      Cargando...
    </div>
  );
  if (!data) return (
    <div style={{ textAlign:"center", padding:"16px 0", color:"var(--muted)", fontSize:11 }}>Cargando datos de mercados globales…</div>
  );

  const rows = COUNTRY_ROWS
    .map(r => ({ ...r, d: data[r.id] }))
    .sort((a, b) => (b.d?.change_pct ?? -999) - (a.d?.change_pct ?? -999));

  return (
    <div className="resp-grid-3" style={{ gap:"1px 4px" }}>
      {rows.map(({ id, name, etf, d }) => {
        const p = d?.change_pct;
        const up = p != null && p >= 0;
        const color = p == null ? "var(--muted-2)" : up ? "var(--positive)" : "var(--negative)";
        const bgBadge = p == null ? "var(--border)" : up ? "var(--positive-soft)" : "var(--negative-soft)";
        return (
          <div key={id} style={{
            display:"flex", alignItems:"center", gap:5,
            padding:"4px 10px", height:32, boxSizing:"border-box",
            borderBottom:"1px solid var(--border)", transition:"background 0.1s",
          }}
            onMouseEnter={e => e.currentTarget.style.background="var(--surface-2)"}
            onMouseLeave={e => e.currentTarget.style.background=""}
          >
            <div style={{ flex:1, minWidth:0 }}>
              <span style={{ fontFamily:"var(--font-sans)", fontSize:12, fontWeight:700, color:"var(--muted)" }}>{name}</span>
              <span style={{ fontSize:9, color:"var(--muted-2)", marginLeft:5 }}>{etf}</span>
            </div>
            <div style={{
              fontFamily:"var(--font-mono)", fontSize:10, fontWeight:700,
              color, background:bgBadge, padding:"2px 6px", borderRadius:4, flexShrink:0,
              border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
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
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)", marginBottom: 8 }}>
      <span style={{ fontSize: 9, color: "var(--muted)", letterSpacing: "0.2em", textTransform: "uppercase", fontWeight: 700, fontFamily: "var(--font-sans)" }}>{children}</span>
      {right && <div>{right}</div>}
    </div>
  );
}

function Spinner({ size = 20 }) {
  return (
    <div style={{
      width: size, height: size, border: `2px solid var(--border)`,
      borderTop: `2px solid var(--accent)`, borderRadius: "50%",
      animation: "spin 0.8s linear infinite", display: "inline-block"
    }} />
  );
}

// ─── MARKET CARD ─────────────────────────────────────────────────────────────
function MktCard({ label, value, pct, absChange, sub, large, icon, showAbs }) {
  const isNeutral = pct === null || pct === undefined;
  const up = !isNeutral && pct >= 0;
  const accentColor = isNeutral ? "var(--muted)" : up ? "var(--positive)" : "var(--negative)";
  const hoverClass  = isNeutral ? "mkt-card" : up ? "mkt-card mkt-card-up" : "mkt-card mkt-card-down";
  const changeLabel = showAbs && absChange !== undefined && absChange !== null
    ? (absChange >= 0 ? "+" : "") + absChange.toFixed(2)
    : Math.abs(pct ?? 0).toFixed(2) + "%";

  return (
    <div className={hoverClass} style={{
      background: "linear-gradient(145deg,var(--surface),var(--surface-2))",
      borderRadius: 16,
      boxShadow: "0 2px 12px rgba(0,0,0,0.3)",
      padding: large ? "22px 24px" : "14px 16px",
      borderBottom: `2px solid ${accentColor}`,
      border: `1px solid var(--border)`,
      position: "relative", overflow: "hidden",
    }}>
      <div style={{
        position: "absolute", top: 0, right: 0, width: 60, height: 60, borderRadius: "0 16px 0 60px",
        background: `color-mix(in srgb, ${accentColor} 4%, transparent)`, pointerEvents: "none",
      }} />
      <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6, display: "flex", alignItems: "center", gap: 4, fontWeight: 600 }}>
        {icon && <span style={{ fontSize: 12 }}>{icon}</span>}
        {label}
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: large ? 26 : 17, fontWeight: 700, color: "var(--ink)", lineHeight: 1.1, marginBottom: 8 }}>
        {value ?? <span style={{ color: "var(--muted-2)" }}>—</span>}
      </div>
      {!isNeutral && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "3px 9px", borderRadius: 8, background: `color-mix(in srgb, ${accentColor} 15%, transparent)`, color: accentColor, fontSize: 11, fontWeight: 700, border: `1px solid color-mix(in srgb, ${accentColor} 35%, transparent)` }}>
          {up ? "▲" : "▼"} {changeLabel}
        </span>
      )}
      {sub && <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 5, fontWeight: 500 }}>{sub}</div>}
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
    insights.push({ icon: up ? "" : "", cat: "IPC MX", color: up ? "var(--positive)" : "var(--negative)",
      text: `Bolsa mexicana ${up ? "avanza" : "retrocede"} ${Math.abs(md.ipc.change_pct).toFixed(2)}%${pts} a ${md.ipc.value.toLocaleString("en-US", { maximumFractionDigits: 2 })} pts` });
  }
  if (md?.sp500?.change_pct != null) {
    const up = md.sp500.change_pct >= 0;
    insights.push({ icon: "", cat: "Wall Street", color: up ? "var(--positive)" : "var(--negative)",
      text: `S&P 500 ${up ? "sube" : "baja"} ${Math.abs(md.sp500.change_pct).toFixed(2)}% a ${md.sp500.value.toLocaleString("en-US", { maximumFractionDigits: 2 })} — Wall Street ${up ? "en verde" : "en rojo"}` });
  }
  if (md?.usdmxn?.change_pct != null) {
    const up = md.usdmxn.change_pct >= 0;
    insights.push({ icon: "", cat: "Peso MXN", color: up ? "var(--negative)" : "var(--positive)",
      text: `Peso ${up ? "se debilita" : "se fortalece"} ${Math.abs(md.usdmxn.change_pct).toFixed(2)}% — dólar en $${md.usdmxn.value.toFixed(4)} MXN` });
  }
  if (macroData?.vix?.value != null) {
    const v = macroData.vix.value;
    const c = v > 30 ? "var(--negative)" : v > 20 ? "var(--warning)" : "var(--positive)";
    insights.push({ icon: "", cat: "Volatilidad", color: c,
      text: `VIX ${v.toFixed(2)} — ${v > 30 ? "alta tensión en mercados, risk-off" : v > 20 ? "volatilidad elevada, cautela recomendada" : "ambiente de calma, risk-on"}` });
  }
  if (macroData?.t10y?.value != null) {
    const r = macroData.t10y.value;
    const sp = macroData?.spread;
    insights.push({ icon: "", cat: "Tasas EUA", color: r > 5 ? "var(--negative)" : "var(--warning)",
      text: `Tasa 10Y Treasury ${r.toFixed(2)}%${sp?.value != null ? ` · Spread ${sp.value >= 0 ? "+" : ""}${Math.round(sp.value * 100)} pb${sp.inverted ? " ⚠ curva invertida" : ""}` : ""}` });
  }
  if (md?.gold?.change_pct != null) {
    const up = md.gold.change_pct >= 0;
    insights.push({ icon: "", cat: "Oro", color: up ? "var(--warning)" : "var(--muted)",
      text: `Oro ${up ? "avanza" : "retrocede"} ${Math.abs(md.gold.change_pct).toFixed(2)}% a $${md.gold.value.toLocaleString("en-US", { maximumFractionDigits: 2 })}/oz — ${up ? "demanda de refugio activa" : "menor apetito por safe-haven"}` });
  }
  if (md?.wti?.change_pct != null) {
    const up = md.wti.change_pct >= 0;
    insights.push({ icon: "", cat: "Petróleo WTI", color: up ? "var(--warning)" : "var(--negative)",
      text: `WTI ${up ? "+" : ""}${md.wti.change_pct.toFixed(2)}% a $${md.wti.value.toFixed(2)}/bbl — ${up ? "presión inflacionaria en energía" : "alivio en precios de energía"}` });
  }
  if (md?.btc?.change_pct != null) {
    const up = md.btc.change_pct >= 0;
    insights.push({ icon: "BTC", cat: "Bitcoin", color: up ? "var(--warning)" : "var(--negative)",
      text: `Bitcoin ${up ? "+" : ""}${md.btc.change_pct.toFixed(2)}% a $${Math.round(md.btc.value).toLocaleString()} USD — cripto ${up ? "en verde" : "bajo presión"}` });
  }

  const hasData = insights.length > 0;
  const positive = insights.filter(i => i.color === "var(--positive)" || i.color === "var(--warning)").length;
  const negative = insights.filter(i => i.color === "var(--negative)").length;
  const mood = negative > positive ? "Cauteloso" : positive > negative ? "Positivo" : "Mixto";
  const moodColor = mood === "Positivo" ? "var(--positive)" : mood === "Cauteloso" ? "var(--negative)" : "var(--warning)";

  return (
    <div className="dark-panel" style={{
      background: "linear-gradient(135deg, #0f0f0f 0%, #1c1c1c 100%)",
      borderRadius: 24, padding: collapsed ? "18px 24px" : "24px 28px",
      color: "#fff", position: "relative", overflow: "hidden",
      boxShadow: "0 4px 24px rgba(0,0,0,0.15)",
    }}>
      <div style={{ position: "absolute", top: -60, right: -60, width: 240, height: 240, borderRadius: "50%", background: "var(--accent)", opacity: 0.04 }} />
      <div style={{ position: "absolute", bottom: -40, left: -40, width: 160, height: 160, borderRadius: "50%", background: "#6366f1", opacity: 0.05 }} />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: collapsed ? 0 : 20, position: "relative" }}>
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
              <span style={{ fontSize: 18 }}></span>
              <span style={{ fontWeight: 700, fontSize: 17, letterSpacing: "-0.01em" }}>Resumen Mañanero</span>
              <span className="glow-pulse" style={{ background: "var(--accent)", color: "var(--on-accent)", fontSize: 9, fontWeight: 800, padding: "2px 7px", borderRadius: 4, letterSpacing: "0.08em" }}>LIVE</span>
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "capitalize" }}>{today}</div>
          </div>
          {hasData && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: `color-mix(in srgb, ${moodColor} 15%, transparent)`, border: `1px solid color-mix(in srgb, ${moodColor} 35%, transparent)`, borderRadius: 999, padding: "4px 12px" }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: moodColor, animation: "pulse 2s infinite" }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: moodColor }}>Sentimiento: {mood}</span>
            </div>
          )}
        </div>
        <button onClick={() => setCollapsed(!collapsed)} style={{
          background: "#ffffff12", border: "1px solid #ffffff18", borderRadius: 8,
          color: "var(--muted-2)", padding: "6px 16px", cursor: "pointer", fontSize: 12, fontWeight: 600,
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
              <span>Cargando datos de mercado — haz clic en <b style={{ color: "var(--positive)" }}>↻ Mercados</b> para iniciar</span>
            </div>
          ) : insights.map((ins, i) => (
            <div key={i} style={{
              background: "var(--bg-deep)", borderRadius: 10, padding: "10px 14px",
              borderLeft: "2px solid var(--accent)",
              display: "flex", gap: 10, alignItems: "flex-start",
              animation: `slideIn 0.3s ease ${Math.min(i * 0.06, 0.5)}s both`,
              transition: "background 0.15s",
              cursor: "default",
            }}
              onMouseEnter={(e) => e.currentTarget.style.background = "#222222"}
              onMouseLeave={(e) => e.currentTarget.style.background = "var(--bg-deep)"}
            >
              <div>
                <div style={{ fontSize: 9, color: "var(--accent)", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 3 }}>{ins.cat}</div>
                <div style={{ fontSize: 12, color: "var(--muted-2)", lineHeight: 1.45 }}>{ins.text}</div>
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
  const sentColor = item.sentiment === "positive" ? "var(--positive)" : item.sentiment === "negative" ? "var(--negative)" : "var(--warning)";
  const sentLabel = item.sentiment === "positive" ? "Positiva" : item.sentiment === "negative" ? "Negativa" : "Neutral";
  const [nowSec] = useState(() => Math.floor(Date.now() / 1000));
  const timeAgo   = item.time ? (() => {
    const s = nowSec - item.time;
    if (s < 3600)  return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    return `${Math.floor(s / 86400)}d`;
  })() : "";
  return (
    <div className="news-card" style={{
      background: "var(--surface)", borderRadius: 10, border: "1px solid var(--border)",
      borderLeft: `3px solid ${sentColor}`, padding: "10px 14px",
      animation: `slideIn 0.3s ease ${Math.min(index * 0.05, 0.5)}s both`,
    }}>
      <a href={item.url} target="_blank" rel="noreferrer" style={{
        color: "var(--ink)", fontWeight: 600, fontSize: 13, lineHeight: 1.4,
        textDecoration: "none", display: "block", marginBottom: 3,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}
        onMouseEnter={(e) => e.currentTarget.style.color = "var(--accent)"}
        onMouseLeave={(e) => e.currentTarget.style.color = "var(--ink)"}
      >{item.title}</a>
      {item.summary && <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.4, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.summary}</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {item.publisher && <span style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600 }}>{item.publisher}</span>}
        {timeAgo && <span style={{ fontSize: 10, color: "var(--muted)" }}>· {timeAgo}</span>}
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
  } catch { /* sin dato: se conserva el valor previo */ }
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
    <svg className="dark-panel" viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block", background: "var(--bg-deep)", borderRadius: 12 }}>
      <defs>
        <linearGradient id="portGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.25" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.03" />
        </linearGradient>
        <linearGradient id="spyGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6366f1" stopOpacity="0.20" />
          <stop offset="100%" stopColor="#6366f1" stopOpacity="0.03" />
        </linearGradient>
      </defs>

      {/* Grid */}
      {gridVals.map((v, i) => (
        <g key={i}>
          <line x1={PAD.left} y1={toY(v)} x2={W - PAD.right} y2={toY(v)} stroke="var(--border)" strokeWidth={1} />
          <text x={PAD.left - 6} y={toY(v) + 4} textAnchor="end" fill="var(--muted-2)" fontSize={9}>
            {((v - 1) * 100).toFixed(1)}%
          </text>
        </g>
      ))}

      {/* Línea base 0% */}
      {minY < 1 && maxY > 1 && (
        <line x1={PAD.left} y1={toY(1)} x2={W - PAD.right} y2={toY(1)}
          stroke="var(--border-strong)" strokeWidth={1} strokeDasharray="4,3" />
      )}

      {/* Banda SPY p5–p95 */}
      <path className="chart-fade-in" d={areaPath(spyStats.map(s => s.p95), spyStats.map(s => s.p5))}
        fill="url(#spyGrad)" />
      {/* Línea media SPY */}
      <path className="chart-fade-in" d={linePath(spyStats.map(s => s.mean))}
        fill="none" stroke="#6366f1" strokeWidth={2} strokeDasharray="6,3" strokeLinejoin="round" />

      {/* Banda portafolio p5–p95 */}
      <path className="chart-fade-in" d={areaPath(portStats.map(s => s.p95), portStats.map(s => s.p5))}
        fill="url(#portGrad)" />
      {/* Línea media portafolio */}
      <path className="chart-draw-line" pathLength={1} d={linePath(portStats.map(s => s.mean))}
        fill="none" stroke="var(--accent)" strokeWidth={2.5} strokeLinejoin="round" />

      {/* Eje X — etiquetas cada ~10 semanas */}
      {weeks.map((w, i) => {
        if (i % 10 !== 0 && i !== weeks.length - 1) return null;
        return (
          <text key={i} x={toX(i)} y={H - 8} textAnchor="middle" fill="var(--muted-2)" fontSize={9}>{w}</text>
        );
      })}

      {/* Leyenda */}
      {[
        { color: "var(--accent)", dash: false, label: "Portafolio (media ± rango 90%)" },
        { color: "#6366f1", dash: true,  label: "SPY (media ± rango 90%)" },
      ].map((s, i) => (
        <g key={s.label} transform={`translate(${PAD.left + i * 240}, 8)`}>
          <line x1={0} y1={6} x2={22} y2={6} stroke={s.color} strokeWidth={2.5} strokeDasharray={s.dash ? "5,3" : "none"} />
          <text x={28} y={10} fill="var(--muted)" fontSize={10}>{s.label}</text>
        </g>
      ))}
    </svg>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
// La app nueva (src/app/LegacyPage.jsx) monta el Workspace legado dentro de sus rutas privadas:
// la sesión ya la resolvió RequireAuth, así que aquí solo queda detectar el backend y abrir la
// tab que pide la ruta. `apiBase` fija el backend (el API_BASE de src/lib/api/client.js); sin
// él se prueban los candidatos de siempre. `onTabChange(tab)` avisa cada cambio de tab para que
// la URL la siga.
// Workspace se monta solo cuando BACKEND ya está resuelto: sus efectos de montaje piden datos
// al backend y antes corrían contra "null/...".
export function LegacyWorkspaceHost({ tab = "news", apiBase, onLogout, onTabChange }) {
  const [backendUrl, setBackendUrl] = useState(null);
  const [backendSearching, setBackendSearching] = useState(true);

  useEffect(() => {
    detectBackend(apiBase ? [apiBase] : BACKEND_CANDIDATES).then(url => {
      BACKEND = url;
      setBackendUrl(url);
      setBackendSearching(false);
    });
  }, [apiBase]);

  if (backendSearching) return (
    <div style={{ minHeight:"100vh", background:"var(--bg)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
      <div style={{ fontSize:13, color:"var(--muted)", letterSpacing:3 }}>CONECTANDO AL SERVIDOR…</div>
      <div style={{ marginTop:16, width:180, height:3, background:"var(--surface-3)", borderRadius:4, overflow:"hidden" }}>
        <div style={{ height:"100%", background:"var(--accent)", borderRadius:4, animation:"loadbar 1.5s ease-in-out infinite" }} />
      </div>
      <style>{`@keyframes loadbar { 0%{width:0%} 60%{width:100%} 100%{width:100%} }`}</style>
    </div>
  );

  if (!backendUrl) return (
    <div style={{ minHeight:"100vh", background:"var(--bg)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:12 }}>
      <div style={{ fontSize:20, color:"var(--negative)", fontWeight:800 }}>SIN CONEXIÓN AL SERVIDOR</div>
      <div style={{ fontSize:12, color:"var(--muted)", letterSpacing:1, textAlign:"center", maxWidth:340 }}>
        Ningún backend respondió. Asegúrate de que Railway o Render estén activos, o corre <span style={{color:"var(--accent)",fontFamily:"var(--font-mono)"}}>python backend.py</span> localmente.
      </div>
      <Button onClick={() => { setBackendSearching(true); detectBackend(apiBase ? [apiBase] : BACKEND_CANDIDATES).then(url => { BACKEND=url; setBackendUrl(url); setBackendSearching(false); }); }} size="lg">
        REINTENTAR
      </Button>
    </div>
  );

  return <Workspace backendUrl={backendUrl} initialTab={tab} onLogout={onLogout} onTabChange={onTabChange} />;
}

function Workspace({ backendUrl, initialTab = "news", onLogout, onTabChange }) {
  const { dark, toggle: toggleTheme } = useTheme();
  const [tab, setTab] = useState(initialTab);
  // Si la ruta cambia con el Workspace montado, se abre la tab nueva (ajuste de estado en render).
  const [routeTab, setRouteTab] = useState(initialTab);
  if (routeTab !== initialTab) { setRouteTab(initialTab); setTab(initialTab); }
  // Y al revés: cada cambio de tab se avisa para que la URL lo siga (src/app/LegacyPage.jsx).
  useEffect(() => { onTabChange?.(tab); }, [tab, onTabChange]);
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
  const isExperimental = false; // Modo experimental eliminado; se deja en false para no tocar cada referencia.
  const expTotal = activePortfolioObj?.experimentalTotal ?? 0;

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
  const loadingTickersRef = useRef(new Set());
  const sharpeLoadingRef = useRef(0); // contador de corridas de loadSharpeData
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
  const [optimError, setOptimError] = useState(null);
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
  const [lastUpdated, setLastUpdated] = useState(null);
  const [newsFilter, setNewsFilter] = useState("all");
  const autoRefresh = true;
  const refreshTimerRef = useRef(null);
  const [backtestResult, setBacktestResult] = useState(null);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [backtestError, setBacktestError] = useState(null);
  const [newsTicker, setNewsTicker] = useState("");
  const [macroData, setMacroData] = useState(null);
  const [dcfData, setDcfData] = useState({});       // { ticker: {...} }
  const [fibrasData, setFibrasData] = useState(() => {
    try { const saved = localStorage.getItem("kaizen_fibras_data"); return saved ? JSON.parse(saved) : null; } catch { return null; }
  });
  const [fibrasLoading, setFibrasLoading] = useState(false);
  const [fibrasExtra, setFibrasExtra] = useState(() => {
    try { return localStorage.getItem("kaizen_fibras_extra") ?? ""; } catch { return ""; }
  });
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
  const [analisisEdgar, setAnalisisEdgar] = useState(null);
  const [analisisEdgarLoading, setAnalisisEdgarLoading] = useState(false);

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

  // Limpiar resultados de análisis al cambiar de portafolio activo
  useEffect(() => {
    setOptimResult(null);
    setBacktestResult(null);
    setBacktestError(null);
    setMonteCarloResult(null);
    setMonteCarloError(null);
  }, [activePortfolioId]);

  // Fetch RF rate + macro on mount
  useEffect(() => {
    fetchRiskFreeRate()
      .then((r) => { setRfRate(r.rate); setRfLabel(r.label); setBackendOk(r.ok); })
      .catch(() => setBackendOk(false));
    authorizedFetch(`${BACKEND}/macro`).then(r => r.json()).then(setMacroData).catch(() => {});
    authorizedFetch(`${BACKEND}/fx`).then(r => r.json()).then(d => { if (d?.USDMXN) { USDMXN_SPOT = d.USDMXN; setUsdMxn(d.USDMXN); } }).catch(() => {});
  }, []);

  // Keep-alive: ping cada 9 min para evitar que Render (free tier) duerma
  // Usa /fx para asegurarse de que el servicio Python esté activo (no solo el proxy)
  useEffect(() => {
    if (!backendUrl) return;
    const id = setInterval(() => {
      authorizedFetch(`${backendUrl}/fx`, { signal: AbortSignal.timeout(10000) }).catch(() => {});
    }, 9 * 60 * 1000);
    return () => clearInterval(id);
  }, [backendUrl]);

  // Load stock data for portfolio
  const loadStockData = useCallback(async (ticker) => {
    if (ticker === '$MXN') {
      setStockData(prev => ({ ...prev, '$MXN': { price: 1, name: 'Efectivo MXN' } }));
      return;
    }
    setLoading((p) => ({ ...p, [ticker]: true }));
    try {
      const sd = await fetchStock(ticker);
      if (sd) setStockData((prev) => ({ ...prev, [ticker]: sd }));
      // DCF en paralelo
      authorizedFetch(`${BACKEND}/dcf/${encodeURIComponent(ticker)}`).then(r => r.json())
        .then(d => setDcfData(prev => ({ ...prev, [ticker]: d }))).catch(() => {});
    } catch (e) {
      console.error(ticker, e);
    }
    setLoading((p) => ({ ...p, [ticker]: false }));
  }, []);

  useEffect(() => {
    // Carga secuencial con delay para evitar rate limiting.
    // loadingTickersRef evita que este efecto (que se re-dispara cada vez que
    // cambia el arreglo `portfolio`, incluso por ediciones ajenas al precio)
    // dispare fetches duplicados para un ticker que ya está en curso.
    const loadAll = async () => {
      for (const p of portfolio) {
        if (!stockData[p.ticker] && !loadingTickersRef.current.has(p.ticker)) {
          loadingTickersRef.current.add(p.ticker);
          try {
            await loadStockData(p.ticker);
          } finally {
            loadingTickersRef.current.delete(p.ticker);
          }
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
    setOptimError(null);
    setOptimLoadingMsg("Descargando histórico del portafolio...");
    try {

    const tickers = portfolio.map((p) => p.ticker).filter(t => t !== '$MXN');
    if (tickers.length < 2) {
      setOptimError("Se necesitan al menos 2 activos (sin contar efectivo) para optimizar.");
      return;
    }
    const returnsAll = [];
    const lastClosesOptim = []; // último precio del historial por ticker
    for (const t of tickers) {
      const closes = await fetchChart(t, optimPeriod);
      const returns = closes.slice(1).map((v, i) => (v - closes[i]) / closes[i]).filter(isFinite);
      if (returns.length < 10) {
        setOptimError(`No hay suficiente historial para ${t} en el periodo elegido.`);
        return;
      }
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

    // Pesos actuales por valor de mercado — fetchChart ya devuelve cierres en MXN,
    // así que USD y MXN se suman en la misma moneda sin volver a convertir
    const valOf = (t, i) => (portfolio.find(p => p.ticker === t)?.shares ?? 0) * lastClosesOptim[i];
    const totalVal = tickers.reduce((s, t, i) => s + valOf(t, i), 0);
    const actualWeights = tickers.map((t, i) => totalVal > 0 ? valOf(t, i) / totalVal : 1 / tickers.length);
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
    } catch (e) {
      console.error("Optimización:", e);
      setOptimError(`Error al optimizar: ${e?.message ?? e}. Verifica que el backend esté activo.`);
    } finally {
      setOptimLoadingMsg("");
      setOptimLoading(false);
    }
  };

  // Asegura que el servicio Python de Render esté COMPLETAMENTE despierto.
  // Usa /fx (no /health) porque /health puede ser respondido por el proxy de Render
  // sin que el servicio Python haya cargado; /fx requiere el servicio real.
  const ensureBackend = async () => {
    if (!BACKEND) return false;
    const deadline = Date.now() + 120000; // hasta 2 minutos
    while (Date.now() < deadline) {
      try {
        const r = await authorizedFetch(`${BACKEND}/fx`, { signal: AbortSignal.timeout(15000) });
        const d = await r.json();
        if (d?.USDMXN || d?.usdmxn) return true; // respuesta real del servicio
      } catch { /* sin dato: se conserva el valor previo */ }
      await sleep(6000);
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

      const tickers = portfolio.map((p) => p.ticker).filter(t => t !== '$MXN');
      if (!tickers.length) {
        setBacktestError("El portafolio solo tiene efectivo; agrega al menos un activo para el backtest.");
        setBacktestLoading(false);
        return;
      }
      const returnsMap = {};
      for (const t of tickers) {
        await sleep(200);
        const closes = await fetchChart(t, "5y", 60000);
        returnsMap[t] = closes.slice(1).map((v, i) => (v - closes[i]) / closes[i]).filter(isFinite);
      }

      // Pesos: usa expPct en experimental (exactamente lo configurado por el usuario)
      // o valor de mercado en portafolios normales
      const _fx = usdMxn;
      const allHaveExpPct = portfolio.every(p => p.expPct != null && p.expPct > 0);
      let weights;
      if (allHaveExpPct) {
        const totalPct = portfolio.reduce((s, p) => s + p.expPct, 0);
        weights = portfolio.map(p => p.expPct / (totalPct || 1));
      } else {
        const totalValue = portfolio.reduce((s, p) => s + posValMXN(p, stockData, _fx), 0);
        weights = portfolio.map(p => {
          const val = posValMXN(p, stockData, _fx);
          return totalValue > 0 ? val / totalValue : 1 / portfolio.length;
        });
      }

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
      const spyReturns = spyReturnsRaw.slice(-minLen);
      const portReturns = weightedReturns(portfolio, weights, returnsMap, minLen);

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
          const ri = returnsMap[ti]?.slice(-minLen) ?? [];
          const rj = returnsMap[tj]?.slice(-minLen) ?? [];
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

      const tickers = portfolio.map(p => p.ticker).filter(t => t !== '$MXN');
      if (!tickers.length) {
        setMonteCarloError("El portafolio solo tiene efectivo; agrega al menos un activo para simular.");
        setMonteCarloLoading(false);
        return;
      }
      const returnsMap = {};
      for (const t of tickers) {
        await sleep(200);
        const closes = await fetchChart(t, "5y", 60000);
        returnsMap[t] = closes.slice(1).map((v, i) => (v - closes[i]) / closes[i]).filter(isFinite);
      }

      // Pesos: usa expPct en experimental (exactamente lo configurado por el usuario)
      const _fx = usdMxn;
      const allHaveExpPctMC = portfolio.every(p => p.expPct != null && p.expPct > 0);
      let weights;
      if (allHaveExpPctMC) {
        const totalPct = portfolio.reduce((s, p) => s + p.expPct, 0);
        weights = portfolio.map(p => p.expPct / (totalPct || 1));
      } else {
        const totalValue = portfolio.reduce((s, p) => s + posValMXN(p, stockData, _fx), 0);
        weights = portfolio.map(p => {
          const val = posValMXN(p, stockData, _fx);
          return totalValue > 0 ? val / totalValue : 1 / portfolio.length;
        });
      }

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
      const portRet = weightedReturns(portfolio, weights, returnsMap, minLen);
      const spyWin  = spyRet.slice(-minLen);  // misma ventana que el portafolio

      const mean = arr => arr.reduce((a, b) => a + b, 0) / (arr.length || 1);
      const std  = arr => { const m = mean(arr); return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length || 1)); };

      const muPort  = mean(portRet);  const sigPort = std(portRet);
      const muSpy   = mean(spyWin);   const sigSpy  = std(spyWin);

      // Box-Muller para números normales
      const randn = () => Math.sqrt(-2 * Math.log(Math.random() + 1e-12)) * Math.cos(2 * Math.PI * Math.random());

      const H = 52;    // semanas
      const N = 10000; // simulaciones (reducido de 50k para evitar freeze del browser)

      // Choques correlacionados: portafolio y SPY se mueven juntos según su correlación histórica.
      // Con sorteos independientes la probabilidad de superar al SPY salía inflada.
      const covPS = portRet.reduce((s, r, i) => s + (r - muPort) * (spyWin[i] - muSpy), 0) / (portRet.length || 1);
      const rho = sigPort && sigSpy ? Math.max(-1, Math.min(1, covPS / (sigPort * sigSpy))) : 0;
      const rhoC = Math.sqrt(1 - rho * rho);
      const portPaths = [], spyPaths = [];
      for (let k = 0; k < N; k++) {
        const pp = [1], sp = [1];
        for (let t = 0; t < H; t++) {
          const z1 = randn(), z2 = rho * z1 + rhoC * randn();
          pp.push(pp[t] * (1 + muPort + sigPort * z1));
          sp.push(sp[t] * (1 + muSpy + sigSpy * z2));
        }
        portPaths.push(pp); spyPaths.push(sp);
      }

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
        } catch { /* sin dato: se conserva el valor previo */ }
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
      } catch { /* sin dato: se conserva el valor previo */ }

      // DCF + Momentum en paralelo
      let dcf = null, mom = null;
      try {
        [dcf, mom] = await Promise.all([
          authorizedFetch(`${BACKEND}/dcf/${encodeURIComponent(t)}`).then(r => r.json()).catch(() => null),
          authorizedFetch(`${BACKEND}/momentum/${encodeURIComponent(t)}`).then(r => r.json()).catch(() => null),
        ]);
      } catch { /* sin dato: se conserva el valor previo */ }
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
        const magicRes = await authorizedFetch(`${BACKEND}/magic_one/${encodeURIComponent(ticker)}`).then(r => r.json()).catch(() => null);
        if (!magicRes || magicRes.skip) { await sleep(80); continue; }
        candidates.push(magicRes);
      } catch { /* sin dato: se conserva el valor previo */ }
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
      const data = await authorizedFetch(url).then(r => r.json());
      setFibrasData(data);
      try {
        localStorage.setItem("kaizen_fibras_data", JSON.stringify(data));
        localStorage.setItem("kaizen_fibras_extra", extra);
      } catch { /* sin dato: se conserva el valor previo */ }
    } catch { /* sin dato: se conserva el valor previo */ }
    setFibrasLoading(false);
  };

  const loadSharpeData = async (period = "1y") => {
    // Gana la corrida más reciente: antes una corrida en curso bloqueaba la nueva y el
    // Sharpe se quedaba con el portafolio anterior. Las corridas viejas ya no escriben estado.
    const run = ++sharpeLoadingRef.current;
    const isStale = () => run !== sharpeLoadingRef.current;
    const result = {};
    const returnsMap = {};
    const lastPriceMap = {}; // último cierre del historial → no depende de stockData
    const rf = rfRate ?? 0.0860;

    for (const p of portfolio) {
      if (p.ticker === '$MXN') continue;
      try {
        const closes = await fetchChart(p.ticker, period);
        if (closes.length < 10) continue;
        const returns = closes.slice(1).map((v, i) => (v - closes[i]) / closes[i]).filter(isFinite);
        result[p.ticker] = +sharpeOf(returns, rf).toFixed(2);
        returnsMap[p.ticker] = returns;
        lastPriceMap[p.ticker] = closes[closes.length - 1]; // precio más reciente del historial
        await sleep(150);
      } catch { /* skip */ }
      if (isStale()) return;
    }
    if (isStale()) return;
    setSharpeData(result);

    // Sharpe exacto del portafolio con matriz de covarianza (incluye correlaciones)
    const tickers = portfolio.map(p => p.ticker).filter(t => returnsMap[t]);
    if (tickers.length >= 2) {
      const returnsMatrix = tickers.map(t => returnsMap[t]);
      const { cov, means } = buildCovMatrix(returnsMatrix);

      // Pesos por valor de mercado usando el último cierre del historial (ya en MXN)
      const valOf = t => (portfolio.find(p => p.ticker === t)?.shares ?? 0) * (lastPriceMap[t] ?? 0);
      const totalVal = tickers.reduce((s, t) => s + valOf(t), 0);
      const weights = tickers.map(t => totalVal > 0 ? valOf(t) / totalVal : 1 / tickers.length);

      const exact = calcPortfolioSharpe(weights, cov, means, rf);
      setPortfolioSharpeExact(isFinite(exact) ? +exact.toFixed(2) : null);
    } else if (tickers.length === 1) {
      setPortfolioSharpeExact(result[tickers[0]] ?? null);
    } else {
      setPortfolioSharpeExact(null);
    }
  };

  // Cargar Sharpe individual al montar o cuando cambia portafolio/rf
  // La firma cubre cambio de portafolio activo, tickers y número de acciones; antes solo
  // portfolio.length, así que cambiar a otro portafolio del mismo tamaño dejaba cifras viejas.
  const sharpeKey = `${activePortfolioId}|${portfolio.map(p => `${p.ticker}:${p.shares}`).join(",")}`;
  useEffect(() => {
    if (rfRate !== null && portfolio.length > 0) loadSharpeData("1y");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadSharpeData se recrea cada render; sharpeKey resume lo que importa
  }, [rfRate, sharpeKey]);

  const loadNews = async (ticker) => {
    if (!ticker.trim()) return;
    setNewsLoading(true);
    setNewsData([]);
    try {
      const res = await authorizedFetch(`${BACKEND}/news/${encodeURIComponent(ticker.trim().toUpperCase())}`);
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
    setAnalisisEdgar(null);
    try {
      const [stockRes, chartRes] = await Promise.all([
        authorizedFetch(`${BACKEND}/stock/${t}`),
        authorizedFetch(`${BACKEND}/chart/${t}?period=${period}`),
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
    authorizedFetch(`${BACKEND}/returns/${t}`).then(r => r.ok ? r.json() : null).then(rd => setAnalisisReturns(rd)).catch(() => {});
    setAnalisisEdgarLoading(true);
    authorizedFetch(`${BACKEND}/edgar/${t}`).then(r => r.ok ? r.json() : null).then(ed => setAnalisisEdgar(ed)).catch(() => setAnalisisEdgar(null)).finally(() => setAnalisisEdgarLoading(false));
    setAnalisisNewsLoading(true);
    try {
      const nr = await authorizedFetch(`${BACKEND}/news/${encodeURIComponent(t)}`);
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
      const cd = await authorizedFetch(`${BACKEND}/chart/${t}?period=${period}`).then(r => r.ok ? r.json() : null);
      setAnalisisChart(cd);
    } catch { /* sin dato: se conserva el valor previo */ }
  }, [analisisTicker]);

  const loadMarketData = useCallback(async () => {
    setMarketDataLoading(true);
    try {
      const data = await authorizedFetch(`${BACKEND}/market`).then(r => r.json());
      setMarketData(data);
      setLastUpdated(new Date());
    } catch { /* sin dato: se conserva el valor previo */ }
    setMarketDataLoading(false);
  }, []);

  const loadMarketNews = useCallback(async () => {
    setMarketNewsLoading(true);
    try {
      const data = await authorizedFetch(`${BACKEND}/news/market`).then(r => r.json());
      setMarketNews(data.news ?? []);
    } catch { /* sin dato: se conserva el valor previo */ }
    setMarketNewsLoading(false);
  }, []);


  const loadWorldMap = useCallback(async () => {
    setWorldMapLoading(true);
    try {
      const data = await authorizedFetch(`${BACKEND}/worldmap`).then(r => r.json());
      setWorldMapData(data);
    } catch { /* sin dato: se conserva el valor previo */ }
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
    if (tab !== "news" || !autoRefresh) return;
    refreshTimerRef.current = setInterval(loadMarketData, 60_000);
    return () => clearInterval(refreshTimerRef.current);
  }, [tab, autoRefresh, loadMarketData]);

  const addStock = async () => {
    if (addingRef.current) return;
    addingRef.current = true;
    setAddError("");
    try {
      if (!newTicker) return;
      const t = newTicker.toUpperCase().trim();
      const cost = parseFloat(newCost);
      let shares;

      if (inputMode === "pct") {
        const pct = parseFloat(newPct);
        if (!pct || pct <= 0 || pct > 100) { setAddError("Porcentaje inválido (debe ser > 0 y ≤ 100)."); return; }
        let price = stockData[t]?.price;
        if (!price) {
          if (t === '$MXN') {
            price = 1;
            setStockData(prev => ({ ...prev, '$MXN': { price: 1, name: 'Efectivo MXN' } }));
          } else {
            let sd;
            try {
              sd = await fetchStock(t);
            } catch {
              setAddError(`No se pudo obtener el precio de ${t}. El servidor puede estar despertando — intenta de nuevo en unos segundos.`);
              return;
            }
            if (sd?.price) { price = sd.price; setStockData((prev) => ({ ...prev, [t]: sd })); }
          }
        }
        if (!price) { setAddError("No se pudo obtener el precio actual. Intenta en modo Acciones."); return; }
        const totalValue = portfolio.reduce((s, p) => s + posVal(p), 0);
        const basis = expTotal > 0 ? expTotal : totalValue;
        if (basis <= 0) { setAddError("Define un presupuesto (MXN) o agrega antes una posición con precio."); return; }
        shares = (pct / 100 * basis) / toMXN(t, price);
      } else {
        shares = parseFloat(newShares);
        if (!shares || shares <= 0) { setAddError(t === '$MXN' ? "Ingresa el monto en MXN (> 0)." : "Ingresa un número de acciones válido (> 0)."); return; }
      }

      if (portfolio.find((p) => p.ticker === t)) {
        setPortfolio((prev) => prev.map((p) =>
          p.ticker === t ? { ...p, shares, cost: t === '$MXN' ? 1 : isNaN(cost) ? p.cost : cost } : p
        ));
        loadStockData(t);
      } else {
        setPortfolio((prev) => [...prev, { ticker: t, shares, cost: t === '$MXN' ? 1 : isNaN(cost) ? 0 : cost }]);
      }
      setNewTicker(""); setNewShares(""); setNewCost(""); setNewPct("");
    } catch (e) {
      setAddError("Ocurrió un error inesperado. Intenta de nuevo.");
      console.error("addStock", e);
    } finally {
      addingRef.current = false;
    }
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

  return (
    <div className="app-shell">
      <style>{`
        @keyframes spin      { to { transform: rotate(360deg); } }
        @keyframes fadeIn    { from { opacity:0; transform:translateY(6px); }  to { opacity:1; transform:translateY(0); } }
        @keyframes slideIn   { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
        @keyframes pulse     { 0%,100% { opacity:1; } 50% { opacity:0.35; } }
        @keyframes ticker    { from { transform:translateX(0); } to { transform:translateX(-50%); } }
        @keyframes countRing { from { stroke-dashoffset: 100; } to { stroke-dashoffset: 0; } }
        .mkt-card { transition: box-shadow 0.15s ease, border-color 0.15s ease; border: 1.5px solid var(--border); }
        .mkt-card:hover { box-shadow: 0 0 0 1px var(--accent), 0 4px 20px color-mix(in srgb, var(--accent) 15%, transparent) !important; border-color: var(--accent) !important; }
        .mkt-card-up:hover   { background: color-mix(in srgb, var(--positive-soft) 55%, var(--surface)) !important; }
        .mkt-card-down:hover { background: color-mix(in srgb, var(--negative-soft) 55%, var(--surface)) !important; }
        .tab-pill { transition: all 0.15s ease; }
        .btn-exec { transition: background 0.15s ease, color 0.15s ease; }
        .btn-exec:hover:not(:disabled) { background: var(--accent) !important; color: var(--on-accent) !important; }

        /* ── Animaciones ── */
        @keyframes float      { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
        @keyframes fadeUp     { from { opacity:0; transform: translateY(16px); } to { opacity:1; transform: translateY(0); } }
        @keyframes glowPulse  { 0%,100% { box-shadow: 0 0 8px color-mix(in srgb, var(--accent) 35%, transparent), 0 0 16px color-mix(in srgb, var(--accent) 15%, transparent); } 50% { box-shadow: 0 0 14px color-mix(in srgb, var(--accent) 55%, transparent), 0 0 30px color-mix(in srgb, var(--accent) 25%, transparent); } }
        @keyframes shimmerTxt { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        .float { animation: float 5s ease-in-out infinite; }
        .fade-up { animation: fadeUp 0.5s cubic-bezier(0.22,1,0.36,1) both; }
        .glow-pulse { animation: glowPulse 2.4s ease-in-out infinite; }
        .stat-shimmer {
          background: linear-gradient(90deg, var(--accent) 0%, var(--accent-strong) 40%, var(--accent) 60%, var(--accent-strong) 100%);
          background-size: 200% 100%;
          -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
          animation: shimmerTxt 3s ease-in-out infinite;
        }
        .kpi-hover { transition: transform 0.2s ease, box-shadow 0.2s ease; }
        .kpi-hover:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); }
        .stagger-1 { animation-delay: 0.05s; } .stagger-2 { animation-delay: 0.12s; }
        .stagger-3 { animation-delay: 0.19s; } .stagger-4 { animation-delay: 0.26s; }
        .stagger-5 { animation-delay: 0.33s; } .stagger-6 { animation-delay: 0.40s; }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: var(--surface-2); }
        ::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 3px; }
        input::placeholder { color: var(--muted-2); }
        table { border-collapse: collapse; width: 100%; }
        th { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); padding: 10px 14px; text-align: left; border-bottom: 1px solid var(--border); font-weight: 700; }
        td { padding: 11px 14px; font-size: 14px; border-bottom: 1px solid var(--border); color: var(--ink-soft); }
        tr:hover td { background: var(--surface-2); }
        .rebal-slider { -webkit-appearance: none; appearance: none; height: 3px; background: var(--border); border-radius: 99px; outline: none; cursor: pointer; }
        .rebal-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 12px; height: 12px; background: var(--accent); border-radius: 50%; cursor: pointer; margin-top: -4.5px; }
        .rebal-slider::-webkit-slider-runnable-track { height: 3px; background: var(--border); border-radius: 99px; }
        .rebal-slider::-moz-range-thumb { width: 12px; height: 12px; background: var(--accent); border-radius: 50%; cursor: pointer; border: none; }
        .rebal-slider::-moz-range-track { height: 3px; background: var(--border); border-radius: 99px; }
        .mobile-tab-label { display: none; }

        /* ── RESPONSIVE ── */
        .resp-grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
        .resp-grid-3 { display:grid; grid-template-columns:repeat(3,1fr); gap:16px; }
        .table-scroll { overflow-x:auto; -webkit-overflow-scrolling:touch; }

        @media (max-width: 768px) {
          .mobile-tab-label {
            display:flex; align-items:center;
            background:var(--accent-strong); color:var(--on-accent);
            border-radius:999px; padding:7px 16px;
            font-weight:800; font-size:13px;
            white-space:nowrap; max-width:160px; overflow:hidden; text-overflow:ellipsis;
          }
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

      {/* ══ SIDEBAR ══ */}
      <aside className="app-sidebar">
        {/* Logo */}
        <div className="sidebar-head" style={{ padding: "3px 8px 16px" }}>
          <div className="brand">
            <Mark onDark size={44} />
            <span className="brand-wordmark">KAIZEN<small>Investment Group</small></span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="app-nav">
          {[
            { section: "DASHBOARDS", items: [
              { id: "portfolio",  label: "Portfolio", icon: Briefcase },
              { id: "news",       label: "Noticias", icon: Newspaper },
              { id: "analytics",  label: "Analytics vs SPY", icon: ChartNoAxesCombined },
            ]},
            { section: "ANÁLISIS", items: [
              { id: "optimize",   label: "Sharpe Optimizer", icon: Gauge },
              { id: "screener",   label: "ML Screener", icon: ListFilter },
              { id: "analisis",   label: "Análisis", icon: LineChartIcon },
            ]},
            { section: "ESTRATEGIAS", items: [
              { id: "fibras",     label: "FIBRA Screener", icon: Landmark },
              { id: "magic",      label: "Fórmula Mágica", icon: Sparkles },
            ]},
          ].map(({ section, items }) => (
            <div key={section}>
              <span className="app-nav-label">{section}</span>
              {items.map(t => (
                <button key={t.id} onClick={() => setTab(t.id)} className={cn("app-nav-link", tab === t.id && "is-active")}>
                  <t.icon aria-hidden="true" size={16} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{t.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        {/* Status at bottom */}
        <div className="sidebar-foot">
          <div className="data-status" data-mode={backendOk ? "live" : "offline"}>
            <span className={backendOk ? "glow-pulse" : undefined} style={{
              width: 7, height: 7, borderRadius: "50%", flexShrink: 0, display: "inline-block",
              background: backendOk === null ? "var(--muted-2)" : backendOk ? "var(--positive)" : "var(--negative)",
            }} />
            <strong>{backendOk === null ? "Conectando..." : backendOk ? "Backend OK" : "Sin conexión"}</strong>
          </div>
          {rfRate !== null && (
            <div className="data-status">
              <span>{rfLabel}</span>
              <strong style={{ marginLeft: "auto", fontFamily: "var(--font-mono)" }}>{(rfRate * 100).toFixed(2)}%</strong>
            </div>
          )}
          <Button onClick={onLogout} size="sm" variant="ghost">
            <LogOut aria-hidden="true" size={15} /> Cerrar sesión
          </Button>
        </div>
      </aside>

      {/* ══ MAIN AREA ══ */}
      <div className="app-frame">

        {/* ── Top bar ── */}
        <header className="app-topbar">
          {/* Breadcrumb + tab móvil */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--muted)", flexShrink: 0 }}>
            <span style={{ fontSize: 11 }}>Dashboard</span>
            <span style={{ color: "var(--muted-2)" }}>/</span>
            <span style={{ color: "var(--ink)", fontWeight: 600, fontSize: 13 }}>
              {[
                {id:"portfolio",label:"Portfolio"},{id:"news",label:"Noticias"},
                {id:"optimize",label:"Sharpe Optimizer"},{id:"screener",label:"ML Screener"},
                {id:"analytics",label:"Analytics vs SPY"},{id:"fibras",label:"FIBRA Screener"},
                {id:"magic",label:"Fórmula Mágica"},{id:"analisis",label:"Análisis"},
              ].find(t => t.id === tab)?.label}
            </span>
          </div>
          {/* Macro strip inline */}
          {macroData && (
            <div style={{ display: "flex", gap: 0, alignItems: "center", fontFamily: "var(--font-mono)", fontSize: 10.5, overflow: "hidden", flex: 1, justifyContent: "center" }}>
              {[
                { label: "VIX",        val: macroData.vix?.value != null ? macroData.vix.value.toFixed(2) : null, chg: macroData.vix?.change },
                { label: "SPREAD 10Y", val: macroData.spread?.value != null ? `${macroData.spread.value > 0 ? "+" : ""}${macroData.spread.value}` : null, chg: null, chgOverride: macroData.spread?.inverted ? "var(--negative)" : "var(--positive)" },
                { label: "DXY",        val: macroData.dxy?.value != null ? macroData.dxy.value.toFixed(2) : null, chg: macroData.dxy?.change },
                { label: "10Y YIELD",  val: macroData.t10y?.value != null ? `${macroData.t10y.value.toFixed(2)}%` : null, chg: macroData.t10y?.change },
              ].filter(m => m.val != null).map((m, i, arr) => (
                <div key={m.label} style={{ display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
                  <span style={{ color: "var(--muted-2)", fontWeight: 500 }}>{m.label}</span>
                  <span style={{ color: "var(--ink-soft)", fontWeight: 700 }}>{m.val}</span>
                  {m.chg != null && <span style={{ color: m.chg >= 0 ? "var(--positive)" : "var(--negative)", fontWeight: 600 }}>{m.chg >= 0 ? "+" : ""}{m.chg.toFixed(2)}</span>}
                  {m.chgOverride && <span style={{ color: m.chgOverride, fontSize: 9 }}>●</span>}
                  {i < arr.length - 1 && <span style={{ color: "var(--border)", margin: "0 8px" }}>·</span>}
                </div>
              ))}
              {macroData.spread?.inverted && <span style={{ marginLeft: 8, color: "var(--negative)", fontWeight: 700, fontSize: 9 }}>⚠ CURVA INVERTIDA</span>}
            </div>
          )}
          {/* RF label — tab label mobile + theme toggle */}
          <div className="topbar-actions">
            <div className="mobile-tab-label">
              {[
                {id:"portfolio",label:"Portfolio"},{id:"news",label:"Noticias"},
                {id:"optimize",label:"Sharpe"},{id:"screener",label:"ML Screener"},
                {id:"analytics",label:"Analytics"},{id:"fibras",label:"FIBRAs"},
                {id:"magic",label:"Fórmula Mágica"},{id:"analisis",label:"Análisis"},
              ].find(t=>t.id===tab)?.label}
            </div>
            <ThemeToggle dark={dark} onToggle={toggleTheme} />
          </div>
        </header>

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
            <div className="bottom-nav-mobile">
              {TABS.map(t => (
                <button key={t.id} onClick={() => setTab(t.id)} style={{
                  background: tab===t.id ? "var(--accent)" : "transparent",
                  border:"none", cursor:"pointer", borderRadius:999,
                  padding:"8px 16px", fontSize:12,
                  fontWeight: tab===t.id ? 800 : 500,
                  color: tab===t.id ? "var(--on-accent)" : "#9aada3",
                  whiteSpace:"nowrap",
                }}>{t.label}</button>
              ))}
            </div>
          );
        })()}

        {/* Content */}
        <div className="workspace-page">

        {/* ─── TAB: PORTFOLIO ─── */}
        {tab === "portfolio" && (
          <div>
            {/* ── Selector de portafolios ── */}
            <div style={{
              background: "var(--surface)", borderRadius: 24, boxShadow: "none", border: "1.5px solid var(--border)",
              padding: "14px 20px", marginBottom: 16,
              display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap"
            }}>
              <span style={{ fontSize: 10, color: "var(--muted)", letterSpacing: "0.1em", fontWeight: 600, marginRight: 4 }}>PORTAFOLIO</span>

              {portfolios.map(p => (
                <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 0 }}>
                  {renamingId === p.id ? (
                    <input aria-label="Nuevo nombre del portafolio"
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
                        border: "1px solid var(--accent)", borderRadius: 999, padding: "4px 12px",
                        fontSize: 13, fontWeight: 600, color: "var(--ink)",
                        background: "var(--border)", outline: "none", width: 120
                      }}
                    />
                  ) : (
                    <button
                      onClick={() => setActivePortfolioId(p.id)}
                      onDoubleClick={() => { setRenamingId(p.id); setRenameValue(p.name); }}
                      title="Doble clic para renombrar"
                      style={{
                        background: activePortfolioId === p.id ? "var(--bg-deep)" : "#f2f2f2",
                        color: activePortfolioId === p.id ? "#ffffff" : "#555555",
                        border: "none",
                        borderRadius: 999, padding: "5px 14px",
                        fontSize: 13, fontWeight: activePortfolioId === p.id ? 700 : 500,
                        cursor: "pointer", transition: "all 0.15s"
                      }}
                    >{p.name}</button>
                  )}
                  <button
                    onClick={() => {
                      const id = "p" + Date.now();
                      const copy = { id, name: `Copia de ${p.name}`, positions: p.positions.map(x => ({ ...x })) };
                      const next = [...portfolios, copy];
                      setPortfolios(next); savePortfolios(next);
                      setActivePortfolioId(id);
                    }}
                    title="Duplicar portafolio"
                    style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 12, padding: "0 2px", lineHeight: 1 }}
                  >⧉</button>
                  {portfolios.length > 1 && (
                    <button
                      onClick={() => {
                        const next = portfolios.filter(x => x.id !== p.id);
                        setPortfolios(next); savePortfolios(next);
                        if (activePortfolioId === p.id) setActivePortfolioId(next[0].id);
                      }}
                      title="Eliminar portafolio"
                      aria-label={`Eliminar portafolio ${p.name}`}
                      style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 14, padding: "0 2px", lineHeight: 1 }}
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
                  background: "none", border: "1px dashed var(--border)", borderRadius: 999,
                  color: "var(--muted)", cursor: "pointer", padding: "4px 12px", fontSize: 13
                }}
              >+ Nuevo</button>

              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 10, color: "var(--muted-2)", fontStyle: "italic" }}>doble clic para renombrar</span>
              </div>
            </div>

            {/* Add stock form — Modo Experimental (eliminado) */}
            {<div style={{
                background: "var(--surface)", borderRadius: 24, boxShadow: "none", border: "1.5px solid var(--border)",
                padding: 20, marginBottom: 28, display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap"
              }}>
                <div>
                  <div style={{ fontSize: 10, color: "var(--muted)", letterSpacing: "0.08em", marginBottom: 6 }}>TICKER</div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input aria-label="Ticker a agregar" value={newTicker} onChange={(e) => setNewTicker(e.target.value.toUpperCase())}
                      placeholder="AAPL / WALMEX.MX"
                      onKeyDown={e => e.key === "Enter" && addStock()}
                      style={{
                        background: newTicker === '$MXN' ? "#2a1f00" : "var(--border)",
                        border: `1px solid ${newTicker === '$MXN' ? "var(--warning)" : "var(--border-strong)"}`,
                        borderRadius: 10,
                        color: newTicker === '$MXN' ? "#e0b768" : "var(--ink)", padding: "8px 14px", fontSize: 13, width: 160,
                        fontFamily: "var(--font-mono)", outline: "none"
                      }} />
                    <button
                      onClick={() => { setNewTicker('$MXN'); setInputMode('shares'); }}
                      title="Agregar efectivo en MXN"
                      style={{
                        background: newTicker === '$MXN' ? "var(--warning)" : "var(--warning-soft)",
                        border: "1px solid var(--warning)", borderRadius: 8,
                        color: newTicker === '$MXN' ? "#fff" : "var(--warning)",
                        fontSize: 11, fontWeight: 700, padding: "6px 10px",
                        cursor: "pointer", whiteSpace: "nowrap", letterSpacing: "0.02em"
                      }}
                    >💵 Efectivo</button>
                  </div>
                </div>
                {/* Toggle modo + input acciones / % */}
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    <div style={{ fontSize: 10, color: "var(--muted)", letterSpacing: "0.08em", fontWeight: 600 }}>
                      {newTicker === '$MXN' ? "MONTO EN MXN" : inputMode === "shares" ? "ACCIONES" : "% DEL PORTAFOLIO"}
                    </div>
                    <div style={{ display: "flex", background: "var(--border)", borderRadius: 999, padding: 2, gap: 0 }}>
                      {[["shares","#"], ["pct","%"]].map(([m, lbl]) => (
                        <button key={m} onClick={() => setInputMode(m)} style={{
                          background: inputMode === m ? "var(--bg-deep)" : "transparent",
                          color: inputMode === m ? "#ffffff" : "var(--muted)",
                          border: "none", borderRadius: 999, padding: "2px 9px",
                          fontSize: 11, fontWeight: 700, cursor: "pointer", transition: "all 0.15s"
                        }}>{lbl}</button>
                      ))}
                    </div>
                  </div>
                  {inputMode === "shares" ? (
                    <input aria-label="Número de acciones" value={newShares} onChange={(e) => setNewShares(e.target.value)}
                      placeholder="0 (decimal OK)" type="number" step="any"
                      onKeyDown={e => e.key === "Enter" && addStock()}
                      style={{ background: "var(--surface-2)", border: "1px solid var(--border-strong)", borderRadius: 10, color: "var(--ink)", padding: "8px 14px", fontSize: 13, width: 130, outline: "none" }} />
                  ) : (
                    <div style={{ position: "relative" }}>
                      <input aria-label="Porcentaje del portafolio" value={newPct} onChange={(e) => setNewPct(e.target.value)}
                        placeholder="20.5" type="number" step="any" min="0.01" max="100"
                        onKeyDown={e => e.key === "Enter" && addStock()}
                        style={{ background: "var(--accent-soft)", border: "1px solid var(--accent)", borderRadius: 10, color: "var(--accent)", padding: "8px 32px 8px 14px", fontSize: 13, width: 130, outline: "none" }} />
                      <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: "var(--positive)", fontWeight: 700, fontSize: 14 }}>%</span>
                      {(() => {
                        const pct = parseFloat(newPct);
                        const ticker = newTicker.toUpperCase().trim();
                        const price = stockData[ticker]?.price;
                        const totalValue = portfolio.reduce((s, p) => s + posVal(p), 0);
                        const basis = expTotal > 0 ? expTotal : totalValue;
                        if (pct > 0 && price && basis > 0) {
                          const sharesCalc = (pct / 100 * basis) / toMXN(ticker, price);
                          return <div style={{ fontSize: 10, color: "var(--positive)", marginTop: 4 }}>≈ {sharesCalc.toFixed(4)} acciones</div>;
                        }
                        if (basis <= 0) return <div style={{ fontSize: 10, color: "var(--warning)", marginTop: 4 }}>Define un presupuesto o agrega una posición con precio</div>;
                        return <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 4 }}>Carga el ticker primero</div>;
                      })()}
                    </div>
                  )}
                </div>
                {inputMode === "pct" && (
                  <div>
                    <div style={{ fontSize: 10, color: "var(--muted)", letterSpacing: "0.08em", marginBottom: 6 }}>PRESUPUESTO (OPCIONAL)</div>
                    <div style={{ position: "relative" }}>
                      <span style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: "var(--muted)", fontWeight: 700, pointerEvents: "none" }}>$</span>
                      <input aria-label="Presupuesto total en MXN"
                        value={expTotal > 0 ? expTotal : ""}
                        onChange={(e) => setExpTotalVal(e.target.value)}
                        placeholder="200000"
                        type="number"
                        style={{ background: "var(--surface-2)", border: "1px solid var(--border-strong)", borderRadius: 10, color: "var(--ink)", padding: "8px 14px 8px 22px", fontSize: 13, width: 130, outline: "none", boxSizing: "border-box" }}
                      />
                    </div>
                    <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 4 }}>Úsalo para armar el % desde cero (MXN)</div>
                  </div>
                )}
                <div>
                  <div style={{ fontSize: 10, color: "var(--muted)", letterSpacing: "0.08em", marginBottom: 6 }}>COSTO PROMEDIO</div>
                  <input aria-label="Costo promedio por acción" value={newCost} onChange={(e) => setNewCost(e.target.value)}
                    placeholder="0.00" type="number"
                    style={{ background: "var(--surface-2)", border: "1px solid var(--border-strong)", borderRadius: 10, color: "var(--ink)", padding: "8px 14px", fontSize: 13, width: 120, outline: "none" }} />
                </div>
                <button onClick={addStock} style={{
                  background: "var(--bg-deep)", border: "none",
                  borderRadius: 999, color: "#fff", padding: "9px 24px", cursor: "pointer",
                  fontSize: 13, fontWeight: 600, letterSpacing: "0.04em"
                }}>+ Agregar</button>
                <button onClick={async () => {
                  for (const p of portfolio) { await loadStockData(p.ticker); await sleep(400); }
                }} style={{
                  background: "var(--border)", border: "none", borderRadius: 999,
                  color: "var(--muted)", padding: "9px 20px", cursor: "pointer", fontSize: 13
                }}>↻ Actualizar</button>
                {addError && (
                  <div style={{ marginTop: 8, fontSize: 12, color: "var(--negative)", display: "flex", alignItems: "center", gap: 6, width: "100%" }}>
                    ⚠ {addError}
                  </div>
                )}
              </div>}

            {/* Portfolio Summary + Pie Chart — arriba */}
            {Object.keys(stockData).length > 0 && (() => {
              let totalValue = 0, totalCost = 0;
              const slices = [];
              const COLORS = ["#1e4d6b","#2d6a8a","#1a5c4a","#2d4a7a","#4a2d6a","#1a3d5c","#2d5a3d","#3d2d5a","#1e3d6b","#2d5a6a","#1a4d3d","#3d4a2d"];
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
              const accentColor = isExperimental ? "#8b5cf6" : "var(--accent)";
              slices.forEach((s, i) => { s.color = i === 0 ? accentColor : COLORS[(i - 1) % COLORS.length]; });
              const totalPnl = totalValue - totalCost;
              const totalPnlPct = totalCost ? (totalPnl / totalCost) * 100 : 0;


              const approxSharpe = portfolioSharpeExact;

              const StatRow = ({ label, value, color, sub }) => (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: "1px solid #f2f2f2" }}>
                  <div>
                    <div style={{ fontSize: 11, color: "var(--muted)", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 500 }}>{label}</div>
                    {sub && <div style={{ fontSize: 10, color: "var(--muted-2)", marginTop: 2 }}>{sub}</div>}
                  </div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 18, fontWeight: 700, color: color || "var(--bg-deep)" }}>{value ?? "—"}</div>
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
                    const tSum    = paths.reduce((s, p) => s + (parseFloat(targetPcts[p.ticker] ?? (p.pct * 100).toFixed(1)) || 0), 0);
                    const tSumOk  = Math.abs(tSum - 100) < 0.5;
                    const effTotal = parseFloat(customTotal) > 0 ? parseFloat(customTotal) : totalValue;
                    const fmt = (n) => n >= 1000 ? n.toFixed(1) : n >= 10 ? n.toFixed(2) : n >= 1 ? n.toFixed(3) : n.toFixed(4);
                    return (
                  <div className="resp-grid-2" style={{ alignItems: "start" }}>

                    {/* ── Donut — siempre usa pesos reales ── */}
                    <div style={{ background: "var(--surface)", borderRadius: 24, boxShadow: "none", border: "1.5px solid var(--border)", padding: "24px 20px 20px" }}>
                      <div style={{ fontSize: 10, color: "var(--muted)", letterSpacing: "0.14em", fontWeight: 600, marginBottom: 16 }}>COMPOSICIÓN DEL PORTAFOLIO</div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", position: "relative" }}>
                        {/* Tooltip hover */}
                        {hoveredTicker && (() => {
                          const hp = paths.find(x => x.ticker === hoveredTicker);
                          const pos = portfolio.find(x => x.ticker === hoveredTicker);
                          const val = pos ? posVal(pos) : null;
                          if (!hp) return null;
                          return (
                            <div style={{
                              position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)",
                              background: "var(--bg-deep)", color: "#ffffff", borderRadius: 8, padding: "6px 14px",
                              fontSize: 11, fontFamily: "var(--font-mono)", pointerEvents: "none",
                              zIndex: 10, whiteSpace: "nowrap", boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
                              letterSpacing: "0.04em"
                            }}>
                              <span style={{ color: hp.color === accentColor ? accentColor : "var(--muted)" }}>●</span>{" "}
                              <b>{hoveredTicker}</b>{" · "}{(hp.pct * 100).toFixed(1)}%
                              {val != null && <span style={{ color: "var(--muted)" }}>{" · "}${val.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>}
                            </div>
                          );
                        })()}
                        <svg width="100%" viewBox="0 0 260 260" style={{ display: "block", maxWidth: 360 }}>
                          {paths.map((p, i) => (
                            <path
                              key={i}
                              d={p.path}
                              fill={p.color}
                              stroke="var(--surface)"
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
                          <circle cx={CX} cy={CY} r={R * 0.48} fill="var(--surface)" style={{ pointerEvents: "none" }} />
                          {hoveredTicker ? (() => {
                            const hp = paths.find(x => x.ticker === hoveredTicker);
                            return hp ? <>
                              <text x={CX} y={CY - 10} textAnchor="middle" fill={hp.color === accentColor ? accentColor : "var(--muted)"} fontSize="13" fontFamily="monospace" fontWeight="bold">{hoveredTicker}</text>
                              <text x={CX} y={CY + 12} textAnchor="middle" fill="var(--ink)" fontSize="22" fontWeight="bold" fontFamily="monospace">{(hp.pct * 100).toFixed(1)}%</text>
                            </> : null;
                          })() : <>
                            <text x={CX} y={CY - 10} textAnchor="middle" fill="var(--muted-2)" fontSize="10" fontFamily="monospace" letterSpacing="1">{isExperimental ? "PRESUPUESTO" : "TOTAL"}</text>
                            <text x={CX} y={CY + 12} textAnchor="middle" fill={isExperimental ? "#a78bfa" : "var(--accent)"} fontSize="20" fontWeight="bold" fontFamily="monospace">${((isExperimental && expTotal > 0 ? expTotal : totalValue) / 1000).toFixed(1)}k</text>
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
                                background: hoveredTicker === p.ticker ? (p.color === accentColor ? (isExperimental ? "#2d1f5e" : "var(--positive-soft)") : "var(--border)") : "transparent",
                                opacity: hoveredTicker && hoveredTicker !== p.ticker ? 0.35 : 1,
                                transition: "all 0.15s"
                              }}
                              onMouseEnter={() => setHoveredTicker(p.ticker)}
                              onMouseLeave={() => setHoveredTicker(null)}
                            >
                              <div style={{ width: 10, height: 10, borderRadius: 3, background: p.color, flexShrink: 0 }} />
                              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: p.color === accentColor ? accentColor : "var(--muted)", fontWeight: p.color === accentColor ? 700 : 500, flex: 1 }}>{p.ticker}</span>
                              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--muted-2)", fontWeight: 600 }}>{(p.pct * 100).toFixed(1)}%</span>
                            </div>
                          ))}
                        </div>

                      {/* Sharpe Individual dentro del panel izquierdo */}
                      {Object.keys(sharpeData).length > 0 && (
                        <div style={{ marginTop: 20, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                            <div style={{ fontSize: 10, color: "var(--muted)", letterSpacing: "0.12em", fontWeight: 600 }}>SHARPE INDIVIDUAL · 1A</div>
                            <div style={{ fontSize: 9, color: "var(--muted-2)" }}>≥1.0 exc · 0.5–1.0 bueno</div>
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                            {portfolio
                              .filter(p => sharpeData[p.ticker] !== undefined)
                              .sort((a, b) => (sharpeData[b.ticker] ?? -99) - (sharpeData[a.ticker] ?? -99))
                              .map(p => {
                                const s = sharpeData[p.ticker];
                                const color = s >= 1 ? "var(--positive)" : s >= 0.5 ? "var(--warning)" : s >= 0 ? "var(--accent)" : "var(--negative)";
                                const barW = Math.min(Math.max((s / 2) * 100, 0), 100);
                                const sd = stockData[p.ticker];
                                return (
                                  <div key={p.ticker}>
                                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, fontWeight: 700, color: "var(--ink)" }}>{p.ticker}</span>
                                        <span style={{ fontSize: 10, color: "var(--muted-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>{sd?.name ?? ""}</span>
                                      </div>
                                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, color }}>{s >= 0 ? "+" : ""}{s}</span>
                                    </div>
                                    <div style={{ background: "var(--border)", borderRadius: 99, height: 6, overflow: "hidden" }}>
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
                    <div style={{ background: "var(--surface)", borderRadius: 24, boxShadow: "none", border: "1.5px solid var(--border)", padding: "28px 24px 24px", minWidth: 0 }}>
                      {/* Header */}
                      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 10, color: "var(--muted)", letterSpacing: "0.14em", fontWeight: 600 }}>REBALANCEO</span>
                        <span style={{ fontSize: 10, color: "var(--muted-2)", background: "var(--border)", borderRadius: 999, padding: "2px 8px" }}>
                          USD/MXN {usdMxn.toFixed(2)}
                        </span>
                        <div style={{ flex: 1 }} />
                        {/* Monto total */}
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 10, color: "var(--muted-2)", whiteSpace: "nowrap" }}>MONTO TOTAL</span>
                          <div style={{ position: "relative" }}>
                            <span style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: "#888", pointerEvents: "none" }}>$</span>
                            <input aria-label="Monto total a rebalancear en MXN" value={customTotal} onChange={e => setCustomTotal(e.target.value)}
                              placeholder={totalValue.toFixed(0)} type="number" step="1000" min="0"
                              style={{
                                width: 120, padding: "6px 8px 6px 20px",
                                fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700,
                                color: parseFloat(customTotal) > 0 ? "var(--accent)" : "var(--muted)",
                                background: parseFloat(customTotal) > 0 ? "var(--accent-soft)" : "var(--border)",
                                border: `1.5px solid ${parseFloat(customTotal) > 0 ? "var(--accent)" : "var(--border-strong)"}`,
                                borderRadius: 8, outline: "none", boxSizing: "border-box"
                              }} />
                          </div>
                          {parseFloat(customTotal) > 0 && (
                            <button aria-label="Borrar monto personalizado" onClick={() => setCustomTotal("")} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 16, padding: 0 }}>×</button>
                          )}
                        </div>
                        {/* Σ badge */}
                        <div style={{
                          fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700,
                          color: tSumOk ? "var(--positive)" : "var(--negative)",
                          background: tSumOk ? "var(--positive-soft)" : "var(--negative-soft)",
                          padding: "4px 10px", borderRadius: 999, whiteSpace: "nowrap"
                        }}>Σ {tSum.toFixed(1)}% {tSumOk ? "✓" : "✗"}</div>
                      </div>

                      {/* Métricas resumen */}
                      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
                        {[
                          { label: isExperimental ? "Presupuesto exp." : "Valor total · MXN",
                            value: `$${(isExperimental && expTotal > 0 ? expTotal : totalValue).toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
                            color: isExperimental ? "#a78bfa" : "var(--accent)",
                            sub: isExperimental && expTotal > 0 ? `≈ USD $${(expTotal / usdMxn).toLocaleString("en-US", { maximumFractionDigits: 0 })}` : `≈ USD $${(totalValue / usdMxn).toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
                            trend: totalPnl >= 0 ? "▲" : "▼", trendColor: totalPnl >= 0 ? "var(--positive)" : "var(--negative)" },
                          { label: "Costo total · MXN",  value: `$${totalCost.toLocaleString("en-US",  { maximumFractionDigits: 0 })}`, color: "var(--ink)", sub: `≈ USD $${(totalCost / usdMxn).toLocaleString("en-US", { maximumFractionDigits: 0 })}` },
                          { label: "P&L ($)",      value: `${totalPnl >= 0 ? "+" : "−"}$${Math.abs(totalPnl).toLocaleString("en-US", { maximumFractionDigits: 0 })}`, color: totalPnl >= 0 ? "var(--positive)" : "var(--negative)", sub: `≈ USD ${totalPnl >= 0 ? "+" : "−"}$${Math.abs(totalPnl / usdMxn).toLocaleString("en-US", { maximumFractionDigits: 0 })}` },
                          { label: "P&L (%)",      value: `${totalPnlPct >= 0 ? "+" : ""}${totalPnlPct.toFixed(2)}%`, color: totalPnl >= 0 ? "var(--positive)" : "var(--negative)",
                            sub: totalPnl >= 0 ? "Rentabilidad positiva" : "Por debajo del costo" },
                          { label: "Sharpe · 1y",  value: approxSharpe != null ? approxSharpe : "—",
                            color: approxSharpe == null ? "var(--muted-2)" : approxSharpe >= 1 ? "var(--positive)" : approxSharpe >= 0.5 ? "var(--warning)" : "var(--negative)",
                            sub: approxSharpe == null ? "calculando…" : approxSharpe >= 1 ? "Excelente" : approxSharpe >= 0.5 ? "Aceptable" : "Bajo" },
                        ].map((m) => (
                          <div key={m.label} style={{
                            flex: 1, padding: "18px 20px",
                            background: "linear-gradient(145deg,var(--surface),var(--surface-2))", borderRadius: 16,
                            minWidth: 130, border: "1px solid var(--border)",
                            position: "relative", overflow: "hidden",
                          }}>
                            <div style={{ position: "absolute", top: 0, right: 0, width: 50, height: 50, borderRadius: "0 16px 0 50px", background: `color-mix(in srgb, ${m.color} 4%, transparent)` }} />
                            <div style={{ fontSize: 9, color: "var(--muted-2)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8, fontWeight: 600 }}>{m.label}</div>
                            <div style={{ fontFamily: "var(--font-mono)", fontSize: 22, fontWeight: 700, color: m.color, lineHeight: 1, marginBottom: 6 }}>{m.value}</div>
                            {m.sub && <div style={{ fontSize: 10, color: "var(--muted-2)", display: "flex", alignItems: "center", gap: 4 }}>
                              {m.trend && <span style={{ color: m.trendColor, fontSize: 9 }}>{m.trend}</span>}{m.sub}
                            </div>}
                          </div>
                        ))}
                      </div>

                      {/* Encabezados tabla */}
                      <div className="rebal-table-wrap">
                      <div style={{
                        display: "grid",
                        gridTemplateColumns: "10px minmax(130px,1fr) 130px 95px 80px",
                        gap: "0 16px", alignItems: "center",
                        padding: "12px 20px",
                        borderBottom: "1px solid var(--border)", marginBottom: 4
                      }}>
                        <div />
                        <div style={{ fontSize: 9, color: "var(--muted)", letterSpacing: "0.15em", textTransform: "uppercase", fontFamily: "var(--font-sans)", fontWeight: 700 }}>Activo</div>
                        <div style={{ fontSize: 9, color: "var(--muted)", letterSpacing: "0.15em", textTransform: "uppercase", textAlign: "center", fontFamily: "var(--font-sans)", fontWeight: 700 }}>% objetivo</div>
                        <div style={{ fontSize: 9, color: "var(--muted)", letterSpacing: "0.15em", textTransform: "uppercase", textAlign: "right", fontFamily: "var(--font-sans)", fontWeight: 700 }}>Acciones</div>
                        <div style={{ fontSize: 9, color: "var(--muted)", letterSpacing: "0.15em", textTransform: "uppercase", textAlign: "right", fontFamily: "var(--font-sans)", fontWeight: 700 }}>Δ acciones</div>
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
                          const topBg = isExperimental ? "#1a1430" : "var(--accent-soft)";
                          return (
                            <div
                              key={p.ticker}
                              onMouseEnter={() => setHoveredTicker(p.ticker)}
                              onMouseLeave={() => setHoveredTicker(null)}
                              style={{
                                padding: "14px 20px",
                                background: isTop ? topBg : (isHovered ? "var(--surface-2)" : pi % 2 === 0 ? "var(--surface)" : "var(--surface-3)"),
                                borderBottom: "1px solid var(--border)",
                                transition: "background 0.15s",
                                opacity: hoveredTicker && !isHovered ? 0.55 : 1,
                              }}
                            >
                              <div style={{
                                display: "grid",
                                gridTemplateColumns: "10px minmax(130px,1fr) 130px 95px 80px",
                                gap: "0 16px", alignItems: "center",
                              }}>
                                <div style={{ width: 10, height: 10, borderRadius: 2, background: p.color, flexShrink: 0 }} />
                                <div style={{ display: "flex", alignItems: "center", gap: 5, overflow: "hidden" }}>
                                  <span style={{
                                    fontFamily: "var(--font-sans)",
                                    color: "var(--ink)",  // la fila top ahora va sobre --accent-soft (claro en tema claro)
                                    fontSize: 13, fontWeight: 700,
                                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
                                  }}>{p.ticker}</span>
                                  {(() => {
                                    if (p.ticker === '$MXN') return <span style={{ fontSize: 9, color: 'var(--warning)', background: 'var(--warning-soft)', borderRadius: 999, padding: '1px 5px', fontWeight: 700, flexShrink: 0 }}>EFECTIVO</span>;
                                    const cur = p.ticker.endsWith('.MX') ? 'MXN' : 'USD';
                                    return <span style={{ fontSize: 9, color: cur === 'USD' ? 'var(--info)' : 'var(--positive)', background: cur === 'USD' ? 'var(--info-soft)' : 'var(--positive-soft)', borderRadius: 999, padding: '1px 5px', fontWeight: 700, flexShrink: 0 }}>{cur}</span>;
                                  })()}
                                </div>

                                {/* Input % + slider */}
                                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                                  <div style={{ position: "relative" }}>
                                    <input aria-label={`Porcentaje objetivo de ${p.ticker}`}
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
                                        fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700,
                                        color: isTop ? "var(--accent-strong)" : "var(--ink)",
                                        background: isTop ? (isExperimental ? "#1a1040" : "var(--accent-soft)") : "var(--surface-2)",
                                        border: `1.5px solid ${isTop ? accentColor : isHovered ? "var(--border-strong)" : "var(--border)"}`,
                                        borderRadius: 8, outline: "none", textAlign: "right",
                                        boxSizing: "border-box", transition: "border-color 0.15s"
                                      }}
                                    />
                                    <span style={{ position: "absolute", right: 7, top: "50%", transform: "translateY(-50%)", fontSize: 10, color: "var(--muted-2)", pointerEvents: "none" }}>%</span>
                                  </div>
                                  {/* Slider */}
                                  <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
                                    <input aria-label={`Deslizador del porcentaje objetivo de ${p.ticker}`}
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
                                        background: `linear-gradient(to right, ${isExperimental ? "#8b5cf6" : "var(--accent)"} ${tPct}%, var(--border) ${tPct}%)`,
                                        borderRadius: 999,
                                        outline: "none",
                                        border: "none",
                                        cursor: "pointer",
                                      }}
                                    />
                                    <span style={{
                                      fontFamily: "var(--font-mono)",
                                      fontSize: 12, fontWeight: 700,
                                      color: "var(--muted)", minWidth: 45,
                                      textAlign: "right",
                                    }}>{tPct.toFixed(1)}%</span>
                                  </div>
                                </div>

                                {/* Acciones objetivo */}
                                <div style={{ textAlign: "right" }}>
                                  {tShares !== null ? (
                                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted)" }}>
                                      {p.ticker === '$MXN' ? `$${tShares.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : fmt(tShares)}
                                    </span>
                                  ) : <span style={{ color: "#ccc", fontSize: 11 }}>—</span>}
                                </div>

                                {/* Delta */}
                                <div style={{ textAlign: "right" }}>
                                  {delta !== null && Math.abs(delta) >= 0.0001 ? (
                                    <span style={{
                                      fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700,
                                      color: delta > 0 ? "var(--positive)" : "var(--negative)"
                                    }}>
                                      {p.ticker === '$MXN'
                                        ? `${delta > 0 ? "+" : "−"}$${Math.abs(delta).toLocaleString("en-US", { maximumFractionDigits: 0 })}`
                                        : `${delta > 0 ? "+" : ""}${fmt(Math.abs(delta))}`}
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
                            background: tSumOk ? "var(--accent-strong)" : "var(--border)",
                            border: `1px solid ${tSumOk ? "var(--accent-strong)" : "var(--border-strong)"}`, borderRadius: 999, color: tSumOk ? "var(--on-accent)" : "var(--muted)",
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
                            background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 999,
                            color: "var(--muted-2)", padding: "7px 16px", cursor: "pointer", fontSize: 12
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
                            background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 999,
                            color: "var(--muted-2)", padding: "7px 16px", cursor: "pointer", fontSize: 12
                          }}
                        >↺ Resetear</button>
                        {!tSumOk && (
                          <span style={{ fontSize: 10, color: "var(--negative)", marginLeft: 4 }}>
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
              {portfolio.map((pos, posIdx) => {
                const sd = stockData[pos.ticker];
                const isLoading = loading[pos.ticker];
                const price = sd?.price ?? null;
                const value = price ? pos.shares * price : null;
                const cost_total = pos.shares * pos.cost;
                const pnl = value ? value - cost_total : null;
                const pnlPct = pnl !== null ? (pnl / cost_total) * 100 : null;

                const pnlColor = pnl === null ? "var(--muted)" : pnl >= 0 ? "var(--accent)" : "var(--negative)";

                return (
                  <div key={pos.ticker} className={`fade-up kpi-hover stagger-${(posIdx % 6) + 1}`} style={{
                    background: "var(--surface)",
                    borderRadius: 24,
                    boxShadow: "none", border: "1.5px solid var(--border)",
                    overflow: "hidden",
                  }}>
                    {/* Header: ticker + precio + P&L */}
                    <div className="dark-panel" style={{
                      background: "var(--bg-deep)", padding: "20px 24px",
                      borderRadius: "24px 24px 0 0",
                      display: "flex", justifyContent: "space-between", alignItems: "flex-start",
                    }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ fontFamily: "var(--font-sans)", fontWeight: 800, fontSize: 18, color: "#ffffff" }}>
                            {pos.ticker}
                          </span>
                          {isLoading && <Spinner size={14} />}
                        </div>
                        <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 3 }}>{sd?.name ?? "—"}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        {price != null
                          ? <div style={{ fontFamily: "var(--font-mono)", fontSize: 28, fontWeight: 500, color: "#ffffff", lineHeight: 1 }}>${price.toFixed(2)}</div>
                          : <div style={{ fontSize: 13, color: "var(--muted)" }}>Cargando...</div>
                        }
                        {pnl !== null && (
                          <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: pnlColor, fontWeight: 700, marginTop: 6 }}>
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
                        { l: pos.ticker === '$MXN' ? "Monto MXN" : "Acciones", v: pos.ticker === '$MXN' ? `$${pos.shares.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : pos.shares % 1 === 0 ? pos.shares : pos.shares.toFixed(4), mono: true, color: pos.ticker === '$MXN' ? "var(--warning)" : pos.shares % 1 !== 0 ? "var(--accent)" : "var(--muted)" },
                        { l: "Costo/acc", v: pos.ticker === '$MXN' ? "—" : `$${pos.cost.toFixed(2)}`, mono: true, color: "var(--muted)" },
                        { l: "Invertido", v: `$${cost_total.toFixed(2)}`, mono: true, color: "var(--muted)" },
                        { l: "Valor actual", v: value != null ? `$${value.toFixed(2)}` : "—", mono: true, color: "var(--ink)" },
                        { l: "P&L ($)", v: pnl != null ? `${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}` : "—", mono: true, color: pnlColor },
                        { l: "P&L (%)", v: pnlPct != null ? `${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%` : "—", mono: true, color: pnlColor },
                      ].map((item) => (
                        <div key={item.l} style={{ background: "var(--surface-2)", borderRadius: 12, padding: "9px 12px" }}>
                          <div style={{ fontSize: 10, color: "var(--muted)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4, fontWeight: 500 }}>{item.l}</div>
                          <div style={{ fontSize: 14, fontFamily: item.mono ? "var(--font-mono)" : undefined, color: item.color, fontWeight: 700 }}>{item.v}</div>
                        </div>
                      ))}
                    </div>

                    {/* Métricas de valuación */}
                    {sd && (
                      <>
                        <div style={{ fontSize: 9, color: "var(--muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Valuación</div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                          <MetricBadge label="P/E" value={sd.pe} good={20} neutral={35} />
                          <MetricBadge label="PEG" value={sd.peg} good={1} neutral={2} />
                          <MetricBadge label="PEGY" value={sd.pegy} good={1} neutral={2} />
                          <MetricBadge label="EV/EBITDA" value={sd.evEbitda} good={12} neutral={20} />
                          <MetricBadge label="P/B" value={sd.pb} good={3} neutral={5} />
                        </div>
                        <div style={{ fontSize: 9, color: "var(--muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Fundamentales</div>
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
                          <div style={{ marginTop: 10, background: "var(--surface-2)", borderRadius: 10, padding: "8px 12px", borderLeft: "3px solid var(--muted)" }}>
                            <div style={{ fontSize: 9, color: "var(--muted)", letterSpacing: "0.1em", fontWeight: 600 }}>VALUACIÓN</div>
                            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>ETF / Fondo — valuación por múltiplos no aplica para este instrumento.</div>
                          </div>
                        );
                      }
                      if (d.error) return null;
                      const mc = d.margin == null ? "var(--muted)" : d.margin > 15 ? "var(--positive)" : d.margin > 0 ? "var(--warning)" : "var(--negative)";
                      const signalBg = { "INFRAVALORADO": "var(--positive-soft)", "SOBREVALORADO": "var(--negative-soft)", "PRECIO JUSTO": "var(--warning-soft)" };
                      const cur = d.priceCurrency || "USD";
                      return (
                        <div style={{ marginTop: 12, background: signalBg[d.overall] || "var(--surface-2)", borderRadius: 12, padding: "12px 14px", borderLeft: `3px solid ${mc}` }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 4 }}>
                            <div style={{ fontSize: 9, color: "var(--muted)", letterSpacing: "0.12em", fontWeight: 600 }}>
                              VALUACIÓN POR MÚLTIPLOS · {d.sector || "—"}
                            </div>
                            <div style={{ fontSize: 10, fontWeight: 700, color: mc }}>{d.overall}</div>
                          </div>

                          {/* Precio justo compuesto */}
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12, marginBottom: 12 }}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 9, color: "var(--muted)" }}>PRECIO JUSTO ({d.nMethods} métodos)</div>
                              <div style={{ fontFamily: "var(--font-mono)", fontSize: 18, fontWeight: 700, color: "var(--ink)", whiteSpace: "nowrap" }}>
                                ${d.fairPrice?.toFixed(2) ?? "—"} <span style={{ fontSize: 10, color: "var(--muted)" }}>{cur}</span>
                              </div>
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 9, color: "var(--muted)" }}>PRECIO ACTUAL</div>
                              <div style={{ fontFamily: "var(--font-mono)", fontSize: 18, fontWeight: 700, color: "var(--muted)", whiteSpace: "nowrap" }}>
                                ${d.price?.toFixed(2)} <span style={{ fontSize: 10, color: "var(--muted)" }}>{cur}</span>
                              </div>
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 9, color: "var(--muted)" }}>DESCUENTO / PRIMA</div>
                              <div style={{ fontFamily: "var(--font-mono)", fontSize: 18, fontWeight: 700, color: mc, whiteSpace: "nowrap" }}>
                                {d.margin > 0 ? "+" : ""}{d.margin}%
                              </div>
                            </div>
                          </div>

                          {/* Detalle por método */}
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {d.methods?.map((m) => {
                              const sc = m.signal === "barato" ? "var(--positive)" : m.signal === "caro" ? "var(--negative)" : "var(--warning)";
                              return (
                                <div key={m.name} style={{
                                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                                  fontSize: 11, flexWrap: "wrap", padding: "6px 0",
                                  borderTop: "1px solid color-mix(in srgb, var(--border) 60%, transparent)",
                                }}>
                                  <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                    <span style={{ fontFamily: "var(--font-mono)", color: "var(--ink-soft)", fontWeight: 700 }}>{m.name}</span>
                                    <span style={{ color: "var(--muted)" }}>actual <b style={{ color: sc }}>{m.actual ?? "—"}x</b></span>
                                    <span style={{ color: "var(--muted)" }}>vs sector <b style={{ color: "var(--ink)" }}>{m.fair}x</b></span>
                                  </span>
                                  <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                    <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--ink)", whiteSpace: "nowrap" }}>
                                      obj. ${m.target?.toFixed(2)} {cur}
                                    </span>
                                    <Badge tone={m.signal === "barato" ? "positive" : m.signal === "caro" ? "danger" : "warning"}>
                                      {m.signal}
                                    </Badge>
                                  </span>
                                </div>
                              );
                            })}
                          </div>

                          {d.sectorNote && (
                            <div style={{ fontSize: 9, color: "var(--info)", marginTop: 8 }}>
                              ★ {d.sectorNote} (clasificación Yahoo ajustada)
                            </div>
                          )}
                          {d.fxNote && (
                            <div style={{ fontSize: 9, color: "var(--positive)", marginTop: 4 }}>
                               {d.fxNote}
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    <button onClick={() => removeStock(pos.ticker)} style={{
                      marginTop: 12, background: "none", border: "1px solid var(--border)",
                      color: "var(--muted)", borderRadius: 999, padding: "4px 12px", cursor: "pointer", fontSize: 11
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
              background: "var(--surface)", borderRadius: 24, boxShadow: "none", border: "1.5px solid var(--border)",
              padding: 20, marginBottom: 28
            }}>
              {/* Selector de portafolio */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                <span style={{ fontSize: 10, color: "var(--muted)", letterSpacing: "0.1em", fontWeight: 600 }}>PORTAFOLIO A OPTIMIZAR</span>
                {portfolios.map(p => (
                  <button key={p.id} onClick={() => setActivePortfolioId(p.id)} style={{
                    background: activePortfolioId === p.id ? "#135936" : "var(--surface-2)",
                    color: activePortfolioId === p.id ? "#ffffff" : "var(--muted)",
                    border: "none", borderRadius: 999, padding: "4px 14px",
                    fontSize: 12, fontWeight: activePortfolioId === p.id ? 700 : 500, cursor: "pointer"
                  }}>{p.name} <span style={{ opacity: 0.7 }}>({p.positions.length})</span></button>
                ))}
              </div>
              <div style={{ fontSize: 14, color: "var(--muted)", marginBottom: 16, lineHeight: 1.6 }}>
                Optimización de pesos por <b style={{ color: "var(--ink)" }}>Máximo Sharpe Ratio</b> usando simulación Monte Carlo (100,000 portafolios). Restricciones: mín <b style={{ color: "var(--muted)" }}>2%</b> — máx <b style={{ color: "var(--muted)" }}>35%</b> por activo.
                Tasa libre de riesgo: <b style={{ fontFamily: "var(--font-mono)", color: "var(--muted)" }}>
                  {rfRate ? `${(rfRate * 100).toFixed(2)}% (${rfLabel})` : "cargando..."}
                </b>
              </div>

              {/* Period selector */}
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 16 }}>
                <span style={{ fontSize: 12, color: "var(--muted)", letterSpacing: "0.07em", fontWeight: 500 }}>DATOS HISTÓRICOS:</span>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {["1y", "5y", "10y"].map((p) => (
                    <button key={p} onClick={() => setOptimPeriod(p)} style={{
                      background: optimPeriod === p ? "var(--accent-strong)" : "var(--surface-2)",
                      border: `1px solid ${optimPeriod === p ? "var(--accent-strong)" : "var(--border)"}`,
                      borderRadius: 999, color: optimPeriod === p ? "var(--on-accent)" : "var(--muted-2)",
                      padding: "5px 16px", cursor: "pointer", fontSize: 13, fontWeight: 600,
                      fontFamily: "var(--font-mono)",
                    }}>
                      {p === "1y" ? "1A" : p === "5y" ? "5A" : "10A"}
                    </button>
                  ))}
                  <span style={{ fontSize: 11, color: "var(--muted)", alignSelf: "center" }}>
                    (~{optimPeriod === "1y" ? "52" : optimPeriod === "5y" ? "260" : "520"} sem.)
                  </span>
                </div>
              </div>

              <button onClick={runOptimization} disabled={optimLoading} className="btn-exec" style={{
                background: optimLoading ? "var(--muted)" : "var(--bg-deep)",
                border: "none", borderRadius: 999, color: "#ffffff",
                padding: "12px 28px", cursor: optimLoading ? "not-allowed" : "pointer",
                fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", gap: 10
              }}>
                {optimLoading && <Spinner size={16} />}
                {optimLoading ? (optimLoadingMsg || "Optimizando...") : " Ejecutar Optimización"}
              </button>
            </div>
            {optimError && <p className="form-error" role="alert">{optimError}</p>}

            {optimResult && (
              <div style={{ animation: "fadeIn 0.5s ease" }}>

                {/* ── Comparativa Actual vs Óptimo ── */}
                <div className="resp-grid-2" style={{ marginBottom: 24 }}>
                  {/* Portafolio Actual */}
                  <div style={{
                    background: "var(--surface)", boxShadow: "none", border: "1.5px solid var(--border)",
                    borderTop: "3px solid var(--muted)", borderRadius: 24, padding: 24
                  }}>
                    <div style={{ fontSize: 10, color: "var(--muted)", letterSpacing: "0.1em", marginBottom: 12 }}>PORTAFOLIO ACTUAL</div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 36, color: "var(--muted)", fontWeight: 700, marginBottom: 16 }}>
                      {optimResult.actualSharpe?.toFixed(4) ?? "—"}
                    </div>
                    <div style={{ display: "flex", gap: 16 }}>
                      <div>
                        <div style={{ fontSize: 9, color: "var(--muted)", marginBottom: 3 }}>RETORNO ANUAL</div>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: 15, color: optimResult.actualStats?.annReturn >= 0 ? "var(--positive)" : "var(--negative)", fontWeight: 700 }}>
                          {optimResult.actualStats?.annReturn >= 0 ? "+" : ""}{optimResult.actualStats?.annReturn}%
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: 9, color: "var(--muted)", marginBottom: 3 }}>VOLATILIDAD ANUAL</div>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: 15, color: "var(--ink)", fontWeight: 700 }}>
                          {optimResult.actualStats?.annVol}%
                        </div>
                      </div>
                    </div>
                    <div style={{ marginTop: 12, fontSize: 10, color: "var(--muted)" }}>Pesos reales por valor de mercado · {optimPeriod}</div>
                  </div>

                  {/* Portafolio Óptimo */}
                  <div style={{
                    background: "var(--surface-2)",
                    boxShadow: "none", border: "1.5px solid var(--border)",
                    borderTop: "3px solid var(--accent)", borderRadius: 24, padding: 24
                  }}>
                    <div style={{ fontSize: 10, color: "var(--positive)", letterSpacing: "0.1em", marginBottom: 12 }}>PORTAFOLIO ÓPTIMO (MONTE CARLO)</div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 36, color: "var(--positive)", fontWeight: 700, marginBottom: 16 }}>
                      {optimResult.optimalSharpe?.toFixed(4) ?? optimResult.sharpe.toFixed(4)}
                    </div>
                    <div style={{ display: "flex", gap: 16 }}>
                      <div>
                        <div style={{ fontSize: 9, color: "var(--muted)", marginBottom: 3 }}>RETORNO ANUAL</div>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: 15, color: "var(--positive)", fontWeight: 700 }}>
                          {optimResult.optimalStats?.annReturn >= 0 ? "+" : ""}{optimResult.optimalStats?.annReturn}%
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: 9, color: "var(--muted)", marginBottom: 3 }}>VOLATILIDAD ANUAL</div>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: 15, color: "var(--ink)", fontWeight: 700 }}>
                          {optimResult.optimalStats?.annVol}%
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: 9, color: "var(--muted)", marginBottom: 3 }}>MEJORA SHARPE</div>
                        {(() => {
                          const delta = (optimResult.optimalSharpe ?? optimResult.sharpe) - (optimResult.actualSharpe ?? 0);
                          return (
                            <div style={{ fontFamily: "var(--font-mono)", fontSize: 15, color: delta >= 0 ? "var(--positive)" : "var(--negative)", fontWeight: 700 }}>
                              {delta >= 0 ? "+" : ""}{delta.toFixed(4)}
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                    {optimResult.actualWeights?.some(w => w > optimResult.wMax + 1e-6 || w < W_MIN - 1e-6) && (
                      <p style={{ marginTop: 12, fontSize: 11, color: "var(--muted)" }}>
                        Tu portafolio actual tiene posiciones fuera del rango 2%–{Math.round(optimResult.wMax * 100)}% que usa el optimizador, así que puede tener un Sharpe mayor que el óptimo restringido.
                      </p>
                    )}
                    <div style={{ marginTop: 12, fontSize: 10, color: "var(--muted)" }}>100,000 simulaciones · mín 2% · máx {Math.round((optimResult.wMax ?? W_MAX_DEFAULT) * 100)}% · {optimPeriod} · rf {rfLabel} {rfRate ? `${(rfRate*100).toFixed(2)}%` : ""}</div>
                  </div>
                </div>

                <div style={{ overflowX: "auto" }}>
                  <table>
                    <thead>
                      <tr>
                        <th style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 10, textTransform: "uppercase", color: "var(--muted)", padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>TICKER</th>
                        <th style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 10, textTransform: "uppercase", color: "var(--muted)", padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>PESO ÓPTIMO</th>
                        <th style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 10, textTransform: "uppercase", color: "var(--muted)", padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>PESO ACTUAL</th>
                        <th style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 10, textTransform: "uppercase", color: "var(--muted)", padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>DIFERENCIA</th>
                        <th style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 10, textTransform: "uppercase", color: "var(--muted)", padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>ACCIÓN</th>
                      </tr>
                    </thead>
                    <tbody>
                      {optimResult.tickers.map((t, i) => {
                        const optW = optimResult.weights[i];
                        // Usa actualWeights guardados al momento de la optimización
                        // (evita que cambiar de portafolio muestre pesos equivocados)
                        const currW = optimResult.actualWeights?.[i] ?? 0;
                        const diff = optW - currW;
                        const action = Math.abs(diff) < 0.02 ? "MANTENER" : diff > 0 ? "AUMENTAR" : "REDUCIR";
                        const rowBg = i % 2 === 0 ? "var(--surface)" : "var(--surface-2)";
                        return (
                          <tr key={t} style={{ background: rowBg }}>
                            <td style={{ fontFamily: "var(--font-mono)", color: "var(--ink)", fontWeight: 700 }}>{t}</td>
                            <td style={{ fontFamily: "var(--font-mono)" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <div style={{
                                  height: 8, width: `${optW * 200}px`, maxWidth: 120,
                                  background: "var(--bg-deep)", borderRadius: 4
                                }} />
                                {(optW * 100).toFixed(1)}%
                              </div>
                            </td>
                            <td style={{ fontFamily: "var(--font-mono)", color: "var(--muted)" }}>{(currW * 100).toFixed(1)}%</td>
                            <td style={{ fontFamily: "var(--font-mono)", color: diff > 0 ? "var(--positive)" : "var(--negative)" }}>
                              {diff > 0 ? "+" : ""}{(diff * 100).toFixed(1)}%
                            </td>
                            <td>
                              <span style={{
                                background: action === "AUMENTAR" ? "var(--accent-strong)" : action === "REDUCIR" ? "var(--bg-deep)" : "var(--surface-3)",
                                color: action === "AUMENTAR" ? "var(--on-accent)" : action === "REDUCIR" ? "#ffffff" : "var(--ink)",
                                borderRadius: 999, padding: "2px 12px", fontSize: 11,
                                fontFamily: "var(--font-sans)", fontWeight: 700,
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
                  <div style={{ marginTop: 28, background: "var(--surface)", borderRadius: 24, boxShadow: "none", border: "1.5px solid var(--border)", padding: 24 }}>
                    <div style={{ fontSize: 12, color: "var(--muted)", letterSpacing: "0.07em", fontWeight: 500, marginBottom: 6 }}>MATRIZ DE CORRELACIÓN</div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 18 }}>
                      Rojo = alta correlación (mueven igual) · Azul = baja/negativa (diversifican) · 1.00 = idénticos
                    </div>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ borderCollapse: "separate", borderSpacing: 3 }}>
                        <thead>
                          <tr>
                            <th style={{ padding: "4px 8px", fontSize: 10, color: "var(--muted)", textAlign: "left", minWidth: 90 }}></th>
                            {optimResult.tickers.map((t) => (
                              <th key={t} style={{ padding: "4px 8px", fontSize: 10, color: "var(--muted)", textAlign: "center", minWidth: 80, fontFamily: "var(--font-sans)", fontWeight: 700, textTransform: "uppercase" }}>{t}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {optimResult.tickers.map((rowT, i) => (
                            <tr key={rowT}>
                              <td style={{ padding: "4px 8px", fontSize: 10, color: "var(--muted)", fontFamily: "var(--font-sans)", fontWeight: 700, textTransform: "uppercase", whiteSpace: "nowrap" }}>{rowT}</td>
                              {optimResult.corrMatrix[i].map((val, j) => {
                                let bg, textColor;
                                if (i === j) {
                                  bg = "var(--bg-deep)"; textColor = "#ffffff";
                                } else if (val > 0.5) {
                                  bg = "var(--bg-deep)"; textColor = "#7fe3a0";
                                } else if (val < -0.1) {
                                  bg = "var(--negative-soft)"; textColor = "var(--negative)";
                                } else {
                                  bg = "var(--surface-2)"; textColor = "var(--ink)";
                                }
                                return (
                                  <td key={j} style={{
                                    background: bg, borderRadius: 6,
                                    padding: "8px 6px", textAlign: "center",
                                    fontFamily: "var(--font-mono)",
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
                        <div key={l.text} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--muted)" }}>
                          <div style={{ width: 14, height: 14, borderRadius: 3, background: l.color }} />
                          {l.text}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── Recomendaciones ── */}
                {optimResult.recommendations?.length > 0 && (
                  <div style={{ marginTop: 28, background: "var(--surface)", borderRadius: 24, boxShadow: "none", border: "1.5px solid var(--border)", padding: 24 }}>
                    <div style={{ fontSize: 12, color: "var(--muted)", letterSpacing: "0.07em", fontWeight: 500, marginBottom: 4 }}>RECOMENDACIONES PARA TU PORTAFOLIO</div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 18 }}>
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
                            const scoreColor = r.score >= 65 ? "var(--positive)" : r.score >= 45 ? "var(--warning)" : "var(--negative)";
                            const corrColor  = r.avgCorr < 0.3 ? "var(--positive)" : r.avgCorr < 0.6 ? "var(--warning)" : "var(--negative)";
                            const deltaColor = r.sharpeDelta > 0.05 ? "var(--positive)" : r.sharpeDelta > 0 ? "var(--warning)" : "var(--negative)";
                            const verdict    = r.score >= 65 ? "AGREGAR" : r.score >= 45 ? "CONSIDERAR" : "OMITIR";
                            const verdictColor = verdict === "AGREGAR" ? "var(--positive)" : verdict === "CONSIDERAR" ? "var(--warning)" : "var(--muted)";
                            return (
                              <tr key={r.ticker}>
                                <td style={{ color: "var(--muted)", fontSize: 12 }}>{idx + 1}</td>
                                <td style={{ fontFamily: "var(--font-mono)", color: "var(--ink)", fontWeight: 700 }}>{r.ticker}</td>
                                <td>
                                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <div style={{ background: "var(--border)", borderRadius: 4, height: 6, width: 80, overflow: "hidden" }}>
                                      <div style={{ width: `${r.score}%`, height: "100%", background: scoreColor, borderRadius: 4 }} />
                                    </div>
                                    <span style={{ fontFamily: "var(--font-mono)", color: scoreColor, fontWeight: 700, fontSize: 13 }}>{r.score}</span>
                                  </div>
                                </td>
                                <td style={{ fontFamily: "var(--font-mono)", color: corrColor, fontSize: 13 }}>{r.avgCorr.toFixed(2)}</td>
                                <td style={{ fontFamily: "var(--font-mono)", color: r.candSharpe > 0 ? "var(--positive)" : "var(--negative)", fontSize: 13 }}>{r.candSharpe.toFixed(2)}</td>
                                <td style={{ fontFamily: "var(--font-mono)", color: deltaColor, fontSize: 13 }}>
                                  {r.sharpeDelta > 0 ? "+" : ""}{r.sharpeDelta.toFixed(3)}
                                </td>
                                <td>
                                  <span style={{
                                    background: `color-mix(in srgb, ${verdictColor} 13%, transparent)`, border: `1px solid color-mix(in srgb, ${verdictColor} 27%, transparent)`,
                                    color: verdictColor, borderRadius: 6, padding: "2px 10px", fontSize: 11, fontWeight: 700
                                  }}>{verdict}</span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div style={{ marginTop: 14, fontSize: 11, color: "var(--muted)" }}>
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
              background: "var(--surface)", boxShadow: "none", border: "1.5px solid var(--border)",
              borderRadius: 24, padding: 20, marginBottom: 28
            }}>
              <div style={{ fontSize: 12, color: "var(--muted)", letterSpacing: "0.07em", fontWeight: 500, marginBottom: 8 }}>TICKERS A ANALIZAR (separados por coma, incluye .MX para México)</div>
              <textarea aria-label="Tickers para el screener, separados por coma" value={screenerTickers} onChange={(e) => setScreenerTickers(e.target.value)}
                style={{
                  width: "100%", background: "var(--surface-2)", border: "1px solid var(--border)",
                  borderRadius: 8, color: "var(--ink)", padding: "10px 14px", fontSize: 13,
                  fontFamily: "var(--font-mono)", minHeight: 60, resize: "vertical"
                }} />
              <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 12 }}>
                <button onClick={runScreener} disabled={screenerLoading} className="btn-exec" style={{
                  background: screenerLoading ? "#3a4b42" : "#135936",
                  border: "none", borderRadius: 999, color: "#ffffff",
                  padding: "12px 28px", cursor: screenerLoading ? "not-allowed" : "pointer",
                  fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", gap: 10
                }}>
                  {screenerLoading && <Spinner size={16} />}
                  {screenerLoading ? `Analizando... ${screenerProgress}%` : " Ejecutar ML Screener"}
                </button>
                {screenerLoading && (
                  <div style={{ flex: 1, background: "var(--border)", borderRadius: 4, height: 6, overflow: "hidden" }}>
                    <div style={{
                      width: `${screenerProgress}%`, height: "100%",
                      background: "var(--bg-deep)", transition: "width 0.3s ease"
                    }} />
                  </div>
                )}
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: "var(--muted)" }}>
                Motor cuantitativo de scoring: puntúa cada acción del 1 al 10 en 6 dimensiones —
                <b style={{ color: "var(--muted)" }}> Fundamental, Valuación, Momentum, Calidad, Técnico y Overall</b> —
                usando PE, PEG, PEGY, EV/EBITDA, ROE, Márgenes, Deuda/Capital, Crecimiento y variación 52 semanas (Yahoo Finance).
              </div>
            </div>

            {screenerData.length > 0 && (
              <div className="screener-cards" style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))" }}>
                {[...screenerData].sort((a, b) => (b.scores?.overall_score ?? 0) - (a.scores?.overall_score ?? 0)).map((stock) => {
                  const s = stock.scores;
                  const recColor = s?.recommendation === "BUY" ? "var(--positive)" : s?.recommendation === "SELL" ? "var(--negative)" : "var(--warning)";
                  return (
                    <div className="kpi-hover" key={stock.ticker} style={{
                      background: "var(--surface)", boxShadow: "none", border: "1.5px solid var(--border)",
                      borderRadius: 24, padding: 20, animation: "fadeIn 0.4s ease",
                      borderTop: `3px solid ${recColor}`
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                        <div>
                          <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 15, color: "var(--ink)" }}>{stock.ticker}</div>
                          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{stock.name ?? "—"}</div>
                          {stock.price && <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
                            ${stock.price.toFixed(2)}
                          </div>}
                        </div>
                        {s && (
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontFamily: "var(--font-mono)", fontSize: 28, fontWeight: 700, color: recColor }}>
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
                          background: stock.sharpe1y >= 1 ? "var(--positive-soft)" : stock.sharpe1y >= 0.5 ? "var(--warning-soft)" : "var(--negative-soft)",
                          borderRadius: 10, padding: "8px 12px", marginBottom: 12,
                          borderLeft: `3px solid ${stock.sharpe1y >= 1 ? "var(--positive)" : stock.sharpe1y >= 0.5 ? "var(--warning)" : "var(--negative)"}`
                        }}>
                          <div>
                            <div style={{ fontSize: 9, color: "var(--muted)", letterSpacing: "0.1em", fontWeight: 600 }}>SHARPE 1A · {rfLabel}</div>
                            <div style={{ fontFamily: "var(--font-mono)", fontSize: 20, fontWeight: 700,
                              color: stock.sharpe1y >= 1 ? "var(--positive)" : stock.sharpe1y >= 0.5 ? "var(--warning)" : "var(--negative)"
                            }}>{stock.sharpe1y > 0 ? "+" : ""}{stock.sharpe1y}</div>
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ background: "var(--border)", borderRadius: 4, height: 5, overflow: "hidden" }}>
                              <div style={{
                                width: `${Math.min(Math.max((stock.sharpe1y / 3) * 100, 0), 100)}%`,
                                height: "100%", borderRadius: 4,
                                background: stock.sharpe1y >= 1 ? "var(--positive)" : stock.sharpe1y >= 0.5 ? "var(--warning)" : "var(--negative)",
                                transition: "width 0.6s ease"
                              }} />
                            </div>
                            <div style={{ fontSize: 9, color: "var(--muted)", marginTop: 3 }}>
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
                            background: "var(--border)", border: "none",
                            borderRadius: 8, padding: "3px 8px", fontSize: 11,
                            fontFamily: "var(--font-mono)", color: "var(--muted)"
                          }}>{m.l}: <b style={{ color: "var(--ink)" }}>{m.v}</b></span>
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
                              marginTop: 12, background: "var(--surface-2)", borderRadius: 8,
                              padding: "8px 12px", fontSize: 11, color: "var(--muted)", lineHeight: 1.5
                            }}>
                               {s.rationale}
                            </div>
                          )}
                        </>
                      )}
                      {!s && (
                        <div style={{ color: "var(--muted)", fontSize: 12 }}>Procesando...</div>
                      )}

                      {/* Valuación por múltiplos */}
                      {stock.dcf && !stock.dcf.error && (() => {
                        const d = stock.dcf;
                        const mc = d.margin == null ? "var(--muted)" : d.margin > 15 ? "var(--positive)" : d.margin > 0 ? "var(--warning)" : "var(--negative)";
                        return (
                          <div style={{ marginTop: 10, padding: "10px 12px", background: "var(--surface-2)", borderRadius: 10, borderLeft: `3px solid ${mc}` }}>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                              <div style={{ fontSize: 9, color: "var(--muted)", letterSpacing: "0.1em", fontWeight: 600 }}>MÚLTIPLOS · {d.sector || "—"}</div>
                              <div style={{ fontSize: 10, fontWeight: 700, color: mc }}>{d.overall}</div>
                            </div>
                            <div style={{ display: "flex", gap: 10, alignItems: "baseline", marginBottom: 8 }}>
                              {d.fairPrice != null && <span style={{ fontSize: 12 }}>Justo <b style={{ fontFamily: "var(--font-mono)", color: "var(--ink)" }}>${d.fairPrice.toFixed(2)}</b></span>}
                              {d.margin != null && <span style={{ fontSize: 12 }}>Descuento <b style={{ fontFamily: "var(--font-mono)", color: mc }}>{d.margin > 0 ? "+" : ""}{d.margin}%</b></span>}
                            </div>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              {d.methods?.map((m) => {
                                const sc = m.signal === "barato" ? "var(--positive)" : m.signal === "caro" ? "var(--negative)" : "var(--warning)";
                                return (
                                  <span key={m.name} style={{ fontSize: 10, background: "var(--border)", borderRadius: 6, padding: "2px 7px", color: "var(--muted)" }}>
                                    {m.name} <b style={{ fontFamily: "var(--font-mono)", color: sc }}>{m.actual ?? "—"}x</b>
                                    <span style={{ color: "var(--muted)" }}>/{m.fair}x</span>
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
                        const scoreColor = m.score === 3 ? "var(--positive)" : m.score >= 2 ? "var(--warning)" : "var(--negative)";
                        return (
                          <div style={{ marginTop: 8, padding: "8px 10px", background: "var(--surface-2)", borderRadius: 8 }}>
                            <div style={{ fontSize: 9, color: "var(--muted)", letterSpacing: "0.1em", marginBottom: 6 }}>MOMENTUM vs {m.benchmark} ({m.sector})</div>
                            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                              {[["3M", m.alpha?.m3], ["6M", m.alpha?.m6], ["12M", m.alpha?.m12]].map(([label, alpha]) => alpha != null && (
                                <div key={label} style={{ fontSize: 11 }}>
                                  <span style={{ color: "var(--muted)" }}>{label}: </span>
                                  <b style={{ fontFamily: "var(--font-mono)", color: alpha > 0 ? "var(--positive)" : "var(--negative)" }}>
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
                        className="dark-panel"  // fondo oscuro fijo: toma los tokens oscuros, --accent claro incluido
                        onClick={() => runAnalisis(stock.ticker)}
                        style={{
                          marginTop: 14, width: "100%",
                          background: "var(--bg-deep)", color: "var(--accent)",
                          border: "none", borderRadius: 10,
                          padding: "10px 0", cursor: "pointer",
                          fontWeight: 800, fontSize: 12,
                          letterSpacing: "0.06em", transition: "all 0.15s",
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = "var(--accent-strong)"; e.currentTarget.style.color = "var(--on-accent)"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "var(--bg-deep)"; e.currentTarget.style.color = "var(--accent)"; }}
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
            { label: "Inflación INPC",  value: "4.53%",   period: "1a Q Abr 2026",   color: "var(--warning)", icon: "" },
            { label: "PIB Q1 2026",     value: "+0.2%",   period: "Trim. INEGI",     color: "var(--positive)", icon: "" },
            { label: "TIIE Fondeo 1D",  value: "6.76%",   period: "Banxico May 2026", color: "var(--info)", icon: "" },
            { label: "TIIE 28D",        value: "7.02%",   period: "Banxico May 2026", color: "var(--info)", icon: "" },
            { label: "Desempleo",       value: "2.4%",    period: "Mar 2026",        color: "var(--positive)", icon: "" },
            { label: "Deuda / PIB",     value: "50.4%",   period: "Q1 2026",         color: "var(--warning)", icon: "" },
            { label: "Reservas Intl.",  value: "$256.5B", period: "24 Abr 2026",     color: "var(--info)", icon: "" },
          ];

          const filteredNews = marketNews.filter(n => newsFilter === "all" || n.sentiment === newsFilter);
          const lastUpdStr = lastUpdated
            ? lastUpdated.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })
            : null;

          // VIX color
          const vixVal = macroData?.vix?.value;
          const vixColor = vixVal > 30 ? "var(--negative)" : vixVal > 20 ? "var(--warning)" : "var(--positive)";

          // ── Componentes de panel tipo terminal financiero ──
          const DataRow = ({ label, value, pct, sub, hero }) => {
            const isN = pct == null;
            const up  = !isN && pct >= 0;
            const cc  = up ? "var(--positive)" : "var(--negative)";
            const bg  = up ? "var(--positive-soft)" : "var(--negative-soft)";
            return (
              <div style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: hero ? "10px 14px" : "8px 12px",
                borderBottom: "1px solid var(--border)",
                background: hero ? bg : "var(--surface)",
                borderLeft: hero ? `3px solid ${cc}` : "none",
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 9, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "var(--font-sans)" }}>{label}</div>
                  {sub && <div style={{ fontSize: 9, color: "var(--muted)", marginTop: 1 }}>{sub}</div>}
                </div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: hero ? 18 : 13, fontWeight: 700, color: "var(--ink)", marginRight: isN ? 0 : 8, flexShrink: 0 }}>
                  {value ?? <span style={{ color: "#d1d5db" }}>—</span>}
                </div>
                {!isN
                  ? <span style={{
                      flexShrink: 0, fontSize: 10, fontWeight: 700,
                      color: cc, minWidth: 60, textAlign: "right",
                      fontFamily: "var(--font-mono)",
                    }}>
                      {up ? "+" : ""}{Math.abs(pct).toFixed(2)}%
                    </span>
                  : <div style={{ flexShrink: 0, minWidth: 60 }} />
                }
              </div>
            );
          };

          const Panel = ({ title, children, style = {} }) => (
            <div style={{
              background: "var(--surface)", borderRadius: 16, overflow: "hidden",
              border: "1px solid var(--border)",
              ...style
            }}>
              <div style={{
                padding: "8px 16px",
                borderBottom: "1px solid var(--border)",
                background: "var(--bg-deep)",
              }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: "#8fa3b8", textTransform: "uppercase", letterSpacing: "0.2em", fontFamily: "var(--font-sans)" }}>{title}</span>
              </div>
              {children}
            </div>
          );

          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

              {/* ── HERO ── */}
              <div style={{ background: "linear-gradient(135deg, #0a1628 0%, var(--bg-deep) 100%)", borderRadius: 20, padding: "32px 28px", display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 16, border: "1px solid var(--border)" }}>
                <div>
                  <div className="hero-title stat-shimmer-dark" style={{ fontSize: 48, fontWeight: 800, color: "#79df9b", letterSpacing: "-0.04em", fontFamily: "var(--font-sans)", lineHeight: 1.05 }}>
                    Panorama de<br />Mercados
                  </div>
                  <div style={{ fontSize: 13, color: "#8fa3b8", marginTop: 12 }}>
                    Indicadores globales · México · Noticias
                    {lastUpdStr && <span style={{ marginLeft: 10 }}>· Act. {lastUpdStr}</span>}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button onClick={() => loadMarketData()} disabled={marketDataLoading} style={{
                    background: "#135936", border: "none", borderRadius: 8, color: "#ffffff",
                    padding: "8px 16px", cursor: marketDataLoading ? "not-allowed" : "pointer",
                    fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 6,
                    transition: "all 0.15s", opacity: marketDataLoading ? 0.5 : 1,
                  }}>
                    {marketDataLoading ? <Spinner size={11} /> : "↻"} Mercados
                  </button>
                  <button onClick={loadMarketNews} disabled={marketNewsLoading} style={{
                    background: "transparent", border: "1px solid rgba(255,255,255,.2)", borderRadius: 8, color: "#8fa3b8",
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
                    { key: "sp500",  label: "S&P 500",  dec: 2,              bg: "#11251c", fg: "#ffffff" },
                    { key: "nasdaq", label: "NASDAQ",    dec: 2,              bg: "#79df9b", fg: "#11251c" },
                    { key: "dow",    label: "DJIA",      dec: 2,              bg: "#eceee8", fg: "#11251c" },
                    { key: "ipc",    label: "IPC MX",    dec: 2,              bg: "#11251c", fg: "#ffffff" },
                    { key: "usdmxn",label: "USD · MXN", dec: 4,              bg: "#79df9b", fg: "#11251c" },
                    { key: "gold",   label: "Oro",       dec: 2, unit: "/oz", bg: "#11251c", fg: "#ffffff" },
                    { key: "wti",    label: "WTI Crude", dec: 2, unit: "/bbl",bg: "#79df9b", fg: "#11251c" },
                    { key: "btc",    label: "Bitcoin",   dec: 0,              bg: "#11251c", fg: "#ffffff" },
                  ].map(({ key, label, dec, unit, bg, fg }) => {
                    const d = md[key];
                    const up = d?.change_pct >= 0;
                    const isDark = fg === "#ffffff";
                    const badgeBg = isDark ? (up ? "#79df9b" : "var(--negative)") : (up ? "#11251c" : "var(--negative)");
                    // En baja el fondo es var(--negative), que cambia con el tema: --on-accent contrasta en ambos
                    const badgeFg = !up ? "var(--on-accent)" : isDark ? "#11251c" : "#ffffff";
                    return (
                      <div key={key} style={{
                        background: bg, borderRadius: 16, padding: 16,
                        display: "flex", flexDirection: "column", gap: 8,
                      }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: `color-mix(in srgb, ${fg} 80%, ${bg})`, textTransform: "uppercase", letterSpacing: "0.1em" }}>{label}</div>
                        <div className="bento-val" style={{ fontFamily: "var(--font-mono)", fontSize: 32, fontWeight: 500, color: fg, lineHeight: 1, letterSpacing: "-0.02em" }}>
                          {d ? fv(d.value, dec) + (unit ? " " + unit : "") : "—"}
                        </div>
                        {d?.change_pct != null && (
                          <span style={{
                            display: "inline-flex", alignSelf: "flex-start",
                            background: badgeBg, color: badgeFg,
                            fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 6,
                            fontFamily: "var(--font-mono)",
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
              <div style={{ border: "1.5px solid var(--border)", borderRadius: 16, overflow: "hidden" }}>
                <div style={{ padding: "8px 16px", borderBottom: "1px solid var(--border)", background: "var(--surface-2)" }}>
                  <span style={{ fontSize: 9, fontWeight: 700, color: "var(--muted-2)", textTransform: "uppercase", letterSpacing: "0.2em", fontFamily: "var(--font-sans)" }}>Indicadores Principales</span>
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
                    const cc  = up ? "var(--positive)" : "var(--negative)";
                    const col = idx % 4;
                    const row = Math.floor(idx / 4);
                    return (
                      <div key={key} style={{
                        padding: "12px 16px",
                        borderRight: col < 3 ? "1px solid var(--border)" : "none",
                        borderBottom: row < 1 ? "1px solid var(--border)" : "none",
                        background: "var(--surface)",
                      }}>
                        <div style={{ fontSize: 9, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "var(--font-sans)", marginBottom: 4 }}>{label}</div>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: 18, fontWeight: 700, color: "var(--ink)", lineHeight: 1 }}>
                            {d.value != null ? fv(d.value, dec) + (unit ?? "") : <span style={{ color: "#d1d5db" }}>—</span>}
                          </span>
                          {!isN && (
                            <span style={{ fontSize: 10, fontWeight: 700, color: cc, fontFamily: "var(--font-mono)" }}>
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
                  const pct = Math.round((0.14 + intensity * 0.5) * 100);
                  const bg = p == null ? "var(--surface-2)"
                    : `color-mix(in srgb, ${p >= 0 ? "var(--positive)" : "var(--negative)"} ${pct}%, transparent)`;
                  const fg = p == null ? "var(--muted)" : "var(--ink)";
                  return { p, bg, fg };
                };
                return (
                  <div className="stylebox-wrap" style={{ display: "grid", gridTemplateColumns: "minmax(340px, 2fr) 3fr", gap: 16, alignItems: "stretch" }}>

                    {/* ── Style Box ── */}
                    <div style={{
                      background: "var(--surface)", border: "1.5px solid var(--border)", borderRadius: 20,
                      padding: "24px 28px", width: "100%", boxSizing: "border-box"
                    }}>
                      <div style={{ fontFamily: "var(--font-sans)", fontSize: 14, fontWeight: 800, color: "var(--ink)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 20 }}>
                        US Market Style Box
                      </div>
                      {/* Headers */}
                      <div style={{ display: "grid", gridTemplateColumns: "64px repeat(3,1fr)", gap: 8, marginBottom: 8 }}>
                        <div />
                        {COLS.map(c => (
                          <div key={c} style={{ textAlign: "center", fontFamily: "var(--font-sans)", fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{c}</div>
                        ))}
                      </div>
                      {/* Rows */}
                      {BOX.map(({ label, keys }) => (
                        <div key={label} style={{ display: "grid", gridTemplateColumns: "64px repeat(3,1fr)", gap: 8, marginBottom: 8 }}>
                          <div style={{ display: "flex", alignItems: "center", fontFamily: "var(--font-sans)", fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>{label}</div>
                          {keys.map((k) => {
                            const { p, bg: _bg, fg: _fg } = toCell(k);
                            const isUp = p != null && p >= 0;
                            const isDown = p != null && p < 0;
                            const cellBg = isUp ? "var(--positive-soft)" : isDown ? "var(--negative-soft)" : "var(--border)";
                            const cellFg = isUp ? "var(--positive)" : isDown ? "var(--negative)" : "var(--muted)";
                            return (
                              <div key={k} style={{ background: cellBg, borderRadius: 10, padding: "18px 10px", textAlign: "center" }}>
                                <div style={{ fontFamily: "var(--font-mono)", fontSize: 16, fontWeight: 700, color: cellFg }}>
                                  {p != null ? `${p >= 0 ? "+" : ""}${p.toFixed(2)}%` : "—"}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ))}
                      <div style={{ fontSize: 8.5, color: "var(--muted)", marginTop: 4, letterSpacing: "0.04em" }}>Retorno diario · iShares ETFs</div>

                      {/* Fear & Greed prominente */}
                      {vixVal && (() => {
                        const score = Math.max(0, Math.min(100, Math.round(100 - ((vixVal - 10) / 30) * 100)));
                        const zone = score >= 75 ? { label: "Codicia Extrema", color: "var(--positive)" }
                          : score >= 55 ? { label: "Codicia",       color: "var(--positive)" }
                          : score >= 45 ? { label: "Neutral",        color: "var(--warning)" }
                          : score >= 25 ? { label: "Miedo",          color: "#f97316" }
                          :               { label: "Miedo Extremo",  color: "var(--negative)" };
                        const BAR_W = 240;
                        const markerX = (score / 100) * BAR_W;
                        return (
                          <div style={{ marginTop: 16, borderTop: "1.5px solid #f0f0ea", paddingTop: 16 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 8 }}>
                              <div>
                                <div style={{ fontFamily: "var(--font-sans)", fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>Fear &amp; Greed</div>
                                <div style={{ fontFamily: "var(--font-sans)", fontSize: 11, fontWeight: 700, color: zone.color }}>{zone.label}</div>
                              </div>
                              <div style={{ fontFamily: "var(--font-mono)", fontSize: 32, fontWeight: 800, color: zone.color, lineHeight: 1 }}>{score}</div>
                            </div>
                            <svg width={BAR_W} height="18" style={{ display: "block", width: "100%" }} viewBox={`0 0 ${BAR_W} 18`}>
                              <defs>
                                <linearGradient id="fg-grad" x1="0" x2="1" y1="0" y2="0">
                                  <stop offset="0%"   stopColor="var(--negative)" />
                                  <stop offset="25%"  stopColor="#f97316" />
                                  <stop offset="50%"  stopColor="var(--warning)" />
                                  <stop offset="75%"  stopColor="var(--positive)" />
                                  <stop offset="100%" stopColor="var(--positive)" />
                                </linearGradient>
                              </defs>
                              <rect x="0" y="5" width={BAR_W} height="6" rx="3" fill="url(#fg-grad)" />
                              <circle cx={markerX} cy="8" r="5" fill={zone.color} stroke="#fff" strokeWidth="2" />
                            </svg>
                            <div style={{ fontSize: 8.5, color: "var(--muted)", marginTop: 6 }}>
                              VIX <b style={{ fontFamily: "var(--font-mono)", color: vixColor }}>{vixVal.toFixed(2)}</b>
                              {macroData?.spread?.value != null && (
                                <span> · <b style={{ color: macroData.spread.inverted ? "var(--negative)" : "var(--positive)" }}>
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
                        <div style={{ fontSize: 8.5, color: "var(--muted)", marginTop: 6, letterSpacing: "0.04em", textAlign: "right" }}>
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
                <Panel title="México · Mercado" color="var(--positive)">
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
                <Panel title="México · Macro" color="var(--positive)">
                  {MX_REF.map((r) => (
                    <div key={r.label} style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "8px 12px", borderBottom: "1px solid var(--border)",
                      background: "var(--surface)",
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 9, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "var(--font-sans)" }}>{r.label}</div>
                        <div style={{ fontSize: 8, color: "var(--muted)", marginTop: 1 }}>{r.period}</div>
                      </div>
                      <div style={{
                        fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700,
                        color: r.color, flexShrink: 0,
                        background: `color-mix(in srgb, ${r.color} 7%, transparent)`, border: `1px solid color-mix(in srgb, ${r.color} 19%, transparent)`,
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

                <Panel title="Materias Primas y Criptoactivos" color="var(--warning)">
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
                        { key: "all",      label: "Todas",    color: "var(--muted)" },
                        { key: "positive", label: " Buenas", color: "var(--positive)" },
                        { key: "neutral",  label: " Neutras",color: "var(--warning)" },
                        { key: "negative", label: " Malas",  color: "var(--negative)" },
                      ].map((f) => {
                        const cnt = f.key === "all" ? marketNews.length : marketNews.filter(n => n.sentiment === f.key).length;
                        return (
                          <button key={f.key} onClick={() => setNewsFilter(f.key)} style={{
                            background: newsFilter === f.key ? `color-mix(in srgb, ${f.color} 15%, transparent)` : "transparent",
                            border: `1px solid ${newsFilter === f.key ? f.color : "var(--border)"}`,
                            borderRadius: 999, color: newsFilter === f.key ? f.color : "var(--muted)",
                            padding: "3px 10px", cursor: "pointer", fontSize: 11, fontWeight: 600,
                          }}>{f.label} <span style={{ color: "var(--muted-2)" }}>({cnt})</span></button>
                        );
                      })}
                    </div>
                  )
                }>Noticias Financieras</SectionLabel>

                {marketNewsLoading && marketNews.length === 0 && (
                  <div style={{ display: "flex", justifyContent: "center", padding: "56px 0", gap: 14, alignItems: "center" }}>
                    <Spinner size={22} />
                    <span style={{ color: "var(--muted)", fontSize: 13 }}>Cargando noticias de mercado...</span>
                  </div>
                )}

                {filteredNews.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {filteredNews.map((item, i) => <MarketNewsItem key={i} item={item} index={i} />)}
                  </div>
                )}

                {!marketNewsLoading && marketNews.length > 0 && filteredNews.length === 0 && (
                  <div style={{ textAlign: "center", color: "var(--muted)", padding: 32, fontSize: 13 }}>
                    No hay noticias {newsFilter === "positive" ? "positivas" : newsFilter === "negative" ? "negativas" : "neutras"} ahora.
                  </div>
                )}

                {!marketNewsLoading && marketNews.length === 0 && (
                  <div style={{
                    textAlign: "center", color: "var(--muted)", padding: 48, fontSize: 13,
                    background: "var(--surface-2)", borderRadius: 24, border: "1px dashed var(--border)"
                  }}>
                    No se cargaron noticias — haz clic en <b>↻ Noticias</b> para reintentar
                  </div>
                )}
              </div>

              {/* ── BUSCAR POR TICKER ── */}
              <div>
                <SectionLabel>Buscar Noticias por Ticker</SectionLabel>
                <div style={{ background: "var(--surface)", borderRadius: 24, boxShadow: "none", border: "1.5px solid var(--border)", padding: 20 }}>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
                    <input aria-label="Ticker para buscar noticias" value={newsTicker}
                      onChange={(e) => setNewsTicker(e.target.value.toUpperCase())}
                      onKeyDown={(e) => e.key === "Enter" && loadNews(newsTicker)}
                      placeholder="AAPL / WALMEX.MX / AMZN.MX"
                      style={{
                        background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10,
                        color: "var(--ink)", padding: "9px 14px", fontSize: 13, width: 220,
                        fontFamily: "var(--font-mono)",
                      }} />
                    <button onClick={() => loadNews(newsTicker)} disabled={newsLoading} style={{
                      background: newsLoading ? "#3a4b42" : "#135936", border: "none",
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
                          background: newsTicker === p.ticker ? "var(--accent-soft)" : "var(--surface-2)",
                          border: `1px solid ${newsTicker === p.ticker ? "var(--accent)" : "var(--border)"}`,
                          borderRadius: 999, color: newsTicker === p.ticker ? "var(--accent)" : "var(--muted-2)",
                          padding: "5px 12px", cursor: "pointer", fontSize: 11,
                          fontFamily: "var(--font-mono)", fontWeight: 600,
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
                    <div style={{ color: "var(--muted)", fontSize: 13, textAlign: "center", padding: "20px 0" }}>
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
              background: "var(--surface)", borderRadius: 24, boxShadow: "none", border: "1.5px solid var(--border)",
              padding: 20, marginBottom: 28
            }}>
              {/* Selector de portafolio */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                <span style={{ fontSize: 10, color: "var(--muted)", letterSpacing: "0.1em", fontWeight: 600 }}>PORTAFOLIO A ANALIZAR</span>
                {portfolios.map(p => (
                  <button key={p.id} onClick={() => setActivePortfolioId(p.id)} style={{
                    background: activePortfolioId === p.id ? "#135936" : "var(--surface-2)",
                    color: activePortfolioId === p.id ? "#ffffff" : "var(--muted)",
                    border: "none", borderRadius: 999, padding: "4px 14px",
                    fontSize: 12, fontWeight: activePortfolioId === p.id ? 700 : 500, cursor: "pointer"
                  }}>{p.name} <span style={{ opacity: 0.7 }}>({p.positions.length})</span></button>
                ))}
              </div>
              <div style={{ fontSize: 14, color: "var(--muted)", marginBottom: 16, lineHeight: 1.6 }}>
                Backtesting de <b style={{ color: "var(--ink)" }}>5 años</b> con datos semanales comparado contra{" "}
                <b style={{ color: "var(--muted)" }}>SPY (S&P 500)</b>.{" "}
                {isExperimental
                  ? <span style={{ color: "var(--info)" }}>Pesos: % objetivo del portafolio experimental.</span>
                  : "Los pesos se calculan con los valores de mercado actuales."
                }
              </div>
              <button onClick={runBacktest} disabled={backtestLoading} className="btn-exec" style={{
                background: backtestLoading ? "var(--muted)" : "var(--bg-deep)",
                border: "none", borderRadius: 999, color: "#ffffff",
                padding: "12px 28px", cursor: backtestLoading ? "not-allowed" : "pointer",
                fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", gap: 10
              }}>
                {backtestLoading && <Spinner size={16} />}
                {backtestLoading ? "Calculando backtest... (puede tardar 1–2 min con 5 años)" : " Ejecutar Backtest vs SPY"}
              </button>
              {backtestError && (
                <div style={{ marginTop: 12, padding: "10px 16px", background: "var(--negative-soft)", border: "1px solid var(--negative)", borderRadius: 10, fontSize: 13, color: "var(--negative)", lineHeight: 1.5 }}>
                  ⚠️ {backtestError}
                </div>
              )}
            </div>

            {backtestResult && (() => {
              const { portCum, spyCum, dates, beta, trackingError, treynor, alpha, infoRatio, sharpe, annPortReturn, annSpyReturn, yearsBacktest, limitingTickerBack, tickerYearsBack } = backtestResult;
              if (!portCum?.length || portCum.length < 5) return (
                <div style={{ padding: "20px", background: "var(--warning-soft)", border: "1px solid var(--warning)", borderRadius: 12, margin: "12px 0", color: "var(--warning)", fontSize: 13 }}>
                  ⚠️ No hay suficientes datos para mostrar el backtest. Puede que algunos tickers del portafolio no tengan historial en yfinance. Revisa la consola del navegador para más detalles.
                </div>
              );
              const outperforms = annPortReturn > annSpyReturn;

              const statCard = (label, value, unit) => (
                <div className="dark-panel" style={{
                  background: "var(--bg-deep)", borderRadius: 20, boxShadow: "none", border: "none",
                  padding: "16px 20px", minWidth: 140, flex: 1
                }}>
                  <div style={{ fontSize: 10, color: "var(--muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6, fontFamily: "var(--font-sans)" }}>{label}</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 28, fontWeight: 500, color: "var(--accent)" }}>
                    {value}{unit ?? ""}
                  </div>
                </div>
              );

              return (
                <div style={{ animation: "fadeIn 0.5s ease" }}>
                  <div style={{ background: "var(--surface)", borderRadius: 24, boxShadow: "none", border: "1.5px solid var(--border)", padding: 20, marginBottom: 24 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
                      <div style={{ fontSize: 12, color: "var(--muted)", letterSpacing: "0.07em", fontWeight: 500 }}>
                        RETORNOS ACUMULADOS — PORTAFOLIO vs SPY ({yearsBacktest ?? "5"} AÑOS SEMANAL)
                      </div>
                      {yearsBacktest && parseFloat(yearsBacktest) < 4.5 && (
                        <div style={{ fontSize: 11, color: "var(--warning)", background: "var(--warning-soft)", border: "1px solid var(--warning)", borderRadius: 6, padding: "2px 8px" }}>
                          ⚠️ Limitado a {yearsBacktest}a por {limitingTickerBack}
                        </div>
                      )}
                    </div>
                    {yearsBacktest && parseFloat(yearsBacktest) < 4.5 && tickerYearsBack && (
                      <div style={{ marginBottom: 12, display: "flex", flexWrap: "wrap", gap: "4px 12px" }}>
                        {tickerYearsBack.map(({ t, y }) => (
                          <span key={t} style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: parseFloat(y) < 3 ? "var(--negative)" : "var(--muted)" }}>
                            {t.split(".")[0]}: {y}a
                          </span>
                        ))}
                      </div>
                    )}
                    <LineChart
                      series={[
                        { name: "Mi Portafolio", color: "var(--positive)", data: portCum },
                        { name: "SPY (S&P 500)", color: "var(--muted)", data: spyCum },
                      ]}
                      dates={dates}
                    />
                  </div>

                  <div style={{
                    background: outperforms ? "var(--positive-soft)" : "var(--negative-soft)",
                    border: outperforms ? "1px solid var(--positive)" : "none",
                    borderLeft: outperforms ? "none" : "3px solid var(--negative)",
                    borderRadius: outperforms ? 24 : 16, padding: "14px 20px", marginBottom: 24,
                    display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
                    fontFamily: "var(--font-sans)",
                  }}>
                    <div style={{ fontSize: 22 }}>{outperforms ? "" : ""}</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: outperforms ? "var(--positive)" : "var(--negative)" }}>
                        {outperforms ? "Superando al benchmark" : "Por debajo del benchmark"}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                        Portafolio: <b style={{ fontFamily: "var(--font-mono)", color: "var(--ink)" }}>{(annPortReturn * 100).toFixed(2)}%</b> anual
                        {" "}vs SPY: <b style={{ fontFamily: "var(--font-mono)", color: "var(--ink)" }}>{(annSpyReturn * 100).toFixed(2)}%</b> anual
                        {" — "}Alpha: <b style={{ fontFamily: "var(--font-mono)", color: alpha >= 0 ? "var(--positive)" : "var(--negative)" }}>
                          {alpha >= 0 ? "+" : ""}{(alpha * 100).toFixed(2)}%
                        </b>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
                    {statCard("Tracking Error", (trackingError * 100).toFixed(2), "%",
                      trackingError < 0.05 ? "var(--positive)" : trackingError < 0.10 ? "var(--warning)" : "var(--negative)")}
                    {statCard("Índice de Treynor", treynor.toFixed(4), "",
                      treynor > 0.1 ? "var(--positive)" : treynor > 0 ? "var(--warning)" : "var(--negative)")}
                    {statCard("Beta (vs SPY)", beta.toFixed(4), "",
                      beta < 1 ? "var(--positive)" : beta < 1.2 ? "var(--warning)" : "var(--negative)")}
                    {statCard("Alpha de Jensen", `${alpha >= 0 ? "+" : ""}${(alpha * 100).toFixed(2)}`, "%",
                      alpha >= 0 ? "var(--positive)" : "var(--negative)")}
                    {statCard("Sharpe Ratio", sharpe.toFixed(4), "",
                      sharpe > 1 ? "var(--positive)" : sharpe > 0.5 ? "var(--warning)" : "var(--negative)")}
                    {statCard("Information Ratio", infoRatio.toFixed(4), "",
                      infoRatio > 0.5 ? "var(--positive)" : infoRatio > 0 ? "var(--warning)" : "var(--negative)")}
                  </div>

                  {/* Heatmap de correlación */}
                  {backtestResult?.corrMatrix && (() => {
                    const { corrMatrix: cm, tickers: tks } = backtestResult;
                    return (
                      <div style={{ background: "var(--surface)", borderRadius: 24, boxShadow: "none", border: "1.5px solid var(--border)", padding: 20, marginBottom: 20 }}>
                        <div style={{ fontSize: 10, color: "var(--muted)", letterSpacing: "0.14em", fontWeight: 600, marginBottom: 16 }}>MATRIZ DE CORRELACIÓN DE ACTIVOS</div>
                        <div style={{ overflowX: "auto" }}>
                          <table style={{ borderCollapse: "separate", borderSpacing: 3 }}>
                            <thead>
                              <tr>
                                <th style={{ padding: "4px 8px", fontSize: 10, color: "var(--muted)", textAlign: "right", border: "none", background: "none" }}></th>
                                {tks.map(tk => <th key={tk} style={{ padding: "4px 8px", fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--muted)", border: "none", background: "none", textAlign: "center" }}>{tk.split(".")[0]}</th>)}
                              </tr>
                            </thead>
                            <tbody>
                              {cm.map((row, i) => (
                                <tr key={tks[i]}>
                                  <td style={{ padding: "4px 8px", fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--muted)", fontWeight: 700, border: "none", textAlign: "right", whiteSpace: "nowrap" }}>{tks[i].split(".")[0]}</td>
                                  {row.map((val, j) => {
                                    let bg, fg;
                                    if (i === j) { bg = "var(--bg-deep)"; fg = "#ffffff"; }
                                    // Tintes de los tokens con texto --ink: los colores fijos anteriores perdían contraste en tema oscuro
                                    else if (val >= 0.7)  { bg = `color-mix(in srgb, var(--negative) ${Math.round((0.15 + val * 0.4) * 100)}%, transparent)`; fg = "var(--ink)"; }
                                    else if (val >= 0.4)  { bg = `color-mix(in srgb, var(--warning) ${Math.round((0.15 + val * 0.3) * 100)}%, transparent)`; fg = "var(--ink)"; }
                                    else if (val >= 0)    { bg = `color-mix(in srgb, var(--positive) ${Math.round((0.1 + val * 0.3) * 100)}%, transparent)`; fg = "var(--ink)"; }
                                    else                  { bg = `color-mix(in srgb, var(--info) ${Math.round((0.1 + Math.abs(val) * 0.4) * 100)}%, transparent)`; fg = "var(--ink)"; }
                                    return (
                                      <td key={j} style={{ padding: "6px 10px", background: bg, borderRadius: 6, textAlign: "center", fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 700, color: fg, cursor: "default", minWidth: 52 }}>
                                        {val.toFixed(2)}
                                      </td>
                                    );
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div style={{ marginTop: 10, display: "flex", gap: 16, fontSize: 10, color: "var(--muted)" }}>
                          <span style={{ color: "var(--positive)" }}>■ Baja correlación (buena diversificación)</span>
                          <span style={{ color: "var(--warning)" }}>■ Correlación media</span>
                          <span style={{ color: "var(--negative)" }}>■ Alta correlación (&gt;0.7 = riesgo de concentración)</span>
                          <span style={{ color: "var(--positive)" }}>■ Correlación negativa (cobertura natural)</span>
                        </div>
                      </div>
                    );
                  })()}

                  <div style={{ background: "var(--surface)", borderRadius: 24, boxShadow: "none", border: "1.5px solid var(--border)", padding: "16px 20px" }}>
                    <div style={{ fontSize: 12, color: "var(--muted)", letterSpacing: "0.07em", fontWeight: 500, marginBottom: 12 }}>GLOSARIO DE MÉTRICAS</div>
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
                          <div style={{ minWidth: 4, borderRadius: 2, background: "var(--bg-deep)", alignSelf: "stretch" }} />
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", marginBottom: 2 }}>{name}</div>
                            <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.5 }}>{desc}</div>
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
              background: "var(--surface)", borderRadius: 24, boxShadow: "none", border: "1.5px solid var(--border)",
              padding: 20, marginTop: 24
            }}>
              <div style={{ fontSize: 12, color: "var(--muted)", letterSpacing: "0.07em", fontWeight: 500, marginBottom: 8 }}>
                PROYECCIÓN FUTURA — MONTE CARLO
              </div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 14, lineHeight: 1.6 }}>
                Simulación de <b style={{ color: "var(--ink)" }}>10,000 escenarios</b> a 52 semanas usando retornos históricos de{" "}
                <b style={{ color: "var(--ink)" }}>5 años</b>. Muestra el rango p5–p95 del portafolio vs SPY.
              </div>
              <button onClick={runMonteCarlo} disabled={monteCarloLoading || portfolio.length === 0} className="btn-exec" style={{
                background: monteCarloLoading ? "var(--muted)" : "var(--bg-deep)",
                border: "none", borderRadius: 999, color: "#ffffff",
                padding: "12px 28px", cursor: monteCarloLoading ? "not-allowed" : "pointer",
                fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", gap: 10
              }}>
                {monteCarloLoading && <Spinner size={16} />}
                {monteCarloLoading ? "Simulando... (puede tardar 1–2 min)" : " Ejecutar Monte Carlo (5 años)"}
              </button>
              {monteCarloError && (
                <div style={{ marginTop: 12, padding: "10px 16px", background: "var(--negative-soft)", border: "1px solid var(--negative)", borderRadius: 10, fontSize: 13, color: "var(--negative)", lineHeight: 1.5 }}>
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
                <div style={{ background: "var(--surface)", borderRadius: 24, boxShadow: "none", border: "1.5px solid var(--border)", padding: "16px 20px", flex: 1, minWidth: 140 }}>
                  <div style={{ fontSize: 10, color: "var(--muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 20, fontWeight: 700, color: color ?? "var(--bg-deep)" }}>{value}</div>
                  {sub && <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 4 }}>{sub}</div>}
                </div>
              );

              return (
                <div style={{ animation: "fadeIn 0.5s ease", marginTop: 20 }}>
                  <div style={{ background: "var(--surface)", borderRadius: 24, boxShadow: "none", border: "1.5px solid var(--border)", padding: 20, marginBottom: 20 }}>
                    <div style={{ fontSize: 12, color: "var(--muted)", letterSpacing: "0.07em", fontWeight: 500, marginBottom: 14 }}>
                      RETORNOS PROYECTADOS — {N.toLocaleString()} SIMULACIONES · {yearsData} AÑOS DE HISTORIAL
                    </div>
                    <MonteCarloChart portStats={portStats} spyStats={spyStats} weeks={weeks} />
                  </div>

                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
                    {mcCard("Retorno esperado (port.)", `${portAnnReturn >= 0 ? "+" : ""}${portAnnReturn.toFixed(1)}%`,
                      portAnnReturn >= 0 ? "var(--positive)" : "var(--negative)", "anualizado · media de simulaciones")}
                    {mcCard("Retorno esperado (SPY)", `${spyAnnReturn >= 0 ? "+" : ""}${spyAnnReturn.toFixed(1)}%`,
                      spyAnnReturn >= 0 ? "var(--positive)" : "var(--negative)", "anualizado · media de simulaciones")}
                    {mcCard("Prob. superar SPY", `${(probBeat * 100).toFixed(1)}%`,
                      probBeat > 0.55 ? "var(--positive)" : probBeat > 0.45 ? "var(--warning)" : "var(--negative)", "en el horizonte de 1 año")}
                    {mcCard("Rango portafolio (90%)", `${((portP5-1)*100).toFixed(1)}% a ${((portP95-1)*100).toFixed(1)}%`,
                      "var(--accent)", "p5 – p95 al final del período")}
                  </div>

                  <div className="dark-panel" style={{ background: "var(--surface-2)", borderRadius: 24, padding: "14px 20px", display: "flex", flexWrap: "wrap", gap: 24 }}>
                    {[
                      ["Retorno med. semanal (port.)", `${(muPort * 100).toFixed(3)}%`],
                      ["Vol. semanal (port.)",          `${(sigPort * 100).toFixed(3)}%`],
                      ["Retorno med. semanal (SPY)",   `${(muSpy  * 100).toFixed(3)}%`],
                      ["Vol. semanal (SPY)",            `${(sigSpy  * 100).toFixed(3)}%`],
                      ["Simulaciones",                  N.toLocaleString()],
                      ["Años de historial",             yearsData],
                    ].map(([label, val]) => (
                      <div key={label}>
                        <div style={{ fontSize: 10, color: "var(--muted)", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 3 }}>{label}</div>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600, color: "var(--muted)" }}>{val}</div>
                      </div>
                    ))}
                  </div>
                  {limitingTicker && parseFloat(yearsData) < 4.5 && (
                    <div style={{ marginTop: 12, padding: "10px 14px", background: "var(--warning-soft)", border: "1px solid var(--warning)", borderRadius: 10, fontSize: 12, color: "var(--warning)" }}>
                      ⚠️ El historial está limitado a <b>{yearsData} años</b> por <b style={{ fontFamily: "var(--font-mono)" }}>{limitingTicker}</b> (el ticker con menos datos disponibles en yfinance).
                      Los demás activos sí tienen más historial pero se recortan al mínimo común para mantener consistencia estadística.
                      {tickerYears && (
                        <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: "6px 16px" }}>
                          {tickerYears.map(({ t, y }) => (
                            <span key={t} style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: parseFloat(y) < 3 ? "var(--negative)" : "#555555" }}>
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
            <div style={{ background: "var(--surface)", boxShadow: "none", border: "1.5px solid var(--border)", borderRadius: 24, padding: 20, marginBottom: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)", marginBottom: 6 }}>FIBRA Screener</div>
                  <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6, maxWidth: 680 }}>
                    Fideicomisos de Infraestructura y Bienes Raíces (REITs mexicanos). Valuación por <b style={{ color: "var(--ink)" }}>Cap Rate</b>, <b style={{ color: "var(--ink)" }}>P/NAV</b> (precio vs valor activo neto) y <b style={{ color: "var(--ink)" }}>FFO Yield</b>.
                    Una FIBRA con P/NAV {"<"} 0.85 cotiza con <b style={{ color: "var(--positive)" }}>descuento</b> al valor de sus activos — señal de oportunidad.
                    Cap Rate alto indica mayor rendimiento operativo sobre el valor del portafolio.
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input aria-label="Tickers de FIBRAs adicionales"
                      value={fibrasExtra}
                      onChange={e => setFibrasExtra(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && !fibrasLoading && runFibrasScreener()}
                      placeholder="Agregar tickers: FREAL.MX, VESTA.MX..."
                      style={{
                        background: "var(--surface-2)", border: "1.5px solid var(--border)", borderRadius: 10,
                        padding: "10px 14px", fontSize: 12, color: "var(--ink)",
                        fontFamily: "var(--font-mono)", width: 240, outline: "none"
                      }}
                    />
                    <button onClick={runFibrasScreener} disabled={fibrasLoading} className="btn-exec" style={{
                      background: fibrasLoading ? "#3a4b42" : "#135936",
                      border: "none", borderRadius: 999, color: "#ffffff",
                      padding: "12px 28px", fontSize: 14, fontWeight: 700,
                      cursor: fibrasLoading ? "not-allowed" : "pointer",
                      display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap"
                    }}>
                      {fibrasLoading && <Spinner size={16} />}
                      {fibrasLoading ? "Cargando..." : "Analizar FIBRAs"}
                    </button>
                  </div>
                  <div style={{ fontSize: 10, color: "var(--muted)", textAlign: "right" }}>
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
                  <div key={m.label} style={{ background: "var(--surface-2)", borderRadius: 8, padding: "5px 10px" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "var(--ink)" }}>{m.label}</span>
                    <span style={{ fontSize: 10, color: "var(--muted)", marginLeft: 6 }}>{m.desc}</span>
                  </div>
                ))}
              </div>
            </div>

            {!fibrasData && !fibrasLoading && (
              <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 13, marginTop: 60 }}>
                Presiona "Analizar FIBRAs" para cargar las principales FIBRAs mexicanas
              </div>
            )}

            {fibrasData?.fibras?.length === 0 && (
              <div style={{ textAlign: "center", color: "var(--negative)", fontSize: 13, marginTop: 40 }}>
                No se pudieron obtener datos. Verifica que el backend esté corriendo.
              </div>
            )}

            {fibrasData?.fibras?.length > 0 && (
              <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
                {fibrasData.fibras.map((f) => {
                  const sigColor = f.signal === "OPORTUNIDAD" ? "var(--positive)" : f.signal === "CARA" ? "var(--negative)" : "var(--warning)";
                  const sigBg    = f.signal === "OPORTUNIDAD" ? "var(--positive-soft)"  : f.signal === "CARA" ? "var(--negative-soft)"  : "var(--warning-soft)";
                  const navPct   = f.navDiscount;
                  return (
                    <div className="kpi-hover" key={f.ticker} style={{
                      background: "var(--surface)", boxShadow: "none", border: "1.5px solid var(--border)",
                      borderRadius: 24, padding: 20, borderTop: `3px solid ${sigColor}`
                    }}>
                      {/* Header */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                        <div>
                          <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 15, color: "var(--ink)" }}>{f.ticker}</div>
                          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{f.name}</div>
                          <div style={{ fontSize: 13, fontFamily: "var(--font-mono)", color: "var(--muted)", marginTop: 4 }}>
                            ${f.price?.toLocaleString("es-MX", { minimumFractionDigits: 2 })} <span style={{ fontSize: 10, color: "var(--muted)" }}>{f.currency}</span>
                          </div>
                        </div>
                        <div style={{ background: sigBg, borderRadius: 10, padding: "6px 12px", textAlign: "center" }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: sigColor, letterSpacing: "0.1em" }}>{f.signal}</div>
                          {f.pNAV != null && (
                            <div style={{ fontFamily: "var(--font-mono)", fontSize: 20, fontWeight: 700, color: sigColor, marginTop: 2 }}>
                              {f.pNAV}x
                            </div>
                          )}
                          <div style={{ fontSize: 9, color: "var(--muted)" }}>P/NAV</div>
                        </div>
                      </div>

                      {/* Métricas en grid 2×3 */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
                        {[
                          { label: "Cap Rate",    value: f.capRate  != null ? `${f.capRate}%`  : "—", color: f.capRate  > 8 ? "var(--positive)" : f.capRate  > 5 ? "var(--warning)" : "var(--negative)" },
                          { label: "Desc/Prima",  value: navPct     != null ? `${navPct > 0 ? "+" : ""}${navPct}%` : "—", color: navPct < -5 ? "var(--positive)" : navPct > 5 ? "var(--negative)" : "var(--warning)" },
                          { label: "FFO Yield",   value: f.ffoYield != null ? `${f.ffoYield}%` : "—", color: f.ffoYield > 6 ? "var(--positive)" : "var(--muted)" },
                          { label: "Dist. Yield", value: f.divYield != null ? `${f.divYield}%` : "—", color: f.divYield > 6 ? "var(--positive)" : "var(--muted)" },
                          { label: "LTV",         value: f.ltv      != null ? `${f.ltv}%`      : "—", color: f.ltv < 40 ? "var(--positive)" : f.ltv < 55 ? "var(--warning)" : "var(--negative)" },
                          { label: "NAV/acc",     value: f.navPS    != null ? `$${f.navPS.toLocaleString("es-MX", { minimumFractionDigits: 2 })}` : "—", color: "var(--ink)" },
                        ].map(m => (
                          <div key={m.label} style={{ background: "var(--surface-2)", borderRadius: 8, padding: "8px 10px" }}>
                            <div style={{ fontSize: 9, color: "var(--muted)", letterSpacing: "0.08em", fontWeight: 600 }}>{m.label}</div>
                            <div style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700, color: m.color, marginTop: 2 }}>{m.value}</div>
                          </div>
                        ))}
                      </div>

                      {/* Barra P/NAV visual (rango 0.5x → 1.5x) */}
                      {f.pNAV != null && (
                        <div style={{ marginTop: 4 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "var(--muted)", marginBottom: 3 }}>
                            <span>0.5x</span>
                            <span style={{ color: "var(--positive)" }}>0.85x</span>
                            <span style={{ color: "var(--warning)" }}>1.0x</span>
                            <span style={{ color: "var(--negative)" }}>1.15x</span>
                            <span>1.5x</span>
                          </div>
                          <div style={{ background: "var(--border)", borderRadius: 4, height: 6, position: "relative" }}>
                            <div style={{ position: "absolute", left: "35%", width: "30%", height: "100%", background: "var(--positive-soft)", borderRadius: 4 }} />
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
                        <span style={{ background: "var(--border)", borderRadius: 6, padding: "2px 8px", fontSize: 10, color: "var(--muted)" }}>{f.sector}</span>
                        {f.marketCap && (
                          <span style={{ background: "var(--border)", borderRadius: 6, padding: "2px 8px", fontSize: 10, color: "var(--muted)" }}>
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
            <div style={{ background: "var(--surface)", boxShadow: "none", border: "1.5px solid var(--border)", borderRadius: 24, padding: 20, marginBottom: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
                <div style={{ flex: 1, minWidth: 280 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)", marginBottom: 4 }}>
                    Fórmula Mágica · Joel Greenblatt
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.7, maxWidth: 700 }}>
                    Clasifica empresas del S&P 500 combinando <b style={{ color: "var(--ink)" }}>calidad</b> y <b style={{ color: "var(--ink)" }}>precio</b>.
                    Ordena por rango combinado de dos métricas — el menor rango es la mejor oportunidad.
                    Excluye bancos, aseguradoras, utilities y REITs.
                  </div>
                  {/* Fórmulas */}
                  <div style={{ display: "flex", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
                    <div style={{ background: "var(--surface-2)", borderRadius: 10, padding: "10px 14px", minWidth: 220 }}>
                      <div style={{ fontSize: 9, color: "var(--muted)", letterSpacing: "0.1em", fontWeight: 600, marginBottom: 4 }}>EARNINGS YIELD (precio)</div>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink)" }}>EY = EBIT / Enterprise Value</div>
                      <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 3 }}>Mayor % = más barata la acción</div>
                    </div>
                    <div style={{ background: "var(--surface-2)", borderRadius: 10, padding: "10px 14px", minWidth: 220 }}>
                      <div style={{ fontSize: 9, color: "var(--muted)", letterSpacing: "0.1em", fontWeight: 600, marginBottom: 4 }}>RETURN ON CAPITAL (calidad)</div>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink)" }}>ROC = EBIT / (NWC + PP&E neto)</div>
                      <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 3 }}>Mayor % = negocio más eficiente</div>
                    </div>
                  </div>
                </div>
                <button onClick={runMagicFormula} disabled={magicLoading} className="btn-exec" style={{
                  background: magicLoading ? "#3a4b42" : "#135936",
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
                <div style={{ marginTop: 12, fontSize: 11, color: "var(--muted)" }}>
                  Universo analizado: <b style={{ color: "var(--muted)" }}>{magicData.count}</b> empresas calificables
                  de {magicData.universe} en lista · Mostrando top 30
                </div>
              )}
            </div>

            {magicLoading && (
              <div style={{ background: "var(--surface)", boxShadow: "none", border: "1.5px solid var(--border)", borderRadius: 24, padding: 28 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
                      Analizando universo S&P 500...
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>
                      Procesando <b style={{ fontFamily: "var(--font-mono)", color: "var(--positive)" }}>{magicProgress.current}</b>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 22, fontWeight: 700, color: "var(--ink)" }}>
                      {magicProgress.done}<span style={{ fontSize: 13, color: "var(--muted)" }}>/{magicProgress.total}</span>
                    </div>
                    <div style={{ fontSize: 10, color: "var(--muted)" }}>tickers analizados</div>
                  </div>
                </div>
                <div style={{ background: "var(--border)", borderRadius: 8, height: 8, overflow: "hidden" }}>
                  <div style={{
                    width: `${magicProgress.total > 0 ? (magicProgress.done / magicProgress.total) * 100 : 0}%`,
                    height: "100%", background: "var(--bg-deep)", borderRadius: 8,
                    transition: "width 0.3s ease"
                  }} />
                </div>
                <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 8 }}>
                  Estimado: ~{Math.max(1, Math.round((magicProgress.total - magicProgress.done) * 0.2 / 60))} min restantes
                </div>
              </div>
            )}

            {!magicData && !magicLoading && (
              <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 13, marginTop: 60 }}>
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
                    background: "var(--surface)", boxShadow: "none", border: "1.5px solid var(--border)",
                    borderRadius: 24, padding: "14px 20px", marginBottom: 12,
                    display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap"
                  }}>
                    <span style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600, letterSpacing: "0.1em" }}>FILTROS</span>

                    {/* Sector */}
                    <select aria-label="Filtrar por sector" value={magicSector} onChange={e => setMagicSector(e.target.value)} style={{
                      background: "var(--surface-2)", border: "1px solid var(--border-strong)", borderRadius: 8,
                      padding: "5px 10px", fontSize: 12, color: "var(--ink)", cursor: "pointer"
                    }}>
                      {sectors.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>

                    {/* Min EY */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 11, color: "var(--muted)" }}>EY mín</span>
                      <input aria-label="Earnings yield mínimo en porcentaje" type="number" placeholder="0%" value={magicMinEY}
                        onChange={e => setMagicMinEY(e.target.value)}
                        style={{ width: 64, background: "var(--surface-2)", border: "1px solid var(--border-strong)", borderRadius: 8, padding: "5px 8px", fontSize: 12, color: "var(--ink)" }} />
                    </div>

                    {/* Min ROC */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 11, color: "var(--muted)" }}>ROC mín</span>
                      <input aria-label="ROC mínimo en porcentaje" type="number" placeholder="0%" value={magicMinROC}
                        onChange={e => setMagicMinROC(e.target.value)}
                        style={{ width: 64, background: "var(--surface-2)", border: "1px solid var(--border-strong)", borderRadius: 8, padding: "5px 8px", fontSize: 12, color: "var(--ink)" }} />
                    </div>

                    {/* Reset */}
                    {(magicSector !== "Todos" || magicMinEY || magicMinROC) && (
                      <button onClick={() => { setMagicSector("Todos"); setMagicMinEY(""); setMagicMinROC(""); }}
                        style={{ background: "none", border: "1px solid var(--border-strong)", borderRadius: 8, padding: "5px 12px", fontSize: 11, color: "var(--muted)", cursor: "pointer" }}>
                        Limpiar
                      </button>
                    )}

                    <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted)" }}>
                      {filtered.length} resultado{filtered.length !== 1 ? "s" : ""}
                    </span>
                  </div>

                  {/* ── Tabla ── */}
                  <div style={{ background: "var(--surface)", boxShadow: "none", border: "1.5px solid var(--border)", borderRadius: 24, overflow: "hidden" }}>
                    {/* Header con click para ordenar */}
                    <div className="dark-panel" style={{ display: "grid", gridTemplateColumns: gridCols, padding: "10px 20px", background: "var(--surface-2)", borderBottom: "1px solid var(--border)" }}>
                      {cols.map((c, i) => (
                        <div key={i}
                          onClick={() => c.key && toggleSort(c.key)}
                          {...(c.key ? {
                            role: "button", tabIndex: 0,
                            onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSort(c.key); } },
                          } : {})}
                          style={{
                            fontSize: 9, fontWeight: 600, letterSpacing: "0.1em",
                            textAlign: c.right ? "right" : "left",
                            color: magicSort.col === c.key ? "var(--bg-deep)" : "var(--muted)",
                            cursor: c.key ? "pointer" : "default",
                            userSelect: "none",
                            transition: "color 0.15s"
                          }}>{c.label}</div>
                      ))}
                    </div>

                    {filtered.length === 0 && (
                      <div style={{ padding: 32, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
                        Ninguna empresa cumple los filtros aplicados
                      </div>
                    )}

                    {filtered.map((s, idx) => {
                      const eyColor  = s.ey  > 10 ? "var(--positive)" : s.ey  > 5 ? "var(--warning)" : "var(--negative)";
                      const rocColor = s.roc > 25 ? "var(--positive)" : s.roc > 12 ? "var(--warning)" : "var(--negative)";
                      const isTop = magicSort.col === "magic_rank" && magicSector === "Todos" && !magicMinEY && !magicMinROC;
                      const medalBg    = isTop && idx === 0 ? "#1a1600" : isTop && idx === 1 ? "#181c20" : isTop && idx === 2 ? "#1a0e00" : "transparent";
                      const medalColor = isTop && idx === 0 ? "var(--warning)" : isTop && idx === 1 ? "var(--muted)" : isTop && idx === 2 ? "#fb923c" : "var(--muted-2)";
                      return (
                        <div key={s.ticker} style={{
                          display: "grid", gridTemplateColumns: gridCols,
                          padding: "11px 20px", background: medalBg,
                          borderBottom: "1px solid var(--border)", alignItems: "center",
                        }}>
                          <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, color: medalColor }}>{idx + 1}</div>
                          <div style={{
                            background: idx < 5 && isTop ? "var(--positive-soft)" : "var(--border)",
                            color: idx < 5 && isTop ? "var(--positive)" : "var(--muted)",
                            borderRadius: 6, padding: "2px 6px", fontSize: 11, fontWeight: 700,
                            textAlign: "center", width: "fit-content"
                          }}>{s.magic_rank}</div>
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 13, color: "var(--ink)" }}>{s.ticker}</span>
                              <span style={{ background: "var(--border)", borderRadius: 5, padding: "1px 6px", fontSize: 9, color: "var(--muted)" }}>{s.sector?.split(" ")[0]}</span>
                            </div>
                            <div style={{ fontSize: 10, color: "var(--muted)" }}>{s.name}</div>
                            {s.price && <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted)" }}>${s.price}</div>}
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700, color: eyColor }}>{s.ey}%</div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700, color: rocColor }}>{s.roc}%</div>
                          </div>
                          <div style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted)" }}>{s.pe != null ? `${s.pe}x` : "—"}</div>
                          <div style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted)" }}>{s.pb != null ? `${s.pb}x` : "—"}</div>
                          <div style={{ textAlign: "right", fontSize: 11, color: "var(--muted)" }}>#{s.rank_ey}</div>
                          <div style={{ textAlign: "right", fontSize: 11, color: "var(--muted)" }}>#{s.rank_roc}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {magicData?.stocks?.length === 0 && (
              <div style={{ textAlign: "center", color: "var(--negative)", fontSize: 13, marginTop: 40 }}>
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
          const lineColor = isUp ? "var(--accent)" : "var(--negative)";
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
          const recColor = score?.overall_score >= 7 ? "var(--accent)" : score?.overall_score >= 5 ? "var(--warning)" : "var(--negative)";

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
                  return <line key={pct} x1="0" y1={y} x2={BW} y2={y} stroke="var(--border)" strokeWidth="1" />;
                })}
                {QLABELS.map((ql, qi) => {
                  const gx = qi * groupW;
                  return (
                    <g key={qi}>
                      <text x={gx + groupW / 2} y={TP + BH + 28} textAnchor="middle" fill="var(--muted)" fontSize="11" fontFamily="monospace">{ql}</text>
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
              <div className="dark-panel" style={{ background: "var(--bg-deep)", borderRadius: 16, padding: "20px 24px", position: "relative" }}>
                <input aria-label="Ticker a analizar"
                  value={analisisTicker}
                  onChange={e => setAnalisisTicker(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && runAnalisis()}
                  placeholder="Buscar ticker... AAPL, AMZN, CEMEXCPO.MX"
                  style={{
                    width: "100%", boxSizing: "border-box",
                    background: "transparent", color: "#ffffff", border: "none",
                    borderBottom: "2px solid var(--accent)", outline: "none",
                    padding: "10px 160px 10px 0",
                    fontFamily: "var(--font-sans)", fontSize: 20, fontWeight: 700,
                  }}
                />
                <button
                  onClick={() => runAnalisis()}
                  disabled={analisisLoading}
                  style={{
                    position: "absolute", right: 24, top: "50%", transform: "translateY(-50%)",
                    background: "var(--bg-deep)", color: "var(--accent)",
                    border: "1.5px solid #7fe3a0", borderRadius: 10,
                    padding: "10px 24px", cursor: "pointer",
                    fontWeight: 800, fontSize: 13,
                    transition: "all 0.15s", letterSpacing: "0.05em",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = "var(--accent-strong)"; e.currentTarget.style.color = "var(--on-accent)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "var(--bg-deep)"; e.currentTarget.style.color = "#7fe3a0"; }}
                >
                  {analisisLoading ? "CARGANDO..." : "ANALIZAR →"}
                </button>
              </div>

              {analisisLoading && (
                <div style={{ display: "flex", alignItems: "center", gap: 12, color: "var(--muted)", fontSize: 13, padding: "8px 0" }}>
                  <Spinner size={16} /> Analizando {analisisTicker.toUpperCase()}...
                </div>
              )}
              {analisisError && (
                <div style={{ color: "var(--negative)", fontFamily: "var(--font-mono)", fontSize: 13, padding: "8px 0" }}>{analisisError}</div>
              )}

              {analisisData && !analisisLoading && (
                <>
                  {/* ── HEADER ── */}
                  <div className="dark-panel" style={{ background: "var(--bg-deep)", borderRadius: 20, padding: "28px 32px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
                          <span style={{ fontFamily: "var(--font-sans)", fontSize: 48, fontWeight: 800, color: "#ffffff", lineHeight: 1 }}>{ticker}</span>
                          <span style={{ color: "var(--muted-2)", fontSize: 16 }}>{f.name ?? f.longName ?? ""}</span>
                        </div>
                        <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {f.sector && <span style={{ background: "var(--bg-deep)", color: "#8fa3b8", padding: "3px 12px", borderRadius: 999, fontSize: 11, fontWeight: 600 }}>{f.sector}</span>}
                          {f.industry && <span style={{ background: "var(--bg-deep)", color: "#8fa3b8", padding: "3px 12px", borderRadius: 999, fontSize: 11 }}>{f.industry}</span>}
                          {f.exchange && <span style={{ background: "var(--bg-deep)", color: "#8fa3b8", padding: "3px 12px", borderRadius: 999, fontSize: 11 }}>{f.exchange}</span>}
                          {f.country && <span style={{ background: "var(--bg-deep)", color: "#8fa3b8", padding: "3px 12px", borderRadius: 999, fontSize: 11 }}>{f.country}</span>}
                          {f.employees != null && <span style={{ background: "var(--bg-deep)", color: "#8fa3b8", padding: "3px 12px", borderRadius: 999, fontSize: 11 }}>{Number(f.employees).toLocaleString()} empleados</span>}
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: 36, color: "#ffffff", fontWeight: 700, lineHeight: 1 }}>
                          ${f.price != null ? Number(f.price).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
                        </div>
                        <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 8 }}>
                          {f.change_pct != null && (
                            <span style={{ color: f.change_pct >= 0 ? "var(--positive)" : "var(--negative)", fontSize: 18, fontWeight: 700 }}>
                              {f.change_pct >= 0 ? "+" : ""}{Number(f.change_pct).toFixed(2)}%
                            </span>
                          )}
                          {f.marketCap != null && (
                            <span style={{ color: "var(--muted-2)", fontSize: 13, alignSelf: "center" }}>
                              Cap ${(f.marketCap / 1e9).toFixed(1)}B
                            </span>
                          )}
                        </div>
                        {f.website && (
                          <a href={f.website} target="_blank" rel="noopener noreferrer"
                            style={{ color: "var(--muted-2)", fontSize: 11, textDecoration: "none", marginTop: 6, display: "block" }}>
                            {f.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                          </a>
                        )}
                      </div>
                    </div>
                    {/* Descripción del negocio */}
                    {f.description && (
                      <div style={{ marginTop: 20, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
                        <p style={{
                          color: "#9ca3af", fontSize: 13, lineHeight: 1.7, margin: 0,
                          display: "-webkit-box", WebkitLineClamp: analisisDescExpanded ? "unset" : 3,
                          WebkitBoxOrient: "vertical", overflow: analisisDescExpanded ? "visible" : "hidden",
                        }}>
                          {f.description}
                        </p>
                        <button onClick={() => setAnalisisDescExpanded(v => !v)}
                          style={{ background: "none", border: "none", color: "var(--accent)", fontSize: 12, cursor: "pointer", marginTop: 8, padding: 0, fontFamily: "var(--font-mono)" }}>
                          {analisisDescExpanded ? "Ver menos ▲" : "Ver más ▼"}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* ── GRÁFICA ── */}
                  <div className="dark-panel" style={{ background: "var(--bg-deep)", borderRadius: 16, padding: "20px 24px" }}>
                    {/* Tabs de período */}
                    <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
                      {PERIODS.map(p => {
                        const ret = analisisReturns?.[p.id];
                        const retColor = ret == null ? "var(--muted)" : ret >= 0 ? "var(--positive)" : "var(--negative)";
                        const isActive = analisisPeriod === p.id;
                        return (
                          <button key={p.id} onClick={() => fetchAnalisisChart(p.id)}
                            style={{
                              background: isActive ? "#135936" : "var(--bg-deep)",
                              color: isActive ? "#ffffff" : "var(--muted)",
                              border: "none", borderRadius: 8, padding: "5px 14px 6px",
                              cursor: "pointer", fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 12,
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
                        <div style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 13, color: lineColor, alignSelf: "center" }}>
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
                          <rect width={W} height={H} fill="var(--bg-deep)" rx="10" />
                          <path className="chart-fade-in" d={svgArea} fill="url(#ag-grad)" />
                          <path className="chart-draw-line" pathLength={1} d={svgPath} fill="none" stroke={lineColor} strokeWidth="2.5" strokeLinejoin="round" />
                          {hPt && (
                            <g>
                              <line x1={hPt.x} y1="0" x2={hPt.x} y2={H} stroke="#ffffff" strokeWidth="1" strokeOpacity="0.2" strokeDasharray="4,4" />
                              <circle cx={hPt.x} cy={hPt.y} r="5" fill={lineColor} stroke="var(--bg-deep)" strokeWidth="2" />
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
                    <div className="dark-panel" style={{ background: "var(--bg-deep)", borderRadius: 16, padding: "20px 24px" }}>
                      <div style={{ fontFamily: "var(--font-sans)", fontSize: 10, fontWeight: 700, color: "var(--muted-2)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 14 }}>Métricas Clave</div>
                      <div className="analisis-kpis" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
                        {metrics.map(({ label, val, lo, hi }) => {
                          const cheap  = lo && val != null && lo(val);
                          const pricey = hi && val != null && hi(val);
                          const valColor = cheap ? "var(--accent)" : pricey ? "var(--negative)" : "#ffffff";
                          return (
                            <div key={label} style={{ background: "var(--bg-deep)", borderRadius: 12, padding: "12px 14px" }}>
                              <div style={{ color: "var(--muted)", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{label}</div>
                              <div style={{ color: valColor, fontFamily: "var(--font-mono)", fontSize: 20, fontWeight: 700 }}>{fmtV(val)}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* ML Score */}
                    {score && (
                      <div className="dark-panel" style={{ background: "var(--bg-deep)", borderRadius: 16, padding: "20px 24px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                          <div style={{ fontFamily: "var(--font-sans)", fontSize: 10, fontWeight: 700, color: "var(--muted-2)", letterSpacing: "0.12em", textTransform: "uppercase" }}>ML Score</div>
                          <div style={{
                            background: recColor, color: "var(--bg-deep)",
                            fontFamily: "var(--font-sans)", fontWeight: 800, fontSize: 13,
                            padding: "5px 16px", borderRadius: 999,
                          }}>
                            {score.recommendation} · {score.overall_score}/10
                          </div>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                          {scoreDims.map(({ label, val }) => {
                            const c = val >= 7 ? "var(--accent)" : val >= 5 ? "var(--warning)" : "var(--negative)";
                            return (
                              <div key={label}>
                                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                                  <span style={{ color: "var(--muted)", fontSize: 12 }}>{label}</span>
                                  <span style={{ color: c, fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700 }}>{val}/10</span>
                                </div>
                                <div style={{ background: "var(--bg-deep)", borderRadius: 4, height: 6, overflow: "hidden" }}>
                                  <div style={{ width: `${val * 10}%`, height: "100%", background: c, borderRadius: 4, transition: "width 0.6s ease" }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <div style={{ color: "var(--muted-2)", fontSize: 11, fontFamily: "var(--font-mono)", marginTop: 14, lineHeight: 1.6 }}>
                          {score.rationale}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ── FINANCIEROS ── */}
                  <div className="dark-panel" style={{ background: "var(--bg-deep)", borderRadius: 16, padding: "20px 24px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 20 }}>
                      <div style={{ fontFamily: "var(--font-sans)", fontSize: 10, fontWeight: 700, color: "var(--muted-2)", letterSpacing: "0.12em", textTransform: "uppercase", marginRight: 12 }}>Financieros</div>
                      {[["income","Income"],["balance","Balance"],["cashflow","Cash Flow"]].map(([id, label]) => (
                        <button key={id} onClick={() => setAnalisisFinTab(id)}
                          style={{
                            background: analisisFinTab === id ? "#3b82f6" : "var(--bg-deep)",
                            color: analisisFinTab === id ? "#ffffff" : "var(--muted)",
                            border: "none", borderRadius: 8, padding: "5px 16px",
                            cursor: "pointer", fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 12,
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
                          <th style={{ textAlign: "left", color: "var(--muted-2)", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>Métrica</th>
                          {QLABELS.map(q => <th key={q} style={{ textAlign: "right", color: "var(--muted-2)", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>{q}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {fin.table.map(({ label, val, unit }) => {
                          const qBar = fin.bars.find(b => b.label.toLowerCase().includes(label.toLowerCase().split(" ")[0].toLowerCase()));
                          const qVals = qBar?.vals;
                          const qFmt = qBar?.fmt ?? (v => v?.toFixed(1));
                          return (
                            <tr key={label}>
                              <td style={{ color: "var(--muted)", fontSize: 12, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>{label}</td>
                              {QLABELS.map((_, qi) => (
                                <td key={qi} style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12, color: "#ffffff", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                                  {qVals?.[qi] != null ? `${qFmt(qVals[qi])}${unit ?? ""}` : val ?? "—"}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* ── SEC EDGAR: financieros oficiales, descargables ── */}
                  <div className="dark-panel" style={{ background: "var(--bg-deep)", borderRadius: 16, padding: "20px 24px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
                      <FileText aria-hidden="true" color="#7fe3a0" size={15} />
                      <div style={{ fontFamily: "var(--font-sans)", fontSize: 10, fontWeight: 700, color: "var(--muted-2)", letterSpacing: "0.12em", textTransform: "uppercase" }}>
                        Financieros oficiales · SEC EDGAR
                      </div>
                      {analisisEdgarLoading && <Spinner size={13} />}
                      {analisisEdgar?.available && (
                        <Button
                          className="button-sm"
                          icon={<Download aria-hidden="true" size={13} />}
                          onClick={() => downloadEdgarCsv(analisisEdgar)}
                          size="sm"
                          style={{ marginLeft: "auto" }}
                          variant="secondary"
                        >Descargar CSV</Button>
                      )}
                    </div>

                    {!analisisEdgarLoading && analisisEdgar?.available === false && (
                      <div style={{ fontSize: 12, color: "#8fa3b8", lineHeight: 1.6 }}>
                        {analisisEdgar.error ?? "No disponible para este ticker."}
                      </div>
                    )}
                    {!analisisEdgarLoading && !analisisEdgar && (
                      <div style={{ fontSize: 12, color: "#8fa3b8" }}>Consultando el expediente de la SEC…</div>
                    )}
                    {analisisEdgar?.available && (
                      <>
                        <div style={{ fontSize: 11, color: "#8fa3b8", marginBottom: 14 }}>
                          {analisisEdgar.name} · CIK {analisisEdgar.cik} · reportes 10-K anuales, directo de{" "}
                          <a href={analisisEdgar.source} rel="noreferrer" style={{ color: "var(--accent)", fontWeight: 600 }} target="_blank">data.sec.gov</a>
                        </div>
                        <div className="table-scroll">
                          <table style={{ width: "100%", borderCollapse: "collapse" }}>
                            <thead>
                              <tr>
                                <th style={{ textAlign: "left", color: "var(--muted-2)", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", padding: "6px 10px 6px 0", borderBottom: "1px solid var(--border)" }}>Concepto</th>
                                {[...new Set(analisisEdgar.series.flatMap(s => s.values.map(v => v.fy)))].sort().map(fy => (
                                  <th key={fy} style={{ textAlign: "right", color: "var(--muted-2)", fontSize: 10, fontWeight: 600, padding: "6px 10px", borderBottom: "1px solid var(--border)" }}>FY{fy}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {analisisEdgar.series.map((s) => {
                                const years = [...new Set(analisisEdgar.series.flatMap(x => x.values.map(v => v.fy)))].sort();
                                const byYear = Object.fromEntries(s.values.map(v => [v.fy, v.val]));
                                const isPerShare = s.unit === "USD/shares";
                                return (
                                  <tr key={s.concept}>
                                    <td style={{ color: "var(--muted)", fontSize: 12, padding: "8px 10px 8px 0", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>{s.label}</td>
                                    {years.map((y) => (
                                      <td key={y} style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12, color: "#ffffff", padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>
                                        {byYear[y] != null ? (isPerShare ? `$${byYear[y].toFixed(2)}` : `$${(byYear[y] / 1e6).toLocaleString("en-US", { maximumFractionDigits: 1 })}M`) : "—"}
                                      </td>
                                    ))}
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </div>

                  {/* ── NOTICIAS ── */}
                  <div className="dark-panel" style={{ background: "var(--bg-deep)", borderRadius: 16, padding: "20px 24px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                      <div style={{ fontFamily: "var(--font-sans)", fontSize: 10, fontWeight: 700, color: "var(--muted-2)", letterSpacing: "0.12em", textTransform: "uppercase" }}>
                        Noticias · {ticker}
                      </div>
                      {analisisNewsLoading && <Spinner size={14} />}
                    </div>
                    {analisisNews.length > 0 ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {analisisNews.slice(0, 5).map((item, i) => {
                          const sentColor = item.sentiment === "positive" ? "var(--positive)" : item.sentiment === "negative" ? "var(--negative)" : "var(--warning)";
                          return (
                            <div key={i} style={{
                              background: "var(--bg-deep)", borderRadius: 12, padding: "14px 16px",
                              borderLeft: `3px solid ${sentColor}`,
                              cursor: item.url ? "pointer" : "default",
                            }}
                              onClick={() => item.url && window.open(item.url, "_blank", "noopener,noreferrer")}
                              {...(item.url ? {
                                role: "link", tabIndex: 0,
                                onKeyDown: (e) => { if (e.key === "Enter") window.open(item.url, "_blank", "noopener,noreferrer"); },
                              } : {})}
                            >
                              <div style={{ fontWeight: 700, fontSize: 13, color: "#ffffff", marginBottom: 5, lineHeight: 1.4 }}>{item.title}</div>
                              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                                <span style={{ fontSize: 11, color: "var(--muted-2)" }}>{item.publisher ?? item.source ?? ""}</span>
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
    </div>
  );
}
