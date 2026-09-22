"""DCF de flujo libre a la empresa (FCFF) en dos etapas. Matemáticas puras, sin red ni proveedores.

Todo aquí son funciones de entrada y salida, probadas con respuestas conocidas en
``tests/unit/b3b/test_dcf.py``. Quien arma la respuesta de ``/v2/valuation`` es
``valuation/service.py``; este módulo no sabe de HTTP ni de Yahoo.

Convenciones del API v2: toda tasa, crecimiento o rendimiento es una FRACCIÓN decimal
(0.0934 = 9.34 %). Los montos van en la moneda que indique quien llame.

Definiciones:

* ``FCFF = EBIT(1 − t) + D&A − capex − ΔCTN`` (capital de trabajo neto sin efectivo ni deuda de
  corto plazo).
* Etapa 1: ``FCFF_n = FCFF_0 (1+g)^n`` descontado a la WACC.
* Valor terminal con Gordon: ``VT = FCFF_{N+1} / (WACC − g_t)``, descontado ``N`` años.
* Hamada: ``β_L = β_U [1 + (1 − t) D/E]``.
* CAPM con riesgo país: ``Re = rf + β_L · ERP + λ · CRP``.
* ``WACC = Re · E/V + Rd (1 − t) · D/V``.
* Cambio de moneda de la WACC por diferencial de inflación esperada:
  ``(1 + WACC_base)(1 + π_local)/(1 + π_base) − 1``.

Dos guardas que el spec exige y que aquí devuelven aviso en vez de un número absurdo:

* el crecimiento terminal no puede pasar de la tasa libre de riesgo de ESA moneda;
* ``WACC − g_t`` tiene que ser de al menos 2 puntos porcentuales.

Cuando una guarda se activa, el valor se recorta (clamp) y queda un aviso en español en
``warnings``: la valuación sigue saliendo, pero el usuario ve por qué se movió el supuesto.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

MIN_SPREAD = 0.02
"""Mínimo de ``WACC − g`` (2 puntos porcentuales). Debajo de eso Gordon explota."""

MAX_YEARS = 15
"""Años de proyección explícita que acepta la ruta (el contrato permite hasta 30)."""


def _finite(value: float | None) -> float | None:
    if value is None:
        return None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return None if (math.isnan(v) or math.isinf(v)) else v


def levered_beta(beta_u: float, debt_to_equity: float, tax_rate: float) -> float:
    """Hamada: ``β_L = β_U [1 + (1 − t) D/E]``. D/E es razón simple (0.5 = 50 %)."""
    return beta_u * (1.0 + (1.0 - tax_rate) * debt_to_equity)


def unlevered_beta(beta_l: float, debt_to_equity: float, tax_rate: float) -> float:
    """Hamada al revés: ``β_U = β_L / [1 + (1 − t) D/E]``."""
    return beta_l / (1.0 + (1.0 - tax_rate) * debt_to_equity)


def cost_of_equity(rf: float, beta_l: float, erp: float, crp: float = 0.0, lambda_: float = 1.0) -> float:
    """CAPM con riesgo país: ``Re = rf + β_L · ERP + λ · CRP``."""
    return rf + beta_l * erp + lambda_ * crp


def wacc(re: float, rd: float, tax_rate: float, equity_weight: float) -> float:
    """``WACC = Re · E/V + Rd (1 − t) · D/V``. ``equity_weight`` es E/V entre 0 y 1."""
    e = min(max(equity_weight, 0.0), 1.0)
    return re * e + rd * (1.0 - tax_rate) * (1.0 - e)


def wacc_in_currency(wacc_base: float, inflation_local: float, inflation_base: float) -> float:
    """Pasa una WACC de una moneda a otra por diferencial de inflación esperada.

    ``(1 + WACC_base)(1 + π_local)/(1 + π_base) − 1``. Es la receta de Damodaran para convertir un
    costo de capital en dólares a moneda local sin volver a estimar nada.
    """
    return (1.0 + wacc_base) * (1.0 + inflation_local) / (1.0 + inflation_base) - 1.0


def justified_pb(roe: float, growth: float, cost_equity: float) -> float | None:
    """P/VL justificado de un banco: ``(ROE − g)/(Re − g)``. ``None`` si ``Re ≤ g``."""
    spread = cost_equity - growth
    if spread <= 0:
        return None
    return (roe - growth) / spread


@dataclass(frozen=True)
class ProjectionYear:
    year: int
    fcff: float
    discount_factor: float
    pv: float


@dataclass(frozen=True)
class DcfResult:
    """Resultado de ``two_stage_fcff``. Los montos van en la moneda del ``fcff0`` que se pasó."""

    fcff0: float
    growth: float
    years: int
    terminal_growth: float
    wacc: float
    projection: list[ProjectionYear]
    pv_stage1: float
    terminal_value: float
    pv_terminal: float
    enterprise_value: float
    warnings: list[str] = field(default_factory=list)

    @property
    def tv_share(self) -> float | None:
        if not self.enterprise_value:
            return None
        return self.pv_terminal / self.enterprise_value


def clamp_terminal_growth(
    terminal_growth: float,
    wacc_value: float,
    rf: float | None,
    warnings: list[str],
) -> float:
    """Aplica las dos guardas del spec y deja el aviso en español en ``warnings``."""
    g = terminal_growth
    if rf is not None and g > rf:
        warnings.append(
            f"El crecimiento terminal pedido ({g:.2%}) pasa de la tasa libre de riesgo de la moneda "
            f"({rf:.2%}); se recortó a esa tasa."
        )
        g = rf
    if wacc_value - g < MIN_SPREAD:
        nuevo = wacc_value - MIN_SPREAD
        warnings.append(
            f"El crecimiento terminal ({g:.2%}) deja menos de 2 puntos contra la WACC "
            f"({wacc_value:.2%}); se recortó a {nuevo:.2%}."
        )
        g = nuevo
    return g


def two_stage_fcff(
    fcff0: float,
    growth: float,
    years: int,
    terminal_growth: float,
    wacc_value: float,
    rf: float | None = None,
) -> DcfResult:
    """DCF de dos etapas sobre el FCFF. Devuelve proyección, valor terminal y valor empresa.

    ``rf`` solo se usa para la guarda "crecimiento terminal ≤ tasa libre de riesgo"; si es ``None``
    esa guarda no aplica (por ejemplo en las pruebas de respuesta conocida).
    """
    if years < 1:
        raise ValueError("years tiene que ser 1 o más")
    if wacc_value <= 0:
        raise ValueError("la WACC tiene que ser positiva")

    warnings: list[str] = []
    g_t = clamp_terminal_growth(terminal_growth, wacc_value, rf, warnings)

    projection: list[ProjectionYear] = []
    fcff = fcff0
    for n in range(1, years + 1):
        fcff = fcff * (1.0 + growth)
        factor = 1.0 / (1.0 + wacc_value) ** n
        projection.append(ProjectionYear(year=n, fcff=fcff, discount_factor=factor, pv=fcff * factor))

    pv_stage1 = sum(p.pv for p in projection)
    fcff_next = projection[-1].fcff * (1.0 + g_t)
    terminal_value = fcff_next / (wacc_value - g_t)
    pv_terminal = terminal_value / (1.0 + wacc_value) ** years

    return DcfResult(
        fcff0=fcff0,
        growth=growth,
        years=years,
        terminal_growth=g_t,
        wacc=wacc_value,
        projection=projection,
        pv_stage1=pv_stage1,
        terminal_value=terminal_value,
        pv_terminal=pv_terminal,
        enterprise_value=pv_stage1 + pv_terminal,
        warnings=warnings,
    )


def equity_bridge(
    enterprise_value: float,
    net_debt: float | None,
    minority_interest: float | None,
    shares: float | None,
) -> tuple[float | None, float | None]:
    """Del valor empresa al valor por acción: ``(EV − deuda neta − minoritarios) / acciones``."""
    ev = _finite(enterprise_value)
    if ev is None:
        return None, None
    equity = ev - (_finite(net_debt) or 0.0) - (_finite(minority_interest) or 0.0)
    n = _finite(shares)
    per_share = equity / n if n and n > 0 else None
    return equity, per_share


def sensitivity(
    *,
    fcff0: float,
    growth: float,
    years: int,
    base_wacc: float,
    base_terminal_growth: float,
    net_debt: float | None,
    minority_interest: float | None,
    shares: float | None,
    wacc_steps: tuple[float, ...] = (-0.015, -0.0075, 0.0, 0.0075, 0.015),
    growth_steps: tuple[float, ...] = (-0.01, -0.005, 0.0, 0.005, 0.01),
) -> dict:
    """Tabla WACC x crecimiento terminal con el valor por acción en cada cruce.

    ``grid[i][j]`` corresponde a ``waccs[i]`` y ``growths[j]``. Un cruce donde la guarda de los
    2 puntos no se cumple queda en ``None``: no se recorta el supuesto a escondidas, se deja vacío
    para que la UI muestre "s/d".
    """
    waccs = [round(base_wacc + s, 6) for s in wacc_steps]
    growths = [round(base_terminal_growth + s, 6) for s in growth_steps]
    grid: list[list[float | None]] = []
    for w in waccs:
        row: list[float | None] = []
        for g in growths:
            if w <= 0 or w - g < MIN_SPREAD:
                row.append(None)
                continue
            result = two_stage_fcff(fcff0, growth, years, g, w)
            _, per_share = equity_bridge(result.enterprise_value, net_debt, minority_interest, shares)
            row.append(None if per_share is None else round(per_share, 4))
        grid.append(row)
    return {"waccs": waccs, "growths": growths, "grid": grid}
