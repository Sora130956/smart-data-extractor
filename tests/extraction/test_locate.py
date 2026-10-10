"""Tests for extraction.locate: grounding utilities + local field matching.

Issue #4 follow-up (D-028): OCR natively returns text blocks with
bounding boxes, and extracted field values are matched against those
blocks locally — no second vision call. Everything here is a pure
function: no network, no LLM, fully offline.
"""

import json

from smart_data_extractor.extraction.locate import (
    MAX_VALUES,
    _normalize,
    match_field_boxes,
    normalize_boxes,
    parse_box_payload,
)


# --- parse_box_payload (defensive JSON extraction) ---


def test_parse_box_payload_happy_path():
    raw = json.dumps({"boxes": [[10, 20, 30, 40], None]})
    assert parse_box_payload(raw, count=2) == [[10, 20, 30, 40], None]


def test_parse_box_payload_strips_code_fences():
    """VLMs love wrapping JSON in markdown fences; the parser must survive."""
    raw = '```json\n{"boxes": [[1, 2, 3, 4]]}\n```'
    assert parse_box_payload(raw, count=1) == [[1, 2, 3, 4]]


def test_parse_box_payload_junk_returns_all_none():
    """Unparseable output degrades to 'not found' instead of raising."""
    assert parse_box_payload("I could not find any boxes.", count=3) == [None, None, None]


def test_parse_box_payload_wrong_arity_is_aligned():
    """Too few entries pad with None; too many are truncated — order stays."""
    raw = json.dumps({"boxes": [[1, 2, 3, 4]]})
    assert parse_box_payload(raw, count=3) == [[1, 2, 3, 4], None, None]
    raw = json.dumps({"boxes": [[1, 2, 3, 4], [5, 6, 7, 8]]})
    assert parse_box_payload(raw, count=1) == [[1, 2, 3, 4]]


def test_parse_box_payload_invalid_entries_become_none():
    """Non-list, wrong-length, or non-numeric entries degrade to None."""
    raw = json.dumps({"boxes": ["nope", [1, 2, 3], [1, 2, 3, "four"], [1, 2, 3, 4]]})
    assert parse_box_payload(raw, count=4) == [None, None, None, [1, 2, 3, 4]]


def test_parse_box_payload_non_object_json_returns_none():
    assert parse_box_payload(json.dumps([1, 2, 3]), count=1) == [None]


# --- normalize_boxes (scale tolerance + validation) ---


def test_normalize_boxes_passthrough_when_already_0_100():
    boxes = [[10, 20, 30, 40], None, [0, 0, 100, 100]]
    assert normalize_boxes(boxes) == [[10, 20, 30, 40], None, [0, 0, 100, 100]]


def test_normalize_boxes_rescales_0_1000_convention():
    """GLM-4.5V grounding natively emits 0-1000 relative coordinates; a
    response in that scale is divided down to percentages."""
    boxes = [[100, 200, 300, 400], None]
    assert normalize_boxes(boxes) == [[10, 20, 30, 40], None]


def test_normalize_boxes_rescales_pixel_like_coordinates():
    """Anything beyond 1000 is treated as pixel-ish and scaled by its max."""
    boxes = [[0, 0, 2000, 1000]]
    assert normalize_boxes(boxes) == [[0, 0, 100, 50]]


def test_normalize_boxes_swaps_inverted_corners_and_clamps():
    boxes = [[30, 40, 10, 20], [-5, -5, 105, 105]]
    assert normalize_boxes(boxes) == [[10, 20, 30, 40], [0, 0, 100, 100]]


def test_normalize_boxes_drops_degenerate_boxes():
    """Zero-area boxes are noise, not locations."""
    assert normalize_boxes([[10, 10, 10, 40]]) == [None]
    assert normalize_boxes([[10, 10, 40, 10]]) == [None]


# --- _normalize (comparison folding) ---


def test_normalize_folds_case_and_strips_whitespace():
    assert _normalize("  Invoice  Number ") == "invoicenumber"
    assert _normalize("ABC") == "abc"


def test_normalize_folds_fullwidth_ascii_and_ideographic_space():
    """Fullwidth ASCII (common in CJK OCR output) folds to halfwidth; the
    ideographic space U+3000 folds away like any other whitespace."""
    assert _normalize("ＩＮＶ－００１") == "inv-001"
    assert _normalize("合　计") == "合计"


def test_normalize_blank_is_empty():
    assert _normalize("") == ""
    assert _normalize("  \t\n ") == ""


# --- match_field_boxes (local grounding match, D-028) ---


def test_match_field_boxes_finds_exact_hit():
    pages = [
        [
            {"text": "Invoice Number", "box": [10, 10, 40, 15]},
            {"text": "INV-001", "box": [10, 20, 30, 25]},
        ]
    ]
    assert match_field_boxes("INV-001", pages) == {"page": 0, "box": [10, 20, 30, 25]}


def test_match_field_boxes_searches_later_pages():
    """pages_blocks is page-aligned (None/empty = page without blocks); the
    scan continues until the first hit."""
    pages = [None, [{"text": "Total", "box": [5, 5, 20, 10]}]]
    assert match_field_boxes("Total", pages) == {"page": 1, "box": [5, 5, 20, 10]}


def test_match_field_boxes_first_hit_wins():
    pages = [
        [{"text": "Total", "box": [1, 1, 2, 2]}],
        [{"text": "Total", "box": [3, 3, 4, 4]}],
    ]
    assert match_field_boxes("Total", pages) == {"page": 0, "box": [1, 1, 2, 2]}


def test_match_field_boxes_folds_case_spaces_and_fullwidth():
    pages = [[{"text": "  ＡＢＣ－１２３ ", "box": [1, 2, 3, 4]}]]
    assert match_field_boxes("abc-123", pages) == {"page": 0, "box": [1, 2, 3, 4]}


def test_match_field_boxes_is_exact_not_substring():
    """D-028 decision: normalized exact match only — a value inside a
    longer block does not hit (no substring or fuzzy matching)."""
    pages = [[{"text": "Invoice Number: INV-001", "box": [1, 2, 3, 4]}]]
    assert match_field_boxes("INV-001", pages) is None


def test_match_field_boxes_missing_value_returns_none():
    pages = [[{"text": "something", "box": [1, 2, 3, 4]}]]
    assert match_field_boxes("Total", pages) is None


def test_match_field_boxes_blank_value_returns_none():
    pages = [[{"text": "x", "box": [1, 2, 3, 4]}]]
    assert match_field_boxes("", pages) is None
    assert match_field_boxes("   ", pages) is None


def test_match_field_boxes_skips_blocks_without_usable_box():
    pages = [[{"text": "Total", "box": None}, {"text": "Total", "box": [5, 6, 7, 8]}]]
    assert match_field_boxes("Total", pages) == {"page": 0, "box": [5, 6, 7, 8]}


def test_match_field_boxes_no_blocks_at_all_returns_none():
    assert match_field_boxes("v", [None, None]) is None
    assert match_field_boxes("v", []) is None


def test_max_values_cap_is_small():
    """Convention cap: one grounding match request stays bounded (schemas
    are small; kept from D-027 as the shared upper bound)."""
    assert MAX_VALUES == 20
