"""Fuse the LLM's self-reported field confidence with OCR line confidence
(D-046).

The second-stage extraction LLM only sees OCR *text*, so its
``<field>_confidence`` cannot reflect a blurry source image. The
hand_write OCR interface (see ocr.py) returns per-line ``min_prob`` plus
the line's position; this module merges the two signals per field:

    final = min(llm_confidence, ocr_confidence)

OCR contributes only its confidence number; no text-consistency check or
penalty is applied.

- Locate the field value in the glm-ocr grounding blocks
  (``match_field_boxes``); lines on the same page that mostly sit inside
  that block are candidates.
- Lines whose text is a substring of the value (or vice versa) are the
  "relevant" lines; ocr_confidence is the weakest of them (all candidate
  lines if none is textually related). The interface splits text at a
  different granularity than glm-ocr ("Inc." can be its own line), so
  several lines may back one value.
- No overlapping line (value not located, page unmatched, no OCR lines):
  the LLM score is kept and the signal marks ``ocr_signal: False``.

Pure functions, no I/O. The overlap threshold is an uncalibrated initial
value.
"""

from typing import Any

from smart_data_extractor.extraction.locate import _normalize, match_field_boxes

# A line belongs to a block when at least this share of the line's area
# lies inside the block's box.
_MIN_LINE_OVERLAP = 0.5

_CONFIDENCE_SUFFIX = "_confidence"


def _overlap_ratio(line_box: list[float], block_box: list[float]) -> float:
    """Share of the line box's area that lies inside the block box."""
    lx1, ly1, lx2, ly2 = line_box
    bx1, by1, bx2, by2 = block_box
    width = min(lx2, bx2) - max(lx1, bx1)
    height = min(ly2, by2) - max(ly1, by1)
    line_area = (lx2 - lx1) * (ly2 - ly1)
    if width <= 0 or height <= 0 or line_area <= 0:
        return 0.0
    return (width * height) / line_area


def _value_text(value: Any) -> str | None:
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        return None
    return str(value)


def _comparable(text: str) -> str:
    """Letters and digits only. The interface routinely drops or re-splits
    currency signs, separators and prefixes ("¥", ",", "-", "+86") that the
    LLM kept; those must not stop a line from being matched to the value."""
    return "".join(ch for ch in _normalize(text) if ch.isalnum())


def _field_signal(
    value: Any,
    pages_blocks: list[list[dict[str, Any]] | None],
    ocr_lines: list[dict[str, Any]],
) -> float | None:
    """OCR confidence for one value, or None = no signal."""
    text = _value_text(value)
    if text is None:
        return None
    needle = _comparable(text)
    if not needle:
        return None
    hit = match_field_boxes(text, pages_blocks)
    if hit is None:
        return None
    page, block_box = hit["page"], hit["box"]
    overlapping = [
        line
        for line in ocr_lines
        if line.get("page") == page
        and isinstance(line.get("box"), list)
        and len(line["box"]) == 4
        and _overlap_ratio(line["box"], block_box) >= _MIN_LINE_OVERLAP
    ]
    if not overlapping:
        return None

    relevant = []
    for line in overlapping:
        line_text = _comparable(line.get("text") or "")
        if line_text and (line_text in needle or needle in line_text):
            relevant.append(line)

    # No textually related line: fall back to every line sitting there.
    return min(line["min_prob"] for line in (relevant or overlapping))


def fuse_confidence(
    data: dict[str, Any],
    pages_blocks: list[list[dict[str, Any]] | None],
    ocr_lines: list[dict[str, Any]],
) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    """Return (data with fused ``<field>_confidence``, per-field signals).

    ``data`` is not mutated. Null values and fields without a paired
    ``_confidence`` are untouched and get no signal entry.
    """
    fused = dict(data)
    signals: dict[str, dict[str, Any]] = {}
    for name, value in data.items():
        if name.endswith(_CONFIDENCE_SUFFIX) or value is None:
            continue
        twin = f"{name}{_CONFIDENCE_SUFFIX}"
        llm_conf = data.get(twin)
        if isinstance(llm_conf, bool) or not isinstance(llm_conf, (int, float)):
            continue
        ocr_conf = _field_signal(value, pages_blocks, ocr_lines)
        if ocr_conf is None:
            signals[name] = {"ocr_signal": False}
            continue
        fused[twin] = max(0.0, min(1.0, min(llm_conf, ocr_conf)))
        signals[name] = {"ocr_confidence": ocr_conf, "ocr_signal": True}
    return fused, signals
