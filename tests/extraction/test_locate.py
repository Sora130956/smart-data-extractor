"""Tests for extraction.locate: ground extracted values in the original image.

Issue #4 follow-up (D-027): the review pane overlays highlight boxes on the
original file preview, so the vision model is asked *where* each extracted
value appears. Offline throughout — TestModel or a faked GLM transport
(MockTransport), never a real network call.
"""

import json

import pytest
from httpx2 import AsyncClient as Httpx2AsyncClient
from httpx2 import MockTransport
from httpx2 import Response as Httpx2Response
from pydantic_ai.models.test import TestModel
from pydantic_ai.usage import RunUsage

import smart_data_extractor.extraction.locate as locate_module
from smart_data_extractor.extraction.locate import (
    MAX_VALUES,
    build_locate_agent,
    build_locate_prompt,
    locate_fields,
    locate_in_image,
    locate_in_pdf,
    normalize_boxes,
    parse_box_payload,
)
from smart_data_extractor.extraction.ocr import build_glm_model


def _glm_json_response(payload_content: str) -> dict:
    """A GLM OpenAI-compatible completion carrying `payload_content` as the
    message text (no `object` field — the quirk from D-011)."""
    return {
        "id": "resp-1",
        "choices": [
            {
                "index": 0,
                "finish_reason": "stop",
                "message": {"role": "assistant", "content": payload_content},
            }
        ],
        "created": 1_700_000_000,
        "model": "glm-4.5v",
        "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
    }


# --- build_locate_prompt ---


def test_build_locate_prompt_numbers_values_and_demands_json():
    """The prompt carries the values as a numbered list and pins the exact
    JSON shape the parser expects."""
    prompt = build_locate_prompt(["Acme Corp", "1234.5"])
    assert "1. Acme Corp" in prompt
    assert "2. 1234.5" in prompt
    assert '"boxes"' in prompt
    assert "null" in prompt


def test_build_locate_prompt_mentions_normalized_coordinates():
    """Coordinates must be normalized (percentages), not raw pixels."""
    prompt = build_locate_prompt(["x"])
    assert "0" in prompt and "100" in prompt


# --- parse_box_payload (defensive JSON extraction) ---


def test_parse_box_payload_happy_path():
    raw = json.dumps({"boxes": [[10, 20, 30, 40], None]})
    assert parse_box_payload(raw, count=2) == [[10, 20, 30, 40], None]


def test_parse_box_payload_strips_code_fences():
    """VLMs love wrapping JSON in markdown fences; the parser must survive."""
    raw = '```json\n{"boxes": [[1, 2, 3, 4]]}\n```'
    assert parse_box_payload(raw, count=1) == [[1, 2, 3, 4]]


def test_parse_box_payload_junk_returns_all_none():
    """Unparseable output degrades to 'not found' instead of raising."""
    assert parse_box_payload("I could not find any boxes.", count=3) == [None, None, None]


def test_parse_box_payload_wrong_arity_is_aligned():
    """Too few entries pad with None; too many are truncated — order stays."""
    raw = json.dumps({"boxes": [[1, 2, 3, 4]]})
    assert parse_box_payload(raw, count=3) == [[1, 2, 3, 4], None, None]
    raw = json.dumps({"boxes": [[1, 2, 3, 4], [5, 6, 7, 8]]})
    assert parse_box_payload(raw, count=1) == [[1, 2, 3, 4]]


def test_parse_box_payload_invalid_entries_become_none():
    """Non-list, wrong-length, or non-numeric entries degrade to None."""
    raw = json.dumps({"boxes": ["nope", [1, 2, 3], [1, 2, 3, "four"], [1, 2, 3, 4]]})
    assert parse_box_payload(raw, count=4) == [None, None, None, [1, 2, 3, 4]]


def test_parse_box_payload_non_object_json_returns_none():
    assert parse_box_payload(json.dumps([1, 2, 3]), count=1) == [None]


# --- normalize_boxes (scale tolerance + validation) ---


def test_normalize_boxes_passthrough_when_already_0_100():
    boxes = [[10, 20, 30, 40], None, [0, 0, 100, 100]]
    assert normalize_boxes(boxes) == [[10, 20, 30, 40], None, [0, 0, 100, 100]]


def test_normalize_boxes_rescales_0_1000_convention():
    """GLM-4.5V grounding natively emits 0-1000 relative coordinates; a
    response in that scale is divided down to percentages."""
    boxes = [[100, 200, 300, 400], None]
    assert normalize_boxes(boxes) == [[10, 20, 30, 40], None]


def test_normalize_boxes_rescales_pixel_like_coordinates():
    """Anything beyond 1000 is treated as pixel-ish and scaled by its max."""
    boxes = [[0, 0, 2000, 1000]]
    assert normalize_boxes(boxes) == [[0, 0, 100, 50]]


def test_normalize_boxes_swaps_inverted_corners_and_clamps():
    boxes = [[30, 40, 10, 20], [-5, -5, 105, 105]]
    assert normalize_boxes(boxes) == [[10, 20, 30, 40], [0, 0, 100, 100]]


