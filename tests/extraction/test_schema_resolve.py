"""Tests for extraction.schema_resolve.resolve_schema (offline, TestModel)."""

import pytest
from pydantic_ai.models.test import TestModel

from smart_data_extractor.extraction import resolve_schema


def _field(display_name, description="d", type_="string", required=False, field_name=None):
    return {
        "display_name": display_name,
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
            "name": {"type": "string", "description": "d", "required": False},
            "email": {"type": "string", "description": "d", "required": False},
        }
    }


async def test_resolve_generates_missing_field_name():
    """A single missing field_name triggers one Agent call and gets filled in."""
    fields = [_field("Name", field_name="name"), _field("客户紧急程度")]
    model = TestModel(custom_output_args={"fields": [{"index": 1, "field_name": "urgency_level"}]})

    result = await resolve_schema(fields, model=model)

    assert set(result["schema"]["fields"]) == {"name", "urgency_level"}
    assert result["cost_usd"] >= 0.0
    assert result["tokens_used"]["input"] > 0


async def test_resolve_generates_multiple_missing_field_names():
    """Several missing fields are resolved in a single batch call."""
    fields = [_field("客户紧急程度"), _field("备注")]
    model = TestModel(
        custom_output_args={
            "fields": [
                {"index": 0, "field_name": "urgency_level"},
                {"index": 1, "field_name": "remarks"},
            ]
        }
    )

    result = await resolve_schema(fields, model=model)

    assert set(result["schema"]["fields"]) == {"urgency_level", "remarks"}


async def test_resolve_invalid_identifier_raises():
    """A generated name that isn't a valid snake_case identifier fails."""
    fields = [_field("客户紧急程度")]
    model = TestModel(custom_output_args={"fields": [{"index": 0, "field_name": "UrgencyLevel"}]})

    with pytest.raises(ValueError, match="not a valid snake_case identifier"):
        await resolve_schema(fields, model=model)


async def test_resolve_confidence_suffix_rejected():
    """The reserved _confidence suffix is rejected even if otherwise valid."""
    fields = [_field("Urgency")]
    model = TestModel(custom_output_args={"fields": [{"index": 0, "field_name": "urgency_confidence"}]})

    with pytest.raises(ValueError, match="_confidence"):
        await resolve_schema(fields, model=model)


async def test_resolve_conflict_with_known_name_raises():
    """A generated name colliding with an already-known field_name fails."""
    fields = [_field("Name", field_name="name"), _field("姓名")]
    model = TestModel(custom_output_args={"fields": [{"index": 1, "field_name": "name"}]})

    with pytest.raises(ValueError, match="conflicts"):
        await resolve_schema(fields, model=model)


async def test_resolve_missing_generation_raises():
    """If the Agent omits an index, that field's resolution fails."""
    fields = [_field("A"), _field("B")]
    model = TestModel(custom_output_args={"fields": [{"index": 0, "field_name": "a"}]})

    with pytest.raises(ValueError, match="did not return a name"):
        await resolve_schema(fields, model=model)
