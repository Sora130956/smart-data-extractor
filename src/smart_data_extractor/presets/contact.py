"""Contact extraction preset."""

from smart_data_extractor.models import Contact
from smart_data_extractor.presets.base import Preset

CONTACT_PROMPT = """\
Extract contact information from the input text.

Fields to extract: name, email, phone, company, job_title, website.

Rules:
- Missing fields return null.
- Provide a confidence score between 0.0 and 1.0 for each field:
  1.0 = explicitly stated and unambiguous, 0.0 = not found.
- Normalize emails to lowercase and dates/URLs to their canonical form.
"""

CONTACT_PRESET = Preset(
    name="contact",
    model_class=Contact,
    prompt_template=CONTACT_PROMPT,
)
