"""Invoice extraction preset."""

from smart_data_extractor.models import Invoice
from smart_data_extractor.presets.base import Preset

INVOICE_PROMPT = """\
Extract invoice data from the input text.

Fields to extract: invoice_number, date, vendor, total, tax, currency,
and line_items (each with description, quantity, unit_price, amount).

Rules:
- Missing fields return null.
- Provide a confidence score between 0.0 and 1.0 for each field:
  1.0 = explicitly stated and unambiguous, 0.0 = not found.
- Normalize dates to ISO format (YYYY-MM-DD).
- Amounts are plain numbers without currency symbols.
"""

INVOICE_PRESET = Preset(
    name="invoice",
    model_class=Invoice,
    prompt_template=INVOICE_PROMPT,
)
