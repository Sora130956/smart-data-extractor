"""Ground extracted field values in the original image (issue #4, D-027).

The review pane overlays highlight boxes directly on the original file
preview, so reviewers verify low-confidence fields against the source
image in place. Coordinates can only come from a vision model — the
extraction pipeline (PyMuPDF render -> GLM OCR -> plain text) carries no
position info anywhere, and the frontend cannot know where a value sits
in an image.

Design (vs. changing the OCR contract): a dedicated *locate* pass asks the
vision model WHERE each already-extracted value appears. This never
touches the OCR -> extraction path (no fidelity regression), and it works
precisely where text matching fails — low-confidence fields whose LLM
value drifted from the OCR text are exactly the ones needing review, and
the vision model can still find them visually.

Robustness against weak/quirky vision models:
- plain-text output (no tool calling) + defensive JSON extraction, so
  models without function-call support still work;
- coordinate-scale tolerance: GLM-4.5V grounding natively emits 0-1000
  relative coordinates while the prompt asks for 0-100 percentages — any
  response scale (0-100 / 0-1000 / pixel-like) is normalized to 0-100;
- inverted corners are swapped, out-of-range values clamped, degenerate
  zero-area boxes and unparseable entries degrade to "not found" (null).
"""

import json
import logging
import math
import re
from typing import Any

from pydantic_ai import Agent, BinaryContent
from pydantic_ai.settings import ModelSettings

from smart_data_extractor.extraction.ocr import (
    _resolve_model,
    calculate_glm_cost,
    pdf_to_images,
)

logger = logging.getLogger(__name__)

# One grounding call must stay sane: cap the values per request (the route
# enforces this) and the pages scanned for a whole-PDF search.
MAX_VALUES = 20
MAX_PDF_PAGES_SCANNED = 10


def build_locate_prompt(values: list[str]) -> str:
    """Numbered values + the exact JSON contract the parser expects."""
    numbered = "\n".join(f"{i + 1}. {v}" for i, v in enumerate(values))
    return (
        "You are given a document image and a numbered list of values that "
        "were extracted from it. Locate where each value appears in the image.\n"
        "Return ONLY a JSON object, no markdown fences, in the exact shape:\n"
        '{"boxes": [[x1, y1, x2, y2], null]}\n'
        "- One entry per numbered value, in the same order; use null when a "
        "value is not visible in the image.\n"
        "- [x1, y1, x2, y2] is the value's bounding box: top-left corner "
        "(x1, y1), bottom-right corner (x2, y2), as percentages of the image "
        "width and height, each number between 0 and 100.\n"
        f"Values:\n{numbered}"
    )


def build_locate_agent(*, model: Any) -> Agent:
    """Fresh locate agent: plain-text output (tool-call-free, see module
    docstring), deterministic."""
    return Agent(
        model,
        output_type=str,
        model_settings=ModelSettings(temperature=0),
    )


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
    entries) degrades to None rather than raising: a failed locate must
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


async def locate_in_image(
    image_bytes: bytes,
    values: list[str],
    *,
    media_type: str = "image/png",
    model: Any = None,
    model_ref: str | None = None,
) -> dict:
    """One grounding call over a single image. Boxes come back tagged
    page=None (images have no paging)."""
    model, model_ref = _resolve_model(model, model_ref)
    agent = build_locate_agent(model=model)
    result = await agent.run(
        [build_locate_prompt(values), BinaryContent(data=image_bytes, media_type=media_type)]
    )
    boxes = normalize_boxes(parse_box_payload(result.output, count=len(values)))
    cost_usd = calculate_glm_cost(result.usage, model_ref=model_ref) if model_ref else 0.0
    return {
        "boxes": [{"page": None, "box": b} if b is not None else None for b in boxes],
        "pages_scanned": 1,
        "tokens_used": {"input": result.usage.input_tokens, "output": result.usage.output_tokens},
        "cost_usd": cost_usd,
    }


async def locate_in_pdf(
    pdf_bytes: bytes,
    values: list[str],
    *,
    model: Any = None,
    model_ref: str | None = None,
) -> dict:
    """Whole-PDF search: render the pages, scan them one by one asking only
    for the values not found yet, stop early once everything is located.
    Found boxes carry their 0-based page index. A page whose call raises is
    skipped, not fatal."""
    model, model_ref = _resolve_model(model, model_ref)
    agent = build_locate_agent(model=model)
    images = pdf_to_images(pdf_bytes)[:MAX_PDF_PAGES_SCANNED]

    remaining = list(range(len(values)))
    found: dict[int, dict] = {}
    input_tokens = 0
    output_tokens = 0
    cost_usd = 0.0
    pages_scanned = 0

    for page_index, image_bytes in enumerate(images):
        if not remaining:
            break
        pages_scanned += 1
        try:
            result = await agent.run(
                [
                    build_locate_prompt([values[i] for i in remaining]),
                    BinaryContent(data=image_bytes, media_type="image/png"),
                ]
            )
        except Exception:
            logger.exception("grounding failed on page %d", page_index)
            continue
        page_boxes = normalize_boxes(parse_box_payload(result.output, count=len(remaining)))
        for local_index, box in zip(remaining, page_boxes):
            if box is not None:
                found[local_index] = {"page": page_index, "box": box}
        remaining = [i for i in remaining if i not in found]
        input_tokens += result.usage.input_tokens
        output_tokens += result.usage.output_tokens
        if model_ref is not None:
            cost_usd += calculate_glm_cost(result.usage, model_ref=model_ref)

    return {
        "boxes": [found.get(i) for i in range(len(values))],
        "pages_scanned": pages_scanned,
        "tokens_used": {"input": input_tokens, "output": output_tokens},
        "cost_usd": cost_usd,
    }


async def locate_fields(
    file_bytes: bytes,
    media_type: str,
    values: list[str],
    *,
    model: Any = None,
    model_ref: str | None = None,
) -> dict:
    """Dispatch by media type: images are grounded in place, PDFs get the
    page-by-page search."""
    if media_type == "application/pdf":
        return await locate_in_pdf(file_bytes, values, model=model, model_ref=model_ref)
    return await locate_in_image(
        file_bytes, values, media_type=media_type, model=model, model_ref=model_ref
    )
