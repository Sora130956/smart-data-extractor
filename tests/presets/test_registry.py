"""Tests for the presets registry and Preset dataclass."""

import pytest
from pydantic import BaseModel

from smart_data_extractor.models import Contact, Invoice, Lead
from smart_data_extractor.presets import PRESETS, get_preset, get_preset_fields


def test_presets_registry_keys():
    """Registry contains exactly the three predefined scenarios."""
    assert set(PRESETS) == {"contact", "invoice", "lead"}


def test_presets_registry_model_classes():
    """Every preset binds an instantiable BaseModel subclass."""
    for preset in PRESETS.values():
        assert issubclass(preset.model_class, BaseModel)
        preset.model_class()  # all fields optional -> instantiable with no args


def test_presets_registry_binding():
    """Each preset is bound to the correct model class."""
    assert PRESETS["contact"].model_class is Contact
    assert PRESETS["invoice"].model_class is Invoice
    assert PRESETS["lead"].model_class is Lead


def test_get_preset_returns_preset():
    """get_preset returns the Preset for a known name."""
    preset = get_preset("contact")
    assert preset is PRESETS["contact"]
    assert preset.model_class is Contact


def test_get_preset_unknown_raises():
    """get_preset raises ValueError listing available names for unknown preset."""
    with pytest.raises(ValueError, match="unknown-preset"):
        get_preset("unknown-preset")


def test_preset_prompt_instructs_null_and_confidence():
    """Prompt templates must instruct: missing fields -> null, confidence 0.0-1.0."""
    for preset in PRESETS.values():
        prompt = preset.prompt_template.lower()
        assert "null" in prompt
        assert "confidence" in prompt
        assert "0.0" in prompt
        assert "1.0" in prompt


def test_get_preset_fields_excludes_confidence_fields():
    """Reflected field metadata must not include the paired _confidence fields."""
    fields = get_preset_fields("contact")
    names = {f["name"] for f in fields}
    assert names == {"name", "email", "phone", "company", "job_title", "website"}


def test_get_preset_fields_includes_description_and_type():
    fields = get_preset_fields("contact")
    email = next(f for f in fields if f["name"] == "email")
    assert email["type"] == "string"
    assert isinstance(email["description"], str) and email["description"]


def test_get_preset_fields_unknown_raises():
    with pytest.raises(ValueError, match="unknown-preset"):
        get_preset_fields("unknown-preset")
