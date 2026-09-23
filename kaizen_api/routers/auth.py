"""Sesión v2: ``POST /auth/login`` (pública, con límite de tasa) y ``GET /auth/me``."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request

from kaizen_api.errors import ApiError
from kaizen_api.routers import ERROR_RESPONSES, no_store
from kaizen_api.schemas import ErrorBody, LoginRequest, LoginResponse, MeResponse
from kaizen_api.security.auth import (
    MSG_BAD_CREDENTIALS,
    Session,
    app_settings,
    authenticate,
    create_token,
    current_user,
    display_name,
)
from kaizen_api.security.ratelimit import LoginRateLimiter, client_ip, retry_after_header

logger = logging.getLogger("kaizen_api")

router = APIRouter(prefix="/auth", tags=["sesión"])
CAPABILITIES: list[str] = ["auth"]

_LOGIN_ERRORS = {
    401: {"model": ErrorBody, "description": "Usuario o contraseña incorrectos (UNAUTHORIZED)"},
    422: ERROR_RESPONSES[422],
    429: {"model": ErrorBody, "description": "Demasiados intentos (RATE_LIMITED), con Retry-After"},
}


def login_limiter(request: Request) -> LoginRateLimiter:
    limiter = getattr(request.app.state, "login_limiter", None)
    if limiter is None:
        limiter = request.app.state.login_limiter = LoginRateLimiter.from_settings(app_settings(request))
    return limiter


def login_ip(request: Request) -> str:
    """Llave por IP del login: sale de ``client_ip`` con ``TRUSTED_PROXY_HOPS``.

    Así ``X-Forwarded-For`` escrito por el cliente (una sola cabecera o varias) no sirve para
    cambiarse de cubeta.
    """
    host = request.client.host if request.client else None
    return client_ip(request.headers, host, trusted_hops=app_settings(request).trusted_proxy_hops)


def check_login_rate(request: Request, username: str) -> float | None:
    """Gasta un intento de login para la IP y para (usuario, IP); devuelve la espera si se pasó.

    Las dos fichas se devuelven en ``login()`` cuando las credenciales son buenas (cuentan fallas,
    no logins). El ``POST /login`` v1 llama solo a esta función y no devuelve nada: allá un login
    correcto sigue gastando su ficha, igual que antes.
    """
    return login_limiter(request).check(login_ip(request), username)


@router.post(
    "/login",
    response_model=LoginResponse,
    responses=_LOGIN_ERRORS,
    dependencies=[Depends(no_store)],
    summary="Inicia sesión y devuelve un JWT",
)
def login(body: LoginRequest, request: Request) -> dict:
    wait = check_login_rate(request, body.username)
    if wait is not None:
        raise ApiError(429, "RATE_LIMITED", headers={"Retry-After": retry_after_header(wait)})
    settings = app_settings(request)
    user = authenticate(body.username, body.password, settings)
    if user is None:
        logger.info("login rechazado")  # sin usuario ni IP: el log no es lugar para eso
        raise ApiError(401, "UNAUTHORIZED", MSG_BAD_CREDENTIALS, headers={"WWW-Authenticate": "Bearer"})
    # Credenciales buenas: se devuelve el intento para que las cubetas cuenten solo fallas.
    login_limiter(request).refund(login_ip(request), body.username)
    token, expires = create_token(user, settings)
    session = Session(username=user, expires_at=expires)
    return {"token": token, "expiresAt": session.expires_at_iso, "user": {"username": user, "displayName": display_name(user)}}


@router.get(
    "/me",
    response_model=MeResponse,
    responses={401: ERROR_RESPONSES[401]},
    dependencies=[Depends(no_store)],
    summary="Usuario de la sesión actual",
)
def me(session: Session = Depends(current_user)) -> dict:
    return {"user": session.user_dict(), "expiresAt": session.expires_at_iso}