def test_normalize_boxes_drops_degenerate_boxes():
    """Zero-area boxes are noise, not locations."""
    assert normalize_boxes([[10, 10, 10, 40]]) == [None]
    assert normalize_boxes([[10, 10, 40, 10]]) == [None]


# --- build_locate_agent ---


def test_build_locate_agent_outputs_plain_text_deterministically():
    """Plain-text output (the parser is intentionally tool-call-free so weak
    vision models still work) and temperature 0 for stable boxes."""
    agent = build_locate_agent(model=TestModel())
    assert agent.output_type is str
    assert agent.model_settings.get("temperature") == 0


# --- locate_in_image (faked GLM transport) ---


async def test_locate_in_image_returns_pageless_boxes(monkeypatch, fake_openai_env):
    """One vision call: the values reach the wire, boxes come back tagged
    page=None (images have no paging), usage and cost are reported."""
    monkeypatch.setenv("GLM_API_KEY", "test-glm-key")

    captured = {}

    def fake_glm_transport(request):
        captured["body"] = request.content.decode()
        return Httpx2Response(200, json=_glm_json_response('{"boxes": [[12, 34, 56, 78], null]}'))

    http_client = Httpx2AsyncClient(transport=MockTransport(fake_glm_transport))
    model = build_glm_model(http_client=http_client)

    result = await locate_in_image(
        b"png-bytes", ["Acme Corp", "missing"], media_type="image/png", model=model, model_ref="glm-4v-flash"
    )

    # The numbered values and the JSON contract reached the model (the wire
    # body is JSON, so the quotes in the prompt come back escaped).
    assert "Acme Corp" in captured["body"]
    assert "missing" in captured["body"]
    assert "boxes" in captured["body"]
    # Order-aligned results: found → page=None box; not found → None.
    assert result["boxes"] == [{"page": None, "box": [12, 34, 56, 78]}, None]
    assert result["pages_scanned"] == 1
    assert result["tokens_used"] == {"input": 10, "output": 5}
    assert result["cost_usd"] == 0.0  # glm-4v-flash is free


async def test_locate_in_image_normalizes_0_1000_output(monkeypatch, fake_openai_env):
    """End to end: a 0-1000-scale model response is delivered as 0-100."""
    monkeypatch.setenv("GLM_API_KEY", "test-glm-key")

    def fake_glm_transport(request):
        return Httpx2Response(200, json=_glm_json_response('{"boxes": [[100, 150, 400, 300]]}'))

    model = build_glm_model(http_client=Httpx2AsyncClient(transport=MockTransport(fake_glm_transport)))

    result = await locate_in_image(b"png", ["v"], media_type="image/png", model=model, model_ref="glm-4v-flash")
    assert result["boxes"] == [{"page": None, "box": [10, 15, 40, 30]}]


async def test_locate_in_image_junk_output_degrades_to_not_found(monkeypatch, fake_openai_env):
    monkeypatch.setenv("GLM_API_KEY", "test-glm-key")

    def fake_glm_transport(request):
        return Httpx2Response(200, json=_glm_json_response("sorry, I cannot see any values"))

    model = build_glm_model(http_client=Httpx2AsyncClient(transport=MockTransport(fake_glm_transport)))

    result = await locate_in_image(b"png", ["v"], media_type="image/png", model=model, model_ref="glm-4v-flash")
    assert result["boxes"] == [None]
    assert result["pages_scanned"] == 1


# --- locate_in_pdf (page-by-page search) ---


def _make_page_transport(page_payloads: list[str | Exception]):
    """A transport that serves one canned GLM response per call (one call per
    page), raising instead of responding when the payload is an Exception."""
    state = {"calls": 0}

    def transport(request):
        idx = min(state["calls"], len(page_payloads) - 1)
        state["calls"] += 1
        payload = page_payloads[idx]
        if isinstance(payload, Exception):
            return Httpx2Response(500, text="boom")
        return Httpx2Response(200, json=_glm_json_response(payload))

    return transport, state


async def test_locate_in_pdf_tags_page_indices_and_early_stops(monkeypatch, fake_openai_env):
    """Whole-PDF search: page 0 finds value 1, page 1 finds value 2 — the
    scan stops there (no third call), boxes carry 0-based page indices."""
    monkeypatch.setenv("GLM_API_KEY", "test-glm-key")
    monkeypatch.setattr(locate_module, "pdf_to_images", lambda pdf_bytes: [b"p0", b"p1", b"p2"])

    # Page 0 answers for [v1, v2] (only v1 found); page 1 answers for [v2].
    transport, state = _make_page_transport([
        '{"boxes": [[10, 10, 20, 20], null]}',
        '{"boxes": [[30, 30, 40, 40]]}',
    ])
    model = build_glm_model(http_client=Httpx2AsyncClient(transport=MockTransport(transport)))

    result = await locate_in_pdf(b"pdf", ["v1", "v2"], model=model, model_ref="glm-4v-flash")

    assert result["boxes"] == [
        {"page": 0, "box": [10, 10, 20, 20]},
        {"page": 1, "box": [30, 30, 40, 40]},
    ]
    assert result["pages_scanned"] == 2
    assert state["calls"] == 2  # early stop: page 2 was never scanned
    assert result["tokens_used"] == {"input": 20, "output": 10}


