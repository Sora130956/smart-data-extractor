"""HTTP routes: a thin transport layer over the extraction core.

The extraction functions reach the handlers through Depends() so tests can
inject fakes via ``app.dependency_overrides`` (no network, no mocking of
the object under test).
"""

from typing import Any, Callable

from fastapi import APIRouter, Depends, HTTPException

from smart_data_extractor.api.schemas import (
    BatchExtractRequest,
    BatchExtractResponse,
    ExtractRequest,
    ExtractResponse,
)
from smart_data_extractor.extraction import batch_extract, extract_data

router = APIRouter()


def get_extract_fn() -> Callable[..., Any]:
    """DI seam: the single-text extraction function (production default)."""
    return extract_data


def get_batch_fn() -> Callable[..., Any]:
    """DI seam: the batch extraction function (production default)."""
    return batch_extract


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/extract", response_model=ExtractResponse)
async def extract(
    req: ExtractRequest,
    fn: Callable[..., Any] = Depends(get_extract_fn),
) -> dict:
    try:
        return await fn(req.text, req.preset, req.schema_, instructions=req.instructions)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/batch_extract", response_model=BatchExtractResponse)
async def batch(
    req: BatchExtractRequest,
    fn: Callable[..., Any] = Depends(get_batch_fn),
) -> BatchExtractResponse:
    try:
        # The API contract is per-item tolerance (D-007): one bad text must
        # not fail the whole batch.
        result = await fn(
            req.texts,
            req.preset,
            req.schema_,
            instructions=req.instructions,
            return_exceptions=True,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    items = result["results"]
    failed = sum(1 for i in items if i["error"] is not None)
    return BatchExtractResponse(
        results=items,
        total_cost_usd=result["total_cost_usd"],
        total_tokens=result["total_tokens"],
        succeeded=len(items) - failed,
        failed=failed,
    )
