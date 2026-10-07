"""Batch extraction: fan out with asyncio.gather and aggregate totals.

Concurrency safety comes from the agent layer, not this module: every
production agent shares one process-wide ConcurrencyLimiter (D-006), so
gathering any number of texts cannot exceed the global cap. Do NOT add a
hand-written Semaphore here — per-agent limits would each allow their own
N concurrent runs, defeating the global limit.

Failure semantics (D-007): default is fail-fast; the API layer opts into
per-item tolerance via ``return_exceptions=True``.
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
    instructions: str | None = None,
    return_exceptions: bool = False,
    lang: str | None = None,
) -> dict:
    """Extract structured data from multiple texts concurrently.

    Args:
        texts: The unstructured input texts.
        preset: Name of a registered preset ("contact" / "invoice" / "lead").
        schema_dict: User-defined JSON schema for dynamic extraction.
        model: Optional model override (TestModel for offline tests),
            forwarded to every extract_data call.
        instructions: Optional caller instructions, forwarded to every
            extract_data call.
        return_exceptions: Failure semantics (D-007). False (default):
            fail-fast, the first item exception raises and no partial
            results are returned. True: a failed text becomes an error
            item ``{"data": None, "tokens_used": {"input": 0, "output": 0},
            "cost_usd": 0.0, "error": "<ExcType>: <msg>"}`` and successful
            items carry ``"error": None``; aggregates then count successes
            only (failures contribute zero).
        lang: UI language tag, forwarded to every extract_data call so
            preset field descriptions follow the caller's locale.

    Returns:
        {"results": [extract_data-result per text, in input order],
         "total_cost_usd": float,
         "total_tokens": {"input": int, "output": int}}

    Raises:
        ValueError: If neither or both of preset/schema_dict are given.
            With return_exceptions=False, any per-item extraction error
            propagates (fail-fast).
    """
    if (preset is None) == (schema_dict is None):
        raise ValueError("Exactly one of preset or schema_dict must be provided")

    async def _run(text: str) -> dict:
        try:
            r = await extract_data(
                text, preset, schema_dict, model=model,
                instructions=instructions, lang=lang
            )
        except Exception as exc:
            if not return_exceptions:
                raise
            return {
                "data": None,
                "tokens_used": {"input": 0, "output": 0},
                "cost_usd": 0.0,
                "error": f"{type(exc).__name__}: {exc}",
            }
        return (r | {"error": None}) if return_exceptions else r

    # gather preserves input order; the shared limiter caps concurrency.
    results = await asyncio.gather(*[_run(t) for t in texts])

    return {
        "results": list(results),
        "total_cost_usd": sum(r["cost_usd"] for r in results),
        "total_tokens": {
            "input": sum(r["tokens_used"]["input"] for r in results),
            "output": sum(r["tokens_used"]["output"] for r in results),
        },
    }
