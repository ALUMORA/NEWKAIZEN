"""El signo % va pegado a la cifra en todo texto del API que llega a la pantalla.

La regla escrita es la de ``fmtPct`` del frontend (docs/overhaul/specs/frontend-spec.md): "+1.23%".
Las notas, razones y etiquetas que arma el backend se pintan tal cual junto a las cifras que
formatea el frontend, así que "6 %" al lado de "6%" en la misma pantalla se ve como descuido.
Los puntos porcentuales ("1.5 pp") y los puntos base ("25 pb") sí llevan espacio: no tienen %.

Se revisan las literales de cadena con ``ast`` (las f-strings se leen con ``}`` en lugar de cada
campo), así que los comentarios y las docstrings quedan fuera: no llegan a la pantalla.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2] / "kaizen_api"

# legacy_v1.py conserva el texto del v1 a propósito (goldens de paridad). schemas.py es congelado
# del orquestador y sus descripciones van al OpenAPI, no a la pantalla; además
# tests/contract/docs_reference.py fija ese texto.
EXCLUIDOS = {RAIZ / "routers" / "legacy_v1.py", RAIZ / "schemas.py"}

# Cifra (o el cierre de un campo de f-string) seguida de espacio y %, o una cadena que empieza
# con espacio y % (un sufijo que se pega a una cifra armada aparte).
ESPACIADO = re.compile(r"(?:^|[0-9}])[ \u00a0\u2009\u202f]+%")


def _docstrings(tree: ast.AST) -> set[int]:
    """Cadenas sueltas como sentencia: docstrings y las que documentan una constante debajo."""
    return {
        id(node.value)
        for node in ast.walk(tree)
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str)
    }


def _texto(node: ast.JoinedStr) -> str:
    partes = []
    for valor in node.values:
        if isinstance(valor, ast.Constant) and isinstance(valor.value, str):
            partes.append(valor.value)
        else:
            partes.append("{}")
    return "".join(partes)


def hallazgos(fuente: str, nombre: str = "<fuente>") -> list[str]:
    """Las literales de ``fuente`` con el % separado de su cifra, como ``nombre:línea: texto``."""
    tree = ast.parse(fuente)
    docs = _docstrings(tree)
    dentro_de_fstring: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.JoinedStr):
            for valor in node.values:
                dentro_de_fstring.add(id(valor))
                if isinstance(valor, ast.FormattedValue) and valor.format_spec is not None:
                    for parte in ast.walk(valor.format_spec):
                        dentro_de_fstring.add(id(parte))
    salida = []
    for node in ast.walk(tree):
        if isinstance(node, ast.JoinedStr):
            texto = _texto(node)
        elif isinstance(node, ast.Constant) and isinstance(node.value, str):
            if id(node) in docs or id(node) in dentro_de_fstring:
                continue
            texto = node.value
        else:
            continue
        if ESPACIADO.search(texto):
            salida.append(f"{nombre}:{node.lineno}: {texto.strip()[:90]}")
    return salida


def test_el_detector_distingue_los_casos():
    assert hallazgos('x = "Margen operativo de 10 % o más"')
    assert hallazgos('x = f"Cobertura de {c * 100:.0f} %: poca"')
    assert hallazgos("x = str(v) + ' %'")
    assert not hallazgos('x = "Margen operativo de 10% o más"')
    assert not hallazgos('x = f"Yahoo publica {p:.2%} por su cuenta"')
    assert not hallazgos('x = "sube 1.5 pp y 25 pb"')
    assert not hallazgos('def f():\n    """Una fracción: 0.0123 = 1.23 %."""\n    return 1\n')
    assert not hallazgos('TOPE = 0.2\n"""Más de 20 % de diferencia es otra entidad."""\n')
    assert not hallazgos('x = 10 % 3  # 10 % 3 es el módulo, no texto')
    assert not hallazgos('log = "error en %s %s rid=%s"')


def test_ningun_texto_del_api_separa_el_signo_de_porcentaje():
    encontrados: list[str] = []
    for ruta in sorted(RAIZ.rglob("*.py")):
        if ruta in EXCLUIDOS:
            continue
        nombre = ruta.relative_to(RAIZ.parent).as_posix()
        encontrados += hallazgos(ruta.read_text(encoding="utf-8"), nombre)
    assert not encontrados, "El % va pegado a la cifra (10%, no 10 %):\n" + "\n".join(encontrados)
