# Solicitudes de B3a

Cosas que B3a necesita de archivos que no le pertenecen. Mientras no existan, el código las
rodea dentro de sus propios archivos y lo dice en `meta.notes`, nunca con un dato inventado.

## 1. La fecha del tipo de cambio (`fxUsed.asOf`): resuelto sin tocar `fx.py`

**Qué pasaba.** `Converter` pedía el tipo con `fx.convert(1.0, de, a)`, que solo devuelve el monto,
así que `fxUsed.asOf` salía en `null` y la ficha no decía que el tipo venía de Yahoo y no del FIX.

**Cómo quedó.** `fx.convert(monto, de, a)` sin fecha es, por dentro, `fx.spot().rate` aplicado con
`fx.apply_rate`. `domain/currency.py` ahora llama a esas mismas tres funciones públicas de `fx.py`
(`check_pair`, `spot`, `apply_rate`), así que el número es idéntico al de `convert` y además trae
`FxQuote.as_of`, `source`, `fallback` y `stale`. Con eso:

- `fxUsed.asOf` es la fecha de la barra de FX que se usó (en el replay del 22 de septiembre,
  `2026-09-22`).
- Si el tipo salió de Yahoo, `meta.fallback` va en `true` con una nota; si salió del FIX,
  `banxico` se agrega a `meta.source`.
- Si la barra de FX pasó la tolerancia de `fx.STALE_AFTER_DAYS`, `meta.stale` va en `true`.

La función hermana `rate(from, to, on)` que se pedía ya no hace falta. Si B2a cambia algún día
cómo `convert` elige el tipo sin fecha, esta costura tiene que cambiar igual; hoy son la misma.

## 2. `history.get_series` y el referente local de la beta (dueño: B2a): ya existe

La costura aterrizó en M2 y la beta se calcula contra `NAFTRAC.MX` (pesos) o `SPY` (dólares). Dos
cosas que quedan escritas:

- `PriceSeries.currency` tiene que traer la moneda real del papel: B3a se niega a calcular la beta
  si no coincide con la del referente.
- Los rendimientos se emparejan solo si coinciden la fecha inicial Y la final del intervalo. Si a
  una serie le falta un cierre, las semanas que tocan el hueco se descartan y la nota dice cuántas.

## 2b. `meta.stale` de `/v2/instrument`

El contrato no fija umbral, así que B3a usa el de las series de B2a: `history.is_stale(symbol,
quote.asOf, "1d")`, que marca atrasada la cotización más vieja que la última sesión cerrada de su
bolsa (BMV o NYSE) y cae a días naturales para lo que no tiene calendario. También cuenta como
`stale` un tipo de cambio que `fx.py` ya marca atrasado. Las demás rutas de B3a (estados,
dividendos, eventos, insiders) dejan `stale` en `false`: son datos que se publican cada trimestre o
cuando ocurre el hecho, y no hay un "atrasado" que se pueda afirmar sin inventar una regla.

## 3. `sectorMedians` de `/v2/instrument` sale en `null` (dueño del dato: B3c)

El contrato permite `null` y así queda. Calcular medianas por sector obliga a recorrer un universo
completo, que es justo lo que hace `domain/screeners/factors.py` (B3c). Cuando exista, B3a puede
consumirlo sin cambiar el contrato; conviene acordar la costura en la fase 3 en vez de que cada
stream arme su propia mediana.

## 4. Nada que cambiar en `schemas.py`

El contrato aguantó los cinco endpoints sin una sola solicitud de cambio. Dos detalles que vale la
pena dejar escritos por si alguien los lee como error:

- `Beta.observations` va en `0` cuando la beta es la de Yahoo, porque no la calculamos nosotros y
  no sabemos cuántas observaciones usó. `window` dice "5 años, mensual" y `source` dice `yahoo`.
- `StatementPeriod.form` va en `null` para Yahoo: esa fuente no dice de qué documento salió cada
  cierre. Con la SEC sí viene (`10-K` o `10-Q`).
