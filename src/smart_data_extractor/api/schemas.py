"""Transport-layer DTOs for the API.

Distinct from ``models/``: those are extraction output schemas sent to the
LLM; these are HTTP request/response contracts. All request-shape problems
(both/neither of preset+schema, unknown preset, malformed schema) fail here
with pydantic ValidationError, which FastAPI turns into HTTP 422.
"""

from typing import Any

from pydantic import BaseModel, Field, model_validator

from smart_data_extractor.presets import list_presets


class _ExtractionTarget(BaseModel):
    """Shared request fields: the extraction target (preset XOR schema)
    plus optional caller instructions and UI language."""

    preset: str | None = None
    # Aliased: a field literally named "schema" would shadow BaseModel.schema.
    schema_: dict[str, Any] | None = Field(default=None, alias="schema")
    instructions: str | None = None
    # UI language tag: preset field descriptions sent to the LLM follow it.
    lang: str | None = None

    @model_validator(mode="after")
    def _check_target(self):
        if (self.preset is None) == (self.schema_ is None):
            raise ValueError("Exactly one of preset or schema must be provided")
        if self.preset is not None:
            known = {p["id"] for p in list_presets()}
            if self.preset not in known:
                available = ", ".join(sorted(known))
                raise ValueError(
                    f"Unknown preset {self.preset!r}. Available presets: {available}"
                )
        if self.schema_ is not None:
            # Same dual-shape convention as models.dynamic: with or without
            # a top-level "fields" wrapper. Require each spec to carry "type"
            # so the models layer cannot fail with an internal KeyError.
            fields = self.schema_.get("fields", self.schema_)
            for name, spec in fields.items():
                if not isinstance(spec, dict) or "type" not in spec:
                    raise ValueError(
                        f"Schema field {name!r} must be an object with a 'type' key"
                    )
        return self


class ExtractRequest(_ExtractionTarget):
    text: str = Field(min_length=1)


class BatchExtractRequest(_ExtractionTarget):
    texts: list[str] = Field(min_length=1)


class TokensUsed(BaseModel):
    input: int
    output: int


class ExtractResponse(BaseModel):
    data: dict[str, Any]
    tokens_used: TokensUsed
    cost_usd: float
    cost_cny: float


class BatchResultItem(BaseModel):
    """Uniform per-text shape (D-007): success -> error=None; failure ->
    data=None with zeroed usage/cost and an error message."""

    data: dict[str, Any] | None
    tokens_used: TokensUsed
    cost_usd: float
    cost_cny: float
    error: str | None


class BatchExtractResponse(BaseModel):
    results: list[BatchResultItem]
    total_cost_usd: float
    total_cost_cny: float
    total_tokens: TokensUsed
    succeeded: int
    failed: int


class PresetFieldInfo(BaseModel):
    """One field of a preset's extraction schema, for client-side display."""

    field_name: str
    display_name_zh: str
    display_name_en: str
    type: str
    format: str | None = None
    description_zh: str | None = None
    description_en: str | None = None


class PresetSchemaResponse(BaseModel):
    fields: list[PresetFieldInfo]


class PresetListItem(BaseModel):
    """One schema in the master table, for the preset picker."""

    id: str
    display_name_zh: str
    display_name_en: str
    is_builtin: bool


class SchemaFieldInput(BaseModel):
    """One field as edited in the schema editor, before name resolution.

    ``field_name`` is optional: the caller supplies it for unmodified
    preset fields (skip generation) and omits it for new/changed fields
    (trigger generation).
    """

    display_name: str
    display_name_en: str | None = None
    description: str | None = None
    type: str
    required: bool = False
    field_name: str | None = None


class SchemaResolveRequest(BaseModel):
    fields: list[SchemaFieldInput] = Field(min_length=1)


class SchemaInferRequest(BaseModel):
    text: str = Field(min_length=1)


class SchemaResolveResponse(BaseModel):
    # Aliased: a field literally named "schema" would shadow BaseModel.schema.
    schema_: dict[str, Any] = Field(alias="schema")
    # /schema/infer only: AI-generated human-friendly name for the schema
    # (in the input text's language, plus its English translation). Absent
    # (None) on /schema/resolve.
    schema_name: str | None = None
    schema_name_en: str | None = None
    tokens_used: TokensUsed
    cost_usd: float
    cost_cny: float

    model_config = {"populate_by_name": True}


class ParsePdfResponse(BaseModel):
    text: str
    """Per-page OCR text aligned to the original page order; None marks a failed page."""
    pages: list[str | None]
    pages_failed: list[int]
    # Issue #4 (D-027): per-page rendered PNGs (base64), aligned with `pages`
    # — the review pane previews PDF pages as images so locate boxes can be
    # overlaid (an iframe embed cannot host overlays). None/absent when the
    # parser does not produce page images (e.g. /parse_image: the frontend
    # already holds the original image bytes).
    pages_images: list[str] | None = None
    tokens_used: TokensUsed
    cost_usd: float
    cost_cny: float


class LocateBox(BaseModel):
    """One grounded value: its bounding box [x1, y1, x2, y2] normalized to
    0-100 (percentages of the image), plus the 0-based page it was found on
    (None for single-image sources)."""

    page: int | None = None
    box: list[float] = Field(min_length=4, max_length=4)


class LocateFieldsResponse(BaseModel):
    """Order-aligned with the request's `values`: a box per value, None when
    the value could not be located."""

    boxes: list[LocateBox | None]
    pages_scanned: int
    tokens_used: TokensUsed
    cost_usd: float
    cost_cny: float
