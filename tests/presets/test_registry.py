"""Tests for the database-driven presets registry."""

import pytest

from smart_data_extractor.db import get_session_factory
from smart_data_extractor.db.models import SchemaFieldRow
from smart_data_extractor.presets import get_preset, get_preset_fields, list_presets


def _null_description(schema_id: str, field_name: str, column: str) -> None:
    """Null one description column of a seeded field (fallback tests)."""
    session = get_session_factory()()
    try:
        row = (
            session.query(SchemaFieldRow)
            .filter_by(schema_id=schema_id, field_name=field_name)
            .one()
        )
        setattr(row, column, None)
        session.commit()
    finally:
        session.close()


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


# --- description language picking ---


def test_get_preset_default_lang_picks_english(test_db):
    fields = get_preset("contact").schema_dict["fields"]
    assert fields["email"]["description"] == "Email address of the contact"


def test_get_preset_zh_lang_picks_chinese(test_db):
    fields = get_preset("contact", lang="zh").schema_dict["fields"]
    assert fields["email"]["description"] == "联系人电子邮箱"


def test_get_preset_zh_cn_locale_prefix_picks_chinese(test_db):
    fields = get_preset("contact", lang="zh-CN").schema_dict["fields"]
    assert fields["email"]["description"] == "联系人电子邮箱"


def test_get_preset_zh_falls_back_to_english(test_db):
    _null_description("contact", "email", "description_zh")
    fields = get_preset("contact", lang="zh").schema_dict["fields"]
    assert fields["email"]["description"] == "Email address of the contact"


def test_get_preset_en_falls_back_to_chinese(test_db):
    _null_description("contact", "email", "description_en")
    fields = get_preset("contact").schema_dict["fields"]
    assert fields["email"]["description"] == "联系人电子邮箱"


def test_get_preset_fields_returns_bilingual_descriptions(test_db):
    fields = get_preset_fields("contact")
    email = next(f for f in fields if f["field_name"] == "email")
    assert email["description_zh"] == "联系人电子邮箱"
    assert email["description_en"] == "Email address of the contact"
    assert "description" not in email


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
    assert isinstance(email["description_zh"], str) and email["description_zh"]
    assert isinstance(email["description_en"], str) and email["description_en"]


def test_get_preset_fields_invoice_has_date_no_line_items(test_db):
    fields = {f["field_name"]: f for f in get_preset_fields("invoice")}
    assert "line_items" not in fields
    assert fields["date"]["type"] == "date"
    assert fields["date"]["format"] == "date"
    assert fields["total"]["type"] == "number"


def test_get_preset_fields_unknown_raises(test_db):
    with pytest.raises(ValueError, match="unknown-preset"):
        get_preset_fields("unknown-preset")
