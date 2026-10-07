"""Configuration management for Smart Data Extractor.

Uses pydantic-settings for type-safe configuration loading.
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables.
    
    Automatically loads from .env file if present.
    """
    
    openai_api_key: str
    model: str = "openai:gpt-4o-mini"
    max_concurrency: int = 5
    # Display-currency conversion (approximate static rate, override via env).
    usd_to_cny: float = 7.25
    database_url: str = "sqlite:///./smart_data_extractor.db"
    
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    """Get the global settings instance (cached).
    
    Returns:
        Settings instance with configuration loaded from environment
        
    Raises:
        ValidationError: If required settings are missing or invalid
    """
    return Settings()
