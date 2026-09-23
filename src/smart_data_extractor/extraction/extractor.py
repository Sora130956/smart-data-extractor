"""Single-text extraction."""

from typing import Any

from pydantic_ai.usage import RunUsage

from smart_data_extractor.config import get_settings
from smart_data_extractor.extraction.agent import (
    build_agent,
    get_preset_agent,
    shared_concurrency_limiter,
)
from smart_data_extractor.extraction.cost import calculate_cost
from smart_data_extractor.models import create_dynamic_model
from smart_data_extractor.presets import get_preset

DYNAMIC_PROMPT = """\
Extract the fields defined by the output schema from the input text.

Rules:
- Missing fields return null.
- Provide a confidence score between 0.0 and 1.0 for each field:
  1.0 = explicitly stated and unambiguous, 0.0 = not found.
"""

# genai-prices reference used when the injected model has no usable ref
# (e.g. TestModel in offline tests). Matches the default production model.
DEFAULT_MODEL_REF = "gpt-4o-mini"


def _resolve_cost(usage: RunUsage, *, model: Any, model_ref: str | None) -> float:
    """Resolve the USD cost of a run.

    pydantic-ai auto-fills ``usage.cost`` (best-effort, via genai_prices)
    whenever the model can be priced, so production runs need no manual
    lookup. Only unpriced runs (e.g. TestModel) fall back to calc_price.
    """
    if usage.cost is not None:
        return float(usage.cost)
    return calculate_cost(usage, model_ref=_resolve_model_ref(model, model_ref))


def _resolve_model_ref(model: Any, model_ref: str | None) -> str:
    """Resolve a genai-prices model ref from an explicit ref or the model.

    String model refs like "openai:gpt-4o-mini" lose their provider prefix;
    model instances without a ref fall back to DEFAULT_MODEL_REF.
    """
    if model_ref is not None:
        return model_ref.split(":", 1)[-1]
    if isinstance(model, str):
        return model.split(":", 1)[-1]
    return DEFAULT_MODEL_REF


async def extract_data(
    text: str,
    preset: str | None = None,
    schema_dict: dict | None = None,
    *,
    model: Any = None,
    model_ref: str | None = None,
) -> dict:
    """Extract structured data from a single text.

    Exactly one of ``preset`` or ``schema_dict`` must be provided.

    Args:
        text: The unstructured input text.
        preset: Name of a registered preset ("contact" / "invoice" / "lead").
        schema_dict: User-defined JSON schema for dynamic extraction.
        model: Optional model override (TestModel for offline tests).
            When None, the configured model from settings is used.
        model_ref: Optional genai-prices ref override for cost tracking.

    Returns:
        {"data": {...}, "tokens_used": {"input": int, "output": int},
         "cost_usd": float}

    Raises:
        ValueError: If neither or both of preset/schema_dict are given,
            or the preset name is unknown.
    """
    if (preset is None) == (schema_dict is None):
        raise ValueError("Exactly one of preset or schema_dict must be provided")

    if preset is not None:
        p = get_preset(preset)
        if model is None:
            # Production path: cached agent (shared pool + shared limiter)
            agent = get_preset_agent(p.name, get_settings().model)
        else:
            agent = build_agent(p.model_class, model=model, instructions=p.prompt_template)
    else:
        output_type = create_dynamic_model(schema_dict)
        if model is None:
            agent = build_agent(
                output_type,
                model=get_settings().model,
                instructions=DYNAMIC_PROMPT,
                limiter=shared_concurrency_limiter(),
            )
        else:
            agent = build_agent(output_type, model=model, instructions=DYNAMIC_PROMPT)

    result = await agent.run(text)
    usage = result.usage

    return {
        "data": result.output.model_dump(),
        "tokens_used": {
            "input": usage.input_tokens,
            "output": usage.output_tokens,
        },
        "cost_usd": _resolve_cost(usage, model=model, model_ref=model_ref),
    }
