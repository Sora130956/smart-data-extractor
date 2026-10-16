"""Tests for the user-feedback email channel (POST /feedback).

Offline: delivery is injected via dependency_overrides (workspace testing
discipline — never mock the object under test, never hit the network).
The real Resend HTTP path is covered by monkeypatching httpx.post at the
module boundary, which is never invoked in these tests otherwise.
"""

import logging

import httpx
import pytest

from smart_data_extractor.api import create_app
from smart_data_extractor.api.feedback import (
    FeedbackError,
    deliver_feedback,
    get_deliver_feedback_fn,
)
from smart_data_extractor.api.quota import DailyQuota
from smart_data_extractor.api.routes import get_feedback_quota
from smart_data_extractor.config import get_settings


@pytest.fixture
def app(fake_openai_env):
    app = create_app()
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


def make_fake_deliver(fail_with: FeedbackError | None = None):
    calls = []

    def fake_deliver(message, contact, requester_ip):
        calls.append(
            {"message": message, "contact": contact, "requester_ip": requester_ip}
        )
        if fail_with is not None:
            raise fail_with
        return {"ok": True}

    return fake_deliver, calls


async def test_feedback_delivers_message_and_returns_ok(client, app, caplog):
    fn, calls = make_fake_deliver()
    app.dependency_overrides[get_deliver_feedback_fn] = lambda: fn

    with caplog.at_level(logging.INFO, logger="smart_data_extractor.api.routes"):
        resp = await client.post(
            "/api/feedback",
            json={"message": "Excel export is broken", "contact": "user@example.com"},
            headers={"x-forwarded-for": "1.2.3.4"},
        )

    assert resp.status_code == 200
    assert resp.json() == {"ok": True}
    assert calls == [
        {
            "message": "Excel export is broken",
            "contact": "user@example.com",
            "requester_ip": "1.2.3.4",
        }
    ]
    # Receipt is logged for the owner — length only, never the content
    # (sender privacy).
    feedback_logs = [
        r.message
        for r in caplog.records
        if r.message.startswith("FEEDBACK")
    ]
    assert feedback_logs == ["FEEDBACK ip=1.2.3.4 chars=22"]


async def test_feedback_accepts_message_without_contact(client, app):
    fn, calls = make_fake_deliver()
    app.dependency_overrides[get_deliver_feedback_fn] = lambda: fn

    resp = await client.post("/api/feedback", json={"message": "love it"})

    assert resp.status_code == 200
    assert calls[0]["contact"] is None


@pytest.mark.parametrize(
    "payload",
    [
        {"message": ""},
        {"message": "   "},
        {"message": "x" * 2001},
        {"message": "hi", "contact": "y" * 201},
    ],
)
async def test_feedback_rejects_malformed_payloads(client, app, payload):
    resp = await client.post("/api/feedback", json=payload)
    assert resp.status_code == 422


async def test_feedback_is_rate_limited_per_ip(client, app):
    quota = DailyQuota(per_ip_limit=1, global_limit=100)
    app.dependency_overrides[get_feedback_quota] = lambda: quota
    fn, _ = make_fake_deliver()
    app.dependency_overrides[get_deliver_feedback_fn] = lambda: fn

    first = await client.post("/api/feedback", json={"message": "one"})
    assert first.status_code == 200

    second = await client.post("/api/feedback", json={"message": "two"})
    assert second.status_code == 429
    assert second.json()["detail"]["code"] == "feedback_quota"


async def test_feedback_503_when_resend_not_configured(client, app, monkeypatch):
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    get_settings.cache_clear()

    resp = await client.post("/api/feedback", json={"message": "hi"})

    assert resp.status_code == 503
    assert resp.json()["detail"]["code"] == "feedback_not_configured"


async def test_feedback_502_when_delivery_fails(client, app):
    fn, _ = make_fake_deliver(
        fail_with=FeedbackError(
            "feedback_send_failed", "Mail provider rejected the message"
        )
    )
    app.dependency_overrides[get_deliver_feedback_fn] = lambda: fn

    resp = await client.post("/api/feedback", json={"message": "hi"})

    assert resp.status_code == 502
    assert resp.json()["detail"]["code"] == "feedback_send_failed"


