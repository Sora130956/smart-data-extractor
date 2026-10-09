"""Tests for the demo-stage daily quota guard (D-019).

Two layers over every LLM-costing endpoint: per client IP (default
50/day) and global (default 1000/day), in-memory, auto-reset at UTC
midnight. Offline: quota instances are injected via dependency_overrides,
extraction functions via the existing DI seams.
"""

from datetime import date, datetime, timezone

import httpx
import pytest
from fastapi import HTTPException, Request

from smart_data_extractor.api import create_app
from smart_data_extractor.api.quota import DailyQuota
from smart_data_extractor.api.routes import (
    get_batch_fn,
    get_extract_fn,
    get_quota,
)
from smart_data_extractor.config import get_settings


def make_request(
    ip: str | None = "9.9.9.9",
    xff: str | None = None,
    path: str = "/extract",
) -> Request:
    """Build a minimal ASGI Request without a server."""
    headers = []
    if xff is not None:
        headers.append((b"x-forwarded-for", xff.encode()))
    scope = {
        "type": "http",
        "method": "POST",
        "path": path,
        "headers": headers,
        "query_string": b"",
    }
    if ip is not None:
        scope["client"] = (ip, 1234)
    return Request(scope)


def make_fake_extract():
    calls = []

    async def fake_extract(
        text, preset=None, schema_dict=None, *, model=None, model_ref=None,
        instructions=None, lang=None
    ):
        calls.append(text)
        return {
            "data": {"name": text},
            "tokens_used": {"input": 1, "output": 1},
            "cost_usd": 0.0,
        }

    return fake_extract, calls


def make_fake_batch():
    calls = []

    async def fake_batch(
        texts, preset=None, schema_dict=None, *, model=None,
        instructions=None, return_exceptions=False, lang=None
    ):
        calls.append(list(texts))
        return {
            "results": [
                {"data": {}, "tokens_used": {"input": 1, "output": 1},
                 "cost_usd": 0.0, "error": None}
                for _ in texts
            ],
            "total_cost_usd": 0.0,
            "total_tokens": {"input": 1, "output": 1},
        }

    return fake_batch, calls


class TestDailyQuotaUnit:
    def test_per_ip_limit_raises_friendly_429_after_limit(self):
        quota = DailyQuota(per_ip_limit=2, global_limit=10)
        req = make_request(ip="1.1.1.1")
        quota.spend(req)
        quota.spend(req)
        with pytest.raises(HTTPException) as exc_info:
            quota.spend(req)
        assert exc_info.value.status_code == 429
        detail = exc_info.value.detail
        assert detail["code"] == "quota_per_ip"
        # Friendly message: names the limit and the reset time.
        assert "2" in detail["message"]
        assert "UTC" in detail["message"]
        assert detail["reset_at"] == "00:00 UTC"

    def test_per_ip_limit_is_isolated_between_ips(self):
        quota = DailyQuota(per_ip_limit=1, global_limit=10)
        quota.spend(make_request(ip="1.1.1.1"))
        # A different IP is unaffected.
        quota.spend(make_request(ip="2.2.2.2"))

    def test_global_limit_blocks_even_fresh_ips(self):
        quota = DailyQuota(per_ip_limit=10, global_limit=2)
        quota.spend(make_request(ip="1.1.1.1"))
        quota.spend(make_request(ip="2.2.2.2"))
        with pytest.raises(HTTPException) as exc_info:
            quota.spend(make_request(ip="3.3.3.3"))
        assert exc_info.value.status_code == 429
        assert exc_info.value.detail["code"] == "quota_global"

    def test_utc_rollover_resets_all_counters(self):
        current = {"day": date(2026, 10, 9)}

        def fake_clock() -> date:
            return current["day"]

        quota = DailyQuota(per_ip_limit=1, global_limit=2, clock=fake_clock)
        quota.spend(make_request(ip="1.1.1.1"))
        with pytest.raises(HTTPException):
            quota.spend(make_request(ip="1.1.1.1"))
        # Next UTC day: everything resets.
        current["day"] = date(2026, 10, 10)
        quota.spend(make_request(ip="1.1.1.1"))
        quota.spend(make_request(ip="2.2.2.2"))

    def test_client_ip_prefers_first_xff_entry(self):
        req = make_request(ip="9.9.9.9", xff="1.2.3.4, 10.0.0.1")
        assert DailyQuota.client_ip(req) == "1.2.3.4"

    def test_client_ip_falls_back_to_peer_then_unknown(self):
        assert DailyQuota.client_ip(make_request(ip="9.9.9.9")) == "9.9.9.9"
        assert DailyQuota.client_ip(make_request(ip=None)) == "unknown"

    def test_endpoint_label_strips_api_prefix(self):
        assert DailyQuota.endpoint(make_request(path="/api/batch_extract")) == "batch_extract"
        assert DailyQuota.endpoint(make_request(path="/parse_pdf")) == "parse_pdf"

    def test_snapshot_reports_owner_facing_usage(self):
        quota = DailyQuota(per_ip_limit=50, global_limit=1000)
        quota.spend(make_request(ip="1.1.1.1", path="/api/extract"))
        quota.spend(make_request(ip="1.1.1.1", path="/api/extract"))
        quota.spend(make_request(ip="2.2.2.2", path="/parse_pdf"))
        snap = quota.snapshot()
        assert snap["global_used"] == 3
        assert snap["unique_ips"] == 2
        assert snap["per_endpoint"] == {"extract": 2, "parse_pdf": 1}
        assert snap["global_limit"] == 1000
        assert snap["per_ip_limit"] == 50

    def test_zero_limit_disables_that_layer(self):
        quota = DailyQuota(per_ip_limit=0, global_limit=0)
        for _ in range(5):
            quota.spend(make_request(ip="1.1.1.1"))

    def test_default_settings_match_demo_limits(self, fake_openai_env):
        settings = get_settings()
        assert settings.daily_quota_per_ip == 50
        assert settings.daily_quota_global == 1000
        assert settings.admin_stats_token is None


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


