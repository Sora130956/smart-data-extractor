"""PDF / image -> Zhipu GLM-OCR layout parsing (D-031).

One Source = one Result: the whole file (PDF bytes or a single image)
is sent to Zhipu's dedicated ``glm-ocr`` model in ONE call
(``POST {glm_base_url}/layout_parsing``), which natively parses every
page and returns ``layout_details`` — page-grouped layout elements
with labels (text/table/formula/image) and 0-1 normalized bounding
boxes. Elements labeled text/table become the grounding blocks the
review pane matches extracted values against locally (the D-028 flow,
now fed by a purpose-built parser instead of a prompted vision model).

pdf_to_images() is kept solely to render the preview images the
review pane overlays boxes on (D-027); it is decoupled from the OCR
call itself.

Per-page failures are tolerated: a page whose layout_details entry is
missing or empty is skipped (its index recorded in ``pages_failed``).
API-level failures (network error, non-2xx) raise — the whole call
failed and the caller surfaces an error.
"""

import base64
import logging
import re
from typing import Any

import fitz
import httpx

from smart_data_extractor.config import get_settings
from smart_data_extractor.extraction.locate import _is_valid_box, normalize_boxes

logger = logging.getLogger(__name__)

# glm-ocr pricing: 0.2 CNY per 1M tokens, input and output the same price.
_GLM_OCR_PRICE_CNY_PER_MTOK = 0.2

# Layout element labels whose content carries extractable text
# (image/formula elements are skipped for now, D-031 decision 8).
_TEXT_LABELS = frozenset({"text", "table"})

_HTML_TAG_RE = re.compile(r"<[^>]+>")

_REQUEST_TIMEOUT_SECONDS = 120.0


def pdf_to_images(pdf_bytes: bytes) -> list[bytes]:
    """Render each page of a PDF to a PNG image (preview only, D-031)."""
    images = []
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        for page in doc:
            pix = page.get_pixmap()
            images.append(pix.tobytes("png"))
    finally:
        doc.close()
    return images


async def _call_glm_ocr(
    file_bytes: bytes,
    *,
    http_client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    """POST the raw file (base64) to Zhipu's layout_parsing endpoint.

    ``http_client`` is an injection seam for tests (mock transport, no
    network). Raises on network errors and non-2xx responses — an
    API-level failure fails the whole document (D-031 decision 7).
    """
    settings = get_settings()
    url = settings.glm_base_url.rstrip("/") + "/layout_parsing"
    payload = {
        "model": settings.glm_model,
        "file": base64.b64encode(file_bytes).decode("ascii"),
    }
    headers = {"Authorization": f"Bearer {settings.glm_api_key}"}

    if http_client is None:
        async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SECONDS) as client:
            response = await client.post(url, json=payload, headers=headers)
    else:
        response = await http_client.post(url, json=payload, headers=headers)

    response.raise_for_status()
    return response.json()


def _extract_text_blocks(page_details: Any) -> list[dict[str, Any]]:
    """One page's layout elements -> grounding blocks.

    Keeps text/table elements, strips HTML tags from table content
    (D-031 decisions 8-9), and rescales bbox_2d's 0-1 normalized
    coordinates to the 0-100 convention shared with the review pane
    (normalize_boxes). Elements with a garbled box are dropped.
    """
    if not isinstance(page_details, list):
        return []
    texts: list[str] = []
    boxes: list[list[float] | None] = []
    for item in page_details:
        if not isinstance(item, dict) or item.get("label") not in _TEXT_LABELS:
            continue
        content = item.get("content")
        if not isinstance(content, str) or not content.strip():
            continue
        if item["label"] == "table":
            content = _HTML_TAG_RE.sub("", content)
        box = item.get("bbox_2d")
        boxes.append([float(c) for c in box] if _is_valid_box(box) else None)
        texts.append(content)
    normalized = normalize_boxes(boxes)
    return [
        {"text": text, "box": box}
        for text, box in zip(texts, normalized)
        if box is not None
    ]


def _build_result(data: dict[str, Any], images: list[bytes] | None) -> dict[str, Any]:
    """Assemble the shared parse result dict from a layout_parsing response.

    ``layout_details[i]`` maps 1:1 to ``pages[i]``/``pages_blocks[i]``
    (index = page number - 1): the frontend's per-page split relies on
    that alignment, so page count and order are taken verbatim from the
    response.
    """
    layout_details = data.get("layout_details")
    layout_details = layout_details if isinstance(layout_details, list) else []

    pages: list[str | None] = []
    pages_blocks: list[list[dict[str, Any]] | None] = []
    pages_failed: list[int] = []
    for index, page_details in enumerate(layout_details):
        blocks = _extract_text_blocks(page_details)
        if not blocks:
            pages.append(None)
            pages_blocks.append(None)
            pages_failed.append(index)
            continue
        pages.append("\n".join(block["text"] for block in blocks))
        pages_blocks.append(blocks)

    usage = data.get("usage") if isinstance(data.get("usage"), dict) else {}
    return {
        "text": "\n\n".join(t for t in pages if t is not None),
        "pages": pages,
        "pages_blocks": pages_blocks,
        "pages_failed": pages_failed,
        "pages_images": (
            [base64.b64encode(img).decode("ascii") for img in images]
            if images is not None
            else None
        ),
        "tokens_used": {
            "input": int(usage.get("prompt_tokens") or 0),
            "output": int(usage.get("completion_tokens") or 0),
        },
        "cost_usd": calculate_glm_ocr_cost(usage),
    }


async def parse_pdf(
    pdf_bytes: bytes,
    *,
    http_client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    """OCR an entire PDF into a single text blob via glm-ocr.

    The whole PDF is sent in one call (D-031 decision 4); the locally
    rendered per-page PNGs ride along in ``pages_images`` for the
    review-pane preview (D-027), aligned with ``pages``.
    """
    data = await _call_glm_ocr(pdf_bytes, http_client=http_client)
    return _build_result(data, pdf_to_images(pdf_bytes))


async def parse_image(
    image_bytes: bytes,
    *,
    media_type: str = "image/png",
    http_client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    """OCR a single image file into a single text blob via glm-ocr.

    The image bytes are sent as-is in one call (the endpoint sniffs the
    format; ``media_type`` is accepted for signature compatibility and
    unused). One image = one "page", so the result shape matches
    ``parse_pdf``; no preview images are returned (the frontend already
    holds the original image bytes).
    """
    data = await _call_glm_ocr(image_bytes, http_client=http_client)
    return _build_result(data, None)


def calculate_glm_ocr_cost(usage: dict[str, Any]) -> float:
    """USD cost of one glm-ocr call: flat 0.2 CNY per 1M tokens (input
    and output the same price), converted via settings.usd_to_cny."""
    input_tokens = int(usage.get("prompt_tokens") or 0)
    output_tokens = int(usage.get("completion_tokens") or 0)
    cost_cny = (input_tokens + output_tokens) / 1_000_000 * _GLM_OCR_PRICE_CNY_PER_MTOK
    return cost_cny / get_settings().usd_to_cny
