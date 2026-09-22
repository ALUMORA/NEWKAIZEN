// Glosario de Kaizen. Una sola fuente para los InfoTip de las métricas, para las páginas de
// /aprender y para el buscador. Reglas de la casa que este archivo respeta al pie de la letra:
//
// - Español de México, llano y corto. Nada de lenguaje de recomendación: aquí se explica qué mide
//   un número y cómo leerlo, nunca qué conviene hacer con tu dinero.
// - Sin guiones largos: ni el U+2014 ni el U+2013 aparecen en este archivo, y la prueba lo revisa.
//   El signo menos de los números es U+2212 (−), igual que en src/lib/format.js, y el guion
//   normal es el ASCII.
// - Cada término trae de dónde sale: el artículo, el libro, la ley o la institución que lo define.
// - Los slugs son minúsculas sin acentos, porque son URL: /aprender/<slug> (pathLearnTerm).
//
// Peso: esto es texto y pesa. Quien lo use desde el shell (InfoTip) o desde una página debe
// cargarlo con import() dinámico a través de src/content/glossary-lazy.js, para que no entre al
// bundle de la primera ruta. El detalle está en docs/metodologia/fuentes-de-datos.md.
import { pathLearnTerm } from '../app/paths.js'

/**
 * Un término del glosario.
 * @typedef {object} GlossaryTerm
 * @property {string} slug Llave dentro del glosario: minúsculas, sin acentos, con guion ASCII.
 * @property {string} titulo Nombre visible del término.
 * @property {string} corto Una línea, máximo 160 caracteres. Es lo que cabe en un InfoTip.
 * @property {readonly string[]} largo De 2 a 4 párrafos cortos.
 * @property {string} formula Notación simple en texto plano.
 * @property {string} comoLeer Cómo interpretar el valor sin sobre interpretarlo.
 * @property {string} ejemplo Un caso con números, casi siempre en pesos.
 * @property {string} fuente Referencia: autor y año, ley o institución.
 * @property {readonly string[]} relacionados Slugs que existen en este mismo glosario.
 * @property {readonly string[]} [alias] Otras formas de nombrarlo, solo para el buscador.
 */

