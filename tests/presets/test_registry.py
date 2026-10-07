"""Tests for the database-driven presets registry."""

import pytest

from smart_data_extractor.presets import get_preset, get_preset_fields, list_presets


def test_list_presets_returns_three_builtins(test_db):
    presets = list_presets()
    assert {p["id"] for p in presets} == {"contact", "invoice", "lead"}
    assert all(p["is_builtin"] for p in presets)
    by_id = {p["id"]: p for p in presets}
    assert by_id["contact"]["display_name_zh"] == "联系人"
    assert by_id["contact"]["display_name_en"] == "Contact"


def test_get_preset_returns_prompt_and_schema_dict(test_db):
    preset = get_preset("contact")
    assert preset.name == "contact"
    assert "confidence" in preset.prompt_template.lower()
    fields = preset.schema_dict["fields"]
    assert set(fields) == {"name", "email", "phone", "company", "job_title", "website"}
    assert fields["email"]["format"] == "email"


def test_get_preset_prompt_instructs_null_and_confidence(test_db):
    for name in ("contact", "invoice", "lead"):
        prompt = get_preset(name).prompt_template.lower()
        assert "null" in prompt
        assert "confidence" in prompt
        assert "0.0" in prompt
        assert "1.0" in prompt


def test_get_preset_unknown_raises(test_db):
    with pytest.raises(ValueError, match="unknown-preset"):
        get_preset("unknown-preset")


def test_get_preset_fields_returns_display_names_and_format(test_db):
    fields = get_preset_fields("contact")
    assert [f["field_name"] for f in fields] == [
        "name", "email", "phone", "company", "job_title", "website",
    ]
    email = next(f for f in fields if f["field_name"] == "email")
    assert email["type"] == "string"
    assert email["format"] == "email"
    assert email["display_name_zh"] == "邮箱"
    assert email["display_name_en"] == "Email"
    assert isinstance(email["description"], str) and email["description"]


def test_get_preset_fields_invoice_has_date_no_line_items(test_db):
    fields = {f["field_name"]: f for f in get_preset_fields("invoice")}
    assert "line_items" not in fields
    assert fields["date"]["type"] == "date"
    assert fields["date"]["format"] == "date"
    assert fields["total"]["type"] == "number"


def test_get_preset_fields_unknown_raises(test_db):
    with pytest.raises(ValueError, match="unknown-preset"):
        get_preset_fields("unknown-preset")
