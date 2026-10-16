"""Tests for extraction.ocr: PDF/image -> Zhipu glm-ocr layout parsing
(D-031). Offline: httpx.MockTransport, never a real network call."""

import asyncio
import base64
import json
from io import BytesIO

import fitz
import httpx
import pytest
from PIL import Image

import smart_data_extractor.extraction.ocr as ocr_module
from smart_data_extractor.config import get_settings
from smart_data_extractor.extraction.ocr import (
    _extract_text_blocks,
    calculate_glm_ocr_cost,
    parse_image,
    parse_pdf,
    pdf_to_images,
)


def _make_pdf_bytes(num_pages: int) -> bytes:
    """Build a tiny real PDF (via PyMuPDF) with the given number of pages."""
    doc = fitz.open()
    for _ in range(num_pages):
        page = doc.new_page()
        page.insert_text((72, 72), "Hello OCR")
    data = doc.tobytes()
    doc.close()
    return data


def _element(label: str, content: str, bbox: list[float]) -> dict:
    """One glm-ocr layout_details element."""
    return {
        "index": 0,
        "label": label,
        "bbox_2d": bbox,
        "content": content,
        "height": 800,
        "width": 600,
    }


def _glm_ocr_payload(
    pages_layout: list, *, prompt_tokens=100, completion_tokens=50, pages_dims=None
) -> dict:
    """A glm-ocr layout_parsing response shaped like the official docs.

    ``pages_dims``, when given, is a list of ``(width, height)`` tuples
    filling ``data_info.pages[]`` (D-032: the true pixel dimensions used
    to precisely rescale pixel bbox_2d coordinates).
    """
    pages_info = (
        [{"width": w, "height": h} for w, h in pages_dims] if pages_dims else []
    )
    return {
        "id": "resp-1",
        "created": 1_700_000_000,
        "model": "glm-ocr",
        "md_results": ["# page"] * len(pages_layout),
        "layout_details": pages_layout,
        "data_info": {"num_pages": len(pages_layout), "pages": pages_info},
        "usage": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens,
        },
        "request_id": "req-1",
    }


def _mock_client(payload, *, status_code=200, captured=None):
    """An httpx.AsyncClient on a mock transport (injection seam for tests)."""

    def transport(request: httpx.Request) -> httpx.Response:
        if captured is not None:
            captured["request"] = request
        return httpx.Response(status_code, json=payload)

    return httpx.AsyncClient(transport=httpx.MockTransport(transport))


# --- pdf_to_images ---


def test_pdf_to_images_returns_one_png_per_page():
    """Each PDF page renders to exactly one PNG image (preview only, D-031)."""
    images = pdf_to_images(_make_pdf_bytes(2))
    assert len(images) == 2
    for img in images:
        assert isinstance(img, bytes)
        assert img.startswith(b"\x89PNG")


def test_pdf_to_images_single_page():
    """A one-page PDF yields a single image."""
    images = pdf_to_images(_make_pdf_bytes(1))
    assert len(images) == 1


# --- _extract_text_blocks (D-031: layout element filtering) ---


def test_extract_text_blocks_keeps_text_and_table_drops_other_labels():
    """Only text/table elements carry extractable content; image/formula
    elements are filtered out (D-031 decision 8)."""
    page = [
        _element("text", "Invoice Number", [0.1, 0.1, 0.4, 0.2]),
        _element("image", "(a photo)", [0.5, 0.5, 0.6, 0.6]),
        _element("formula", "E=mc^2", [0.1, 0.3, 0.2, 0.4]),
        _element("table", "<td>100</td>", [0.1, 0.5, 0.8, 0.7]),
    ]
    blocks = _extract_text_blocks(page)
    assert [b["text"] for b in blocks] == ["Invoice Number", "100"]


def test_extract_text_blocks_strips_html_from_table_content():
    """Table content arrives as HTML; tags are stripped (D-031 decision 9)."""
    page = [_element("table", "<table><tr><td>Qty: 3</td><td>Price: 9</td></tr></table>", [0, 0, 1, 1])]
    blocks = _extract_text_blocks(page)
    assert blocks == [{"text": "Qty: 3Price: 9", "box": [0.0, 0.0, 100.0, 100.0]}]


def test_extract_text_blocks_rescales_0_1_bboxes_to_0_100():
    """glm-ocr bbox_2d is 0-1 normalized; blocks carry 0-100 percentages."""
    blocks = _extract_text_blocks([_element("text", "v", [0.1, 0.2, 0.5, 0.7])])
    assert blocks == [{"text": "v", "box": [10.0, 20.0, 50.0, 70.0]}]


def test_extract_text_blocks_tolerates_non_list_input():
    """A missing/garbled page entry degrades to no blocks, not a crash."""
    assert _extract_text_blocks(None) == []
    assert _extract_text_blocks("garbage") == []


