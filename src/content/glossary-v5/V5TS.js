// Términos del glosario de V5TS (centro de tasas: curva de rendimiento, inflación implícita, tasa real, encuesta Banxico).
// Mismo esquema que TERMS de src/content/glossary.js (sin `slug`: la llave es el slug) y las mismas
// reglas: español de México, sin guiones largos, sin lenguaje de recomendación, con fuente y con
// `relacionados` que existan. glossary.js une este objeto con los demás y falla si un slug se repite.
// La curva de rendimiento ya existía en la base ('curva-de-rendimientos') y se usa tal cual.

/** @type {{ [slug: string]: import('../glossary.js').GlossaryTermInput }} */
const TERMS = {
  'inflacion-implicita': {
    titulo: 'Inflación implícita',
    corto: 'La inflación que iguala el rendimiento de un bono nominal con el de uno real del mismo plazo. Mezcla expectativa y primas.',
    largo: [
      'Un Bono M paga una tasa fija en pesos y un Udibono paga una tasa real sobre un monto que sube con la inflación. Si los dos rinden lo mismo al final, la diferencia entre sus tasas es la inflación que el mercado está cobrando por plazo.',
      'No es un pronóstico puro: incluye una prima por el riesgo de que la inflación cambie y una por liquidez, que en México suele castigar al Udibono. Por eso se lee mejor como nivel de referencia y por su cambio en el tiempo.',
      'En México cada bono cambia solo en su subasta, así que el nominal y el real pueden traer fechas distintas. Kaizen muestra las dos fechas y cuántos días las separan.',
    ],
    formula: 'Inflación implícita = (1 + nominal) / (1 + real) - 1; la diferencia simple nominal menos real va en pb',
    comoLeer: 'Compárala contra la meta del banco central y contra la encuesta de especialistas; una brecha grande puede ser prima de riesgo, no solo expectativa.',
    ejemplo: 'Bono M a 20 años en 9.64% y Udibono a 20 años en 4.61% dan 1.0964 / 1.0461 - 1 = 4.81%, o 503 pb en la resta simple.',
    fuente: 'Fisher (1930), The Theory of Interest; Banco de México, resultados de la subasta de valores gubernamentales.',
    relacionados: ['tasa-real', 'bono-m', 'udi', 'real-vs-nominal', 'curva-de-rendimientos'],
    alias: ['breakeven', 'inflación de equilibrio'],
  },
  'tasa-real': {
    titulo: 'Tasa real',
    corto: 'Lo que rinde una tasa después de descontar la inflación. Ex post usa la inflación observada y ex ante la esperada.',
    largo: [
      'Una tasa nominal de 7% con inflación de 4% no hace crecer tu poder de compra 7%, sino cerca de 2.9%. Esa diferencia es la tasa real.',
      'La tasa real ex post usa la inflación que ya se publicó, la de los últimos 12 meses. La ex ante usa la que se espera para adelante, por ejemplo la mediana de la encuesta de especialistas de Banxico.',
      'Las dos se calculan con la fórmula de Fisher, que es exacta, en vez de restar las tasas, que es una aproximación que falla más cuando las tasas son altas.',
    ],
    formula: 'Tasa real = (1 + tasa nominal) / (1 + inflación) - 1',
    comoLeer: 'Una tasa real positiva dice que el instrumento le gana a la inflación usada en el cálculo; no dice nada del impuesto ni de la inflación que de verdad vendrá.',
    ejemplo: 'CETES a 28 días en 7% e inflación de 4% dan 1.07 / 1.04 - 1 = 2.88% real.',
    fuente: 'Fisher (1930), The Theory of Interest; INEGI, Índice Nacional de Precios al Consumidor.',
    relacionados: ['real-vs-nominal', 'cetes', 'inpc', 'inflacion-implicita', 'encuesta-banxico'],
    alias: ['tasa real ex post', 'tasa real ex ante'],
  },
  'forward-implicito': {
    titulo: 'Forward implícito',
    corto: 'La tasa entre dos plazos futuros que hace equivalente invertir a un plazo largo o encadenar dos cortos.',
    largo: [
      'Si CETES a 28 días paga una tasa y a 91 días otra, existe una tasa para los días 28 a 91 que deja indiferente entre comprar el de 91 o comprar el de 28 y reinvertir. Esa es la tasa forward implícita.',
      'Kaizen la calcula con interés simple act/360, la convención de los CETES, y la compara contra la tasa objetivo de Banxico en pb. En Estados Unidos pasa antes los rendimientos del Tesoro a act/360 multiplicando por 360/365.',
      'No es un pronóstico de la tasa futura: incluye primas por plazo y por liquidez. Sirve para ver qué está descontando la curva hoy.',
    ],
    formula: 'f(d1, d2) = ((1 + r2 x d2/360) / (1 + r1 x d1/360) - 1) x 360 / (d2 - d1)',
    comoLeer: 'Un forward por arriba de la tasa objetivo dice que la curva cobra más por el tramo futuro, sea por expectativa de alzas o por prima; uno por abajo, lo contrario.',
    ejemplo: 'CETES a 28 días en 7.00% y a 91 días en 7.20% dan un forward de 28 a 91 días de 7.25%.',
    fuente: 'Hull (2018), Options, Futures, and Other Derivatives, capítulo de tasas de interés.',
    relacionados: ['cetes', 'tasa-objetivo', 'curva-de-rendimientos', 'convencion-de-tasas'],
    alias: ['tasa forward', 'tasa adelantada'],
  },
  'encuesta-banxico': {
    titulo: 'Encuesta de especialistas de Banxico',
    corto: 'Encuesta mensual de Banxico a analistas del sector privado sobre inflación, PIB, tipo de cambio y tasas.',
    largo: [
      'Banco de México levanta cada mes la Encuesta sobre las Expectativas de los Especialistas en Economía del Sector Privado y publica la media y la mediana de cada respuesta.',
      'El año en curso se toma de la fecha del levantamiento: la encuesta de diciembre de 2026 todavía habla de 2026 aunque se consulte en enero de 2027, y "el año siguiente" es 2027.',
      'Kaizen solo publica una serie cuando el título que devuelve el SIE confirma que es la media o la mediana que dice ser; si no, el dato sale s/d.',
    ],
    formula: 'Media y mediana de las respuestas de los especialistas en cada levantamiento',
    comoLeer: 'La mediana es menos sensible a respuestas extremas que la media. Es un consenso de analistas, no un pronóstico oficial de Banxico.',
    ejemplo: 'En el levantamiento de septiembre de 2026 la mediana de inflación al cierre del año fue 3.87%.',
    fuente: 'Banco de México, Encuesta sobre las Expectativas de los Especialistas en Economía del Sector Privado.',
    relacionados: ['inpc', 'tasa-objetivo', 'tasa-real'],
    alias: ['encuesta citibanamex', 'expectativas de analistas'],
  },
  'convencion-de-tasas': {
    titulo: 'Convención de tasas',
    corto: 'La regla para contar días y capitalizar una tasa. Dos tasas con convenciones distintas no se comparan directo.',
    largo: [
      'Los CETES y la TIIE son tasas simples act/360: los intereses se calculan con los días reales sobre un año de 360. La tasa de fondos federales y la SOFR son tasas a un día.',
      'Los rendimientos del Tesoro de Estados Unidos que publica FRED son cmt en base bono, sobre 365 días y con capitalización semestral. Para compararlos con una tasa act/360 se multiplican por 360/365.',
      'La diferencia es pequeña cuando las tasas son bajas, pero en un diferencial de pocos pb puede ser todo el resultado.',
    ],
    formula: 'Tasa act/360 aproximada = rendimiento cmt x 360 / 365',
    comoLeer: 'Antes de restar dos tasas revisa que tengan la misma convención y el mismo plazo.',
    ejemplo: 'Un Tesoro a 3 meses en 4.25% cmt equivale a 4.19% act/360.',
    fuente: 'Banco de México, metodología de la TIIE; Departamento del Tesoro de EE. UU., Treasury Par Yield Curve Methodology.',
    relacionados: ['tiie', 'cetes', 'puntos-base', 'forward-implicito'],
    alias: ['act/360', 'base de cálculo'],
  },
}

export default TERMS
