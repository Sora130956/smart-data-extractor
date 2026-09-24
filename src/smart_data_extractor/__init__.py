"""Smart Data Extractor: LLM-powered structured data extraction."""

from smart_data_extractor.extraction import batch_extract, extract_data
from smart_data_extractor.presets import PRESETS

__all__ = ["PRESETS", "batch_extract", "extract_data"]
