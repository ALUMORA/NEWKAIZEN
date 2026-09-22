"""Tono de titulares para ``/v2/news`` (stream B2). Todavía vacío.

Contrato: ``{"label": "positivo" | "negativo" | "neutral", "score": -1..1, "method": "heuristic"}``.
El clasificador del legado (``domain.news.classify_sentiment``, en inglés y por subcadenas) queda
para las rutas v1; el nuevo debe tratar negaciones y palabras en español sin contar subcadenas.
"""
