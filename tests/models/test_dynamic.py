"""Tests for models/dynamic.py"""

import pytest
from pydantic import ValidationError

from smart_data_extractor.models.dynamic import create_dynamic_model


def test_create_dynamic_model_basic():
    """Test creating a dynamic model with basic fields."""
    schema = {
        "product_name": {"type": "string", "required": True},
        "price": {"type": "number", "required": True},
    }
    
    Model = create_dynamic_model(schema)
    
    # Check model has the expected fields
    assert "product_name" in Model.model_fields
    assert "price" in Model.model_fields
    assert "product_name_confidence" in Model.model_fields
    assert "price_confidence" in Model.model_fields


def test_create_dynamic_model_instantiation():
    """Test instantiating a dynamic model."""
    schema = {
        "product_name": {"type": "string", "required": True},
        "price": {"type": "number", "required": False},
    }
    
    Model = create_dynamic_model(schema)
    instance = Model(product_name="iPhone", price=999.0)
    
    assert instance.product_name == "iPhone"
    assert instance.price == 999.0
    assert instance.product_name_confidence == 0.0  # Default
    assert instance.price_confidence == 0.0  # Default


def test_create_dynamic_model_required_field():
    """Test required fields are enforced."""
    schema = {
        "product_name": {"type": "string", "required": True},
    }
    
    Model = create_dynamic_model(schema)
    
    # Missing required field should raise ValidationError
    with pytest.raises(ValidationError):
        Model()
    
    # Providing required field should work
    instance = Model(product_name="iPad")
    assert instance.product_name == "iPad"


def test_create_dynamic_model_optional_field():
    """Test optional fields default to None."""
    schema = {
        "availability": {"type": "string", "required": False},
    }
    
    Model = create_dynamic_model(schema)
    instance = Model()
    
    assert instance.availability is None
    assert instance.availability_confidence == 0.0


def test_create_dynamic_model_all_types():
    """Test all supported type mappings."""
    schema = {
        "name": {"type": "string", "required": True},
        "price": {"type": "number", "required": True},
        "quantity": {"type": "integer", "required": True},
        "in_stock": {"type": "boolean", "required": True},
    }
    
    Model = create_dynamic_model(schema)
    instance = Model(
        name="Product",
        price=99.99,
        quantity=10,
        in_stock=True,
    )
    
    assert instance.name == "Product"
    assert instance.price == 99.99
    assert instance.quantity == 10
    assert instance.in_stock is True


def test_create_dynamic_model_with_fields_wrapper():
    """Test schema with 'fields' wrapper key."""
    schema = {
        "fields": {
            "product_name": {"type": "string", "required": True},
            "price": {"type": "number", "required": True},
        }
    }
    
    Model = create_dynamic_model(schema)
    instance = Model(product_name="Laptop", price=1299.0)
    
    assert instance.product_name == "Laptop"
    assert instance.price == 1299.0


def test_create_dynamic_model_confidence_bounds():
    """Test confidence fields enforce [0.0, 1.0] bounds."""
    schema = {
        "name": {"type": "string", "required": True},
    }
    
    Model = create_dynamic_model(schema)
    
    # Valid confidence
    instance = Model(name="Test", name_confidence=0.95)
    assert instance.name_confidence == 0.95
    
    # Invalid confidence > 1.0
    with pytest.raises(ValidationError):
        Model(name="Test", name_confidence=1.5)
    
    # Invalid confidence < 0.0
    with pytest.raises(ValidationError):
        Model(name="Test", name_confidence=-0.1)


def test_create_dynamic_model_custom_name():
    """Test creating model with custom name."""
    schema = {
        "field1": {"type": "string", "required": True},
    }
    
    Model = create_dynamic_model(schema, model_name="CustomModel")
    assert Model.__name__ == "CustomModel"


def test_create_dynamic_model_serialization():
    """Test model serialization to dict."""
    schema = {
        "product_name": {"type": "string", "required": True},
        "price": {"type": "number", "required": False},
    }
    
    Model = create_dynamic_model(schema)
    instance = Model(product_name="Phone", price=599.0)
    
    data = instance.model_dump()
    assert data["product_name"] == "Phone"
    assert data["price"] == 599.0
    assert "product_name_confidence" in data
    assert "price_confidence" in data
