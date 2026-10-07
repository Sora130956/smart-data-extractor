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
from smart_data_extractor.models import create_dynamic_model
from smart_data_extractor.presets import get_preset

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"

CONTACT_FIELDS = {
    "name", "email", "phone", "company", "job_title", "website",
    "name_confidence", "email_confidence", "phone_confidence",
    "company_confidence", "job_title_confidence", "website_confidence",
}

INVOICE_FIELDS = {
    "invoice_number", "date", "vendor", "total", "tax", "currency",
    "invoice_number_confidence", "date_confidence", "vendor_confidence",
    "total_confidence", "tax_confidence", "currency_confidence",
}

LEAD_FIELDS = {
    "name", "email", "phone", "company", "job_title", "lead_source",
    "stage", "budget_range", "timeline", "notes",
    "name_confidence", "email_confidence", "phone_confidence",
    "company_confidence", "job_title_confidence", "lead_source_confidence",
    "stage_confidence", "budget_range_confidence", "timeline_confidence",
    "notes_confidence",
}

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
    ("preset", "fixture", "expected_fields"),
    [
        ("contact", "contact_sample.txt", CONTACT_FIELDS),
        ("invoice", "invoice_sample.txt", INVOICE_FIELDS),
        ("lead", "lead_sample.txt", LEAD_FIELDS),
    ],
)
async def test_ac1_preset_output_matches_model(preset, fixture, expected_fields, test_db):
    """Extracted keys equal the preset schema's fields, nothing more/less."""
    result = await extract_data(
        fixture_text(fixture), preset=preset, model=TestModel()
    )
    assert set(result["data"]) == expected_fields


def test_ac1_field_completeness(test_db):
    """The seeded preset schemas carry their core business fields: contact
    has exactly the 6 data fields mirrored in CONTACT_FIELDS (confidence
    twins are added by create_dynamic_model, not stored in the seed);
    invoice/lead keep their core names (invoice has no line_items since
    the DB migration); every preset has at least 6 data fields."""
    contact_data_fields = set(get_preset("contact").schema_dict["fields"])
    assert contact_data_fields == {
        f for f in CONTACT_FIELDS if not f.endswith("_confidence")
    }
    assert len(contact_data_fields) == 6

    invoice_data_fields = set(get_preset("invoice").schema_dict["fields"])
    assert {
        "invoice_number", "date", "vendor", "total", "tax", "currency"
    } <= invoice_data_fields
    assert "line_items" not in invoice_data_fields

    lead_data_fields = set(get_preset("lead").schema_dict["fields"])
    assert {
        "name", "email", "phone", "company", "job_title"
    } <= lead_data_fields

    for data_fields in (contact_data_fields, invoice_data_fields, lead_data_fields):
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


def test_ac3_invalid_email_intercepted(test_db):
    """Invalid email -> field null AND confidence zeroed; valid sibling
    fields keep their values and confidences."""
    Contact = create_dynamic_model(
        get_preset("contact").schema_dict, model_name="Preset_contact"
    )
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


def test_ac3_invalid_phone_website_date_intercepted(test_db):
    Contact = create_dynamic_model(
        get_preset("contact").schema_dict, model_name="Preset_contact"
    )
    contact = Contact(
        phone="123", phone_confidence=0.7,
        website="not-a-url", website_confidence=0.6,
    )
    assert contact.phone is None
    assert contact.phone_confidence == 0.0
    assert contact.website is None
    assert contact.website_confidence == 0.0

    Invoice = create_dynamic_model(
        get_preset("invoice").schema_dict, model_name="Preset_invoice"
    )
    invoice = Invoice(date="not-a-date", date_confidence=0.8)
    assert invoice.date is None
    assert invoice.date_confidence == 0.0


def test_ac3_absent_fields_default_to_zero_confidence(test_db):
    Contact = create_dynamic_model(
        get_preset("contact").schema_dict, model_name="Preset_contact"
    )
    contact = Contact()
    for name in CONTACT_FIELDS:
        if name.endswith("_confidence"):
            assert getattr(contact, name) == 0.0


async def test_ac3_confidence_bounds_through_extraction(test_db):
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


async def test_ac4_single_record_cost_and_tokens(test_db):
    result = await extract_data(
        fixture_text("contact_sample.txt"), preset="contact", model=TestModel()
    )
    assert {"data", "tokens_used", "cost_usd"} <= set(result)
    assert result["cost_usd"] > 0
    assert result["tokens_used"]["input"] > 0
    assert result["tokens_used"]["output"] > 0


async def test_ac4_batch_aggregates_over_fixture_texts(test_db):
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
