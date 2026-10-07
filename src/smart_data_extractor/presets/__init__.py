"""Predefined extraction scenarios, loaded from the database."""

from typing import Any

from smart_data_extractor.db import get_session_factory
from smart_data_extractor.db.models import SchemaDefinition, SchemaFieldRow
from smart_data_extractor.presets.base import Preset


def list_presets() -> list[dict[str, Any]]:
    """All schemas in the master table, for the preset picker."""
    session = get_session_factory()()
    try:
        rows = session.query(SchemaDefinition).order_by(SchemaDefinition.id).all()
        return [
            {
                "id": r.id,
                "display_name_zh": r.display_name_zh,
                "display_name_en": r.display_name_en,
                "is_builtin": r.is_builtin,
            }
            for r in rows
        ]
    finally:
        session.close()


def _load_definition(name: str) -> dict[str, Any]:
    session = get_session_factory()()
    try:
        row = session.get(SchemaDefinition, name)
        if row is None:
            available = ", ".join(p["id"] for p in list_presets())
            raise ValueError(f"Unknown preset {name!r}. Available presets: {available}")
        # Eagerly load fields before the session closes.
        fields = (
            session.query(SchemaFieldRow)
            .filter_by(schema_id=name)
            .order_by(SchemaFieldRow.order)
            .all()
        )
        # Snapshot scalar attributes and fields as plain data so the row can
        # be safely returned after the session closes.
        snapshot = {
            "id": row.id,
            "display_name_zh": row.display_name_zh,
            "display_name_en": row.display_name_en,
            "is_builtin": row.is_builtin,
            "prompt_template": row.prompt_template,
            "fields": [
                {
                    "field_name": f.field_name,
                    "display_name_zh": f.display_name_zh,
                    "display_name_en": f.display_name_en,
                    "type": f.type,
                    "format": f.format,
                    "description": f.description,
                    "required": f.required,
                    "order": f.order,
                }
                for f in fields
            ],
        }
        return snapshot
    finally:
        session.close()


def get_preset(name: str) -> Preset:
    """Look up a preset by name and build its dynamic-model schema dict.

    Raises:
        ValueError: If the name is not a registered preset.
    """
    definition = _load_definition(name)
    schema_dict = {
        "fields": {
            f["field_name"]: {
                "type": f["type"],
                "format": f["format"],
                "description": f["description"],
                "required": f["required"],
            }
            for f in definition["fields"]
        }
    }
    return Preset(
        name=definition["id"],
        prompt_template=definition["prompt_template"] or "",
        schema_dict=schema_dict,
    )


def get_preset_fields(name: str) -> list[dict[str, Any]]:
    """Field metadata for display, ordered by the detail table's order column.

    Raises:
        ValueError: If the name is not a registered preset.
    """
    definition = _load_definition(name)
    return [
        {
            "field_name": f["field_name"],
            "display_name_zh": f["display_name_zh"],
            "display_name_en": f["display_name_en"],
            "type": f["type"],
            "format": f["format"],
            "description": f["description"],
        }
        for f in definition["fields"]
    ]


class _PresetsShim(dict):
    """Lazy dict-like shim kept for legacy importers (api/schemas.py, the
    package-level __init__). Builds the {name: Preset} mapping on first
    access so it works without a configured DATABASE_URL at import time."""

    def _ensure(self) -> None:
        if dict.__len__(self) == 0:
            try:
                for p in list_presets():
                    dict.__setitem__(self, p["id"], get_preset(p["id"]))
            except Exception:
                # Database not initialized yet; stay empty so attribute
                # lookups raise naturally rather than breaking imports.
                pass

    def __getitem__(self, key):
        self._ensure()
        return dict.__getitem__(self, key)

    def __contains__(self, key):
        self._ensure()
        return dict.__contains__(self, key)

    def __iter__(self):
        self._ensure()
        return dict.__iter__(self)

    def __len__(self):
        self._ensure()
        return dict.__len__(self)

    def keys(self):
        self._ensure()
        return dict.keys(self)

    def values(self):
        self._ensure()
        return dict.values(self)

    def items(self):
        self._ensure()
        return dict.items(self)


PRESETS: dict[str, Preset] = _PresetsShim()


__all__ = ["PRESETS", "Preset", "get_preset", "get_preset_fields", "list_presets"]
