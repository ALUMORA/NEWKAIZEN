"""Precios de Yahoo para el v2 (stream B2). Todavía vacío.

Aquí va la lectura de cotizaciones e históricos que usa ``domain.history.get_series``. Datos que hay
que respetar (yfinance 1.7): los índices de ``history()`` vienen en datetime64[s] con zona (Nueva
York para EE. UU., Ciudad de México para ``.MX`` y ``^MXX``, Londres para ``MXN=X``) y
``yf.download`` regresa columnas MultiIndex con índice sin zona y renglones de fin de semana si el
lote mezcla cripto: siempre ``dropna`` por columna.
"""
