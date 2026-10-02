// Términos del glosario de V5FX (monitor del peso y forward: forward, puntos forward, FIX, regla del DOF, posicionamiento CFTC).
// Mismo esquema que TERMS de src/content/glossary.js (sin `slug`: la llave es el slug) y las mismas
// reglas: español de México, sin guiones largos, sin lenguaje de recomendación, con fuente y con
// `relacionados` que existan. glossary.js une este objeto con los demás y falla si un slug se repite.

/** @type {{ [slug: string]: import('../glossary.js').GlossaryTermInput }} */
const TERMS = {
  'fix-banxico': {
    titulo: 'FIX de Banxico',
    corto: 'El tipo de cambio peso dólar que determina Banxico cada día hábil bancario para pagar obligaciones en dólares.',
    largo: [
      'Banxico lo determina alrededor de las 12:00 de cada día hábil bancario con cotizaciones del mercado de mayoreo, y lo publica en el SIE como la serie SF43718. Al día hábil siguiente sale en el Diario Oficial de la Federación (DOF).',
      'Es el tipo de cambio de referencia para solventar obligaciones en dólares dentro de México y el que suele usarse en contabilidad. No es el precio al que te vende o te compra dólares un banco: ese incluye su margen.',
      'Kaizen fecha cada FIX el día en que se determinó. Los días sin FIX (fines de semana y feriados bancarios) no se rellenan: el día hábil bancario se infiere justamente de que haya FIX publicado.',
    ],
    formula: 'cambio en centavos = (FIX_hoy − FIX_antes) · 100;  cambio en fracción = FIX_hoy / FIX_antes − 1',
    comoLeer: 'Un FIX de 18.25 quiere decir 18.25 pesos por un dólar. Si sube, el peso se debilitó frente al dólar.',
    ejemplo: 'Si el FIX pasa de 18.10 a 18.25, el dólar subió 15 centavos, que es 0.83% en fracción del valor anterior.',
    fuente: 'Banco de México, SIE, serie SF43718, y Disposiciones aplicables a la determinación del tipo de cambio FIX.',
    relacionados: ['regla-del-dof', 'volatilidad-realizada', 'forward-teorico', 'posicionamiento-cftc'],
    alias: ['FIX', 'tipo de cambio FIX', 'tipo de cambio para solventar obligaciones'],
  },

  'regla-del-dof': {
    titulo: 'Regla del DOF (art. 20 del CFF)',
    corto: 'Usar el tipo de cambio publicado en el DOF el día anterior a la operación, o el último publicado antes si ese día no hubo.',
    largo: [
      'El artículo 20 del Código Fiscal de la Federación dice que, para efectos fiscales, una operación en dólares se convierte con el tipo de cambio publicado en el DOF el día anterior a la fecha de la operación. Si ese día no hubo publicación, se usa la última publicada antes.',
      'Lo que publica el DOF en un día hábil bancario es el FIX que Banxico determinó el día hábil anterior. Por eso, con esta regla, el FIX que se usa casi siempre es de dos días hábiles antes de la operación.',
      'Kaizen explica la regla y muestra las dos opciones lado a lado, pero no la recomienda: cuál usar en tu contabilidad es una decisión fiscal de tu empresa con su contador.',
    ],
    formula: 'DOF usado = último día hábil antes de la fecha;  FIX usado = día hábil anterior a ese DOF',
    comoLeer: 'Fíjate en dos fechas: la del DOF que se usa y la del FIX que trae esa publicación.',
    ejemplo: 'Un pago del miércoles 30 de septiembre de 2026 usa el DOF del martes 29, que trae el FIX del lunes 28. Un pago del lunes 5 de octubre usa el DOF del viernes 2, que trae el FIX del jueves 1.',
    fuente: 'Código Fiscal de la Federación, artículo 20, tercer párrafo.',
    relacionados: ['fix-banxico', 'forward-teorico'],
    alias: ['regla del DOF', 'artículo 20 del CFF', 'tipo de cambio fiscal'],
  },

  'forward-teorico': {
    titulo: 'Forward teórico',
    corto: 'El precio del dólar a una fecha futura que sale de la diferencia de tasas entre pesos y dólares, sin margen bancario.',
    largo: [
      'Por paridad cubierta de tasas, si las tasas en pesos son más altas que en dólares, el dólar a futuro tiene que costar más que hoy: de otro modo habría una ganancia sin riesgo pidiendo prestado en una moneda e invirtiendo en la otra.',
      'Kaizen lo calcula con el FIX como spot, una tasa en pesos (TIIE, CETES o fondeo) y una en dólares (Tesoro de EE. UU. o SOFR), las dos en convención act/360 simple. Los rendimientos del Tesoro vienen en base 365 y se multiplican por 360/365.',
      'Es un precio teórico: no es una cotización, no incluye el margen del banco y no es una sugerencia de cubrirse. Sirve para entender de dónde viene el precio que te ofrecen.',
    ],
    formula: 'F = S · (1 + i_MXN · d/360) / (1 + i_USD · d/360)',
    comoLeer: 'Si el forward a 91 días es 18.17 y el spot es 18.00, comprar dólares a ese plazo cuesta 17 centavos más que hoy, por la diferencia de tasas.',
    ejemplo: 'Con S = 18.00, tasa en pesos de 8% y en dólares de 4%, a 90 días: F = 18.00 · (1 + 0.08 · 90/360) / (1 + 0.04 · 90/360) = 18.178218.',
    fuente: 'Hull, Options, Futures, and Other Derivatives, capítulo 5 (forwards de divisas).',
    relacionados: ['puntos-forward', 'fix-banxico', 'cetes'],
    alias: ['forward', 'tipo de cambio a plazo', 'paridad cubierta de tasas'],
  },

  'puntos-forward': {
    titulo: 'Puntos forward',
    corto: 'La diferencia entre el forward y el spot expresada en pips, es decir en diezmilésimas de peso.',
    largo: [
      'Las mesas de cambios cotizan el forward como spot más unos puntos. Un punto, o pip, es 0.0001 pesos por dólar.',
      'Kaizen también muestra el costo anualizado: cuánto representan esos puntos como tasa anual sobre el spot, con base 360. Es la forma de comparar plazos distintos.',
    ],
    formula: 'puntos = (F − S) · 10,000;  costo anualizado = (F / S − 1) · 360 / días',
    comoLeer: 'Más puntos quiere decir una diferencia de tasas más grande o un plazo más largo.',
    ejemplo: 'Con S = 18.00 y F = 18.178218 a 90 días son 1,782.18 puntos y un costo anualizado de 3.96%.',
    fuente: 'Convención de mercado de divisas; Hull, Options, Futures, and Other Derivatives, capítulo 5.',
    relacionados: ['forward-teorico', 'fix-banxico'],
    alias: ['pips', 'puntos swap'],
  },

  'volatilidad-realizada': {
    titulo: 'Volatilidad realizada',
    corto: 'Qué tanto se movió de verdad el tipo de cambio en los últimos días, anualizado.',
    largo: [
      'Es la desviación estándar muestral (divide entre n−1) de los rendimientos logarítmicos diarios del FIX en una ventana de 20, 60 o 250 días hábiles, multiplicada por la raíz de 252.',
      'Describe el pasado: no es un pronóstico ni la volatilidad implícita de las opciones.',
    ],
    formula: 'vol = sd(ln(P_t / P_(t−1))) · √252',
    comoLeer: 'Una volatilidad de 10% anual quiere decir que los movimientos diarios han sido de alrededor de 0.63% (10% entre raíz de 252).',
    ejemplo: 'Cierres de 100, 101, 99, 102 y 103 dan una volatilidad realizada de 32.62% anual.',
    fuente: 'Convención estándar; Hull, Options, Futures, and Other Derivatives, capítulo 15.',
    relacionados: ['volatilidad', 'rendimiento-logaritmico', 'anualizacion'],
    alias: ['volatilidad histórica'],
  },

  'posicionamiento-cftc': {
    titulo: 'Posicionamiento CFTC',
    corto: 'Cuántos contratos de futuros del peso tienen netos los especuladores y otros participantes en el CME, según la CFTC.',
    largo: [
      'Cada martes la CFTC cuenta las posiciones abiertas en futuros y el viernes publica el reporte Commitments of Traders. Kaizen lee el del peso mexicano en el CME (contrato 095741).',
      'El neto es contratos largos menos cortos en el peso. Se muestra para los no comerciales (reporte legado), los fondos apalancados y los administradores de activos (reporte TFF), y el cambio contra la semana anterior.',
      'Es una foto descriptiva de quién está posicionado y cómo cambió en la semana; no anticipa hacia dónde va el peso.',
    ],
    formula: 'neto = largos − cortos',
    comoLeer: 'Un neto positivo quiere decir que ese grupo tiene más contratos apostando a un peso más fuerte que a uno más débil.',
    ejemplo: 'Largos de 127,595 y cortos de 52,428 dan un neto de +75,167; si la semana previa era +87,782, el cambio es −12,615.',
    fuente: 'CFTC, Commitments of Traders, conjuntos 6dca-aqww (legado) y gpe5-46if (TFF).',
    relacionados: ['fix-banxico', 'volatilidad-realizada'],
    alias: ['COT', 'Commitments of Traders'],
  },
}

export default TERMS
