"""Invoice data model with line items."""

from typing import List, Optional

from pydantic import Field, field_validator

from smart_data_extractor.models.base import ConfidenceBase
from smart_data_extractor.validators import validate_date


class InvoiceLineItem(ConfidenceBase):
    """Single line item in an invoice."""
    
    description: Optional[str] = None
    description_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    
    quantity: Optional[float] = None
    quantity_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    
    unit_price: Optional[float] = None
    unit_price_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    
    amount: Optional[float] = None
    amount_confidence: float = Field(default=0.0, ge=0.0, le=1.0)


class Invoice(ConfidenceBase):
    """Invoice extracted from text.
    
    Each field has a corresponding confidence score in [0.0, 1.0].
    """
    
    invoice_number: Optional[str] = None
    invoice_number_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    
    date: Optional[str] = None
    date_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    
    vendor: Optional[str] = None
    vendor_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    
    total: Optional[float] = None
    total_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    
    tax: Optional[float] = None
    tax_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    
    currency: Optional[str] = None
    currency_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    
    line_items: List[InvoiceLineItem] = Field(default_factory=list)
    line_items_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    
    @field_validator("date")
    @classmethod
    def validate_date_format(cls, v: Optional[str]) -> Optional[str]:
        """Validate and normalize date format to ISO (YYYY-MM-DD)."""
        return validate_date(v)
