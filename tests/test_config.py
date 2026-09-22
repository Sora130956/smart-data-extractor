"""Tests for config.py"""

import pytest
from pydantic import ValidationError

from smart_data_extractor.config import Settings, get_settings


def test_settings_with_api_key(monkeypatch):
    """Test Settings loads with required OPENAI_API_KEY."""
    monkeypatch.setenv("OPENAI_API_KEY", "test-key-123")
    
    # Clear lru_cache to force reload
    get_settings.cache_clear()
    
    settings = get_settings()
    assert settings.openai_api_key == "test-key-123"
    assert settings.model == "openai:gpt-4o-mini"
    assert settings.max_concurrency == 5


def test_settings_missing_api_key_raises(monkeypatch):
    """Test Settings raises ValidationError when OPENAI_API_KEY is missing."""
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    
    get_settings.cache_clear()
    
    with pytest.raises(ValidationError) as exc_info:
        get_settings()
    
    # Check that the error is about openai_api_key field
    errors = exc_info.value.errors()
    assert any(error["loc"] == ("openai_api_key",) for error in errors)


def test_settings_model_default(monkeypatch):
    """Test model defaults to gpt-4o-mini when MODEL is not set."""
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.delenv("MODEL", raising=False)
    
    get_settings.cache_clear()
    
    settings = get_settings()
    assert settings.model == "openai:gpt-4o-mini"


def test_settings_model_override(monkeypatch):
    """Test model can be overridden via MODEL environment variable."""
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("MODEL", "openai:gpt-4o")
    
    get_settings.cache_clear()
    
    settings = get_settings()
    assert settings.model == "openai:gpt-4o"


def test_settings_max_concurrency_default(monkeypatch):
    """Test max_concurrency defaults to 5."""
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.delenv("MAX_CONCURRENCY", raising=False)
    
    get_settings.cache_clear()
    
    settings = get_settings()
    assert settings.max_concurrency == 5


def test_settings_max_concurrency_override(monkeypatch):
    """Test max_concurrency can be overridden via MAX_CONCURRENCY."""
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("MAX_CONCURRENCY", "10")
    
    get_settings.cache_clear()
    
    settings = get_settings()
    assert settings.max_concurrency == 10


def test_settings_max_concurrency_invalid_raises(monkeypatch):
    """Test invalid MAX_CONCURRENCY raises ValidationError."""
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("MAX_CONCURRENCY", "not-a-number")
    
    get_settings.cache_clear()
    
    with pytest.raises(ValidationError) as exc_info:
        get_settings()
    
    errors = exc_info.value.errors()
    assert any(error["loc"] == ("max_concurrency",) for error in errors)


def test_get_settings_cached(monkeypatch):
    """Test get_settings returns cached instance."""
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    
    get_settings.cache_clear()
    
    settings1 = get_settings()
    settings2 = get_settings()
    
    # Should be the same instance due to lru_cache
    assert settings1 is settings2
