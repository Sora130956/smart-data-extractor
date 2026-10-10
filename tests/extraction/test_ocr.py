"""Tests for extraction.ocr: PDF -> page images -> GLM vision OCR with
native grounding blocks (issue #4, D-028). Offline: TestModel or a faked
GLM transport (MockTransport), never a real network call."""

import json

import fitz
import pytest
from httpx2 import AsyncClient as Httpx2AsyncClient
from httpx2 import MockTransport
from httpx2 import Response as Httpx2Response
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.models.test import TestModel
from pydantic_ai.usage import RunUsage

import smart_data_extractor.extraction.ocr as ocr_module
from smart_data_extractor.config import get_settings
from smart_data_extractor.extraction.ocr import (
    _parse_grounding,
    build_glm_model,
    build_ocr_agent,
    calculate_glm_cost,
    parse_image,
    parse_pdf,
    pdf_to_images,
)


@pytest.fixture
def test_model() -> TestModel:
    """Offline model, function-scoped to avoid cross-test state."""
    return TestModel()


def _make_pdf_bytes(num_pages: int) -> bytes:
    """Build a tiny real PDF (via PyMuPDF) with the given number of pages."""
    doc = fitz.open()
    for _ in range(num_pages):
        page = doc.new_page()
        page.insert_text((72, 72), "Hello OCR")
    data = doc.tobytes()
    doc.close()
    return data


# --- build_ocr_agent ---


def test_build_ocr_agent_creates_fresh_instances():
    """Uncached builder: one page = one agent.run, no caching benefit."""
    m = TestModel()
    assert build_ocr_agent(model=m) is not build_ocr_agent(model=m)


def test_build_ocr_agent_outputs_plain_text_deterministically():
    """OCR output is plain text (no schema) and deterministic (temperature=0)."""
    agent = build_ocr_agent(model=TestModel())
    assert agent.output_type is str
    assert agent.model_settings.get("temperature") == 0


# --- build_glm_model ---


def test_build_glm_model_uses_configured_model_name(monkeypatch, fake_openai_env):
    """The constructed model reports the configured GLM model name."""
    monkeypatch.setenv("GLM_API_KEY", "test-glm-key")
    get_settings.cache_clear()
    model = build_glm_model()
    assert isinstance(model, OpenAIChatModel)
    assert model.model_name == get_settings().glm_model


def test_build_glm_model_uses_configured_base_url(monkeypatch, fake_openai_env):
    """The constructed model points at the configured GLM base url."""
    monkeypatch.setenv("GLM_API_KEY", "test-glm-key")
    get_settings.cache_clear()
    model = build_glm_model()
    assert model.base_url.rstrip("/") == get_settings().glm_base_url.rstrip("/")


# --- pdf_to_images ---


def test_pdf_to_images_returns_one_png_per_page():
    """Each PDF page renders to exactly one PNG image."""
    pdf_bytes = _make_pdf_bytes(2)
    images = pdf_to_images(pdf_bytes)
    assert len(images) == 2
    for img in images:
        assert isinstance(img, bytes)
        assert img.startswith(b"\x89PNG")


def test_pdf_to_images_single_page():
    """A one-page PDF yields a single image."""
    images = pdf_to_images(_make_pdf_bytes(1))
    assert len(images) == 1


# --- _parse_grounding (D-028: OCR-native block parsing) ---


def test_parse_grounding_happy_path_joins_block_texts():
    raw = json.dumps(
        {
            "blocks": [
                {"text": "Invoice Number", "box": [10, 10, 40, 15]},
                {"text": "INV-001", "box": [10, 20, 30, 25]},
            ]
        }
    )
    text, blocks = _parse_grounding(raw)
    assert text == "Invoice Number\nINV-001"
    assert blocks == [
        {"text": "Invoice Number", "box": [10, 10, 40, 15]},
        {"text": "INV-001", "box": [10, 20, 30, 25]},
    ]


def test_parse_grounding_rescales_0_1000_boxes():
    """GLM-4.5V grounding natively emits 0-1000 coordinates: boxes are
    normalized to 0-100 percentages."""
    raw = json.dumps({"blocks": [{"text": "v", "box": [100, 200, 300, 400]}]})
    _, blocks = _parse_grounding(raw)
    assert blocks == [{"text": "v", "box": [10, 20, 30, 40]}]


