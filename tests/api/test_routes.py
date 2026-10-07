"""Tests for the FastAPI transport layer.

Offline: the extraction functions are replaced via dependency_overrides
(workspace testing discipline: inject fakes, never mock the object under
test, never hit the network).
"""

import httpx
import pytest

from smart_data_extractor.api import create_app
from smart_data_extractor.api.routes import get_batch_fn, get_extract_fn, get_schema_resolve_fn


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
        text, preset=None, schema_dict=None, *, model=None, model_ref=None, instructions=None
    ):
        calls.append(
            {"text": text, "preset": preset, "schema_dict": schema_dict, "instructions": instructions}
        )
        if fail_with is not None:
            raise fail_with
        return _extract_result(text)

    return fake_extract, calls


def _make_fake_batch():
    """Fake batch_extract honoring the Phase 4 tolerant-mode contract:
    texts equal to "bad" come back as error items."""
    calls = []

    async def fake_batch(
        texts, preset=None, schema_dict=None, *, model=None, instructions=None, return_exceptions=False
    ):
        calls.append(
            {"texts": list(texts), "instructions": instructions, "return_exceptions": return_exceptions}
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
        {"text": "John Smith", "preset": "contact", "schema_dict": None, "instructions": "be strict"}
    ]


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
