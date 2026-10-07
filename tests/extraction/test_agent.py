"""Tests for extraction.agent: cached preset agents and shared limiter."""

import pytest
from pydantic_ai.models.test import TestModel

from smart_data_extractor.extraction.agent import (
    build_agent,
    get_preset_agent,
    shared_concurrency_limiter,
)


def test_get_preset_agent_returns_cached_instance(fake_openai_env, test_db):
    """Same preset + model_ref returns the same Agent (shared HTTP pool)."""
    a1 = get_preset_agent("contact", "openai:gpt-4o-mini")
    a2 = get_preset_agent("contact", "openai:gpt-4o-mini")
    assert a1 is a2


def test_get_preset_agent_differs_across_presets(fake_openai_env, test_db):
    """Different presets get different cached agents."""
    contact_agent = get_preset_agent("contact", "openai:gpt-4o-mini")
    invoice_agent = get_preset_agent("invoice", "openai:gpt-4o-mini")
    assert contact_agent is not invoice_agent


def test_cached_agent_sets_zero_temperature(fake_openai_env, test_db):
    """Extraction agents run deterministic: temperature reaches the Agent."""
    agent = get_preset_agent("contact", "openai:gpt-4o-mini")
    assert agent.model_settings.get("temperature") == 0


def test_cached_agent_shares_process_wide_limiter(fake_openai_env, test_db):
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
