"""Grounding-block utilities + local field matching (issue #4, D-028).

The review pane overlays highlight boxes directly on the original file
preview. D-027 asked a *second* vision-model call where each extracted
value sits; D-028 replaces that with OCR-native grounding: the OCR pass
itself returns text blocks with bounding boxes (see ocr.py), and
extracted values are matched against those blocks locally — no extra
model call, no extra latency or cost, no "locating…" spinners.

What remains here:
- parse_box_payload / normalize_boxes (+ their helpers): defensive
  JSON-box parsing and scale-tolerant cleanup, shared with the OCR
  grounding parser. ocr.py imports them, so this module MUST stay
  dependency-free (no imports from ocr.py — that would be a cycle).
- match_field_boxes: the local exact-match lookup that turns
  "value -> where is it" into {"page", "box"} without any LLM. It is
  the semantic reference implementation; the frontend's TS port must
  behave identically (normalized exact match, first hit wins).

Robustness against weak/quirky vision models (unchanged in spirit from
D-027): coordinate-scale tolerance — GLM-4.5V grounding natively emits
0-1000 relative coordinates while the prompt asks for 0-100 percentages,
so any response scale (0-100 / 0-1000 / pixel-like) is normalized to
0-100; inverted corners are swapped, out-of-range values clamped,
degenerate zero-area boxes dropped.

Match policy (D-028 decision): normalize (whitespace removal, case
folding, fullwidth->halfwidth) then compare for exact equality — no
substring or fuzzy matching. A miss returns None; the caller simply
shows no box.
"""

import json
import math
import re
from typing import Any

# Convention cap kept from D-027: one grounding match request stays
# bounded (schemas are small; shared upper bound for callers).
MAX_VALUES = 20


def _extract_json_object(raw: str) -> Any:
    """Parse `raw` as JSON, tolerating markdown-fenced or prose-embedded
    objects; returns None when nothing JSON-shaped is found."""
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z0-9]*\s*|\s*```$", "", text).strip()
    try:
        return json.loads(text)
    except (json.JSONDecodeError, ValueError):
        pass
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match is None:
        return None
    try:
        return json.loads(match.group(0))
    except (json.JSONDecodeError, ValueError):
        return None


def _is_valid_box(entry: Any) -> bool:
    return (
        isinstance(entry, list)
        and len(entry) == 4
        and all(isinstance(c, (int, float)) and not isinstance(c, bool) and math.isfinite(c) for c in entry)
    )


def parse_box_payload(raw: str, *, count: int) -> list[list[float] | None]:
    """Model output -> order-aligned per-value boxes (None = not found).

    Any surprise (unparseable text, wrong shape, wrong arity, invalid
    entries) degrades to None rather than raising: a failed parse must
    never break the review pane.
    """
    parsed = _extract_json_object(raw)
    boxes = parsed.get("boxes") if isinstance(parsed, dict) else None
    if not isinstance(boxes, list):
        return [None] * count
    out: list[list[float] | None] = []
    for i in range(count):
        entry = boxes[i] if i < len(boxes) else None
        out.append([float(c) for c in entry] if _is_valid_box(entry) else None)
    return out


def normalize_boxes(boxes: list[list[float] | None]) -> list[list[float] | None]:
    """Scale-tolerant cleanup: detect the response's coordinate scale from
    the largest coordinate (0-100 percentages / 0-1000 GLM grounding /
    pixel-like), normalize to 0-100, swap inverted corners, clamp, and drop
    degenerate zero-area boxes."""
    valid_max = max((max(b) for b in boxes if b is not None), default=None)
    if valid_max is None:
        return boxes
    if valid_max <= 150:
        # 0-100 percentages, tolerating modest overshoot slop (e.g. a 105).
        scale = 1.0
    elif valid_max <= 1000:
        # GLM-4.5V grounding natively emits 0-1000 relative coordinates.
        scale = 10.0
    else:
        # Pixel-like: normalize by the largest coordinate seen.
        scale = valid_max / 100.0

    out: list[list[float] | None] = []
    for b in boxes:
        if b is None:
            out.append(None)
            continue
        x1, y1, x2, y2 = (c / scale for c in b)
        if x2 < x1:
            x1, x2 = x2, x1
        if y2 < y1:
            y1, y2 = y2, y1
        x1, y1 = min(max(x1, 0.0), 100.0), min(max(y1, 0.0), 100.0)
        x2, y2 = min(max(x2, 0.0), 100.0), min(max(y2, 0.0), 100.0)
        if x2 <= x1 or y2 <= y1:
            out.append(None)
            continue
        out.append([round(x1, 2), round(y1, 2), round(x2, 2), round(y2, 2)])
    return out


def _normalize(s: str) -> str:
    """Comparison key: drop all whitespace (including the ideographic
    space U+3000), fold case, and fold fullwidth ASCII (common in CJK
    OCR output) to halfwidth."""
    out = []
    for ch in s:
        code = ord(ch)
        if 0xFF01 <= code <= 0xFF5E:  # fullwidth !..~ block
            ch = chr(code - 0xFEE0)
        out.append(ch)
    return re.sub(r"\s+", "", "".join(out)).lower()


def match_field_boxes(
    value: str,
    pages_blocks: list[list[dict[str, Any]] | None],
) -> dict[str, Any] | None:
    """Locate `value` in the OCR grounding blocks, locally.

    Exact match after normalization (whitespace removal / case fold /
    fullwidth fold) — no substring or fuzzy matching (D-028 decision).
    Returns {"page": <0-based index>, "box": [x1, y1, x2, y2]} for the
    first hit in page order, else None.
    """
    needle = _normalize(value)
    if not needle:
        return None
    for page_index, blocks in enumerate(pages_blocks):
        if not blocks:
            continue
        for block in blocks:
            text = block.get("text")
            if not isinstance(text, str) or _normalize(text) != needle:
                continue
            box = block.get("box")
            if isinstance(box, list) and len(box) == 4:
                return {"page": page_index, "box": box}
    return None
