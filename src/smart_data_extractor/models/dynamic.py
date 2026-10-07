"""Dynamic model creation from user-defined schema."""

from typing import Any, Dict, Optional, Type

from pydantic import Field, create_model, field_validator

from smart_data_extractor.models.base import ConfidenceBase
from smart_data_extractor.validators.formats import (
    validate_date,
    validate_email,
    validate_phone,
    validate_url,
)

# Type mapping from JSON schema types to Python types. "date" is a str
# normalized to ISO format by the "date" format validator below.
TYPE_MAP = {
    "string": str,
    "number": float,
    "integer": int,
    "boolean": bool,
    "date": str,
}

# Generic format column -> validation/normalization function.
FORMAT_VALIDATORS = {
    "email": validate_email,
    "phone": validate_phone,
    "url": validate_url,
    "date": validate_date,
}


def _make_format_validator(func):
    """Build a classmethod validator bound to one format function."""

    @classmethod
    def _validate(cls, value):
        return func(value)

    return _validate


def create_dynamic_model(schema_dict: Dict[str, Any], model_name: str = "DynamicExtraction") -> Type[ConfidenceBase]:
    """Create a Pydantic model from user-defined JSON schema at runtime.
    
    Args:
        schema_dict: Dictionary with "fields" key containing field definitions
        model_name: Name for the generated model class
        
    Returns:
        Dynamically created Pydantic model class inheriting from ConfidenceBase
        
    Example:
        >>> schema = {
        ...     "product_name": {"type": "string", "required": True}, #NOTE 用户自定义的字段需要支持自己填写description，帮助LLM明确字段的业务含义
        ...     "price": {"type": "number", "required": False,
        ...               "description": "unit price in USD, not the total"}
        ... }
        >>> Model = create_dynamic_model(schema)
        >>> instance = Model(product_name="iPhone", price=999.0)
    """
    field_definitions = {}
    validators = {}

    # Support both {"fields": {...}} and direct {...} formats
    fields = schema_dict.get("fields", schema_dict)

    for field_name, field_spec in fields.items():
        # Get Python type from schema type
        field_type = TYPE_MAP.get(field_spec["type"], str)

        # Determine if field is required
        is_required = field_spec.get("required", False)

        # Required: bare type + Ellipsis default; optional: Optional + None.
        annotation = field_type if is_required else Optional[field_type]
        default = ... if is_required else None
        # Optional per-field description is forwarded to the LLM via the
        # model's JSON schema; it does not affect validation semantics.
        description = field_spec.get("description")
        field_definitions[field_name] = (
            annotation,
            Field(default, description=description) if description else default,
        )

        # Attach a format validator when the spec declares a known format.
        fmt = field_spec.get("format")
        if fmt in FORMAT_VALIDATORS:
            validators[f"_validate_{field_name}_format"] = field_validator(field_name)(
                _make_format_validator(FORMAT_VALIDATORS[fmt])
            )

        # Add confidence field for each data field
        confidence_field_name = f"{field_name}_confidence"
        field_definitions[confidence_field_name] = (
            float,
            Field(default=0.0, ge=0.0, le=1.0)
        )

    # Create model dynamically, inheriting from ConfidenceBase
    return create_model(
        model_name,
        __base__=ConfidenceBase,
        __validators__=validators,
        **field_definitions
    )
