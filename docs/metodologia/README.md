# Metodología de Kaizen

Una página por herramienta, con el método exacto que corre por debajo, los supuestos que hace y
lo que no puede hacer. Están escritas para que cualquiera pueda revisar las cuentas, no para
convencer a nadie de nada.

Kaizen es una herramienta educativa y de análisis. Nada de lo que hay aquí es recomendación de
inversión.

## Las páginas

| Página | De qué habla |
| --- | --- |
| [portafolio.md](portafolio.md) | Cómo se arma tu portafolio desde movimientos, TWR, XIRR, costo promedio, efecto precio contra efecto tipo de cambio e ISR estimado |
| [riesgo.md](riesgo.md) | Volatilidad, caída máxima, VaR, CVaR, beta contra referentes locales, concentración y contribución al riesgo |
| [optimizador.md](optimizador.md) | Covarianza con contracción, mínima varianza, portafolio tangente, paridad de riesgo, frontera y validación walk forward |
| [backtest.md](backtest.md) | Comprar y mantener contra mezcla constante, elección de referente, CAGR, y los sesgos que un backtest no puede quitar |
| [simulador.md](simulador.md) | Monte Carlo lognormal, remuestreo por bloques, aportaciones, inflación y probabilidad de alcanzar una meta |
| [screener-de-factores.md](screener-de-factores.md) | Puntajes robustos relativos al sector, conversión de múltiplos a rendimientos, cobertura y reglas de exclusión |
| [formula-magica.md](formula-magica.md) | La versión honesta de Greenblatt: definiciones exactas de EY y ROC, exclusiones y empates |
| [fibras.md](fibras.md) | FFO y AFFO de verdad, cap rate implícito, LTV sobre activos, NAV y diferencial contra CETES |
| [valuacion-dcf.md](valuacion-dcf.md) | DCF de dos etapas sobre FCFF, CAPM con riesgo país, WACC, guardas del valor terminal y el caso de los bancos |
| [fuentes-de-datos.md](fuentes-de-datos.md) | De dónde sale cada dato, con qué retraso, qué se hace cuando falla una fuente y qué NO se inventa |

## Reglas que valen para todas

1. **Nunca se mezclan monedas.** Toda serie de precios o rendimientos que entra a un cálculo ya
   viene en una sola moneda, y las conversiones usan el tipo de cambio FIX de la fecha que
   corresponde, no el de hoy.
2. **Las series se alinean por fecha, no por posición.** Si a un activo le falta un día, ese día
   se cae de la comparación. No se rellena hacia adelante, porque rellenar inventa un dato que
   nadie observó.
3. **Un dato que falta se muestra `s/d`.** No se estima, no se sustituye por cero y no se
   esconde. Si viene de una fuente sustituta, la pantalla lo marca como respaldo.
4. **Las estadísticas usan muestra, no población.** Varianzas y covarianzas dividen entre n−1.
   Cuando no hay datos suficientes, la función devuelve nulo y la pantalla muestra `s/d`.
5. **Las simulaciones tienen semilla.** La misma entrada da exactamente el mismo resultado, para
   que una diferencia entre dos escenarios sea la diferencia y no el ruido del muestreo.
6. **Nada de lenguaje de compra o venta.** Los resultados se presentan como "cumple" o "no
   cumple" frente a criterios que tú puedes leer, nunca como una instrucción.

## Cómo se relaciona con el glosario

Cada término técnico que aparece en estas páginas tiene su entrada en
[`src/content/glossary.js`](../../src/content/glossary.js), con fórmula, cómo leerlo, un ejemplo
en pesos y su fuente. En la aplicación se abre desde el icono de información de cada métrica o en
`/aprender/<término>`.
