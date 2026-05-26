import { useState, useEffect, useRef } from "react";

const ASSETS = [
  { ticker: "BBAJIOO.MX", name: "Banco del Bajío", weight: 0.0088, exchange: "XMEX" },
  { ticker: "CEMEXCPO.MX", name: "CEMEX", weight: 0.1069, exchange: "XMEX" },
  { ticker: "AMX", name: "América Móvil", weight: 0.0956, exchange: "NYSE" },
  { ticker: "GFAMSAA.MX", name: "Grupo Famsa", weight: 0.0928, exchange: "XMEX" },
  { ticker: "GFNORTEO.MX", name: "Banorte", weight: 0.0889, exchange: "XMEX" },
  { ticker: "GMEXICOB.MX", name: "Grupo México", weight: 0.0728, exchange: "XMEX" },
  { ticker: "WALMEX.MX", name: "Walmart México", weight: 0.0686, exchange: "XMEX" },
  { ticker: "GAPB.MX", name: "Pacific Airport Group", weight: 0.0414, exchange: "XMEX" },
  { ticker: "SIGMAFA.MX", name: "Sigma Foods", weight: 0.0352, exchange: "XMEX" },
  { ticker: "ALSEA.MX", name: "Alsea", weight: 0.0296, exchange: "XMEX" },
  { ticker: "NEMAKA.MX", name: "Nemak", weight: 0.0284, exchange: "XMEX" },
  { ticker: "VOLARA.MX", name: "Volaris", weight: 0.0284, exchange: "XMEX" },
  { ticker: "LABB.MX", name: "Genomma Lab", weight: 0.0273, exchange: "XMEX" },
  { ticker: "HERDEZ.MX", name: "Grupo Herdez", weight: 0.0264, exchange: "XMEX" },
  { ticker: "ALPEKA.MX", name: "Alpek", weight: 0.0250, exchange: "XMEX" },
  { ticker: "KIMBERA.MX", name: "Kimberly-Clark MX", weight: 0.0240, exchange: "XMEX" },
  { ticker: "ASURB.MX", name: "Southeast Airport Group", weight: 0.0238, exchange: "XMEX" },
  { ticker: "AC.MX", name: "Arca Continental", weight: 0.0196, exchange: "XMEX" },
  { ticker: "GCC.MX", name: "GCC", weight: 0.0194, exchange: "XMEX" },
  { ticker: "ORBIA.MX", name: "Orbia", weight: 0.0193, exchange: "XMEX" },
  { ticker: "LIVEPOLC-1.MX", name: "El Puerto de Liverpool", weight: 0.0181, exchange: "XMEX" },
  { ticker: "KOFUBL.MX", name: "Coca-Cola FEMSA", weight: 0.0148, exchange: "XMEX" },
  { ticker: "TRAXIONA.MX", name: "Grupo Traxion", weight: 0.0131, exchange: "XMEX" },
  { ticker: "OMAB.MX", name: "Central North Airport", weight: 0.0118, exchange: "XMEX" },
  { ticker: "GENTERA.MX", name: "Gentera", weight: 0.0082, exchange: "XMEX" },
  { ticker: "PINFRA.MX", name: "PINFRA", weight: 0.0065, exchange: "XMEX" },
  { ticker: "VTMX", name: "Vesta Real Estate", weight: 0.0058, exchange: "NYSE" },
  { ticker: "BOLSAA.MX", name: "BMV", weight: 0.0056, exchange: "XMEX" },
  { ticker: "BIMBOA.MX", name: "Grupo Bimbo", weight: 0.0052, exchange: "XMEX" },
  { ticker: "ANET", name: "Arista Networks", weight: 0.0001, exchange: "NYSE" },
];

const COLORS = [
  "#00d4aa","#ff6b35","#4ecdc4","#ffe66d","#a8edea",
  "#fed9b7","#f0b27a","#7fb3d3","#a9cce3","#d2b4de",
  "#a3e4d7","#f9e79f","#fadbd8","#d5f5e3","#d6eaf8",
  "#fdebd0","#e8daef","#d5d8dc","#abebc6","#f5b7b1",
  "#82e0aa","#85c1e9","#f0e68c","#dda0dd","#98fb98",
  "#87ceeb","#ffa07a","#20b2aa","#778899","#b0c4de"
];

