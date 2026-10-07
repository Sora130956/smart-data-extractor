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
    PresetListItem,
    PresetSchemaResponse,
    SchemaResolveRequest,
    SchemaResolveResponse,
)
from smart_data_extractor.config import get_settings
from smart_data_extractor.extraction import batch_extract, extract_data, resolve_schema
from smart_data_extractor.presets import get_preset_fields, list_presets

router = APIRouter()


def _to_cny(usd: float) -> float:
    """Convert a USD cost to CNY for display (approximate static rate)."""
    return round(usd * get_settings().usd_to_cny, 6)


def get_extract_fn() -> Callable[..., Any]:
    """DI seam: the single-text extraction function (production default)."""
    return extract_data


def get_batch_fn() -> Callable[..., Any]:
    """DI seam: the batch extraction function (production default)."""
    return batch_extract


def get_schema_resolve_fn() -> Callable[..., Any]:
    """DI seam: the field-name resolution function (production default)."""
    return resolve_schema


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/presets", response_model=list[PresetListItem])
async def presets_list() -> list[PresetListItem]:
    return [PresetListItem(**p) for p in list_presets()]


@router.get("/presets/{name}/schema", response_model=PresetSchemaResponse)
async def preset_schema(name: str) -> PresetSchemaResponse:
    try:
        fields = get_preset_fields(name)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return PresetSchemaResponse(fields=fields)


@router.post("/extract", response_model=ExtractResponse)
async def extract(
    req: ExtractRequest,
    fn: Callable[..., Any] = Depends(get_extract_fn),
) -> dict:
    try:
        result = await fn(req.text, req.preset, req.schema_, instructions=req.instructions)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {**result, "cost_cny": _to_cny(result["cost_usd"])}


@router.post("/schema/resolve", response_model=SchemaResolveResponse)
async def schema_resolve(
    req: SchemaResolveRequest,
    fn: Callable[..., Any] = Depends(get_schema_resolve_fn),
) -> dict:
    try:
        result = await fn([f.model_dump() for f in req.fields])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {**result, "cost_cny": _to_cny(result["cost_usd"])}


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
    for item in items:
        item["cost_cny"] = _to_cny(item["cost_usd"])
    failed = sum(1 for i in items if i["error"] is not None)
    return BatchExtractResponse(
        results=items,
        total_cost_usd=result["total_cost_usd"],
        total_cost_cny=round(sum(i["cost_cny"] for i in items), 6),
        total_tokens=result["total_tokens"],
        succeeded=len(items) - failed,
        failed=failed,
    )
