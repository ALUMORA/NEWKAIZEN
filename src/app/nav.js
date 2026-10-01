// Arquitectura de información de la app (brief, sección "Shell and IA"). Es la única fuente del
// árbol de navegación: la barra lateral, la barra inferior de móvil, el menú "Más" y el grupo
// "Ir a" de la paleta de comandos salen de aquí. Toda ruta viene de PATHS (src/app/paths.js).
import {
  Activity,
  ArrowLeftRight,
  Banknote,
  Bell,
  BookMarked,
  BookOpen,
  Briefcase,
  Building2,
  Calculator,
  CalendarClock,
  CalendarDays,
  ChartNoAxesCombined,
  ChartSpline,
  ClipboardList,
  Coins,
  Columns3,
  Eye,
  Factory,
  Gauge,
  Globe,
  HandCoins,
  Handshake,
  History,
  Landmark,
  LayoutDashboard,
  ListFilter,
  Newspaper,
  Percent,
  Receipt,
  Scale,
  ScanSearch,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Wrench,
} from 'lucide-react'
import { PATHS } from './paths.js'

/**
 * @typedef {{ id: string, label: string, to: string, icon: import('react').ComponentType<any>, keywords?: string[] }} NavItem
 * @typedef {{ id: string, label: string, icon: import('react').ComponentType<any>, items: NavItem[] }} NavSection
 */

/** Secciones de la barra lateral, en orden. @type {readonly NavSection[]} */
export const NAV_SECTIONS = Object.freeze([
  {
    id: 'mercados',
    label: 'Mercados',
    icon: ChartNoAxesCombined,
    items: [
      { id: 'panorama', label: 'Panorama', to: PATHS.markets, icon: LayoutDashboard, keywords: ['mercados', 'índices', 'resumen'] },
      { id: 'resumen-dia', label: 'Resumen del día', to: PATHS.marketsBriefing, icon: ClipboardList, keywords: ['imprimir', 'terminal', 'pdf'] },
      { id: 'mexico', label: 'México', to: PATHS.marketsMexico, icon: Landmark, keywords: ['banxico', 'inflación', 'tiie'] },
      { id: 'tasas', label: 'Tasas y curvas', to: PATHS.marketsRates, icon: ChartSpline, keywords: ['curva', 'bonos m', 'tesoro', 'expectativas'] },
      { id: 'tipo-de-cambio', label: 'Tipo de cambio', to: PATHS.marketsFx, icon: Banknote, keywords: ['dólar', 'peso', 'fix', 'cruces'] },
      { id: 'economia', label: 'Economía', to: PATHS.marketsEconomy, icon: Globe, keywords: ['pib', 'inflación', 'empleo', 'países'] },
      { id: 'calendario', label: 'Calendario', to: PATHS.marketsCalendar, icon: CalendarDays, keywords: ['publicaciones', 'banxico', 'fed', 'indicadores'] },
      { id: 'movimientos-dia', label: 'Movimientos del día', to: PATHS.marketsMovers, icon: Activity, keywords: ['suben', 'bajan', 'más operadas', 'sectores'] },
      { id: 'cetes', label: 'CETES', to: PATHS.marketsCetes, icon: Percent, keywords: ['calculadora', 'tasa', 'bonos'] },
      { id: 'noticias', label: 'Noticias', to: PATHS.marketsNews, icon: Newspaper, keywords: ['titulares'] },
    ],
  },
  {
    id: 'portafolio',
    label: 'Mi portafolio',
    icon: Briefcase,
    items: [
      { id: 'resumen', label: 'Resumen', to: PATHS.portfolio, icon: Briefcase, keywords: ['portafolio', 'posiciones'] },
      { id: 'movimientos', label: 'Movimientos', to: PATHS.portfolioTransactions, icon: ArrowLeftRight, keywords: ['operaciones', 'historial'] },
      { id: 'rendimiento', label: 'Rendimiento', to: PATHS.portfolioPerformance, icon: TrendingUp },
      { id: 'riesgo', label: 'Riesgo', to: PATHS.portfolioRisk, icon: ShieldAlert, keywords: ['volatilidad', 'caída'] },
      { id: 'rebalanceo', label: 'Rebalanceo', to: PATHS.portfolioRebalance, icon: Scale, keywords: ['pesos objetivo'] },
      { id: 'agenda', label: 'Agenda', to: PATHS.portfolioAgenda, icon: CalendarClock, keywords: ['reportes', 'dividendos', 'temporada'] },
      { id: 'rayos-x', label: 'Rayos X', to: PATHS.portfolioXray, icon: ScanSearch, keywords: ['etf', 'exposición', 'sectores', 'traslape'] },
    ],
  },
  {
    id: 'investigar',
    label: 'Investigar',
    icon: Search,
    items: [
      { id: 'buscar', label: 'Buscar emisora', to: PATHS.research, icon: Search, keywords: ['investigar', 'análisis'] },
      { id: 'comparar', label: 'Comparar', to: PATHS.compare, icon: Columns3 },
      { id: 'screener', label: 'Screener de factores', to: PATHS.screener, icon: ListFilter, keywords: ['filtro', 'factores'] },
      { id: 'formula-magica', label: 'Fórmula mágica', to: PATHS.screenerMagic, icon: Sparkles, keywords: ['greenblatt'] },
      { id: 'fibras', label: 'FIBRAs', to: PATHS.screenerFibras, icon: Building2, keywords: ['bienes raíces', 'reit'] },
    ],
  },
  {
    id: 'herramientas',
    label: 'Herramientas',
    icon: Wrench,
    items: [
      { id: 'optimizador', label: 'Optimizador', to: PATHS.toolsOptimizer, icon: Gauge, keywords: ['sharpe', 'frontera'] },
      { id: 'backtest', label: 'Backtest', to: PATHS.toolsBacktest, icon: History, keywords: ['histórico', 'prueba'] },
      { id: 'simulador', label: 'Simulador y metas', to: PATHS.toolsSimulator, icon: Target, keywords: ['monte carlo', 'retiro'] },
    ],
  },
  {
    // El índice /empresas (V5EM) lee esta sección para ligar sus páginas: lo que se agregue aquí
    // aparece allá sin tocar la página.
    id: 'empresas',
    label: 'Empresas',
    icon: Factory,
    items: [
      { id: 'actualizacion', label: 'Actualización e INPC', to: PATHS.businessUpdate, icon: Calculator, keywords: ['inpc', 'factor', 'recargos', 'renta'] },
      { id: 'referencias', label: 'Valores de referencia', to: PATHS.businessReference, icon: BookMarked, keywords: ['uma', 'salario mínimo', 'udi'] },
      { id: 'fx-contable', label: 'Tipo de cambio contable', to: PATHS.businessFx, icon: Receipt, keywords: ['fix', 'dof', 'contabilidad', 'cierre de mes'] },
      { id: 'cobertura', label: 'Forward y presupuesto', to: PATHS.businessHedge, icon: ShieldCheck, keywords: ['forward', 'dólares', 'presupuesto'] },
      { id: 'costo-de-capital', label: 'Costo de capital', to: PATHS.businessCapital, icon: Coins, keywords: ['wacc', 'beta', 'valuación'] },
      { id: 'credito', label: 'Crédito a TIIE', to: PATHS.businessCredit, icon: HandCoins, keywords: ['préstamo', 'amortización', 'tiie', 'sofr'] },
      { id: 'contrapartes', label: 'Contrapartes', to: PATHS.businessCounterparties, icon: Handshake, keywords: ['clientes', 'proveedores', 'salud financiera'] },
    ],
  },
])

