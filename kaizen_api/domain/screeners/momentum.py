"""Momentum relativo contra el ETF del sector (legado, porcentajes).

Movido sin cambios desde backend.py (fase S1): los cuerpos son idénticos al legado y los
goldens de tests/goldens_legacy lo prueban. La versión v2 se escribe al lado, no encima.
"""

from kaizen_api.domain.universe import SECTOR_ETF
from kaizen_api.providers.yahoo.session import yft


def get_momentum(ticker: str) -> dict:
    """
    Momentum relativo vs sector (3m, 6m, 12m).
    Compara el retorno del activo contra el ETF de su sector.
    """
    try:
        t    = yft(ticker)
        info = t.info
        sector = info.get("sector")
        etf    = SECTOR_ETF.get(sector, "SPY")

        # 2y y no 1y: el retorno de 12m necesita 53 barras semanales y 1y a veces trae 52
        hist_stock = yft(ticker).history(period="2y", interval="1wk")
        hist_etf   = yft(etf).history(period="2y", interval="1wk")

        def ret(hist, weeks):
            # N semanas atrás es closes[-(N+1)]; closes[-N] solo cubría N-1
            if hist is None or hist.empty:
                return None
            closes = hist["Close"].dropna().tolist()
            if len(closes) < weeks + 1 or not closes[-(weeks + 1)]:
                return None
            return round((closes[-1] / closes[-(weeks + 1)] - 1) * 100, 2)

        stock_3m  = ret(hist_stock, 13)
        stock_6m  = ret(hist_stock, 26)
        stock_12m = ret(hist_stock, 52)
        etf_3m    = ret(hist_etf,   13)
        etf_6m    = ret(hist_etf,   26)
        etf_12m   = ret(hist_etf,   52)

        alpha_3m  = round(stock_3m  - etf_3m,  2) if (stock_3m  is not None and etf_3m  is not None) else None
        alpha_6m  = round(stock_6m  - etf_6m,  2) if (stock_6m  is not None and etf_6m  is not None) else None
        alpha_12m = round(stock_12m - etf_12m, 2) if (stock_12m is not None and etf_12m is not None) else None

        # Score de momentum: +1 por cada período donde supera al sector
        score = sum(1 for a in [alpha_3m, alpha_6m, alpha_12m] if a is not None and a > 0)

        return {
            "sector":    sector or "—",
            "benchmark": etf,
            "stock":     {"m3": stock_3m,  "m6": stock_6m,  "m12": stock_12m},
            "sector_r":  {"m3": etf_3m,    "m6": etf_6m,    "m12": etf_12m},
            "alpha":     {"m3": alpha_3m,  "m6": alpha_6m,  "m12": alpha_12m},
            "score":     score,   # 0-3
        }
    except Exception as e:
        return {"error": str(e)}
