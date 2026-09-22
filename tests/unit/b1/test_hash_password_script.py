"""``scripts/hash_password.py``: la receta de USERS tiene que funcionar copiada y pegada.

La revisión de S1 reprodujo el defecto: ``USERS=$(python scripts/hash_password.py --user x ...)``
captura el hash suelto, una línea vacía y un encabezado además del JSON, así que el API no arranca
("USERS no es JSON válido"). Con ``--json`` la salida estándar trae solo el objeto.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

from kaizen_api.security.auth import authenticate, verify_password
from kaizen_api.settings import Settings

from .conftest import SECRET

SCRIPT = Path(__file__).resolve().parents[3] / "scripts" / "hash_password.py"


@pytest.fixture(scope="module")
def script():
    spec = importlib.util.spec_from_file_location("hash_password_script", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_json_prints_only_the_users_object(script, capsys):
    assert script.main(["--password", "una-clave-larga", "--user", "Ana", "--json"]) == 0
    salida = capsys.readouterr()
    users = json.loads(salida.out)  # toda la salida estándar es el JSON, sin líneas de más
    assert list(users) == ["ana"] and verify_password("una-clave-larga", users["ana"])
    # El hash también se enseña, pero por la salida de error, que no se captura en USERS=$(...).
    assert "hash de ana" in salida.err
    assert "una-clave-larga" not in salida.out and "una-clave-larga" not in salida.err


def test_the_documented_recipe_starts_the_api_in_production(script, capsys):
    """Justo el caso que fallaba: lo capturado se le pasa a USERS y el API arranca."""
    script.main(["--password", "otra-clave-larga", "--user", "beto", "--json"])
    users_env = capsys.readouterr().out.strip()
    settings = Settings.from_env({"KAIZEN_ENV": "production", "SECRET_KEY": SECRET, "USERS": users_env})
    assert authenticate("beto", "otra-clave-larga", settings) == "beto"


def test_without_json_the_old_output_stays(script, capsys):
    assert script.main(["--password", "una-clave-larga", "--user", "ana"]) == 0
    lineas = capsys.readouterr().out.splitlines()
    assert verify_password("una-clave-larga", lineas[0])
    assert json.loads(lineas[-1]) == {"ana": lineas[0]}
    # Y así es como se rompía la receta: capturar toda la salida no da JSON.
    with pytest.raises(ValueError):
        json.loads("\n".join(lineas))


def test_empty_password_and_user_are_refused(script, capsys):
    assert script.main(["--password", "", "--user", "ana"]) == 1
    assert "no puede ir vacía" in capsys.readouterr().err
    assert script.main(["--password", "una-clave-larga", "--user", "   "]) == 1
    assert "no puede ir vacío" in capsys.readouterr().err


def test_short_password_warns_but_works(script, capsys):
    assert script.main(["--password", "corta", "--user", "ana", "--json"]) == 0
    salida = capsys.readouterr()
    assert "menos de" in salida.err and json.loads(salida.out)
