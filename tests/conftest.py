"""Shared fixtures for the offline test suite."""

import pytest

from smart_data_extractor.config import get_settings
from smart_data_extractor.extraction.agent import (
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