def test_parse_grounding_strips_code_fences():
    raw = '```json\n{"blocks": [{"text": "v", "box": [1, 2, 3, 4]}]}\n```'
    text, blocks = _parse_grounding(raw)
    assert text == "v"
    assert blocks == [{"text": "v", "box": [1, 2, 3, 4]}]


def test_parse_grounding_plain_text_degrades_to_raw_text():
    """Weak models may answer with prose instead of JSON: the text survives
    (backwards compatible), the page just has no blocks."""
    text, blocks = _parse_grounding("just some plain text")
    assert text == "just some plain text"
    assert blocks is None


def test_parse_grounding_drops_blocks_with_invalid_boxes():
    """Blocks whose box is missing/garbled keep their text in the page text
    but are dropped from the coordinate list (box=None marks them)."""
    raw = json.dumps(
        {
            "blocks": [
                {"text": "ok", "box": [1, 2, 3, 4]},
                {"text": "no box"},
                {"text": "bad box", "box": [1, 2, 3]},
                "not even a dict",
            ]
        }
    )
    text, blocks = _parse_grounding(raw)
    assert text == "ok\nno box\nbad box"
    assert blocks == [{"text": "ok", "box": [1, 2, 3, 4]}]


def test_parse_grounding_empty_blocks_degrades_to_raw():
    """A blocks list with no usable entries is treated as unparseable."""
    raw = json.dumps({"blocks": []})
    text, blocks = _parse_grounding(raw)
    assert text == raw
    assert blocks is None


# --- parse_pdf ---


async def test_parse_pdf_builds_glm_model_when_model_omitted(monkeypatch, fake_openai_env):
    """Production default path: no model passed -> a real GLM model is built and used."""
    monkeypatch.setattr(ocr_module, "pdf_to_images", lambda pdf_bytes: [b"page1"])

    sentinel_model = TestModel(custom_output_text="OCR TEXT")
    build_calls = []

    def fake_build_glm_model():
        build_calls.append(True)
        return sentinel_model

    monkeypatch.setattr(ocr_module, "build_glm_model", fake_build_glm_model)

    result = await parse_pdf(b"fake-pdf-bytes")

    assert build_calls == [True]
    assert result["text"] == "OCR TEXT"
    # Plain-text model output degrades: no blocks for the page.
    assert result["pages_blocks"] == [None]


async def test_parse_pdf_defaults_model_ref_to_settings_glm_model(monkeypatch, fake_openai_env):
    """Production default path: cost calculation uses settings.glm_model, not skipped."""
    monkeypatch.setattr(ocr_module, "pdf_to_images", lambda pdf_bytes: [b"page1"])
    monkeypatch.setattr(ocr_module, "build_glm_model", lambda: TestModel())

    calls = []

    def fake_calculate_glm_cost(usage, *, model_ref):
        calls.append(model_ref)
        return 0.0

    monkeypatch.setattr(ocr_module, "calculate_glm_cost", fake_calculate_glm_cost)

    await parse_pdf(b"fake-pdf-bytes")

    assert calls == [get_settings().glm_model]


async def test_parse_pdf_tolerates_glm_response_missing_object_field(
    monkeypatch, fake_openai_env
):
    """Regression: Zhipu GLM's endpoint omits the `object` field from its
    OpenAI-compatible responses; parsing must succeed anyway instead of
    failing every page with UnexpectedModelBehavior."""
    monkeypatch.setenv("GLM_API_KEY", "test-glm-key")
    get_settings.cache_clear()
    monkeypatch.setattr(ocr_module, "pdf_to_images", lambda pdf_bytes: [b"page1"])

    glm_payload = {
        "id": "resp-1",
        "choices": [
            {
                "index": 0,
                "finish_reason": "stop",
                "message": {
                    "role": "assistant",
                    "content": json.dumps(
                        {"blocks": [{"text": "OCR TEXT", "box": [10, 10, 50, 20]}]}
                    ),
                },
            }
        ],
        "created": 1_700_000_000,
        "model": "glm-4v-flash",
        "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
    }
    assert "object" not in glm_payload  # the GLM quirk under test

    def fake_glm_transport(request):
        return Httpx2Response(200, json=glm_payload)

    http_client = Httpx2AsyncClient(transport=MockTransport(fake_glm_transport))
    model = build_glm_model(http_client=http_client)

    result = await parse_pdf(b"fake-pdf-bytes", model=model)

    assert result["pages_failed"] == []
    assert result["text"] == "OCR TEXT"
    assert result["pages_blocks"] == [[{"text": "OCR TEXT", "box": [10, 10, 50, 20]}]]
    assert result["tokens_used"] == {"input": 10, "output": 5}


