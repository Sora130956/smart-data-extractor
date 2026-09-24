"""Batch extraction: fan out with asyncio.gather and aggregate totals.

Concurrency safety comes from the agent layer, not this module: every
production agent shares one process-wide ConcurrencyLimiter (D-006), so
gathering any number of texts cannot exceed the global cap. Do NOT add a
hand-written Semaphore here — per-agent limits would each allow their own
N concurrent runs, defeating the global limit.
"""

import asyncio
from typing import Any

from smart_data_extractor.extraction.extractor import extract_data


async def batch_extract(
    texts: list[str],
    preset: str | None = None,
    schema_dict: dict | None = None,
    *,
    model: Any = None,
) -> dict:
    """Extract structured data from multiple texts concurrently.

    Args:
        texts: The unstructured input texts.
        preset: Name of a registered preset ("contact" / "invoice" / "lead").
        schema_dict: User-defined JSON schema for dynamic extraction.
        model: Optional model override (TestModel for offline tests),
            forwarded to every extract_data call.

    Returns:
        {"results": [extract_data-result per text, in input order],
         "total_cost_usd": float,
         "total_tokens": {"input": int, "output": int}}

    Raises:
        ValueError: If neither or both of preset/schema_dict are given,
            or the preset name is unknown.
    """
    if (preset is None) == (schema_dict is None):
        raise ValueError("Exactly one of preset or schema_dict must be provided")

    # gather preserves input order; the shared limiter caps concurrency.
    results = await asyncio.gather(
        *[extract_data(t, preset, schema_dict, model=model) for t in texts]
    )

    return {
        "results": list(results),
        "total_cost_usd": sum(r["cost_usd"] for r in results),
        "total_tokens": {
            "input": sum(r["tokens_used"]["input"] for r in results),
            "output": sum(r["tokens_used"]["output"] for r in results),
        },
    }
