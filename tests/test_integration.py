"""Opt-in real-API smoke tests (default: skipped).

Run with:

    RUN_INTEGRATION=1 OPENAI_API_KEY=sk-... uv run pytest tests/test_integration.py -v

Budget: 2 real calls on gpt-4o-mini-class models (< $0.01 total).
Everything else in the suite runs offline via TestModel (D-005); these
tests exist to evidence that the production path (settings model, cached
agent, instructions delivery R-2, real usage/cost) works end to end.
"""

import os
from pathlib import Path

import pytest

from smart_data_extractor.extraction import extract_data
from smart_data_extractor.models import Contact

pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_INTEGRATION") != "1",
    reason="real-API smoke test; opt in with RUN_INTEGRATION=1 (requires OPENAI_API_KEY)",
)

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"


async def test_real_contact_extraction():
    """One real call through the production path (settings model, cached
    agent): fields extracted, confidence bounded, usage and cost real."""
    text = (FIXTURES / "contact_sample.txt").read_text(encoding="utf-8").strip()
    result = await extract_data(text, preset="contact")

    data = result["data"]
    assert set(data) == set(Contact.model_fields)
    assert data["name"] == "John Smith"
    assert data["email"] == "john@acme.com"
    assert data["job_title"] == "CTO"
    for key, value in data.items():
        if key.endswith("_confidence"):
            assert 0.0 <= value <= 1.0, key
    assert result["tokens_used"]["input"] > 0
    assert result["tokens_used"]["output"] > 0
    assert result["cost_usd"] > 0


async def test_real_instructions_are_delivered():
    """R-2 smoke: caller instructions reach the model and steer output.
    Without the instruction a free-form sentiment field would echo the
    text's wording; the instruction forces the exact enum-ish word."""
    result = await extract_data(
        "This product is absolutely AMAZING!!! Best purchase I ever made.",
        schema_dict={
            "fields": {"sentiment": {"type": "string", "required": True}}
        },
        instructions=(
            "sentiment must be exactly 'positive' or 'negative', lowercase"
        ),
    )
    assert result["data"]["sentiment"] == "positive"
    assert result["cost_usd"] > 0
