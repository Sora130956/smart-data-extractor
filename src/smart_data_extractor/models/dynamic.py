"""Dynamic model creation from user-defined schema."""

from typing import Any, Dict, Optional, Type

from pydantic import Field, create_model

from smart_data_extractor.models.base import ConfidenceBase


# Type mapping from JSON schema types to Python types
TYPE_MAP = {
    "string": str,
    "number": float,
    "integer": int,
    "boolean": bool,
}


def create_dynamic_model(schema_dict: Dict[str, Any], model_name: str = "DynamicExtraction") -> Type[ConfidenceBase]:
    """Create a Pydantic model from user-defined JSON schema at runtime.
    
    Args:
        schema_dict: Dictionary with "fields" key containing field definitions
        model_name: Name for the generated model class
        
    Returns:
        Dynamically created Pydantic model class inheriting from ConfidenceBase
        
    Example:
        >>> schema = {
        ...     "product_name": {"type": "string", "required": True},
        ...     "price": {"type": "number", "required": False}
        ... }
        >>> Model = create_dynamic_model(schema)
        >>> instance = Model(product_name="iPhone", price=999.0)
    """
    field_definitions = {}
    
    # Support both {"fields": {...}} and direct {...} formats
    fields = schema_dict.get("fields", schema_dict)
    
    for field_name, field_spec in fields.items():
        # Get Python type from schema type
        field_type = TYPE_MAP.get(field_spec["type"], str)
        
        # Determine if field is required
        is_required = field_spec.get("required", False)
        
        if is_required:
            # Required field: type without Optional
            field_definitions[field_name] = (field_type, ...)
        else:
            # Optional field: wrapped in Optional with None default
            field_definitions[field_name] = (Optional[field_type], None)
        
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
        **field_definitions
    )
