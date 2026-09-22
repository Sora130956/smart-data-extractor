"""Format validation and normalization functions.

Each validator returns None for invalid input, allowing the model layer
to set confidence to 0.0.
"""

import re
from datetime import datetime
from typing import Optional


# Email validation regex (basic but covers most cases)
EMAIL_PATTERN = re.compile(
    r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$"
)

# Phone normalization: extract digits only
PHONE_DIGITS_PATTERN = re.compile(r"\d+")

# URL validation regex (http/https)
URL_PATTERN = re.compile(
    r"^https?://[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(/.*)?$"
)


def validate_email(value: Optional[str]) -> Optional[str]:
    """Validate and normalize email address.
    
    Args:
        value: Email string to validate
        
    Returns:
        Lowercase normalized email if valid, None otherwise
    """
    if not value:
        return None
    
    value = value.strip().lower()
    if EMAIL_PATTERN.match(value):
        return value
    return None


def validate_phone(value: Optional[str]) -> Optional[str]:
    """Validate and normalize phone number.
    
    Extracts digits and returns None if fewer than 7 digits.
    
    Args:
        value: Phone string to validate
        
    Returns:
        Digit-only phone string if valid (7+ digits), None otherwise
    """
    if not value:
        return None
    
    # Extract all digits
    digits = "".join(PHONE_DIGITS_PATTERN.findall(value))
    
    # Require at least 7 digits (local numbers)
    if len(digits) >= 7:
        return digits
    return None


def validate_url(value: Optional[str]) -> Optional[str]:
    """Validate and normalize URL.
    
    Args:
        value: URL string to validate
        
    Returns:
        Normalized URL if valid, None otherwise
    """
    if not value:
        return None
    
    value = value.strip()
    if URL_PATTERN.match(value):
        return value
    return None


def validate_date(value: Optional[str]) -> Optional[str]:
    """Validate and normalize date string.
    
    Attempts to parse common date formats and returns ISO format (YYYY-MM-DD).
    
    Args:
        value: Date string to validate
        
    Returns:
        ISO format date string (YYYY-MM-DD) if valid, None otherwise
    """
    if not value:
        return None
    
    value = value.strip()
    
    # Common date formats to try
    formats = [
        "%Y-%m-%d",      # 2024-01-15
        "%Y/%m/%d",      # 2024/01/15
        "%m/%d/%Y",      # 01/15/2024
        "%m-%d-%Y",      # 01-15-2024
        "%d/%m/%Y",      # 15/01/2024
        "%d-%m-%Y",      # 15-01-2024
        "%B %d, %Y",     # January 15, 2024
        "%b %d, %Y",     # Jan 15, 2024
        "%d %B %Y",      # 15 January 2024
        "%d %b %Y",      # 15 Jan 2024
    ]
    
    for fmt in formats:
        try:
            dt = datetime.strptime(value, fmt)
            return dt.strftime("%Y-%m-%d")
        except ValueError:
            continue
    
    return None
