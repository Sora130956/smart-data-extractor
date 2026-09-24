"""Base model with confidence field convention and shared config."""

from pydantic import BaseModel, ConfigDict, model_validator


class ConfidenceBase(BaseModel):
    """Base class for models with confidence scoring.

    All extracted models should inherit from this to get shared config.
    Each field xxx should be paired with xxx_confidence: float in [0.0, 1.0].
    """

    model_config = ConfigDict(
        # Allow extra fields for forward compatibility
        extra="forbid",
        # Validate on assignment for runtime safety
        validate_assignment=True,
        # Use enum values instead of enum objects in serialization
        use_enum_values=True,
    )

    @model_validator(mode="after")
    def _zero_confidence_for_nulled_fields(self) -> "ConfidenceBase":
        """A field that was nulled by validation must not keep its confidence.

        Validation can drop a malformed value (invalid email, URL, date...)
        and leave the field None while the paired confidence stays at the
        LLM's original score. A null field means "nothing was extracted",
        so its confidence is coerced to 0.0 (AC-3). Applies to all preset
        and dynamic models via inheritance.

        Writes go through ``__dict__`` to avoid re-triggering
        ``validate_assignment`` recursively.
        """
        for name in type(self).model_fields:
            if name.endswith("_confidence"):
                continue
            twin = f"{name}_confidence"
            if twin in type(self).model_fields and getattr(self, name) is None:
                if self.__dict__.get(twin) != 0.0:
                    self.__dict__[twin] = 0.0
        return self
