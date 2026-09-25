# Fuentes de datos

De dónde sale cada número de Kaizen, con qué retraso llega, qué pasa cuando una fuente falla y qué
cosas la aplicación decidió no inventar.

Kaizen es una herramienta educativa y de análisis. Nada de lo que muestra es recomendación de
inversión, y sus precios no sirven para decidir a qué precio entra una orden.

## La regla de la casa

**Todo dato trae su procedencia.** Cada respuesta del API v2 incluye un bloque `meta` con seis
campos que la interfaz muestra:

| Campo | Qué dice |
| --- | --- |
| `asOf` | La fecha o el instante del dato más reciente de esa respuesta |
| `source` | Qué proveedor lo dio |
| `delayMinutes` | Cuántos minutos de retraso trae, cuando aplica |
| `stale` | Si el dato ya se considera viejo para su clase |
| `fallback` | Si vino de una fuente sustituta en vez de la principal |
| `notes` | Aclaraciones, por ejemplo cuando un tipo de cambio se arrastró un día |

`fallback` en verdadero nunca se muestra como dato en vivo. Se marca con etiqueta y se nombra la
fuente alterna.

## De dónde viene cada cosa

| Dato | Fuente principal | Respaldo | Retraso típico |
| --- | --- | --- | --- |
| Precios y cotizaciones | Yahoo Finance | Ninguno | 15 a 20 minutos, o cierre del último día hábil |
| Historia de precios | Yahoo Finance, cierre ajustado | Ninguno | Fin de día |
| Sector de cada emisora | Yahoo Finance, la misma consulta del precio; el sector se traduce al español y la industria queda como la publica Yahoo | Ninguno: sin sector sale s/d, nunca adivinado | Cambia rara vez |
| Tipo de cambio USD/MXN | Banxico FIX, serie SF43718 | Yahoo `MXN=X`, marcado | Un día hábil, por definición del FIX |
| Tasa objetivo | Banxico, serie SF61745 | Ninguno | Día del anuncio |
| CETES, TIIE, UDI, INPC | Banxico SIE e Inegi | FRED para la tasa libre de riesgo | Un día hábil; la inflación anual del INPC es mensual (SIE `SP30578`, subyacente `SP74662`) |
| Tasa libre de riesgo | Banxico, CETES 28 | FRED `IR3TIB01MXM156N`, marcado | Un día hábil |
| Tasas y macro de Estados Unidos | FRED | Ninguno | Un día hábil |
| VIX | Cboe vía el proveedor de mercado | Ninguno | 15 minutos o cierre |
| Estados financieros de emisoras de Estados Unidos | SEC EDGAR, datos XBRL | Yahoo | Semanas: el rezago de publicación |
| Estados financieros de emisoras mexicanas | Yahoo | Ninguno | Semanas |
| Lista de emisoras para el buscador | SEC company tickers y una lista curada de símbolos mexicanos | La lista mexicana vive en el repositorio, no necesita red | Estática |
| Noticias | Fuentes RSS públicas | Ninguno | Minutos |

## Lo que NO se hace

Estas decisiones vienen de defectos concretos de la versión anterior:

1. **No hay tipo de cambio fijo.** Antes, cuando la fuente de USD/MXN fallaba, la aplicación usaba
   17.50 en silencio. Hoy, si no hay tipo de cambio real, la respuesta es un error 503 y la pantalla
   lo dice. Un número inventado es peor que un hueco, porque el hueco se ve.
2. **No hay tasa libre de riesgo fija.** Antes había un 8.6 por ciento escrito en el código. Hoy es
   una serie con fecha, y si Banxico no contesta se usa la serie equivalente de FRED con la etiqueta
   de respaldo.
3. **No se inventan estados trimestrales.** La versión vieja dividía las cifras anuales entre cuatro
   y las multiplicaba por factores inventados para llenar los trimestres. Hoy se muestran solo los
   renglones que de verdad reportó la empresa, y los periodos sin dato salen vacíos.
4. **No hay panel macro de México escrito a mano.** Antes estaba hardcodeado y llevaba meses sin
   actualizarse. Hoy sale de Banxico con la fecha de cada serie.