async def test_parse_pdf_concatenates_page_text(monkeypatch, test_model):
    """Multi-page OCR output joins into one text blob, one Source = one Result."""
    monkeypatch.setattr(ocr_module, "pdf_to_images", lambda pdf_bytes: [b"page1", b"page2"])
    grounding = json.dumps({"blocks": [{"text": "OCR TEXT", "box": [10, 10, 50, 20]}]})
    model = TestModel(custom_output_text=grounding)

    result = await parse_pdf(b"fake-pdf-bytes", model=model)

    assert result["text"] == "OCR TEXT\n\nOCR TEXT"
    assert result["pages"] == ["OCR TEXT", "OCR TEXT"]
    assert result["pages_blocks"] == [
        [{"text": "OCR TEXT", "box": [10, 10, 50, 20]}],
        [{"text": "OCR TEXT", "box": [10, 10, 50, 20]}],
    ]
    assert result["pages_failed"] == []


async def test_parse_pdf_reports_tokens_and_cost(monkeypatch, test_model, fake_openai_env):
    """Each parse reports token usage and a non-negative USD cost."""
    monkeypatch.setattr(ocr_module, "pdf_to_images", lambda pdf_bytes: [b"page-bytes"])

    result = await parse_pdf(b"fake-pdf-bytes", model=test_model, model_ref="glm-4v-flash")

    tokens = result["tokens_used"]
    assert isinstance(tokens["input"], int) and tokens["input"] > 0
    assert isinstance(tokens["output"], int) and tokens["output"] > 0
    assert isinstance(result["cost_usd"], float)
    # glm-4v-flash is free.
    assert result["cost_usd"] == 0.0


async def test_parse_pdf_skips_failed_pages(monkeypatch, test_model):
    """A page whose OCR run raises is skipped, not fatal to the whole document."""
    monkeypatch.setattr(ocr_module, "pdf_to_images", lambda pdf_bytes: [b"p1", b"p2", b"p3"])

    async def fake_ocr_page(agent, image_bytes, media_type="image/png"):
        if image_bytes == b"p2":
            raise RuntimeError("boom")
        name = f"text-for-{image_bytes.decode()}"
        return name, [{"text": name, "box": [1, 2, 3, 4]}], RunUsage(input_tokens=10, output_tokens=5)

    monkeypatch.setattr(ocr_module, "_ocr_page", fake_ocr_page)

    result = await parse_pdf(b"fake-pdf-bytes", model=test_model)

    assert result["pages_failed"] == [1]
    assert result["pages"] == ["text-for-p1", None, "text-for-p3"]
    assert result["pages_blocks"] == [
        [{"text": "text-for-p1", "box": [1, 2, 3, 4]}],
        None,
        [{"text": "text-for-p3", "box": [1, 2, 3, 4]}],
    ]
    assert result["text"] == "text-for-p1\n\ntext-for-p3"
    assert result["tokens_used"] == {"input": 20, "output": 10}


async def test_parse_pdf_all_pages_fail_returns_empty_text(monkeypatch, test_model):
    """Every page failing is tolerated: empty text, all indices recorded, zero cost."""
    monkeypatch.setattr(ocr_module, "pdf_to_images", lambda pdf_bytes: [b"p1", b"p2"])

    async def always_fails(agent, image_bytes, media_type="image/png"):
        raise RuntimeError("boom")

    monkeypatch.setattr(ocr_module, "_ocr_page", always_fails)

    result = await parse_pdf(b"fake-pdf-bytes", model=test_model)

    assert result["text"] == ""
    assert result["pages_failed"] == [0, 1]
    assert result["pages_blocks"] == [None, None]
    assert result["tokens_used"] == {"input": 0, "output": 0}
    assert result["cost_usd"] == 0.0


# --- parse_image ---


