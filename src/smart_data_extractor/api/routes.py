"""HTTP routes: a thin transport layer over the extraction core.

The extraction functions reach the handlers through Depends() so tests can
inject fakes via ``app.dependency_overrides`` (no network, no mocking of
the object under test).
"""

import hmac
from functools import lru_cache
from typing import Any, Callable

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile

from smart_data_extractor.api.quota import DailyQuota
from smart_data_extractor.api.schemas import (
    BatchExtractRequest,
    BatchExtractResponse,
    ExtractRequest,
    ExtractResponse,
    ParsePdfResponse,
    PresetListItem,
    PresetSchemaResponse,
    SchemaInferRequest,
    SchemaResolveRequest,
    SchemaResolveResponse,
)
from smart_data_extractor.config import get_settings
from smart_data_extractor.extraction import (
    batch_extract,
    extract_data,
    infer_schema,
    parse_image,
    parse_pdf,
    resolve_schema,
)
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


def get_schema_infer_fn() -> Callable[..., Any]:
    """DI seam: the schema inference function (production default)."""
    return infer_schema


def get_parse_pdf_fn() -> Callable[..., Any]:
    """DI seam: the PDF OCR parsing function (production default)."""
    return parse_pdf


def get_parse_image_fn() -> Callable[..., Any]:
    """DI seam: the image OCR parsing function (production default)."""
    return parse_image


@lru_cache
def get_quota() -> DailyQuota:
    """DI seam: process-wide daily quota built from settings.

    DEMO-STAGE guard (D-019): lazy (no settings access at import time)
    and cached so every guarded endpoint shares one counter set. Tests
    inject fresh instances via dependency_overrides.
    """
    settings = get_settings()
    return DailyQuota(
        per_ip_limit=settings.daily_quota_per_ip,
        global_limit=settings.daily_quota_global,
    )


async def enforce_daily_quota(
    request: Request, quota: DailyQuota = Depends(get_quota)
) -> None:
    """Guard for single-item endpoints: spend one unit per request.

    DEMO-STAGE (D-019): /batch_extract spends len(texts) units inside its
    handler instead — see the batch route.
    """
    quota.spend(request)


# Image formats GLM vision officially supports (Zhipu docs: png/jpg/jpeg/bmp).
SUPPORTED_IMAGE_MEDIA_TYPES = {"image/png", "image/jpeg", "image/jpg", "image/bmp"}


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/stats")
async def stats(
    token: str | None = None,
    quota: DailyQuota = Depends(get_quota),
) -> dict:
    """Today's traffic report for the owner (usage behind the quota guard).

    DEMO-STAGE (D-019): hidden unless ADMIN_STATS_TOKEN is set (a public
    401 would advertise the endpoint); counters are in-memory so they
    reset on every deploy. Open ``/stats?token=...`` in a browser.
    """
    expected = get_settings().admin_stats_token
    if not expected:
        raise HTTPException(status_code=404, detail="Not Found")
    if token is None or not hmac.compare_digest(token, expected):
        raise HTTPException(status_code=401, detail="Invalid or missing stats token")
    return quota.snapshot()


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


@router.post(
    "/extract",
    response_model=ExtractResponse,
    dependencies=[Depends(enforce_daily_quota)],
)
async def extract(
    req: ExtractRequest,
    fn: Callable[..., Any] = Depends(get_extract_fn),
) -> dict:
    try:
        result = await fn(
            req.text, req.preset, req.schema_,
            instructions=req.instructions, lang=req.lang,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {**result, "cost_cny": _to_cny(result["cost_usd"])}


@router.post(
    "/schema/resolve",
    response_model=SchemaResolveResponse,
    dependencies=[Depends(enforce_daily_quota)],
)
async def schema_resolve(
    req: SchemaResolveRequest,
    fn: Callable[..., Any] = Depends(get_schema_resolve_fn),
) -> dict:
    try:
        result = await fn([f.model_dump() for f in req.fields])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {**result, "cost_cny": _to_cny(result["cost_usd"])}


@router.post(
    "/schema/infer",
    response_model=SchemaResolveResponse,
    dependencies=[Depends(enforce_daily_quota)],
)
async def schema_infer(
    req: SchemaInferRequest,
    fn: Callable[..., Any] = Depends(get_schema_infer_fn),
) -> dict:
    try:
        result = await fn(req.text)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {**result, "cost_cny": _to_cny(result["cost_usd"])}


@router.post("/batch_extract", response_model=BatchExtractResponse)
async def batch(
    req: BatchExtractRequest,
    request: Request,
    fn: Callable[..., Any] = Depends(get_batch_fn),
    quota: DailyQuota = Depends(get_quota),
) -> BatchExtractResponse:
    # DEMO-STAGE quota (D-019): a batch spends one unit per text, not one
    # per request — n LLM calls cost n units. Rejected before any LLM work.
    quota.spend(request, max(1, len(req.texts)))
    try:
        # The API contract is per-item tolerance (D-007): one bad text must
        # not fail the whole batch.
        result = await fn(
            req.texts,
            req.preset,
            req.schema_,
            instructions=req.instructions,
            return_exceptions=True,
            lang=req.lang,
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


@router.post(
    "/parse_pdf",
    response_model=ParsePdfResponse,
    dependencies=[Depends(enforce_daily_quota)],
)
async def parse_pdf_route(
    file: UploadFile,
    fn: Callable[..., Any] = Depends(get_parse_pdf_fn),
) -> dict:
    if file.content_type != "application/pdf":
        raise HTTPException(status_code=422, detail="File must be a PDF")
    pdf_bytes = await file.read()
    try:
        result = await fn(pdf_bytes)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {**result, "cost_cny": _to_cny(result["cost_usd"])}


@router.post(
    "/parse_image",
    response_model=ParsePdfResponse,
    dependencies=[Depends(enforce_daily_quota)],
)
async def parse_image_route(
    file: UploadFile,
    fn: Callable[..., Any] = Depends(get_parse_image_fn),
) -> dict:
    media_type = (file.content_type or "").lower()
    if media_type not in SUPPORTED_IMAGE_MEDIA_TYPES:
        raise HTTPException(
            status_code=422,
            detail="File must be an image (png, jpg, jpeg or bmp)",
        )
    image_bytes = await file.read()
    try:
        result = await fn(image_bytes, media_type=media_type)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {**result, "cost_cny": _to_cny(result["cost_usd"])}
