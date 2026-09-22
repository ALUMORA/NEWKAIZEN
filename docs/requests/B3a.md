# Solicitudes de B3a

Cosas que B3a necesita de archivos que no le pertenecen. Mientras no existan, el código las
rodea dentro de sus propios archivos y lo dice en `meta.notes`, nunca con un dato inventado.

## 1. `fx.convert` no reporta la fecha del tipo de cambio (dueño: B2a, `kaizen_api/domain/fx.py`)

**Qué pasa.** El contrato pide `fxUsed: {pair, rate, asOf}` en `/v2/instrument/{symbol}`, pero la
costura congelada `convert(amount_or_series, from_ccy, to_ccy, on=None)` solo devuelve el monto
convertido. Para sacar el tipo de cambio, B3a convierte una unidad (`convert(1.0, fin, px)`), y la
fecha no hay de dónde sacarla: hoy `fxUsed.asOf` sale en `null`.

**Qué se pide.** Una función hermana en el mismo módulo, sin tocar la firma congelada:

```python
def rate(from_ccy: str, to_ccy: str, on: date | str | None = None) -> tuple[float, str, bool]:
    """Tipo de cambio, fecha ISO del dato y si es sustituto (Yahoo en vez del FIX)."""
```

Con eso, `domain/currency.py::Converter.used()` llena `asOf` y `meta.fallback` puede quedar en
`true` cuando el tipo de cambio salió de Yahoo y no del FIX de Banxico, que es información que hoy
se pierde. Si no llega, todo sigue funcionando: `asOf` en `null` y una nota.

**Mientras tanto.** `Converter` pide el tipo con `convert(1.0, ...)`, y si eso levanta
`NotImplementedError` deja en `null` toda razón que mezcle precio con estados (P/S, EV/EBITDA,
P/FCF, rendimiento de flujo libre y valor de empresa) y lo explica en `meta.notes`. Es lo que se ve
hoy en `/v2/instrument/AAPL.MX`.

## 2. `history.get_series` y el referente local de la beta (dueño: B2a, `kaizen_api/domain/history.py`)

**Qué pasa.** La beta se calcula contra un referente local en la MISMA moneda: `NAFTRAC.MX` para
pesos y `SPY` para dólares, dos años de cierres semanales emparejados por fecha. Eso se pide con
`get_series(symbol, "2y", "1wk", "native")`, que hoy levanta `NotImplementedError`, así que
`beta` sale `null` (o, solo para papeles en dólares, la de Yahoo marcada como respaldo).

**Qué se pide.** Nada nuevo: la costura ya está documentada y basta con implementarla. Dos avisos:

- `PriceSeries.currency` tiene que traer la moneda real del papel. B3a compara esa moneda con la
  del referente y se niega a calcular la beta si no coinciden.
- `NAFTRAC.MX` no estaba en el set base de fixtures. B3a ya grabó en su capa `2026-09-22-b3a`
  `yf:NAFTRAC.MX:history?interval=1wk&period=2y` (y también `1y`, `5y` e `info`), con la misma
  forma de llave que usa `_fetch_hist`. Si la implementación de `get_series` llama a Yahoo con
  otros parámetros, hay que grabar esa llave; el dato de NAFTRAC ya está ahí para no volver a
  salir a la red.

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