def _install_quota(app, *, per_ip: int, global_: int) -> DailyQuota:
    quota = DailyQuota(per_ip_limit=per_ip, global_limit=global_)
    app.dependency_overrides[get_quota] = lambda: quota
    return quota


class TestQuotaViaApi:
    async def test_extract_returns_429_after_per_ip_limit(self, client, app):
        _install_quota(app, per_ip=2, global_=100)
        fn, calls = make_fake_extract()
        app.dependency_overrides[get_extract_fn] = lambda: fn

        payload = {"text": "John Smith", "preset": "contact"}
        assert (await client.post("/api/extract", json=payload)).status_code == 200
        assert (await client.post("/api/extract", json=payload)).status_code == 200

        blocked = await client.post("/api/extract", json=payload)
        assert blocked.status_code == 429
        assert blocked.json()["detail"]["code"] == "quota_per_ip"
        # The LLM was only invoked for the two allowed requests.
        assert len(calls) == 2

    async def test_batch_spends_one_unit_per_text_and_rejects_first(
        self, client, app
    ):
        _install_quota(app, per_ip=2, global_=100)
        fn, calls = make_fake_batch()
        app.dependency_overrides[get_batch_fn] = lambda: fn

        resp = await client.post(
            "/api/batch_extract",
            json={"texts": ["a", "b", "c"], "preset": "contact"},
        )
        assert resp.status_code == 429
        assert resp.json()["detail"]["code"] == "quota_per_ip"
        # Rejected before any LLM work.
        assert calls == []

        # A single-text batch fits the 2/day budget.
        ok = await client.post(
            "/api/batch_extract", json={"texts": ["a"], "preset": "contact"}
        )
        assert ok.status_code == 200

    async def test_stats_hidden_when_token_not_configured(
        self, client, app, monkeypatch
    ):
        monkeypatch.delenv("ADMIN_STATS_TOKEN", raising=False)
        get_settings.cache_clear()
        resp = await client.get("/api/stats")
        assert resp.status_code == 404

    async def test_stats_requires_correct_token_then_reports_usage(
        self, client, app, monkeypatch
    ):
        monkeypatch.setenv("ADMIN_STATS_TOKEN", "sekrit")
        get_settings.cache_clear()
        _install_quota(app, per_ip=50, global_=1000)
        fn, _ = make_fake_extract()
        app.dependency_overrides[get_extract_fn] = lambda: fn

        assert (
            await client.post("/api/extract", json={"text": "x", "preset": "contact"})
        ).status_code == 200

        wrong = await client.get("/api/stats", params={"token": "nope"})
        assert wrong.status_code == 401

        ok = await client.get("/api/stats", params={"token": "sekrit"})
        assert ok.status_code == 200
        body = ok.json()
        assert body["global_used"] == 1
        assert body["unique_ips"] == 1
        assert body["per_endpoint"] == {"extract": 1}
        assert body["date"] == datetime.now(timezone.utc).date().isoformat()
