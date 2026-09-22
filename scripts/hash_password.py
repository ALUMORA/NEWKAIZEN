#!/usr/bin/env python3
"""Genera el hash scrypt de una contraseña para la variable USERS del API.

    python scripts/hash_password.py                     # pide la contraseña sin mostrarla
    python scripts/hash_password.py --user arturo       # y arma el ejemplo de USERS con ese usuario
    python scripts/hash_password.py --password 'x'      # sin preguntar (queda en el historial del shell)

Imprime ``scrypt$16384$8$1$<sal>$<hash>`` y un USERS listo para pegar en Render. La contraseña
nunca se imprime ni se guarda.
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
    print(encoded)
    print()
    print("USERS de ejemplo (agrega más usuarios en el mismo objeto):")
    print(json.dumps({user: encoded}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
