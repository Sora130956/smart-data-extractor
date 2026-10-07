"""Preset dataclass: binds a database-backed schema to an extraction prompt."""

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Preset:
    """A predefined extraction scenario loaded from the database.

    Attributes:
        name: Schema id, e.g. "contact".
        prompt_template: System instructions telling the LLM what to extract
            and how to score confidence.
        schema_dict: Field specs ready for ``create_dynamic_model``.
    """

    name: str
    prompt_template: str
    schema_dict: dict[str, Any]
