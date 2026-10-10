"""Tests for the FastAPI transport layer.

Offline: the extraction functions are replaced via dependency_overrides
(workspace testing discipline: inject fakes, never mock the object under
test, never hit the network).
"""

import httpx
import pytest

from smart_data_extractor.api import create_app
from smart_data_extractor.api.routes import (
    get_batch_fn,
    get_extract_fn,
    get_locate_fields_fn,
    get_parse_image_fn,
    get_parse_pdf_fn,
    get_schema_infer_fn,
    get_schema_resolve_fn,
)


@pytest.fixture
def app(fake_openai_env):
    # fake_openai_env: routes read settings for the USD->CNY display rate.
    app = create_app()
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


def _extract_result(text: str) -> dict:
    """Non-trivial per-text result: usage scales with input so aggregated
    assertions cannot pass on stubs (zero / constant / first-item)."""
    return {
        "data": {"name": text},
        "tokens_used": {"input": len(text), "output": 1},
        "cost_usd": 0.001,
    }


def _make_fake_extract(fail_with: Exception | None = None):
    calls = []

    async def fake_extract(
        text, preset=None, schema_dict=None, *, model=None, model_ref=None,
        instructions=None, lang=None
    ):
        calls.append(
            {
                "text": text,
                "preset": preset,
                "schema_dict": schema_dict,
                "instructions": instructions,
                "lang": lang,
            }
        )
        if fail_with is not None:
            raise fail_with
        return _extract_result(text)

    return fake_extract, calls


async def test_create_app_serves_built_frontend_from_dist(fake_openai_env, tmp_path):
    """Single-service deploys (e.g. Render): the built SPA is served at /."""
    (tmp_path / "index.html").write_text("<html>spa</html>", encoding="utf-8")
    app = create_app(dist_dir=tmp_path)

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        response = await c.get("/")
        assert response.status_code == 200
        assert "spa" in response.text
        # API routes still win over the static mount.
        api_docs = await c.get("/openapi.json")
        assert api_docs.status_code == 200


async def test_api_prefix_is_stripped_for_single_service_deploys(fake_openai_env, tmp_path):
    """Prod builds fetch('/api/...'); dev relies on Vite's proxy (see
    vite.config.ts) to strip the "/api" prefix before it reaches this app.
    Single-service deploys have no such proxy, so the app must do the same
    rewrite itself, or every frontend request 404s against the static
    mount instead of reaching the router."""
    (tmp_path / "index.html").write_text("<html>spa</html>", encoding="utf-8")
    app = create_app(dist_dir=tmp_path)

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        resp = await c.get("/api/health")
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}


def _make_fake_batch():
    """Fake batch_extract honoring the Phase 4 tolerant-mode contract:
    texts equal to "bad" come back as error items."""
    calls = []

    async def fake_batch(
        texts, preset=None, schema_dict=None, *, model=None, instructions=None,
        return_exceptions=False, lang=None
    ):
        calls.append(
            {
                "texts": list(texts),
                "instructions": instructions,
                "return_exceptions": return_exceptions,
                "lang": lang,
            }
        )
        results = []
        for t in texts:
            if t == "bad":
                results.append(
                    {
                        "data": None,
                        "tokens_used": {"input": 0, "output": 0},
                        "cost_usd": 0.0,
                        "error": "RuntimeError: boom",
                    }
                )
            else:
                results.append(_extract_result(t) | {"error": None})
        return {
            "results": results,
            "total_cost_usd": sum(r["cost_usd"] for r in results),
            "total_tokens": {
                "input": sum(r["tokens_used"]["input"] for r in results),
                "output": sum(r["tokens_used"]["output"] for r in results),
            },
        }

    return fake_batch, calls


# --- /health ---


async def test_health(client):
    resp = await client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


# --- /extract ---


