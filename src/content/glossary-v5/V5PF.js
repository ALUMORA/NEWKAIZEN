// Términos del glosario de V5PF (agenda y rayos X: temporada de reportes, traslape de ETF, exposición por transparencia).
// Mismo esquema que TERMS de src/content/glossary.js (sin `slug`: la llave es el slug) y las mismas
// reglas: español de México, sin guiones largos, sin lenguaje de recomendación, con fuente y con
// `relacionados` que existan. glossary.js une este objeto con los demás y falla si un slug se repite.

/** @type {{ [slug: string]: import('../glossary.js').GlossaryTermInput }} */
const TERMS = {
  'traslape-de-etf': {
    titulo: 'Traslape de ETF',
    corto: 'Qué tanto de dos fondos está en las mismas emisoras: si se traslapan mucho, tener los dos diversifica menos de lo que parece.',
    largo: [
      'Dos ETF distintos pueden tener adentro casi lo mismo. Un fondo del S&P 500 y uno del Nasdaq 100 comparten a las tecnológicas más grandes, así que al sumar los dos la concentración en esas emisoras crece aunque el portafolio se vea repartido en dos fondos.',
      'Kaizen mide el traslape como la suma, sobre las emisoras que los dos fondos comparten, del menor de los dos pesos. Yahoo solo publica las 10 posiciones principales de cada fondo, por eso el número es una cota inferior: el traslape real puede ser mayor.',
    ],
    formula: 'Traslape(A, B) = Σ min(peso en A, peso en B), sobre las emisoras que están en los 10 principales de los dos',
    comoLeer: 'Un 0% quiere decir que no comparten nada entre sus 10 principales; un 20% quiere decir que al menos una quinta parte de cada fondo está en las mismas emisoras.',
    ejemplo: 'Si SPY tiene 8.08% en NVIDIA, 7.03% en Apple y 5.69% en Microsoft, y QQQ tiene más en las tres, el traslape es al menos 8.08% + 7.03% + 5.69% = 20.80%.',
    fuente: 'Medida de traslape de posiciones por suma de mínimos, como la publican los comparadores de fondos; datos de Yahoo Finance vía yfinance.',
    relacionados: ['exposicion-por-transparencia', 'diversificacion', 'hhi'],
    alias: ['overlap', 'traslape entre fondos', 'solapamiento de ETF'],
  },
  'comision-del-fondo': {
    titulo: 'Comisión del fondo',
    corto: 'Lo que el fondo cobra al año por administrarlo, como porcentaje de lo invertido. Se descuenta del valor del fondo, no llega como cargo aparte.',
    largo: [
      'La comisión del fondo, que en inglés se llama expense ratio, es el costo anual de tener un ETF o un fondo de inversión. No se paga con un recibo: el administrador la descuenta poco a poco del patrimonio del fondo, así que ya viene restada en el precio.',
      'Parece poco, pero se acumula. Una diferencia de medio punto al año, compuesta durante veinte años, se come una parte visible del resultado final, sobre todo en fondos que replican el mismo índice y por lo demás son casi iguales.',
    ],
    formula: 'Costo anual ≈ monto invertido × comisión del fondo',
    comoLeer: 'Un 0.09% quiere decir que por cada 10,000 pesos invertidos el fondo se queda con unos 9 pesos al año.',
    ejemplo: 'Con 100,000 pesos en un fondo de 0.09% el costo es de unos 90 pesos al año; en uno de 0.75% sería de unos 750 pesos.',
    fuente: 'Prospecto de cada fondo; dato de Yahoo Finance vía yfinance (fund_operations, Annual Report Expense Ratio).',
    relacionados: ['rotacion-del-fondo', 'exposicion-por-transparencia', 'interes-compuesto'],
    alias: ['expense ratio', 'TER', 'gastos totales del fondo'],
  },
  'rotacion-del-fondo': {
    titulo: 'Rotación del fondo',
    corto: 'Qué parte de su portafolio cambia el fondo en un año. Mucha rotación suele traer más costos de operación, que no siempre aparecen en la comisión.',
    largo: [
      'La rotación, turnover en inglés, compara lo que el fondo vendió o compró en el año contra el tamaño de su portafolio. Un fondo que replica un índice amplio cambia poco; uno que se administra de forma activa puede cambiar casi todo cada año.',
      'Cada cambio paga comisiones de intermediación y diferencial entre compra y venta, y esos costos se restan del fondo aparte de su comisión. Por eso dos fondos con la misma comisión pueden costar distinto en la práctica.',
    ],
    formula: 'Rotación = menor entre compras y ventas del año ÷ patrimonio promedio del fondo',
    comoLeer: 'Un 3% quiere decir que el fondo cambió alrededor de 3 de cada 100 pesos de su portafolio en el año; un 100% quiere decir que lo cambió casi todo.',
    ejemplo: 'Un ETF del S&P 500 suele rotar menos de 5% al año, porque solo ajusta cuando cambia el índice.',
    fuente: 'Definición de la SEC para el formulario N-1A; dato de Yahoo Finance vía yfinance (fund_operations, Annual Holdings Turnover).',
    relacionados: ['comision-del-fondo', 'rebalanceo'],
    alias: ['turnover', 'rotación de cartera'],
  },
  'temporada-de-reportes': {
    titulo: 'Temporada de reportes',
    corto: 'Las semanas después de cada trimestre en que las empresas publican sus resultados. Ahí se mueven más los precios por noticias de la propia empresa.',
    largo: [
      'Las emisoras listadas publican resultados cada trimestre. En la BMV el plazo es de unas cuatro semanas después del cierre del trimestre, así que los reportes se juntan en ventanas de abril, julio, octubre y febrero; en Estados Unidos pasa algo parecido.',
      'Kaizen muestra la temporada sobre una muestra curada de emisoras de México y de Estados Unidos, no sobre todo el mercado, con la fecha de reporte y lo que esperan los analistas. Las fechas pueden moverse: la emisora es quien las confirma.',
    ],
    formula: 'No aplica: es un calendario. Ventana = fechas de reporte entre hoy y hoy más 30, 60 o 90 días',
    comoLeer: 'Si varias emisoras de tu portafolio reportan la misma semana, esa semana tu portafolio puede moverse más de lo normal.',
    ejemplo: 'WALMEX tenía su reporte del tercer trimestre de 2026 previsto para el 27 de octubre, con una utilidad por acción estimada de 0.71 pesos.',
    fuente: 'Reglamento Interior de la BMV (plazos de información trimestral); fechas de Yahoo Finance vía yfinance (Ticker.calendar).',
    relacionados: ['estimado-de-upa', 'bmv', 'p-u'],
    alias: ['earnings season', 'temporada de resultados'],
  },
  'estimado-de-upa': {
    titulo: 'Estimado de UPA (consenso)',
    corto: 'La utilidad por acción que esperan, en promedio, los analistas que siguen a la emisora para un trimestre. Es una expectativa, no un dato.',
    largo: [
      'La UPA es la utilidad neta dividida entre las acciones en circulación. El consenso es el promedio de lo que estiman los analistas que cubren a la emisora, y el rango va del estimado más bajo al más alto. Un rango amplio quiere decir que no se ponen de acuerdo.',
      'En la BMV muchas emisoras tienen de 2 a 4 analistas, así que un solo cambio mueve mucho el promedio. Comparar el resultado real contra el consenso explica parte de cómo reacciona el precio el día del reporte, pero no dice si la acción está cara o barata.',
    ],
    formula: 'Consenso = promedio de las estimaciones de UPA de los analistas; rango = [mínimo, máximo]',
    comoLeer: 'Si una emisora reporta una UPA mayor que el consenso, se dice que superó lo esperado; eso no es una señal de inversión por sí sola.',
    ejemplo: 'Un consenso de 0.71 pesos con rango de 0.70 a 0.73 pesos quiere decir que los analistas casi coinciden.',
    fuente: 'Estimaciones de analistas publicadas por Yahoo Finance vía yfinance (Earnings Average, Low y High).',
    relacionados: ['temporada-de-reportes', 'p-u', 'earnings-yield'],
    alias: ['consenso de UPA', 'EPS estimate', 'utilidad por acción esperada'],
  },
  'exposicion-por-transparencia': {
    titulo: 'Exposición por transparencia',
    corto: 'Ver el portafolio por dentro: sumar tus acciones directas con lo que hay adentro de cada ETF para saber cuánto tienes de verdad en cada sector y emisora.',
    largo: [
      'Un ETF es una canasta. Si tienes Apple directo y además un fondo del S&P 500, tu exposición a Apple es lo que tienes directo más el peso del fondo por el peso de Apple dentro del fondo. A eso se le llama cálculo por transparencia, look-through en inglés.',
      'Kaizen lo calcula con la composición que publica Yahoo: el reparto por sector y las 10 posiciones principales de cada fondo. La cobertura dice qué parte del portafolio se pudo ver por dentro; lo que no se ve, como los ETF de la BMV sin datos, no se reparte.',
    ],
    formula: 'Exposición a X = peso directo en X + Σ (peso del ETF × peso de X dentro del ETF)',
    comoLeer: 'Una exposición de 13.5% a Apple quiere decir que de cada 100 pesos del portafolio, al menos 13.50 dependen de Apple, sumando lo directo y lo que viene en fondos.',
    ejemplo: 'Con 10% en Apple directo y 50% en SPY, que tiene 7.03% en Apple, la exposición es 10% + 50% × 7.03% = 13.515%.',
    fuente: 'Método de análisis por transparencia (look-through) de Morningstar Portfolio X-Ray; composición de Yahoo Finance vía yfinance.',
    relacionados: ['traslape-de-etf', 'diversificacion', 'comision-del-fondo'],
    alias: ['look-through', 'rayos X', 'exposición real'],
  },
}

export default TERMS
