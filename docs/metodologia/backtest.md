# Metodología del backtest

Qué simula exactamente el backtest de Kaizen, qué métricas reporta y qué sesgos no puede quitarle
ninguna herramienta.

Kaizen es una herramienta educativa y de análisis. Un backtest describe el pasado; no es
recomendación de inversión ni promesa de resultados.

## Qué cambió respecto a la versión anterior

Tres defectos concretos de la versión vieja quedaron corregidos:

1. El "rendimiento anual" era el promedio aritmético de los rendimientos semanales multiplicado por
   52. Eso no es lo que habría obtenido nadie: exagera, y más mientras más volátil sea la serie.
   Ahora se reporta CAGR, el rendimiento compuesto.
2. Aplicaba los pesos de hoy a toda la historia sin decirlo. Ahora, cuando eso ocurre, la pantalla
   lo dice con todas sus letras.
3. Alineaba las series por posición en el arreglo, no por fecha. Ahora el panel se cruza por fecha
   ISO y los días que le faltan a una serie se caen de la comparación.

## Las dos estrategias

**Comprar y mantener**, la opción por omisión. Se compra la cartera inicial y no se toca. Los pesos
se van moviendo solos con los precios, que es lo que de verdad pasa si uno no hace nada.

**Mezcla constante**, opcional. Se regresa a los pesos objetivo con la frecuencia que elijas: cada
periodo, mensual, trimestral, anual o nunca. Reporta también la rotación acumulada, para que el
costo de operar sea visible.

La diferencia entre las dos no es cosmética. Con `A = [+10%, −10%]`, `B = [0, 0]` y 50 y 50 desde
1, la mezcla constante termina en 0.9975 y comprar y mantener en 0.995. La mezcla constante gana en
mercados que oscilan sin tendencia y pierde en mercados con tendencia sostenida.

## Referente

Se elige entre tres, y todos quedan en pesos:

- IPC como rendimiento total, con NAFTRAC.MX.
- S&P 500 en pesos, con SPY de cierre ajustado convertido por el FIX de cada fecha.
- Una mezcla de los dos con el porcentaje que tú pongas.

El referente se alinea por fecha con la cartera. Un día festivo en México con mercado abierto en
Nueva York se cae de la comparación, en los dos lados.

## Métricas reportadas

| Métrica | Definición |
| --- | --- |
| CAGR | `(V_final / V_inicial)^(1/años) − 1` |
| Volatilidad anualizada | Desviación muestral por la raíz de los periodos por año |
| Caída máxima | Mínimo de `V_t / máx(V_0..V_t) − 1`, con fechas de pico, fondo y recuperación |
| Calmar | CAGR entre el valor absoluto de la caída máxima |
| Sharpe y Sortino | Sobre excesos contra la serie de CETES 28, no contra una constante |
| VaR y CVaR al 95 | Histórico y paramétrico, los dos etiquetados |
| Mejor y peor periodo | Y el porcentaje de periodos positivos |
| Rendimiento activo | Contra el referente elegido, con tracking error e information ratio |

Se dibuja además la curva de crecimiento de 1 peso y la gráfica de caídas, las dos con su
equivalente en tabla para lectores de pantalla.

## Qué NO incluye

Esto hay que decirlo antes que los resultados, no después:

- **No incluye comisiones ni diferencial de compra y venta.** Una estrategia que opera seguido se
  ve mejor de lo que sería.
- **No incluye impuestos.** En México, cada venta con ganancia realizada tiene efecto fiscal.
- **No modela liquidez.** Supone que puedes comprar y vender al precio de cierre, cosa que en
  emisoras chicas de la BMV no siempre es cierta.
- **No incluye dividendos que no estén en el cierre ajustado.** Se usan cierres ajustados, así que
  los dividendos están dentro, pero la retención fiscal sobre ellos no.

## Los sesgos que ninguna herramienta quita

**Supervivencia.** Si el universo de prueba son las emisoras que hoy siguen listadas, las que
quebraron o se deslistaron ya quedaron fuera, y eso solo puede mejorar el resultado. Kaizen dice
desde cuándo existe cada serie y con qué universo se corrió.

**Mirada al futuro.** Usar un dato en una fecha en la que todavía no se publicaba. Los estados
financieros salen con semanas de retraso; el backtest usa precios, que sí existen en su fecha, y
cuando usa fundamentales lo hace con el rezago de publicación.

**Pesos de hoy sobre historia anterior.** Reconstruir el pasado con la cartera que tienes ahora en
vez de la que tenías entonces. Es lo que hace la pantalla cuando pruebas tu cartera actual hacia
atrás, y por eso lo avisa.

**Sobreajuste.** Mientras más combinaciones pruebas sobre los mismos datos, más fácil es que una se
vea excelente por casualidad. La defensa es la validación walk forward del optimizador y mover
fechas y parámetros para ver si el resultado aguanta.

## Cómo leer un backtest

1. Mira primero la caída máxima y cuánto tardó en recuperarse, antes que el rendimiento.
2. Compara contra el referente en la misma moneda y el mismo periodo.
3. Mueve la fecha de inicio tres meses y vuelve a correrlo. Si el resultado cambia mucho, el
   resultado era la fecha.
4. Revisa cuántos periodos sostienen las cifras. Dos años de datos semanales son 104 observaciones,
   y con eso el Sharpe trae un error de estimación grande.

## Fuentes

- Brown, Goetzmann, Ibbotson y Ross (1992), Survivorship Bias in Performance Studies.
- Bailey, Borwein, López de Prado y Zhu (2014), The Probability of Backtest Overfitting.
- Perold y Sharpe (1988), Dynamic Strategies for Asset Allocation, para comprar y mantener contra
  mezcla constante.
- CFA Institute, GIPS 2020, para las definiciones de rendimiento compuesto.

## Términos relacionados en el glosario

cagr, backtest-sesgos, sobreajuste, drawdown-maximo, calmar, rebalanceo, rendimiento-total,
tracking-error, walk-forward.
