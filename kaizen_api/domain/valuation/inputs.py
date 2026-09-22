"""Insumos de valuación leídos de Yahoo, con las monedas ya cuadradas.

Regla de moneda, que es donde el backend viejo se equivocaba: el precio y todo lo "por acción" que
publica Yahoo (``trailingEps``, ``bookValue``, ``marketCap``) vienen en la MONEDA DE COTIZACIÓN;
los agregados de los estados financieros (EBIT, deuda, efectivo, capex) vienen en
``financialCurrency``. Cuando no son la misma (AAPL.MX cotiza en pesos y reporta en dólares) los
agregados se quedan EN LA MONEDA DE REPORTE (que es la moneda de los flujos de la empresa, y por
eso es la del DCF) y solo se pasan a la moneda de cotización con ``to_price()`` cuando hay que
mezclarlos con el precio, por ejemplo en EV/EBITDA. El par es ``<financiera><cotización>=X``. Sin
tipo de cambio no se inventa uno: los campos afectados quedan en ``None`` y la razón sale en
``notes``.

Esto es un puente temporal. La costura de fundamentales v2 la construye B3a en
``domain/fundamentals.py``; en cuanto exista, ``load()`` debería leerla en vez de hablarle a Yahoo
directo. La petición está en ``docs/requests/B3b.md`` y el detalle en las notas de entrega.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from kaizen_api.domain import _log, safe
from kaizen_api.providers.yahoo.session import yft

EBIT_ROWS = ("EBIT", "Operating Income", "Total Operating Income As Reported")
EBITDA_ROWS = ("EBITDA", "Normalized EBITDA")
TAX_ROWS = ("Tax Provision",)
PRETAX_ROWS = ("Pretax Income",)
INTEREST_ROWS = ("Interest Expense", "Interest Expense Non Operating")
DA_ROWS = ("Depreciation And Amortization", "Depreciation Amortization Depletion", "Reconciled Depreciation")
CAPEX_ROWS = (
    "Capital Expenditure",
    "Capital Expenditure Reported",
    "Net PPE Purchase And Sale",
    "Purchase Of PPE",
    "Net Investment Properties Purchase And Sale",
    "Purchase Of Investment Properties",
)
NWC_ROWS = ("Change In Working Capital",)
FCF_ROWS = ("Free Cash Flow",)
DEBT_ROWS = ("Total Debt",)
CASH_ROWS = ("Cash Cash Equivalents And Short Term Investments", "Cash And Cash Equivalents")
MINORITY_ROWS = ("Minority Interest",)
EQUITY_ROWS = ("Common Stock Equity", "Stockholders Equity")
NET_INCOME_ROWS = ("Net Income Common Stockholders", "Net Income", "Net Income Continuous Operations")
SHARES_ROWS = ("Ordinary Shares Number", "Share Issued")

MIN_TAX_RATE = 0.0
MAX_TAX_RATE = 0.5


class SymbolNotFound(LookupError):
    """Yahoo no conoce el símbolo (ni precio ni nombre)."""


def _row(frame, names: tuple[str, ...], column: int = 0) -> float | None:
    """Primer renglón de ``names`` que exista en el estado financiero, en la columna pedida."""
    if frame is None:
        return None
    try:
        if frame.empty or column >= len(frame.columns):
            return None
    except Exception:
        return None
    for name in names:
        try:
            if name not in frame.index:
                continue
            value = safe(float(frame.loc[name].iloc[column]))
        except Exception:
            continue
        if value is not None:
            return value
    return None


def _period_end(frame, column: int = 0) -> str | None:
    try:
        if frame is None or frame.empty or column >= len(frame.columns):
            return None
        return str(frame.columns[column])[:10]
    except Exception:
        return None


def _statement(ticker, attr: str):
    try:
        frame = getattr(ticker, attr)
    except Exception as exc:
        _log(f"valuation: {attr} falló: {exc}")
        return None
    try:
        return None if frame is None or frame.empty else frame
    except Exception:
        return None


def fx_rate(financial_currency: str, price_currency: str) -> tuple[float | None, str | None]:
    """1 unidad de ``financial_currency`` en ``price_currency``, con la fecha del dato."""
    if financial_currency == price_currency:
        return 1.0, None
    pair = f"{financial_currency}{price_currency}=X"
    try:
        hist = yft(pair).history(period="2d")
        if hist is None or hist.empty:
            return None, None
        rate = safe(float(hist["Close"].iloc[-1]))
        as_of = str(hist.index[-1])[:10]
        return (rate, as_of) if rate and rate > 0 else (None, None)
    except Exception as exc:
        _log(f"valuation: sin tipo de cambio {pair}: {exc}")
        return None, None


@dataclass
class ValuationInputs:
    """Todo lo que el DCF y los múltiplos necesitan de la emisora, ya en moneda de cotización."""

    symbol: str
    name: str | None = None
    quote_type: str | None = None
    sector: str | None = None
    industry: str | None = None
    country: str | None = None
    price: float | None = None
    price_currency: str = "USD"
    financial_currency: str = "USD"
    fx_rate: float | None = 1.0
    fx_as_of: str | None = None
    fx_pair: str | None = None

    shares: float | None = None
    eps: float | None = None
    bvps: float | None = None
    market_cap: float | None = None

    ebit: float | None = None
    ebitda: float | None = None
    tax_rate: float | None = None
    tax_rate_source: str = "estatutaria"
    depreciation: float | None = None
    capex: float | None = None
    change_in_wc: float | None = None
    interest_expense: float | None = None
    free_cash_flow: float | None = None

    total_debt: float | None = None
    cash: float | None = None
    minority_interest: float | None = None
    equity_book: float | None = None
    net_income: float | None = None
    roe: float | None = None
    roe_source: str = "yahoo"

    fiscal_period_end: str | None = None
    as_of: str | None = None
    notes: list[str] = field(default_factory=list)

    def to_price(self, value: float | None) -> float | None:
        """Un agregado de los estados (en ``financial_currency``) pasado a moneda de cotización."""
        if value is None or self.fx_rate is None:
            return None
        return value * self.fx_rate

    @property
    def net_debt(self) -> float | None:
        """Deuda neta EN MONEDA DE REPORTE, que es la del DCF."""
        if self.total_debt is None and self.cash is None:
            return None
        return (self.total_debt or 0.0) - (self.cash or 0.0)

    @property
    def market_cap_financial(self) -> float | None:
        """Capitalización pasada a la moneda de reporte, para mezclarla con el balance."""
        if not self.market_cap or not self.fx_rate:
            return None
        return self.market_cap / self.fx_rate

    @property
    def debt_to_equity_market(self) -> float | None:
        """D/E a valor de mercado: deuda total entre capitalización, las dos en la misma moneda."""
        cap = self.market_cap_financial
        if not cap or cap <= 0 or self.total_debt is None:
            return None
        return self.total_debt / cap

    @property
    def equity_weight(self) -> float | None:
        """E/V a valor de mercado."""
        cap = self.market_cap_financial
        if not cap or cap <= 0 or self.total_debt is None:
            return None
        total = cap + self.total_debt
        return cap / total if total > 0 else None

    def fcff0(self) -> float | None:
        """``EBIT(1 − t) + D&A − capex − ΔCTN`` con los signos tal como los reporta el flujo."""
        if self.ebit is None or self.tax_rate is None:
            return None
        if self.depreciation is None or self.capex is None:
            return None
        return self.ebit * (1.0 - self.tax_rate) + self.depreciation + self.capex + (self.change_in_wc or 0.0)


def _tax_rate(income, statutory: float) -> tuple[float, str]:
    tax = _row(income, TAX_ROWS)
    pretax = _row(income, PRETAX_ROWS)
    if tax is not None and pretax and pretax > 0:
        rate = tax / pretax
        if MIN_TAX_RATE <= rate <= MAX_TAX_RATE:
            return round(rate, 6), "efectiva del último ejercicio"
    return statutory, "estatutaria del país (Damodaran)"


def load(symbol: str, statutory_tax: float = 0.30) -> ValuationInputs:
    """Lee Yahoo y arma los insumos. Lanza ``SymbolNotFound`` si el símbolo no existe."""
    sym = symbol.upper()
    ticker = yft(sym)
    try:
        info = ticker.info or {}
    except Exception as exc:
        _log(f"valuation: info de {sym} falló: {exc}")
        info = {}
    if not isinstance(info, dict):
        info = {}

    price = safe(info.get("currentPrice") or info.get("regularMarketPrice") or info.get("navPrice"))
    name = info.get("shortName") or info.get("longName")
    if price is None and not name:
        raise SymbolNotFound(sym)

    price_currency = (info.get("currency") or "USD").upper()
    financial_currency = (info.get("financialCurrency") or price_currency).upper()

    notes: list[str] = []
    rate, fx_as_of = fx_rate(financial_currency, price_currency)
    pair = None if financial_currency == price_currency else f"{financial_currency}{price_currency}=X"
    if rate is None:
        notes.append(
            f"No hubo tipo de cambio {financial_currency} a {price_currency}: los datos que salen "
            "de los estados financieros se omiten en vez de mezclarse con el precio."
        )

    income = _statement(ticker, "income_stmt")
    balance = _statement(ticker, "balance_sheet")
    cash_flow = _statement(ticker, "cashflow")

    tax_rate, tax_source = _tax_rate(income, statutory_tax)

    change_wc = _row(cash_flow, NWC_ROWS)
    if change_wc is None and cash_flow is not None:
        notes.append("El flujo de efectivo no trae el cambio en capital de trabajo: se tomó como cero.")

    inputs = ValuationInputs(
        symbol=sym,
        name=name,
        quote_type=(info.get("quoteType") or "").upper() or None,
        sector=info.get("sector"),
        industry=info.get("industry"),
        country=info.get("country"),
        price=price,
        price_currency=price_currency,
        financial_currency=financial_currency,
        fx_rate=rate,
        fx_as_of=fx_as_of,
        fx_pair=pair,
        shares=safe(info.get("sharesOutstanding")) or _row(balance, SHARES_ROWS),
        eps=safe(info.get("trailingEps")),
        bvps=safe(info.get("bookValue")),
        market_cap=safe(info.get("marketCap")),
        ebit=_row(income, EBIT_ROWS),
        ebitda=_row(income, EBITDA_ROWS),
        tax_rate=tax_rate,
        tax_rate_source=tax_source,
        depreciation=_row(cash_flow, DA_ROWS) or _row(income, ("Reconciled Depreciation",)),
        capex=_row(cash_flow, CAPEX_ROWS),
        change_in_wc=change_wc,
        interest_expense=_row(income, INTEREST_ROWS),
        free_cash_flow=_row(cash_flow, FCF_ROWS),
        total_debt=_row(balance, DEBT_ROWS) or safe(info.get("totalDebt")),
        cash=_row(balance, CASH_ROWS) or safe(info.get("totalCash")),
        minority_interest=_row(balance, MINORITY_ROWS) or 0.0,
        equity_book=_row(balance, EQUITY_ROWS),
        net_income=_row(income, NET_INCOME_ROWS),
        roe=safe(info.get("returnOnEquity")),
        fiscal_period_end=_period_end(income) or _period_end(balance),
        notes=notes,
    )
    if inputs.roe is None and inputs.net_income is not None and inputs.equity_book:
        inputs.roe = inputs.net_income / inputs.equity_book
        inputs.roe_source = "calculado de los estados financieros"
        inputs.notes.append("Yahoo no publicó el ROE: se calculó como utilidad neta entre capital contable.")
    if inputs.market_cap is None and inputs.price and inputs.shares:
        inputs.market_cap = inputs.price * inputs.shares
    if rate is not None and pair and rate != 1.0:
        inputs.notes.append(
            f"La empresa reporta en {financial_currency} y cotiza en {price_currency}. El DCF se "
            f"hace en {financial_currency}, que es la moneda de sus flujos, y los múltiplos se "
            f"comparan en {price_currency} con {pair} a {rate:.4f}."
        )
    return inputs
