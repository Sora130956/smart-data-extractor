"""Data models for Smart Data Extractor.

Pure data models without business logic, with confidence scoring.
"""

from smart_data_extractor.models.base import ConfidenceBase
from smart_data_extractor.models.contact import Contact
from smart_data_extractor.models.dynamic import create_dynamic_model
from smart_data_extractor.models.invoice import Invoice, InvoiceLineItem
from smart_data_extractor.models.lead import Lead

__all__ = [
    "ConfidenceBase",
    "Contact",
    "Invoice",
    "InvoiceLineItem",
    "Lead",
    "create_dynamic_model",
]
