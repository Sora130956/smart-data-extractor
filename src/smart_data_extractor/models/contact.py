"""Contact data model with validation."""

from typing import Optional

from pydantic import Field, field_validator

from smart_data_extractor.models.base import ConfidenceBase
from smart_data_extractor.validators import validate_email, validate_phone, validate_url


class Contact(ConfidenceBase):
    """Contact information extracted from text.
    
    Each field has a corresponding confidence score in [0.0, 1.0].
    Invalid formats are set to None with confidence 0.0.
    """
    
    name: Optional[str] = None
    name_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    
    email: Optional[str] = None
    email_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    
    phone: Optional[str] = None
    phone_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    
    company: Optional[str] = None
    company_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    
    job_title: Optional[str] = None
    job_title_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    
    website: Optional[str] = None
    website_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    
    @field_validator("email")
    @classmethod
    def validate_email_format(cls, v: Optional[str]) -> Optional[str]:
        """Validate and normalize email format."""
        return validate_email(v)
    
    @field_validator("phone")
    @classmethod
    def validate_phone_format(cls, v: Optional[str]) -> Optional[str]:
        """Validate and normalize phone format."""
        return validate_phone(v)
    
    @field_validator("website")
    @classmethod
    def validate_website_format(cls, v: Optional[str]) -> Optional[str]:
        """Validate and normalize website URL format."""
        return validate_url(v)
