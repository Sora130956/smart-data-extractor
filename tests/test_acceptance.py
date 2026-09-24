"""Acceptance checks for docs/acceptance.md (AC-1..AC-4), offline.

Offline mapping: acceptance.md's bash/jq commands were drafted against a
stdin-piping CLI plus the real API. The offline equivalent here drives
the same public entry points (extract_data / batch_extract) with
TestModel injected (D-005), and checks validation semantics TestModel
cannot exercise (invalid formats, missing fields) at model level. The
opt-in real-API smoke lives in tests/test_integration.py.

AC-5 (suite passes without OPENAI_API_KEY) is a property of the whole
suite, evidenced by running it with the variable removed — see
docs/review.md, Phase 6.
"""

from pathlib import Path

import pytest
from pydantic import ValidationError
from pydantic_ai.models.test import TestModel

from smart_data_extractor.config import get_settings
from smart_data_extractor.extraction import batch_extract, extract_data
from smart_data_extractor.extraction.agent import shared_concurrency_limiter
from smart_data_extractor.models import Contact, create_dynamic_model
from smart_data_extractor.models.invoice import Invoice
from smart_data_extractor.models.lead import Lead

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"

AC2_SCHEMA = {
    "fields": {
        "product_name": {"type": "string", "required": True},
        "price": {"type": "number", "required": True},
        "stock_status": {"type": "string", "required": False},
    }
}


def fixture_text(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8").strip()


# --- AC-1: preset output shape and field completeness ---


@pytest.mark.parametrize(
    ("preset", "fixture", "model_class"),
    [
        ("contact", "contact_sample.txt", Contact),
        ("invoice", "invoice_sample.txt", Invoice),
        ("lead", "lead_sample.txt", Lead),
    ],
)
async def test_ac1_preset_output_matches_model(preset, fixture, model_class):
    """Extracted keys equal the preset model's fields, nothing more/less."""
    result = await extract_data(
        fixture_text(fixture), preset=preset, model=TestModel()
    )
    assert set(result["data"]) == set(model_class.model_fields)


def test_ac1_field_completeness():
    """Contact has exactly 12 fields; Invoice/Lead carry their core
    business fields and at least 6 data fields each (BANT names)."""
    assert len(Contact.model_fields) == 12

    assert {
        "invoice_number", "date", "vendor", "total", "tax", "line_items"
    } <= set(Invoice.model_fields)
    assert {
        "name", "email", "phone", "company", "job_title"
    } <= set(Lead.model_fields)

    for model in (Contact, Invoice, Lead):
        data_fields = [
            f for f in model.model_fields if not f.endswith("_confidence")
        ]
        assert len(data_fields) >= 6


# --- AC-2: custom schema -> strict field match, missing -> null ---


async def test_ac2_dynamic_output_matches_schema():
    """Output keys are exactly the schema fields plus their confidence
    twins (the D-004 confidence contract)."""
    result = await extract_data(
        "iPhone 15 Pro costs $999", schema_dict=AC2_SCHEMA, model=TestModel()
    )
    expected = set()
    for field in AC2_SCHEMA["fields"]:
        expected |= {field, f"{field}_confidence"}
    assert set(result["data"]) == expected


def test_ac2_missing_optional_field_is_null():
    """Absent optional field defaults to null, not an invented value."""
    Model = create_dynamic_model(AC2_SCHEMA)
    instance = Model(product_name="iPhone 15 Pro", price=999.0)
    assert instance.stock_status is None
    assert instance.stock_status_confidence == 0.0


def test_ac2_required_field_enforced():
    """Missing required field is rejected at validation time."""
    Model = create_dynamic_model(AC2_SCHEMA)
    with pytest.raises(ValidationError):
        Model(product_name="iPhone 15 Pro")  # price missing


# --- AC-3: confidence bounds + validation interception ---


def test_ac3_invalid_email_intercepted():
    """Invalid email -> field null AND confidence zeroed; valid sibling
    fields keep their values and confidences."""
    contact = Contact(
        name="John",
        name_confidence=0.9,
        email="invalid-email",
        email_confidence=0.8,
        phone="+1-555-0100",
        phone_confidence=0.9,
    )
    assert contact.email is None
    assert contact.email_confidence == 0.0
    assert contact.phone == "15550100"
    assert contact.phone_confidence == 0.9


def test_ac3_invalid_phone_website_date_intercepted():
    contact = Contact(
        phone="123", phone_confidence=0.7,
        website="not-a-url", website_confidence=0.6,
    )
    assert contact.phone is None
    assert contact.phone_confidence == 0.0
    assert contact.website is None
    assert contact.website_confidence == 0.0

    invoice = Invoice(date="not-a-date", date_confidence=0.8)
    assert invoice.date is None
    assert invoice.date_confidence == 0.0


def test_ac3_absent_fields_default_to_zero_confidence():
    contact = Contact()
    for name in Contact.model_fields:
        if name.endswith("_confidence"):
            assert getattr(contact, name) == 0.0


async def test_ac3_confidence_bounds_through_extraction():
    """Every confidence produced by an extraction stays within [0.0, 1.0]."""
    result = await extract_data(
        fixture_text("contact_sample.txt"), preset="contact", model=TestModel()
    )
    confidences = {
        k: v for k, v in result["data"].items() if k.endswith("_confidence")
    }
    assert confidences
    for value in confidences.values():
        assert 0.0 <= value <= 1.0


# --- AC-4: cost tracking + batch aggregation + concurrency cap ---


async def test_ac4_single_record_cost_and_tokens():
    result = await extract_data(
        fixture_text("contact_sample.txt"), preset="contact", model=TestModel()
    )
    assert {"data", "tokens_used", "cost_usd"} <= set(result)
    assert result["cost_usd"] > 0
    assert result["tokens_used"]["input"] > 0
    assert result["tokens_used"]["output"] > 0


async def test_ac4_batch_aggregates_over_fixture_texts():
    texts = [
        fixture_text(n)
        for n in ("contact_sample.txt", "invoice_sample.txt", "lead_sample.txt")
    ]
    result = await batch_extract(texts, preset="contact", model=TestModel())

    assert {"results", "total_cost_usd", "total_tokens"} <= set(result)
    assert len(result["results"]) == 3
    assert result["total_cost_usd"] == pytest.approx(
        sum(r["cost_usd"] for r in result["results"])
    )
    assert result["total_tokens"]["input"] == sum(
        r["tokens_used"]["input"] for r in result["results"]
    )
    assert result["total_cost_usd"] > 0


def test_ac4_global_concurrency_cap(fake_openai_env):
    """One process-wide limiter caps concurrency at settings.max_concurrency
    (5 by default). D-006 superseded acceptance.md's Semaphore(5) sketch:
    per-agent semaphores would not enforce a global cap."""
    limiter = shared_concurrency_limiter()
    assert limiter.max_running == get_settings().max_concurrency
    assert limiter.max_running == 5