function normalRandom() {
  let u = 0, v = 0;
  while(u === 0) u = Math.random();
  while(v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function quantile(arr, q) {
  const sorted = [...arr].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if ((base + 1) < sorted.length) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  } else {
    return sorted[base];
  }
}

// Generate synthetic but realistic historical data (252 trading days)
function generateHistoricalData(assets) {
  const days = 252;
  const dates = [];
  const today = new Date();
  for (let i = days; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    if (d.getDay() !== 0 && d.getDay() !== 6) {
      dates.push(d.toISOString().split('T')[0]);
    }
  }

  // Sector-based correlations and realistic parameters
  const sectorParams = {
    bank: { mu: 0.0003, sigma: 0.018 },
    cement: { mu: 0.0002, sigma: 0.022 },
    telecom: { mu: 0.0004, sigma: 0.015 },
    retail: { mu: 0.0003, sigma: 0.016 },
    mining: { mu: 0.0005, sigma: 0.020 },
    airport: { mu: 0.0004, sigma: 0.017 },
    food: { mu: 0.0003, sigma: 0.013 },
    airline: { mu: 0.0001, sigma: 0.028 },
    pharma: { mu: 0.0002, sigma: 0.019 },
    construction: { mu: 0.0003, sigma: 0.017 },
    tech: { mu: 0.0008, sigma: 0.025 },
  };

  const assetParams = [
    sectorParams.bank, sectorParams.cement, sectorParams.telecom, sectorParams.retail,
    sectorParams.bank, sectorParams.mining, sectorParams.retail, sectorParams.airport,
    sectorParams.food, sectorParams.food, sectorParams.mining, sectorParams.airline,
    sectorParams.pharma, sectorParams.food, sectorParams.mining, sectorParams.food,
    sectorParams.airport, sectorParams.food, sectorParams.construction, sectorParams.mining,
    sectorParams.retail, sectorParams.food, sectorParams.retail, sectorParams.airport,
    sectorParams.bank, sectorParams.construction, sectorParams.retail, sectorParams.bank,
    sectorParams.food, sectorParams.tech,
  ];

  // Market factor (common to all Mexican stocks)
  const marketFactor = Array.from({ length: dates.length }, () => normalRandom() * 0.01);

  const priceData = assets.map((asset, idx) => {
    const params = assetParams[idx];
    const prices = [100];
    const isNYSE = asset.exchange === 'NYSE';
    const beta = isNYSE ? 0.3 : 0.7 + Math.random() * 0.4;

    for (let i = 1; i < dates.length; i++) {
      const marketReturn = marketFactor[i] * beta;
      const idioReturn = normalRandom() * params.sigma * 0.7;
      const dailyReturn = params.mu + marketReturn + idioReturn;
      const newPrice = prices[prices.length - 1] * (1 + dailyReturn);
      prices.push(Math.max(newPrice, 1));
    }
    return { ticker: asset.ticker, name: asset.name, prices, weight: asset.weight };
  });

  // Calculate daily returns for each asset
  const returns = priceData.map(asset => {
    const rets = [];
    for (let i = 1; i < asset.prices.length; i++) {
      rets.push((asset.prices[i] - asset.prices[i-1]) / asset.prices[i-1]);
    }
    return rets;
  });

  // Calculate portfolio returns
  const portfolioReturns = [];
  for (let i = 0; i < returns[0].length; i++) {
    let pr = 0;
    for (let j = 0; j < returns.length; j++) {
      pr += returns[j][i] * assets[j].weight;
    }
    portfolioReturns.push(pr);
  }

  // Portfolio price series (normalized to 100)
  const portfolioPrices = [100];
  for (const r of portfolioReturns) {
    portfolioPrices.push(portfolioPrices[portfolioPrices.length - 1] * (1 + r));
  }

  // Normalize all prices to base 100
  const normalizedPrices = priceData.map(asset => ({
    ...asset,
    normalizedPrices: asset.prices.map(p => (p / asset.prices[0]) * 100)
  }));

  return {
    dates,
    assets: normalizedPrices,
    portfolioReturns,
    portfolioPrices,
    returns,
  };
}

function calculateVaR(returns, weights, confidenceLevel = 0.95) {
  // Portfolio historical returns
  const portReturns = [];
  for (let i = 0; i < returns[0].length; i++) {
    let pr = 0;
    for (let j = 0; j < returns.length; j++) {
      pr += returns[j][i] * weights[j];
    }
    portReturns.push(pr);
  }

  const historicalVaR = -quantile(portReturns, 1 - confidenceLevel);

  // Parametric VaR
  const mean = portReturns.reduce((a, b) => a + b, 0) / portReturns.length;
  const variance = portReturns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / portReturns.length;
  const stdDev = Math.sqrt(variance);
  const zScore = 1.645; // 95% confidence
  const parametricVaR = -(mean - zScore * stdDev);

  // CVaR (Expected Shortfall)
  const sorted = [...portReturns].sort((a, b) => a - b);
  const cutoff = Math.floor((1 - confidenceLevel) * sorted.length);
  const cvar = -sorted.slice(0, cutoff).reduce((a, b) => a + b, 0) / cutoff;

  // 10-day VaR
  const var10 = historicalVaR * Math.sqrt(10);

  return {
    historicalVaR: (historicalVaR * 100).toFixed(3),
    parametricVaR: (parametricVaR * 100).toFixed(3),
    cvar: (cvar * 100).toFixed(3),
    var10: (var10 * 100).toFixed(3),
    stdDev: (stdDev * 100).toFixed(3),
    mean: (mean * 100).toFixed(4),
    portReturns,
    sorted,
  };
}

// Tiny sparkline SVG component
function Sparkline({ prices, color }) {
  if (!prices || prices.length < 2) return null;
  const w = 80, h = 28;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const pts = prices.map((p, i) => {
    const x = (i / (prices.length - 1)) * w;
    const y = h - ((p - min) / range) * h;
    return `${x},${y}`;
  }).join(' ');
  const trend = prices[prices.length - 1] >= prices[0];
  const lineColor = trend ? '#00d4aa' : '#ff4444';
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={lineColor} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

// Main chart component
function PortfolioChart({ data, showPortfolio, selectedAssets }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!data || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const W = rect.width;
    const H = rect.height;

    ctx.clearRect(0, 0, W, H);

    const pad = { top: 20, right: 20, bottom: 40, left: 55 };
    const chartW = W - pad.left - pad.right;
    const chartH = H - pad.top - pad.bottom;

    // Gather all visible series
    const series = [];
    if (showPortfolio) {
      series.push({ prices: data.portfolioPrices, color: '#ffffff', label: 'Fondo', lineWidth: 2.5 });
    }
    selectedAssets.forEach(idx => {
      const a = data.assets[idx];
      series.push({ prices: a.normalizedPrices, color: COLORS[idx % COLORS.length], label: a.name, lineWidth: 1 });
    });

    if (series.length === 0) return;

    // Find range
    let allVals = series.flatMap(s => s.prices);
    const minV = Math.min(...allVals);
    const maxV = Math.max(...allVals);
    const range = maxV - minV || 1;

    const toX = (i) => pad.left + (i / (data.dates.length - 1)) * chartW;
    const toY = (v) => pad.top + chartH - ((v - minV) / range) * chartH;

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const y = pad.top + (i / 5) * chartH;
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + chartW, y); ctx.stroke();
      const val = (maxV - (i / 5) * range).toFixed(1);
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = '10px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(val, pad.left - 6, y + 4);
    }

    // X axis labels (quarterly)
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    const step = Math.floor(data.dates.length / 4);
    for (let i = 0; i <= 4; i++) {
      const di = Math.min(i * step, data.dates.length - 1);
      const x = toX(di);
      ctx.fillText(data.dates[di].slice(2, 10), x, pad.top + chartH + 18);
    }

    // Draw series
    series.forEach(s => {
      ctx.beginPath();
      s.prices.forEach((p, i) => {
        const x = toX(i);
        const y = toY(p);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.lineWidth;
      ctx.globalAlpha = s.lineWidth > 1 ? 1 : 0.6;
      ctx.stroke();
      ctx.globalAlpha = 1;
    });

    // Baseline 100
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    const y100 = toY(100);
    if (y100 >= pad.top && y100 <= pad.top + chartH) {
      ctx.beginPath(); ctx.moveTo(pad.left, y100); ctx.lineTo(pad.left + chartW, y100); ctx.stroke();
    }
    ctx.setLineDash([]);

  }, [data, showPortfolio, selectedAssets]);

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />;
}

