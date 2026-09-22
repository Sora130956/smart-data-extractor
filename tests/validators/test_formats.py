"""Tests for validators/formats.py"""

import pytest

from smart_data_extractor.validators.formats import (
    validate_date,
    validate_email,
    validate_phone,
    validate_url,
)


class TestValidateEmail:
    """Tests for validate_email function."""

    def test_valid_email(self):
        """Test valid email is normalized to lowercase."""
        assert validate_email("John@Example.COM") == "john@example.com"

    def test_valid_email_with_plus(self):
        """Test email with plus sign is valid."""
        assert validate_email("user+tag@example.com") == "user+tag@example.com"

    def test_invalid_email_no_at(self):
        """Test email without @ is invalid."""
        assert validate_email("invalid.email.com") is None

    def test_invalid_email_no_domain(self):
        """Test email without domain is invalid."""
        assert validate_email("user@") is None

    def test_invalid_email_no_tld(self):
        """Test email without TLD is invalid."""
        assert validate_email("user@domain") is None

    def test_empty_email(self):
        """Test empty string returns None."""
        assert validate_email("") is None

    def test_none_email(self):
        """Test None returns None."""
        assert validate_email(None) is None

    def test_email_with_whitespace(self):
        """Test email with leading/trailing whitespace is trimmed."""
        assert validate_email("  user@example.com  ") == "user@example.com"


class TestValidatePhone:
    """Tests for validate_phone function."""

    def test_valid_phone_with_dashes(self):
        """Test phone with dashes extracts digits."""
        assert validate_phone("555-1234") == "5551234"

    def test_valid_phone_with_spaces(self):
        """Test phone with spaces extracts digits."""
        assert validate_phone("+1 555 123 4567") == "15551234567"

    def test_valid_phone_with_parens(self):
        """Test phone with parentheses extracts digits."""
        assert validate_phone("(555) 123-4567") == "5551234567"

    def test_valid_phone_international(self):
        """Test international phone format."""
        assert validate_phone("+86-138-1234-5678") == "8613812345678"

    def test_invalid_phone_too_few_digits(self):
        """Test phone with fewer than 7 digits is invalid."""
        assert validate_phone("123456") is None

    def test_invalid_phone_no_digits(self):
        """Test phone with no digits is invalid."""
        assert validate_phone("abc-def") is None

    def test_empty_phone(self):
        """Test empty string returns None."""
        assert validate_phone("") is None

    def test_none_phone(self):
        """Test None returns None."""
        assert validate_phone(None) is None

    def test_phone_minimum_valid_length(self):
        """Test phone with exactly 7 digits is valid."""
        assert validate_phone("555-1234") == "5551234"


class TestValidateUrl:
    """Tests for validate_url function."""

    def test_valid_http_url(self):
        """Test valid http URL."""
        assert validate_url("http://example.com") == "http://example.com"

    def test_valid_https_url(self):
        """Test valid https URL."""
        assert validate_url("https://example.com") == "https://example.com"

    def test_valid_url_with_path(self):
        """Test URL with path."""
        assert validate_url("https://example.com/path/to/page") == "https://example.com/path/to/page"

    def test_valid_url_with_subdomain(self):
        """Test URL with subdomain."""
        assert validate_url("https://www.example.com") == "https://www.example.com"

    def test_invalid_url_no_protocol(self):
        """Test URL without protocol is invalid."""
        assert validate_url("example.com") is None

    def test_invalid_url_ftp(self):
        """Test ftp:// protocol is invalid."""
        assert validate_url("ftp://example.com") is None

    def test_empty_url(self):
        """Test empty string returns None."""
        assert validate_url("") is None

    def test_none_url(self):
        """Test None returns None."""
        assert validate_url(None) is None

    def test_url_with_whitespace(self):
        """Test URL with leading/trailing whitespace is trimmed."""
        assert validate_url("  https://example.com  ") == "https://example.com"


class TestValidateDate:
    """Tests for validate_date function."""

    def test_valid_date_iso(self):
        """Test ISO format date."""
        assert validate_date("2024-01-15") == "2024-01-15"

    def test_valid_date_slash(self):
        """Test date with slashes."""
        assert validate_date("2024/01/15") == "2024-01-15"

    def test_valid_date_us_format(self):
        """Test US format (MM/DD/YYYY)."""
        assert validate_date("01/15/2024") == "2024-01-15"

    def test_valid_date_european_format(self):
        """Test European format (DD/MM/YYYY)."""
        assert validate_date("15/01/2024") == "2024-01-15"

    def test_valid_date_long_month(self):
        """Test date with full month name."""
        assert validate_date("January 15, 2024") == "2024-01-15"

    def test_valid_date_short_month(self):
        """Test date with abbreviated month."""
        assert validate_date("Jan 15, 2024") == "2024-01-15"

    def test_valid_date_day_first_long(self):
        """Test date with day first and long month."""
        assert validate_date("15 January 2024") == "2024-01-15"

    def test_invalid_date_format(self):
        """Test invalid date format returns None."""
        assert validate_date("not-a-date") is None

    def test_invalid_date_values(self):
        """Test invalid date values return None."""
        assert validate_date("2024-13-45") is None

    def test_empty_date(self):
        """Test empty string returns None."""
        assert validate_date("") is None

    def test_none_date(self):
        """Test None returns None."""
        assert validate_date(None) is None

    def test_date_with_whitespace(self):
        """Test date with whitespace is trimmed."""
        assert validate_date("  2024-01-15  ") == "2024-01-15"
