// La ficha recibe sector, industria, país y descripción tal como los publica Yahoo Finance, en
// inglés (el contrato del API los deja así). Aquí se pasan a español los que tienen catálogo
// (sector, industria y país) y se detecta si la descripción viene en inglés para decirlo en
// pantalla en vez de mezclar idiomas sin aviso.

/** Sector de Yahoo a español de México (el mismo catálogo que kaizen_api/domain/universe.py). */
export const SECTOR_ES = Object.freeze({
  Technology: 'Tecnología',
  Healthcare: 'Salud',
  'Financial Services': 'Servicios financieros',
  Financials: 'Servicios financieros',
  Energy: 'Energía',
  'Consumer Cyclical': 'Consumo discrecional',
  'Consumer Defensive': 'Consumo básico',
  Industrials: 'Industriales',
  Materials: 'Materiales',
  'Basic Materials': 'Materiales',
  'Real Estate': 'Bienes raíces',
  Utilities: 'Servicios públicos',
  'Communication Services': 'Comunicaciones',
})

/** Países que más aparecen en la BMV, el SIC y las bolsas de EE. UU. */
export const COUNTRY_ES = Object.freeze({
  Mexico: 'México',
  'United States': 'Estados Unidos',
  Canada: 'Canadá',
  Brazil: 'Brasil',
  Chile: 'Chile',
  Colombia: 'Colombia',
  Peru: 'Perú',
  Argentina: 'Argentina',
  Spain: 'España',
  'United Kingdom': 'Reino Unido',
  Germany: 'Alemania',
  France: 'Francia',
  Netherlands: 'Países Bajos',
  Switzerland: 'Suiza',
  Ireland: 'Irlanda',
  Japan: 'Japón',
  China: 'China',
  'Hong Kong': 'Hong Kong',
  Taiwan: 'Taiwán',
  'South Korea': 'Corea del Sur',
  India: 'India',
  Israel: 'Israel',
  Luxembourg: 'Luxemburgo',
  Bermuda: 'Bermudas',
})

/**
 * Industria de Yahoo (la taxonomía de Morningstar que publica en `industry`) a español de México.
 * La llave es el texto de Yahoo normalizado con normalizeIndustry: minúsculas, espacios simples y
 * cualquier guion (con sus espacios) plegado a "-", porque Yahoo ha escrito "Banks - Regional" y
 * también la forma vieja con guion largo pegado.
 */
