"""Invoice data model with line items."""

from typing import List, Optional

from pydantic import Field, field_validator

from smart_data_extractor.models.base import ConfidenceBase
from smart_data_extractor.validators import validate_date


class InvoiceLineItem(ConfidenceBase):
    """Single line item in an invoice."""
    
    description: Optional[str] = Field(default=None, description="Description of the item or service")
    description_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    
    quantity: Optional[float] = Field(default=None, description="Quantity of units")
    quantity_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    
    unit_price: Optional[float] = Field(default=None, description="Price per unit")
    unit_price_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    
    amount: Optional[float] = Field(default=None, description="Total amount for this line item")
    amount_confidence: float = Field(default=0.0, ge=0.0, le=1.0)


class Invoice(ConfidenceBase):
    """Invoice extracted from text.
    
    Each field has a corresponding confidence score in [0.0, 1.0].
    """
    
    invoice_number: Optional[str] = Field(default=None, description="Unique invoice identifier or number")
    invoice_number_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    
    date: Optional[str] = Field(default=None, description="Invoice date in ISO format (YYYY-MM-DD)")
    date_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    
    vendor: Optional[str] = Field(default=None, description="Vendor or seller name")
    vendor_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    
    total: Optional[float] = Field(default=None, description="Total invoice amount")
    total_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    
    tax: Optional[float] = Field(default=None, description="Tax amount")
    tax_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    
    currency: Optional[str] = Field(default=None, description="Currency code (e.g. USD, EUR)")
    currency_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    
    line_items: List[InvoiceLineItem] = Field(default_factory=list, description="List of line items on the invoice")
    line_items_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    
    @field_validator("date")
    @classmethod
    def validate_date_format(cls, v: Optional[str]) -> Optional[str]:
        """Validate and normalize date format to ISO (YYYY-MM-DD)."""
        return validate_date(v)