def test_extract_text_blocks_uses_real_width_height_for_pixel_bboxes():
    """Pixel bbox_2d + the page's real width/height (D-032) normalize
    precisely per axis — fixes the highlight-box-too-high-up bug on
    non-square pages, where a single guessed scale skews one axis."""
    page = [_element("text", "v", [100, 20, 400, 180])]
    blocks = _extract_text_blocks(page, width=500, height=200)
    assert blocks == [{"text": "v", "box": [20.0, 10.0, 80.0, 90.0]}]


# --- parse_pdf ---


async def test_parse_pdf_happy_path_multi_page(fake_openai_env):
    """Whole-PDF single call: pages/pages_blocks/pages_images stay aligned
    (the frontend's per-page split depends on it, see design doc)."""
    pdf_bytes = _make_pdf_bytes(2)
    payload = _glm_ocr_payload(
        [
            [_element("text", "Page one text", [0.1, 0.1, 0.9, 0.2])],
            [
                _element("text", "Page two line", [0.1, 0.3, 0.9, 0.4]),
                _element("table", "<td>Total 42</td>", [0.1, 0.5, 0.9, 0.7]),
            ],
        ],
        prompt_tokens=10_000,
        completion_tokens=5_000,
    )

    result = await parse_pdf(pdf_bytes, http_client=_mock_client(payload))

    assert result["text"] == "Page one text\n\nPage two line\nTotal 42"
    assert result["pages"] == ["Page one text", "Page two line\nTotal 42"]
    assert result["pages_blocks"] == [
        [{"text": "Page one text", "box": [10.0, 10.0, 90.0, 20.0]}],
        [
            {"text": "Page two line", "box": [10.0, 30.0, 90.0, 40.0]},
            {"text": "Total 42", "box": [10.0, 50.0, 90.0, 70.0]},
        ],
    ]
    assert result["pages_failed"] == []
    # Preview images stay aligned with pages and decode to PNGs.
    assert len(result["pages_images"]) == 2
    assert base64.b64decode(result["pages_images"][0]).startswith(b"\x89PNG")
    assert result["tokens_used"] == {"input": 10_000, "output": 5_000}
    assert result["cost_usd"] == pytest.approx(calculate_glm_ocr_cost(payload["usage"]))


async def test_parse_pdf_rescales_pixel_bboxes_using_data_info_page_dimensions(
    monkeypatch, fake_openai_env
):
    """glm-ocr can return pixel bbox_2d despite the docs calling it 0-1
    normalized; data_info.pages[].width/height (D-032) is the reliable
    source for precise per-axis rescaling, fixing the real-world bug
    where a single guessed scale skewed the box on a non-square page."""
    monkeypatch.setattr(ocr_module, "pdf_to_images", lambda b: [b"i1"])
    payload = _glm_ocr_payload(
        [[_element("text", "v", [100, 20, 400, 180])]],
        pages_dims=[(500, 200)],
    )

    result = await parse_pdf(b"fake-pdf-bytes", http_client=_mock_client(payload))

    assert result["pages_blocks"] == [[{"text": "v", "box": [20.0, 10.0, 80.0, 90.0]}]]


async def test_parse_pdf_request_shape_follows_config(monkeypatch, fake_openai_env):
    """The call hits {glm_base_url}/layout_parsing with the configured model,
    a base64 file payload and the Bearer api key (D-031 decisions 6/12/13)."""
    monkeypatch.setenv("GLM_API_KEY", "test-glm-key")
    monkeypatch.setenv("GLM_MODEL", "glm-ocr")
    get_settings.cache_clear()
    monkeypatch.setattr(ocr_module, "pdf_to_images", lambda b: [b"i1"])
    captured: dict = {}
    payload = _glm_ocr_payload([[_element("text", "OCR TEXT", [0.1, 0.1, 0.5, 0.2])]])

    await parse_pdf(b"fake-pdf-bytes", http_client=_mock_client(payload, captured=captured))

    request = captured["request"]
    assert str(request.url) == get_settings().glm_base_url.rstrip("/") + "/layout_parsing"
    assert request.headers["Authorization"] == "Bearer test-glm-key"
    body = json.loads(request.content)
    assert body["model"] == "glm-ocr"
    assert body["file"] == f"data:application/pdf;base64,{base64.b64encode(b'fake-pdf-bytes').decode('ascii')}"
    assert set(body) == {"model", "file"}  # only the required params


async def test_parse_pdf_marks_pages_with_missing_layout_as_failed(monkeypatch, fake_openai_env):
    """A successful call with a missing/empty page entry skips that page
    (pages_failed), the rest of the document survives (D-031 decision 7)."""
    monkeypatch.setattr(ocr_module, "pdf_to_images", lambda b: [b"i1", b"i2", b"i3"])
    payload = _glm_ocr_payload(
        [None, [], [_element("text", "third page", [0.1, 0.1, 0.5, 0.2])]]
    )
    result = await parse_pdf(b"fake-pdf-bytes", http_client=_mock_client(payload))

    assert result["pages"] == [None, None, "third page"]
    assert result["pages_blocks"] == [None, None, [{"text": "third page", "box": [10.0, 10.0, 50.0, 20.0]}]]
    assert result["pages_failed"] == [0, 1]
    assert result["text"] == "third page"
    # The single call still succeeded: usage and cost are reported.
    assert result["tokens_used"] == {"input": 100, "output": 50}
    assert result["cost_usd"] > 0.0


