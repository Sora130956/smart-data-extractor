"""Tests for extraction.confidence_fusion (D-046): merging the LLM's
self-reported field confidence with the hand_write OCR line confidence.
Pure functions, no I/O."""

import pytest

from smart_data_extractor.extraction.confidence_fusion import fuse_confidence

def _block(text, box):
    return {"text": text, "box": box}


def _line(text, box, min_prob, page=0):
    return {"page": page, "text": text, "box": box, "min_prob": min_prob}


def _fuse(data, pages_blocks, ocr_lines):
    return fuse_confidence(data, pages_blocks, ocr_lines)


def test_ocr_confidence_lower_than_llm_wins():
    data = {"phone": "555-0100", "phone_confidence": 0.95}
    blocks = [[_block("Tel: 555-0100", [10, 10, 60, 20])]]
    lines = [_line("Tel: 555-0100", [10, 10, 60, 20], 0.65)]

    fused, signals = _fuse(data, blocks, lines)

    assert fused["phone_confidence"] == pytest.approx(0.65)
    assert signals["phone"] == {
        "ocr_confidence": pytest.approx(0.65),
        "ocr_signal": True,
    }


def test_llm_confidence_lower_than_ocr_is_kept():
    data = {"name": "Alice", "name_confidence": 0.5}
    blocks = [[_block("Alice", [10, 10, 30, 20])]]
    lines = [_line("Alice", [10, 10, 30, 20], 0.99)]

    fused, _ = _fuse(data, blocks, lines)

    assert fused["name_confidence"] == pytest.approx(0.5)


def test_text_disagreement_is_not_penalized():
    """OCR only contributes its confidence number: a line whose text differs
    from the value ("ichael Turne") still yields final = min(llm, ocr)."""
    data = {"name": "Michael Turner", "name_confidence": 0.95}
    blocks = [[_block("Michael Turner", [10, 10, 50, 20])]]
    lines = [_line("ichael Turne", [10, 10, 50, 20], 0.93)]

    fused, signals = _fuse(data, blocks, lines)

    assert fused["name_confidence"] == pytest.approx(0.93)
    assert signals["name"] == {
        "ocr_confidence": pytest.approx(0.93),
        "ocr_signal": True,
    }


def test_value_split_across_lines_takes_min():
    """The interface splits "Northwind Automation Systems" / "Inc." into
    two lines: both overlap the glm block, the weakest one counts."""
    value = "Northwind Automation Systems Inc."
    data = {"company": value, "company_confidence": 0.97}
    blocks = [[_block(value, [10, 10, 70, 30])]]
    lines = [
        _line("Northwind Automation Systems", [10, 10, 70, 18], 0.95),
        _line("Inc.", [10, 22, 25, 30], 0.80),
    ]

    fused, signals = _fuse(data, blocks, lines)

    assert fused["company_confidence"] == pytest.approx(0.80)
    assert signals["company"]["ocr_confidence"] == pytest.approx(0.80)


def test_unrelated_lines_in_a_big_block_do_not_drag_confidence_down():
    data = {"name": "Michael Turner", "name_confidence": 0.99}
    blocks = [[_block("Michael Turner\nTel 555", [10, 10, 60, 40])]]
    lines = [
        _line("Michael Turner", [10, 10, 60, 20], 0.95),
        _line("Tel 555", [10, 30, 40, 40], 0.40),
    ]

    fused, signals = _fuse(data, blocks, lines)

    assert fused["name_confidence"] == pytest.approx(0.95)
    assert signals["name"]["ocr_confidence"] == pytest.approx(0.95)


