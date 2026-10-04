"""Lead data model with validation."""

from typing import Optional

from pydantic import Field, field_validator

from smart_data_extractor.models.base import ConfidenceBase
from smart_data_extractor.validators import validate_email, validate_phone


class Lead(ConfidenceBase):
    """B2B sales lead extracted from text.
    
    Follows industry-standard CRM lead structure with BANT framework
    (Budget, Authority, Need, Timeline). Each field has a corresponding
    confidence score in [0.0, 1.0].
    """
    
    # Core contact information
    name: Optional[str] = Field(default=None, description="Full name of the lead")
    name_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    
    email: Optional[str] = Field(default=None, description="Email address of the lead")
    email_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    
    phone: Optional[str] = Field(default=None, description="Phone number of the lead")
    phone_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    
    company: Optional[str] = Field(default=None, description="Company or organization name")
    company_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    
    # Authority & decision-making context
    job_title: Optional[str] = Field(default=None, description="Job title or position of the lead")
    job_title_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    
    # Lead tracking & qualification
    lead_source: Optional[str] = Field(default=None, description="Source where the lead originated (e.g. website, referral)")
    lead_source_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    
    stage: Optional[str] = Field(default=None, description="Current stage in the sales pipeline")
    stage_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    
    # BANT qualification fields (optional)
    budget_range: Optional[str] = Field(default=None, description="Estimated budget range (BANT: Budget)")
    budget_range_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    
    timeline: Optional[str] = Field(default=None, description="Expected purchase timeline (BANT: Timeline)")
    timeline_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    
    # Additional context
    notes: Optional[str] = Field(default=None, description="Additional notes or context about the lead")
    notes_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    
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