async def test_parse_pdf_all_pages_empty_returns_empty_text(monkeypatch, fake_openai_env):
    monkeypatch.setattr(ocr_module, "pdf_to_images", lambda b: [b"i1", b"i2"])
    payload = _glm_ocr_payload([[], []])

    result = await parse_pdf(b"fake-pdf-bytes", http_client=_mock_client(payload))

    assert result["text"] == ""
    assert result["pages"] == [None, None]
    assert result["pages_failed"] == [0, 1]


async def test_parse_pdf_raises_on_http_error_status(fake_openai_env):
    """An API-level failure (non-2xx) fails the whole document (decision 7)."""
    client = _mock_client({"error": {"message": "bad file"}}, status_code=400)
    with pytest.raises(httpx.HTTPStatusError):
        await parse_pdf(b"fake-pdf-bytes", http_client=client)


async def test_parse_pdf_raises_on_network_error(fake_openai_env):
    def transport(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no network")

    client = httpx.AsyncClient(transport=httpx.MockTransport(transport))
    with pytest.raises(httpx.ConnectError):
        await parse_pdf(b"fake-pdf-bytes", http_client=client)


async def test_parse_pdf_omitted_client_builds_default_settings_client(
    monkeypatch, fake_openai_env
):
    """Production default path: no http_client -> built from settings, and
    the request still follows config (URL/model/key)."""
    monkeypatch.setenv("GLM_API_KEY", "prod-key")
    get_settings.cache_clear()
    monkeypatch.setattr(ocr_module, "pdf_to_images", lambda b: [b"i1"])
    captured: dict = {}
    payload = _glm_ocr_payload([[_element("text", "OCR TEXT", [0.1, 0.1, 0.5, 0.2])]])
    client = _mock_client(payload, captured=captured)
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: client)

    result = await parse_pdf(b"fake-pdf-bytes")

    assert result["pages"] == ["OCR TEXT"]
    body = json.loads(captured["request"].content)
    assert body["model"] == "glm-ocr"


# --- parse_image ---


async def test_parse_image_ocrs_bytes_directly(fake_openai_env):
    """An image is sent as-is in one call: one source = one page, no PDF
    rendering, no preview images (the frontend holds the original)."""
    captured: dict = {}
    payload = _glm_ocr_payload([[_element("text", "IMG TEXT", [0.2, 0.2, 0.8, 0.8])]])

    result = await parse_image(b"jpeg-bytes", media_type="image/jpeg", http_client=_mock_client(payload, captured=captured))

    assert result["pages"] == ["IMG TEXT"]
    assert result["text"] == "IMG TEXT"
    assert result["pages_blocks"] == [[{"text": "IMG TEXT", "box": [20.0, 20.0, 80.0, 80.0]}]]
    assert result["pages_failed"] == []
    assert result["pages_images"] is None
    body = json.loads(captured["request"].content)
    assert body["file"] == f"data:image/jpeg;base64,{base64.b64encode(b'jpeg-bytes').decode('ascii')}"


# --- parse_image: EXIF orientation normalization (highlight-box misplacement) ---


def _image_bytes(
    format: str, width: int, height: int, orientation: int | None, color=(200, 30, 30)
) -> bytes:
    """A small real image carrying the given EXIF Orientation tag (274).

    ``orientation=None`` writes no EXIF at all; otherwise the tag is set to
    the given value (1 = upright, 8 = rotate 90° CCW to display, ...).
    """
    img = Image.new("RGB", (width, height), color=color)
    buf = BytesIO()
    save_kwargs = {}
    if orientation is not None:
        exif = Image.Exif()
        exif[274] = orientation
        save_kwargs["exif"] = exif
    img.save(buf, format=format, **save_kwargs)
    return buf.getvalue()


def _request_file_bytes(request: httpx.Request) -> bytes:
    """Decode the base64 payload of the captured layout_parsing request."""
    body = json.loads(request.content)
    header, b64 = body["file"].split(",", 1)
    assert header.startswith("data:")
    return base64.b64decode(b64)


async def test_parse_image_applies_exif_orientation_before_ocr(fake_openai_env):
    """A phone photo stores portrait pixels + EXIF Orientation (e.g. 8).
    Browsers display the EXIF-rotated view, but glm-ocr grounds boxes on
    the raw stored pixels — so the highlight box landed as if the image
    were still unrotated. The fix: physically transpose the pixels (and
    drop the orientation tag) before the call, so GLM's coordinate frame
    equals the browser's display frame."""
    captured: dict = {}
    payload = _glm_ocr_payload([[_element("text", "IMG", [0.2, 0.2, 0.8, 0.8])]])
    jpeg = _image_bytes("JPEG", 40, 20, orientation=8)

    await parse_image(
        jpeg, media_type="image/jpeg", http_client=_mock_client(payload, captured=captured)
    )

    sent = _request_file_bytes(captured["request"])
    with Image.open(BytesIO(sent)) as img:
        # Orientation 8 = rotate 90° CCW: 40x20 storage -> 20x40 pixels.
        assert img.size == (20, 40)
        # No orientation ambiguity left for any consumer downstream.
        assert img.getexif().get(274, 1) != 8


