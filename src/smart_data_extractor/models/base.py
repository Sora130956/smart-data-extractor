"""Base model with confidence field convention and shared config."""

from pydantic import BaseModel, ConfigDict


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