async def test_locate_in_pdf_tolerates_a_failing_page(monkeypatch, fake_openai_env):
    """A page whose grounding call persistently fails is skipped, not fatal.
    Dispatch by the page's image bytes (b"p0" -> base64 cDA=): the openai
    client auto-retries HTTP failures, so call-count-based fakes would be
    consumed by the retries instead of the pages."""
    monkeypatch.setenv("GLM_API_KEY", "test-glm-key")
    monkeypatch.setattr(locate_module, "pdf_to_images", lambda pdf_bytes: [b"p0", b"p1"])

    def transport(request):
        body = request.content.decode()
        if "cDA=" in body:  # page 0's image bytes
            return Httpx2Response(500, text="page 0 always fails")
        return Httpx2Response(200, json=_glm_json_response('{"boxes": [[50, 50, 60, 60]]}'))

    model = build_glm_model(http_client=Httpx2AsyncClient(transport=MockTransport(transport)))

    result = await locate_in_pdf(b"pdf", ["v1"], model=model, model_ref="glm-4v-flash")

    assert result["boxes"] == [{"page": 1, "box": [50, 50, 60, 60]}]
    assert result["pages_scanned"] == 2


async def test_locate_in_pdf_caps_the_scan(monkeypatch, fake_openai_env):
    """Pathological documents must not fan out into unbounded vision calls:
    at most MAX_PDF_PAGES_SCANNED pages are searched."""
    monkeypatch.setenv("GLM_API_KEY", "test-glm-key")
    monkeypatch.setattr(
        locate_module, "pdf_to_images", lambda pdf_bytes: [b"p"] * 30
    )

    transport, state = _make_page_transport(['{"boxes": [null]}'])
    model = build_glm_model(http_client=Httpx2AsyncClient(transport=MockTransport(transport)))

    result = await locate_in_pdf(b"pdf", ["v1"], model=model, model_ref="glm-4v-flash")

    assert result["pages_scanned"] == 10
    assert state["calls"] == 10
    assert result["boxes"] == [None]


async def test_locate_in_pdf_sums_cost_across_pages(monkeypatch, fake_openai_env):
    """Each scanned page costs its own vision call; totals aggregate."""
    monkeypatch.setenv("GLM_API_KEY", "test-glm-key")
    monkeypatch.setattr(locate_module, "pdf_to_images", lambda pdf_bytes: [b"p0", b"p1"])

    transport, _ = _make_page_transport([
        '{"boxes": [[10, 10, 20, 20]]}',  # finds v1 on page 0; v2 still missing
        '{"boxes": [null]}',  # v2 not on page 1 either -> scanned both
    ])
    model = build_glm_model(http_client=Httpx2AsyncClient(transport=MockTransport(transport)))

    result = await locate_in_pdf(b"pdf", ["v1", "v2"], model=model, model_ref="glm-4.5v")

    assert result["pages_scanned"] == 2
    assert result["tokens_used"] == {"input": 20, "output": 10}
    # 2 calls x (10 input tokens, 5 output tokens) on the low glm-4.5v tier.
    cost_one_call = (10 / 1_000_000) * 2.0 + (5 / 1_000_000) * 6.0
    assert result["cost_usd"] == pytest.approx(2 * cost_one_call / 7.25)


# --- locate_fields (dispatcher) ---


async def test_locate_fields_dispatches_image_vs_pdf(monkeypatch, fake_openai_env):
    """media_type picks the strategy: images locate in place, PDFs get the
    page-by-page search."""
    calls = []

    async def fake_image(image_bytes, values, *, media_type, model=None, model_ref=None):
        calls.append(("image", media_type))
        return {"boxes": [None], "pages_scanned": 1, "tokens_used": {"input": 0, "output": 0}, "cost_usd": 0.0}

    async def fake_pdf(pdf_bytes, values, *, model=None, model_ref=None):
        calls.append(("pdf",))
        return {"boxes": [None], "pages_scanned": 0, "tokens_used": {"input": 0, "output": 0}, "cost_usd": 0.0}

    monkeypatch.setattr(locate_module, "locate_in_image", fake_image)
    monkeypatch.setattr(locate_module, "locate_in_pdf", fake_pdf)

    await locate_fields(b"x", "image/png", ["v"])
    await locate_fields(b"x", "application/pdf", ["v"])

    assert calls == [("image", "image/png"), ("pdf",)]


def test_max_values_cap_is_small():
    """The route relies on this cap to keep one grounding call sane."""
    assert MAX_VALUES == 20
