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
    # Requests (error 1302, an account request-FREQUENCY limit) once calls
    # arrive faster than the account allows. One process-wide semaphore
    # caps in-flight calls; a process-wide pacer spaces request starts at
    # least glm_ocr_min_request_interval seconds apart (0 disables),
    # doubling after each 429 and decaying after each success; 429s are
    # retried with backoff. Tune to your account tier.
    glm_ocr_max_concurrency: int = 2
    glm_ocr_max_retries: int = 3
    glm_ocr_min_request_interval: float = 1.0
    # Row-level OCR confidence (D-046): glm-ocr returns no confidence, so
    # each image / rendered PDF page is also sent to Zhipu's
    # POST /files/ocr (tool_type=hand_write, probability=true). Its
    # per-row min probability is fused with the LLM self-rating at
    # extraction time. Has its own concurrency cap and request pacer
    # (a different endpoint with its own account limits). A failed call
    # degrades to "no OCR signal" — it never fails a parse.
    glm_ocr_confidence_enabled: bool = True
    glm_hand_write_max_concurrency: int = 2
    glm_hand_write_min_request_interval: float = 1.0
    # DEMO-STAGE quota guard (D-019): caps the daily LLM bill before any
    # public promotion. A limit <= 0 disables that layer. Replace with
    # per-user quotas when the tool goes public.
    daily_quota_per_ip: int = 200
    daily_quota_global: int = 5000
    # Set to enable GET /stats (today's traffic report); unset hides it.
    admin_stats_token: str | None = None
    # User-feedback email channel (POST /feedback): messages from the demo
    # site are delivered to the owner's mailbox via the Resend HTTP API
    # (SMTP ports are blocked on Render's free tier). RESEND_API_KEY must be
    # set in the environment or the endpoint answers 503. The default
    # sender is Resend's shared test address, which can only deliver to the
    # Resend account's own email; set FEEDBACK_FROM_EMAIL to an address on a
    # verified domain to lift that restriction.
    resend_api_key: str | None = None
    feedback_from_email: str = "onboarding@resend.dev"
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
