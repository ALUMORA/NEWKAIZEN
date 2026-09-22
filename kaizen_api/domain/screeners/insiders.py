"""Operaciones de consejeros y directivos, y tenedores institucionales (legado).

Movido sin cambios desde backend.py (fase S1): los cuerpos son idénticos al legado y los
goldens de tests/goldens_legacy lo prueban. La versión v2 se escribe al lado, no encima.
"""

from kaizen_api.domain import safe
from kaizen_api.providers.yahoo.session import yft


def get_insiders(ticker: str) -> dict:
    """Insider transactions + top institutional holders."""
    try:
        t = yft(ticker)
        result = {"transactions": [], "institutions": []}

        # Insider transactions
        try:
            ins = t.insider_transactions
            if ins is not None and not ins.empty:
                ins = ins.head(15)
                for _, row in ins.iterrows():
                    shares_val = row.get("Shares") or row.get("shares") or 0
                    val        = row.get("Value") or row.get("value") or 0
                    text       = row.get("Text") or row.get("text") or row.get("Transaction") or ""
                    name       = row.get("Insider") or row.get("insider") or row.get("Name") or "—"
                    date_raw   = row.get("Start Date") or row.get("startDate") or row.get("Date") or ""
                    try:
                        date_str = str(date_raw)[:10]
                    except Exception:
                        date_str = ""
                    # Yahoo da Shares siempre positivo, así que "shares > 0" marcaba toda venta como BUY.
                    # El sentido sale del texto; premios, grants y ejercicios son adquisiciones.
                    tl = str(text).lower()
                    action = ("SELL" if ("sale" in tl or "sell" in tl or "disposition" in tl)
                              else "GIFT" if "gift" in tl else "BUY")
                    result["transactions"].append({
                        "name":   str(name),
                        "action": action,
                        "shares": int(safe(shares_val) or 0),
                        "value":  int(safe(val) or 0),
                        "date":   date_str,
                        "text":   str(text)[:80],
                    })
        except Exception:
            pass

        # Institutional holders
        try:
            inst = t.institutional_holders
            if inst is not None and not inst.empty:
                for _, row in inst.head(8).iterrows():
                    holder = row.get("Holder") or row.get("holder") or "—"
                    shares_val = row.get("Shares") or row.get("shares") or 0
                    pct_held   = row.get("% Out") or row.get("pctHeld") or 0
                    result["institutions"].append({
                        "name":   str(holder),
                        "shares": int(safe(shares_val) or 0),
                        "pct":    round(float(pct_held) * 100, 2) if pct_held else 0,
                    })
        except Exception:
            pass

        return result
    except Exception as e:
        return {"error": str(e), "transactions": [], "institutions": []}