async def test_parse_image_ocrs_bytes_directly_with_media_type(monkeypatch, test_model):
    """An image is OCR'd as-is: no PDF page rendering, one source = one page,
    and the caller's media_type reaches the OCR call."""
    # If parse_image tried to route through pdf_to_images, this would explode.
    def must_not_render(pdf_bytes):
        raise AssertionError("parse_image must not render PDF pages")

    monkeypatch.setattr(ocr_module, "pdf_to_images", must_not_render)

    captured = {}

    async def fake_ocr_page(agent, image_bytes, media_type="image/png"):
        captured["media_type"] = media_type
        return "OCR TEXT", [{"text": "OCR TEXT", "box": [10, 10, 50, 20]}], RunUsage(input_tokens=7, output_tokens=3)

    monkeypatch.setattr(ocr_module, "_ocr_page", fake_ocr_page)

    result = await parse_image(b"jpeg-bytes", media_type="image/jpeg", model=test_model)

    assert captured["media_type"] == "image/jpeg"
    assert result["pages"] == ["OCR TEXT"]
    assert result["text"] == "OCR TEXT"
    assert result["pages_blocks"] == [[{"text": "OCR TEXT", "box": [10, 10, 50, 20]}]]
    assert result["pages_failed"] == []
    assert result["tokens_used"] == {"input": 7, "output": 3}


async def test_parse_image_builds_glm_model_when_model_omitted(monkeypatch, fake_openai_env):
    """Production default path: no model passed -> a real GLM model is built and used."""
    sentinel_model = TestModel(custom_output_text="OCR TEXT")
    build_calls = []

    def fake_build_glm_model():
        build_calls.append(True)
        return sentinel_model

    monkeypatch.setattr(ocr_module, "build_glm_model", fake_build_glm_model)

    result = await parse_image(b"png-bytes", media_type="image/png")

    assert build_calls == [True]
    assert result["text"] == "OCR TEXT"
    # Plain-text model output degrades: no blocks for the page.
    assert result["pages_blocks"] == [None]


async def test_parse_image_failed_ocr_returns_empty_text(monkeypatch, test_model):
    """A failing OCR run is tolerated: empty text, failure index recorded, zero cost."""

    async def always_fails(agent, image_bytes, media_type="image/png"):
        raise RuntimeError("boom")

    monkeypatch.setattr(ocr_module, "_ocr_page", always_fails)

    result = await parse_image(b"png-bytes", media_type="image/png", model=test_model)

    assert result["text"] == ""
    assert result["pages"] == [None]
    assert result["pages_blocks"] == [None]
    assert result["pages_failed"] == [0]
    assert result["tokens_used"] == {"input": 0, "output": 0}
    assert result["cost_usd"] == 0.0


# --- calculate_glm_cost ---


def test_calculate_glm_cost_free_for_flash_model(fake_openai_env):
    """glm-4v-flash is free regardless of token volume."""
    usage = RunUsage(input_tokens=10_000, output_tokens=5_000)
    assert calculate_glm_cost(usage, model_ref="glm-4v-flash") == 0.0


def test_calculate_glm_cost_zero_tokens(fake_openai_env):
    """Zero tokens cost zero dollars, even on a paid model."""
    usage = RunUsage(input_tokens=0, output_tokens=0)
    assert calculate_glm_cost(usage, model_ref="glm-4.5v") == 0.0


def test_calculate_glm_cost_low_tier_matches_zhipu_pricing(fake_openai_env):
    """Below the 32K-token tier: 2 CNY/1M input, 6 CNY/1M output, converted to USD."""
    usage = RunUsage(input_tokens=10_000, output_tokens=5_000)
    cost = calculate_glm_cost(usage, model_ref="glm-4.5v")
    expected_cny = (10_000 / 1_000_000) * 2.0 + (5_000 / 1_000_000) * 6.0
    assert cost == pytest.approx(expected_cny / 7.25)


def test_calculate_glm_cost_high_tier_matches_zhipu_pricing(fake_openai_env):
    """At/above the 32K-token tier: 4 CNY/1M input, 12 CNY/1M output."""
    usage = RunUsage(input_tokens=40_000, output_tokens=0)
    cost = calculate_glm_cost(usage, model_ref="glm-4.5v")
    expected_cny = (40_000 / 1_000_000) * 4.0
    assert cost == pytest.approx(expected_cny / 7.25)


def test_calculate_glm_cost_scales_with_tokens(fake_openai_env):
    """More tokens cost strictly more (monotonicity), on a paid model."""
    small = RunUsage(input_tokens=1_000, output_tokens=500)
    large = RunUsage(input_tokens=10_000, output_tokens=5_000)
    assert calculate_glm_cost(large, model_ref="glm-4.5v") > calculate_glm_cost(
        small, model_ref="glm-4.5v"
    )
