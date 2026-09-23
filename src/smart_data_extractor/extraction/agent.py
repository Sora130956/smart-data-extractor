"""Agent construction: bind a model to an output type.

Production preset agents are cached (lru_cache) so repeated extractions
reuse the same HTTP connection pool and one process-wide concurrency
limiter. Injected models (tests) and dynamic schemas are built fresh.
"""

from functools import lru_cache
from typing import Any, Type

from pydantic import BaseModel
from pydantic_ai import Agent, ConcurrencyLimiter
from pydantic_ai.settings import ModelSettings

from smart_data_extractor.presets import get_preset


def build_agent(
    output_type: Type[BaseModel],
    *,
    model: Any,
    instructions: str | None = None,
    limiter: ConcurrencyLimiter | None = None,
) -> Agent:
    """Build a fresh (uncached) agent.

    Used for injected models (offline tests) and user-defined dynamic
    schemas, whose unbounded variety makes caching unsafe (memory leak).

    Args:
        output_type: The Pydantic model the agent must produce.
        model: A model reference ("openai:gpt-4o-mini") or a model
            instance (e.g. TestModel for offline tests).
        instructions: System-level extraction instructions.
        limiter: Optional shared concurrency limiter for production runs.
    """
    return Agent(
        model,
        output_type=output_type,
        instructions=instructions,
        model_settings=ModelSettings(temperature=0),  # deterministic extraction
        max_concurrency=limiter,
    )


@lru_cache(maxsize=1)
def shared_concurrency_limiter() -> ConcurrencyLimiter:
    """Process-wide limiter shared by all production agents.

    The limit comes from settings.max_concurrency. Sharing one limiter
    across preset and dynamic agents enforces a true global cap, unlike
    per-agent limits which would each allow their own N concurrent runs.
    """
    from smart_data_extractor.config import get_settings

    return ConcurrencyLimiter(get_settings().max_concurrency)


@lru_cache(maxsize=None)
def get_preset_agent(preset_name: str, model_ref: str) -> Agent:
    """Cached production agent for a preset.

    Keyed by (preset_name, model_ref) strings — bounded by 3 presets x
    a handful of model refs, so unbounded growth is impossible. Caching
    reuses the underlying AsyncOpenAI client (connection pooling) and
    shares the process-wide concurrency limiter.
    """
    p = get_preset(preset_name)
    return Agent(
        model_ref,
        output_type=p.model_class,
        instructions=p.prompt_template,
        model_settings=ModelSettings(temperature=0),
        max_concurrency=shared_concurrency_limiter(),
    )
