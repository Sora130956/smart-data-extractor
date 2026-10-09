"""Shared fixtures for the offline test suite."""

import pytest

from smart_data_extractor.config import get_settings
from smart_data_extractor.extraction.agent import (
    get_preset_agent,
    shared_concurrency_limiter,
)
from smart_data_extractor.api.routes import get_quota


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
    get_quota.cache_clear()
    yield
    get_preset_agent.cache_clear()
    shared_concurrency_limiter.cache_clear()
    get_settings.cache_clear()
    get_quota.cache_clear()


@pytest.fixture
def test_db(tmp_path, monkeypatch):
    """Per-test seeded SQLite database in a temp file.

    Uses a file (not :memory:) so engine/session connections all see the
    same database. Cache clears ensure settings/engine pick up the env var.
    """
    from smart_data_extractor.db import init_db, reset_db_caches

    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/test.db")
    get_settings.cache_clear()
    reset_db_caches()
    init_db()
    yield
    reset_db_caches()
    get_settings.cache_clear()