export const INDUSTRY_ES = Object.freeze({
  // Materiales
  'agricultural inputs': 'Insumos agrícolas',
  aluminum: 'Aluminio',
  'building materials': 'Materiales de construcción',
  chemicals: 'Químicos',
  'coking coal': 'Carbón metalúrgico',
  copper: 'Cobre',
  gold: 'Oro',
  'lumber & wood production': 'Madera y productos de madera',
  'other industrial metals & mining': 'Otros metales industriales y minería',
  'other precious metals & mining': 'Otros metales preciosos y minería',
  'paper & paper products': 'Papel y productos de papel',
  silver: 'Plata',
  'specialty chemicals': 'Químicos especializados',
  steel: 'Acero',
  // Comunicaciones
  'advertising agencies': 'Agencias de publicidad',
  broadcasting: 'Radio y televisión',
  'electronic gaming & multimedia': 'Videojuegos y multimedia',
  entertainment: 'Entretenimiento',
  'internet content & information': 'Contenido e información en internet',
  publishing: 'Editoriales',
  'telecom services': 'Servicios de telecomunicaciones',
  // Consumo discrecional
  'apparel manufacturing': 'Fabricación de ropa',
  'apparel retail': 'Tiendas de ropa',
  'auto & truck dealerships': 'Agencias de autos y camiones',
  'auto manufacturers': 'Fabricantes de automóviles',
  'auto parts': 'Autopartes',
  'department stores': 'Tiendas departamentales',
  'footwear & accessories': 'Calzado y accesorios',
  'furnishings, fixtures & appliances': 'Muebles, accesorios y electrodomésticos',
  gambling: 'Apuestas y juegos de azar',
  'home improvement retail': 'Tiendas de mejoras para el hogar',
  'internet retail': 'Comercio electrónico',
  leisure: 'Esparcimiento',
  lodging: 'Hospedaje',
  'luxury goods': 'Artículos de lujo',
  'packaging & containers': 'Empaques y envases',
  'personal services': 'Servicios personales',
  'recreational vehicles': 'Vehículos recreativos',
  'residential construction': 'Construcción de vivienda',
  'resorts & casinos': 'Complejos turísticos y casinos',
  restaurants: 'Restaurantes',
  'specialty retail': 'Tiendas especializadas',
  'textile manufacturing': 'Fabricación textil',
  'travel services': 'Servicios de viaje',
  // Consumo básico
  'beverages-brewers': 'Cerveceras',
  'beverages-non-alcoholic': 'Bebidas sin alcohol',
  'beverages-wineries & distilleries': 'Vinícolas y destilerías',
  confectioners: 'Dulces y confitería',
  'discount stores': 'Tiendas de autoservicio y descuento',
  'education & training services': 'Educación y capacitación',
  'farm products': 'Productos agropecuarios',
  'food distribution': 'Distribución de alimentos',
  'grocery stores': 'Supermercados',
  'household & personal products': 'Productos para el hogar y cuidado personal',
  'packaged foods': 'Alimentos empacados',
  tobacco: 'Tabaco',
  // Energía
  'oil & gas drilling': 'Perforación de petróleo y gas',
  'oil & gas e&p': 'Exploración y producción de petróleo y gas',
  'oil & gas equipment & services': 'Equipo y servicios para petróleo y gas',
  'oil & gas integrated': 'Petroleras integradas',
  'oil & gas midstream': 'Transporte y almacenamiento de petróleo y gas',
  'oil & gas refining & marketing': 'Refinación y comercialización de petróleo y gas',
  'thermal coal': 'Carbón térmico',
  uranium: 'Uranio',
  // Servicios financieros
  'asset management': 'Administración de activos',
  'banks-diversified': 'Bancos diversificados',
  'banks-regional': 'Bancos regionales',
  'capital markets': 'Mercados de capitales',
  'closed-end fund-debt': 'Fondos cerrados de deuda',
  'closed-end fund-equity': 'Fondos cerrados de renta variable',
  'closed-end fund-foreign': 'Fondos cerrados de otros países',
  'credit services': 'Servicios de crédito',
  'financial conglomerates': 'Conglomerados financieros',
  'financial data & stock exchanges': 'Datos financieros y bolsas de valores',
  'insurance brokers': 'Agentes y corredores de seguros',
  'insurance-diversified': 'Seguros diversificados',
  'insurance-life': 'Seguros de vida',
  'insurance-property & casualty': 'Seguros de daños',
  'insurance-reinsurance': 'Reaseguro',
  'insurance-specialty': 'Seguros especializados',
  'mortgage finance': 'Financiamiento hipotecario',
  'shell companies': 'Empresas sin operaciones',
  // Salud
  biotechnology: 'Biotecnología',
  'diagnostics & research': 'Diagnóstico e investigación',
  'drug manufacturers-general': 'Farmacéuticas de línea general',
  'drug manufacturers-specialty & generic': 'Farmacéuticas de especialidad y genéricos',
  'health information services': 'Servicios de información de salud',
  'healthcare plans': 'Planes de salud',
  'medical care facilities': 'Hospitales y centros de atención médica',
  'medical devices': 'Dispositivos médicos',
  'medical distribution': 'Distribución de insumos médicos',
  'medical instruments & supplies': 'Instrumentos y material médico',
  'pharmaceutical retailers': 'Farmacias',
  // Industriales
  'aerospace & defense': 'Aeroespacial y defensa',
  airlines: 'Aerolíneas',
  'airports & air services': 'Aeropuertos y servicios aéreos',
  'building products & equipment': 'Productos y equipo para construcción',
  'business equipment & supplies': 'Equipo y artículos de oficina',
  conglomerates: 'Conglomerados',
  'consulting services': 'Servicios de consultoría',
  'electrical equipment & parts': 'Equipo y componentes eléctricos',
  'engineering & construction': 'Ingeniería y construcción',
  'farm & heavy construction machinery': 'Maquinaria agrícola y de construcción pesada',
  'industrial distribution': 'Distribución industrial',
  'infrastructure operations': 'Operación de infraestructura',
  'integrated freight & logistics': 'Carga y logística integradas',
  'marine shipping': 'Transporte marítimo',
  'metal fabrication': 'Fabricación de productos metálicos',
  'pollution & treatment controls': 'Control de contaminación y tratamiento',
  railroads: 'Ferrocarriles',
  'rental & leasing services': 'Renta y arrendamiento',
  'security & protection services': 'Servicios de seguridad y protección',
  'specialty business services': 'Servicios empresariales especializados',
  'specialty industrial machinery': 'Maquinaria industrial especializada',
  'staffing & employment services': 'Servicios de personal y empleo',
  'tools & accessories': 'Herramientas y accesorios',
  trucking: 'Autotransporte de carga',
  'waste management': 'Manejo de residuos',
  // Bienes raíces (REIT es el fideicomiso inmobiliario de EE. UU.; en México, la FIBRA)
  'real estate services': 'Servicios inmobiliarios',
  'real estate-development': 'Desarrollo inmobiliario',
  'real estate-diversified': 'Inmobiliarias diversificadas',
  'real estate-general': 'Inmobiliarias',
  'reit-diversified': 'Fideicomisos inmobiliarios diversificados',
  'reit-healthcare facilities': 'Fideicomisos inmobiliarios de salud',
  'reit-hotel & motel': 'Fideicomisos inmobiliarios de hoteles',
  'reit-industrial': 'Fideicomisos inmobiliarios industriales',
  'reit-mortgage': 'Fideicomisos inmobiliarios hipotecarios',
  'reit-office': 'Fideicomisos inmobiliarios de oficinas',
  'reit-residential': 'Fideicomisos inmobiliarios de vivienda',
  'reit-retail': 'Fideicomisos inmobiliarios comerciales',
  'reit-specialty': 'Fideicomisos inmobiliarios especializados',
  // Tecnología
  'communication equipment': 'Equipo de comunicaciones',
  'computer hardware': 'Equipo de cómputo',
  'consumer electronics': 'Electrónica de consumo',
  'electronic components': 'Componentes electrónicos',
  'electronics & computer distribution': 'Distribución de electrónica y cómputo',
  'information technology services': 'Servicios de tecnologías de la información',
  'scientific & technical instruments': 'Instrumentos científicos y técnicos',
  'semiconductor equipment & materials': 'Equipo y materiales para semiconductores',
  semiconductors: 'Semiconductores',
  'software-application': 'Software de aplicaciones',
  'software-infrastructure': 'Software de infraestructura',
  solar: 'Energía solar',
  // Servicios públicos
  'utilities-diversified': 'Servicios públicos diversificados',
  'utilities-independent power producers': 'Productores independientes de electricidad',
  'utilities-regulated electric': 'Electricidad regulada',
  'utilities-regulated gas': 'Gas regulado',
  'utilities-regulated water': 'Agua regulada',
  'utilities-renewable': 'Energía renovable',
})

