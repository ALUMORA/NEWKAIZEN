"""Sesión HTTP compartida y el helper ``yft()`` de yfinance. CONGELADO.

Todo acceso a Yahoo pasa por ``yft()`` o por ``yfinance.download`` y todo HTTP de terceros por
``requests`` (``_session`` o ``requests.get``). El replay de pruebas parcha exactamente
``yfinance.Ticker``, ``yfinance.download`` y ``requests.Session.request``, así que aquí se usa
``yf.Ticker`` en tiempo de llamada y nunca ``from yfinance import Ticker``. httpx o urllib no
se graban: no los uses para proveedores.

Movido sin cambios desde backend.py (fase S1): los cuerpos son idénticos al legado y los
goldens de tests/goldens_legacy lo prueban. La versión v2 se escribe al lado, no encima.
"""

import os

import requests
import yfinance as yf

# Sesión con headers de navegador para CBOE, Stooq y RSS.
# Sin "br": el paquete brotli no está instalado y requests no podría decodificar la respuesta.
_session = requests.Session()
_session.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate",
})

# yfinance 1.x trae su propia sesión curl_cffi que imita la huella TLS de Chrome, que es
# lo que Yahoo deja pasar desde cloud. Pasarle una requests.Session la reemplaza en el
# singleton de yfinance para todos los hilos. YF_SESSION=requests restaura el modo anterior.
_YF_USE_REQUESTS = os.environ.get("YF_SESSION", "").lower() == "requests"

def yft(ticker: str):
    """Crea un Ticker de yfinance (sesión curl_cffi por defecto, requests si YF_SESSION=requests)."""
    if _YF_USE_REQUESTS:
        return yf.Ticker(ticker, session=_session)
    return yf.Ticker(ticker)
