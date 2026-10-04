"""Predefined extraction scenarios: model + prompt bindings."""

from typing import Any, List, Union, get_args, get_origin

from pydantic import BaseModel

from smart_data_extractor.presets.base import Preset
from smart_data_extractor.presets.contact import CONTACT_PRESET
from smart_data_extractor.presets.invoice import INVOICE_PRESET
from smart_data_extractor.presets.lead import LEAD_PRESET

PRESETS: dict[str, Preset] = {
    preset.name: preset
    for preset in (CONTACT_PRESET, INVOICE_PRESET, LEAD_PRESET)
}

# Field names that are semantically dates even though their Python type is
# str (date values are stored as ISO strings, see validate_date).
_DATE_FIELD_NAMES = {"date"}


def get_preset(name: str) -> Preset:
    """Look up a preset by name.

    Raises:
        ValueError: If the name is not a registered preset.
    """
    try:
        return PRESETS[name]
    except KeyError:
        available = ", ".join(sorted(PRESETS))
        raise ValueError(
            f"Unknown preset {name!r}. Available presets: {available}"
        ) from None


def _infer_field_type(field_name: str, annotation: Any) -> str:
    """Map a Pydantic field annotation to a frontend schema type."""
    origin = get_origin(annotation)
    if origin is Union:
        args = [a for a in get_args(annotation) if a is not type(None)]
        if len(args) == 1:
            annotation = args[0]
            origin = get_origin(annotation)
    if origin in (list, List):
        return "array"
    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        return "object"
    if annotation is bool:
        return "boolean"
    if annotation is int:
        return "integer"
    if annotation is float:
        return "number"
    if annotation is str:
        return "date" if field_name in _DATE_FIELD_NAMES else "string"
    return "string"


def get_preset_fields(name: str) -> list[dict[str, Any]]:
    """Reflect a preset's Pydantic model into field metadata for display.

    Skips the paired ``_confidence`` fields, which are an internal scoring
    convention and not meant for schema editing.

    Raises:
        ValueError: If the name is not a registered preset.
    """
    preset = get_preset(name)
    fields = []
    for field_name, field_info in preset.model_class.model_fields.items():
        if field_name.endswith("_confidence"):
            continue
        fields.append(
            {
                "name": field_name,
                "type": _infer_field_type(field_name, field_info.annotation),
                "description": field_info.description,
            }
        )
    return fields


__all__ = ["PRESETS", "Preset", "get_preset", "get_preset_fields"]
