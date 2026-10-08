"""Tests for extraction.ocr: PDF -> page images -> GLM vision OCR (offline, TestModel)."""

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
    build_glm_model,
    build_ocr_agent,
    calculate_glm_cost,
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
                "message": {"role": "assistant", "content": "OCR TEXT"},
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
    assert result["tokens_used"] == {"input": 10, "output": 5}


async def test_parse_pdf_concatenates_page_text(monkeypatch, test_model):
    """Multi-page OCR output joins into one text blob, one Source = one Result."""
    monkeypatch.setattr(ocr_module, "pdf_to_images", lambda pdf_bytes: [b"page1", b"page2"])
    model = TestModel(custom_output_text="OCR TEXT")

    result = await parse_pdf(b"fake-pdf-bytes", model=model)

    assert result["text"] == "OCR TEXT\n\nOCR TEXT"
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

    async def fake_ocr_page(agent, image_bytes):
        if image_bytes == b"p2":
            raise RuntimeError("boom")
        return f"text-for-{image_bytes.decode()}", RunUsage(input_tokens=10, output_tokens=5)

    monkeypatch.setattr(ocr_module, "_ocr_page", fake_ocr_page)

    result = await parse_pdf(b"fake-pdf-bytes", model=test_model)

    assert result["pages_failed"] == [1]
    assert result["text"] == "text-for-p1\n\ntext-for-p3"
    assert result["tokens_used"] == {"input": 20, "output": 10}


async def test_parse_pdf_all_pages_fail_returns_empty_text(monkeypatch, test_model):
    """Every page failing is tolerated: empty text, all indices recorded, zero cost."""
    monkeypatch.setattr(ocr_module, "pdf_to_images", lambda pdf_bytes: [b"p1", b"p2"])

    async def always_fails(agent, image_bytes):
        raise RuntimeError("boom")

    monkeypatch.setattr(ocr_module, "_ocr_page", always_fails)

    result = await parse_pdf(b"fake-pdf-bytes", model=test_model)

    assert result["text"] == ""
    assert result["pages_failed"] == [0, 1]
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
