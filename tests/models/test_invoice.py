"""Tests for models/invoice.py"""

import pytest

from smart_data_extractor.models.invoice import Invoice, InvoiceLineItem


def test_invoice_line_item_valid():
    """Test InvoiceLineItem with valid fields."""
    item = InvoiceLineItem(
        description="Software License",
        description_confidence=0.9,
        quantity=5.0,
        quantity_confidence=0.95,
        unit_price=100.0,
        unit_price_confidence=0.9,
        amount=500.0,
        amount_confidence=0.95,
    )
    assert item.description == "Software License"
    assert item.quantity == 5.0
    assert item.unit_price == 100.0
    assert item.amount == 500.0


def test_invoice_line_item_defaults():
    """Test InvoiceLineItem with defaults."""
    item = InvoiceLineItem()
    assert item.description is None
    assert item.description_confidence == 0.0


def test_invoice_valid_fields():
    """Test Invoice with valid fields."""
    invoice = Invoice(
        invoice_number="INV-001",
        invoice_number_confidence=0.95,
        date="2024-01-15",
        date_confidence=0.9,
        vendor="Acme Corp",
        vendor_confidence=0.85,
        total=1500.0,
        total_confidence=0.9,
        tax=150.0,
        tax_confidence=0.85,
        currency="USD",
        currency_confidence=0.8,
    )
    assert invoice.invoice_number == "INV-001"
    assert invoice.date == "2024-01-15"
    assert invoice.vendor == "Acme Corp"
    assert invoice.total == 1500.0
    assert invoice.tax == 150.0
    assert invoice.currency == "USD"


def test_invoice_defaults():
    """Test Invoice with defaults."""
    invoice = Invoice()
    assert invoice.invoice_number is None
    assert invoice.invoice_number_confidence == 0.0
    assert invoice.line_items == []
    assert invoice.line_items_confidence == 0.0


def test_invoice_date_normalization():
    """Test date is normalized to ISO format (YYYY-MM-DD)."""
    invoice = Invoice(date="01/15/2024", date_confidence=0.9)
    assert invoice.date == "2024-01-15"


def test_invoice_date_invalid():
    """Test invalid date returns None."""
    invoice = Invoice(date="not-a-date", date_confidence=0.8)
    assert invoice.date is None


def test_invoice_with_line_items():
    """Test Invoice with line items."""
    item1 = InvoiceLineItem(
        description="Item 1",
        description_confidence=0.9,
        amount=100.0,
        amount_confidence=0.9,
    )
    item2 = InvoiceLineItem(
        description="Item 2",
        description_confidence=0.85,
        amount=200.0,
        amount_confidence=0.85,
    )
    
    invoice = Invoice(
        invoice_number="INV-002",
        invoice_number_confidence=0.95,
        total=300.0,
        total_confidence=0.9,
        line_items=[item1, item2],
        line_items_confidence=0.85,
    )
    
    assert len(invoice.line_items) == 2
    assert invoice.line_items[0].description == "Item 1"
    assert invoice.line_items[1].amount == 200.0


def test_invoice_confidence_bounds():
    """Test confidence fields enforce [0.0, 1.0] bounds."""
    with pytest.raises(ValueError):
        Invoice(total=100.0, total_confidence=1.5)
    
    with pytest.raises(ValueError):
        Invoice(total=100.0, total_confidence=-0.1)


def test_invoice_date_formats():
    """Test various date formats are normalized."""
    test_cases = [
        ("2024-01-15", "2024-01-15"),
        ("2024/01/15", "2024-01-15"),
        ("01/15/2024", "2024-01-15"),
        ("January 15, 2024", "2024-01-15"),
        ("Jan 15, 2024", "2024-01-15"),
    ]
    
    for input_date, expected in test_cases:
        invoice = Invoice(date=input_date, date_confidence=0.9)
        assert invoice.date == expected, f"Failed for input: {input_date}"