async def test_extract_happy_path(app, client, test_db):
    fake, calls = _make_fake_extract()
    app.dependency_overrides[get_extract_fn] = lambda: fake

    resp = await client.post(
        "/extract",
        json={"text": "John Smith", "preset": "contact", "instructions": "be strict"},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["data"] == {"name": "John Smith"}
    assert body["tokens_used"] == {"input": len("John Smith"), "output": 1}
    assert body["cost_usd"] == 0.001
    # CNY is derived at the transport layer from the configured rate.
    assert body["cost_cny"] == pytest.approx(0.001 * 7.25)
    # The route forwards request fields to the extraction layer unchanged.
    assert calls == [
        {
            "text": "John Smith",
            "preset": "contact",
            "schema_dict": None,
            "instructions": "be strict",
            "lang": None,
        }
    ]


async def test_extract_forwards_lang(app, client, test_db):
    fake, calls = _make_fake_extract()
    app.dependency_overrides[get_extract_fn] = lambda: fake

    resp = await client.post(
        "/extract",
        json={"text": "张三，zhang@acme.cn", "preset": "contact", "lang": "zh-CN"},
    )

    assert resp.status_code == 200
    assert calls[0]["lang"] == "zh-CN"


async def test_extract_without_lang_passes_none(app, client, test_db):
    fake, calls = _make_fake_extract()
    app.dependency_overrides[get_extract_fn] = lambda: fake

    resp = await client.post("/extract", json={"text": "x", "preset": "contact"})

    assert resp.status_code == 200
    assert calls[0]["lang"] is None


async def test_extract_with_custom_schema(app, client):
    fake, calls = _make_fake_extract()
    app.dependency_overrides[get_extract_fn] = lambda: fake
    schema = {"product_name": {"type": "string", "required": True}}

    resp = await client.post("/extract", json={"text": "iPhone 15, $999", "schema": schema})

    assert resp.status_code == 200
    assert calls[0]["schema_dict"] == schema
    assert calls[0]["preset"] is None


async def test_extract_requires_exactly_one_source(client):
    both = await client.post(
        "/extract",
        json={"text": "x", "preset": "contact", "schema": {"f": {"type": "string"}}},
    )
    neither = await client.post("/extract", json={"text": "x"})
    assert both.status_code == 422
    assert neither.status_code == 422


async def test_extract_unknown_preset_422(client, test_db):
    resp = await client.post("/extract", json={"text": "x", "preset": "nope"})
    assert resp.status_code == 422


async def test_extract_malformed_schema_422(client):
    # Field spec without the required "type" key is rejected at the boundary.
    resp = await client.post("/extract", json={"text": "x", "schema": {"f": {"required": True}}})
    assert resp.status_code == 422


async def test_extract_value_error_becomes_400(app, client, test_db):
    fake, _ = _make_fake_extract(fail_with=ValueError("schema exploded"))
    app.dependency_overrides[get_extract_fn] = lambda: fake

    resp = await client.post("/extract", json={"text": "x", "preset": "contact"})

    assert resp.status_code == 400
    assert "schema exploded" in resp.json()["detail"]


# --- /batch_extract ---


async def test_batch_partial_failure_contract(app, client, test_db):
    fake, calls = _make_fake_batch()
    app.dependency_overrides[get_batch_fn] = lambda: fake

    resp = await client.post(
        "/batch_extract",
        json={"texts": ["good one", "bad", "good two"], "preset": "contact", "instructions": "be strict"},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert len(body["results"]) == 3
    ok1, err, ok2 = body["results"]
    assert ok1["error"] is None
    assert ok1["data"] == {"name": "good one"}
    assert err["data"] is None
    assert "boom" in err["error"]
    assert ok2["data"] == {"name": "good two"}  # input order preserved
    # Aggregates and success/failure counts.
    assert body["succeeded"] == 2
    assert body["failed"] == 1
    assert body["total_cost_usd"] == pytest.approx(0.002)
    assert ok1["cost_cny"] == pytest.approx(0.001 * 7.25)
    assert err["cost_cny"] == 0.0
    assert body["total_cost_cny"] == pytest.approx(0.002 * 7.25)
    assert body["total_tokens"]["input"] == len("good one") + len("good two")
    # The API always opts into per-item tolerance and forwards instructions.
    assert calls[0]["return_exceptions"] is True
    assert calls[0]["instructions"] == "be strict"
    assert calls[0]["lang"] is None


async def test_batch_forwards_lang(app, client, test_db):
    fake, calls = _make_fake_batch()
    app.dependency_overrides[get_batch_fn] = lambda: fake

    resp = await client.post(
        "/batch_extract",
        json={"texts": ["张三，zhang@acme.cn"], "preset": "contact", "lang": "zh"},
    )

    assert resp.status_code == 200
    assert calls[0]["lang"] == "zh"


async def test_batch_empty_texts_422(client):
    resp = await client.post("/batch_extract", json={"texts": [], "preset": "contact"})
    assert resp.status_code == 422


async def test_preset_schema_returns_fields(client, test_db):
    resp = await client.get("/presets/contact/schema")
    assert resp.status_code == 200
    body = resp.json()
    names = {f["field_name"] for f in body["fields"]}
    assert names == {"name", "email", "phone", "company", "job_title", "website"}
    email_field = next(f for f in body["fields"] if f["field_name"] == "email")
    assert email_field["type"] == "string"
    assert email_field["format"] == "email"
    assert email_field["display_name_zh"] == "邮箱"
    assert email_field["display_name_en"] == "Email"
    assert email_field["description_zh"] == "联系人电子邮箱"
    assert email_field["description_en"] == "Email address of the contact"
    assert "description" not in email_field


async def test_preset_schema_invoice_has_date_type_no_line_items(client, test_db):
    resp = await client.get("/presets/invoice/schema")
    assert resp.status_code == 200
    fields = {f["field_name"]: f for f in resp.json()["fields"]}
    assert "line_items" not in fields
    assert fields["date"]["type"] == "date"
    assert fields["total"]["type"] == "number"


async def test_list_presets_returns_builtins(client, test_db):
    resp = await client.get("/presets")
    assert resp.status_code == 200
    body = resp.json()
    by_id = {p["id"]: p for p in body}
    assert set(by_id) == {"contact", "invoice", "lead"}
    assert by_id["contact"]["display_name_zh"] == "联系人"
    assert by_id["contact"]["display_name_en"] == "Contact"
    assert by_id["contact"]["is_builtin"] is True


async def test_preset_schema_unknown_preset_404(client, test_db):
    resp = await client.get("/presets/unknown-preset/schema")
    assert resp.status_code == 404


# --- /schema/resolve ---


def _make_fake_resolve(fail_with: Exception | None = None):
    calls = []

    async def fake_resolve(fields):
        calls.append(fields)
        if fail_with is not None:
            raise fail_with
        return {
            "schema": {"fields": {"urgency_level": {"type": "string", "description": "d", "required": False}}},
            "tokens_used": {"input": 10, "output": 2},
            "cost_usd": 0.001,
        }

    return fake_resolve, calls


async def test_schema_resolve_happy_path(app, client):
    fake, calls = _make_fake_resolve()
    app.dependency_overrides[get_schema_resolve_fn] = lambda: fake

    resp = await client.post(
        "/schema/resolve",
        json={"fields": [{"display_name": "紧急程度", "description": "d", "type": "string"}]},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["schema"] == {
        "fields": {"urgency_level": {"type": "string", "description": "d", "required": False}}
    }
    assert body["cost_usd"] == 0.001
    assert body["cost_cny"] == pytest.approx(0.001 * 7.25)
    assert calls[0] == [
        {
            "display_name": "紧急程度",
            "display_name_en": None,
            "description": "d",
            "type": "string",
            "required": False,
            "field_name": None,
        }
    ]


async def test_schema_resolve_value_error_becomes_400(app, client):
    fake, _ = _make_fake_resolve(fail_with=ValueError("bad name"))
    app.dependency_overrides[get_schema_resolve_fn] = lambda: fake

    resp = await client.post(
        "/schema/resolve",
        json={"fields": [{"display_name": "X", "type": "string"}]},
    )

    assert resp.status_code == 400
    assert "bad name" in resp.json()["detail"]


async def test_schema_resolve_empty_fields_422(client):
    resp = await client.post("/schema/resolve", json={"fields": []})
    assert resp.status_code == 422


# --- /schema/infer ---


def _make_fake_infer(fail_with: Exception | None = None):
    calls = []

    async def fake_infer(text):
        calls.append(text)
        if fail_with is not None:
            raise fail_with
        return {
            "schema": {
                "fields": {
                    "invoice_number": {
                        "type": "string",
                        "description": "d",
                        "required": True,
                        "display_name": "发票号",
                        "display_name_en": "Invoice Number",
                    }
                }
            },
            "schema_name": "发票信息",
            "schema_name_en": "Invoice Info",
            "tokens_used": {"input": 20, "output": 5},
            "cost_usd": 0.002,
        }

    return fake_infer, calls


async def test_schema_infer_happy_path(app, client):
    fake, calls = _make_fake_infer()
    app.dependency_overrides[get_schema_infer_fn] = lambda: fake

    resp = await client.post("/schema/infer", json={"text": "发票号：12345"})

    assert resp.status_code == 200
    body = resp.json()
    assert body["schema"] == {
        "fields": {
            "invoice_number": {
                "type": "string",
                "description": "d",
                "required": True,
                "display_name": "发票号",
                "display_name_en": "Invoice Number",
            }
        }
    }
    assert body["schema_name"] == "发票信息"
    assert body["schema_name_en"] == "Invoice Info"
    assert body["cost_usd"] == 0.002
    assert body["cost_cny"] == pytest.approx(0.002 * 7.25)
    assert calls == ["发票号：12345"]


async def test_schema_infer_value_error_becomes_400(app, client):
    fake, _ = _make_fake_infer(fail_with=ValueError("no fields"))
    app.dependency_overrides[get_schema_infer_fn] = lambda: fake

    resp = await client.post("/schema/infer", json={"text": "some text"})

    assert resp.status_code == 400
    assert "no fields" in resp.json()["detail"]


async def test_schema_infer_empty_text_422(client):
    resp = await client.post("/schema/infer", json={"text": ""})
    assert resp.status_code == 422


# --- /parse_pdf ---


def _make_fake_parse_pdf(fail_with: Exception | None = None):
    calls = []

    async def fake_parse_pdf(pdf_bytes, *, model=None, model_ref=None):
        calls.append({"pdf_bytes": pdf_bytes, "model_ref": model_ref})
        if fail_with is not None:
            raise fail_with
        return {
            "text": "extracted OCR text",
            "pages": ["extracted OCR text"],
            "pages_failed": [],
            "tokens_used": {"input": 100, "output": 20},
            "cost_usd": 0.0,
        }

    return fake_parse_pdf, calls


async def test_parse_pdf_happy_path(app, client):
    fake, calls = _make_fake_parse_pdf()
    app.dependency_overrides[get_parse_pdf_fn] = lambda: fake

    resp = await client.post(
        "/parse_pdf",
        files={"file": ("doc.pdf", b"%PDF-1.4 fake bytes", "application/pdf")},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["text"] == "extracted OCR text"
    assert body["pages"] == ["extracted OCR text"]
    assert body["pages_failed"] == []
    assert body["tokens_used"] == {"input": 100, "output": 20}
    assert body["cost_usd"] == 0.0
    assert body["cost_cny"] == 0.0
    assert calls[0]["pdf_bytes"] == b"%PDF-1.4 fake bytes"


async def test_parse_pdf_reports_failed_pages_and_cost_cny(app, client):
    fake, _ = _make_fake_parse_pdf()
    app.dependency_overrides[get_parse_pdf_fn] = lambda: fake

    async def fake_with_failures(pdf_bytes, *, model=None, model_ref=None):
        return {
            "text": "page one",
            "pages": ["page one", None],
            "pages_failed": [1],
            "tokens_used": {"input": 50, "output": 10},
            "cost_usd": 0.001,
        }

    app.dependency_overrides[get_parse_pdf_fn] = lambda: fake_with_failures

    resp = await client.post(
        "/parse_pdf",
        files={"file": ("doc.pdf", b"%PDF-1.4 fake bytes", "application/pdf")},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["pages_failed"] == [1]
    assert body["cost_cny"] == pytest.approx(0.001 * 7.25)


async def test_parse_pdf_rejects_non_pdf_content_type(client):
    resp = await client.post(
        "/parse_pdf",
        files={"file": ("doc.txt", b"not a pdf", "text/plain")},
    )
    assert resp.status_code == 422


async def test_parse_pdf_value_error_becomes_400(app, client):
    fake, _ = _make_fake_parse_pdf(fail_with=ValueError("broken pdf"))
    app.dependency_overrides[get_parse_pdf_fn] = lambda: fake

    resp = await client.post(
        "/parse_pdf",
        files={"file": ("doc.pdf", b"%PDF-1.4 fake bytes", "application/pdf")},
    )

    assert resp.status_code == 400
    assert "broken pdf" in resp.json()["detail"]


# --- /parse_image ---


def _make_fake_parse_image(fail_with: Exception | None = None):
    calls = []

    async def fake_parse_image(image_bytes, *, media_type, model=None, model_ref=None):
        calls.append({"image_bytes": image_bytes, "media_type": media_type})
        if fail_with is not None:
            raise fail_with
        return {
            "text": "image OCR text",
            "pages": ["image OCR text"],
            "pages_failed": [],
            "tokens_used": {"input": 100, "output": 20},
            "cost_usd": 0.0,
        }

    return fake_parse_image, calls


async def test_parse_image_happy_path(app, client):
    fake, calls = _make_fake_parse_image()
    app.dependency_overrides[get_parse_image_fn] = lambda: fake

    resp = await client.post(
        "/parse_image",
        files={"file": ("scan.png", b"\x89PNG fake bytes", "image/png")},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["text"] == "image OCR text"
    assert body["pages"] == ["image OCR text"]
    assert body["pages_failed"] == []
    assert body["tokens_used"] == {"input": 100, "output": 20}
    assert body["cost_usd"] == 0.0
    assert calls[0]["image_bytes"] == b"\x89PNG fake bytes"
    assert calls[0]["media_type"] == "image/png"


async def test_parse_image_accepts_jpeg(app, client):
    fake, calls = _make_fake_parse_image()
    app.dependency_overrides[get_parse_image_fn] = lambda: fake

    resp = await client.post(
        "/parse_image",
        files={"file": ("scan.jpg", b"jpeg fake bytes", "image/jpeg")},
    )

    assert resp.status_code == 200
    assert calls[0]["media_type"] == "image/jpeg"


async def test_parse_image_rejects_unsupported_content_type(client):
    resp = await client.post(
        "/parse_image",
        files={"file": ("scan.webp", b"webp fake bytes", "image/webp")},
    )
    assert resp.status_code == 422


async def test_parse_image_value_error_becomes_400(app, client):
    fake, _ = _make_fake_parse_image(fail_with=ValueError("broken image"))
    app.dependency_overrides[get_parse_image_fn] = lambda: fake

    resp = await client.post(
        "/parse_image",
        files={"file": ("scan.png", b"\x89PNG fake bytes", "image/png")},
    )

    assert resp.status_code == 400
    assert "broken image" in resp.json()["detail"]


# --- /parse_pdf page images (issue #4 review-pane overlay) ---


async def test_parse_pdf_happy_path_carries_page_images(app, client):
    """The parse response includes per-page rendered PNGs (base64) so the
    review pane can preview PDF pages as images and overlay locate boxes."""
    async def fake_with_images(pdf_bytes, *, model=None, model_ref=None):
        return {
            "text": "p1\n\np2",
            "pages": ["p1", "p2"],
            "pages_failed": [],
            "pages_images": ["<b64-p1>", "<b64-p2>"],
            "tokens_used": {"input": 100, "output": 20},
            "cost_usd": 0.0,
        }

    app.dependency_overrides[get_parse_pdf_fn] = lambda: fake_with_images

    resp = await client.post(
        "/parse_pdf",
        files={"file": ("doc.pdf", b"%PDF-1.4 fake bytes", "application/pdf")},
    )

    assert resp.status_code == 200
    assert resp.json()["pages_images"] == ["<b64-p1>", "<b64-p2>"]


async def test_parse_pdf_page_images_default_to_none_for_old_parsers(app, client):
    """Backward-compatible contract: a parser without page images still
    yields a valid response (the field is optional)."""
    fake, _ = _make_fake_parse_pdf()
    app.dependency_overrides[get_parse_pdf_fn] = lambda: fake

    resp = await client.post(
        "/parse_pdf",
        files={"file": ("doc.pdf", b"%PDF-1.4 fake bytes", "application/pdf")},
    )

    assert resp.status_code == 200
    assert resp.json().get("pages_images") is None


# --- /locate_fields (issue #4: ground values in the original file) ---


def _make_fake_locate_fields(fail_with: Exception | None = None):
    calls = []

    async def fake_locate_fields(file_bytes, media_type, values, *, model=None, model_ref=None):
        calls.append({"file_bytes": file_bytes, "media_type": media_type, "values": values})
        if fail_with is not None:
            raise fail_with
        return {
            "boxes": [{"page": None, "box": [10, 20, 30, 40]}, None],
            "pages_scanned": 1,
            "tokens_used": {"input": 40, "output": 8},
            "cost_usd": 0.0,
        }

    return fake_locate_fields, calls


async def test_locate_fields_happy_path_image(app, client):
    fake, calls = _make_fake_locate_fields()
    app.dependency_overrides[get_locate_fields_fn] = lambda: fake

    resp = await client.post(
        "/locate_fields",
        files={"file": ("scan.png", b"\x89PNG fake bytes", "image/png")},
        data={"values": ["Acme Corp", "missing"]},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["boxes"] == [{"page": None, "box": [10, 20, 30, 40]}, None]
    assert body["pages_scanned"] == 1
    assert body["tokens_used"] == {"input": 40, "output": 8}
    assert body["cost_usd"] == 0.0
    assert body["cost_cny"] == 0.0
    assert calls[0]["file_bytes"] == b"\x89PNG fake bytes"
    assert calls[0]["media_type"] == "image/png"
    assert calls[0]["values"] == ["Acme Corp", "missing"]


async def test_locate_fields_accepts_pdf(app, client):
    """Whole-PDF locate: the media type reaches the core unchanged."""
    fake, calls = _make_fake_locate_fields()
    app.dependency_overrides[get_locate_fields_fn] = lambda: fake

    resp = await client.post(
        "/locate_fields",
        files={"file": ("doc.pdf", b"%PDF-1.4 fake bytes", "application/pdf")},
        data={"values": ["Acme Corp"]},
    )

    assert resp.status_code == 200
    assert calls[0]["media_type"] == "application/pdf"
    assert calls[0]["file_bytes"] == b"%PDF-1.4 fake bytes"


async def test_locate_fields_strips_empty_values(app, client):
    """Blank entries are dropped before the vision call; nothing left -> 422."""
    fake, calls = _make_fake_locate_fields()
    app.dependency_overrides[get_locate_fields_fn] = lambda: fake

    resp = await client.post(
        "/locate_fields",
        files={"file": ("scan.png", b"\x89PNG fake bytes", "image/png")},
        data={"values": ["Acme Corp", "  ", ""]},
    )

    assert resp.status_code == 200
    assert calls[0]["values"] == ["Acme Corp"]


async def test_locate_fields_rejects_no_values(client):
    resp = await client.post(
        "/locate_fields",
        files={"file": ("scan.png", b"\x89PNG fake bytes", "image/png")},
        data={"values": ["   "]},
    )
    assert resp.status_code == 422


async def test_locate_fields_rejects_too_many_values(app, client):
    """One grounding call stays sane: more than MAX_VALUES is a 422, and the
    vision model is never called."""
    fake, calls = _make_fake_locate_fields()
    app.dependency_overrides[get_locate_fields_fn] = lambda: fake

    resp = await client.post(
        "/locate_fields",
        files={"file": ("scan.png", b"\x89PNG fake bytes", "image/png")},
        data={"values": [f"v{i}" for i in range(21)]},
    )

    assert resp.status_code == 422
    assert calls == []


async def test_locate_fields_rejects_unsupported_content_type(client):
    resp = await client.post(
        "/locate_fields",
        files={"file": ("doc.txt", b"plain", "text/plain")},
        data={"values": ["Acme Corp"]},
    )
    assert resp.status_code == 422


async def test_locate_fields_value_error_becomes_400(app, client):
    fake, _ = _make_fake_locate_fields(fail_with=ValueError("broken file"))
    app.dependency_overrides[get_locate_fields_fn] = lambda: fake

    resp = await client.post(
        "/locate_fields",
        files={"file": ("scan.png", b"\x89PNG fake bytes", "image/png")},
        data={"values": ["Acme Corp"]},
    )

    assert resp.status_code == 400
    assert "broken file" in resp.json()["detail"]


async def test_locate_fields_is_quota_guarded(app, client):
    """D-019: the grounding call spends quota like every other billable
    endpoint — the second request within the limit is a structured 429."""
    from smart_data_extractor.api.quota import DailyQuota
    from smart_data_extractor.api.routes import get_quota

    quota = DailyQuota(per_ip_limit=1, global_limit=100)
    app.dependency_overrides[get_quota] = lambda: quota
    fake, calls = _make_fake_locate_fields()
    app.dependency_overrides[get_locate_fields_fn] = lambda: fake

    files = {"file": ("scan.png", b"\x89PNG fake bytes", "image/png")}
    data = {"values": ["Acme Corp"]}

    assert (await client.post("/locate_fields", files=files, data=data)).status_code == 200
    blocked = await client.post("/locate_fields", files=files, data=data)
    assert blocked.status_code == 429
    assert blocked.json()["detail"]["code"] == "quota_per_ip"
    # The vision model was only invoked for the allowed request.
    assert len(calls) == 1
