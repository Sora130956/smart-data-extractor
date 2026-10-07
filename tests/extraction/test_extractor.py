"""Tests for extraction.extractor.extract_data (offline, TestModel)."""

from decimal import Decimal

import pytest
from pydantic_ai.models.test import TestModel
from pydantic_ai.usage import RunUsage

import smart_data_extractor.extraction.extractor as extractor_module
from smart_data_extractor.extraction import extract_data
from smart_data_extractor.extraction.extractor import _compose_instructions, _resolve_cost

CONTACT_FIELDS = {
    "name", "email", "phone", "company", "job_title", "website",
    "name_confidence", "email_confidence", "phone_confidence",
    "company_confidence", "job_title_confidence", "website_confidence",
}


@pytest.fixture
def test_model() -> TestModel:
    """Offline model, function-scoped to avoid cross-test state."""
    return TestModel()


async def test_extract_with_contact_preset(test_model, test_db):
    """Preset extraction returns data matching the Contact schema."""
    result = await extract_data(
        "John Smith, CTO at Acme Corp, john@acme.com",
        preset="contact",
        model=test_model,
    )
    assert set(result["data"]) == CONTACT_FIELDS
    assert "name" in result["data"]
    assert "name_confidence" in result["data"]


async def test_extract_with_schema_dict(test_model):
    """Custom schema extraction returns exactly schema fields + confidence."""
    schema = {
        "product_name": {"type": "string", "required": True},
        "price": {"type": "number", "required": False},
    }
    result = await extract_data(
        "iPhone 15 Pro, $999",
        schema_dict=schema,
        model=test_model,
    )
    assert set(result["data"]) == {
        "product_name",
        "product_name_confidence",
        "price",
        "price_confidence",
    }


async def test_extract_reports_tokens_and_cost(test_model, test_db):
    """Each extraction reports token usage and a non-negative USD cost."""
    result = await extract_data(
        "Jane Doe, jane@startup.io",
        preset="contact",
        model=test_model,
    )
    tokens = result["tokens_used"]
    assert isinstance(tokens["input"], int) and tokens["input"] > 0
    assert isinstance(tokens["output"], int) and tokens["output"] > 0
    assert isinstance(result["cost_usd"], float)
    assert result["cost_usd"] >= 0.0


async def test_extract_requires_exactly_one_source(test_model, test_db):
    """Neither preset nor schema_dict -> ValueError; both -> ValueError."""
    with pytest.raises(ValueError):
        await extract_data("some text", model=test_model)
    with pytest.raises(ValueError):
        await extract_data(
            "some text",
            preset="contact",
            schema_dict={"fields": {}},
            model=test_model,
        )


async def test_extract_unknown_preset_raises(test_model, test_db):
    """An unregistered preset name raises ValueError."""
    with pytest.raises(ValueError, match="nope"):
        await extract_data("some text", preset="nope", model=test_model)


async def test_extract_accepts_caller_instructions(test_model, test_db):
    """The optional instructions kwarg composes with the base prompt, offline."""
    result = await extract_data(
        "Jane Doe, jane@startup.io",
        preset="contact",
        model=test_model,
        instructions="The text may be in German.",
    )
    assert set(result["data"]) == CONTACT_FIELDS


async def test_extract_forwards_lang_to_get_preset(test_model, test_db, monkeypatch):
    """lang reaches the preset lookup, including zh-prefixed locales."""
    real_get_preset = extractor_module.get_preset
    calls = []

    def spy(name, lang="en"):
        calls.append((name, lang))
        return real_get_preset(name, lang=lang)

    monkeypatch.setattr(extractor_module, "get_preset", spy)

    await extract_data("张三，zhang@acme.cn", preset="contact", model=test_model, lang="zh-CN")

    assert calls == [("contact", "zh-CN")]


async def test_extract_defaults_lang_to_english(test_model, test_db, monkeypatch):
    """Without lang, the preset lookup still gets an explicit "en"."""
    real_get_preset = extractor_module.get_preset
    calls = []

    def spy(name, lang="en"):
        calls.append((name, lang))
        return real_get_preset(name, lang=lang)

    monkeypatch.setattr(extractor_module, "get_preset", spy)

    await extract_data("Jane Doe, jane@startup.io", preset="contact", model=test_model)

    assert calls == [("contact", "en")]


async def test_extract_forwards_lang_to_cached_agent(fake_openai_env, test_db, monkeypatch):
    """The production cached-agent path keys its agent by the UI language."""
    calls = []

    def spy(preset_name, model_ref, lang="en"):
        calls.append((preset_name, lang))
        # Offline stand-in for the cached production agent (TestModel).
        p = extractor_module.get_preset(preset_name, lang=lang)
        output_type = extractor_module.create_dynamic_model(
            p.schema_dict, model_name=f"Preset_{preset_name}"
        )
        return extractor_module.build_agent(output_type, model=TestModel())

    monkeypatch.setattr(extractor_module, "get_preset_agent", spy)

    await extract_data("张三，zhang@acme.cn", preset="contact", lang="zh")

    assert calls == [("contact", "zh")]


def test_compose_instructions_appends_caller_section():
    """Caller instructions come after the non-negotiable base rules."""
    base = "BASE RULES"
    out = _compose_instructions(base, "Text is in German")
    assert out.startswith(base)
    assert "Text is in German" in out
    assert out != base


def test_compose_instructions_none_returns_base():
    """No caller instructions -> base prompt unchanged."""
    assert _compose_instructions("BASE", None) == "BASE"


def test_resolve_cost_prefers_framework_cost(test_model):
    """When pydantic-ai already priced the run, use that figure verbatim."""
    usage = RunUsage(input_tokens=1, output_tokens=1, cost=Decimal("0.000123"))
    assert _resolve_cost(usage, model=test_model, model_ref=None) == 0.000123


def test_resolve_cost_falls_back_when_unpriced(test_model):
    """Unpriced runs (e.g. TestModel) fall back to the genai_prices lookup."""
    usage = RunUsage(input_tokens=1000, output_tokens=500, cost=None)
    cost = _resolve_cost(usage, model=test_model, model_ref=None)
    assert isinstance(cost, float) and cost > 0