const TERMS = {
  // ─── Rendimientos y estadística básica ───────────────────────────────────────────────────────
  'rendimiento-simple': {
    titulo: 'Rendimiento simple',
    corto: 'Cuánto cambió un precio de un periodo al siguiente, en porcentaje del precio inicial.',
    largo: [
      'Es el rendimiento de toda la vida: lo que ganaste o perdiste dividido entre lo que tenías al empezar. Si una acción pasa de 100 a 110 pesos, el rendimiento simple del periodo es 10 por ciento.',
      'Kaizen calcula los rendimientos sobre precios ajustados por dividendos y splits, y siempre entre fechas que existen en las dos series. Si un día falta, ese día se cae del cálculo en vez de rellenarse: rellenar inventa un dato que nadie observó.',
      'Los rendimientos simples se suman bien entre activos dentro de un mismo periodo (el rendimiento de una cartera es el promedio ponderado de los de sus activos), pero no se suman bien a lo largo del tiempo. Para eso se encadenan multiplicando.',
    ],
    formula: 'r_t = P_t / P_(t−1) − 1',
    comoLeer: 'Un 0.10 es 10 por ciento en ese periodo, no al año. Para compararlo con otro plazo hay que anualizarlo.',
    ejemplo: 'Precios 100, 110, 99 y 108.9 dan rendimientos de +10 por ciento, −10 por ciento y +10 por ciento. Nota que después de subir y bajar 10 por ciento no regresas a 100, sino a 99.',
    fuente: 'Convención estándar. Bodie, Kane y Marcus, Investments, capítulo 5.',
    relacionados: ['rendimiento-logaritmico', 'rendimiento-total', 'cagr', 'anualizacion'],
    alias: ['rendimiento aritmético', 'variación porcentual'],
  },

  'rendimiento-logaritmico': {
    titulo: 'Rendimiento logarítmico',
    corto: 'El logaritmo natural del cociente de precios. Se suma a lo largo del tiempo, por eso se usa en estadística.',
    largo: [
      'El rendimiento logarítmico, o continuo, es ln(P_t / P_(t−1)). Su gracia es que se suma: la suma de los log rendimientos de un año es exactamente el log rendimiento del año completo, cosa que los simples no cumplen.',
      'Por eso el modelo lognormal del simulador trabaja en logs y los convierte a pesos al final. Para movimientos chicos el log rendimiento y el simple casi coinciden; para movimientos grandes el log siempre es menor.',
      'Lo que el log rendimiento no hace es sumarse entre activos: la cartera no es el promedio ponderado de los logs de sus componentes. Para juntar activos dentro de un periodo se usan rendimientos simples.',
    ],
    formula: 'r_log = ln(P_t / P_(t−1));  r_simple = e^(r_log) − 1',
    comoLeer: 'Sirve para la estadística y la simulación. Lo que se muestra al usuario en la pantalla siempre es el rendimiento simple.',
    ejemplo: 'De 100 a 108.9 en tres periodos, la suma de los tres log rendimientos es ln(1.089) = 0.08526, o sea 8.9 por ciento simple acumulado.',
    fuente: 'Campbell, Lo y MacKinlay (1997), The Econometrics of Financial Markets, capítulo 1.',
    relacionados: ['rendimiento-simple', 'lognormal', 'monte-carlo', 'volatilidad'],
    alias: ['rendimiento continuo', 'log return'],
  },

  'rendimiento-total': {
    titulo: 'Rendimiento total contra precio',
    corto: 'El rendimiento total incluye dividendos reinvertidos; el de precio solo mira la cotización.',
    largo: [
      'Una acción que paga 5 por ciento de dividendo y no se mueve de precio dio 5 por ciento de rendimiento total y 0 por ciento de precio. Comparar una serie de precio contra una de rendimiento total infla o desinfla el resultado sin que se note.',
      'Kaizen usa cierres ajustados, que ya incorporan dividendos y splits, para todo lo que sea rendimiento, riesgo, beta y backtest. Para el IPC, que es un índice de precio, el proxy de rendimiento total es NAFTRAC.MX, el ETF que lo replica y sí reparte.',
      'Cuando una pantalla muestra el nivel del índice y no un rendimiento total, lo dice en el pie de la tarjeta.',
    ],
    formula: 'r_total = (P_t + dividendos_t) / P_(t−1) − 1',
    comoLeer: 'Si la comparación es contra un índice, revisa que las dos series sean del mismo tipo. Mezclarlas es el error más común al medir desempeño.',
    ejemplo: 'El IPC de precio y un fondo que replica el IPC pueden diferir varios puntos al año solo por los dividendos del índice.',
    fuente: 'S&P Dow Jones Indices, Index Mathematics Methodology; Nareit para el caso de las FIBRAs.',
    relacionados: ['rendimiento-simple', 'bmv', 'beta', 'rendimiento-por-distribucion'],
    alias: ['total return', 'precio ajustado'],
  },

  anualizacion: {
    titulo: 'Anualización',
    corto: 'Llevar un rendimiento o una volatilidad de su periodo original a términos de un año, para poder compararlos.',
    largo: [
      'Los rendimientos se anualizan componiendo: (1 + r)^k − 1, con k periodos por año. Las volatilidades se anualizan multiplicando por la raíz de k, porque la varianza crece con el tiempo y la desviación estándar con su raíz.',
      'Kaizen usa k = 252 para datos diarios, 52 para semanales y 12 para mensuales, y siempre pasa la k explícita a cada función. Nunca hay un 52 escondido: si cambias el intervalo, cambia la k.',
      'Anualizar una serie corta es engañoso. Tres meses buenos anualizados se ven espectaculares y no dicen nada del año.',
    ],
    formula: 'Rendimiento: (1 + r)^k − 1.  Volatilidad: sd · √k.  k = 252 (1d), 52 (1sem), 12 (1mes)',
    comoLeer: 'Una cifra anualizada es una tasa hipotética, no lo que pasó. Junto a ella conviene ver cuántos periodos la sostienen.',
    ejemplo: 'Una desviación estándar semanal de 1.58 por ciento anualiza a 1.58 × √52 = 11.40 por ciento.',
    fuente: 'Convención estándar. CFA Institute, Quantitative Methods.',
    relacionados: ['volatilidad', 'cagr', 'sharpe', 'rendimiento-simple'],
    alias: ['anualizar', 'periodos por año'],
  },

  cagr: {
    titulo: 'CAGR (tasa compuesta anual)',
    corto: 'La tasa anual constante que, compuesta, lleva del valor inicial al final. Es el promedio geométrico, no el aritmético.',
    largo: [
      'El CAGR contesta: si esto hubiera crecido parejo todos los años, a qué tasa habría crecido. Es la única forma honesta de resumir un rendimiento de varios años en un solo número.',
      'El promedio aritmético de los rendimientos siempre es mayor o igual al CAGR, y la diferencia crece con la volatilidad. Por eso un backtest que reporta promedio aritmético por 52 semanas exagera: no es lo que habría tenido el inversionista.',
      'El CAGR no dice nada del camino. Dos carteras con el mismo CAGR pueden tener caídas máximas muy distintas, y eso se ve en el drawdown.',
    ],
    formula: 'CAGR = (V_final / V_inicial)^(1/años) − 1',
    comoLeer: 'Compáralo siempre contra un referente del mismo periodo y en la misma moneda. Un CAGR sin plazo al lado no significa nada.',
    ejemplo: 'De 100 a 200 en 3 años el CAGR es 25.99 por ciento anual. Una serie de +50 por ciento y −50 por ciento tiene promedio aritmético 0 y CAGR de −13.40 por ciento.',
    fuente: 'Convención estándar. CFA Institute, GIPS 2020, sección de cálculo de rendimientos.',
    relacionados: ['anualizacion', 'interes-compuesto', 'twr', 'drawdown-maximo'],
    alias: ['tasa compuesta anual', 'promedio geométrico'],
  },

  'interes-compuesto': {
    titulo: 'Interés compuesto',
    corto: 'Cuando el rendimiento de un periodo se suma al capital y genera rendimiento en el siguiente.',
    largo: [
      'Componer es reinvertir. Con una tasa r por periodo y n periodos, el capital se multiplica por (1 + r)^n. Lo que hace grande al resultado no es la tasa sola, es la tasa junto con el tiempo.',
      'Por eso en Kaizen las tasas siempre traen su plazo pegado. Un CETE a 28 días con tasa anual de 11 por ciento no paga 11 por ciento en 28 días: paga 11 × 28/360 = 0.856 por ciento, y componerlo durante el año da 11.75 por ciento efectivo anual, no 11.',
      'La cara incómoda es la misma: las pérdidas también componen, y recuperar una caída de 50 por ciento exige una ganancia de 100 por ciento.',
    ],
    formula: 'V_n = V_0 · (1 + r)^n;  tasa efectiva anual = (1 + r)^k − 1',
    comoLeer: 'Antes de comparar dos tasas, revisa que las dos sean efectivas anuales o las dos del mismo plazo.',
    ejemplo: 'Cien mil pesos al 11.75 por ciento efectivo anual durante 10 años se vuelven 303,721 pesos, tres veces el capital.',
    fuente: 'Convención estándar. Banxico, glosario de tasas de interés.',
    relacionados: ['cagr', 'cetes', 'real-vs-nominal', 'monte-carlo'],
    alias: ['capitalización', 'componer'],
  },

  volatilidad: {
    titulo: 'Volatilidad',
    corto: 'Qué tanto se mueven los rendimientos alrededor de su promedio. Se mide con la desviación estándar anualizada.',
    largo: [
      'La volatilidad no mide si algo sube o baja, mide qué tan disparejos son sus movimientos. Kaizen la calcula con varianza muestral (divide entre n−1) sobre los rendimientos del periodo y la anualiza con la raíz de k.',
      'Es la medida de riesgo más usada y también la más criticada, porque trata igual a una subida grande que a una caída grande. Para separar las dos está el Sortino, y para el tamaño de las caídas está el drawdown.',
      'La volatilidad histórica cambia con el tiempo y con la ventana que escojas. Dos años tranquilos seguidos de un choque dan una volatilidad baja justo antes del choque, y eso es una limitación real, no un detalle.',
    ],
    formula: 'sd = √( Σ(r_i − r̄)² / (n − 1) );  vol anual = sd · √k',
    comoLeer: 'Una volatilidad anual de 20 por ciento quiere decir que, con una distribución normal, dos de cada tres años caerían entre +20 y −20 puntos alrededor del promedio. Los mercados tienen colas más gordas que la normal.',
    ejemplo: 'Rendimientos semanales de 1, 2, −1, 3 y 0 por ciento dan sd de 1.58 por ciento por semana y 11.40 por ciento anual.',
    fuente: 'Markowitz (1952), Portfolio Selection, Journal of Finance.',
    relacionados: ['anualizacion', 'sharpe', 'var', 'baja-volatilidad', 'covarianza'],
    alias: ['desviación estándar', 'riesgo', 'sigma'],
  },

  correlacion: {
    titulo: 'Correlación',
    corto: 'Qué tanto se mueven juntos dos activos, en una escala de −1 a +1, sin importar el tamaño de sus movimientos.',
    largo: [
      'La correlación es la covarianza normalizada por las dos volatilidades, así que siempre cae entre −1 y +1. En +1 los dos se mueven igual, en 0 no hay relación lineal y en −1 se mueven al revés.',
      'Es el motor de la diversificación: dos activos con la misma volatilidad y correlación baja forman una cartera menos volátil que cualquiera de los dos por separado.',
      'Dos advertencias. La correlación mide relación lineal, no causa, y tiende a subir justo en las crisis, que es cuando más falta hace que baje. Por eso el mapa de correlaciones de Kaizen se pinta con una escala azul y naranja, no verde y rojo: una correlación alta no es buena ni mala por sí sola.',
    ],
    formula: 'ρ(x, y) = cov(x, y) / (sd_x · sd_y)',
    comoLeer: 'Arriba de 0.8 los dos activos aportan poco uno sobre el otro. Cerca de 0 sí diversifican. Revisa siempre sobre qué ventana se calculó.',
    ejemplo: 'Dos activos con volatilidad de 20 y 30 por ciento y correlación 0 dan una cartera mínima varianza con 69.23 por ciento en el primero y volatilidad de 16.64 por ciento, menos que los dos.',
    fuente: 'Markowitz (1952), Portfolio Selection, Journal of Finance.',
    relacionados: ['covarianza', 'diversificacion', 'ledoit-wolf', 'minima-varianza'],
    alias: ['matriz de correlación', 'rho'],
  },

  covarianza: {
    titulo: 'Covarianza',
    corto: 'Cuánto se mueven juntos dos activos, en unidades de rendimiento al cuadrado. Es el insumo del optimizador.',
    largo: [
      'La covarianza es el promedio del producto de las desviaciones de dos series respecto a sus promedios. Kaizen la calcula con n−1, igual que la varianza.',
      'La matriz de covarianzas es lo que convierte un montón de activos en una cartera: la volatilidad de la cartera sale de w traspuesta por la matriz por w, no del promedio de las volatilidades.',
      'Con pocos datos y muchos activos, la matriz muestral es ruidosa y el optimizador se enamora de ese ruido. Ese es el problema exacto que arregla la contracción de Ledoit y Wolf.',
    ],
    formula: 'cov(x, y) = Σ(x_i − x̄)(y_i − ȳ) / (n − 1);  varianza de la cartera = wᵀ C w, con C la matriz de covarianzas',
    comoLeer: 'El signo importa, la magnitud casi no se lee sola. Para leerla usa la correlación, que es la misma información en escala de −1 a 1.',
    ejemplo: 'Con 60 semanas y 5 activos, la matriz muestral tiene 15 números estimados con poco dato cada uno, y ahí es donde entra la contracción.',
    fuente: 'Markowitz (1952). Para el problema de estimación, Michaud (1989), The Markowitz Optimization Enigma.',
    relacionados: ['correlacion', 'ledoit-wolf', 'volatilidad', 'frontera-eficiente'],
    alias: ['matriz de covarianzas', 'covarianzas'],
  },

  'real-vs-nominal': {
    titulo: 'Rendimiento real contra nominal',
    corto: 'El nominal es lo que dice el estado de cuenta. El real le descuenta la inflación y es lo que de verdad puedes comprar.',
    largo: [
      'Si tu cartera subió 12 por ciento y la inflación fue 4 por ciento, tu poder de compra creció 7.69 por ciento, no 8. La resta simple es una aproximación; la cuenta correcta es dividir.',
      'En México esto pesa más que en Estados Unidos, porque las tasas nominales son más altas. Un CETE al 11 por ciento con inflación de 4.5 por ciento deja 6.2 por ciento real antes de impuestos, y el ISR se cobra sobre el interés nominal.',
      'El simulador de metas muestra las dos versiones: la nominal, para cuadrar con tu estado de cuenta, y la real, en pesos de hoy, para saber si el objetivo alcanza.',
    ],
    formula: 'r_real = (1 + r_nominal) / (1 + π) − 1',
    comoLeer: 'Cuando veas una meta a 20 años, mírala en términos reales. Un millón nominal dentro de 20 años con 4 por ciento de inflación son 456 mil pesos de hoy.',
    ejemplo: 'Nominal 12 por ciento con inflación 4 por ciento da real 7.69 por ciento: 1.12 / 1.04 − 1.',
    fuente: 'Fisher (1930), The Theory of Interest. Inflación de México: INPC del Inegi.',
    relacionados: ['inpc', 'udi', 'monte-carlo', 'horizonte-de-inversion', 'cetes'],
    alias: ['rendimiento real', 'poder de compra', 'ecuación de Fisher'],
  },

  // ─── Riesgo y desempeño ──────────────────────────────────────────────────────────────────────
  sharpe: {
    titulo: 'Razón de Sharpe',
    corto: 'Cuánto rendimiento por encima de la tasa libre de riesgo obtuviste por cada unidad de volatilidad.',
    largo: [
      'Se calcula sobre rendimientos en exceso, o sea restando a cada periodo la tasa libre de riesgo del mismo periodo, y se anualiza multiplicando por la raíz de k. En México esa tasa es el CETE a 28 días, no una constante.',
      'Es la medida más usada para comparar carteras de distinto nivel de riesgo. Su límite es que castiga igual la volatilidad de las subidas que la de las bajadas, y que con pocos datos es muy ruidosa.',
      'Un Sharpe estimado con 30 semanas no es confiable. Un Sharpe arriba de 2 sostenido en un backtest casi siempre es señal de sobreajuste, no de talento.',
    ],
    formula: 'Sharpe = promedio(r − rf) / sd(r − rf) · √k',
    comoLeer: 'Sirve para comparar, no como calificación absoluta. Compara solo contra carteras medidas en la misma moneda, mismo periodo y misma frecuencia.',
    ejemplo: 'Rendimientos semanales de 1, 2, −1, 3 y 0 por ciento con rf en cero dan 0.632 por periodo y 4.56 anualizado, un número que en la práctica no se sostiene fuera de la muestra.',
    fuente: 'Sharpe (1966), Mutual Fund Performance, Journal of Business. Revisado en Sharpe (1994).',
    relacionados: ['sortino', 'treynor', 'tasa-libre-de-riesgo', 'volatilidad', 'portafolio-tangente', 'sobreajuste'],
    alias: ['índice de Sharpe', 'ratio de Sharpe'],
  },

  sortino: {
    titulo: 'Razón de Sortino',
    corto: 'Como el Sharpe, pero solo castiga la volatilidad de las bajadas. Las subidas grandes no penalizan.',
    largo: [
      'En vez de la desviación estándar completa usa la desviación a la baja: la raíz del promedio de los cuadrados de los rendimientos en exceso negativos. Kaizen divide entre todas las n observaciones, no solo entre las negativas, que es la convención más común y la que evita inflar el número cuando hay pocas caídas.',
      'Tiene sentido cuando la distribución es asimétrica: una estrategia que a veces gana mucho no debería salir castigada por eso.',
      'Con pocas caídas en la muestra el denominador es chico y el Sortino se dispara. Si en la ventana casi no hubo periodos negativos, el número dice más del periodo que de la estrategia.',
    ],
    formula: 'DD = √( Σ min(0, r − rf)² / n );  Sortino = promedio(r − rf) · k / (DD · √k)',
    comoLeer: 'Léelo junto al Sharpe. Si el Sortino es mucho mayor, la cartera tuvo sus movimientos grandes hacia arriba.',
    ejemplo: 'Excesos de 2, −1, 3, −2 y 1 por ciento dan 0.6 por periodo y 4.33 anualizado con k = 52.',
    fuente: 'Sortino y Price (1994), Performance Measurement in a Downside Risk Framework, Journal of Investing.',
    relacionados: ['sharpe', 'volatilidad', 'drawdown-maximo', 'tasa-libre-de-riesgo'],
    alias: ['downside deviation', 'riesgo a la baja'],
  },

  'drawdown-maximo': {
    titulo: 'Caída máxima (drawdown)',
    corto: 'La peor caída desde un máximo histórico hasta el fondo siguiente, medida en porcentaje.',
    largo: [
      'El drawdown en cada fecha es el valor de la cartera dividido entre el máximo que había alcanzado hasta ese momento, menos uno. La caída máxima es el peor de todos esos valores.',
      'Es la medida de riesgo que la gente sí siente, porque es la pérdida que habrías visto en la pantalla. Junto con ella importan dos fechas más: cuánto tardó en tocar fondo y cuánto tardó en recuperar el máximo anterior, si es que lo recuperó.',
      'Recuperar es más difícil de lo que parece: una caída de 33 por ciento necesita una subida de 50 por ciento para volver al punto de partida.',
    ],
    formula: 'DD_t = V_t / max(V_0..V_t) − 1;  MDD = min(DD_t)',
    comoLeer: 'Pregúntate si habrías aguantado esa caída sin vender. Esa es la utilidad real del número.',
    ejemplo: 'Valores 100, 120, 90, 110, 80 y 130 dan una caída máxima de −33.33 por ciento, con pico en el segundo dato, fondo en el quinto y recuperación en el sexto.',
    fuente: 'Convención estándar en gestión de carteras. Magdon-Ismail y Atiya (2004) para su distribución teórica.',
    relacionados: ['calmar', 'volatilidad', 'cvar', 'perfil-de-riesgo'],
    alias: ['máxima pérdida', 'MDD', 'caída desde máximos'],
  },

  calmar: {
    titulo: 'Razón de Calmar',
    corto: 'Rendimiento compuesto anual dividido entre la caída máxima. Mide cuánto ganas por cada punto de caída sufrida.',
    largo: [
      'Es el CAGR entre el valor absoluto de la caída máxima del mismo periodo. Nació en fondos administrados, donde la caída máxima importa más que la volatilidad porque de ahí salen los retiros de los clientes.',
      'Tiene un defecto conocido: depende de un solo evento, el peor de la muestra. Si la ventana no incluyó una crisis, el Calmar sale alto por suerte, no por diseño.',
      'Se usa sobre ventanas de al menos tres años, y conviene mirarlo junto al drawdown en sí, no solo su cociente.',
    ],
    formula: 'Calmar = CAGR / |caída máxima|',
    comoLeer: 'Arriba de 1 significa que el rendimiento anual superó a la peor caída. Compáralo siempre sobre el mismo periodo.',
    ejemplo: 'Un CAGR de 12 por ciento con caída máxima de −30 por ciento da un Calmar de 0.4.',
    fuente: 'Young (1991), Calmar Ratio: A Smoother Tool, Futures Magazine.',
    relacionados: ['drawdown-maximo', 'cagr', 'sharpe'],
    alias: ['ratio de Calmar'],
  },

  var: {
    titulo: 'VaR (valor en riesgo)',
    corto: 'La pérdida que no se rebasa en el porcentaje de los casos que elijas, por ejemplo 95 de cada 100 periodos.',
    largo: [
      'El VaR al 95 por ciento contesta: cuál es la pérdida que solo se supera en 5 de cada 100 periodos. Kaizen lo calcula de dos maneras. La histórica ordena los rendimientos observados y toma el que corresponde al percentil, sin suponer ninguna distribución. La paramétrica supone una normal con el promedio y la desviación de la muestra.',
      'Las dos tienen el mismo defecto de fondo: no dicen nada de qué tan mala es la pérdida cuando sí se rebasa el umbral. Para eso está el CVaR.',
      'La versión paramétrica además subestima el riesgo de los mercados reales, que tienen colas más gordas que la normal. En las tablas de Kaizen aparecen las dos, etiquetadas.',
    ],
    formula: 'Histórico: k = ⌈n(1 − α)⌉, VaR = −r_(k) ordenado de menor a mayor.  Paramétrico: VaR = −(μ + σ·z_(1−α))',
    comoLeer: 'El VaR es un umbral, no un máximo. Con 95 por ciento de confianza, uno de cada 20 periodos lo va a rebasar, y puede rebasarlo por mucho.',
    ejemplo: 'Veinte rendimientos de −5 a +14 por ciento dan VaR histórico al 95 por ciento de 5 por ciento. Con μ = 4.5 por ciento y σ = 5.92 por ciento, el paramétrico da 5.23 por ciento.',
    fuente: 'J.P. Morgan (1996), RiskMetrics Technical Document. Jorion (2007), Value at Risk.',
    relacionados: ['cvar', 'volatilidad', 'drawdown-maximo', 'monte-carlo'],
    alias: ['valor en riesgo', 'value at risk'],
  },

  cvar: {
    titulo: 'CVaR (pérdida esperada en la cola)',
    corto: 'El promedio de las pérdidas que sí rebasan el VaR. Contesta qué tan mal te va cuando te va mal.',
    largo: [
      'También se llama pérdida esperada o expected shortfall. Si el VaR al 95 por ciento es 5 por ciento, el CVaR es el promedio de todas las pérdidas de ese 5 por ciento peor, así que siempre es mayor o igual al VaR.',
      'Tiene mejores propiedades matemáticas que el VaR: es una medida de riesgo coherente, o sea que diversificar nunca la empeora. El VaR no cumple eso.',
      'Por eso los reguladores bancarios se movieron del VaR al expected shortfall en Basilea III. En Kaizen aparece siempre junto al VaR, nunca solo.',
    ],
    formula: 'Histórico: CVaR = −promedio de los k peores rendimientos.  Normal: CVaR = −(μ − σ·φ(z)/(1 − α))',
    comoLeer: 'Es el número que sirve para dimensionar un mal escenario. Si el CVaR es mucho mayor que el VaR, la cola es pesada.',
    ejemplo: 'Con μ = 4.5 por ciento y σ = 5.92 por ciento, el CVaR paramétrico al 95 por ciento es 7.70 por ciento, contra un VaR de 5.23 por ciento.',
    fuente: 'Rockafellar y Uryasev (2000), Optimization of Conditional Value-at-Risk, Journal of Risk. Artzner y otros (1999) para la coherencia.',
    relacionados: ['var', 'drawdown-maximo', 'monte-carlo', 'diversificacion'],
    alias: ['expected shortfall', 'pérdida esperada', 'ES'],
  },

  beta: {
    titulo: 'Beta',
    corto: 'Qué tanto se mueve un activo cuando su mercado de referencia se mueve uno por ciento.',
    largo: [
      'La beta sale de una regresión de los rendimientos en exceso del activo contra los del mercado. Una beta de 1.2 quiere decir que, en promedio, el activo se movió 1.2 por ciento por cada 1 por ciento del referente.',
      'La regla que Kaizen no rompe: el referente tiene que estar en la misma moneda y en las mismas fechas. Una acción mexicana en pesos se mide contra NAFTRAC.MX, y el S&P 500 se convierte a pesos con el FIX antes de usarse como referente de una cartera en pesos. Mezclar monedas mete el tipo de cambio dentro de la beta sin avisar.',
      'La beta cambia con la ventana y con la frecuencia, y mide solo riesgo sistemático: no dice nada del riesgo propio de la empresa.',
    ],
    formula: 'β = cov(r_activo − rf, r_mercado − rf) / var(r_mercado − rf)',
    comoLeer: 'Arriba de 1 amplifica el mercado, abajo de 1 lo amortigua, negativa se mueve al revés. Mira también la R²: con R² baja, la beta explica poco.',
    ejemplo: 'Una regresión con R² de 0.97 y beta 1.65 dice que el activo amplifica al mercado y que casi todo su movimiento viene de ahí.',
    fuente: 'Sharpe (1964), Lintner (1965) y Mossin (1966), el modelo CAPM.',
    relacionados: ['beta-ajustada', 'beta-apalancada', 'alfa-jensen', 'capm', 'tracking-error'],
    alias: ['riesgo sistemático', 'beta de mercado'],
  },

  'beta-ajustada': {
    titulo: 'Beta ajustada (Blume)',
    corto: 'La beta histórica movida hacia 1, porque con el tiempo las betas tienden a acercarse al promedio del mercado.',
    largo: [
      'Blume documentó que la beta de un periodo es un predictor sesgado de la del periodo siguiente: las betas altas bajan y las bajas suben. El ajuste corrige ese sesgo con una mezcla fija.',
      'La fórmula que usa la industria, y la que usa Kaizen, es 0.67 veces la beta histórica más 0.33. Es la misma que publican Bloomberg y Value Line.',
      'Es un ajuste empírico, no una ley. Sirve para proyectar, por ejemplo dentro de un CAPM que alimenta un DCF; para describir lo que ya pasó se usa la beta cruda.',
    ],
    formula: 'β_ajustada = 0.67 · β_histórica + 0.33',
    comoLeer: 'Siempre queda entre la beta histórica y 1. Si ves las dos muy separadas, la histórica viene de una ventana con pocos datos o muy movida.',
    ejemplo: 'Una beta histórica de 1.65 ajusta a 0.67 × 1.65 + 0.33 = 1.4355.',
    fuente: 'Blume (1971), On the Assessment of Risk, Journal of Finance; y Blume (1975).',
    relacionados: ['beta', 'capm', 'dcf', 'beta-apalancada'],
    alias: ['ajuste de Blume', 'beta Bloomberg'],
  },

  'beta-apalancada': {
    titulo: 'Beta apalancada (Hamada)',
    corto: 'La beta que le corresponde a una empresa por su deuda. Sirve para pasar de la beta del sector a la de la empresa.',
    largo: [
      'Una empresa con más deuda tiene acciones más riesgosas aunque su negocio sea el mismo. La relación de Hamada separa el riesgo del negocio, la beta desapalancada, del riesgo que agrega la estructura de capital.',
      'En el DCF de Kaizen se toma una beta desapalancada del sector, se vuelve a apalancar con la deuda sobre capital de la empresa y su tasa de impuestos, y con esa beta se calcula el costo del capital.',
      'Supone que la deuda no tiene beta propia y que el escudo fiscal tiene el mismo riesgo que los activos. Son supuestos fuertes y por eso el resultado se presenta como un insumo editable, no como un dato.',
    ],
    formula: 'β_L = β_U · (1 + (1 − t) · D/E)',
    comoLeer: 'Si una empresa se ve barata solo porque su beta es baja, revisa cuánta deuda tiene. El apalancamiento sube la beta y con ella la tasa de descuento.',
    ejemplo: 'Con beta desapalancada 0.8, deuda sobre capital 0.5 y tasa 30 por ciento: 0.8 × (1 + 0.7 × 0.5) = 1.08.',
    fuente: 'Hamada (1972), The Effect of the Firm Capital Structure on the Systematic Risk of Common Stocks, Journal of Finance.',
    relacionados: ['beta', 'wacc', 'capm', 'dcf', 'deuda-capital'],
    alias: ['Hamada', 'beta desapalancada'],
  },

  'alfa-jensen': {
    titulo: 'Alfa de Jensen',
    corto: 'El rendimiento que quedó después de descontar lo que explica el mercado según la beta. Casi siempre es ruido.',
    largo: [
      'Es la ordenada al origen de la regresión de los rendimientos en exceso de la cartera contra los del mercado. Si es positiva, la cartera rindió más de lo que su beta explicaba.',
      'El problema práctico es la significancia: con pocos datos, un alfa positiva cabe dentro del error de estimación. Kaizen muestra el alfa junto con la R² y el número de periodos, justo para que se pueda juzgar.',
      'El alfa también se vuelve grande o chica según el referente que escojas. Cambiar de referente sin decirlo es la forma más fácil de fabricar alfa.',
    ],
    formula: 'r_p − rf = α + β(r_m − rf) + ε;  α anual = (1 + α)^k − 1',
    comoLeer: 'Un alfa chica con R² alta y pocos periodos no es evidencia de nada. Busca que el signo se sostenga en varias ventanas.',
    ejemplo: 'Una regresión con beta 1.65 y alfa de −0.0015 por periodo quiere decir que la cartera se quedó 15 puntos base atrás cada periodo, después de ajustar por riesgo.',
    fuente: 'Jensen (1968), The Performance of Mutual Funds in the Period 1945-1964, Journal of Finance.',
    relacionados: ['beta', 'information-ratio', 'tracking-error', 'sobreajuste'],
    alias: ['alpha', 'alfa'],
  },

  'tracking-error': {
    titulo: 'Tracking error',
    corto: 'Qué tan disparejo es el rendimiento de tu cartera contra su referente. Es la volatilidad de la diferencia.',
    largo: [
      'Se calcula como la desviación estándar de los rendimientos activos, que son la diferencia entre cartera y referente periodo a periodo, anualizada con la raíz de k.',
      'Un fondo indizado busca un tracking error cercano a cero. Una cartera personal que se aparta mucho del referente tiene tracking error alto, y eso no es bueno ni malo: solo dice cuánto te estás separando.',
      'Es el denominador del information ratio, y por eso los dos se leen juntos.',
    ],
    formula: 'TE = sd(r_cartera − r_referente) · √k',
    comoLeer: 'Un TE de 4 por ciento anual quiere decir que dos de cada tres años tu cartera terminaría dentro de ±4 puntos del referente, si la diferencia se comportara normal.',
    ejemplo: 'Diferencias semanales de 1, −0.5, 0.2 y 0.3 por ciento dan un tracking error anual de 4.43 por ciento.',
    fuente: 'Grinold y Kahn (1999), Active Portfolio Management, capítulo 5.',
    relacionados: ['information-ratio', 'alfa-jensen', 'beta', 'rendimiento-total'],
    alias: ['error de seguimiento', 'riesgo activo'],
  },

  'information-ratio': {
    titulo: 'Information ratio',
    corto: 'Rendimiento activo anual dividido entre el tracking error. Mide qué tan eficiente fue separarse del referente.',
    largo: [
      'Es al rendimiento activo lo que el Sharpe es al rendimiento total: cuánto ganaste por unidad de riesgo asumido, solo que aquí el riesgo es apartarse del referente y no la volatilidad completa.',
      'Grinold y Kahn lo descomponen en habilidad por raíz de amplitud: para sostener un information ratio alto hace falta acertar seguido o apostar muchas veces. Los valores altos en muestras cortas no se sostienen.',
      'Como el alfa, depende por completo del referente elegido, y por eso Kaizen siempre lo muestra con el nombre del referente al lado.',
    ],
    formula: 'IR = promedio(r_activo) · k / TE',
    comoLeer: 'Arriba de 0.5 sostenido durante años ya es mucho. Abajo de 0, te separaste del referente y saliste perdiendo.',
    ejemplo: 'Un rendimiento activo semanal promedio de 0.25 por ciento con tracking error de 4.43 por ciento anual da un IR de 2.94, que en una muestra de cuatro semanas no significa nada.',
    fuente: 'Grinold y Kahn (1999), Active Portfolio Management, la ley fundamental de la gestión activa.',
    relacionados: ['tracking-error', 'alfa-jensen', 'sharpe', 'sobreajuste'],
    alias: ['IR', 'razón de información'],
  },

  treynor: {
    titulo: 'Razón de Treynor',
    corto: 'Rendimiento en exceso por cada unidad de beta, no de volatilidad. Sirve para una parte de una cartera mayor.',
    largo: [
      'La diferencia con el Sharpe está en el denominador: Treynor divide entre la beta y Sharpe entre la volatilidad total. Treynor supone que el riesgo propio de cada activo ya se diversificó dentro de una cartera más grande.',
      'Por eso tiene sentido para juzgar un componente dentro de una cartera diversificada, y no tanto para juzgar la cartera entera de alguien que solo tiene eso.',
      'Si la beta es cercana a cero o negativa, el cociente se vuelve inestable y deja de tener lectura. Kaizen lo deja en s/d en ese caso.',
    ],
    formula: 'Treynor = (promedio(r) − rf) · k / β',
    comoLeer: 'Compáralo entre activos medidos contra el mismo referente. Solo es comparable dentro de una misma cartera.',
    ejemplo: 'Un fondo con 14 por ciento anual, rf de 11 por ciento y beta 1.2 da un Treynor de 2.5 por ciento por unidad de beta.',
    fuente: 'Treynor (1965), How to Rate Management of Investment Funds, Harvard Business Review.',
    relacionados: ['sharpe', 'beta', 'capm', 'alfa-jensen'],
    alias: ['índice de Treynor'],
  },

  'razon-de-captura': {
    titulo: 'Razón de captura',
    corto: 'Qué porcentaje de las subidas y de las bajadas del referente se llevó tu cartera.',
    largo: [
      'Se calculan dos números. La captura al alza compara el rendimiento acumulado de tu cartera contra el del referente, tomando solo los periodos en que el referente subió. La captura a la baja hace lo mismo con los periodos en que bajó.',
      'Una cartera defensiva típica tiene captura al alza de 85 por ciento y a la baja de 70 por ciento: sube menos, pero cae bastante menos.',
      'Son descriptivos, no predictivos. Dependen de cuántos periodos de cada signo hubo en la ventana, y una ventana sin caídas grandes deja la captura a la baja sin sustento.',
    ],
    formula: 'Captura alza = r_cartera(periodos con referente > 0) / r_referente(esos periodos); análogo a la baja',
    comoLeer: 'Lo interesante es la diferencia entre las dos. Captura al alza mayor que a la baja es el perfil que casi todo el mundo busca.',
    ejemplo: 'Captura al alza 90 por ciento y a la baja 60 por ciento quiere decir que en las subidas te quedaste un poco atrás y en las caídas perdiste bastante menos.',
    fuente: 'Convención de la industria. Morningstar, Upside and Downside Capture Ratio methodology.',
    relacionados: ['beta', 'tracking-error', 'drawdown-maximo', 'baja-volatilidad'],
    alias: ['upside capture', 'downside capture'],
  },

  'tasa-libre-de-riesgo': {
    titulo: 'Tasa libre de riesgo',
    corto: 'El rendimiento de un instrumento sin riesgo de crédito al plazo que te interesa. En México, el CETE a 28 días.',
    largo: [
      'Es el punto de partida de casi todo: el Sharpe, el CAPM, el portafolio tangente y el DCF la usan. Libre de riesgo quiere decir sin riesgo de que no te paguen, no sin riesgo de que la inflación se coma el rendimiento.',
      'El plazo importa. Para medir rendimientos semanales de una cartera la referencia correcta es una tasa corta, el CETE a 28 días convertido al plazo del periodo, no el bono M a 10 años. Usar el bono largo infla artificialmente el riesgo percibido de la cartera y desinfla el Sharpe.',
      'Kaizen la trae como serie con fecha, no como constante. Si Banxico no responde, cae al respaldo de FRED y la pantalla lo marca como respaldo. Nunca hay un 8.6 por ciento fijo escondido en el código.',
    ],
    formula: 'rf por periodo de d días = (1 + y · 28/360)^(d/28) − 1, con y la tasa anual del CETE 28',
    comoLeer: 'Revisa la fecha del dato. Una tasa libre de riesgo de hace seis meses cambia el Sharpe y el DCF de forma visible.',
    ejemplo: 'Con CETE 28 al 11 por ciento, la tasa de una semana es 0.21321 por ciento y la efectiva anual 11.7455 por ciento.',
    fuente: 'Banxico, SIE, CETES a 28 días. Respaldo: FRED, serie IR3TIB01MXM156N.',
    relacionados: ['cetes', 'sharpe', 'capm', 'bono-m', 'dato-de-respaldo'],
    alias: ['rf', 'tasa sin riesgo'],
  },

  'contribucion-al-riesgo': {
    titulo: 'Contribución al riesgo',
    corto: 'Cuánto de la volatilidad total de la cartera aporta cada posición, que no es lo mismo que cuánto pesa.',
    largo: [
      'Una posición puede pesar 10 por ciento del dinero y aportar 30 por ciento del riesgo, si es volátil y se mueve junto con el resto. La contribución al riesgo reparte la volatilidad de la cartera entre las posiciones y siempre suma 100 por ciento.',
      'Se calcula con la contribución marginal, que es cuánto sube la volatilidad si le agregas un peso más a esa posición, multiplicada por su peso actual.',
      'Es la lectura que corrige la ilusión de estar diversificado: pesos parejos con correlaciones altas concentran riesgo aunque la tabla de pesos se vea equilibrada.',
    ],
    formula: 'CM_i = (C w)_i / σ_p;  contribución_i = w_i · CM_i;  Σ contribuciones = σ_p, con C la matriz de covarianzas',
    comoLeer: 'Compara la columna de peso contra la de riesgo. Donde la segunda es mucho mayor está tu concentración real.',
    ejemplo: 'Dos activos al 50 por ciento con volatilidades de 20 y 30 por ciento y correlación cero aportan 30.8 y 69.2 por ciento del riesgo, no 50 y 50.',
    fuente: 'Maillard, Roncalli y Teiletche (2010), The Properties of Equally Weighted Risk Contribution Portfolios, Journal of Portfolio Management.',
    relacionados: ['paridad-de-riesgo', 'numero-efectivo-de-activos', 'covarianza', 'diversificacion'],
    alias: ['risk contribution', 'contribución marginal'],
  },

  'numero-efectivo-de-activos': {
    titulo: 'Número efectivo de activos',
    corto: 'Cuántas posiciones realmente equivalentes tienes, contando por peso. Diez posiciones muy desiguales pueden valer tres.',
    largo: [
      'Es el inverso de la suma de los pesos al cuadrado. Si tienes diez posiciones con el mismo peso, da diez. Si una pesa 90 por ciento y las otras nueve se reparten el resto, da poco más de uno.',
      'Mide concentración por peso, no por riesgo. Una cartera con número efectivo alto puede seguir concentrada si todas sus posiciones son del mismo sector, y para eso está la contribución al riesgo.',
      'Es el mismo cálculo que el índice de Herfindahl invertido, que se usa en competencia económica.',
    ],
    formula: 'N_efectivo = 1 / Σ w_i²',
    comoLeer: 'Si tu número efectivo es mucho menor que tu número de posiciones, la cartera depende de pocas apuestas.',
    ejemplo: 'Pesos de 50, 30 y 20 por ciento dan 1 / (0.25 + 0.09 + 0.04) = 2.63 activos efectivos, no 3.',
    fuente: 'Derivado del índice de Herfindahl y Hirschman. Roncalli (2013), Introduction to Risk Parity and Budgeting.',
    relacionados: ['hhi', 'diversificacion', 'contribucion-al-riesgo', 'rebalanceo'],
    alias: ['N efectivo', 'concentración'],
  },

  hhi: {
    titulo: 'Índice HHI de concentración',
    corto: 'La suma de los pesos al cuadrado. Va de casi cero, muy repartido, a uno, todo en una sola posición.',
    largo: [
      'El HHI viene del análisis de competencia entre empresas y se usa igual para carteras: eleva cada peso al cuadrado y súmalos. Los pesos grandes dominan porque el cuadrado los agranda.',
      'Kaizen lo aplica a pesos por emisora, por sector, por país y por moneda. La concentración por moneda importa mucho en México: una cartera de puro S&P 500 tiene 100 por ciento de exposición al dólar aunque tenga 500 emisoras.',
      'Es el recíproco del número efectivo de activos, así que los dos dicen lo mismo en escalas distintas.',
    ],
    formula: 'HHI = Σ w_i²;  N_efectivo = 1 / HHI',
    comoLeer: 'Abajo de 0.10 se considera repartido y arriba de 0.25 concentrado, con los mismos cortes que usa la autoridad de competencia.',
    ejemplo: 'Pesos de 50, 30 y 20 por ciento dan HHI de 0.38, o sea concentrado.',
    fuente: 'Hirschman (1945) y Herfindahl (1950). Usado por la Comisión Federal de Competencia Económica.',
    relacionados: ['numero-efectivo-de-activos', 'diversificacion', 'contribucion-al-riesgo'],
    alias: ['Herfindahl', 'concentración de cartera'],
  },

  diversificacion: {
    titulo: 'Diversificación',
    corto: 'Repartir el dinero entre activos que no se mueven igual, para bajar el riesgo sin bajar el rendimiento esperado en la misma proporción.',
    largo: [
      'Es el único resultado de la teoría de carteras que se parece a algo gratis: mientras la correlación entre dos activos sea menor que uno, la volatilidad de la mezcla es menor que el promedio de las volatilidades.',
      'Lo que la diversificación sí quita es el riesgo propio de cada emisora. Lo que no quita es el riesgo del mercado entero, que es justo lo que mide la beta.',
      'Diversificar no es tener muchas posiciones: es tener posiciones distintas. Treinta emisoras mexicanas del mismo sector están menos diversificadas que tres activos de regiones, monedas y sectores diferentes.',
    ],
    formula: 'σ_cartera² = Σ_i Σ_j w_i w_j σ_i σ_j ρ_ij, menor que (Σ w_i σ_i)² siempre que algún ρ < 1',
    comoLeer: 'Mira el número efectivo de activos, el mapa de correlaciones y la exposición por moneda y sector, no solo cuántas filas tiene la tabla.',
    ejemplo: 'Dos activos con volatilidad de 20 y 30 por ciento y correlación cero combinan en 16.64 por ciento, debajo de los dos.',
    fuente: 'Markowitz (1952), Portfolio Selection, Journal of Finance.',
    relacionados: ['correlacion', 'numero-efectivo-de-activos', 'minima-varianza', 'beta', 'rebalanceo'],
    alias: ['diversificar', 'no poner todo en una'],
  },

  // ─── Optimización de carteras ────────────────────────────────────────────────────────────────
  'ledoit-wolf': {
    titulo: 'Contracción de Ledoit y Wolf',
    corto: 'Mezclar la matriz de covarianzas observada con una estructura simple, para quitarle el ruido que engaña al optimizador.',
    largo: [
      'Con 60 semanas y 20 activos hay 210 covarianzas que estimar y muy poco dato para cada una. La matriz muestral queda llena de ruido, y el optimizador, que busca el mínimo, escoge justo los pares donde el ruido dice correlación baja. El resultado se ve precioso en la muestra y se cae fuera de ella.',
      'La contracción resuelve esto jalando la matriz muestral hacia un objetivo estructurado, en este caso una matriz de correlación constante: todas las parejas comparten la correlación promedio. El peso de la mezcla, delta, se elige con una fórmula cerrada que minimiza el error cuadrático esperado.',
      'El resultado siempre es una matriz positiva definida, que es la condición para que el optimizador se comporte. Kaizen usa el mismo objetivo de correlación constante que PyPortfolioOpt y lo verifica contra él con tolerancia de 1e−10.',
    ],
    formula: 'C_contraída = δ · F + (1 − δ) · S, con S la muestral, F la de correlación constante y δ en [0, 1]',
    comoLeer: 'Un delta alto quiere decir que tus datos traen poca información y que la matriz se está apoyando en la estructura. Es una señal de que la ventana es corta para tantos activos.',
    ejemplo: 'Con un panel de 60 semanas y 5 activos, delta suele quedar entre 0.2 y 0.5: entre un quinto y la mitad de la matriz viene de la estructura, no de los datos.',
    fuente: 'Ledoit y Wolf (2004), Honey, I Shrunk the Sample Covariance Matrix, Journal of Portfolio Management.',
    relacionados: ['covarianza', 'correlacion', 'minima-varianza', 'frontera-eficiente', 'sobreajuste'],
    alias: ['shrinkage', 'contracción de covarianzas'],
  },

  'frontera-eficiente': {
    titulo: 'Frontera eficiente',
    corto: 'El conjunto de carteras que dan el mayor rendimiento esperado para cada nivel de riesgo.',
    largo: [
      'Markowitz mostró que, dados los rendimientos esperados y la matriz de covarianzas, hay una curva de carteras que nadie puede mejorar: para subir el rendimiento hay que aceptar más volatilidad. Todo lo que queda debajo de la curva es ineficiente.',
      'La frontera es tan buena como sus insumos. Los rendimientos esperados son la parte frágil: estimarlos con el promedio histórico produce carteras extremas y poco estables. Por eso Kaizen usa por omisión rendimientos esperados del CAPM, rf más beta por prima, y deja el promedio histórico detrás de una advertencia visible.',
      'La frontera de Kaizen es solo largo, con pesos entre un mínimo y un máximo por activo, y se traza con 30 carteras entre la de mínima varianza y la de máximo rendimiento.',
    ],
    formula: 'min wᵀCw sujeto a wᵀμ = objetivo, Σw_i = 1, l ≤ w ≤ u',
    comoLeer: 'Tu cartera actual se dibuja como un punto. Qué tan lejos está de la curva es lo interesante, no el punto exacto de la curva al que deberías moverte.',
    ejemplo: 'Con dos activos de volatilidad 20 y 30 por ciento y correlación cero, la frontera va de la cartera de mínima varianza, con 69.23 por ciento en el primero, hasta 100 por ciento en el segundo.',
    fuente: 'Markowitz (1952), Portfolio Selection, Journal of Finance. Sobre su fragilidad, Michaud (1989).',
    relacionados: ['minima-varianza', 'portafolio-tangente', 'ledoit-wolf', 'capm', 'paridad-de-riesgo'],
    alias: ['frontera de Markowitz', 'optimizador'],
  },

  'minima-varianza': {
    titulo: 'Cartera de mínima varianza',
    corto: 'La combinación con la menor volatilidad posible, sin usar ningún rendimiento esperado.',
    largo: [
      'Es el único punto de la frontera que no necesita estimar rendimientos esperados: solo usa la matriz de covarianzas. Como los rendimientos esperados son lo más difícil de estimar, esta cartera suele ser la más estable de todas fuera de muestra.',
      'Tiende a cargarse hacia los activos menos volátiles y hacia los que se mueven al revés que el resto. Con restricciones de peso máximo el resultado se reparte más.',
      'Menor volatilidad no quiere decir mayor rendimiento. Es un punto de partida, y en la pantalla se compara siempre contra la cartera de pesos iguales y contra la tuya.',
    ],
    formula: 'min wᵀCw sujeto a Σw_i = 1, l ≤ w ≤ u',
    comoLeer: 'Si el optimizador pone casi todo en un activo, revisa la ventana y el delta de contracción antes de creerle.',
    ejemplo: 'Volatilidades de 20 y 30 por ciento con correlación cero dan 69.23 y 30.77 por ciento, con volatilidad de cartera de 16.64 por ciento. Con correlación 0.5 el primero sube a 85.71 por ciento.',
    fuente: 'Markowitz (1952). Evidencia fuera de muestra en Clarke, de Silva y Thorley (2006).',
    relacionados: ['frontera-eficiente', 'ledoit-wolf', 'paridad-de-riesgo', 'baja-volatilidad'],
    alias: ['min var', 'mínima volatilidad'],
  },

  'portafolio-tangente': {
    titulo: 'Portafolio tangente',
    corto: 'La cartera con el mayor Sharpe posible: la que toca la frontera desde la tasa libre de riesgo.',
    largo: [
      'Si puedes prestar y pedir prestado a la tasa libre de riesgo, todas las carteras eficientes son mezclas del activo sin riesgo con una sola cartera de activos riesgosos: la tangente. Cambiar tu nivel de riesgo es cambiar la proporción entre las dos, no cambiar de cartera.',
      'Es el punto de la frontera más sensible a los rendimientos esperados. Un cambio chico en una expectativa mueve mucho los pesos, y por eso Kaizen la presenta junto a la de mínima varianza y la de paridad de riesgo, no sola.',
      'Kaizen la encuentra recorriendo la frontera y afinando con búsqueda de sección dorada sobre el Sharpe, con las mismas restricciones de peso.',
    ],
    formula: 'max (wᵀμ − rf) / √(wᵀCw) sujeto a Σw_i = 1, l ≤ w ≤ u',
    comoLeer: 'Míralo como el extremo agresivo del rango de respuestas del optimizador, no como la respuesta.',
    ejemplo: 'Con rendimientos esperados de 10 y 15 por ciento, volatilidades de 20 y 30 por ciento, correlación cero y rf de 5 por ciento, la tangente es 52.94 y 47.06 por ciento, con Sharpe de 0.4167.',
    fuente: 'Tobin (1958), Liquidity Preference as Behavior Towards Risk. Sharpe (1964) para su papel en el CAPM.',
    relacionados: ['sharpe', 'frontera-eficiente', 'tasa-libre-de-riesgo', 'capm', 'minima-varianza'],
    alias: ['máximo Sharpe', 'cartera de mercado'],
  },

  'paridad-de-riesgo': {
    titulo: 'Paridad de riesgo',
    corto: 'Repartir para que cada posición aporte la misma cantidad de riesgo, en vez de el mismo peso en pesos.',
    largo: [
      'En vez de fijar pesos iguales, la paridad de riesgo fija contribuciones al riesgo iguales. Los activos volátiles reciben menos dinero y los tranquilos más, hasta que todos aportan lo mismo a la volatilidad total.',
      'Como la de mínima varianza, no usa rendimientos esperados, así que es estable. A diferencia de ella, no concentra: nunca deja a un activo en cero.',
      'Kaizen la calcula con descenso coordinado cíclico hasta que las contribuciones coinciden dentro de 1e−8. El resultado suele quedar entre la cartera de pesos iguales y la de mínima varianza.',
    ],
    formula: 'Encontrar w tal que w_i · (C w)_i sea igual para todo i, con Σw_i = 1 y w ≥ 0',
    comoLeer: 'Si el resultado se parece mucho a pesos iguales, tus activos tienen volatilidades parecidas. Si no, la diferencia te dice cuál era el que dominaba.',
    ejemplo: 'Dos activos con volatilidad 20 y 30 por ciento y correlación cero dan 60 y 40 por ciento, en proporción inversa a sus volatilidades.',
    fuente: 'Maillard, Roncalli y Teiletche (2010), The Properties of Equally Weighted Risk Contribution Portfolios.',
    relacionados: ['contribucion-al-riesgo', 'minima-varianza', 'frontera-eficiente', 'diversificacion'],
    alias: ['risk parity', 'ERC'],
  },

  'walk-forward': {
    titulo: 'Validación walk forward',
    corto: 'Probar una estrategia estimando con datos viejos y midiendo con datos que el modelo nunca vio.',
    largo: [
      'Funciona así: se toma una ventana de estimación, por ejemplo 156 semanas, se calculan los pesos con esos datos y nada más, se aplican durante el periodo siguiente, por ejemplo 13 semanas, y se anota el resultado. Luego la ventana se recorre y se repite.',
      'Todo lo que el resultado reporta es fuera de muestra, así que no hay forma de que el futuro se filtre al pasado. Kaizen lo prueba con una estrategia espía que falla si alguna vez se le entrega un dato posterior al inicio del periodo de aplicación.',
      'El rendimiento walk forward casi siempre es peor que el del optimizador visto en la muestra completa, y esa diferencia es justo lo que hay que saber antes de creerle a una optimización.',
    ],
    formula: 'Para cada bloque t: w_t = método(datos hasta t − 1);  resultado_t = w_t · rendimientos del bloque t',
    comoLeer: 'Compara el resultado walk forward contra el del mismo método visto en toda la muestra. La brecha es tu medida de sobreajuste.',
    ejemplo: 'Una optimización que muestra Sharpe de 1.4 en la muestra completa y 0.6 en walk forward está diciendo que la mayor parte del 1.4 era ajuste al pasado.',
    fuente: 'Pardo (2008), The Evaluation and Optimization of Trading Strategies, capítulo 11.',
    relacionados: ['sobreajuste', 'frontera-eficiente', 'backtest-sesgos', 'ledoit-wolf'],
    alias: ['fuera de muestra', 'out of sample'],
  },

  sobreajuste: {
    titulo: 'Sobreajuste',
    corto: 'Cuando un modelo aprende el ruido del pasado en vez del patrón, y por eso se ve bien en la prueba y mal en la realidad.',
    largo: [
      'Mientras más combinaciones pruebas sobre los mismos datos, más fácil es encontrar una que se vea excelente por pura casualidad. Bailey y sus coautores mostraron que con suficientes intentos siempre aparece un backtest con Sharpe alto, aunque la estrategia no tenga nada.',
      'Las señales típicas son parámetros muy específicos, resultados que se caen al mover una fecha por un mes, y desempeño que depende de dos o tres operaciones.',
      'Las defensas que usa Kaizen son tres: validar walk forward, mostrar cuántas configuraciones se probaron, y presentar los resultados de un backtest como una descripción de lo que ya pasó, nunca como una proyección.',
    ],
    formula: 'Sin fórmula. La prueba práctica es que el desempeño fuera de muestra se parezca al de dentro de muestra.',
    comoLeer: 'Desconfía de cualquier resultado que dependa de un parámetro exacto o de una fecha exacta. La robustez se ve moviendo las cosas y viendo que casi no cambien.',
    ejemplo: 'Probar 200 combinaciones de parámetros y quedarte con la mejor produce, en promedio, un Sharpe aparente alto aunque los datos sean ruido puro.',
    fuente: 'Bailey, Borwein, López de Prado y Zhu (2014), The Probability of Backtest Overfitting, Journal of Computational Finance. Harvey, Liu y Zhu (2016).',
    relacionados: ['walk-forward', 'backtest-sesgos', 'sharpe', 'information-ratio'],
    alias: ['overfitting', 'sobreoptimización'],
  },

  'backtest-sesgos': {
    titulo: 'Sesgos de un backtest',
    corto: 'Las trampas que hacen que una estrategia probada sobre el pasado se vea mejor de lo que fue.',
    largo: [
      'Tres son las más comunes. Sesgo de supervivencia: probar sobre las empresas que hoy siguen listadas deja fuera a las que quebraron. Mirada al futuro: usar un dato que en esa fecha todavía no se publicaba, como un reporte trimestral que salió dos meses después. Pesos de hoy aplicados al pasado: reconstruir la historia con la cartera que tienes ahora en vez de la que tenías entonces.',
      'A eso se suman los costos. Un backtest sin comisiones, sin diferencial de compra y venta y sin impuestos sobrestima el resultado, y más si la estrategia opera seguido.',
      'El backtest de Kaizen es comprar y mantener por omisión, avisa cuándo se están usando pesos actuales sobre historia anterior, y reporta CAGR y caída máxima juntos, no solo el rendimiento.',
    ],
    formula: 'Sin fórmula. Es una lista de verificación sobre cómo se construyó la prueba.',
    comoLeer: 'Pregunta siempre desde cuándo existe cada serie, qué pasó con las emisoras que ya no están y si los costos están dentro.',
    ejemplo: 'Un backtest de acciones mexicanas que arranca en 2010 con la lista de emisoras de hoy ya excluyó a las que se deslistaron, y eso solo puede mejorar el resultado.',
    fuente: 'Brown, Goetzmann, Ibbotson y Ross (1992), Survivorship Bias in Performance Studies, Review of Financial Studies.',
    relacionados: ['sobreajuste', 'walk-forward', 'rebalanceo', 'momentum-12-1'],
    alias: ['sesgo de supervivencia', 'look ahead'],
  },

  rebalanceo: {
    titulo: 'Rebalanceo',
    corto: 'Volver a los pesos que tú elegiste, vendiendo lo que creció de más y comprando lo que se quedó atrás.',
    largo: [
      'Sin rebalanceo, la cartera se desvía sola: lo que sube pesa cada vez más y el riesgo aumenta sin que nadie lo decida. Rebalancear es la operación mecánica de regresar a tu objetivo.',
      'Tiene costos reales: comisiones, diferencial de compra y venta y, en México, ISR sobre las ganancias que realices al vender. Por eso Kaizen calcula el rebalanceo en acciones completas, respeta un monto mínimo por operación y muestra cuánto cuesta antes de que confirmes.',
      'Las dos formas comunes son por calendario, por ejemplo cada trimestre, y por banda, cuando un peso se aleja más de cierto margen del objetivo. Ninguna es mejor en abstracto; la de banda opera menos.',
    ],
    formula: 'Desviación = Σ |w_actual − w_objetivo|; se compran acciones enteras mientras la desviación baje y alcance el efectivo',
    comoLeer: 'Es una operación aritmética para volver a TU objetivo, no una opinión sobre qué va a subir. El tamaño de la desviación te dice si vale la pena el costo.',
    ejemplo: 'Con 10,000 pesos, objetivo 50 y 50, y precios de 300 y 700, el resultado en acciones enteras es 17 del primero y 7 del segundo, sin efectivo sobrante.',
    fuente: 'Perold y Sharpe (1988), Dynamic Strategies for Asset Allocation, Financial Analysts Journal.',
    relacionados: ['diversificacion', 'costo-promedio', 'isr-ganancia-de-capital', 'numero-efectivo-de-activos'],
    alias: ['rebalancear', 'volver a pesos objetivo'],
  },

  // ─── Simulación y planeación ─────────────────────────────────────────────────────────────────
  'monte-carlo': {
    titulo: 'Simulación Monte Carlo',
    corto: 'Generar miles de futuros posibles con reglas explícitas, para ver el rango de resultados y no un solo número.',
    largo: [
      'En vez de proyectar una sola trayectoria con una tasa fija, el simulador genera miles de caminos con rendimientos aleatorios que respetan un rendimiento esperado y una volatilidad. El resultado no es un número: es una distribución, y de ahí salen los percentiles.',
      'Kaizen usa un generador de números pseudoaleatorios con semilla, así que la misma entrada da exactamente el mismo resultado. Eso permite comparar dos escenarios sin que el ruido de la simulación se confunda con la diferencia entre ellos.',
      'La simulación no predice nada. Solo traduce tus supuestos en un rango. Si el rendimiento esperado que pusiste está mal, el rango estará mal con mucha precisión.',
    ],
    formula: 'W_(t+1) = (W_t + aportación_t) · e^(ℓ_t), con ℓ_t sacado de la distribución elegida',
    comoLeer: 'Mira el percentil 5 antes que la mediana: es el escenario que tendría que aguantar tu plan. La distancia entre el 5 y el 95 es la incertidumbre real.',
    ejemplo: 'Con 100,000 pesos, 5,000 al mes durante 12 meses y volatilidad cero al 1 por ciento mensual, todos los percentiles coinciden en 176,729.14 pesos, que es la prueba de que la aritmética está bien.',
    fuente: 'Metropolis y Ulam (1949). En finanzas, Boyle (1977), Options: A Monte Carlo Approach, Journal of Financial Economics.',
    relacionados: ['lognormal', 'bootstrap-por-bloques', 'real-vs-nominal', 'horizonte-de-inversion', 'var'],
    alias: ['simulador', 'simulación'],
  },

  lognormal: {
    titulo: 'Modelo lognormal',
    corto: 'Suponer que los rendimientos continuos son normales, así que el precio nunca puede ser negativo.',
    largo: [
      'Si el logaritmo del rendimiento es normal, el precio es lognormal: siempre positivo y con la cola derecha más larga que la izquierda, que es como se comportan los precios. Componer rendimientos simples normales, en cambio, permite valores negativos imposibles.',
      'La conversión importa. Si te dicen que un activo rinde 8 por ciento anual promedio con 15 por ciento de volatilidad, los parámetros del modelo lognormal no son 8 y 15: hay que convertir, y la media logarítmica queda debajo de la aritmética por la mitad de la varianza.',
      'La limitación conocida es que los mercados reales tienen colas más gordas y periodos de volatilidad agrupada. El modelo subestima los eventos extremos, y por eso el simulador ofrece también remuestreo de historia real.',
    ],
    formula: 'σ_l² = ln(1 + s²/(1 + m)²);  μ_l = ln(1 + m) − σ_l²/2',
    comoLeer: 'La mediana de un lognormal queda por debajo de su promedio. Si solo miras el promedio de la simulación, estás mirando un escenario que más de la mitad de los caminos no alcanza.',
    ejemplo: 'Con media aritmética anual de 8 por ciento y volatilidad de 15 por ciento, los parámetros logarítmicos son μ = 0.0674078 y σ = 0.138226.',
    fuente: 'Osborne (1959), Brownian Motion in the Stock Market. Black y Scholes (1973) para el modelo continuo.',
    relacionados: ['monte-carlo', 'rendimiento-logaritmico', 'volatilidad', 'bootstrap-por-bloques'],
    alias: ['movimiento browniano geométrico', 'GBM'],
  },

  'bootstrap-por-bloques': {
    titulo: 'Remuestreo por bloques',
    corto: 'Simular tomando pedazos de la historia real en vez de sacar números de una distribución teórica.',
    largo: [
      'En vez de suponer una normal, el remuestreo por bloques corta la historia observada en tramos de varios meses y los vuelve a pegar en orden aleatorio. Así conserva cosas que el modelo teórico no tiene: colas gordas, rachas y volatilidad agrupada.',
      'El tamaño del bloque es la decisión importante. Bloques muy chicos rompen la estructura y se parecen a sacar números sueltos; bloques muy grandes repiten la historia casi tal cual y dan poca variedad.',
      'La limitación es obvia y hay que decirla: solo puede generar futuros parecidos a lo que ya pasó en la muestra. Si en tu historia no hubo una crisis, el remuestreo tampoco la va a producir.',
    ],
    formula: 'Se eligen bloques de b periodos consecutivos con reemplazo hasta cubrir el horizonte',
    comoLeer: 'Compara sus percentiles contra los del modelo lognormal. Si el remuestreo da colas más anchas, tu historia trae eventos que la normal no captura.',
    ejemplo: 'Con bloques de 6 meses y 20 años de historia mensual hay 235 bloques posibles, suficiente variedad para 10,000 caminos.',
    fuente: 'Künsch (1989), The Jackknife and the Bootstrap for General Stationary Observations, Annals of Statistics.',
    relacionados: ['monte-carlo', 'lognormal', 'backtest-sesgos', 'volatilidad'],
    alias: ['block bootstrap', 'remuestreo'],
  },

  'horizonte-de-inversion': {
    titulo: 'Horizonte de inversión',
    corto: 'Cuánto falta para que necesites el dinero. Es el dato que más cambia qué riesgo tiene sentido correr.',
    largo: [
      'El horizonte no es una preferencia, es un hecho de tu vida: el enganche es en dos años o el retiro es en treinta. De ahí sale casi todo lo demás.',
      'Con horizonte largo, la volatilidad de un año importa menos porque hay tiempo de recuperar, y la inflación importa más porque tiene décadas para erosionar. Con horizonte corto pasa al revés: una caída del 30 por ciento a un año de la meta no se recupera a tiempo.',
      'Horizonte largo no garantiza rendimiento. La idea de que las acciones siempre ganan a 20 años es un resultado de una muestra específica, y hay mercados donde no se cumplió.',
    ],
    formula: 'Sin fórmula. Es el plazo, en años, hasta el primer retiro importante.',
    comoLeer: 'Si tu horizonte es menor a tres años, el rango del simulador para un activo volátil te va a parecer incómodamente ancho. Esa es la información.',
    ejemplo: 'La misma cartera a 2 años y a 25 años produce rangos muy distintos: a corto plazo domina la volatilidad, a largo plazo domina la inflación.',
    fuente: 'Campbell y Viceira (2002), Strategic Asset Allocation. Sobre el mito del largo plazo, Dimson, Marsh y Staunton (2002).',
    relacionados: ['perfil-de-riesgo', 'monte-carlo', 'real-vs-nominal', 'drawdown-maximo'],
    alias: ['plazo', 'cuándo necesito el dinero'],
  },

  'perfil-de-riesgo': {
    titulo: 'Perfil de riesgo',
    corto: 'La combinación de cuánto riesgo puedes correr, cuánto necesitas correr y cuánto aguantas ver.',
    largo: [
      'Son tres cosas distintas que suelen confundirse. La capacidad depende de tus números: ingreso estable, fondo de emergencia, horizonte. La necesidad depende de la meta: cuánto rendimiento hace falta para llegar. La tolerancia es psicológica: qué caída puedes ver sin vender.',
      'El que manda es el menor de los tres. De nada sirve una cartera que en teoría aguantas si en la práctica vendes en el fondo, porque vender en el fondo convierte una caída temporal en una pérdida permanente.',
      'Kaizen no te asigna un perfil ni te clasifica. Lo que hace es enseñarte la caída máxima histórica y el percentil 5 del simulador, que es información más útil que una etiqueta.',
    ],
    formula: 'Sin fórmula. Se revisa contra tres preguntas: capacidad, necesidad y tolerancia.',
    comoLeer: 'Usa la caída máxima de tu cartera como prueba: si verla en rojo te haría vender, la cartera es más riesgosa de lo que te queda.',
    ejemplo: 'Una cartera con caída máxima de −35 por ciento sobre 500,000 pesos significa ver 175,000 pesos menos en la pantalla durante meses.',
    fuente: 'Marco de capacidad, necesidad y tolerancia de la CFA Institute, Private Wealth Management.',
    relacionados: ['horizonte-de-inversion', 'drawdown-maximo', 'diversificacion', 'var'],
    alias: ['tolerancia al riesgo', 'apetito de riesgo'],
  },

  // ─── Portafolio, resultados e impuestos ──────────────────────────────────────────────────────
  twr: {
    titulo: 'TWR (rendimiento ponderado por tiempo)',
    corto: 'El rendimiento de tu cartera sin que lo ensucien tus depósitos y retiros. Es el que sirve para comparar.',
    largo: [
      'Si metes dinero justo antes de una subida, tu saldo crece pero tu decisión de inversión no fue mejor. El TWR quita ese efecto: parte la historia en cada flujo, calcula el rendimiento de cada tramo y los encadena multiplicando.',
      'Es el estándar de la industria para medir a un gestor, porque el gestor no decide cuándo entra o sale el dinero del cliente. Es lo que exigen los estándares GIPS.',
      'Lo que el TWR no contesta es cuánto ganó tu dinero. Para eso está el XIRR, que sí toma en cuenta los montos y las fechas.',
    ],
    formula: 'TWR = Π (V_fin_i / (V_ini_i + flujo_i)) − 1, encadenando todos los tramos',
    comoLeer: 'Úsalo para compararte contra un índice o contra otra cartera. Para saber qué le pasó a tu dinero, mira el XIRR.',
    ejemplo: 'Una cartera que va de 100 a 110, recibe 50 de depósito, y de 160 termina en 144, tiene TWR de −1 por ciento aunque haya terminado con más dinero del que empezó.',
    fuente: 'CFA Institute, Global Investment Performance Standards (GIPS) 2020.',
    relacionados: ['xirr', 'cagr', 'rendimiento-total', 'costo-promedio'],
    alias: ['time weighted return', 'rendimiento ponderado en el tiempo'],
  },

  xirr: {
    titulo: 'XIRR (rendimiento de tu dinero)',
    corto: 'La tasa anual que hace que todos tus depósitos, retiros y el saldo final cuadren. Sí toma en cuenta cuánto y cuándo metiste.',
    largo: [
      'También se llama rendimiento ponderado por dinero o MWR. Es la tasa interna de retorno con fechas reales: se busca la tasa a la que el valor presente de todos los flujos, incluido el saldo final, es cero.',
      'Contesta la pregunta que de verdad le importa a una persona: a qué tasa creció mi dinero, considerando que fui metiendo montos distintos en momentos distintos.',
      'Kaizen lo resuelve con Newton y, si no converge, con bisección, sobre base Actual/365. Con flujos que cambian de signo varias veces puede haber más de una solución matemática; en esos casos se elige la raíz razonable y se marca.',
    ],
    formula: 'Se busca r tal que Σ flujo_i / (1 + r)^((fecha_i − fecha_0)/365) = 0',
    comoLeer: 'Compáralo contra el TWR. Si tu XIRR es mucho menor, tus aportaciones cayeron en malos momentos; si es mayor, cayeron en buenos.',
    ejemplo: 'Pagar 1,000 pesos hoy y recibir 1,100 exactamente 365 días después da un XIRR de 10 por ciento.',
    fuente: 'Convención de la función XIRR de hoja de cálculo. CFA Institute, GIPS 2020, para el rendimiento ponderado por dinero.',
    relacionados: ['twr', 'interes-compuesto', 'costo-promedio', 'cagr'],
    alias: ['MWR', 'TIR', 'tasa interna de retorno'],
  },

  'costo-promedio': {
    titulo: 'Costo promedio de adquisición',
    corto: 'El precio promedio al que compraste una emisora, que es la base para calcular ganancia o pérdida al vender.',
    largo: [
      'Si compras 10 acciones a 100 y luego 10 a 120, tu costo promedio es 110 por acción. Al vender 5 a 130, la ganancia realizada es 5 por (130 − 110) = 100 pesos, y te quedan 15 acciones con el mismo costo promedio de 110.',
      'El costo promedio es la práctica mexicana y la que el ISR de personas físicas toma como base. No es la única en el mundo: en Estados Unidos se usan también primeras entradas primeras salidas y lotes específicos, y el resultado fiscal cambia.',
      'Las comisiones de compra suman al costo y las de venta restan del producto de la venta. Un split multiplica las acciones y divide el costo promedio, sin cambiar el monto invertido.',
    ],
    formula: 'costo_promedio = (Σ cantidad_i · precio_i + comisiones) / Σ cantidad_i',
    comoLeer: 'Compara el precio actual contra tu costo promedio para ver la ganancia no realizada. La realizada solo aparece cuando vendes.',
    ejemplo: 'Compras de 10 a 100 y 10 a 120, venta de 5 a 130: ganancia realizada 100 pesos, quedan 15 acciones a costo promedio de 110. Tras un split 2 a 1, 30 acciones a 55.',
    fuente: 'LISR art. 129. Para personas morales, el costo promedio por acción de los arts. 22 y 23 LISR.',
    relacionados: ['isr-ganancia-de-capital', 'efecto-precio-efecto-fx', 'rebalanceo', 'twr'],
    alias: ['costo base', 'precio promedio de compra'],
  },

  'efecto-precio-efecto-fx': {
    titulo: 'Efecto precio contra efecto tipo de cambio',
    corto: 'Partir la ganancia de un activo en dólares en dos: lo que se movió el precio y lo que se movió el peso.',
    largo: [
      'Si compras una acción estadounidense, tu resultado en pesos tiene dos motores. El precio en dólares pudo subir, y el tipo de cambio pudo moverse. Los dos se suman y a veces se cancelan.',
      'Kaizen separa los dos con una atribución sencilla: el efecto precio es la cantidad por el cambio de precio valuado al tipo de cambio de la compra, y el efecto tipo de cambio es la cantidad por el precio final por el cambio en el tipo de cambio. Así los dos suman exactamente el total, sin término cruzado suelto.',
      'Esto importa en México más que en otros lados, porque una cartera de acciones estadounidenses puede tener un año ganador solo por la depreciación del peso, y conviene saberlo.',
    ],
    formula: 'total = q(P₁ − P₀)X₀ + q·P₁(X₁ − X₀), con X el tipo de cambio en pesos por dólar',
    comoLeer: 'Si casi todo tu resultado viene del efecto tipo de cambio, lo que tienes es una posición en dólares, no una tesis sobre la empresa.',
    ejemplo: '10 acciones de 150 a 180 dólares con el tipo de cambio de 17 a 19 pesos dan 8,700 pesos: 5,100 de precio y 3,600 de tipo de cambio.',
    fuente: 'Karnosky y Singer (1994), Global Asset Management and Performance Attribution, CFA Institute.',
    relacionados: ['tipo-de-cambio-fix', 'costo-promedio', 'hhi', 'beta'],
    alias: ['atribución de moneda', 'efecto cambiario'],
  },

  'isr-ganancia-de-capital': {
    titulo: 'ISR por ganancia de capital en bolsa',
    corto: 'En México, las personas físicas pagan 10 por ciento sobre la ganancia neta anual por vender acciones en bolsa.',
    largo: [
      'El artículo 129 de la Ley del ISR establece un pago definitivo de 10 por ciento sobre la ganancia obtenida por enajenar acciones listadas en la Bolsa Mexicana de Valores, en BIVA o en el Sistema Internacional de Cotizaciones, y también títulos que las representen.',
      'La ganancia es neta del año: las pérdidas por el mismo concepto restan a las ganancias del mismo ejercicio, y el remanente se puede amortizar contra ganancias de los diez ejercicios siguientes. El impuesto se declara en la anual, no se retiene en cada operación.',
      'Kaizen presenta esto como una estimación, siempre etiquetada. No toma en cuenta tu situación completa, otras operaciones fuera de la plataforma ni los detalles de actualización por inflación, y no sustituye a un contador.',
    ],
    formula: 'ISR estimado = 10% × max(0, Σ (producto de venta − costo actualizado) del ejercicio)',
    comoLeer: 'Es una estimación anual, no un cobro por operación. Si vendes con pérdida, esa pérdida baja el impuesto de otras ventas del mismo año.',
    ejemplo: 'Un costo de 550 pesos actualizado por un factor de 1.05 queda en 577.50. Vendido en 650, la ganancia es 72.50 y el impuesto estimado 7.25 pesos.',
    fuente: 'Ley del Impuesto sobre la Renta, art. 129. Actualización por INPC del Inegi.',
    relacionados: ['costo-promedio', 'retencion-por-dividendos', 'inpc', 'bmv', 'sic'],
    alias: ['impuesto por vender acciones', 'ganancia de capital'],
  },

  'retencion-por-dividendos': {
    titulo: 'Retención por dividendos',
    corto: 'A los dividendos de empresas mexicanas se les retiene 10 por ciento adicional, y es pago definitivo.',
    largo: [
      'Además del impuesto que la empresa ya pagó sobre sus utilidades, el artículo 140 de la Ley del ISR obliga a retener 10 por ciento adicional sobre los dividendos que las personas físicas reciben de empresas mexicanas, como pago definitivo.',
      'Con emisoras extranjeras que cotizan en el SIC el tratamiento es distinto: suele haber retención en el país de origen, por ejemplo 10 por ciento en Estados Unidos con el tratado vigente, y luego el acreditamiento en México según tu situación.',
      'Kaizen registra el dividendo bruto y muestra la retención como una línea informativa estimada. El detalle fiscal es materia de tu contador.',
    ],
    formula: 'Retención estimada = 10% × dividendo bruto de emisora mexicana',
    comoLeer: 'El rendimiento por dividendo que ves publicado es bruto. Lo que llega a tu cuenta viene ya con la retención descontada.',
    ejemplo: 'Un dividendo bruto de 1,000 pesos de una emisora mexicana deja 900 pesos en la cuenta.',
    fuente: 'Ley del Impuesto sobre la Renta, art. 140. Para extranjeras, el tratado para evitar la doble imposición que aplique.',
    relacionados: ['isr-ganancia-de-capital', 'rendimiento-por-distribucion', 'sic', 'fibra'],
    alias: ['impuesto a dividendos', 'retención 10 por ciento'],
  },

  // ─── Tasas, macro y tipo de cambio ───────────────────────────────────────────────────────────
  cetes: {
    titulo: 'CETES',
    corto: 'Certificados de la Tesorería: deuda del gobierno federal a descuento, a 28, 91, 182 y 364 días.',
    largo: [
      'Un CETE no paga cupón. Se compra debajo de su valor nominal de 10 pesos y se cobra completo al vencimiento; la diferencia es el rendimiento. La tasa que se publica está anualizada sobre base de 360 días.',
      'Es el instrumento libre de riesgo de referencia en pesos. El de 28 días es el que Kaizen usa como tasa libre de riesgo para medir carteras, porque su plazo se parece al de los periodos que se miden.',
      'El interés de un CETE es nominal: hay que restarle la inflación para saber el rendimiento real, y además paga ISR sobre el interés, con retención provisional sobre el capital según la tasa anual que fija la Ley de Ingresos.',
    ],
    formula: 'Precio = 10 / (1 + y · días/360);  tasa del periodo = (1 + y · 28/360)^(días/28) − 1',
    comoLeer: 'La tasa publicada es anual sobre 360 días. Para saber lo que pagan en el plazo real hay que convertirla, y no es lo mismo que la efectiva anual.',
    ejemplo: 'Un CETE 28 al 11 por ciento paga 0.8556 por ciento en 28 días y equivale a 11.7455 por ciento efectivo anual si se reinvierte todo el año.',
    fuente: 'Banxico, Sistema de Información Económica, valores gubernamentales. Subastas semanales de la SHCP.',
    relacionados: ['tasa-libre-de-riesgo', 'tasa-objetivo', 'bono-m', 'real-vs-nominal', 'interes-compuesto'],
    alias: ['certificados de la tesorería', 'cetes directo'],
  },

  'tasa-objetivo': {
    titulo: 'Tasa objetivo de Banxico',
    corto: 'La tasa de referencia que fija la Junta de Gobierno de Banxico para el fondeo bancario a un día.',
    largo: [
      'Es la herramienta principal de política monetaria. Banxico la anuncia en fechas preestablecidas, ocho veces al año, y desde ahí se transmite al resto de las tasas: el fondeo, la TIIE, los CETES cortos y, con más rezago, los créditos.',
      'Cuando la inflación se aleja del objetivo de 3 por ciento más menos un punto, Banxico sube la tasa para enfriar la demanda, y la baja cuando puede. Ese es el mandato constitucional: procurar el poder adquisitivo de la moneda.',
      'Para una cartera, la tasa objetivo mueve dos cosas a la vez: cuánto paga el dinero sin riesgo y a qué tasa se descuentan los flujos futuros de las empresas. Por eso un alza pega en la valuación aunque las utilidades no cambien.',
    ],
    formula: 'Sin fórmula. Es una decisión de la Junta de Gobierno, anunciada en puntos base.',
    comoLeer: 'Lo que mueve los mercados casi nunca es la decisión, sino la sorpresa contra lo esperado y el tono del comunicado.',
    ejemplo: 'Un recorte de 25 puntos base lleva la tasa de 8.00 a 7.75 por ciento.',
    fuente: 'Banxico, serie SF61745 del SIE. Anuncios de política monetaria.',
    relacionados: ['tiie', 'cetes', 'puntos-base', 'curva-de-rendimientos', 'inpc'],
    alias: ['tasa de referencia', 'tasa de Banxico'],
  },

  tiie: {
    titulo: 'TIIE',
    corto: 'La tasa de interés interbancaria de equilibrio: a cuánto se prestan los bancos entre sí en pesos.',
    largo: [
      'Banxico calcula y publica la TIIE con las cotizaciones que le mandan los bancos. Históricamente la referencia fue la TIIE a 28 días, y es la que trae pegada buena parte de los créditos en México, desde hipotecas hasta créditos a empresas.',
      'Desde hace unos años Banxico promueve la TIIE de Fondeo a un día, construida con operaciones reales y no con cotizaciones, como la referencia nueva, y la de 28 días va de salida por etapas. En las pantallas de Kaizen aparecen las dos, con su nombre completo.',
      'La TIIE se mueve casi pegada a la tasa objetivo, con un diferencial chico. Cuando ese diferencial se abre, suele ser señal de tensión en la liquidez bancaria.',
    ],
    formula: 'Sin fórmula pública cerrada: Banxico la determina con el procedimiento del anexo 1 de su circular correspondiente.',
    comoLeer: 'Si tu crédito dice TIIE más 3 puntos, tu tasa se mueve con ella. Un alza de la tasa objetivo llega a tu pago con un mes de retraso.',
    ejemplo: 'Con TIIE 28 en 8.20 por ciento, un crédito a TIIE más 3.5 puntos cobra 11.70 por ciento anual.',
    fuente: 'Banxico, Sistema de Información Económica. Circulares de Banxico sobre TIIE y TIIE de Fondeo.',
    relacionados: ['tasa-objetivo', 'cetes', 'puntos-base', 'bono-m'],
    alias: ['tasa interbancaria', 'TIIE de fondeo'],
  },

  udi: {
    titulo: 'UDI',
    corto: 'Unidad de Inversión: una unidad de cuenta que se actualiza con la inflación, así que su valor en pesos sube con el INPC.',
    largo: [
      'La UDI se creó en 1995 para que existieran contratos y deuda en términos reales. Su valor en pesos se ajusta diariamente siguiendo el INPC quincenal, así que un monto en UDIs conserva poder de compra.',
      'Hay deuda del gobierno denominada en UDIs, los Udibonos, que pagan una tasa real fija sobre un principal que crece con la inflación. Comparar la tasa de un bono M contra la de un Udibono del mismo plazo da la inflación implícita que el mercado espera.',
      'Para una persona, la UDI sirve como vara de medir: si tu cartera creció menos que la UDI, perdiste poder adquisitivo aunque el saldo en pesos sea mayor.',
    ],
    formula: 'Valor de la UDI del día, interpolado a partir de la variación del INPC quincenal',
    comoLeer: 'Divide tu saldo entre el valor de la UDI en dos fechas. Si el cociente creció, ganaste en términos reales.',
    ejemplo: 'Si la UDI pasó de 8.20 a 8.57 pesos en un año, la inflación de ese periodo fue de 4.5 por ciento.',
    fuente: 'Banxico, valor de la UDI, publicado en el Diario Oficial de la Federación.',
    relacionados: ['inpc', 'real-vs-nominal', 'bono-m', 'cetes'],
    alias: ['unidad de inversión', 'udis'],
  },

  inpc: {
    titulo: 'INPC',
    corto: 'Índice Nacional de Precios al Consumidor: la medida oficial de la inflación en México, que publica el Inegi.',
    largo: [
      'El INPC sigue el precio de una canasta de bienes y servicios representativa del gasto de los hogares. Se publica cada quincena y con él se calcula la inflación mensual y la anual.',
      'Sirve para mucho más que informar: con él se actualizan las UDIs, se indexa el costo fiscal de algunas operaciones, se ajustan contratos y se mide el rendimiento real de cualquier inversión en pesos.',
      'La inflación subyacente, que excluye los precios más volátiles como energéticos y agropecuarios, es la que Banxico mira más de cerca para decidir su tasa, porque refleja mejor la tendencia.',
    ],
    formula: 'Inflación anual = INPC_mes / INPC_mismo mes del año anterior − 1',
    comoLeer: 'La cifra que sale en las noticias suele ser la anual. La quincenal es más ruidosa y no se debe anualizar de golpe.',
    ejemplo: 'Un INPC que pasa de 133.5 a 139.4 en doce meses implica una inflación anual de 4.42 por ciento.',
    fuente: 'Inegi, Índice Nacional de Precios al Consumidor. Publicado también en el SIE de Banxico.',
    relacionados: ['udi', 'real-vs-nominal', 'tasa-objetivo', 'isr-ganancia-de-capital'],
    alias: ['inflación', 'índice de precios'],
  },

  'bono-m': {
    titulo: 'Bono M',
    corto: 'Deuda del gobierno federal en pesos a tasa fija, con cupón cada 182 días y plazos de 3 a 30 años.',
    largo: [
      'Los bonos M son el instrumento de referencia de la curva larga en pesos. Su precio se mueve al revés de su tasa: si las tasas suben, el precio del bono que ya tenías baja, y más mientras más largo sea.',
      'Un error común es usar el bono M a 10 años como tasa libre de riesgo para medir una cartera. No lo es para ese propósito: tiene riesgo de tasa, y su plazo no corresponde al de los rendimientos que se están midiendo. Para eso está el CETE a 28 días.',
      'Donde el bono M sí es la referencia correcta es en la valuación de flujos largos, por ejemplo en un DCF en pesos, donde el horizonte del descuento se parece al del bono.',
    ],
    formula: 'Precio = Σ cupón / (1 + y/2)^t + nominal / (1 + y/2)^n, con cupones semestrales',
    comoLeer: 'La tasa que ves es el rendimiento al vencimiento si lo conservas hasta el final. Si lo vendes antes, tu resultado depende del precio del día.',
    ejemplo: 'Un alza de 100 puntos base en la tasa hace caer el precio de un bono a 10 años alrededor de 7 por ciento, según su duración.',
    fuente: 'Banxico y SHCP, valores gubernamentales a tasa fija.',
    relacionados: ['curva-de-rendimientos', 'cetes', 'tasa-libre-de-riesgo', 'udi', 'puntos-base'],
    alias: ['bonos del gobierno', 'tasa fija'],
  },

  'curva-de-rendimientos': {
    titulo: 'Curva de rendimientos',
    corto: 'Las tasas del mismo emisor ordenadas por plazo. Su forma resume lo que el mercado espera de tasas y crecimiento.',
    largo: [
      'Normalmente la curva sube: prestar a más plazo paga más, porque hay más incertidumbre. Una curva plana dice que el mercado ya no ve mucha diferencia entre plazos, y una curva invertida, con las tasas cortas arriba de las largas, dice que espera recortes.',
      'La curva invertida tiene un historial notable como aviso de recesión en Estados Unidos, documentado por Estrella y Mishkin. Es una correlación histórica, no una ley, y su plazo de anticipación es largo y variable.',
      'Kaizen muestra la curva mexicana con CETES y bonos M, y la estadounidense con los plazos de 3 meses, 2 años y 10 años, siempre con la fecha del dato.',
    ],
    formula: 'Se grafica el rendimiento al vencimiento contra el plazo, para el mismo emisor y la misma moneda',
    comoLeer: 'Lo informativo son los diferenciales entre plazos y su cambio en el tiempo, no el nivel absoluto de un punto.',
    ejemplo: 'Con CETE 28 en 8.00, bono a 2 años en 8.40 y a 10 años en 9.20 por ciento, la curva está con pendiente positiva.',
    fuente: 'Estrella y Mishkin (1998), Predicting U.S. Recessions, Review of Economics and Statistics.',
    relacionados: ['spread-10a-2a', 'bono-m', 'cetes', 'puntos-base'],
    alias: ['yield curve', 'estructura de plazos'],
  },

  'spread-10a-2a': {
    titulo: 'Diferencial 10 años menos 2 años',
    corto: 'La tasa del bono a 10 años menos la del de 2 años. Cuando es negativa, la curva está invertida.',
    largo: [
      'Es la forma más citada de resumir la pendiente de la curva en un solo número. Se reporta en puntos base y se sigue sobre todo en el mercado estadounidense.',
      'Una inversión, o sea un diferencial negativo, ha precedido a todas las recesiones estadounidenses desde 1960, con un rezago que va de seis meses a dos años. También ha dado falsas alarmas, y la relación se ha discutido mucho desde que los bancos centrales compran bonos largos.',
      'En México la curva es menos usada como indicador adelantado, entre otras cosas porque la prima de riesgo país y el tipo de cambio la mueven por razones distintas al ciclo interno.',
    ],
    formula: 'Diferencial = (y_10años − y_2años) × 10,000 puntos base',
    comoLeer: 'Lo que importa es el signo y la tendencia. Un diferencial que se cierra rápido dice más que su nivel de un día.',
    ejemplo: 'Con 10 años en 4.10 y 2 años en 4.35 por ciento, el diferencial es de −25 puntos base: curva invertida.',
    fuente: 'Estrella y Mishkin (1998). Series del Departamento del Tesoro de Estados Unidos vía FRED.',
    relacionados: ['curva-de-rendimientos', 'puntos-base', 'bono-m', 'vix'],
    alias: ['curva invertida', 'pendiente de la curva'],
  },

  'puntos-base': {
    titulo: 'Puntos base',
    corto: 'Un punto base es 0.01 por ciento. Se usa para hablar de cambios de tasas sin ambigüedad.',
    largo: [
      'Decir que una tasa subió un punto es ambiguo: pudo pasar de 8 a 9 por ciento, o de 8 a 8.08 por ciento. El punto base quita esa duda: 100 puntos base son exactamente un punto porcentual.',
      'Kaizen reporta todos los cambios de tasa en puntos base, y todos los niveles como porcentaje. En el API, cualquier campo que termine en Bp viene en puntos base y todo lo demás viene como fracción decimal.',
      'No confundas punto porcentual con por ciento. Pasar de 4 a 5 por ciento es un alza de 100 puntos base, o de un punto porcentual, pero también de 25 por ciento en términos relativos.',
    ],
    formula: '1 punto base = 0.0001 = 0.01 por ciento;  cambio en pb = (y₁ − y₀) × 10,000',
    comoLeer: 'Si ves pb o bp, el número ya está multiplicado por 10,000. Si ves pp, son puntos porcentuales.',
    ejemplo: 'Una tasa que va de 8.00 a 7.75 por ciento bajó 25 puntos base.',
    fuente: 'Convención de mercados de renta fija. Usada por Banxico y por la Reserva Federal en sus comunicados.',
    relacionados: ['tasa-objetivo', 'spread-10a-2a', 'curva-de-rendimientos', 'cetes'],
    alias: ['pb', 'bps', 'basis points'],
  },

  vix: {
    titulo: 'VIX',
    corto: 'La volatilidad que el mercado de opciones espera para el S&P 500 en los próximos 30 días, en términos anuales.',
    largo: [
      'El VIX se construye con los precios de las opciones sobre el S&P 500 con vencimientos alrededor de 30 días. No es una encuesta ni un índice de miedo: es lo que cuestan hoy las opciones, traducido a volatilidad anualizada.',
      'Se le dice índice del miedo porque sube cuando el mercado cae, ya que la demanda de protección encarece las opciones. Esa relación inversa es fuerte pero no mecánica.',
      'Kaizen lo muestra con su percentil histórico al lado, porque un VIX de 20 significa cosas distintas según la época. El medidor antiguo de miedo y codicia, que era una transformación casera del VIX con nombre de emoción, se retiró por eso.',
    ],
    formula: 'Volatilidad implícita a 30 días, calculada con la varianza replicada por una tira de opciones sobre el S&P 500',
    comoLeer: 'Un VIX de 16 implica que el mercado espera movimientos diarios de alrededor de 1 por ciento. Míralo como percentil, no como nivel absoluto.',
    ejemplo: 'Un VIX en 28 estando en el percentil 85 de los últimos cinco años dice que la expectativa de volatilidad es alta contra su propia historia.',
    fuente: 'Cboe, VIX White Paper. Metodología vigente desde 2003.',
    relacionados: ['volatilidad', 'spread-10a-2a', 'dxy', 'dato-con-retraso'],
    alias: ['índice del miedo', 'volatilidad implícita'],
  },

  dxy: {
    titulo: 'DXY',
    corto: 'El índice del dólar contra una canasta de seis monedas desarrolladas, dominada por el euro.',
    largo: [
      'El DXY compara al dólar contra euro, yen, libra, dólar canadiense, corona sueca y franco suizo, con pesos fijos desde 1999. El euro pesa cerca del 58 por ciento, así que el índice es en buena medida el inverso del euro dólar.',
      'No incluye al peso mexicano ni a ninguna moneda emergente. Por eso el DXY puede subir mientras el peso se aprecia, y leerlo como si fuera el termómetro del peso lleva a conclusiones equivocadas.',
      'Para saber qué pasa con el peso, lo que sirve es el tipo de cambio FIX. El DXY sirve como contexto global de la fortaleza del dólar.',
    ],
    formula: 'Promedio geométrico ponderado de seis tipos de cambio contra el dólar, con base 100 en marzo de 1973',
    comoLeer: 'Es contexto, no señal sobre el peso. Si te interesa tu cartera en dólares, mira el FIX.',
    ejemplo: 'Un DXY que sube 1 por ciento casi siempre refleja que el euro se debilitó, no que todas las monedas cayeron.',
    fuente: 'ICE Futures U.S., U.S. Dollar Index. Composición fija desde la creación del euro.',
    relacionados: ['tipo-de-cambio-fix', 'vix', 'efecto-precio-efecto-fx', 'dato-de-respaldo'],
    alias: ['índice del dólar', 'dollar index'],
  },

  'tipo-de-cambio-fix': {
    titulo: 'Tipo de cambio FIX',
    corto: 'El tipo de cambio peso dólar que determina Banxico para pagar obligaciones en dólares en México.',
    largo: [
      'Banxico calcula el FIX con cotizaciones del mercado de cambios al mayoreo y lo publica en el Diario Oficial el día hábil siguiente. Es la referencia oficial para liquidar obligaciones en dólares pagaderas en México.',
      'No es el precio de la ventanilla del banco ni el del aeropuerto, que traen su propio margen. Es una referencia del mayoreo, y por eso Kaizen la usa para convertir carteras y para el efecto tipo de cambio.',
      'Un punto de lenguaje que Kaizen cuida: que el USD/MXN suba significa que el peso se debilita. Por eso ese dato no se pinta de verde ni de rojo, sino en color neutro con la frase de qué le pasó al peso.',
    ],
    formula: 'USD/MXN FIX, pesos por dólar. Conversión: monto en pesos = monto en dólares × FIX de la fecha',
    comoLeer: 'Revisa siempre la fecha del FIX que se usó. Convertir una cartera con el tipo de cambio de hoy y precios de hace una semana mezcla dos fotos distintas.',
    ejemplo: 'Con FIX de 18.42, mil dólares equivalen a 18,420 pesos al tipo de cambio de esa fecha.',
    fuente: 'Banxico, serie SF43718 del SIE, publicada en el Diario Oficial de la Federación.',
    relacionados: ['efecto-precio-efecto-fx', 'dxy', 'dato-con-retraso', 'sic'],
    alias: ['USD/MXN', 'dólar', 'tipo de cambio'],
  },

  // ─── Fundamentales y valuación ───────────────────────────────────────────────────────────────
  multiplos: {
    titulo: 'Múltiplos de valuación',
    corto: 'Comparar el precio de una empresa contra una medida de su tamaño o su resultado, como utilidades o ventas.',
    largo: [
      'Un múltiplo es un atajo: en vez de proyectar todos los flujos futuros, se compara el precio contra una cifra presente y se mira si está alto o bajo frente a sus comparables. Son rápidos, transparentes y muy dependientes del grupo de comparación.',
      'Tres reglas que Kaizen no rompe. El múltiplo se compara contra empresas del mismo sector y, en lo posible, del mismo mercado. El numerador y el denominador tienen que estar en la misma moneda. Y un múltiplo negativo no es barato: es no significativo, y se muestra como n/s.',
      'La versión anterior de esta app llamaba DCF a lo que en realidad era una tabla de múltiplos estadounidenses por sector aplicada a cualquier empresa, incluidas mexicanas, bancos y FIBRAs. Eso se eliminó: ahora los múltiplos dicen de dónde salen, de qué fecha son y si aplican al tipo de emisora.',
    ],
    formula: 'Múltiplo = precio o valor empresa / medida fundamental (utilidad, valor en libros, EBITDA, ventas)',
    comoLeer: 'Un múltiplo alto puede ser una empresa cara o una que crece mucho. Solo se interpreta junto con crecimiento, rentabilidad y riesgo.',
    ejemplo: 'Un P/U de 12 en una empresa que crece 3 por ciento no es lo mismo que un P/U de 12 en una que crece 15 por ciento.',
    fuente: 'Damodaran, Investment Valuation, parte de valuación relativa.',
    relacionados: ['p-u', 'p-vl', 'ev-ebitda', 'earnings-yield', 'dcf', 'z-score-sectorial'],
    alias: ['valuación relativa', 'comparables'],
  },

  'p-u': {
    titulo: 'P/U (precio entre utilidad)',
    corto: 'Cuántos pesos pagas por cada peso de utilidad anual. Es el múltiplo más conocido y el más fácil de malinterpretar.',
    largo: [
      'Se calcula dividiendo el precio de la acción entre la utilidad por acción de los últimos doce meses, o entre la esperada si se usa la versión adelantada. Un P/U de 15 quiere decir que pagas 15 pesos por cada peso de utilidad del año.',
      'Depende mucho de la contabilidad. Cargos extraordinarios, ventas de activos o cambios de criterio mueven la utilidad y con ella el múltiplo, sin que el negocio haya cambiado.',
      'Con utilidad negativa el P/U no tiene lectura: sale negativo y ordenarlo de menor a mayor pondría a las empresas que pierden dinero como las más baratas. Por eso los screeners de Kaizen usan el earnings yield, que es su inverso y ordena bien.',
    ],
    formula: 'P/U = precio por acción / utilidad por acción de los últimos doce meses',
    comoLeer: 'Compáralo contra su sector y contra su propia historia. Nunca contra empresas de otro sector ni de otro mercado.',
    ejemplo: 'Una acción a 60 pesos con utilidad por acción de 5 pesos tiene P/U de 12, o un earnings yield de 8.33 por ciento.',
    fuente: 'Graham y Dodd (1934), Security Analysis. Damodaran, Investment Valuation.',
    relacionados: ['earnings-yield', 'multiplos', 'p-vl', 'roe', 'factor-valor'],
    alias: ['PE', 'price earnings', 'precio utilidad'],
  },

  'p-vl': {
    titulo: 'P/VL (precio entre valor en libros)',
    corto: 'Cuántos pesos pagas por cada peso de capital contable. Es el múltiplo natural para bancos.',
    largo: [
      'El valor en libros es lo que la contabilidad dice que vale el capital de los accionistas: activos menos pasivos. El P/VL compara el precio de mercado contra esa cifra.',
      'Funciona mejor donde los activos están valuados cerca de su valor de mercado y son el corazón del negocio, como en bancos y aseguradoras. Funciona mal en empresas cuyo valor está en marcas, software o gente, porque nada de eso está en el balance.',
      'Para bancos existe un ancla teórica: el P/VL justificado es (ROE − g) / (Re − g). Si una empresa gana sobre su capital más de lo que cuesta su capital, merece cotizar arriba de libros.',
    ],
    formula: 'P/VL = precio por acción / valor en libros por acción;  justificado = (ROE − g) / (Re − g)',
    comoLeer: 'Un P/VL debajo de 1 dice que el mercado no cree en el valor contable o no cree en la rentabilidad futura. Casi nunca es solo una ganga.',
    ejemplo: 'Un banco con ROE de 15 por ciento, crecimiento de 5 por ciento y costo de capital de 12 por ciento tiene un P/VL justificado de 1.4286.',
    fuente: 'Damodaran, Investment Valuation, capítulo de valuación de instituciones financieras.',
    relacionados: ['roe', 'multiplos', 'p-u', 'dcf', 'factor-valor'],
    alias: ['price to book', 'P/B', 'valor en libros'],
  },

  'valor-empresa': {
    titulo: 'Valor empresa (EV)',
    corto: 'Lo que costaría comprar todo el negocio: la capitalización más la deuda y otros reclamos, menos el efectivo.',
    largo: [
      'El precio de las acciones solo cubre la parte de los accionistas. Si la empresa debe dinero, quien la compra hereda esa deuda; si tiene efectivo, ese efectivo baja el costo real. El valor empresa junta todo.',
      'La versión completa suma también el interés minoritario y las acciones preferentes, porque son reclamos sobre los mismos activos. Kaizen usa esa definición completa en la fórmula mágica y en EV/EBITDA.',
      'Su ventaja sobre la capitalización es que no depende de la estructura de capital, así que compara mejor empresas con distintos niveles de deuda.',
    ],
    formula: 'EV = capitalización + deuda total + interés minoritario + preferentes − efectivo e inversiones temporales',
    comoLeer: 'Si el EV es mucho mayor que la capitalización, la empresa trae deuda pesada y el riesgo del accionista es mayor de lo que sugiere el precio.',
    ejemplo: 'Capitalización de 100, deuda de 40 y efectivo de 10 dan un valor empresa de 130.',
    fuente: 'Damodaran, Investment Valuation. Greenblatt (2006) para su uso en el earnings yield.',
    relacionados: ['ev-ebitda', 'formula-magica', 'deuda-capital', 'multiplos'],
    alias: ['EV', 'enterprise value'],
  },

  'ev-ebitda': {
    titulo: 'EV/EBITDA',
    corto: 'Valor empresa entre utilidad antes de intereses, impuestos, depreciación y amortización.',
    largo: [
      'Es el múltiplo favorito para comparar empresas con distinta deuda y distinta política de depreciación, porque el numerador incluye la deuda y el denominador la ignora. Se usa mucho en industrias intensivas en activos.',
      'Su crítica clásica, la de Buffett y Munger, es que la depreciación sí es un gasto real: las máquinas se gastan y hay que reponerlas. Una empresa con EV/EBITDA bajo pero con inversión de capital enorme puede no generar efectivo libre.',
      'Como todo múltiplo, compara solo dentro del mismo sector, y no tiene sentido para bancos, donde el concepto de EBITDA no aplica.',
    ],
    formula: 'EV/EBITDA = valor empresa / EBITDA de los últimos doce meses',
    comoLeer: 'Míralo junto al flujo libre. Si el EBITDA es alto pero el flujo libre es chico, la diferencia se está yendo en inversión de capital.',
    ejemplo: 'Un valor empresa de 130 con EBITDA de 20 da un EV/EBITDA de 6.5 veces.',
    fuente: 'Damodaran, Investment Valuation. Sobre su límite, cartas anuales de Berkshire Hathaway.',
    relacionados: ['valor-empresa', 'multiplos', 'fcf-yield', 'margen-operativo'],
    alias: ['EV EBITDA', 'múltiplo de EBITDA'],
  },

  'earnings-yield': {
    titulo: 'Earnings yield',
    corto: 'El inverso del P/U: cuánta utilidad anual compras por cada peso invertido, en porcentaje.',
    largo: [
      'Si el P/U es 12, el earnings yield es 8.33 por ciento. Es la misma información al revés, pero se ordena bien: una empresa con pérdidas da un yield negativo y queda hasta abajo, que es donde debe estar, en vez de aparecer como la más barata.',
      'Por eso los screeners de factores de Kaizen convierten todos los múltiplos a rendimientos antes de ordenarlos. Es una decisión metodológica, no cosmética: ordenar por P/U mete a las empresas que pierden dinero en el primer lugar.',
      'La versión de Greenblatt usa EBIT sobre valor empresa en lugar de utilidad neta sobre precio, para que el múltiplo no dependa de la deuda ni de la tasa de impuestos.',
    ],
    formula: 'EY = utilidad por acción / precio = 1 / (P/U);  versión Greenblatt: EY = EBIT / valor empresa',
    comoLeer: 'Compáralo contra la tasa libre de riesgo. Un earnings yield de 8 por ciento con CETES en 11 por ciento dice algo distinto que con CETES en 4.',
    ejemplo: 'Una acción a 60 pesos con utilidad por acción de 5 tiene un earnings yield de 8.33 por ciento.',
    fuente: 'Greenblatt (2006), The Little Book That Beats the Market. Graham y Dodd para la comparación contra bonos.',
    relacionados: ['p-u', 'formula-magica', 'factor-valor', 'fcf-yield', 'tasa-libre-de-riesgo'],
    alias: ['rendimiento de utilidades', 'inverso del PU'],
  },

  'fcf-yield': {
    titulo: 'Rendimiento de flujo libre',
    corto: 'Flujo libre de efectivo entre el valor de mercado. Mide efectivo real, no utilidad contable.',
    largo: [
      'El flujo libre es lo que queda del efectivo de operación después de la inversión de capital necesaria para sostener el negocio. Es más difícil de maquillar que la utilidad, porque el efectivo entra o no entra.',
      'El rendimiento de flujo libre se puede medir contra la capitalización, para el accionista, o contra el valor empresa, para todos los proveedores de capital. Kaizen dice cuál está usando en cada tarjeta.',
      'Es volátil de un año a otro, porque la inversión de capital viene a saltos. Un solo año bajo no dice nada; conviene mirar el promedio de varios años.',
    ],
    formula: 'FCF = flujo de operación − inversión de capital;  yield = FCF / capitalización',
    comoLeer: 'Un rendimiento de flujo libre alto y sostenido es de las señales más difíciles de fabricar. Uno alto en un solo año suele venir de posponer inversión.',
    ejemplo: 'Un flujo libre de 8,000 millones con capitalización de 100,000 millones da un rendimiento de 8 por ciento.',
    fuente: 'Damodaran, Investment Valuation, capítulo de flujos de efectivo.',
    relacionados: ['fcff', 'earnings-yield', 'ev-ebitda', 'dcf', 'factor-calidad'],
    alias: ['FCF yield', 'flujo libre'],
  },

  roe: {
    titulo: 'ROE (rentabilidad del capital)',
    corto: 'Utilidad neta entre capital contable: cuánto gana la empresa por cada peso que pusieron los accionistas.',
    largo: [
      'Es la medida clásica de rentabilidad para el accionista. Un ROE de 20 por ciento sostenido durante años indica un negocio que reinvierte bien.',
      'La descomposición DuPont enseña de dónde sale: margen neto por rotación de activos por apalancamiento. Un ROE alto puede venir de un buen margen o simplemente de mucha deuda, y son cosas muy distintas.',
      'Por eso conviene mirarlo junto al ROIC, que no depende de la estructura de capital, y junto a la deuda sobre capital.',
    ],
    formula: 'ROE = utilidad neta / capital contable promedio = margen × rotación × apalancamiento',
    comoLeer: 'Un ROE alto con deuda alta no es lo mismo que un ROE alto sin deuda. Revisa siempre las dos cifras juntas.',
    ejemplo: 'Una empresa con utilidad neta de 1,500 y capital contable de 10,000 tiene un ROE de 15 por ciento.',
    fuente: 'Descomposición DuPont, en uso desde los años veinte. Penman, Financial Statement Analysis.',
    relacionados: ['roic', 'p-vl', 'deuda-capital', 'factor-calidad', 'margen-operativo'],
    alias: ['return on equity', 'rentabilidad sobre capital'],
  },

  roic: {
    titulo: 'ROIC (rentabilidad del capital invertido)',
    corto: 'Utilidad operativa después de impuestos entre el capital que el negocio realmente usa.',
    largo: [
      'El ROIC mide la calidad del negocio sin que la estructura de capital lo ensucie: usa la utilidad operativa después de impuestos y la divide entre deuda más capital menos efectivo ocioso.',
      'La comparación que importa es contra el costo de capital. Una empresa que gana 14 por ciento sobre su capital invertido cuando su WACC es 9 por ciento está creando valor; si gana 6 por ciento, lo está destruyendo aunque su utilidad crezca.',
      'La fórmula mágica usa una variante que excluye efectivo y deuda de corto plazo del capital de trabajo, para acercarse al capital tangible que el negocio necesita para operar.',
    ],
    formula: 'ROIC = EBIT(1 − t) / (deuda + capital − efectivo);  Greenblatt: EBIT / (capital de trabajo neto + activo fijo neto)',
    comoLeer: 'Compáralo contra el WACC de la misma empresa. La diferencia entre los dos es el valor que crea cada peso reinvertido.',
    ejemplo: 'Un EBIT de 2,000 con tasa de 30 por ciento y capital invertido de 10,000 da un ROIC de 14 por ciento.',
    fuente: 'Koller, Goedhart y Wessels, Valuation (McKinsey). Greenblatt (2006) para la variante del screener.',
    relacionados: ['roe', 'wacc', 'formula-magica', 'factor-calidad', 'fcff'],
    alias: ['return on invested capital', 'ROIC'],
  },

  'margen-operativo': {
    titulo: 'Margen operativo',
    corto: 'Utilidad de operación entre ventas: cuántos centavos de cada peso vendido quedan antes de intereses e impuestos.',
    largo: [
      'Mide la eficiencia del negocio en sí, sin mezclar decisiones de financiamiento ni el efecto de la tasa de impuestos. Es lo más cercano a la rentabilidad del negocio operando.',
      'Los niveles normales dependen totalmente del sector: un supermercado sano opera con 4 o 5 por ciento, y una empresa de software con 30. Comparar márgenes entre sectores no informa nada.',
      'Lo que sí informa es la tendencia dentro de la misma empresa y contra sus pares directos. Un margen que se comprime varios trimestres seguidos suele anteceder a las revisiones de utilidades.',
    ],
    formula: 'Margen operativo = EBIT / ventas',
    comoLeer: 'Míralo como serie, no como foto. La dirección importa más que el nivel.',
    ejemplo: 'Ventas de 50,000 con EBIT de 5,000 dan un margen operativo de 10 por ciento.',
    fuente: 'Penman, Financial Statement Analysis and Security Valuation.',
    relacionados: ['roic', 'ev-ebitda', 'factor-calidad', 'roe'],
    alias: ['margen EBIT', 'rentabilidad operativa'],
  },

  'deuda-capital': {
    titulo: 'Deuda entre capital',
    corto: 'Cuánta deuda trae la empresa por cada peso de capital contable. Es la medida directa de apalancamiento.',
    largo: [
      'La deuda amplifica: sube el ROE en los buenos años y hunde a la empresa en los malos. Por eso el mismo negocio con más deuda tiene acciones más riesgosas, que es lo que captura la beta apalancada.',
      'La lectura cambia por sector. Una empresa de infraestructura con flujos contractuales aguanta deuda que tumbaría a una cíclica. Las FIBRAs tienen su propia medida, el LTV, con un límite regulatorio.',
      'Conviene mirar también deuda neta entre EBITDA, que dice en cuántos años de flujo operativo se pagaría la deuda, y la cobertura de intereses.',
    ],
    formula: 'D/E = deuda total / capital contable;  deuda neta / EBITDA = (deuda − efectivo) / EBITDA',
    comoLeer: 'Compara contra el sector y mira el vencimiento de la deuda. Deuda barata que vence en cinco años no es el mismo problema que deuda que vence el año entrante.',
    ejemplo: 'Deuda de 5,000 con capital contable de 10,000 da un D/E de 0.5.',
    fuente: 'Modigliani y Miller (1963), Corporate Income Taxes and the Cost of Capital.',
    relacionados: ['beta-apalancada', 'wacc', 'ltv', 'roe', 'valor-empresa'],
    alias: ['apalancamiento', 'D/E', 'deuda a capital'],
  },

  dcf: {
    titulo: 'DCF (flujos descontados)',
    corto: 'Estimar lo que vale una empresa sumando sus flujos futuros traídos a valor de hoy con una tasa de descuento.',
    largo: [
      'El DCF de Kaizen es de dos etapas sobre flujo libre para la empresa. Se proyectan los flujos de los primeros años con una tasa de crecimiento, se calcula un valor terminal con crecimiento perpetuo y todo se descuenta al WACC. El resultado es el valor de la empresa, del que se resta la deuda neta para llegar al valor del capital.',
      'Es el método más honesto y el más fácil de manipular al mismo tiempo, porque el valor terminal suele ser más de la mitad del resultado y depende de dos números que nadie conoce: el crecimiento perpetuo y la tasa de descuento. Por eso Kaizen muestra cada supuesto como campo editable y una malla de sensibilidad, no un precio objetivo.',
      'Hay dos guardas duras. El crecimiento terminal no puede superar la tasa libre de riesgo de esa moneda, porque ninguna empresa crece para siempre más rápido que la economía. Y el WACC menos el crecimiento tiene que ser de al menos 2 puntos porcentuales, porque si no el valor terminal se dispara al infinito.',
      'Los bancos no se valúan así: sus flujos y su deuda no se separan igual. Para ellos Kaizen usa el P/VL justificado.',
    ],
    formula: 'EV = Σ FCFF_t / (1 + WACC)^t + [FCFF_n(1 + g) / (WACC − g)] / (1 + WACC)^n',
    comoLeer: 'Un DCF no da un número, da un rango. Mira la malla de sensibilidad antes que el valor central y pregunta qué tendría que ser cierto para llegar ahí.',
    ejemplo: 'Con flujo inicial de 100, crecimiento de 10 por ciento cinco años, terminal de 3 por ciento y WACC de 9 por ciento: 513.93 de la primera etapa más 1,796.87 del valor terminal descontado, o sea 2,310.80 de valor empresa.',
    fuente: 'Williams (1938), The Theory of Investment Value. Damodaran, Investment Valuation. Koller y otros, Valuation.',
    relacionados: ['fcff', 'wacc', 'crecimiento-terminal', 'capm', 'p-vl', 'multiplos'],
    alias: ['flujos descontados', 'valuación intrínseca'],
  },

  fcff: {
    titulo: 'FCFF (flujo libre para la empresa)',
    corto: 'El efectivo que genera la operación para todos los que financian la empresa, antes de pagar deuda.',
    largo: [
      'Se construye desde la utilidad operativa: EBIT después de impuestos, más depreciación y amortización porque no son salida de efectivo, menos la inversión de capital y menos el aumento del capital de trabajo, que sí consume efectivo.',
      'Es el flujo que le corresponde a un DCF con WACC, porque el WACC ya incluye el costo de la deuda. La alternativa es el flujo para el accionista, que se descuenta al costo del capital, y mezclarlos es un error clásico de valuación.',
      'Los flujos deben estar en la misma moneda que la tasa de descuento. Si los flujos son en pesos, el WACC va en pesos; convertir un WACC de dólares a pesos se hace con el diferencial de inflación, no restando o sumando a ojo.',
    ],
    formula: 'FCFF = EBIT(1 − t) + depreciación y amortización − inversión de capital − Δ capital de trabajo',
    comoLeer: 'Si el FCFF es negativo por inversión de capital en crecimiento, no es lo mismo que si es negativo porque la operación pierde. Revisa la causa.',
    ejemplo: 'EBIT de 2,000, tasa de 30 por ciento, depreciación de 400, inversión de capital de 500 y aumento de capital de trabajo de 100 dan FCFF de 1,200.',
    fuente: 'Damodaran, Investment Valuation, capítulo de estimación de flujos.',
    relacionados: ['dcf', 'wacc', 'fcf-yield', 'roic', 'margen-operativo'],
    alias: ['flujo libre para la firma', 'free cash flow to firm'],
  },

  wacc: {
    titulo: 'WACC (costo promedio de capital)',
    corto: 'La tasa a la que la empresa consigue dinero, mezclando deuda y capital según cuánto pesa cada uno.',
    largo: [
      'Es el promedio ponderado del costo del capital accionario y del costo de la deuda después de impuestos, con pesos de valor de mercado. La deuda entra después de impuestos porque los intereses son deducibles.',
      'Es la tasa de descuento correcta para el flujo libre para la empresa. Kaizen calcula el costo del capital con CAPM, incluyendo prima de riesgo país cuando aplica, y toma el costo de la deuda de las condiciones de la empresa o de su calificación.',
      'Para valuar flujos en pesos con un WACC estimado en dólares, la conversión es por diferencial de inflación esperada entre los dos países, multiplicando y no sumando.',
    ],
    formula: 'WACC = (E/V)·Re + (D/V)·Rd·(1 − t);  a pesos: (1 + WACC_usd)(1 + π_mx)/(1 + π_us) − 1',
    comoLeer: 'Un WACC bajo sube mucho el valor terminal. Antes de creerle a una valuación, mira qué tasa usó y si es plausible para ese país y esa empresa.',
    ejemplo: 'Con costo de capital de 11.56 por ciento, costo de deuda de 7 por ciento, tasa de 30 por ciento y dos tercios de capital, el WACC es 9.34 por ciento. Llevado a pesos con inflación de 3.5 y 2.3 por ciento queda en 10.62 por ciento.',
    fuente: 'Modigliani y Miller (1958, 1963). Damodaran para la conversión entre monedas.',
    relacionados: ['capm', 'dcf', 'fcff', 'deuda-capital', 'riesgo-pais', 'beta-apalancada'],
    alias: ['costo de capital', 'tasa de descuento'],
  },

  capm: {
    titulo: 'CAPM',
    corto: 'Modelo que estima el rendimiento exigido a una acción como la tasa libre de riesgo más beta por la prima de mercado.',
    largo: [
      'La idea es que solo se paga por el riesgo que no se puede diversificar. Ese riesgo se mide con la beta, y el precio de cada unidad de beta es la prima de riesgo de mercado.',
      'Para emisoras mexicanas Kaizen suma una prima de riesgo país multiplicada por la exposición de la empresa a ese riesgo. Una empresa mexicana que factura en dólares en Estados Unidos no carga el riesgo país completo.',
      'El CAPM se ha cuestionado mucho empíricamente: la relación entre beta y rendimiento observado es mucho más débil de lo que el modelo supone, y de ahí nacieron los modelos de factores. Sigue siendo el punto de partida porque es transparente y todos sus insumos se pueden discutir.',
    ],
    formula: 'Re = rf + β · prima de mercado + λ · prima de riesgo país',
    comoLeer: 'Es un insumo editable, no un dato observado. Cambiar la prima de mercado en un punto mueve el valor de un DCF de forma notoria.',
    ejemplo: 'Con tasa libre de riesgo de 4.2 por ciento, beta apalancada de 1.08, prima de mercado de 4.5 por ciento y prima país de 2.5 por ciento con exposición 1, el costo del capital es 11.56 por ciento.',
    fuente: 'Sharpe (1964), Lintner (1965), Mossin (1966). Crítica empírica en Fama y French (1992).',
    relacionados: ['beta', 'prima-de-riesgo-de-mercado', 'riesgo-pais', 'wacc', 'tasa-libre-de-riesgo'],
    alias: ['modelo de valuación de activos', 'costo del capital'],
  },

  'prima-de-riesgo-de-mercado': {
    titulo: 'Prima de riesgo de mercado',
    corto: 'Cuánto rendimiento extra exige el mercado por invertir en acciones en vez de en el activo sin riesgo.',
    largo: [
      'Es el insumo más discutido de toda la valuación. No se observa: se estima, y según el método sale distinta. La histórica se calcula con décadas de rendimientos pasados; la implícita se despeja de los precios de hoy y de los flujos esperados.',
      'Damodaran publica estimaciones actualizadas y las usa medio mundo. La implícita para Estados Unidos ha oscilado entre 3.5 y 6 por ciento en las últimas décadas.',
      'Kaizen la trae como supuesto editable con su fecha y su fuente. Nunca está escondida en el código, porque mover la prima medio punto cambia cualquier valuación de manera visible.',
    ],
    formula: 'Prima = rendimiento esperado del mercado − tasa libre de riesgo',
    comoLeer: 'Cuando compares dos valuaciones, revisa primero si usan la misma prima. La mitad de las diferencias sale de ahí.',
    ejemplo: 'Una prima de 4.5 por ciento con beta 1.08 y tasa libre de riesgo de 4.2 por ciento exige 9.06 por ciento antes de sumar riesgo país.',
    fuente: 'Damodaran, Equity Risk Premiums: Determinants, Estimation and Implications, actualizado cada año.',
    relacionados: ['capm', 'riesgo-pais', 'wacc', 'tasa-libre-de-riesgo', 'beta'],
    alias: ['ERP', 'prima de mercado'],
  },

  'riesgo-pais': {
    titulo: 'Prima de riesgo país',
    corto: 'El rendimiento adicional que se exige por invertir en un país con más riesgo de crédito y de política.',
    largo: [
      'La forma más usada de estimarla parte del diferencial de la deuda soberana del país contra la de un país sin riesgo, ajustado por la mayor volatilidad de su mercado accionario contra la de su mercado de bonos.',
      'No todas las empresas del país la cargan igual. Una empresa con la mitad de sus ingresos en dólares y en otros mercados está menos expuesta, y eso se modela con un coeficiente de exposición entre cero y uno.',
      'Sumarla completa a toda empresa mexicana es tan grueso como ignorarla. Kaizen la expone como supuesto con su valor, su fecha y su fuente, y permite ajustar la exposición.',
    ],
    formula: 'Prima país = diferencial soberano × (volatilidad del mercado accionario / volatilidad del mercado de bonos)',
    comoLeer: 'Súmala al costo de capital solo en la proporción en que la empresa depende del país. Revisa la fecha: los diferenciales se mueven rápido.',
    ejemplo: 'Con una prima país de 2.5 por ciento y exposición de 0.6, se suman 1.5 puntos al costo del capital.',
    fuente: 'Damodaran, Country Risk: Determinants, Measures and Implications, actualizado cada año.',
    relacionados: ['capm', 'prima-de-riesgo-de-mercado', 'wacc', 'dcf'],
    alias: ['CRP', 'prima país'],
  },

  'crecimiento-terminal': {
    titulo: 'Crecimiento terminal',
    corto: 'La tasa a la que se supone que los flujos crecen para siempre después del periodo de proyección.',
    largo: [
      'El valor terminal suele ser la mayor parte de un DCF, y todo él depende de esta tasa. Por eso es donde más se abusa: subirla medio punto puede aumentar el valor 15 por ciento sin que nadie lo note en la tabla.',
      'El límite lógico es que nada crece para siempre por encima de la economía en la que vive. Kaizen impone dos guardas: el crecimiento terminal no puede superar la tasa libre de riesgo de esa moneda, y la diferencia entre el WACC y el crecimiento tiene que ser de al menos 2 puntos porcentuales.',
      'Un crecimiento terminal en términos nominales incluye inflación. En pesos, con inflación de 3.5 por ciento, un crecimiento terminal de 3 por ciento es en realidad una caída real, y eso está bien para negocios maduros.',
    ],
    formula: 'Valor terminal = FCFF_n · (1 + g) / (WACC − g), con g ≤ rf y WACC − g ≥ 0.02',
    comoLeer: 'Compara el crecimiento terminal contra la inflación esperada y contra el crecimiento del PIB. Si lo supera, la valuación supone que la empresa se come la economía.',
    ejemplo: 'Con flujo de 161.051, crecimiento terminal de 3 por ciento y WACC de 9 por ciento, el valor terminal es 2,764.71 antes de descontarlo, y 1,796.87 ya descontado cinco años.',
    fuente: 'Damodaran, Investment Valuation, capítulo de valor terminal. Koller y otros, Valuation.',
    relacionados: ['dcf', 'wacc', 'fcff', 'tasa-libre-de-riesgo', 'real-vs-nominal'],
    alias: ['valor terminal', 'crecimiento perpetuo'],
  },

  // ─── Factores y screeners ────────────────────────────────────────────────────────────────────
  'z-score-sectorial': {
    titulo: 'Puntaje z relativo al sector',
    corto: 'Convertir una métrica a desviaciones respecto a la mediana de su sector, para poder comparar peras con peras.',
    largo: [
      'Un P/U de 10 es caro en una minera y barato en una empresa de consumo. Comparar métricas crudas entre sectores ordena por sector, no por calidad. El puntaje relativo al sector arregla eso midiendo cada empresa contra la mediana de sus pares.',
      'Kaizen usa la versión robusta: resta la mediana y divide entre la desviación absoluta mediana por 1.4826, que es la constante que la hace comparable con la desviación estándar en datos normales. Luego recorta los valores a más menos 3, para que un dato extremo no domine el ranking.',
      'Dos reglas de honestidad. Si un sector tiene menos de 5 empresas con dato, se compara contra todo el universo y la pantalla lo marca. Si menos de la mitad del universo tiene esa métrica, el factor se excluye y se dice por qué.',
    ],
    formula: 'z = (x − mediana) / (1.4826 · MAD), recortado a [−3, 3]',
    comoLeer: 'Un z de 1 quiere decir una desviación arriba de la mediana de su sector. Los puntajes no son comparables entre fechas distintas sin recalcular.',
    ejemplo: 'La serie 10, 12, 14, 16 y 18 tiene mediana 14 y MAD 2, así que el puntaje de 18 es 1.349.',
    fuente: 'Rousseeuw y Croux (1993), Alternatives to the Median Absolute Deviation, JASA. Constante 1.4826 para consistencia con la normal.',
    relacionados: ['factor-valor', 'factor-calidad', 'baja-volatilidad', 'momentum-12-1', 'multiplos'],
    alias: ['z score', 'puntaje robusto', 'MAD'],
  },

  'formula-magica': {
    titulo: 'Fórmula mágica de Greenblatt',
    corto: 'Ordenar empresas combinando dos listas: las más baratas por earnings yield y las más rentables por ROC.',
    largo: [
      'Greenblatt propuso ordenar el universo dos veces, una por rendimiento de utilidades y otra por rentabilidad del capital, y sumar las dos posiciones. Las que quedan arriba son a la vez baratas y buenas, que es la idea de comprar un buen negocio a buen precio.',
      'Los detalles importan. El earnings yield usa EBIT sobre valor empresa, con el valor empresa completo, incluyendo interés minoritario y preferentes. El ROC usa EBIT sobre capital de trabajo neto más activo fijo neto, excluyendo efectivo y deuda de corto plazo.',
      'Greenblatt mismo excluye financieras y servicios públicos, porque sus estados no encajan en la fórmula. Kaizen respeta esa exclusión, muestra la cobertura de datos y presenta el resultado como una lista ordenada por criterios, nunca como una lista de qué comprar.',
    ],
    formula: 'Posición final = posición por EY + posición por ROC, con EY = EBIT/EV y ROC = EBIT/(capital de trabajo neto + activo fijo neto)',
    comoLeer: 'Es un punto de partida para investigar, no un resultado. Los empates y la cobertura de datos cambian el orden más de lo que parece.',
    ejemplo: 'Con EY de 10, 8 y 12 por ciento y ROC de 50, 30 y 20 por ciento, el orden final es la primera, la tercera y la segunda.',
    fuente: 'Greenblatt (2006), The Little Book That Beats the Market.',
    relacionados: ['earnings-yield', 'roic', 'valor-empresa', 'factor-valor', 'backtest-sesgos'],
    alias: ['magic formula', 'Greenblatt'],
  },

  'momentum-12-1': {
    titulo: 'Momentum 12 menos 1',
    corto: 'El rendimiento de los últimos 12 meses saltándose el más reciente. Es la definición académica estándar.',
    largo: [
      'Se mide del precio de hace 12 meses al de hace 1 mes, con cierres ajustados de fin de mes. El mes más reciente se salta a propósito, porque a un mes hay reversión de corto plazo que ensucia la señal.',
      'Jegadeesh y Titman documentaron que las acciones que subieron en los últimos meses tendieron a seguir subiendo en el corto plazo. Es uno de los hallazgos más replicados en finanzas y también uno de los más frágiles: se desploma en los giros del mercado, con caídas grandes y rápidas.',
      'La comparación tiene que ser contra un referente en la misma moneda. Comparar una emisora mexicana en pesos contra un ETF estadounidense en dólares mete el tipo de cambio dentro del momentum, que fue exactamente el error de la versión anterior de esta app.',
    ],
    formula: 'Momentum = P(t − 1 mes) / P(t − 12 meses) − 1, sobre cierres ajustados de fin de mes',
    comoLeer: 'Es una medida descriptiva de qué pasó, no un pronóstico. Léela junto a la volatilidad de la emisora y al referente en su moneda.',
    ejemplo: 'Con 13 precios mensuales, el momentum es el precio número 12 entre el primero, menos uno.',
    fuente: 'Jegadeesh y Titman (1993), Returns to Buying Winners and Selling Losers, Journal of Finance. Asness, Moskowitz y Pedersen (2013).',
    relacionados: ['factor-valor', 'z-score-sectorial', 'beta', 'backtest-sesgos', 'rendimiento-total'],
    alias: ['momentum', '12-1', 'tendencia'],
  },

  'factor-valor': {
    titulo: 'Factor valor',
    corto: 'La tendencia histórica de las acciones baratas contra sus fundamentales a rendir más que las caras.',
    largo: [
      'Fama y French agregaron el valor al CAPM cuando mostraron que el cociente de valor en libros a precio explicaba rendimientos que la beta no explicaba. Desde entonces se mide con varios múltiplos a la vez: libros, utilidades, flujo y ventas.',
      'La explicación está en disputa. Una versión dice que es compensación por riesgo, otra que es un error sistemático de los inversionistas que extrapolan el pasado. No hay consenso, y eso es parte del panorama.',
      'La década de 2010 fue mala para el valor en Estados Unidos, con más de diez años de rezago contra crecimiento. Cualquier factor puede quedarse atrás durante periodos más largos que la paciencia de casi cualquiera.',
    ],
    formula: 'Puntaje de valor = promedio de los puntajes z sectoriales de earnings yield, libros a precio y flujo libre a precio',
    comoLeer: 'Barato no es lo mismo que bueno. El valor se lee junto con calidad, porque muchas empresas están baratas por una razón.',
    ejemplo: 'Una empresa en el percentil 90 de earnings yield de su sector recibe un puntaje de valor alto, aunque su precio haya caído por una razón de fondo.',
    fuente: 'Fama y French (1992, 1993). Lakonishok, Shleifer y Vishny (1994) para la versión conductual.',
    relacionados: ['earnings-yield', 'p-vl', 'z-score-sectorial', 'factor-calidad', 'multiplos'],
    alias: ['value', 'acciones baratas'],
  },

  'factor-calidad': {
    titulo: 'Factor calidad',
    corto: 'Empresas rentables, con márgenes estables y poca deuda, que históricamente rindieron más que las frágiles.',
    largo: [
      'No hay una definición única. Las más usadas combinan rentabilidad bruta sobre activos, estabilidad de los márgenes, crecimiento sostenido y poca deuda. Novy-Marx mostró que la rentabilidad bruta sola ya explica rendimientos que otros factores no explican.',
      'La calidad se lleva especialmente bien con el valor: comprar empresas buenas a precio razonable filtra las trampas de valor, que son las que se ven baratas porque el negocio se está deteriorando.',
      'Como todos los factores documentados en artículos, hay que tomarlo con cautela: las métricas se eligieron después de ver los datos, y parte del resultado publicado puede ser selección.',
    ],
    formula: 'Puntaje de calidad = promedio de los puntajes z sectoriales de ROIC, margen operativo y su estabilidad, menos deuda a capital',
    comoLeer: 'Es un filtro de fragilidad más que un pronóstico de rendimiento. Sirve sobre todo para descartar.',
    ejemplo: 'Una empresa con ROIC de 18 por ciento, margen estable y deuda baja califica alto aunque su múltiplo no sea barato.',
    fuente: 'Novy-Marx (2013), The Other Side of Value, Journal of Financial Economics. Asness, Frazzini y Pedersen (2019), Quality Minus Junk.',
    relacionados: ['roic', 'margen-operativo', 'deuda-capital', 'factor-valor', 'z-score-sectorial'],
    alias: ['quality', 'calidad'],
  },

  'baja-volatilidad': {
    titulo: 'Factor de baja volatilidad',
    corto: 'La anomalía de que las acciones menos volátiles han rendido tanto o más que las volátiles, ajustando por riesgo.',
    largo: [
      'El CAPM predice lo contrario: más beta, más rendimiento. Lo que muestran los datos de varias décadas y varios países es una relación plana o incluso invertida, y eso es una de las anomalías más persistentes que se conocen.',
      'Las explicaciones que se manejan son el apalancamiento limitado, que empuja a muchos inversionistas a buscar riesgo dentro de las acciones en vez de apalancarse, y el gusto de los participantes por las apuestas con premio grande y probabilidad baja.',
      'Se relaciona con la cartera de mínima varianza, que llega a un resultado parecido desde la optimización y no desde el ordenamiento por factor.',
    ],
    formula: 'Puntaje = puntaje z sectorial de la volatilidad anualizada, con signo invertido',
    comoLeer: 'Menos volátil no quiere decir a salvo. Estas carteras suelen concentrarse en pocos sectores defensivos y en tasas.',
    ejemplo: 'Una emisora con volatilidad anual de 14 por ciento en un sector cuya mediana es 24 por ciento recibe un puntaje alto.',
    fuente: 'Ang, Hodrick, Xing y Zhang (2006). Baker, Bradley y Wurgler (2011), Benchmarks as Limits to Arbitrage, Financial Analysts Journal.',
    relacionados: ['volatilidad', 'minima-varianza', 'beta', 'z-score-sectorial', 'razon-de-captura'],
    alias: ['low vol', 'baja volatilidad'],
  },

  // ─── FIBRAs ──────────────────────────────────────────────────────────────────────────────────
  fibra: {
    titulo: 'FIBRA',
    corto: 'Fideicomiso de inversión en bienes raíces: vehículo mexicano que cotiza en bolsa y reparte casi toda su utilidad fiscal.',
    largo: [
      'Las FIBRAs son el equivalente mexicano de los REIT. Están reguladas por los artículos 187 y 188 de la Ley del ISR: invierten en inmuebles destinados al arrendamiento, deben mantenerlos al menos cuatro años y tienen que repartir al menos el 95 por ciento de su resultado fiscal cada año.',
      'A cambio de ese reparto, la FIBRA no paga ISR a nivel del fideicomiso: el impuesto se cobra en el tenedor, con retención sobre la distribución. Por eso su rendimiento por distribución es alto comparado con los dividendos de acciones.',
      'Se valúan distinto a una empresa operativa. La utilidad neta no sirve porque la depreciación inmobiliaria es enorme y no corresponde a una salida de efectivo. Las medidas que sí sirven son el FFO, el AFFO, el valor de los activos y el nivel de deuda sobre esos activos.',
    ],
    formula: 'Sin fórmula. Es una figura legal: arts. 187 y 188 de la Ley del ISR.',
    comoLeer: 'Mira la ocupación, el plazo promedio de los contratos, la moneda de las rentas y el LTV. La distribución sola no dice si es sostenible.',
    ejemplo: 'Una FIBRA con rentas en dólares y deuda en pesos tiene un perfil de riesgo cambiario muy distinto al de una con rentas en pesos.',
    fuente: 'Ley del Impuesto sobre la Renta, arts. 187 y 188. Comparable: Nareit para REIT en Estados Unidos.',
    relacionados: ['ffo-affo', 'cap-rate', 'ltv', 'nav-p-nav', 'rendimiento-por-distribucion'],
    alias: ['FIBRAs', 'REIT mexicano', 'fideicomiso inmobiliario'],
  },

  'ffo-affo': {
    titulo: 'FFO y AFFO',
    corto: 'Las medidas de flujo propias de los inmuebles: utilidad neta sin depreciación ni ganancias por venta, y su versión ajustada.',
    largo: [
      'El FFO parte de la utilidad neta, le suma la depreciación y amortización de inmuebles y le resta las ganancias por venta de propiedades. La idea es quitar dos ruidos: una depreciación contable que no refleja deterioro real y ganancias que no se repiten.',
      'El AFFO va un paso más allá y resta el gasto recurrente de mantenimiento y las comisiones de arrendamiento, que sí son salidas de efectivo periódicas. Es la cifra más cercana a lo que de verdad se puede repartir.',
      'Es importante decir esto: la versión anterior de esta app llamaba FFO a un flujo libre de efectivo calculado como cualquier empresa. No era FFO. Aquí el FFO se arma desde la utilidad neta con los ajustes correctos, y si faltan los renglones se muestra s/d en vez de un número inventado.',
    ],
    formula: 'FFO = utilidad neta + depreciación y amortización de inmuebles − ganancias por venta de propiedades;  AFFO = FFO − capex de mantenimiento − comisiones de arrendamiento',
    comoLeer: 'Compara la distribución contra el AFFO. Si la FIBRA reparte más de lo que genera, está pagando con deuda o con venta de activos.',
    ejemplo: 'Con utilidad neta de 800, depreciación de 1,200 y ganancias por venta de 100, el FFO es 1,900.',
    fuente: 'Nareit, Funds From Operations White Paper. Adaptado al marco mexicano de las FIBRAs.',
    relacionados: ['fibra', 'rendimiento-por-distribucion', 'cap-rate', 'fcf-yield'],
    alias: ['FFO', 'AFFO', 'fondos de operación'],
  },

  'cap-rate': {
    titulo: 'Cap rate',
    corto: 'Ingreso operativo neto anual de un inmueble entre su valor. Es el rendimiento del ladrillo, sin financiamiento.',
    largo: [
      'El ingreso operativo neto son las rentas menos los gastos de operación del inmueble, sin intereses ni impuestos corporativos. Dividido entre el valor del inmueble da el cap rate.',
      'Es el inverso de un múltiplo: un cap rate de 8 por ciento equivale a pagar 12.5 veces el ingreso operativo. Los cap rate suben cuando suben las tasas, porque el inmueble compite con los bonos.',
      'La comparación más útil para una FIBRA mexicana es el cap rate implícito contra la tasa de los CETES o del bono M. El diferencial dice cuánto paga el inmueble sobre la deuda del gobierno, y ese diferencial es lo que se está cobrando por el riesgo y la falta de liquidez.',
    ],
    formula: 'Cap rate = ingreso operativo neto anual / valor del inmueble',
    comoLeer: 'Un cap rate alto puede ser una oportunidad o un inmueble con problemas de ocupación. Míralo junto a la ocupación y al plazo de los contratos.',
    ejemplo: 'Un inmueble con ingreso operativo neto de 80 millones valuado en mil millones tiene un cap rate de 8 por ciento. Con CETES en 8 por ciento, el diferencial es cero.',
    fuente: 'Práctica de valuación inmobiliaria. Appraisal Institute, The Appraisal of Real Estate.',
    relacionados: ['fibra', 'nav-p-nav', 'ffo-affo', 'cetes', 'bono-m'],
    alias: ['tasa de capitalización', 'cap rate implícito'],
  },

  'nav-p-nav': {
    titulo: 'NAV y P/NAV',
    corto: 'El valor de los activos menos la deuda, y qué tanto cotiza la FIBRA arriba o abajo de ese valor.',
    largo: [
      'El NAV es el valor de mercado de los inmuebles menos la deuda y otros pasivos, dividido entre los certificados en circulación. El P/NAV compara el precio de mercado contra ese valor.',
      'Un P/NAV debajo de uno quiere decir que el mercado vale el vehículo en menos que la suma de sus inmuebles. Puede ser una oportunidad, o puede ser desconfianza en la valuación de los inmuebles, en la administración o en el nivel de deuda.',
      'El NAV depende de avalúos, que se actualizan con rezago y con criterios propios. Por eso el mercado suele anticiparse al NAV en los giros, y conviene ver el cap rate implícito como comprobación independiente.',
    ],
    formula: 'NAV = valor de los inmuebles − deuda − otros pasivos;  P/NAV = precio por certificado / NAV por certificado',
    comoLeer: 'Un descuento persistente contra NAV casi siempre está diciendo algo. Busca qué antes de asumir que el mercado se equivoca.',
    ejemplo: 'Un NAV por certificado de 30 pesos con precio de mercado de 24 da un P/NAV de 0.8, un descuento de 20 por ciento.',
    fuente: 'Práctica de análisis de REIT. Nareit y reportes trimestrales de las propias FIBRAs.',
    relacionados: ['fibra', 'cap-rate', 'ltv', 'p-vl', 'ffo-affo'],
    alias: ['NAV', 'valor de activos netos', 'descuento contra NAV'],
  },

  ltv: {
    titulo: 'LTV (deuda sobre valor de activos)',
    corto: 'Cuánta deuda trae la FIBRA por cada peso de valor de sus inmuebles. Tiene límite regulatorio en México.',
    largo: [
      'El LTV correcto es deuda total entre el valor de los activos, no entre el valor de mercado del capital. La Comisión Nacional Bancaria y de Valores limita el apalancamiento de las FIBRAs al 50 por ciento de sus activos totales, y exige además un índice de cobertura de servicio de la deuda.',
      'Esta app antes calculaba algo distinto con el mismo nombre: deuda entre deuda más capitalización de mercado. Ese número se mueve con el precio de la acción y no es comparable contra el límite regulatorio. Aquí se calcula con activos, y si el dato no está se muestra s/d.',
      'Un LTV alto no es solo riesgo de solvencia: también limita la capacidad de crecer comprando inmuebles, porque la FIBRA tendría que emitir certificados y diluir.',
    ],
    formula: 'LTV = deuda total / valor total de los activos',
    comoLeer: 'Compáralo contra el límite del 50 por ciento y contra el promedio de las FIBRAs comparables. Revisa también los vencimientos y la moneda de la deuda.',
    ejemplo: 'Una FIBRA con 18 mil millones de deuda y 50 mil millones en activos tiene un LTV de 36 por ciento.',
    fuente: 'Disposiciones de carácter general aplicables a las emisoras, CNBV, límites de apalancamiento para FIBRAs.',
    relacionados: ['fibra', 'nav-p-nav', 'deuda-capital', 'cap-rate'],
    alias: ['loan to value', 'apalancamiento de FIBRA'],
  },

  'rendimiento-por-distribucion': {
    titulo: 'Rendimiento por distribución',
    corto: 'Lo que reparte una FIBRA en un año entre su precio. Es bruto, antes de retención.',
    largo: [
      'Se calcula con las distribuciones de los últimos doce meses divididas entre el precio actual. Como las FIBRAs reparten al menos el 95 por ciento de su resultado fiscal, este rendimiento suele ser bastante mayor que el de dividendos de acciones.',
      'Un rendimiento muy alto casi siempre viene de una caída de precio, no de un aumento de la distribución. Antes de leerlo como una buena noticia hay que ver si el precio bajó y por qué.',
      'La sostenibilidad se revisa contra el AFFO, no contra la utilidad. Si la distribución supera al AFFO de forma consistente, se está financiando con deuda o con venta de activos.',
    ],
    formula: 'Rendimiento = distribuciones de los últimos 12 meses / precio por certificado',
    comoLeer: 'Es bruto: a las distribuciones de FIBRAs se les retiene ISR. Y no está garantizado: baja cuando baja el resultado fiscal.',
    ejemplo: 'Distribuciones de 2.40 pesos en doce meses con un precio de 24 pesos dan un rendimiento de 10 por ciento bruto.',
    fuente: 'Reportes trimestrales de las FIBRAs. Retención según los arts. 187 y 188 de la Ley del ISR.',
    relacionados: ['fibra', 'ffo-affo', 'retencion-por-dividendos', 'cap-rate', 'rendimiento-total'],
    alias: ['dividend yield de FIBRA', 'distribución'],
  },

  // ─── Mercados, fuentes y calidad del dato ────────────────────────────────────────────────────
  bmv: {
    titulo: 'BMV',
    corto: 'La Bolsa Mexicana de Valores, donde cotizan las emisoras mexicanas. Desde 2018 comparte mercado con BIVA.',
    largo: [
      'La BMV es la bolsa principal de México. Su índice de referencia es el S&P/BMV IPC, que agrupa a las emisoras más grandes y líquidas y es un índice de precio, no de rendimiento total.',
      'Desde 2018 existe una segunda bolsa, BIVA, y las emisoras pueden listarse en cualquiera de las dos. Las órdenes se enrutan al mejor precio disponible entre las dos, así que en la práctica el mercado es uno solo.',
      'El horario de operación es de 8:30 a 15:00 hora de la Ciudad de México, con un calendario de días inhábiles propio que no coincide con el estadounidense. Por eso hay días en que una serie tiene dato y la otra no, y por eso las series se alinean por fecha en vez de por posición.',
    ],
    formula: 'Sin fórmula. El sufijo de las emisoras mexicanas en las fuentes de datos es .MX, por ejemplo WALMEX.MX.',
    comoLeer: 'Al comparar contra el IPC, recuerda que es índice de precio. Para rendimiento total, Kaizen usa NAFTRAC.MX como referencia.',
    ejemplo: 'Un lunes festivo en México con mercado abierto en Nueva York deja un día sin dato mexicano, y ese día se cae de la comparación.',
    fuente: 'Bolsa Mexicana de Valores. S&P Dow Jones Indices, metodología del S&P/BMV IPC.',
    relacionados: ['sic', 'rendimiento-total', 'isr-ganancia-de-capital', 'dato-con-retraso'],
    alias: ['bolsa mexicana', 'IPC', 'BIVA'],
  },

  sic: {
    titulo: 'SIC',
    corto: 'Sistema Internacional de Cotizaciones: la ventana desde la que se compran acciones y ETF extranjeros en México.',
    largo: [
      'El SIC lista valores que ya cotizan en mercados de fuera y los hace comprables desde una casa de bolsa mexicana, en pesos y en horario local. Es como la mayoría de la gente en México tiene exposición al S&P 500 o a empresas estadounidenses.',
      'Dos cosas que hay que saber. El precio en pesos incorpora el tipo de cambio, así que tu resultado tiene efecto precio y efecto moneda. Y la liquidez del SIC es menor que la del mercado de origen, así que el diferencial de compra y venta suele ser más ancho.',
      'Para efectos fiscales, las ganancias por enajenar acciones listadas en el SIC también quedan bajo el régimen del artículo 129, con el 10 por ciento sobre la ganancia anual neta. Los dividendos de emisoras extranjeras siguen las reglas del tratado que corresponda.',
    ],
    formula: 'Sin fórmula. Precio en pesos = precio en el mercado de origen × tipo de cambio, más el diferencial local.',
    comoLeer: 'Si compras SIC, tu exposición al dólar es real aunque pagues en pesos. Revísala en la tabla de exposición por moneda.',
    ejemplo: 'Comprar el ETF del S&P 500 vía SIC da exposición a 500 empresas y, al mismo tiempo, 100 por ciento de exposición al dólar.',
    fuente: 'Bolsa Mexicana de Valores, Sistema Internacional de Cotizaciones. Régimen fiscal: LISR arts. 129 y 140.',
    relacionados: ['bmv', 'tipo-de-cambio-fix', 'efecto-precio-efecto-fx', 'isr-ganancia-de-capital', 'hhi'],
    alias: ['mercado global', 'acciones extranjeras'],
  },

  'dato-con-retraso': {
    titulo: 'Dato con retraso',
    corto: 'Casi ningún precio gratuito es en tiempo real. Kaizen dice cuánto retraso trae y de cuándo es el dato.',
    largo: [
      'Las cotizaciones que llegan por fuentes públicas suelen venir con 15 o 20 minutos de retraso, y fuera de horario lo que se muestra es el cierre del último día hábil. Ninguna de las dos cosas está mal, pero ocultarlas sí.',
      'Cada respuesta del API de Kaizen trae la fecha del dato, su fuente y los minutos de retraso, y cada tarjeta muestra esa información en una etiqueta. Si el dato es viejo, se marca como no vigente.',
      'La consecuencia práctica: no uses estos precios para decidir a qué precio entra una orden. Sirven para analizar, comparar y medir, no para operar al segundo.',
    ],
    formula: 'Sin fórmula. En el API: meta.asOf, meta.source, meta.delayMinutes y meta.stale.',
    comoLeer: 'Si la etiqueta dice cierre de una fecha anterior, el dato es de esa fecha. Si dice retraso de 15 minutos, el mercado ya se movió desde entonces.',
    ejemplo: 'Una etiqueta que dice cierre del 19 de septiembre significa que el mercado estuvo cerrado desde entonces, no que el sistema falló.',
    fuente: 'Convención de Kaizen para el API v2: campo meta en toda respuesta.',
    relacionados: ['dato-de-respaldo', 'bmv', 'tipo-de-cambio-fix', 'vix'],
    alias: ['delay', 'retraso', 'datos diferidos'],
  },

  'dato-de-respaldo': {
    titulo: 'Dato de respaldo',
    corto: 'Cuando la fuente principal no responde, Kaizen usa una alternativa y lo dice en pantalla. Nunca se muestra como si fuera la buena.',
    largo: [
      'Si Banxico no contesta, la tasa libre de riesgo se toma de una serie equivalente de FRED. Si un fundamental no viene, se deja en s/d en lugar de estimarlo. La regla es que un dato sustituto siempre viene marcado y nunca se presenta como dato en vivo.',
      'Esto existe por una razón concreta: la versión anterior de esta app rellenaba el tipo de cambio con un 17.50 fijo cuando la fuente fallaba, y una tasa libre de riesgo con un valor fijo. Ninguno de los dos avisaba, así que las pantallas se veían normales con números inventados.',
      'Hoy no hay valores fijos escondidos. Si falta el dato, falta, y la etiqueta lo dice con su fuente alterna y su fecha.',
    ],
    formula: 'Sin fórmula. En el API: meta.fallback en verdadero y meta.notes con el motivo.',
    comoLeer: 'Una etiqueta de respaldo no invalida el número, solo te dice que viene de una fuente distinta. Revisa la fecha antes de compararlo con otra pantalla.',
    ejemplo: 'Una tarjeta de tasas que dice respaldo de FRED está usando una serie equivalente porque Banxico no respondió en ese momento.',
    fuente: 'Convención de Kaizen para el API v2: meta.fallback, meta.source y meta.notes.',
    relacionados: ['dato-con-retraso', 'tasa-libre-de-riesgo', 'tipo-de-cambio-fix', 'inpc'],
    alias: ['fallback', 'fuente alterna'],
  },
}

