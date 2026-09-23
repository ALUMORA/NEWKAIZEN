"""Monedas del v2: unidades menores de Yahoo y conversión de estados financieros a la del precio.

Dos problemas distintos y los dos son de moneda:

1. **Unidades menores.** Yahoo cotiza Londres en peniques (``GBp``) y Johannesburgo en centavos
   (``ZAc``). El contrato solo acepta ISO 4217 de tres letras en mayúsculas, así que aquí se
   normaliza el código y se divide el monto entre 100 antes de armar la respuesta.
2. **Moneda de los estados contra moneda del precio.** ``info["currency"]`` es la moneda en la que
   cotiza el papel y ``info["financialCurrency"]`` la de sus estados financieros. En AAPL.MX son
   MXN y USD, y Yahoo mismo publica razones mezcladas: su ``priceToSalesTrailing12Months`` de
   AAPL.MX vale 182.6 porque divide la capitalización en pesos entre los ingresos en dólares.
   Cualquier razón que mezcle precio (o capitalización) con estados tiene que convertir primero.

El tipo de cambio sale de ``domain.fx.spot`` (de B2a), que es exactamente lo que usa
``fx.convert(monto, de, a)`` cuando no se le da fecha, pero además dice de qué día es la barra, de
qué fuente salió y si es sustituta. Así ``fxUsed.asOf`` trae la fecha real y la ficha puede marcar
``fallback`` cuando el tipo vino de Yahoo y no del FIX de Banxico. Si no hay tipo de cambio,
``Converter.ok`` es ``False`` y quien la usa deja la razón en ``None`` con una nota, en vez de
mezclar monedas en silencio.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from kaizen_api.domain import safe
from kaizen_api.domain.fx import BANXICO_FIX_SOURCE, FxQuote
from kaizen_api.domain.fx import apply_rate as fx_apply_rate
from kaizen_api.domain.fx import check_pair as fx_check_pair
from kaizen_api.domain.fx import spot as fx_spot
from kaizen_api.errors import ApiError

# Código que publica Yahoo -> (ISO 4217, entre cuánto hay que dividir el monto).
# La llave es sensible a mayúsculas a propósito: "GBP" son libras y "GBp" son peniques.
MINOR_UNITS: dict[str, tuple[str, float]] = {
    "GBp": ("GBP", 100.0),
    "GBX": ("GBP", 100.0),
    "ZAc": ("ZAR", 100.0),
    "ZAX": ("ZAR", 100.0),
    "ILA": ("ILS", 100.0),
    "ILAgorot": ("ILS", 100.0),
}
"""Unidades menores conocidas. ``GBp`` son peniques: 100 por libra."""


def normalize_currency(code: str | None) -> tuple[str | None, float]:
    """``"GBp"`` a ``("GBP", 100.0)``; ``"mxn"`` a ``("MXN", 1.0)``; basura a ``(None, 1.0)``.

    El segundo valor es el divisor que hay que aplicarle a los montos que vengan en ese código.
    """
    if not isinstance(code, str):
        return None, 1.0
    raw = code.strip()
    if raw in MINOR_UNITS:
        return MINOR_UNITS[raw]
    up = raw.upper()
    for minor, (major, div) in MINOR_UNITS.items():
        if up == minor.upper() and up != major:
            return major, div
    if len(up) == 3 and up.isalpha():
        return up, 1.0
    return None, 1.0


def scale_minor(amount, divisor: float):
    """Divide un monto entre el divisor de su unidad menor. ``None`` y no numéricos pasan igual."""
    value = safe(amount)
    if value is None or not divisor or divisor == 1.0:
        return value
    return value / divisor


@dataclass
class Converter:
    """Convierte montos de la moneda de los estados a la moneda del precio.

    Uso::

        conv = Converter("USD", "MXN")
        ingresos_mxn = conv.to_price(466_822_987_776)   # None si todavía no hay tipo de cambio
        conv.used()                                     # {"pair": "USDMXN", "rate": ..., "asOf": "2026-09-22"}

    Cuando las dos monedas son iguales, ``to_price`` es la identidad y ``used()`` es ``None``: no
    hubo conversión que reportar. Cuando son distintas, el tipo de cambio se pide UNA vez a
    ``domain.fx.spot`` (costura de B2a) y se guarda junto con su fecha, su fuente y si es sustituto;
    la dirección del par la resuelve ``fx.apply_rate``, igual que dentro de ``fx.convert``. Si la
    costura no existe, el par no está soportado o la fuente no responde, ``ok`` queda en ``False``,
    ``failure`` explica por qué en español y todo ``to_price`` devuelve ``None``.
    """

    financial_currency: str | None
    price_currency: str | None
    _rate: float | None = field(default=None, init=False, repr=False)
    _resolved: bool = field(default=False, init=False, repr=False)
    _failure: str | None = field(default=None, init=False, repr=False)
    _quote: FxQuote | None = field(default=None, init=False, repr=False)

    @property
    def same(self) -> bool:
        """¿Los estados ya están en la moneda del precio (o no sabemos en cuál están)?"""
        return bool(
            self.financial_currency
            and self.price_currency
            and self.financial_currency.upper() == self.price_currency.upper()
        )

    @property
    def pair(self) -> str | None:
        if self.same or not self.financial_currency or not self.price_currency:
            return None
        return f"{self.financial_currency.upper()}{self.price_currency.upper()}"

    def _resolve(self) -> None:
        if self._resolved:
            return
        self._resolved = True
        if self.same:
            self._rate = 1.0
            return
        if not self.financial_currency or not self.price_currency:
            self._failure = "Yahoo no dice en qué moneda están los estados financieros."
            return
        try:
            origin, target = fx_check_pair(self.financial_currency, self.price_currency)
            quote = fx_spot()
            rate = safe(fx_apply_rate(1.0, quote.rate, origin, target))
        except NotImplementedError:
            self._failure = f"Todavía no hay tipo de cambio {self.pair} para convertir los estados financieros."
            return
        except ApiError as exc:
            self._failure = exc.message
            return
        except Exception:  # pragma: no cover - el proveedor puede fallar de formas raras
            self._failure = f"No se pudo obtener el tipo de cambio {self.pair}."
            return
        if rate is None or rate <= 0:
            self._failure = f"No se pudo obtener el tipo de cambio {self.pair}."
            return
        self._rate = rate
        self._quote = quote

    @property
    def ok(self) -> bool:
        """¿Se puede convertir? Con la misma moneda siempre; con monedas distintas, si hubo tipo."""
        self._resolve()
        return self._rate is not None

    @property
    def rate(self) -> float | None:
        self._resolve()
        return self._rate

    @property
    def failure(self) -> str | None:
        """Motivo en español de por qué no se pudo convertir, o ``None`` si sí se pudo."""
        self._resolve()
        return self._failure

    def to_price(self, amount):
        """Monto en la moneda del precio, o ``None`` si no hay tipo de cambio. Nunca mezcla."""
        value = safe(amount)
        if value is None:
            return None
        if not self.ok:
            return None
        rate = self._rate or 1.0
        return value if rate == 1.0 else value * rate

    @property
    def fallback(self) -> bool:
        """¿El tipo de cambio que se usó es de una fuente sustituta (Yahoo en vez del FIX)?"""
        self._resolve()
        return bool(self._quote and self._quote.fallback)

    @property
    def stale(self) -> bool:
        """¿La barra de FX que se usó es más vieja de lo tolerado por ``domain.fx``?"""
        self._resolve()
        return bool(self._quote and self._quote.stale)

    @property
    def source(self) -> str | None:
        """Token de ``meta.source`` del tipo de cambio: ``banxico`` o ``yahoo``. ``None`` si no hubo."""
        self._resolve()
        if self._quote is None:
            return None
        return "banxico" if self._quote.source == BANXICO_FIX_SOURCE else "yahoo"

    @property
    def notes(self) -> list[str]:
        """Avisos que ``domain.fx`` dejó sobre el tipo de cambio (por ejemplo, que no es el FIX)."""
        self._resolve()
        return list(self._quote.notes) if self._quote else []

    def used(self) -> dict | None:
        """``fxUsed`` del contrato, o ``None`` si no hizo falta convertir o no se pudo.

        ``asOf`` es la fecha de la barra de FX que se usó, tal como la reporta ``domain.fx.spot``.
        """
        if self.same or not self.ok:
            return None
        return {
            "pair": self.pair,
            "rate": round(self._rate, 6) if self._rate else None,
            "asOf": self._quote.as_of if self._quote else None,
        }