class TestDeliverFeedbackUnit:
    """The real sender, with httpx.post faked at the module boundary."""

    @pytest.fixture
    def resend_env(self, fake_openai_env, monkeypatch):
        monkeypatch.setenv("RESEND_API_KEY", "re_test_key")
        monkeypatch.setenv("FEEDBACK_TO_EMAIL", "owner@example.com")
        monkeypatch.delenv("FEEDBACK_FROM_EMAIL", raising=False)
        get_settings.cache_clear()
        yield
        get_settings.cache_clear()

    @staticmethod
    def fake_post(calls, status_code=200, body=None):
        def post(url, **kwargs):
            calls.append({"url": url, **kwargs})
            return httpx.Response(
                status_code,
                json=body if body is not None else {"id": "email-id"},
                request=httpx.Request("POST", url),
            )

        return post

    def test_sends_email_via_resend_http_api(self, resend_env, monkeypatch):
        import smart_data_extractor.api.feedback as feedback_module

        calls = []
        monkeypatch.setattr(feedback_module.httpx, "post", self.fake_post(calls))

        result = deliver_feedback(
            "the OCR misses tables", "reporter@example.com", "5.6.7.8"
        )

        assert result == {"ok": True}
        assert len(calls) == 1
        call = calls[0]
        assert call["url"] == "https://api.resend.com/emails"
        assert call["headers"]["Authorization"] == "Bearer re_test_key"
        payload = call["json"]
        assert payload["from"] == "onboarding@resend.dev"
        assert payload["to"] == ["owner@example.com"]
        assert payload["subject"] == "[Smart Data Extractor] User Feedback"
        assert "the OCR misses tables" in payload["text"]
        assert "reporter@example.com" in payload["text"]
        assert "5.6.7.8" in payload["text"]
        assert call["timeout"] == 15

    def test_raises_not_configured_before_any_network(
        self, fake_openai_env, monkeypatch
    ):
        monkeypatch.delenv("RESEND_API_KEY", raising=False)
        get_settings.cache_clear()

        def explode(*args, **kwargs):
            raise AssertionError("must not open a network connection")

        import smart_data_extractor.api.feedback as feedback_module

        monkeypatch.setattr(feedback_module.httpx, "post", explode)

        with pytest.raises(FeedbackError) as exc_info:
            deliver_feedback("hi", None, "1.1.1.1")
        assert exc_info.value.code == "feedback_not_configured"

    def test_wraps_provider_rejection_as_feedback_error(
        self, resend_env, monkeypatch
    ):
        import smart_data_extractor.api.feedback as feedback_module

        calls = []
        monkeypatch.setattr(
            feedback_module.httpx,
            "post",
            self.fake_post(calls, status_code=403, body={"message": "bad key"}),
        )

        with pytest.raises(FeedbackError) as exc_info:
            deliver_feedback("hi", None, "1.1.1.1")
        assert exc_info.value.code == "feedback_send_failed"

    def test_wraps_network_errors_as_feedback_error(self, resend_env, monkeypatch):
        import smart_data_extractor.api.feedback as feedback_module

        def broken_post(url, **kwargs):
            raise httpx.ConnectError("unreachable")

        monkeypatch.setattr(feedback_module.httpx, "post", broken_post)

        with pytest.raises(FeedbackError) as exc_info:
            deliver_feedback("hi", None, "1.1.1.1")
        assert exc_info.value.code == "feedback_send_failed"

    def test_failure_logs_no_message_content(self, resend_env, monkeypatch, caplog):
        import smart_data_extractor.api.feedback as feedback_module

        def broken_post(url, **kwargs):
            raise httpx.ConnectError("boom")

        monkeypatch.setattr(feedback_module.httpx, "post", broken_post)

        with caplog.at_level(logging.WARNING, logger="smart_data_extractor.api.feedback"):
            with pytest.raises(FeedbackError):
                deliver_feedback("secret content", None, "1.1.1.1")

        assert any(r.message.startswith("FEEDBACK_SEND_FAILED") for r in caplog.records)
        assert "secret content" not in caplog.text