// ─── API pública ───────────────────────────────────────────────────────────────────────────────

/**
 * Quita acentos, pasa a minúsculas y recorta. Es lo que hace que buscar "volatilidad" encuentre
 * "Volatilidad" y que "formula magica" encuentre "Fórmula mágica".
 * @param {unknown} value
 * @returns {string}
 */
function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
}

/**
 * Convierte texto libre en un slug con el mismo formato de las llaves: minúsculas, sin acentos y
 * con guion ASCII entre palabras. "P/U" da "p-u" y "Fórmula mágica" da "formula-magica".
 * @param {unknown} value
 * @returns {string}
 */
export function slugify(value) {
  return normalize(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/** Glosario completo, congelado, con el slug dentro de cada término. @type {Record<string, GlossaryTerm>} */
export const glossary = Object.freeze(
  Object.fromEntries(
    Object.entries(TERMS).map(([slug, term]) => [
      slug,
      Object.freeze({
        slug,
        ...term,
        largo: Object.freeze([...term.largo]),
        relacionados: Object.freeze([...term.relacionados]),
        alias: Object.freeze([...(term.alias ?? [])]),
      }),
    ]),
  ),
)

/** Todos los slugs, en el orden en que están escritos (temático, no alfabético). @type {string[]} */
export const glossarySlugs = Object.freeze(Object.keys(glossary))

/** Todos los términos ordenados por título, que es como se listan en /aprender. @type {GlossaryTerm[]} */
export const glossaryTerms = Object.freeze(
  Object.values(glossary).sort((a, b) => a.titulo.localeCompare(b.titulo, 'es-MX')),
)

/** Cuántos términos tiene el glosario. */
export const glossaryCount = glossarySlugs.length

// Índice de búsqueda: se arma la primera vez que alguien busca, no al importar el módulo.
/** @type {Map<string, {titulo: string, alias: string[], corto: string, cuerpo: string, todo: string}>} */
let searchIndex = null

function buildIndex() {
  const index = new Map()
  for (const term of glossaryTerms) {
    const titulo = normalize(term.titulo)
    const alias = (term.alias ?? []).map(normalize)
    const corto = normalize(term.corto)
    const cuerpo = normalize([...term.largo, term.formula, term.comoLeer, term.ejemplo, term.fuente].join(' '))
    index.set(term.slug, { titulo, alias, corto, cuerpo, todo: [term.slug, titulo, alias.join(' '), corto, cuerpo].join(' ') })
  }
  return index
}

function indexFor(slug) {
  if (!searchIndex) searchIndex = buildIndex()
  return searchIndex.get(slug)
}

/**
 * Qué tan bien le queda la consulta a un término. Más alto es mejor; 0 es que no aplica.
 * El orden favorece el título sobre el cuerpo, para que "beta" no traiga primero un término que
 * solo menciona beta de pasada.
 */
function scoreTerm(slug, entry, nq, tokens) {
  if (slug === nq || entry.titulo === nq || entry.alias.includes(nq)) return 1000
  let score = 0
  if (entry.titulo.startsWith(nq) || slug.startsWith(nq)) score = 700
  else if (entry.alias.some((a) => a.startsWith(nq))) score = 600
  else if (entry.titulo.includes(nq)) score = 500
  else if (entry.alias.some((a) => a.includes(nq))) score = 400
  else if (entry.corto.includes(nq)) score = 300
  else if (entry.cuerpo.includes(nq)) score = 150
  // Consulta de varias palabras que no aparece junta: se puntúa por dónde cae cada palabra.
  if (score === 0) {
    for (const token of tokens) {
      if (entry.titulo.includes(token)) score += 60
      else if (entry.alias.some((a) => a.includes(token))) score += 40
      else if (entry.corto.includes(token)) score += 25
      else score += 10
    }
  }
  return score
}

/**
 * Busca términos del glosario. No distingue mayúsculas ni acentos, acepta varias palabras (tienen
 * que aparecer todas) y devuelve los términos ordenados de más a menos relevante.
 *
 * Una consulta vacía devuelve una lista vacía a propósito: quien quiera listar todo usa
 * `glossaryTerms`.
 *
 * @param {string} query Texto libre, por ejemplo "sharpe", "SHARPE" o "razon de sharpe".
 * @param {{limit?: number}} [options] `limit` corta la lista; por omisión 20.
 * @returns {GlossaryTerm[]}
 */
export function glossarySearch(query, { limit = 20 } = {}) {
  const nq = normalize(query)
  if (!nq) return []
  const tokens = nq.split(/\s+/).filter(Boolean)
  /** @type {{term: GlossaryTerm, score: number}[]} */
  const hits = []
  for (const term of glossaryTerms) {
    const entry = indexFor(term.slug)
    if (!entry) continue
    if (!tokens.every((token) => entry.todo.includes(token))) continue
    hits.push({ term, score: scoreTerm(term.slug, entry, nq, tokens) })
  }
  hits.sort((a, b) => b.score - a.score || a.term.titulo.localeCompare(b.term.titulo, 'es-MX'))
  return hits.slice(0, Math.max(0, limit)).map((hit) => hit.term)
}

/**
 * Trae un término por su slug. Es tolerante: acepta "Sharpe", "P/U" o un alias exacto como
 * "desviación estándar". Devuelve null si no existe, para que la interfaz pueda caer a su texto
 * propio en vez de tronar.
 * @param {string} slug
 * @returns {GlossaryTerm|null}
 */
export function getTerm(slug) {
  const key = slugify(slug)
  if (!key) return null
  if (glossary[key]) return glossary[key]
  const asAlias = normalize(slug)
  for (const term of glossaryTerms) {
    if ((term.alias ?? []).some((a) => normalize(a) === asAlias)) return term
  }
  return null
}

/** ¿Existe este término? @param {string} slug @returns {boolean} */
export function hasTerm(slug) {
  return getTerm(slug) !== null
}

/**
 * Los términos relacionados de uno dado, ya resueltos a objetos y sin huecos.
 * @param {string} slug
 * @returns {GlossaryTerm[]}
 */
export function relatedTerms(slug) {
  const term = getTerm(slug)
  if (!term) return []
  return term.relacionados.map((s) => glossary[s]).filter(Boolean)
}

/**
 * La liga a la página del término dentro de /aprender. Usa pathLearnTerm para no repetir la ruta.
 * @param {string} slug
 * @returns {string}
 */
export function glossaryHref(slug) {
  return pathLearnTerm(slugify(slug))
}

/**
 * Lo mínimo que necesita un InfoTip: título, una línea y a dónde va el "ver más". Devuelve null
 * cuando el término no existe, y en ese caso el componente usa su propio texto.
 * @param {string} slug
 * @returns {{slug: string, titulo: string, corto: string, href: string}|null}
 */
export function glossaryTip(slug) {
  const term = getTerm(slug)
  if (!term) return null
  return { slug: term.slug, titulo: term.titulo, corto: term.corto, href: glossaryHref(term.slug) }
}
