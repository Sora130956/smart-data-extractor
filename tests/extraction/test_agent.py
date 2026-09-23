"""Tests for extraction.agent: cached preset agents and shared limiter."""

import pytest
from pydantic_ai.models.test import TestModel

from smart_data_extractor.config import get_settings
from smart_data_extractor.extraction.agent import (
    build_agent,
    get_preset_agent,
    shared_concurrency_limiter,
)


@pytest.fixture
def fake_openai_env(monkeypatch):
    """Fake API key so production-path agent construction works offline.

    Construction is eager (provider + httpx client) but performs no network
    I/O. Caches are cleared around each test to prevent cross-test state.
    """
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    get_settings.cache_clear()
    get_preset_agent.cache_clear()
    shared_concurrency_limiter.cache_clear()
    yield
    get_preset_agent.cache_clear()
    shared_concurrency_limiter.cache_clear()
    get_settings.cache_clear()


def test_get_preset_agent_returns_cached_instance(fake_openai_env):
    """Same preset + model_ref returns the same Agent (shared HTTP pool)."""
    a1 = get_preset_agent("contact", "openai:gpt-4o-mini")
    a2 = get_preset_agent("contact", "openai:gpt-4o-mini")
    assert a1 is a2


def test_get_preset_agent_differs_across_presets(fake_openai_env):
    """Different presets get different cached agents."""
    contact_agent = get_preset_agent("contact", "openai:gpt-4o-mini")
    invoice_agent = get_preset_agent("invoice", "openai:gpt-4o-mini")
    assert contact_agent is not invoice_agent


def test_cached_agent_sets_zero_temperature(fake_openai_env):
    """Extraction agents run deterministic: temperature reaches the Agent."""
    agent = get_preset_agent("contact", "openai:gpt-4o-mini")
    assert agent.model_settings.get("temperature") == 0


def test_cached_agent_shares_process_wide_limiter(fake_openai_env):
    """Preset agents share one ConcurrencyLimiter (limit = max_concurrency)."""
    contact_agent = get_preset_agent("contact", "openai:gpt-4o-mini")
    lead_agent = get_preset_agent("lead", "openai:gpt-4o-mini")
    limiter = shared_concurrency_limiter()
    assert contact_agent._concurrency_limiter is limiter
    assert lead_agent._concurrency_limiter is limiter


def test_build_agent_creates_fresh_instances():
    """The uncached builder (injected/dynamic path) always returns new agents."""
    m = TestModel()
    assert build_agent(dict, model=m) is not build_agent(dict, model=m)