async def test_parse_image_passes_through_bytes_without_exif(fake_openai_env):
    """An image without EXIF needs no re-encode: the exact original bytes
    hit the wire (zero quality loss, zero CPU on the common path)."""
    captured: dict = {}
    payload = _glm_ocr_payload([[_element("text", "IMG", [0.2, 0.2, 0.8, 0.8])]])
    jpeg = _image_bytes("JPEG", 40, 20, orientation=None)

    await parse_image(
        jpeg, media_type="image/jpeg", http_client=_mock_client(payload, captured=captured)
    )

    assert _request_file_bytes(captured["request"]) == jpeg


async def test_parse_image_passes_through_explicit_orientation_1(fake_openai_env):
    """Orientation=1 (upright) is already unambiguous: pass through as-is."""
    captured: dict = {}
    payload = _glm_ocr_payload([[_element("text", "IMG", [0.2, 0.2, 0.8, 0.8])]])
    jpeg = _image_bytes("JPEG", 40, 20, orientation=1)

    await parse_image(
        jpeg, media_type="image/jpeg", http_client=_mock_client(payload, captured=captured)
    )

    assert _request_file_bytes(captured["request"]) == jpeg


async def test_parse_image_transposes_png_orientation_in_png_format(fake_openai_env):
    """The re-encode honors the upload's media type: a PNG (eXIf chunk)
    comes back as a transposed PNG, not silently converted to JPEG."""
    captured: dict = {}
    payload = _glm_ocr_payload([[_element("text", "IMG", [0.2, 0.2, 0.8, 0.8])]])
    png = _image_bytes("PNG", 40, 20, orientation=6)

    await parse_image(
        png, media_type="image/png", http_client=_mock_client(payload, captured=captured)
    )

    sent = _request_file_bytes(captured["request"])
    assert sent.startswith(b"\x89PNG")  # still a PNG
    with Image.open(BytesIO(sent)) as img:
        # Orientation 6 = rotate 90° CW: 40x20 storage -> 20x40 pixels.
        assert img.size == (20, 40)
        assert img.getexif().get(274, 1) != 6


# --- calculate_glm_ocr_cost ---


def test_calculate_glm_ocr_cost_zero_tokens(fake_openai_env):
    assert calculate_glm_ocr_cost({"prompt_tokens": 0, "completion_tokens": 0}) == 0.0


def test_calculate_glm_ocr_cost_flat_price_matches_zhipu_pricing(fake_openai_env):
    """glm-ocr: flat 0.2 CNY per 1M tokens (input == output price),
    converted to USD via settings.usd_to_cny."""
    usage = {"prompt_tokens": 10_000, "completion_tokens": 5_000}
    expected_cny = (10_000 + 5_000) / 1_000_000 * 0.2
    assert calculate_glm_ocr_cost(usage) == pytest.approx(expected_cny / 7.25)


def test_calculate_glm_ocr_cost_scales_with_tokens(fake_openai_env):
    small = {"prompt_tokens": 1_000, "completion_tokens": 500}
    large = {"prompt_tokens": 10_000, "completion_tokens": 5_000}
    assert calculate_glm_ocr_cost(large) > calculate_glm_ocr_cost(small)


def test_calculate_glm_ocr_cost_tolerates_missing_usage_fields(fake_openai_env):
    assert calculate_glm_ocr_cost({}) == 0.0


# --- 429 rate limiting: semaphore + retry with backoff (issue #13) ---


def _patch_sleep(monkeypatch) -> list[float]:
    """Stub ocr_module._retry_sleep into a recorder (no real waits)."""
    sleeps: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    monkeypatch.setattr(ocr_module, "_retry_sleep", fake_sleep)
    return sleeps


def _patch_pace(monkeypatch) -> list[float]:
    """Stub ocr_module._pace_sleep into a recorder (no real waits)."""
    waits: list[float] = []

    async def fake_pace_sleep(seconds: float) -> None:
        waits.append(seconds)

    monkeypatch.setattr(ocr_module, "_pace_sleep", fake_pace_sleep)
    return waits


