"""PDF / image -> Zhipu GLM-OCR layout parsing (D-031).

One Source = one Result: the whole file (PDF bytes or a single image)
is sent to Zhipu's dedicated ``glm-ocr`` model in ONE call
(``POST {glm_base_url}/layout_parsing``), which natively parses every
page and returns ``layout_details`` — page-grouped layout elements
with labels (text/table/formula/image) and bounding boxes. Despite the
docs calling bbox_2d 0-1 normalized, it can arrive as pixel coordinates;
``data_info.pages[].width/height`` (D-032) is used to rescale precisely
regardless of which convention the response actually used. Elements
labeled text/table become the grounding blocks the review pane matches
extracted values against locally (the D-028 flow, now fed by a
purpose-built parser instead of a prompted vision model).

pdf_to_images() is kept solely to render the preview images the
review pane overlays boxes on (D-027); it is decoupled from the OCR
call itself.

Per-page failures are tolerated: a page whose layout_details entry is
missing or empty is skipped (its index recorded in ``pages_failed``).
API-level failures (network error, non-2xx) raise — the whole call
failed and the caller surfaces an error.

Rate limiting (issue #13): layout_parsing answers 429 Too Many Requests
once concurrent calls exceed the account's allowance, which a burst
upload (the frontend fires one request per file) hits immediately. Two
guards in ``_post_with_retries``: a process-wide semaphore caps
in-flight calls (``GLM_OCR_MAX_CONCURRENCY``), and 429 answers are
retried with backoff (``GLM_OCR_MAX_RETRIES``, a numeric Retry-After
header wins over the exponential default).
"""

import asyncio
import base64
import logging
import re
from functools import lru_cache
from io import BytesIO
from typing import Any

import fitz
import httpx
from PIL import Image, ImageOps

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

# 429 retry/backoff (issue #13): 1s, 2s, 4s... unless Retry-After says more.
_RETRYABLE_STATUS_CODE = 429
_RETRY_BASE_DELAY_SECONDS = 1.0

# EXIF Orientation tag: 1 = upright, 2-8 = rotate/flip to display upright.
_EXIF_ORIENTATION_TAG = 274

# Upload media types (routes.SUPPORTED_IMAGE_MEDIA_TYPES) -> PIL save format.
_MEDIA_TYPE_TO_FORMAT = {
    "image/jpeg": "JPEG",
    "image/jpg": "JPEG",
    "image/png": "PNG",
    "image/bmp": "BMP",
}


def _normalize_image_orientation(image_bytes: bytes, media_type: str) -> bytes:
    """Physically apply the EXIF orientation to the pixels before OCR.

    Phone photos store portrait/landscape pixels plus an EXIF Orientation
    tag; browsers honor the tag when displaying (image-orientation:
    from-image) while glm-ocr grounds its bboxes on the raw stored pixels.
    A rotated-phone photo therefore produced highlight boxes placed as if
    the image were still unrotated. Transposing the pixels here (and
    dropping the tag by re-encoding without EXIF) makes GLM's coordinate
    frame equal the browser's display frame.

    Images with no orientation tag (or orientation=1) pass through as the
    exact original bytes — no re-encode, no quality loss. Undecodable
    bytes also pass through untouched, so the failure mode stays "GLM
    rejects the file", not a new error from us.
    """
    try:
        with Image.open(BytesIO(image_bytes)) as img:
            orientation = img.getexif().get(_EXIF_ORIENTATION_TAG)
            if orientation in (None, 1):
                return image_bytes
            transposed = ImageOps.exif_transpose(img)
            save_format = _MEDIA_TYPE_TO_FORMAT.get(media_type, img.format)
            if transposed is None or save_format is None:
                return image_bytes
            save_kwargs: dict[str, Any] = {}
            if save_format == "JPEG":
                save_kwargs["quality"] = 95
                if img.info.get("icc_profile"):
                    save_kwargs["icc_profile"] = img.info["icc_profile"]
            buf = BytesIO()
            transposed.save(buf, format=save_format, **save_kwargs)
            return buf.getvalue()
    except Exception:
        # Corrupt/unsupported image: hand the original bytes to GLM and let
        # its error surface (same failure mode as before this normalization).
        logger.debug("image orientation normalization skipped (undecodable bytes)")
        return image_bytes


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


async def _retry_sleep(seconds: float) -> None:
    """Backoff wait between 429 retries.

    An indirection seam (not ``asyncio.sleep`` directly) so tests can
    observe the waited delays without slowing the suite.
    """
    await asyncio.sleep(seconds)


@lru_cache(maxsize=1)
def _glm_ocr_semaphore() -> asyncio.Semaphore:
    """Process-wide cap on concurrent layout_parsing calls (issue #13).

    Sharing one semaphore across every parse_pdf/parse_image call keeps
    the backend within the account's concurrency allowance no matter how
    many files clients upload at once. Mirrors the agent-layer
    ``shared_concurrency_limiter`` pattern (D-006).
    """
    return asyncio.Semaphore(max(1, get_settings().glm_ocr_max_concurrency))


def _backoff_delay(response: httpx.Response, attempt: int) -> float:
    """Wait before the next 429 retry: a numeric Retry-After header wins,
    otherwise exponential backoff (1s, 2s, 4s, ...)."""
    retry_after = response.headers.get("Retry-After")
    if retry_after is not None:
        try:
            return max(0.0, float(retry_after))
        except ValueError:
            pass  # HTTP-date form: fall through to exponential backoff
    return _RETRY_BASE_DELAY_SECONDS * (2**attempt)