/**
 * Llave de INDUSTRY_ES: minúsculas, espacios simples y los guiones "-", U+2013 y U+2014 (con los
 * espacios que los rodean) plegados a "-".
 * @param {string | null | undefined} raw
 */
export function normalizeIndustry(raw) {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/\s*[-\u2013\u2014]\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Industria en español. Si no está en la tabla regresa el texto de Yahoo tal cual, con
 * `lang: 'en'` para marcarlo en pantalla (lang="en") en vez de hacerlo pasar por español.
 * @param {string | null | undefined} raw
 * @returns {{ text: string, lang: 'es' | 'en' } | null}
 */
export function industryEs(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return null
  const es = INDUSTRY_ES[/** @type {keyof typeof INDUSTRY_ES} */ (normalizeIndustry(text))]
  return es ? { text: es, lang: 'es' } : { text, lang: 'en' }
}

/** @param {string | null | undefined} sector */
export function sectorEs(sector) {
  if (!sector) return null
  return SECTOR_ES[/** @type {keyof typeof SECTOR_ES} */ (sector)] ?? sector
}

/** @param {string | null | undefined} country */
export function countryEs(country) {
  if (!country) return null
  return COUNTRY_ES[/** @type {keyof typeof COUNTRY_ES} */ (country)] ?? country
}

const EN = /\b(the|and|its|is|are|company|provides|operates|through|segments?|products|services|which|was|with|headquartered|founded|incorporated)\b/gi
const ES = /\b(el|la|los|las|y|es|son|empresa|opera|ofrece|mediante|servicios|productos|con|sede|fundada)\b/gi

/**
 * true si el texto parece estar en inglés (más palabras funcionales del inglés que del español).
 * @param {string | null | undefined} text
 */
export function looksEnglish(text) {
  if (!text) return false
  const en = String(text).match(EN)?.length ?? 0
  const es = String(text).match(ES)?.length ?? 0
  return en >= 2 && en > es
}