5. **Casi nunca se rellena hacia adelante.** Si a una serie de precios le falta un día, ese día se
   cae de la comparación: el cruce de series es por fecha ISO y no inventa el dato faltante. Hay
   exactamente dos excepciones:
   - **El tipo de cambio** se puede arrastrar hasta 3 días, para cubrir puentes y días inhábiles.
     Ese arrastre lo hace el servidor al convertir la moneda, y cuando lo usa lo escribe en
     `meta.notes`.
   - **La tasa libre de riesgo** se arrastra hasta 45 días naturales. Se usa la tasa vigente al
     inicio de cada periodo, y si no hay dato publicado dentro de esa ventana, el periodo sale
     nulo en vez de suponer una tasa. Este arrastre no lo hace el servidor sino la librería
     financiera del navegador, así que no aparece en `meta.notes`: la señal es el propio nulo. Un
     solo periodo sin tasa basta para que el Sharpe, el Sortino y el Treynor de esa ventana no se
     calculen, y la pantalla muestra `s/d` o recorta el tramo, nunca un número con la tasa
     inventada. Esto importa más de lo que parece, porque esa serie alimenta todas las
     regresiones en exceso: casi toda la pantalla de riesgo.

## Moneda

Esta es la fuente de más errores silenciosos, así que la regla es estricta:

- Cada instrumento tiene **moneda de cotización** y **moneda de reporte**, y las dos se publican en
  la pantalla de la emisora. Una emisora mexicana puede cotizar en pesos y reportar en dólares.
- **Cualquier razón que mezcle precio con estados financieros** convierte primero. Un P/U con precio
  en pesos y utilidad en dólares es un número sin significado.
- **Las conversiones usan el tipo de cambio de la misma fecha del dato**, no el de hoy.
- Las series de historia aceptan `ccy=MXN` y devuelven el tipo de cambio que usaron.

## Calendarios de mercado

La BMV opera de 8:30 a 15:00 hora de la Ciudad de México, y su calendario de días inhábiles no
coincide con el de Nueva York. Por eso hay fechas con dato de un lado y no del otro, y por eso todo
cruce de series es por fecha ISO.

El estado del mercado, abierto o cerrado, y la próxima apertura se calculan con el calendario de
cada bolsa y se muestran con su etiqueta, por ejemplo "cierre vie 19 sep".

## Unidades del API

Para que nadie tenga que adivinar:

- Toda tasa, rendimiento, margen, crecimiento, peso o probabilidad va como **fracción decimal**.
  0.0123 es 1.23 por ciento.
- Los **cambios de tasa** van en puntos base, en campos que terminan en `Bp`.
- Los **múltiplos** van como razón simple, sin unidad.
- Las **fechas** son ISO `YYYY-MM-DD` y los instantes ISO 8601 con zona.
- Los montos van en la moneda del campo `currency` más cercano.

En la interfaz, el signo menos es U+2212, el dato faltante se escribe `s/d` y un múltiplo negativo
se escribe `n/s`.

## Licencias y límites

Esto es importante y no se esconde:

- **Yahoo Finance no es una fuente licenciada** para un producto de paga ni para uso comercial. Es
  la fuente de arranque mientras se contrata un proveedor con licencia. La capa de proveedores está
  aislada justamente para poder cambiarla sin tocar el resto.
- **Los datos de la BMV tienen restricciones de redistribución.** Mostrarlos dentro de la aplicación
  a un usuario no es lo mismo que redistribuirlos, y antes de cobrar por el servicio hay que
  revisarlo con la bolsa.
- **Las noticias se muestran como encabezado y liga al original.** No se copia el cuerpo de las
  notas.
- **El léxico Loughran y McDonald se descartó** para medir tono de noticias: solo existe en inglés y
  su licencia comercial no es clara. El tono que se muestra, cuando se muestra, viene de una
  heurística propia y está etiquetado como tal.

## Pruebas sin red

Todas las llamadas a proveedores se grabaron una vez y se reproducen desde disco. Las pruebas no
salen a internet, así que corren igual en cualquier máquina y no dependen de que Yahoo conteste.
Cuando una llamada grabada viene vacía porque el proveedor falló ese día, eso queda registrado como
tal en vez de convertirse en un cero.

## Nota para quien programe la interfaz

El glosario `src/content/glossary.js` pesa alrededor de 150 KB de texto. Cárgalo con
`src/content/glossary-lazy.js`, que usa `import()` dinámico, para que Vite lo deje en su propio
fragmento y no entre al paquete de la primera ruta. El InfoTip solo lo necesita cuando alguien abre
un globo de ayuda, y la página de aprender cuando alguien entra a ella.

## Términos relacionados en el glosario

dato-con-retraso, dato-de-respaldo, tipo-de-cambio-fix, tasa-libre-de-riesgo, inpc, cetes, bmv, sic,
puntos-base.