async def test_parse_pdf_retries_429_with_backoff_then_succeeds(
    monkeypatch, fake_openai_env
):
    """A 429 from layout_parsing is retried with exponential backoff
    until an attempt succeeds — burst uploads no longer fail the whole
    document (issue #13)."""
    sleeps = _patch_sleep(monkeypatch)
    _patch_pace(monkeypatch)
    monkeypatch.setattr(ocr_module, "pdf_to_images", lambda b: [b"i1"])
    requests: list[httpx.Request] = []
    payload = _glm_ocr_payload([[_element("text", "OK", [0.1, 0.1, 0.5, 0.2])]])

    def transport(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if len(requests) < 3:
            return httpx.Response(
                429, json={"error": {"code": "1302", "message": "并发超限"}}
            )
        return httpx.Response(200, json=payload)

    result = await parse_pdf(
        b"fake-pdf-bytes",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(transport)),
    )

    assert result["pages"] == ["OK"]
    assert len(requests) == 3  # two 429s then success
    # exponential backoff between attempts, jittered up to +25% (官方建议
    # "避免固定间隔的高频重试"): base delay is the floor, never undercut
    assert len(sleeps) == 2
    assert 1.0 <= sleeps[0] <= 1.25
    assert 2.0 <= sleeps[1] <= 2.5


async def test_parse_pdf_honors_numeric_retry_after_header(monkeypatch, fake_openai_env):
    """A numeric Retry-After on the 429 overrides the exponential default."""
    sleeps = _patch_sleep(monkeypatch)
    _patch_pace(monkeypatch)
    monkeypatch.setattr(ocr_module, "pdf_to_images", lambda b: [b"i1"])
    requests: list[httpx.Request] = []
    payload = _glm_ocr_payload([[_element("text", "OK", [0.1, 0.1, 0.5, 0.2])]])

    def transport(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if len(requests) < 2:
            return httpx.Response(
                429,
                json={"error": {"code": "1302", "message": "rate limited"}},
                headers={"Retry-After": "7"},
            )
        return httpx.Response(200, json=payload)

    result = await parse_pdf(
        b"fake-pdf-bytes",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(transport)),
    )

    assert result["pages"] == ["OK"]
    assert len(requests) == 2
    assert len(sleeps) == 1
    assert 7.0 <= sleeps[0] <= 7.0 * 1.25  # server value is the floor, jittered


async def test_parse_pdf_raises_429_after_retries_exhausted(
    monkeypatch, fake_openai_env
):
    """Still 429 after glm_ocr_max_retries + 1 attempts -> the last 429
    surfaces to the caller (the whole document failed, D-031 decision 7)."""
    monkeypatch.setenv("GLM_OCR_MAX_RETRIES", "2")
    get_settings.cache_clear()
    sleeps = _patch_sleep(monkeypatch)
    _patch_pace(monkeypatch)
    monkeypatch.setattr(ocr_module, "pdf_to_images", lambda b: [b"i1"])
    requests: list[httpx.Request] = []

    def transport(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            429, json={"error": {"code": "1302", "message": "并发超限"}}
        )

    client = httpx.AsyncClient(transport=httpx.MockTransport(transport))
    with pytest.raises(httpx.HTTPStatusError) as exc_info:
        await parse_pdf(b"fake-pdf-bytes", http_client=client)

    assert exc_info.value.response.status_code == 429
    assert len(requests) == 3  # 1 initial + 2 retries
    assert len(sleeps) == 2
    assert 1.0 <= sleeps[0] <= 1.25
    assert 2.0 <= sleeps[1] <= 2.5