def test_punctuation_and_symbol_differences_still_pick_the_line():
    """The interface often drops or splits currency signs and separators
    ("¥" / ","); the line must still be picked as the value's line, so its
    low confidence is not skipped."""
    data = {"total": "¥1,234.00", "total_confidence": 0.99}
    blocks = [[_block("Total ¥1,234.00\nTel 555", [10, 10, 60, 40])]]
    lines = [
        _line("1,234.00", [30, 10, 60, 20], 0.80),
        _line("Tel 555", [10, 30, 40, 40], 0.40),
    ]

    fused, _ = _fuse(data, blocks, lines)

    assert fused["total_confidence"] == pytest.approx(0.80)


def test_overlapping_lines_with_no_textual_relation_use_their_min_without_penalty():
    data = {"name": "Michael Turner", "name_confidence": 0.95}
    blocks = [[_block("Michael Turner", [10, 10, 50, 20])]]
    lines = [_line("xyz 123", [10, 10, 50, 20], 0.90)]

    fused, signals = _fuse(data, blocks, lines)

    assert fused["name_confidence"] == pytest.approx(0.90)
    assert signals["name"] == {
        "ocr_confidence": pytest.approx(0.90),
        "ocr_signal": True,
    }


def test_lines_on_another_page_are_ignored():
    data = {"name": "Alice", "name_confidence": 0.9}
    blocks = [[_block("Alice", [10, 10, 30, 20])], None]
    lines = [_line("Alice", [10, 10, 30, 20], 0.3, page=1)]

    fused, signals = _fuse(data, blocks, lines)

    assert fused["name_confidence"] == pytest.approx(0.9)
    assert signals["name"] == {"ocr_signal": False}


def test_field_without_overlapping_line_falls_back_to_llm_only():
    data = {"name": "Alice", "name_confidence": 0.9}
    blocks = [[_block("Alice", [10, 10, 30, 20])]]
    lines = [_line("Bob", [60, 60, 90, 70], 0.2)]

    fused, signals = _fuse(data, blocks, lines)

    assert fused["name_confidence"] == pytest.approx(0.9)
    assert signals["name"] == {"ocr_signal": False}


def test_value_not_found_in_glm_blocks_falls_back_to_llm_only():
    """E.g. the LLM normalized a date; there is no location to look up."""
    data = {"date": "2024-03-05", "date_confidence": 0.9}
    blocks = [[_block("March 5, 2024", [10, 10, 40, 20])]]
    lines = [_line("March 5, 2024", [10, 10, 40, 20], 0.2)]

    fused, signals = _fuse(data, blocks, lines)

    assert fused["date_confidence"] == pytest.approx(0.9)
    assert signals["date"] == {"ocr_signal": False}


def test_empty_ocr_lines_degrades_to_llm_only():
    data = {"name": "Alice", "name_confidence": 0.9}
    blocks = [[_block("Alice", [10, 10, 30, 20])]]

    fused, signals = _fuse(data, blocks, [])

    assert fused == data
    assert signals["name"] == {"ocr_signal": False}


def test_null_values_and_unpaired_fields_are_left_alone():
    data = {"name": None, "name_confidence": 0.0, "note": "hi"}
    blocks = [[_block("hi", [10, 10, 30, 20])]]
    lines = [_line("hi", [10, 10, 30, 20], 0.1)]

    fused, signals = _fuse(data, blocks, lines)

    assert fused == data
    assert signals == {}


def test_numeric_values_are_matched_by_their_text():
    data = {"total": 1234, "total_confidence": 0.99}
    blocks = [[_block("Total 1234", [10, 10, 40, 20])]]
    lines = [_line("Total 1234", [10, 10, 40, 20], 0.7)]

    fused, _ = _fuse(data, blocks, lines)

    assert fused["total_confidence"] == pytest.approx(0.7)


def test_input_data_is_not_mutated():
    data = {"name": "Alice", "name_confidence": 0.9}
    blocks = [[_block("Alice", [10, 10, 30, 20])]]
    lines = [_line("Alice", [10, 10, 30, 20], 0.1)]

    _fuse(data, blocks, lines)

    assert data == {"name": "Alice", "name_confidence": 0.9}
