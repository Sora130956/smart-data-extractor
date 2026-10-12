"""Tests for extraction.ocr: PDF/image -> Zhipu glm-ocr layout parsing
(D-031). Offline: httpx.MockTransport, never a real network call."""

import asyncio
import base64
import json

import fitz
import httpx
import pytest

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


async def test_parse_pdf_retries_429_with_backoff_then_succeeds(
    monkeypatch, fake_openai_env
):
    """A 429 from layout_parsing is retried with exponential backoff
    until an attempt succeeds — burst uploads no longer fail the whole
    document (issue #13)."""
    sleeps = _patch_sleep(monkeypatch)
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
    assert sleeps == [1.0, 2.0]  # exponential backoff between attempts


async def test_parse_pdf_honors_numeric_retry_after_header(monkeypatch, fake_openai_env):
    """A numeric Retry-After on the 429 overrides the exponential default."""
    sleeps = _patch_sleep(monkeypatch)
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
    assert sleeps == [7.0]


async def test_parse_pdf_raises_429_after_retries_exhausted(
    monkeypatch, fake_openai_env
):
    """Still 429 after glm_ocr_max_retries + 1 attempts -> the last 429
    surfaces to the caller (the whole document failed, D-031 decision 7)."""
    monkeypatch.setenv("GLM_OCR_MAX_RETRIES", "2")
    get_settings.cache_clear()
    sleeps = _patch_sleep(monkeypatch)
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
    assert sleeps == [1.0, 2.0]


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
    within the account's concurrency allowance (issue #13)."""
    monkeypatch.setenv("GLM_OCR_MAX_CONCURRENCY", "2")
    get_settings.cache_clear()
    ocr_module._glm_ocr_semaphore.cache_clear()
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