async def test_parse_pdf_does_not_retry_non_429_errors(fake_openai_env):
    """Non-429 errors (400 bad file) fail immediately: one attempt, no backoff."""
    requests: list[httpx.Request] = []

    def transport(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(400, json={"error": {"message": "bad file"}})

    client = httpx.AsyncClient(transport=httpx.MockTransport(transport))
    with pytest.raises(httpx.HTTPStatusError):
        await parse_pdf(b"fake-pdf-bytes", http_client=client)

    assert len(requests) == 1


async def test_glm_ocr_semaphore_caps_concurrent_layout_parsing_calls(
    monkeypatch, fake_openai_env
):
    """Concurrent parse calls share one process-wide semaphore sized by
    GLM_OCR_MAX_CONCURRENCY, keeping in-flight layout_parsing requests
    within the account's concurrency allowance (issue #13). Pacing is
    disabled here (interval 0) so the semaphore is measured in isolation."""
    monkeypatch.setenv("GLM_OCR_MAX_CONCURRENCY", "2")
    monkeypatch.setenv("GLM_OCR_MIN_REQUEST_INTERVAL", "0")
    get_settings.cache_clear()
    ocr_module._glm_ocr_semaphore.cache_clear()
    ocr_module._glm_ocr_pacer.cache_clear()
    try:
        payload = _glm_ocr_payload([[_element("text", "v", [0.1, 0.1, 0.5, 0.2])]])
        in_flight = 0
        peak = 0

        async def transport(request: httpx.Request) -> httpx.Response:
            nonlocal in_flight, peak
            in_flight += 1
            peak = max(peak, in_flight)
            await asyncio.sleep(0.01)  # hold the slot so overlap is observable
            in_flight -= 1
            return httpx.Response(200, json=payload)

        client = httpx.AsyncClient(transport=httpx.MockTransport(transport))
        results = await asyncio.gather(
            *[parse_image(b"img-bytes", http_client=client) for _ in range(5)]
        )

        assert all(r["pages"] == ["v"] for r in results)
        assert peak == 2  # capped at the configured limit, with real overlap
    finally:
        ocr_module._glm_ocr_semaphore.cache_clear()
        ocr_module._glm_ocr_pacer.cache_clear()


# --- retry jitter (官方建议"避免固定间隔的高频重试") ---


def test_with_jitter_stays_within_bounds_and_never_undercuts():
    """_with_jitter adds 0~25% on top of the computed delay: the base
    delay (including a server Retry-After) stays a hard floor, so
    jittered retries are never EARLIER than the safe value."""
    samples = set()
    for base in (1.0, 2.0, 4.0, 7.0):
        for _ in range(50):
            jittered = ocr_module._with_jitter(base)
            assert base <= jittered <= base * 1.25
            if base == 2.0:
                samples.add(round(jittered, 6))
    assert len(samples) > 1  # actually random, not a no-op constant


# --- request-start pacing: rate limiting, not just concurrency (issue #13
# follow-up: Zhipu's 1302/429 is an account request-FREQUENCY limit) ---


def test_request_pacer_grows_interval_on_429_and_decays_on_success():
    """AIMD adaptation: each 429 doubles the pacing interval up to the cap;
    each success decays it back toward the configured floor."""
    pacer = ocr_module._RequestPacer(min_interval=1.0, max_interval=10.0)
    assert pacer.interval == 1.0
    pacer.on_rate_limited()
    assert pacer.interval == 2.0
    pacer.on_rate_limited()
    assert pacer.interval == 4.0
    for _ in range(3):
        pacer.on_rate_limited()
    assert pacer.interval == 10.0  # capped at the ceiling (4 -> 8 -> 10)
    for _ in range(10):
        pacer.on_success()
    assert pacer.interval == 1.0  # decayed and clamped at the floor


async def test_request_pacer_first_acquire_is_immediate(monkeypatch):
    """An idle pacer lets the first request start at once: single-file
    uploads pay zero pacing latency."""
    waits = _patch_pace(monkeypatch)
    pacer = ocr_module._RequestPacer(min_interval=1.0)
    await pacer.acquire()
    assert waits == []  # nothing to wait for


async def test_request_pacer_spaces_request_starts(monkeypatch):
    """Successive acquires are spaced by the current interval: the offered
    request rate is capped even when each call completes instantly."""
    waits = _patch_pace(monkeypatch)
    pacer = ocr_module._RequestPacer(min_interval=1.0)
    for _ in range(3):
        await pacer.acquire()
    assert waits[0] == pytest.approx(1.0)
    assert waits[1] == pytest.approx(2.0)


async def test_request_pacer_disabled_when_interval_zero(monkeypatch):
    """min_interval=0 disables pacing entirely (escape hatch)."""
    waits = _patch_pace(monkeypatch)
    pacer = ocr_module._RequestPacer(min_interval=0.0)
    for _ in range(5):
        await pacer.acquire()
    assert waits == []


async def test_parse_image_burst_paces_request_starts(monkeypatch, fake_openai_env):
    """A burst of uploads spaces layout_parsing starts by the pacing
    interval: 20-card style bursts no longer offer more requests per
    minute than the account allows (issue #13 follow-up)."""
    monkeypatch.setenv("GLM_OCR_MIN_REQUEST_INTERVAL", "1.0")
    get_settings.cache_clear()
    ocr_module._glm_ocr_pacer.cache_clear()
    waits = _patch_pace(monkeypatch)
    payload = _glm_ocr_payload([[_element("text", "v", [0.1, 0.1, 0.5, 0.2])]])

    def transport(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=payload)

    client = httpx.AsyncClient(transport=httpx.MockTransport(transport))
    try:
        results = await asyncio.gather(
            *[parse_image(b"img-bytes", http_client=client) for _ in range(4)]
        )
        assert all(r["pages"] == ["v"] for r in results)
        # First start is immediate; the rest are spaced 1s, 2s, 3s out.
        assert waits == [
            pytest.approx(1.0),
            pytest.approx(2.0),
            pytest.approx(3.0),
        ]
    finally:
        ocr_module._glm_ocr_pacer.cache_clear()


async def test_parse_pdf_429_grows_pacing_interval(monkeypatch, fake_openai_env):
    """A 429 doubles the process-wide pacing interval so later requests
    start slower; a success decays it back toward the floor."""
    monkeypatch.setenv("GLM_OCR_MIN_REQUEST_INTERVAL", "1.0")
    get_settings.cache_clear()
    ocr_module._glm_ocr_pacer.cache_clear()
    _patch_sleep(monkeypatch)
    _patch_pace(monkeypatch)
    monkeypatch.setattr(ocr_module, "pdf_to_images", lambda b: [b"i1"])
    requests: list[httpx.Request] = []
    payload = _glm_ocr_payload([[_element("text", "OK", [0.1, 0.1, 0.5, 0.2])]])

    def transport(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if len(requests) == 1:
            return httpx.Response(
                429, json={"error": {"code": "1302", "message": "并发超限"}}
            )
        return httpx.Response(200, json=payload)

    pacer = ocr_module._glm_ocr_pacer()
    client = httpx.AsyncClient(transport=httpx.MockTransport(transport))
    try:
        result = await parse_pdf(b"fake-pdf-bytes", http_client=client)
        assert result["pages"] == ["OK"]
        # 1.0 -> (429) 2.0 -> (success) 1.5
        assert pacer.interval == pytest.approx(1.5)
    finally:
        ocr_module._glm_ocr_pacer.cache_clear()


# --- row-level confidence via hand_write OCR (D-046) ---


def _hw_row(text, left, top, width, height, *, min_p=0.95, avg=0.97):
    """One /files/ocr words_result row (pixel location, probability)."""
    return {
        "words": text,
        "location": {"left": left, "top": top, "width": width, "height": height},
        "probability": {"average": avg, "variance": 0.001, "min": min_p},
    }


def _hw_payload(rows):
    return {"task_id": "t1", "message": "ok", "status": "succeeded",
            "words_result_num": len(rows), "words_result": rows}


def _enable_confidence(monkeypatch):
    monkeypatch.setenv("GLM_OCR_CONFIDENCE_ENABLED", "true")
    monkeypatch.setenv("GLM_API_KEY", "glm-key")
    monkeypatch.setenv("GLM_OCR_MIN_REQUEST_INTERVAL", "0")
    monkeypatch.setenv("GLM_HAND_WRITE_MIN_REQUEST_INTERVAL", "0")
    get_settings.cache_clear()
    ocr_module._glm_ocr_pacer.cache_clear()
    ocr_module._hand_write_pacer.cache_clear()
    ocr_module._hand_write_semaphore.cache_clear()


def _routed_client(layout_payload, hw_response, requests):
    """Mock transport routing /layout_parsing and /files/ocr separately.

    ``hw_response`` is a payload dict, or a callable(request) -> Response.
    """

    def transport(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path.endswith("/layout_parsing"):
            return httpx.Response(200, json=layout_payload)
        assert request.url.path.endswith("/files/ocr"), request.url
        if callable(hw_response):
            return hw_response(request)
        return httpx.Response(200, json=hw_response)

    return httpx.AsyncClient(transport=httpx.MockTransport(transport))


_LAYOUT_ONE = _glm_ocr_payload([[_element("text", "Tel 123", [0.1, 0.1, 0.5, 0.2])]])


async def test_parse_image_returns_ocr_lines_from_hand_write(monkeypatch, fake_openai_env):
    """The image is also sent to /files/ocr (multipart, hand_write,
    probability=true); each row becomes an ocr_line with its pixel
    location rescaled to 0-100 and probability.min as min_prob."""
    _enable_confidence(monkeypatch)
    image = _image_bytes("PNG", 200, 100, None)
    requests: list[httpx.Request] = []
    client = _routed_client(
        _LAYOUT_ONE, _hw_payload([_hw_row("Tel 123", 20, 10, 100, 20, min_p=0.65)]), requests
    )

    result = await parse_image(image, media_type="image/png", http_client=client)

    assert result["ocr_lines"] == [
        {"page": 0, "text": "Tel 123", "box": [10.0, 10.0, 60.0, 30.0], "min_prob": 0.65}
    ]
    hw = [r for r in requests if r.url.path.endswith("/files/ocr")]
    assert len(hw) == 1
    assert str(hw[0].url).startswith("https://open.bigmodel.cn/api/paas/v4/files/ocr")
    assert hw[0].headers["Authorization"] == "Bearer glm-key"
    assert hw[0].headers["Content-Type"].startswith("multipart/form-data")
    body = hw[0].content
    assert b'name="tool_type"' in body and b"hand_write" in body
    assert b'name="probability"' in body and b"true" in body
    assert b'name="file"' in body and image in body


async def test_parse_pdf_ocr_lines_per_page_rendered_at_2x(monkeypatch, fake_openai_env):
    """PDF pages are rendered at 2x for the OCR call and rows carry their
    0-based page index; the box is normalized by that page's own pixels."""
    _enable_confidence(monkeypatch)
    scales: list[float] = []
    pngs = {1.0: [_image_bytes("PNG", 50, 50, None)] * 2,
            2.0: [_image_bytes("PNG", 400, 200, None), _image_bytes("PNG", 100, 100, None)]}

    def fake_render(b, scale=1.0):
        scales.append(scale)
        return pngs[scale]

    monkeypatch.setattr(ocr_module, "pdf_to_images", fake_render)
    layout = _glm_ocr_payload([[_element("text", "a", [0.1, 0.1, 0.5, 0.2])]] * 2)

    def hw(request):
        # Page order of arrival is not guaranteed; key off the uploaded PNG.
        width = 400 if b"\x00\x00\x01\x90" in request.content else 100
        if width == 400:
            rows = [_hw_row("p0", 40, 20, 80, 40)]
        else:
            rows = [_hw_row("p1", 10, 10, 50, 50)]
        return httpx.Response(200, json=_hw_payload(rows))

    requests: list[httpx.Request] = []
    result = await parse_pdf(b"pdf", http_client=_routed_client(layout, hw, requests))

    assert 2.0 in scales
    by_page = {line["page"]: line for line in result["ocr_lines"]}
    assert by_page[0]["box"] == [10.0, 10.0, 30.0, 30.0]
    assert by_page[1]["box"] == [10.0, 10.0, 60.0, 60.0]
    assert len(result["pages_images"]) == 2


async def test_hand_write_http_error_degrades_to_empty_lines(monkeypatch, fake_openai_env):
    """A failing confidence call must never fail the parse itself."""
    _enable_confidence(monkeypatch)
    requests: list[httpx.Request] = []
    client = _routed_client(
        _LAYOUT_ONE, lambda r: httpx.Response(500, json={"error": "boom"}), requests
    )

    result = await parse_image(_image_bytes("PNG", 20, 20, None), http_client=client)

    assert result["pages"] == ["Tel 123"]
    assert result["ocr_lines"] == []


async def test_hand_write_malformed_response_degrades(monkeypatch, fake_openai_env):
    """Missing words_result / garbage rows are skipped, not raised."""
    _enable_confidence(monkeypatch)
    rows = [
        {"words": "no location", "probability": {"min": 0.9}},
        {"words": "no prob", "location": {"left": 1, "top": 1, "width": 5, "height": 5}},
        _hw_row("good", 2, 2, 10, 10, min_p=0.8),
    ]
    client = _routed_client(_LAYOUT_ONE, _hw_payload(rows), [])
    result = await parse_image(_image_bytes("PNG", 100, 100, None), http_client=client)
    assert [l["text"] for l in result["ocr_lines"]] == ["good"]

    client = _routed_client(_LAYOUT_ONE, {"unexpected": True}, [])
    result = await parse_image(_image_bytes("PNG", 100, 100, None), http_client=client)
    assert result["ocr_lines"] == []


async def test_layout_failure_still_raises_with_confidence_enabled(monkeypatch, fake_openai_env):
    """Only the confidence call is best-effort; layout_parsing errors
    still fail the document (D-031 decision 7)."""
    _enable_confidence(monkeypatch)

    def transport(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/layout_parsing"):
            return httpx.Response(400, json={"error": "bad"})
        return httpx.Response(200, json=_hw_payload([]))

    client = httpx.AsyncClient(transport=httpx.MockTransport(transport))
    with pytest.raises(httpx.HTTPStatusError):
        await parse_image(_image_bytes("PNG", 20, 20, None), http_client=client)


async def test_confidence_disabled_makes_no_hand_write_call(fake_openai_env):
    """With the feature off (fixture default) there is no extra request
    and ocr_lines is None (= 'not attempted', distinct from [])."""
    requests: list[httpx.Request] = []

    def transport(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json=_LAYOUT_ONE)

    client = httpx.AsyncClient(transport=httpx.MockTransport(transport))
    result = await parse_image(_image_bytes("PNG", 20, 20, None), http_client=client)
    assert len(requests) == 1
    assert result["ocr_lines"] is None


async def test_hand_write_429_retried_with_independent_pacer(monkeypatch, fake_openai_env):
    """hand_write 429s are retried with backoff and grow ONLY the
    hand_write pacer — layout_parsing's pacer is a separate instance."""
    _enable_confidence(monkeypatch)
    monkeypatch.setenv("GLM_HAND_WRITE_MIN_REQUEST_INTERVAL", "1.0")
    get_settings.cache_clear()
    ocr_module._hand_write_pacer.cache_clear()
    _patch_pace(monkeypatch)
    sleeps = _patch_sleep(monkeypatch)
    calls = {"n": 0}

    def hw(request):
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(429, json={"error": {"code": "1302"}})
        return httpx.Response(200, json=_hw_payload([_hw_row("ok", 1, 1, 5, 5)]))

    hw_pacer = ocr_module._hand_write_pacer()
    layout_pacer = ocr_module._glm_ocr_pacer()
    assert hw_pacer is not layout_pacer

    result = await parse_image(
        _image_bytes("PNG", 50, 50, None), http_client=_routed_client(_LAYOUT_ONE, hw, [])
    )

    assert [l["text"] for l in result["ocr_lines"]] == ["ok"]
    assert len(sleeps) == 1 and 1.0 <= sleeps[0] <= 1.25
    assert hw_pacer.interval == pytest.approx(1.5)  # 1.0 -> 2.0 -> 1.5
    assert layout_pacer.interval == pytest.approx(0.0)
