"""Core extraction logic."""

from smart_data_extractor.extraction.batch import batch_extract
from smart_data_extractor.extraction.extractor import extract_data
from smart_data_extractor.extraction.ocr import parse_image, parse_pdf
from smart_data_extractor.extraction.schema_resolve import infer_schema, resolve_schema

__all__ = [
    "batch_extract",
    "extract_data",
    "infer_schema",
    "parse_image",
    "parse_pdf",
    "resolve_schema",
]
