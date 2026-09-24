"""Transport-layer DTOs for the API.

Distinct from ``models/``: those are extraction output schemas sent to the
LLM; these are HTTP request/response contracts. All request-shape problems
(both/neither of preset+schema, unknown preset, malformed schema) fail here
with pydantic ValidationError, which FastAPI turns into HTTP 422.
"""

from typing import Any

from pydantic import BaseModel, Field, model_validator

from smart_data_extractor.presets import PRESETS


class _ExtractionTarget(BaseModel):
    """Shared request fields: the extraction target (preset XOR schema)
    plus optional caller instructions."""

    preset: str | None = None
    # Aliased: a field literally named "schema" would shadow BaseModel.schema.
    schema_: dict[str, Any] | None = Field(default=None, alias="schema")
    instructions: str | None = None

    @model_validator(mode="after")
    def _check_target(self):
        if (self.preset is None) == (self.schema_ is None):
            raise ValueError("Exactly one of preset or schema must be provided")
        if self.preset is not None and self.preset not in PRESETS:
            available = ", ".join(sorted(PRESETS))
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


class BatchResultItem(BaseModel):
    """Uniform per-text shape (D-007): success -> error=None; failure ->
    data=None with zeroed usage/cost and an error message."""

    data: dict[str, Any] | None
    tokens_used: TokensUsed
    cost_usd: float
    error: str | None


class BatchExtractResponse(BaseModel):
    results: list[BatchResultItem]
    total_cost_usd: float
    total_tokens: TokensUsed
    succeeded: int
    failed: int
