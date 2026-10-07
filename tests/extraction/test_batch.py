"""Tests for extraction.batch.batch_extract (offline, TestModel)."""

import pytest
from pydantic_ai.models.test import TestModel

import smart_data_extractor.extraction.batch as batch_module
from smart_data_extractor.extraction import batch_extract


@pytest.fixture
def test_model() -> TestModel:
    """Offline model, function-scoped to avoid cross-test state."""
    return TestModel()


async def test_batch_returns_one_result_per_text(test_model, test_db):
    """Each input text yields one result shaped like extract_data's."""
    texts = [
        "John Smith, CTO at Acme Corp, john@acme.com",
        "Jane Doe, jane@startup.io",
        "Bob, bob@example.com",
    ]
    result = await batch_extract(texts, preset="contact", model=test_model)
    assert len(result["results"]) == len(texts)
    for r in result["results"]:
        assert set(r) == {"data", "tokens_used", "cost_usd"}


async def test_batch_aggregates_cost_and_tokens(test_model, test_db):
    """Totals equal the sum of the per-text results (not first / max / zero)."""
    texts = ["text one", "text two", "text three"]
    result = await batch_extract(texts, preset="contact", model=test_model)
    results = result["results"]
    assert result["total_cost_usd"] == sum(r["cost_usd"] for r in results)
    assert result["total_tokens"]["input"] == sum(
        r["tokens_used"]["input"] for r in results
    )
    assert result["total_tokens"]["output"] == sum(
        r["tokens_used"]["output"] for r in results
    )
    # Aggregation must be non-trivial: positive totals over multiple items,
    # so a stub returning 0 or results[0] cannot pass.
    assert result["total_cost_usd"] > 0
    assert result["total_tokens"]["input"] > results[0]["tokens_used"]["input"]


async def test_batch_empty_input_returns_zero_totals(test_model):
    """Empty batch -> no results, zero totals, no aggregation errors."""
    result = await batch_extract([], preset="contact", model=test_model)
    assert result["results"] == []
    assert result["total_cost_usd"] == 0.0
    assert result["total_tokens"] == {"input": 0, "output": 0}


async def test_batch_requires_exactly_one_source(test_model):
    """Neither or both of preset/schema_dict -> ValueError."""
    with pytest.raises(ValueError):
        await batch_extract(["some text"], model=test_model)
    with pytest.raises(ValueError):
        await batch_extract(
            ["some text"],
            preset="contact",
            schema_dict={"x": {"type": "string"}},
            model=test_model,
        )


async def test_batch_unknown_preset_raises(test_model, test_db):
    """An unregistered preset name raises ValueError."""
    with pytest.raises(ValueError, match="nope"):
        await batch_extract(["some text"], preset="nope", model=test_model)


async def test_batch_with_schema_dict(test_model):
    """Batch extraction works with a user-defined dynamic schema."""
    schema = {"product_name": {"type": "string", "required": True}}
    result = await batch_extract(
        ["iPhone 15 Pro, $999", "Pixel 8, $899"],
        schema_dict=schema,
        model=test_model,
    )
    assert len(result["results"]) == 2
    for r in result["results"]:
        assert "product_name" in r["data"]


# --- Phase 4: return_exceptions + instructions (D-007 partial tolerance) ---


def _make_fake_extract(fail_on=()):
    """Fake extract_data dependency: fails on given texts, records kwargs.

    Returns per-text results with non-trivial usage so aggregation tests
    cannot pass on stubs (zero / first-item / constant totals).
    """
    calls = []

    async def fake_extract(
        text, preset=None, schema_dict=None, *, model=None, model_ref=None, instructions=None
    ):
        calls.append({"text": text, "instructions": instructions})
        if text in fail_on:
            raise RuntimeError(f"boom: {text}")
        return {
            "data": {"echo": text},
            "tokens_used": {"input": len(text), "output": 1},
            "cost_usd": 0.001,
        }

    return fake_extract, calls


async def test_batch_return_exceptions_yields_per_item_errors(monkeypatch):
    """Tolerant mode: failed texts become error items, order and aggregates hold."""
    fake, _ = _make_fake_extract(fail_on={"bad text"})
    monkeypatch.setattr(batch_module, "extract_data", fake)

    result = await batch_extract(
        ["good one", "bad text", "good two"],
        preset="contact",
        return_exceptions=True,
    )

    assert len(result["results"]) == 3
    ok1, err, ok2 = result["results"]
    # Uniform item shape: every item carries all four keys.
    for item in result["results"]:
        assert set(item) == {"data", "tokens_used", "cost_usd", "error"}
    assert ok1["error"] is None
    assert ok1["data"] == {"echo": "good one"}
    assert err["data"] is None
    assert "boom" in err["error"]
    assert err["tokens_used"] == {"input": 0, "output": 0}
    assert err["cost_usd"] == 0.0
    assert ok2["data"] == {"echo": "good two"}  # input order preserved
    # Aggregates count successes only (failures contribute zero).
    assert result["total_cost_usd"] == pytest.approx(0.002)
    assert result["total_tokens"]["input"] == len("good one") + len("good two")


async def test_batch_default_remains_fail_fast(monkeypatch):
    """Default mode unchanged: first failure raises, no partial results."""
    fake, _ = _make_fake_extract(fail_on={"bad"})
    monkeypatch.setattr(batch_module, "extract_data", fake)

    with pytest.raises(RuntimeError, match="boom"):
        await batch_extract(["ok", "bad"], preset="contact")


async def test_batch_forwards_instructions(monkeypatch):
    """instructions is forwarded to every extract_data call."""
    fake, calls = _make_fake_extract()
    monkeypatch.setattr(batch_module, "extract_data", fake)

    await batch_extract(["a", "b"], preset="contact", instructions="be strict")

    assert [c["instructions"] for c in calls] == ["be strict", "be strict"]
