"""Preset dataclass: binds a Pydantic model to an extraction prompt."""

from dataclasses import dataclass
from typing import Type

from pydantic import BaseModel


@dataclass(frozen=True)
class Preset:
    """A predefined extraction scenario.

    Attributes:
        name: Registry key, e.g. "contact".
        model_class: The Pydantic model used as Agent output_type.
        prompt_template: System instructions telling the LLM what to extract
            and how to score confidence.
    """

    name: str
    model_class: Type[BaseModel]
    prompt_template: str