async def _post_with_retries(
    client: httpx.AsyncClient,
    url: str,
    payload: dict[str, Any],
    headers: dict[str, str],
) -> dict[str, Any]:
    """One layout_parsing POST, retried with backoff on 429 (issue #13).

    The semaphore is acquired per attempt, so a caller waiting out its
    backoff does not hold a concurrency slot another request could use.
    Exhausted retries (still 429) and all other non-2xx answers raise —
    an API-level failure fails the whole document (D-031 decision 7).
    """
    settings = get_settings()
    max_retries = max(0, settings.glm_ocr_max_retries)
    semaphore = _glm_ocr_semaphore()
    response: httpx.Response | None = None
    for attempt in range(max_retries + 1):
        async with semaphore:
            response = await client.post(url, json=payload, headers=headers)
        if response.status_code != _RETRYABLE_STATUS_CODE:
            break
        if attempt == max_retries:
            break  # retries exhausted: the raise below surfaces the 429
        delay = _backoff_delay(response, attempt)
        logger.warning(
            "glm-ocr layout_parsing rate limited (429), retry %d/%d in %.1fs",
            attempt + 1,
            max_retries,
            delay,
        )
        await _retry_sleep(delay)
    response.raise_for_status()
    return response.json()


async def _call_glm_ocr(
    file_bytes: bytes,
    *,
    media_type: str,
    http_client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    """POST the file to Zhipu's layout_parsing endpoint as a base64 data URI.

    The API rejects a bare base64 string (400) — ``file`` must be either
    a URL or a ``data:<mime>;base64,...`` data URI.

    ``http_client`` is an injection seam for tests (mock transport, no
    network). Raises on network errors and non-2xx responses (after 429
    retries, see ``_post_with_retries``) — an API-level failure fails
    the whole document (D-031 decision 7).
    """
    settings = get_settings()
    url = settings.glm_base_url.rstrip("/") + "/layout_parsing"
    encoded = base64.b64encode(file_bytes).decode("ascii")
    payload = {
        "model": settings.glm_model,
        "file": f"data:{media_type};base64,{encoded}",
    }
    headers = {"Authorization": f"Bearer {settings.glm_api_key}"}

    if http_client is None:
        async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SECONDS) as client:
            return await _post_with_retries(client, url, payload, headers)
    return await _post_with_retries(http_client, url, payload, headers)


def _extract_text_blocks(
    page_details: Any,
    *,
    width: float | None = None,
    height: float | None = None,
) -> list[dict[str, Any]]:
    """One page's layout elements -> grounding blocks.

    Keeps text/table elements, strips HTML tags from table content
    (D-031 decisions 8-9), and rescales bbox_2d to the 0-100 convention
    shared with the review pane (normalize_boxes). ``width``/``height``,
    when known (data_info.pages[], D-032), make that rescale precise —
    glm-ocr can return pixel coordinates despite the docs calling bbox_2d
    0-1 normalized. Elements with a garbled box are dropped.
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
    normalized = normalize_boxes(boxes, width=width, height=height)
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
    response. Each page's true pixel width/height, when present in
    ``data_info.pages[]`` (D-032), is passed through to precisely rescale
    that page's bbox_2d coordinates.
    """
    layout_details = data.get("layout_details")
    layout_details = layout_details if isinstance(layout_details, list) else []
    data_info = data.get("data_info") if isinstance(data.get("data_info"), dict) else {}
    pages_info = data_info.get("pages")
    pages_info = pages_info if isinstance(pages_info, list) else []

    pages: list[str | None] = []
    pages_blocks: list[list[dict[str, Any]] | None] = []
    pages_failed: list[int] = []
    for index, page_details in enumerate(layout_details):
        page_info = pages_info[index] if index < len(pages_info) else {}
        page_info = page_info if isinstance(page_info, dict) else {}
        blocks = _extract_text_blocks(
            page_details, width=page_info.get("width"), height=page_info.get("height")
        )
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
    data = await _call_glm_ocr(
        pdf_bytes, media_type="application/pdf", http_client=http_client
    )
    return _build_result(data, pdf_to_images(pdf_bytes))


async def parse_image(
    image_bytes: bytes,
    *,
    media_type: str = "image/png",
    http_client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    """OCR a single image file into a single text blob via glm-ocr.

    The image bytes are sent as a ``media_type`` data URI in one call,
    after ``_normalize_image_orientation`` physically applies any EXIF
    orientation so the grounding bboxes share the browser's display
    frame (see that function for the misplacement bug this fixes).
    One image = one "page", so the result shape matches ``parse_pdf``;
    no preview images are returned (the frontend already holds the
    original image bytes).
    """
    image_bytes = _normalize_image_orientation(image_bytes, media_type)
    data = await _call_glm_ocr(image_bytes, media_type=media_type, http_client=http_client)
    return _build_result(data, None)


def calculate_glm_ocr_cost(usage: dict[str, Any]) -> float:
    """USD cost of one glm-ocr call: flat 0.2 CNY per 1M tokens (input
    and output the same price), converted via settings.usd_to_cny."""
    input_tokens = int(usage.get("prompt_tokens") or 0)
    output_tokens = int(usage.get("completion_tokens") or 0)
    cost_cny = (input_tokens + output_tokens) / 1_000_000 * _GLM_OCR_PRICE_CNY_PER_MTOK
    return cost_cny / get_settings().usd_to_cny