// VaR distribution histogram
function VarHistogram({ varData }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!varData || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const W = rect.width;
    const H = rect.height;
    ctx.clearRect(0, 0, W, H);

    const returns = varData.portReturns;
    const bins = 40;
    const min = Math.min(...returns);
    const max = Math.max(...returns);
    const binW = (max - min) / bins;
    const counts = new Array(bins).fill(0);
    returns.forEach(r => {
      const b = Math.min(Math.floor((r - min) / binW), bins - 1);
      counts[b]++;
    });

    const pad = { top: 15, right: 15, bottom: 35, left: 40 };
    const cW = W - pad.left - pad.right;
    const cH = H - pad.top - pad.bottom;
    const maxCount = Math.max(...counts);
    const varLine = -parseFloat(varData.historicalVaR) / 100;

    const toX = (v) => pad.left + ((v - min) / (max - min)) * cW;
    const toH = (c) => (c / maxCount) * cH;

    // Draw bars
    counts.forEach((c, i) => {
      const x = pad.left + (i / bins) * cW;
      const bw = cW / bins - 0.5;
      const bh = toH(c);
      const binCenter = min + (i + 0.5) * binW;
      const isLoss = binCenter < varLine;
      ctx.fillStyle = isLoss ? 'rgba(255,80,80,0.7)' : 'rgba(0,212,170,0.5)';
      ctx.fillRect(x, pad.top + cH - bh, bw, bh);
    });

    // VaR line
    const vx = toX(varLine);
    ctx.strokeStyle = '#ff4444';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    ctx.moveTo(vx, pad.top);
    ctx.lineTo(vx, pad.top + cH);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#ff6666';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`VaR 95%`, vx, pad.top - 2);

    // X axis
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    const xTicks = 5;
    for (let i = 0; i <= xTicks; i++) {
      const v = min + (i / xTicks) * (max - min);
      const x = pad.left + (i / xTicks) * cW;
      ctx.fillText((v * 100).toFixed(1) + '%', x, pad.top + cH + 14);
    }

    // Y axis
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (i / 4) * cH;
      const val = Math.round(maxCount * (1 - i / 4));
      ctx.fillText(val, pad.left - 4, y + 4);
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + cW, y);
      ctx.stroke();
    }

  }, [varData]);

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />;
}

