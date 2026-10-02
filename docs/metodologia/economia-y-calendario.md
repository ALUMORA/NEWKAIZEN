# Economía y calendario económico

Cómo arma Kaizen el calendario económico (/mercados/calendario) y el tablero de economía
(/mercados/economia), de dónde sale cada dato y qué no se muestra a propósito.

## Calendario económico

Cuatro calendarios, todos en hora del centro de México:

- **Banxico**: las ocho decisiones de política monetaria de 2026 a las 13:00, las minutas (dos
  semanas después de cada decisión), los informes trimestrales y los reportes de estabilidad
  financiera. Se transcribieron a mano del PDF oficial. El calendario de 2027 todavía no se publica,
  así que después del 17 de diciembre de 2026 no aparece ningún evento de Banxico y la pantalla lo
  avisa. Banxico se reserva el derecho de decidir fuera de calendario.
- **Reserva Federal**: las reuniones del FOMC de 2026 y 2027. La decisión se fecha el segundo día de
  la reunión, a las 14:00 hora del este, que son las 12:00 hora del centro. Las reuniones con
  proyecciones económicas van marcadas. Cada fecha es tentativa hasta que la confirma la reunión
  anterior.
- **INEGI**: IGAE, PIB trimestral, estimación oportuna del PIB, inflación quincenal y mensual y
  ENOE, de 2026 y del primer semestre de 2027, a las 06:00 hora del centro.
- **BLS**: el calendario de publicaciones de EE. UU. que el BLS ofrece como archivo ICS (inflación,
  empleo, precios al productor, vacantes, costo del empleo y salarios reales). Se lee en vivo una vez
  al día. Sus horas vienen en hora del este y se convierten respetando el horario de verano: el CPI
  de las 08:30 del 14 de octubre de 2026 se muestra a las 06:30, y el del 10 de noviembre, a las
  07:30. El ICS no dice qué mes reporta cada publicación, así que se deduce de su rezago habitual.

**Dato anterior y publicado.** La tasa objetivo y la inflación de México salen del SIE de Banxico
(SF61745 y SP30578, ya en por ciento y sin recalcular). La inflación de EE. UU. se calcula como
variación anual del índice CPIAUCSL (110 contra 100 un año antes es 10 por ciento), la nómina no
agrícola como cambio mensual de PAYEMS en miles de personas y la tasa de la Fed con la tasa efectiva
DFF. Los indicadores de INEGI salen s/d: su API necesita un token gratuito que todavía no está
configurado. El consenso siempre es s/d porque sus fuentes son de pago.

**Ventana.** La pantalla pide una semana (de lunes a domingo) o un mes. El API acepta hasta 90 días;
si solo llega la fecha inicial o la final, abarca dos semanas desde esa fecha.

**Agregar a mi calendario.** El botón arma un archivo .ics en el navegador con los eventos que se
ven. Los que tienen hora van con su instante en UTC (la decisión de Banxico del 5 de noviembre de
2026 a las 13:00 es `20261105T190000Z`) y tu calendario los pone en tu hora local.

## Tablero de economía

Cada tarjeta muestra el último dato, su cambio contra hace un año, cinco años de historia y la fecha
de la próxima publicación tomada del calendario.

- Las **tasas** (inflación, desempleo, crecimiento) cambian en puntos base: un desempleo que pasa de
  4.1 a 4.5 por ciento sube 40 pb. Los **niveles** (remesas, reservas, nómina, PIB real, petróleo)
  cambian en porcentaje.
- México: inflación general y subyacente (SP30578 y SP74662 de Banxico), desempleo y PIB real por los
  espejos de la OCDE en FRED, crecimiento del PIB trimestral anualizado calculado con ese PIB real
  (101 contra 100 es 1.01 a la cuarta menos 1, o sea 4.06 por ciento), remesas (SE27803) y reserva
  internacional (SF43707).
- EE. UU.: inflación CPI general y subyacente y PCE subyacente (variación anual calculada), desempleo
  (UNRATE), nómina no agrícola (PAYEMS), PIB real (GDPC1), crecimiento del PIB ya anualizado por la
  BEA (A191RL1Q225SBEA, 2.2 se publica 2.2 por ciento sin volver a anualizar) y petróleo WTI.
- Un espejo de la OCDE con último dato de más de 18 meses se rechaza: sale marcado como viejo y sin
  cifra. IGAE, empleo IMSS e inflación quincenal salen s/d hasta que haya token de INEGI.
- Con Banxico la historia llega a 10 años.

## Comparar países

Datos anuales del Banco Mundial (PIB en dólares, crecimiento real, inflación y deuda del gobierno
central), bajo licencia CC BY 4.0. Cada indicador usa el último año en que algún país del grupo tiene
dato; si un país no lo tiene ese año, sale s/d (la inflación de EE. UU. de 2025 venía vacía).

## Términos relacionados en el glosario

consenso, dato-anterior, nomina-no-agricola, pce-subyacente, inflacion-subyacente, remesas,
espejo-ocde, tasa-objetivo.

Nada de lo que muestran estas pantallas es una recomendación de inversión: son datos públicos con su
fuente y su fecha para que tú decidas.
