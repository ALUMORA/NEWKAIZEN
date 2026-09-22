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

## 3. Costura de históricos (para B2a)

`domain/screeners/momentum.py` llama `history.get_series(symbol, range="2y", interval="1mo",
ccy="native")` y, mientras responda `NotImplementedError`, cae a `yft(symbol).history(period="2y",
interval="1mo")`. En cuanto B2a la implemente, el puente se puede borrar: el `try/except` ya está
escrito y probado con una costura falsa.

Lo único que B3b necesita de esa costura es que los cierres vengan **ajustados** y con una
observación por mes; el mes en curso lo descarta B3b, porque todavía no cierra.

## 4. Contrato: dos cosas que se notaron y NO se pidieron

Las dos se resolvieron dentro del contrato actual, así que no hace falta cambiar `schemas.py`:

- `MultipleMethod` no tiene campo para decir por qué un método no aplica. El P/FCF sale con
  `benchmark: null` y `applicable: false`, y la razón (Damodaran no publica ese múltiplo por
  industria en el vintage de enero 2026) va en `meta.notes`. Si algún día se quiere por método,
  sería un `reason: str | None` en `MultipleMethod`.
- `ValuationResponse.currency` es la moneda de cotización, pero el DCF de una empresa que reporta
  en otra moneda (CEMEX, Apple en la BMV) sale en la moneda de sus flujos. Eso ya lo dice el
  contrato: `dcf.inputs.currency`. Queda anotado aquí porque la UI tiene que leer esa moneda para
  el bloque del DCF y no la de arriba.
