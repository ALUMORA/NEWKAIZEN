# Solicitudes del stream B3b (valuación y momentum)

Nada de esto bloquea la entrega: todo está resuelto con un puente dentro de los archivos de B3b.
Lo que sigue es lo que conviene cambiar en el merge de la fase 2, y de quién es cada cosa.

## 1. Costura de fundamentales v2 (para B3a)

**Necesidad.** `kaizen_api/domain/valuation/inputs.py` le habla a Yahoo directo (`info`,
`income_stmt`, `balance_sheet`, `cashflow`) para armar EBIT, depreciación, capex, cambio en capital
de trabajo, deuda, efectivo, minoritarios, acciones, EPS, valor en libros y ROE.

**Por qué.** `docs/OWNERSHIP.md` dice que `domain/valuation/**` lee `domain/fundamentals.py` de
B3a, pero el archivo de hoy solo tiene el `get_stock` del legado, que entrega porcentajes y mezcla
monedas. No había firma v2 que consumir cuando arrancó la fase 2.

**API propuesta.** Algo con esta forma, en la moneda en que la empresa REPORTA y con el tipo de
cambio aparte:

```python
def get_fundamentals(symbol: str) -> Fundamentals:
    """Fundamentales v2: agregados en financialCurrency, datos por acción en priceCurrency."""
```

Con al menos: `price`, `price_currency`, `financial_currency`, `fx_rate`, `fx_as_of`, `shares`,
`eps`, `bvps`, `market_cap`, `ebit`, `ebitda`, `tax_rate`, `depreciation`, `capex`,
`change_in_wc`, `total_debt`, `cash`, `minority_interest`, `equity_book`, `net_income`, `roe`,
`sector`, `industry`, `country`, `quote_type`, `fiscal_period_end`.

**Mientras tanto.** `inputs.py` lo resuelve solo y no toca ningún archivo de B3a. Al mergear, lo
único que hay que cambiar es el cuerpo de `inputs.load()`; el resto de B3b no se entera.

## 2. Costura de tasa libre de riesgo (para B2b)

**Necesidad.** Una función con nombre estable en `kaizen_api/domain/rates.py`:

```python
def rf_latest(currency: str) -> dict | None:
    """{"rate": fracción, "asOf": "YYYY-MM-DD", "source": "banxico"|"fred"} o None."""
```

**Por qué.** `params.risk_free()` ya la busca con `getattr` y la usa en cuanto exista; hoy devuelve
`None` porque no está, y no rompe nada. Está probada en los dos caminos
(`tests/unit/b3b/test_params.py`).

**Ojo con el plazo.** Para descontar diez años la tasa correcta es el bono gubernamental largo de
esa moneda, no CETES 28. Por eso B3b usa FRED (`DGS10` en dólares, `IRLTLT01MXM156N` en pesos) como
fuente principal y deja la costura de B2b como RESPALDO, marcado con `fallback=true` y una nota que
dice que el plazo no es el adecuado. Si B2b publica además una tasa larga, el orden se invierte y
esto se vuelve una línea.

## 3. Costura de históricos (para B2a): resuelta

B2a ya publicó `history.get_series` y `domain/screeners/momentum.py` la usa directo
(`range="2y"`, `interval="1mo"`, `ccy="native"`); el puente a `yft(...).history` se borró en la
corrección de la revisión. Dos cosas que B3b hace de su lado y que no hay que pedirle a B2a:

- Yahoo fecha cada barra mensual el día 1 aunque su cierre es el del último día hábil. B3b guarda
  cada cierre bajo su mes y lo publica con la fecha de la última jornada de ese mes según
  `kaizen_api/data/holidays_{bmv,nyse}.json` (o el último día entre semana, con aviso, fuera de los
  años que cubre el calendario).
- Un mes sin cierre válido simplemente no está: el 12-1 se pide por mes de calendario y sale
  `null` si falta el mes t − 12 o el t − 1, en la emisora o en la referencia.

## 4. Contrato: dos cosas que se notaron y NO se pidieron

