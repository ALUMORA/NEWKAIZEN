// Términos del glosario de V5EC (calendario y tablero de economía: indicadores, consenso, comparador de países).
// Mismo esquema que TERMS de src/content/glossary.js (sin `slug`: la llave es el slug) y las mismas
// reglas: español de México, sin guiones largos, sin lenguaje de recomendación, con fuente y con
// `relacionados` que existan. glossary.js une este objeto con los demás y falla si un slug se repite.

/** @type {{ [slug: string]: import('../glossary.js').GlossaryTermInput }} */
const TERMS = {
  consenso: {
    titulo: 'Consenso',
    corto: 'La mediana de lo que esperan los analistas para un dato antes de que se publique. Kaizen no lo muestra porque sus fuentes son de pago.',
    largo: [
      'Antes de cada publicación importante, agencias de noticias y casas de análisis encuestan a economistas y publican la mediana de sus estimados. Esa cifra es el consenso.',
      'Lo que mueve a los mercados el día de la publicación suele ser la sorpresa: la diferencia entre el dato publicado y el consenso, no el dato en sí.',
      'Las encuestas de consenso se venden con licencia. Kaizen no estima un consenso propio y por eso lo muestra como s/d en el calendario.',
    ],
    formula: 'Sorpresa = dato publicado − consenso',
    comoLeer: 'Una sorpresa grande importa más que un dato alto o bajo en abstracto. Sin consenso, compara contra el dato anterior y la tendencia.',
    ejemplo: 'Si el consenso de inflación anual era 3.50 por ciento y se publica 3.70, la sorpresa es de 20 puntos base al alza.',
    fuente: 'Práctica de mercado. Las encuestas de Bloomberg y Reuters son de pago.',
    relacionados: ['dato-anterior', 'puntos-base'],
    alias: ['estimado de analistas', 'expectativa del mercado'],
  },
  'dato-anterior': {
    titulo: 'Dato anterior',
    corto: 'La cifra del periodo previo de un indicador, tal como la publicó su fuente, para comparar con la nueva.',
    largo: [
      'En el calendario, cada publicación trae el dato anterior y, una vez que ya salió, el dato publicado. Así se ve de un vistazo si el indicador subió o bajó.',
      'Las fuentes a veces revisan el dato anterior cuando publican el nuevo. Kaizen muestra la cifra que tiene hoy la serie oficial, que puede ser ya la revisada.',
    ],
    formula: 'Cambio = dato publicado − dato anterior',
    comoLeer: 'Compara siempre en la misma unidad: inflación en porcentaje, empleo en miles de personas y tasas en puntos base.',
    ejemplo: 'La inflación anual de México pasó de 3.12 por ciento en julio a 3.26 por ciento en agosto de 2026: el dato anterior es 3.12.',
    fuente: 'Banxico (SIE), FRED y BLS.',
    relacionados: ['consenso', 'inpc'],
  },
  'nomina-no-agricola': {
    titulo: 'Nómina no agrícola',
    corto: 'Cuántos empleos se crearon o perdieron en EE. UU. en el mes, sin contar el campo. Sale en el reporte de empleo del BLS.',
    largo: [
      'El reporte de situación del empleo del BLS se publica normalmente el primer viernes del mes, a las 08:30 hora del este. Su cifra más vista es el cambio en la nómina no agrícola.',
      'La serie PAYEMS de FRED es el nivel total de empleos en miles de personas. El dato del calendario es la diferencia contra el mes anterior.',
      'Es un dato con revisiones grandes: los dos meses previos se corrigen en cada publicación.',
    ],
    formula: 'Cambio = PAYEMS del mes − PAYEMS del mes anterior (miles de personas)',
    comoLeer: 'Un número positivo son empleos nuevos netos. Para ver la tendencia conviene un promedio de tres meses.',
    ejemplo: 'PAYEMS de 159,075 contra 158,953 da +122, o sea 122 mil empleos nuevos.',
    fuente: 'BLS, Employment Situation; FRED, serie PAYEMS.',
    relacionados: ['dato-anterior', 'consenso', 'pce-subyacente'],
    alias: ['nonfarm payrolls', 'NFP', 'reporte de empleo'],
  },
  'pce-subyacente': {
    titulo: 'PCE subyacente',
    corto: 'La inflación del gasto de consumo personal de EE. UU. sin alimentos ni energía. Es la medida que la Fed sigue para su meta de 2 por ciento.',
    largo: [
      'El índice de precios del gasto de consumo personal (PCE) lo publica la BEA. Cubre más gasto que el CPI y cambia sus ponderaciones cuando la gente cambia lo que compra.',
      'La versión subyacente quita alimentos y energía, que son volátiles. Kaizen calcula su variación anual con la serie PCEPILFE de FRED.',
    ],
    formula: 'Inflación anual = índice del mes / índice del mismo mes del año anterior − 1',
    comoLeer: 'Suele salir unas décimas abajo del CPI subyacente. Lo que importa a la Fed es su distancia contra 2 por ciento.',
    ejemplo: 'Un índice de 125.6 contra 121.9 un año antes da 3.0 por ciento anual.',
    fuente: 'BEA; FRED, serie PCEPILFE.',
    relacionados: ['inflacion-subyacente', 'nomina-no-agricola'],
    alias: ['PCE core', 'core PCE'],
  },
  'inflacion-subyacente': {
    titulo: 'Inflación subyacente',
    corto: 'La inflación sin los precios más volátiles (en México, agropecuarios y energéticos). Muestra la tendencia de fondo.',
    largo: [
      'Banxico e INEGI la calculan quitando del INPC los genéricos que se mueven por choques de oferta. En EE. UU. el CPI subyacente quita alimentos y energía.',
      'Los bancos centrales la siguen de cerca porque es más persistente: si sube, es más difícil que baje sola.',
    ],
    formula: 'Variación anual del índice subyacente',
    comoLeer: 'Si la general baja pero la subyacente no, la baja puede deberse a algo pasajero como la gasolina.',
    ejemplo: 'En agosto de 2026 la subyacente de México fue 3.88 por ciento anual (SP74662 del SIE).',
    fuente: 'INEGI y Banxico, serie SP74662; BLS, serie CPILFESL en FRED.',
    relacionados: ['inpc', 'pce-subyacente'],
    alias: ['core', 'inflación core'],
  },
  remesas: {
    titulo: 'Remesas',
    corto: 'El dinero que personas en el extranjero mandan a sus familias en México. Banxico lo publica cada mes en millones de dólares.',
    largo: [
      'Las remesas familiares son una de las principales entradas de dólares al país, comparables con la inversión extranjera directa.',
      'Kaizen muestra el total del mes (SE27803 del SIE) y su cambio contra el mismo mes del año anterior, porque la serie tiene estacionalidad: mayo, por el Día de las Madres, suele ser alto.',
    ],
    formula: 'Cambio anual = remesas del mes / remesas del mismo mes del año anterior − 1',
    comoLeer: 'Compara siempre contra el mismo mes del año anterior, no contra el mes previo.',
    ejemplo: '5,452.3 millones de dólares contra 5,000 un año antes es un aumento de 9.05 por ciento.',
    fuente: 'Banxico, SIE, serie SE27803 (Remesas familiares total).',
    relacionados: ['tipo-de-cambio-fix', 'espejo-ocde'],
    alias: ['remesas familiares'],
  },
  'espejo-ocde': {
    titulo: 'Espejo OCDE',
    corto: 'Una serie de la OCDE que FRED vuelve a publicar. Kaizen la usa para desempleo y PIB de México mientras no haya token de INEGI.',
    largo: [
      'FRED replica series de los Indicadores Económicos Principales de la OCDE. Sirven para tener datos de México sin llave, pero llegan con dos meses o más de rezago.',
      'Algunas dejan de actualizarse sin aviso. Por eso Kaizen revisa la fecha del último dato: si tiene más de 18 meses, la serie se rechaza y se marca como vieja.',
    ],
    formula: 'Sin fórmula: es la misma cifra de la OCDE.',
    comoLeer: 'Toma la fecha del dato antes de compararlo con una cifra de INEGI más reciente.',
    ejemplo: 'LRHUTTTTMXM156S es la tasa de desempleo de México según la OCDE, publicada en FRED.',
    fuente: 'OCDE, Main Economic Indicators, vía FRED.',
    relacionados: ['dato-de-respaldo', 'dato-con-retraso', 'remesas'],
    alias: ['serie OCDE', 'espejo de la OCDE'],
  },
}

export default TERMS
