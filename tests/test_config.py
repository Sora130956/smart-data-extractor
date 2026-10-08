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


def test_settings_database_url_default(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.delenv("DATABASE_URL", raising=False)
    get_settings.cache_clear()
    assert get_settings().database_url == "sqlite:///./smart_data_extractor.db"


def test_settings_database_url_override(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("DATABASE_URL", "sqlite:////tmp/test.db")
    get_settings.cache_clear()
    assert get_settings().database_url == "sqlite:////tmp/test.db"


def test_settings_glm_api_key_default_none(monkeypatch):
    """Test glm_api_key defaults to None when not set."""
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.delenv("GLM_API_KEY", raising=False)
    get_settings.cache_clear()
    assert get_settings().glm_api_key is None


def test_settings_glm_api_key_override(monkeypatch):
    """Test glm_api_key can be set via GLM_API_KEY."""
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("GLM_API_KEY", "glm-test-key")
    get_settings.cache_clear()
    assert get_settings().glm_api_key == "glm-test-key"


def test_settings_glm_model_default(monkeypatch):
    """Test glm_model defaults to glm-4v-flash."""
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.delenv("GLM_MODEL", raising=False)
    get_settings.cache_clear()
    assert get_settings().glm_model == "glm-4v-flash"


def test_settings_glm_model_override(monkeypatch):
    """Test glm_model can be overridden via GLM_MODEL."""
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("GLM_MODEL", "glm-4.5v")
    get_settings.cache_clear()
    assert get_settings().glm_model == "glm-4.5v"


def test_settings_glm_base_url_default(monkeypatch):
    """Test glm_base_url defaults to the Zhipu OpenAI-compatible endpoint."""
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.delenv("GLM_BASE_URL", raising=False)
    get_settings.cache_clear()
    assert get_settings().glm_base_url == "https://open.bigmodel.cn/api/paas/v4/"


def test_settings_glm_base_url_override(monkeypatch):
    """Test glm_base_url can be overridden via GLM_BASE_URL."""
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("GLM_BASE_URL", "https://example.com/v1/")
    get_settings.cache_clear()
    assert get_settings().glm_base_url == "https://example.com/v1/"
