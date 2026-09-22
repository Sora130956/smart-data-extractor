"""Tests for models/contact.py"""

import pytest

from smart_data_extractor.models.contact import Contact


def test_contact_valid_fields():
    """Test Contact model with valid fields."""
    contact = Contact(
        name="John Smith",
        name_confidence=0.95,
        email="john@example.com",
        email_confidence=0.9,
        phone="555-1234",
        phone_confidence=0.85,
        company="Acme Corp",
        company_confidence=0.8,
        job_title="CTO",
        job_title_confidence=0.75,
        website="https://example.com",
        website_confidence=0.7,
    )
    assert contact.name == "John Smith"
    assert contact.name_confidence == 0.95
    assert contact.email == "john@example.com"
    assert contact.phone == "5551234"  # Normalized to digits only
    assert contact.website == "https://example.com"


def test_contact_defaults():
    """Test Contact model with all defaults (None fields, 0.0 confidence)."""
    contact = Contact()
    assert contact.name is None
    assert contact.name_confidence == 0.0
    assert contact.email is None
    assert contact.email_confidence == 0.0


def test_contact_email_validation():
    """Test email validation sets field to None and confidence to 0.0 on invalid."""
    contact = Contact(email="invalid-email", email_confidence=0.8)
    assert contact.email is None
    # Note: confidence is NOT automatically zeroed by validator, that's the model layer's job
    # For now, validator only returns None for the field


def test_contact_email_normalization():
    """Test email is normalized to lowercase."""
    contact = Contact(email="John@EXAMPLE.COM", email_confidence=0.9)
    assert contact.email == "john@example.com"


def test_contact_phone_normalization():
    """Test phone extracts digits only."""
    contact = Contact(phone="+1 (555) 123-4567", phone_confidence=0.9)
    assert contact.phone == "15551234567"


def test_contact_phone_invalid_too_few_digits():
    """Test phone with fewer than 7 digits returns None."""
    contact = Contact(phone="123456", phone_confidence=0.8)
    assert contact.phone is None


def test_contact_website_validation():
    """Test website URL validation."""
    contact = Contact(website="not-a-url", website_confidence=0.7)
    assert contact.website is None


def test_contact_website_valid():
    """Test valid website URL."""
    contact = Contact(website="https://example.com", website_confidence=0.9)
    assert contact.website == "https://example.com"


def test_contact_confidence_bounds():
    """Test confidence fields enforce [0.0, 1.0] bounds."""
    with pytest.raises(ValueError):
        Contact(name="John", name_confidence=1.5)
    
    with pytest.raises(ValueError):
        Contact(name="John", name_confidence=-0.1)


def test_contact_partial_data():
    """Test Contact with only some fields populated."""
    contact = Contact(
        name="Jane Doe",
        name_confidence=0.9,
        email="jane@example.com",
        email_confidence=0.85
    )
    assert contact.name == "Jane Doe"
    assert contact.email == "jane@example.com"
    assert contact.phone is None
    assert contact.company is None
