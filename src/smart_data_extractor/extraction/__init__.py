"""Core extraction logic."""

from smart_data_extractor.extraction.batch import batch_extract
from smart_data_extractor.extraction.extractor import extract_data

__all__ = ["batch_extract", "extract_data"]
