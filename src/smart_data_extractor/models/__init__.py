"""Data models for Smart Data Extractor.

Pure data models without business logic, with confidence scoring.
"""

from smart_data_extractor.models.base import ConfidenceBase
from smart_data_extractor.models.dynamic import create_dynamic_model

__all__ = [
    "ConfidenceBase",
    "create_dynamic_model",
]
