"""Tests for extraction.schema_resolve.resolve_schema (offline, TestModel)."""

import pytest
from pydantic_ai.models.test import TestModel

from smart_data_extractor.extraction import infer_schema, resolve_schema


def _field(display_name, description="d", type_="string", required=False, field_name=None, display_name_en=None):
    return {
        "display_name": display_name,
        "display_name_en": display_name_en,
        "description": description,
        "type": type_,
        "required": required,
        "field_name": field_name,
    }


async def test_resolve_skips_llm_when_all_fields_known():
    """Every field already has a field_name -> zero cost, no Agent call."""
    fields = [_field("Name", field_name="name"), _field("Email", field_name="email")]
    result = await resolve_schema(fields)
    assert result["cost_usd"] == 0.0
    assert result["tokens_used"] == {"input": 0, "output": 0}
    assert result["schema"] == {
        "fields": {
            "name": {
                "type": "string",
                "description": "d",
                "required": False,
                "display_name": "Name",
                "display_name_en": None,
            },
            "email": {
                "type": "string",
                "description": "d",
                "required": False,
                "display_name": "Email",
                "display_name_en": None,
            },
        }
    }


async def test_resolve_known_field_name_echoes_display_name_en():
    """A field with known field_name keeps its input display_name_en."""
    fields = [
        _field("Name", field_name="name"),
        _field("邮箱", field_name="email") | {"display_name_en": "Email"},
    ]
    result = await resolve_schema(fields)
    assert result["schema"]["fields"]["name"]["display_name_en"] is None
    assert result["schema"]["fields"]["email"]["display_name_en"] == "Email"
    assert result["schema"]["fields"]["email"]["display_name"] == "邮箱"


async def test_resolve_generates_missing_field_name():
    """A single missing field_name triggers one Agent call and gets filled in."""
    fields = [_field("Name", field_name="name"), _field("客户紧急程度")]
    model = TestModel(
        custom_output_args={
            "fields": [
                {"index": 1, "field_name": "urgency_level", "display_name_en": "Urgency Level"}
            ]
        }
    )

    result = await resolve_schema(fields, model=model)

    assert set(result["schema"]["fields"]) == {"name", "urgency_level"}
    assert result["cost_usd"] >= 0.0
    assert result["tokens_used"]["input"] > 0

    urgency = result["schema"]["fields"]["urgency_level"]
    assert urgency["display_name_en"] == "Urgency Level"
    assert urgency["display_name"] == "客户紧急程度"


async def test_resolve_generates_multiple_missing_field_names():
    """Several missing fields are resolved in a single batch call."""
    fields = [_field("客户紧急程度"), _field("备注")]
    model = TestModel(
        custom_output_args={
            "fields": [
                {"index": 0, "field_name": "urgency_level", "display_name_en": "Urgency Level"},
                {"index": 1, "field_name": "remarks", "display_name_en": "Remarks"},
            ]
        }
    )

    result = await resolve_schema(fields, model=model)

    assert set(result["schema"]["fields"]) == {"urgency_level", "remarks"}
    assert result["schema"]["fields"]["urgency_level"]["display_name_en"] == "Urgency Level"
    assert result["schema"]["fields"]["remarks"]["display_name_en"] == "Remarks"


async def test_resolve_invalid_identifier_raises():
    """A generated name that isn't a valid snake_case identifier fails."""
    fields = [_field("客户紧急程度")]
    model = TestModel(
        custom_output_args={
            "fields": [{"index": 0, "field_name": "UrgencyLevel", "display_name_en": "Urgency"}]
        }
    )

    with pytest.raises(ValueError, match="not a valid snake_case identifier"):
        await resolve_schema(fields, model=model)


async def test_resolve_confidence_suffix_rejected():
    """The reserved _confidence suffix is rejected even if otherwise valid."""
    fields = [_field("Urgency")]
    model = TestModel(
        custom_output_args={
            "fields": [
                {"index": 0, "field_name": "urgency_confidence", "display_name_en": "Urgency"}
            ]
        }
    )

    with pytest.raises(ValueError, match="_confidence"):
        await resolve_schema(fields, model=model)


async def test_resolve_conflict_with_known_name_raises():
    """A generated name colliding with an already-known field_name fails."""
    fields = [_field("Name", field_name="name"), _field("姓名")]
    model = TestModel(
        custom_output_args={"fields": [{"index": 1, "field_name": "name", "display_name_en": "Name"}]}
    )

    with pytest.raises(ValueError, match="conflicts"):
        await resolve_schema(fields, model=model)


async def test_resolve_missing_generation_raises():
    """If the Agent omits an index, that field's resolution fails."""
    fields = [_field("A"), _field("B")]
    model = TestModel(
        custom_output_args={"fields": [{"index": 0, "field_name": "a", "display_name_en": "A"}]}
    )

    with pytest.raises(ValueError, match="did not return a name"):
        await resolve_schema(fields, model=model)


async def test_infer_schema_happy_path():
    """The Agent's inferred fields become the schema, keyed by field_name."""
    model = TestModel(
        custom_output_args={
            "schema_name": "发票信息",
            "schema_name_en": "Invoice Info",
            "fields": [
                {
                    "field_name": "invoice_number",
                    "display_name": "发票号",
                    "display_name_en": "Invoice Number",
                    "description": "The invoice number",
                    "type": "string",
                    "required": True,
                }
            ],
        }
    )

    result = await infer_schema("发票号：12345", model=model)

    assert result["schema"] == {
        "fields": {
            "invoice_number": {
                "type": "string",
                "description": "The invoice number",
                "required": True,
                "display_name": "发票号",
                "display_name_en": "Invoice Number",
            }
        }
    }
    assert result["schema_name"] == "发票信息"
    assert result["schema_name_en"] == "Invoice Info"
    assert result["tokens_used"]["input"] > 0
    assert result["cost_usd"] >= 0.0


async def test_infer_schema_no_fields_raises():
    """An empty field list from the Agent is rejected."""
    model = TestModel(custom_output_args={"schema_name": "n", "schema_name_en": "N", "fields": []})

    with pytest.raises(ValueError, match="did not return any fields"):
        await infer_schema("some text", model=model)


async def test_infer_schema_invalid_identifier_raises():
    """A generated field_name that isn't valid snake_case fails."""
    model = TestModel(
        custom_output_args={
            "schema_name": "发票信息",
            "schema_name_en": "Invoice Info",
            "fields": [
                {
                    "field_name": "InvoiceNumber",
                    "display_name": "发票号",
                    "display_name_en": "Invoice Number",
                    "description": "d",
                    "type": "string",
                    "required": True,
                }
            ]
        }
    )

    with pytest.raises(ValueError, match="not a valid snake_case identifier"):
        await infer_schema("发票号：12345", model=model)


async def test_infer_schema_duplicate_field_name_raises():
    """Two inferred fields sharing the same field_name conflict."""
    model = TestModel(
        custom_output_args={
            "schema_name": "合同信息",
            "schema_name_en": "Contract Info",
            "fields": [
                {
                    "field_name": "name",
                    "display_name": "甲方",
                    "display_name_en": "Party A",
                    "description": "d",
                    "type": "string",
                    "required": True,
                },
                {
                    "field_name": "name",
                    "display_name": "乙方",
                    "display_name_en": "Party B",
                    "description": "d",
                    "type": "string",
                    "required": True,
                },
            ]
        }
    )

    with pytest.raises(ValueError, match="conflicts"):
        await infer_schema("some contract text", model=model)
