#!/usr/bin/env python3
"""Genera el hash scrypt de una contraseña para la variable USERS del API.

    python scripts/hash_password.py                     # pide la contraseña sin mostrarla
    python scripts/hash_password.py --user arturo       # y arma el ejemplo de USERS con ese usuario
    python scripts/hash_password.py --password 'x'      # sin preguntar (queda en el historial del shell)
    python scripts/hash_password.py --user ana --json   # solo el objeto USERS, para usarlo en una variable

Imprime ``scrypt$16384$8$1$<sal>$<hash>`` y un USERS listo para pegar en Render. La contraseña
nunca se imprime ni se guarda.

Con ``--json`` la salida estándar trae **solo** el objeto USERS y todo lo demás (el hash suelto y los
avisos) se va a la salida de error, así que esto funciona tal cual::

    USERS="$(python scripts/hash_password.py --user ana --password 'una-clave-larga' --json)"

Sin ``--json`` esa misma línea captura además el hash y el encabezado, y el API no arranca porque
USERS no es JSON válido. Así se estrelló la receta que traían las notas de S1.
"""

from __future__ import annotations

import argparse
import getpass
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from kaizen_api.security.auth import hash_password, verify_password  # noqa: E402

MIN_LENGTH = 10


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--password", help="contraseña (si falta, se pide con getpass)")
    parser.add_argument("--user", default="usuario", help="usuario para el ejemplo de USERS")
    parser.add_argument(
        "--json",
        action="store_true",
        dest="json_only",
        help="imprime SOLO el objeto USERS (el hash y los avisos van a la salida de error)",
    )
    args = parser.parse_args(argv)

    password = args.password
    if password is None:
        password = getpass.getpass("Contraseña: ")
        if getpass.getpass("Repite la contraseña: ") != password:
            print("Las contraseñas no coinciden.", file=sys.stderr)
            return 1
    if not password:
        print("La contraseña no puede ir vacía.", file=sys.stderr)
        return 1
    if len(password) < MIN_LENGTH:
        print(f"Aviso: la contraseña tiene menos de {MIN_LENGTH} caracteres.", file=sys.stderr)

    encoded = hash_password(password)
    assert verify_password(password, encoded)
    user = args.user.strip().lower()
    if not user:
        print("El usuario no puede ir vacío.", file=sys.stderr)
        return 1
    users_json = json.dumps({user: encoded})
    if args.json_only:
        # Solo el JSON en stdout: así USERS="$(... --json)" queda listo para el API.
        print(f"hash de {user}: {encoded}", file=sys.stderr)
        print(users_json)
        return 0
    print(encoded)
    print()
    print("USERS de ejemplo (agrega más usuarios en el mismo objeto):")
    print(users_json)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