Las dos se resolvieron dentro del contrato actual, así que no hace falta cambiar `schemas.py`:

- `MultipleMethod` no tiene campo para decir por qué un método no aplica. El P/FCF sale con
  `benchmark: null` y `applicable: false`, y la razón (Damodaran no publica ese múltiplo por
  industria en el vintage de enero 2026) va en `meta.notes`. Si algún día se quiere por método,
  sería un `reason: str | None` en `MultipleMethod`.
- `ValuationResponse.currency` es la moneda de cotización, pero el DCF de una empresa que reporta
  en otra moneda (CEMEX, Apple en la BMV) sale en la moneda de sus flujos. Eso ya lo dice el
  contrato: `dcf.inputs.currency`. La revisión mostró que no basta; ver la sección 5.

## 5. Contrato: tres peticiones que salieron de la revisión adversaria (para quien custodia `schemas.py`)

`kaizen_api/schemas.py` está congelado, así que B3b resolvió lo que pudo dentro del contrato y
deja aquí el cambio exacto. Ninguno rompe a un cliente que ya exista: todos agregan campos
opcionales o vuelven opcional uno que hoy es obligatorio.

### 5.1 Moneda del DCF (revisión B3b, punto 4)

**Problema.** En `/v2/valuation/AAPL.MX` sale `currency: "MXN"`, `multiples.fairValueRange.mid`
4131.51 (pesos) y `dcf.perShare` 237.29 (dólares), uno junto al otro. La única pista es
`dcf.inputs.currency`, que una UI lee fácil de pasar por alto.

**Hoy (sin tocar el contrato).** `dcf.warnings` trae un aviso con el valor en la moneda de reporte,
el par, el tipo de cambio y el equivalente en la moneda de cotización, por ejemplo "El valor por
acción del DCF (139.76) está en USD ... Con USDMXN=X a 17.2275 equivale a 2,407.75 MXN por
acción."

**Petición.** En `DcfValuation`:

```python
currency: Currency = Field(description="Moneda de todos los montos del bloque: la de reporte")
perSharePriceCurrency: Money | None = Field(
    description="perShare convertido a ValuationResponse.currency con fxRate; null sin tipo de cambio"
)
fxRate: float | None = Field(description="Unidades de la moneda de cotización por unidad de la de reporte")
```

B3b los llena con `data.financial_currency`, `per_share * data.fx_rate` y `data.fx_rate` (ya los
tiene en `service._dcf_block`).

### 5.2 Referencia de momentum opcional (revisión B3b, punto 8)

**Problema.** `MomentumResponse.benchmark` es `str` obligatorio. Para una emisora en EUR no hay
referencia en esa moneda y antes se ponía SPY con una nota falsa ("la misma moneda del activo").

**Hoy.** `benchmark: ""`, `benchmarkR12m1: null`, `relative12m1: null` y una nota que dice que no
hay referencia en esa moneda. La cadena vacía es un centinela, no un faltante honesto.

**Petición.** `benchmark: str | None = Field(description="Símbolo de la referencia en la misma
moneda; null si no hay")`. B3b cambia `NO_BENCHMARK = ""` por `None` en
`domain/screeners/momentum.py` en la misma línea.

### 5.3 Supuestos opcionales cuando no hay ninguna tasa (revisión B3b, punto 3)

**Problema.** `ValuationAssumptions.rf` y `terminalGrowth` son obligatorios. Si la empresa reporta
en una moneda sin tasa (TWD), B3b ya responde 200 con los múltiplos y `dcf.applicable=false`, y en
`assumptions.rf` pone la tasa de la moneda de cotización o del dólar con una nota que dice que no
se usó para descontar. Pero si FRED no contesta para NINGUNA moneda, la ruta sigue en 503 aunque
los múltiplos no necesitan tasa.

**Petición.** `rf: Fraction | None` y `terminalGrowth: Fraction | None` en
`ValuationAssumptions`. Con eso B3b puede quitar el 503 y la tasa "de referencia" de otra moneda.
