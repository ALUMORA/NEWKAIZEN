# KAIZEN — Investment Platform

Plataforma de análisis de inversiones con datos en tiempo real de Yahoo Finance.

## Stack

- **Frontend**: React 19 + Vite
- **Backend**: Python (servidor local con yfinance)

## Requisitos

- Node.js 18+
- Python 3.9+

## Instalación y uso

### 1. Backend (Python)

```bash
pip install -r requirements.txt
python backend.py
```

El backend corre en `http://localhost:8002`

### 2. Frontend (React)

```bash
npm install
npm run dev
```

La app corre en `http://localhost:5173`

> Ambos deben estar corriendo al mismo tiempo.

## Funcionalidades

- **Portfolio** — Composición del portafolio (donut chart), rebalanceo con sliders, métricas P&L y Sharpe
- **Noticias** — Panorama de mercados globales, Style Box, Fear & Greed, noticias en tiempo real
- **ML Screener** — Score cuantitativo 1–10 en 6 dimensiones por acción
- **Sharpe Optimizer** — Optimización Monte Carlo (100k simulaciones)
- **Analytics vs SPY** — Correlaciones, backtesting y simulación Monte Carlo
- **Análisis** — Página de detalle por acción: gráfica histórica, métricas fundamentales, noticias
- **Insiders** — Transacciones de directivos
- **FIBRA Screener** — FIBRAs mexicanas
- **Fórmula Mágica** — Ranking Greenblatt (EY + ROC)

## Estructura

```
fondo-app/
├── src/
│   ├── App.jsx        # Componente principal
│   ├── main.jsx
│   └── index.css
├── public/
├── backend.py         # Servidor Python (puerto 8002)
├── package.json
├── requirements.txt
└── vite.config.js
```
