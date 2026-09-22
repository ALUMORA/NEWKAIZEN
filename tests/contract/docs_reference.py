"""Genera la "Referencia de modelos" de docs/api-v2.md a partir de ``kaizen_api.schemas``.

La prueba ``test_docs_reference_is_current`` exige que el bloque generado del documento sea
idéntico a ``render_reference()``. Para regenerarlo tras un cambio aprobado del contrato::

    KAIZEN_WRITE_DOCS=1 .venv/bin/python -m pytest tests/contract -k docs_reference
"""

from __future__ import annotations

import json
import types
from typing import Annotated, Any, Literal, Union, get_args, get_origin

from pydantic import BaseModel
from pydantic.fields import FieldInfo

from kaizen_api import schemas

BEGIN = "<!-- BEGIN REFERENCIA GENERADA: no editar a mano, ver tests/contract/docs_reference.py -->"
END = "<!-- END REFERENCIA GENERADA -->"

_PATTERN_NAMES = {
    schemas.SYMBOL_PATTERN: "symbol",
    schemas.ISO_DATE_PATTERN: "date",
    schemas.INSTANT_PATTERN: "instant",
    schemas.DATE_OR_INSTANT_PATTERN: "date o instant",
    schemas.FX_PAIR_PATTERN: "pair",
    schemas.SOURCE_PATTERN: "source",
    r"^[A-Z]{3}$": "currency",
    r"^\d{3}$": "string de 3 dígitos",
}
_UNIT_NAMES = {
    "Fracción decimal: 0.0123 = 1.23 %": "fraction",
    "Monto en la moneda del campo currency más cercano": "money",
    "Razón simple (múltiplo), no porcentaje": "ratio",
}
_SCALARS = {str: "string", float: "number", int: "integer", bool: "boolean"}


def _constraints(items) -> tuple[str | None, list[str], str | None]:
    """(nombre por patrón, restricciones legibles, descripción) de metadatos de pydantic."""
    name, notes, description = None, [], None
    for item in items:
        if isinstance(item, FieldInfo):
            n, extra, d = _constraints(item.metadata)
            name = name or n
            notes += extra
            description = description or item.description or d
            continue
        pattern = getattr(item, "pattern", None)
        if pattern:
            name = _PATTERN_NAMES.get(pattern, f"string /{pattern}/")
        for attr, label in (("ge", "mín"), ("gt", "mayor que"), ("le", "máx"), ("lt", "menor que")):
            value = getattr(item, attr, None)
            if value is not None:
                notes.append(f"{label} {value}")
        for attr, label in (("min_length", "largo mín"), ("max_length", "largo máx")):
            value = getattr(item, attr, None)
            if value is not None:
                notes.append(f"{label} {value}")
    return name, notes, description


def render_type(tp, metadata=()) -> str:
    origin = get_origin(tp)
    if origin is Annotated:
        base, *extras = get_args(tp)
        return render_type(base, extras)
    if tp is type(None):
        return "null"
    if origin in (Union, types.UnionType):
        return " | ".join(render_type(a) for a in get_args(tp))
    if origin is Literal:
        return " | ".join(json.dumps(v, ensure_ascii=False) for v in get_args(tp))
    if origin is list:
        inner = render_type(get_args(tp)[0])
        return f"({inner})[]" if " | " in inner else f"{inner}[]"
    if origin is dict:
        key, value = get_args(tp)
        return f"{{{render_type(key)}: {render_type(value)}}}"
    if isinstance(tp, type) and issubclass(tp, BaseModel):
        return tp.__name__
    if tp is object or tp is Any:
        return "any"
    name, _, description = _constraints(metadata)
    if description in _UNIT_NAMES:
        return _UNIT_NAMES[description]
    return name or _SCALARS.get(tp, getattr(tp, "__name__", str(tp)))


def _models_in(tp, seen: list[type[BaseModel]]) -> None:
    if isinstance(tp, type) and issubclass(tp, BaseModel):
        if tp in seen:
            return
        seen.append(tp)
        for field in tp.model_fields.values():
            _models_in(field.annotation, seen)
        return
    for arg in get_args(tp):
        _models_in(arg, seen)


def ordered_models() -> list[type[BaseModel]]:
    seen: list[type[BaseModel]] = []
    for model in (schemas.Meta, schemas.ErrorBody, schemas.LoginRequest, *schemas.RESPONSE_MODELS):
        _models_in(model, seen)
    return seen


def _cell(text: str) -> str:
    return text.replace("|", "\\|").replace("\n", " ")


def render_model(model: type[BaseModel]) -> str:
    lines = [f"#### {model.__name__}", ""]
    doc = (model.__doc__ or "").strip()
    if doc and not doc.startswith("A base class") and model is not schemas.ContractModel:
        lines += [doc.splitlines()[0], ""]
    lines += ["| Campo | Tipo | Requerido | Notas |", "| --- | --- | --- | --- |"]
    for name, field in model.model_fields.items():
        key = field.alias or name
        type_name = render_type(field.annotation, field.metadata)
        _, notes, _ = _constraints(field.metadata)
        description = field.description or ""
        if description in _UNIT_NAMES:
            type_name, description = _UNIT_NAMES[description], ""
        if field.metadata and type_name in _SCALARS.values():
            pattern_name, _, _ = _constraints(field.metadata)
            type_name = pattern_name or type_name
        extra = "; ".join([description, *notes]) if description else "; ".join(notes)
        required = "sí" if field.is_required() else "no"
        lines.append(f"| `{key}` | {_cell(type_name)} | {required} | {_cell(extra)} |")
    return "\n".join(lines)


def render_reference() -> str:
    body = "\n\n".join(render_model(m) for m in ordered_models())
    return f"{BEGIN}\n\n{body}\n\n{END}"