export default function App() {
  const [data, setData] = useState(null);
  const [varData, setVarData] = useState(null);
  const [showPortfolio, setShowPortfolio] = useState(true);
  const [selectedAssets, setSelectedAssets] = useState([]);
  const [activeTab, setActiveTab] = useState('chart');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const generated = generateHistoricalData(ASSETS);
    setData(generated);
    const weights = ASSETS.map(a => a.weight);
    const vd = calculateVaR(generated.returns, weights);
    setVarData(vd);
  }, []);

  const toggleAsset = (idx) => {
    setSelectedAssets(prev =>
      prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx]
    );
  };

  const toggleAll = () => {
    if (selectedAssets.length === ASSETS.length) {
      setSelectedAssets([]);
    } else {
      setSelectedAssets(ASSETS.map((_, i) => i));
    }
  };

  const filteredAssets = ASSETS.map((a, i) => ({ ...a, idx: i }))
    .filter(a => a.name.toLowerCase().includes(search.toLowerCase()) || a.ticker.toLowerCase().includes(search.toLowerCase()));

  const portfolioReturn = data
    ? ((data.portfolioPrices[data.portfolioPrices.length - 1] / 100 - 1) * 100).toFixed(2)
    : null;

  return (
    <div style={{
      fontFamily: "'JetBrains Mono', 'Courier New', monospace",
      background: '#0a0e1a',
      minHeight: '100vh',
      color: '#e0e6f0',
      padding: '0',
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;600;700&family=Syne:wght@400;600;800&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #0a0e1a; }
        ::-webkit-scrollbar-thumb { background: #1e2d4a; border-radius: 2px; }
        .asset-row:hover { background: rgba(0,212,170,0.06) !important; }
        .tab-btn { transition: all 0.2s; }
        .tab-btn:hover { opacity: 0.8; }
        .toggle-btn { transition: all 0.15s; cursor: pointer; }
        .toggle-btn:hover { transform: scale(1.05); }
      `}</style>

      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #0d1526 0%, #0a0e1a 100%)',
        borderBottom: '1px solid rgba(0,212,170,0.15)',
        padding: '20px 32px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '12px',
      }}>
        <div>
          <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: '22px', color: '#00d4aa', letterSpacing: '-0.5px' }}>
            FONDO ▸ ANÁLISIS DE PORTAFOLIO
          </div>
          <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', marginTop: '3px', letterSpacing: '1px' }}>
            30 ACTIVOS · BMV + NYSE · 252 DÍAS HÁBILES
          </div>
        </div>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          {portfolioReturn !== null && (
            <div style={{
              background: parseFloat(portfolioReturn) >= 0 ? 'rgba(0,212,170,0.12)' : 'rgba(255,68,68,0.12)',
              border: `1px solid ${parseFloat(portfolioReturn) >= 0 ? '#00d4aa' : '#ff4444'}`,
              borderRadius: '6px',
              padding: '8px 16px',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', letterSpacing: '1px' }}>RENDIMIENTO FONDO</div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: parseFloat(portfolioReturn) >= 0 ? '#00d4aa' : '#ff4444' }}>
                {parseFloat(portfolioReturn) >= 0 ? '+' : ''}{portfolioReturn}%
              </div>
            </div>
          )}
          {varData && (
            <div style={{
              background: 'rgba(255,68,68,0.1)',
              border: '1px solid rgba(255,68,68,0.4)',
              borderRadius: '6px',
              padding: '8px 16px',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', letterSpacing: '1px' }}>VaR 95% (1-DÍA)</div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#ff6b6b' }}>-{varData.historicalVaR}%</div>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', height: 'calc(100vh - 85px)', overflow: 'hidden' }}>

        {/* Sidebar */}
        <div style={{
          width: '280px',
          minWidth: '280px',
          borderRight: '1px solid rgba(255,255,255,0.06)',
          background: '#080c18',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          {/* Search */}
          <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar activo..."
              style={{
                width: '100%',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '5px',
                color: '#e0e6f0',
                padding: '7px 10px',
                fontSize: '11px',
                fontFamily: 'inherit',
                outline: 'none',
              }}
            />
          </div>

          {/* Controls */}
          <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              className="toggle-btn"
              onClick={() => setShowPortfolio(v => !v)}
              style={{
                background: showPortfolio ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${showPortfolio ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.1)'}`,
                borderRadius: '4px',
                color: showPortfolio ? '#fff' : 'rgba(255,255,255,0.4)',
                padding: '4px 10px',
                fontSize: '10px',
                fontFamily: 'inherit',
                letterSpacing: '0.5px',
              }}
            >
              ▬ FONDO
            </button>
            <button
              className="toggle-btn"
              onClick={toggleAll}
              style={{
                background: selectedAssets.length === ASSETS.length ? 'rgba(0,212,170,0.15)' : 'rgba(0,212,170,0.04)',
                border: `1px solid rgba(0,212,170,${selectedAssets.length === ASSETS.length ? 0.5 : 0.15})`,
                borderRadius: '4px',
                color: '#00d4aa',
                padding: '4px 10px',
                fontSize: '10px',
                fontFamily: 'inherit',
                letterSpacing: '0.5px',
              }}
            >
              {selectedAssets.length === ASSETS.length ? 'OCULTAR TODO' : 'VER TODO'}
            </button>
          </div>

          {/* Asset list */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
            {filteredAssets.map(({ idx, name, ticker, weight }) => {
              const isSelected = selectedAssets.includes(idx);
              const ret = data
                ? ((data.assets[idx].normalizedPrices.at(-1) / 100 - 1) * 100).toFixed(1)
                : null;
              return (
                <div
                  key={idx}
                  className="asset-row"
                  onClick={() => toggleAsset(idx)}
                  style={{
                    padding: '9px 14px',
                    cursor: 'pointer',
                    borderLeft: `3px solid ${isSelected ? COLORS[idx % COLORS.length] : 'transparent'}`,
                    background: isSelected ? `${COLORS[idx % COLORS.length]}12` : 'transparent',
                    transition: 'all 0.15s',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  <div style={{
                    width: '10px', height: '10px', borderRadius: '2px',
                    background: isSelected ? COLORS[idx % COLORS.length] : 'rgba(255,255,255,0.12)',
                    flexShrink: 0,
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '10px', fontWeight: 600, color: isSelected ? '#fff' : 'rgba(255,255,255,0.6)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {name}
                    </div>
                    <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.25)', marginTop: '1px' }}>
                      {(weight * 100).toFixed(2)}%
                    </div>
                  </div>
                  {data && (
                    <div>
                      <Sparkline prices={data.assets[idx].normalizedPrices} color={COLORS[idx % COLORS.length]} />
                      <div style={{ fontSize: '9px', textAlign: 'right', color: parseFloat(ret) >= 0 ? '#00d4aa' : '#ff6b6b', marginTop: '1px' }}>
                        {parseFloat(ret) >= 0 ? '+' : ''}{ret}%
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Main content */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Tabs */}
          <div style={{
            display: 'flex',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            padding: '0 24px',
            background: '#09101f',
            gap: '4px',
          }}>
            {[['chart', '📈 GRÁFICA'], ['var', '⚠️ VaR'], ['weights', '🎯 PONDERACIONES']].map(([id, label]) => (
              <button
                key={id}
                className="tab-btn"
                onClick={() => setActiveTab(id)}
                style={{
                  background: 'none',
                  border: 'none',
                  borderBottom: activeTab === id ? '2px solid #00d4aa' : '2px solid transparent',
                  color: activeTab === id ? '#00d4aa' : 'rgba(255,255,255,0.35)',
                  padding: '14px 18px 12px',
                  fontSize: '11px',
                  fontFamily: 'inherit',
                  fontWeight: 600,
                  letterSpacing: '0.8px',
                  cursor: 'pointer',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Chart tab */}
          {activeTab === 'chart' && (
            <div style={{ flex: 1, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{
                flex: 1,
                background: '#0d1526',
                borderRadius: '10px',
                border: '1px solid rgba(255,255,255,0.06)',
                padding: '12px',
                minHeight: 0,
              }}>
                {data ? (
                  <PortfolioChart data={data} showPortfolio={showPortfolio} selectedAssets={selectedAssets} />
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'rgba(255,255,255,0.3)', fontSize: '12px' }}>
                    Generando datos históricos...
                  </div>
                )}
              </div>
              <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.25)', letterSpacing: '0.5px', textAlign: 'center' }}>
                Base 100 · 252 días hábiles · Selecciona activos en el panel izquierdo
              </div>
            </div>
          )}

          {/* VaR tab */}
          {activeTab === 'var' && varData && (
            <div style={{ flex: 1, padding: '20px 24px', overflowY: 'auto' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', marginBottom: '24px' }}>
                {[
                  { label: 'VaR Histórico 95% (1d)', value: `-${varData.historicalVaR}%`, sub: 'Percentil 5% de retornos históricos', color: '#ff6b6b' },
                  { label: 'VaR Paramétrico 95% (1d)', value: `-${varData.parametricVaR}%`, sub: 'Normal: μ - 1.645σ', color: '#ff9f43' },
                  { label: 'CVaR / Expected Shortfall', value: `-${varData.cvar}%`, sub: 'Pérdida esperada en el 5% peor', color: '#ee5a24' },
                  { label: 'VaR Histórico 95% (10d)', value: `-${varData.var10}%`, sub: 'Escalado por √10', color: '#fd79a8' },
                  { label: 'Volatilidad Diaria (σ)', value: `${varData.stdDev}%`, sub: 'Desviación estándar del portafolio', color: '#a29bfe' },
                  { label: 'Retorno Medio Diario', value: `${parseFloat(varData.mean) >= 0 ? '+' : ''}${varData.mean}%`, sub: 'Media aritmética', color: '#00d4aa' },
                ].map(({ label, value, sub, color }) => (
                  <div key={label} style={{
                    background: '#0d1526',
                    border: `1px solid ${color}30`,
                    borderRadius: '10px',
                    padding: '18px',
                  }}>
                    <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', letterSpacing: '1px', marginBottom: '8px' }}>{label.toUpperCase()}</div>
                    <div style={{ fontSize: '28px', fontWeight: 700, color, fontFamily: "'Syne', sans-serif" }}>{value}</div>
                    <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.25)', marginTop: '6px' }}>{sub}</div>
                  </div>
                ))}
              </div>

              {/* Histogram */}
              <div style={{
                background: '#0d1526',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: '10px',
                padding: '16px',
                height: '220px',
              }}>
                <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)', letterSpacing: '1px', marginBottom: '8px' }}>
                  DISTRIBUCIÓN DE RETORNOS DIARIOS DEL PORTAFOLIO
                </div>
                <div style={{ height: '170px' }}>
                  <VarHistogram varData={varData} />
                </div>
              </div>

              {/* Methodology note */}
              <div style={{
                marginTop: '14px',
                background: 'rgba(0,212,170,0.05)',
                border: '1px solid rgba(0,212,170,0.12)',
                borderRadius: '8px',
                padding: '14px 18px',
                fontSize: '11px',
                color: 'rgba(255,255,255,0.45)',
                lineHeight: '1.7',
              }}>
                <span style={{ color: '#00d4aa', fontWeight: 600 }}>METODOLOGÍA ▸ </span>
                VaR Histórico calculado como el percentil 5% de la distribución de retornos diarios ponderados del portafolio (252 observaciones).
                VaR Paramétrico asume distribución normal: VaR = −(μ − 1.645σ). CVaR = promedio de pérdidas más allá del umbral VaR. VaR a 10 días escalado por raíz cuadrada del tiempo (√10).
                Todos los cálculos usan las ponderaciones del fondo.
              </div>
            </div>
          )}

          {/* Weights tab */}
          {activeTab === 'weights' && (
            <div style={{ flex: 1, padding: '20px 24px', overflowY: 'auto' }}>
              <div style={{ marginBottom: '16px', fontSize: '11px', color: 'rgba(255,255,255,0.3)', letterSpacing: '1px' }}>
                COMPOSICIÓN DEL FONDO — 30 ACTIVOS
              </div>
              {/* Bar chart */}
              <div style={{
                background: '#0d1526',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: '10px',
                padding: '16px 20px',
                marginBottom: '16px',
              }}>
                {[...ASSETS].sort((a, b) => b.weight - a.weight).map((asset, rankIdx) => {
                  const idx = ASSETS.indexOf(asset);
                  const pct = (asset.weight * 100).toFixed(2);
                  const ret = data ? ((data.assets[idx].normalizedPrices.at(-1) / 100 - 1) * 100).toFixed(1) : null;
                  return (
                    <div key={asset.ticker} style={{ marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{ width: '130px', fontSize: '10px', color: 'rgba(255,255,255,0.55)', textAlign: 'right', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {asset.name}
                      </div>
                      <div style={{ flex: 1, background: 'rgba(255,255,255,0.05)', borderRadius: '3px', height: '14px', overflow: 'hidden' }}>
                        <div style={{
                          height: '100%',
                          width: `${(asset.weight / 0.1069) * 100}%`,
                          background: `linear-gradient(90deg, ${COLORS[idx % COLORS.length]}cc, ${COLORS[idx % COLORS.length]}66)`,
                          borderRadius: '3px',
                          transition: 'width 0.5s ease',
                        }} />
                      </div>
                      <div style={{ width: '48px', fontSize: '10px', fontWeight: 600, color: COLORS[idx % COLORS.length], flexShrink: 0, textAlign: 'right' }}>
                        {pct}%
                      </div>
                      {ret !== null && (
                        <div style={{ width: '52px', fontSize: '10px', color: parseFloat(ret) >= 0 ? '#00d4aa' : '#ff6b6b', flexShrink: 0, textAlign: 'right' }}>
                          {parseFloat(ret) >= 0 ? '+' : ''}{ret}%
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
