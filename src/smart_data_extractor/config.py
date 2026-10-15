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
    # GLM (Zhipu) document parsing model, used for OCR-based PDF/image
    # parsing via the dedicated layout_parsing endpoint (D-031).
    glm_api_key: str | None = None
    glm_model: str = "glm-ocr"
    glm_base_url: str = "https://open.bigmodel.cn/api/paas/v4/"
    # Zhipu rate limiting (issue #13): layout_parsing answers 429 Too Many
    # Requests once concurrent calls exceed the account's allowance.
    # One process-wide semaphore caps in-flight calls; 429s are retried
    # with backoff. Tune both to your account tier.
    glm_ocr_max_concurrency: int = 2
    glm_ocr_max_retries: int = 3
    # DEMO-STAGE quota guard (D-019): caps the daily LLM bill before any
    # public promotion. A limit <= 0 disables that layer. Replace with
    # per-user quotas when the tool goes public.
    daily_quota_per_ip: int = 200
    daily_quota_global: int = 5000
    # Set to enable GET /stats (today's traffic report); unset hides it.
    admin_stats_token: str | None = None
    # User-feedback email channel (POST /feedback): messages from the demo
    # site are delivered to the owner's mailbox via QQ SMTP. SMTP user +
    # password (the QQ mail *authorization code*, not the login password)
    # must be set in the environment or the endpoint answers 503.
    feedback_smtp_host: str = "smtp.qq.com"
    feedback_smtp_port: int = 465
    feedback_smtp_user: str | None = None
    feedback_smtp_password: str | None = None
    feedback_to_email: str = "1309564814@qq.com"
    # Anti-abuse caps for the unauthenticated feedback endpoint; separate
    # from the extraction guard so feedback can't eat extraction budget.
    # A limit <= 0 disables that layer.
    feedback_quota_per_ip: int = 10
    feedback_quota_global: int = 100
    
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
