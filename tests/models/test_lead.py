"""Tests for models/lead.py"""

import pytest

from smart_data_extractor.models.lead import Lead


def test_lead_valid_fields():
    """Test Lead model with valid fields."""
    lead = Lead(
        name="Jane Doe",
        name_confidence=0.95,
        email="jane@startup.io",
        email_confidence=0.9,
        phone="555-0200",
        phone_confidence=0.85,
        company="Startup Inc",
        company_confidence=0.8,
        job_title="VP of Sales",
        job_title_confidence=0.85,
        lead_source="inbound",
        lead_source_confidence=0.9,
        stage="qualified",
        stage_confidence=0.8,
    )
    assert lead.name == "Jane Doe"
    assert lead.email == "jane@startup.io"
    assert lead.phone == "5550200"
    assert lead.company == "Startup Inc"
    assert lead.job_title == "VP of Sales"
    assert lead.lead_source == "inbound"
    assert lead.stage == "qualified"


def test_lead_defaults():
    """Test Lead with defaults."""
    lead = Lead()
    assert lead.name is None
    assert lead.name_confidence == 0.0
    assert lead.email is None
    assert lead.email_confidence == 0.0


def test_lead_email_validation():
    """Test email validation."""
    lead = Lead(email="invalid-email", email_confidence=0.8)
    assert lead.email is None


def test_lead_email_normalization():
    """Test email is normalized to lowercase."""
    lead = Lead(email="Jane@STARTUP.IO", email_confidence=0.9)
    assert lead.email == "jane@startup.io"


def test_lead_phone_normalization():
    """Test phone extracts digits only."""
    lead = Lead(phone="+1-555-0200", phone_confidence=0.85)
    assert lead.phone == "15550200"


def test_lead_phone_invalid():
    """Test invalid phone with too few digits."""
    lead = Lead(phone="123", phone_confidence=0.8)
    assert lead.phone is None


def test_lead_confidence_bounds():
    """Test confidence fields enforce [0.0, 1.0] bounds."""
    with pytest.raises(ValueError):
        Lead(name="Jane", name_confidence=1.5)
    
    with pytest.raises(ValueError):
        Lead(name="Jane", name_confidence=-0.1)


def test_lead_partial_data():
    """Test Lead with only some fields populated."""
    lead = Lead(
        name="Bob Smith",
        name_confidence=0.9,
        job_title="CTO",
        job_title_confidence=0.85,
    )
    assert lead.name == "Bob Smith"
    assert lead.job_title == "CTO"
    assert lead.email is None
    assert lead.phone is None
    assert lead.company is None


def test_lead_optional_fields():
    """Test Lead with optional budget, timeline and notes."""
    lead = Lead(
        name="Alice Chen",
        name_confidence=0.9,
        budget_range="50k-100k",
        budget_range_confidence=0.75,
        timeline="Q1 2024",
        timeline_confidence=0.8,
        notes="Interested in enterprise plan, mentioned competitor pricing",
        notes_confidence=0.85,
    )
    assert lead.budget_range == "50k-100k"
    assert lead.timeline == "Q1 2024"
    assert lead.notes == "Interested in enterprise plan, mentioned competitor pricing"


def test_lead_stage_values():
    """Test common stage values."""
    stages = ["new", "contacted", "qualified", "proposal", "won", "lost"]
    for stage in stages:
        lead = Lead(stage=stage, stage_confidence=0.8)
        assert lead.stage == stage