/** Entradas sueltas al final de la barra lateral. @type {readonly NavItem[]} */
export const NAV_EXTRA = Object.freeze([
  { id: 'watchlist', label: 'Lista de seguimiento', to: PATHS.watchlist, icon: Eye, keywords: ['watchlist', 'favoritas', 'lista'] },
  { id: 'alertas', label: 'Alertas', to: PATHS.alerts, icon: Bell, keywords: ['avisos', 'precio', 'fix', 'dividendo'] },
  { id: 'aprender', label: 'Aprender', to: PATHS.learn, icon: BookOpen, keywords: ['glosario', 'guías'] },
])

/** Barra inferior de móvil (< 768 px): cuatro destinos y luego "Más". @type {readonly NavItem[]} */
export const BOTTOM_NAV = Object.freeze([
  { id: 'mercados', label: 'Mercados', to: PATHS.markets, icon: ChartNoAxesCombined },
  { id: 'portafolio', label: 'Portafolio', to: PATHS.portfolio, icon: Briefcase },
  { id: 'investigar', label: 'Investigar', to: PATHS.research, icon: Search },
  { id: 'herramientas', label: 'Herramientas', to: PATHS.tools, icon: Wrench },
])

/** Prefijos de ruta que marcan activa cada entrada de la barra inferior. */
const BOTTOM_PREFIXES = Object.freeze({
  mercados: [PATHS.markets],
  portafolio: [PATHS.portfolio],
  investigar: [PATHS.research, PATHS.screener],
  herramientas: [PATHS.tools],
})

/** Todas las entradas navegables en una lista plana (grupo "Ir a" de la paleta). */
export function flatNav() {
  return [
    ...NAV_SECTIONS.flatMap((s) => s.items.map((item) => ({ ...item, section: s.label }))),
    ...NAV_EXTRA.map((item) => ({ ...item, section: '' })),
  ]
}

/** @param {string} pathname */
function clean(pathname) {
  const p = `/${String(pathname ?? '').replace(/^\/+|\/+$/g, '')}`
  return p === '/' ? '/' : p
}

/**
 * La entrada de la barra lateral que corresponde a la ruta actual: la de ruta exacta, o si no
 * hay, la de prefijo más largo (la ficha /investigar/WALMEX.MX marca "Buscar emisora").
 * @param {string} pathname
 * @returns {NavItem | null}
 */
export function activeNavItem(pathname) {
  const path = clean(pathname)
  const all = flatNav()
  const exact = all.find((item) => item.to === path)
  if (exact) return exact
  let best = null
  for (const item of all) {
    if (path.startsWith(`${item.to}/`) && (!best || item.to.length > best.to.length)) best = item
  }
  return best
}

/** Prefijos que no tienen botón propio en la barra inferior y marcan "Más". */
const MORE_PREFIXES = Object.freeze([PATHS.business, PATHS.alerts])

/**
 * Id de la entrada de la barra inferior activa, "mas" para Empresas, Watchlist, Alertas y
 * Aprender, o null.
 * @param {string} pathname
 */
export function activeBottomId(pathname) {
  const path = clean(pathname)
  for (const [id, prefixes] of Object.entries(BOTTOM_PREFIXES)) {
    if (prefixes.some((p) => path === p || path.startsWith(`${p}/`))) return id
  }
  if (MORE_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) return 'mas'
  if (NAV_EXTRA.some((item) => path === item.to || path.startsWith(`${item.to}/`))) return 'mas'
  return null
}
