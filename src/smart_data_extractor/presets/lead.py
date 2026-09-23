"""Lead extraction preset (BANT framework)."""

from smart_data_extractor.models import Lead
from smart_data_extractor.presets.base import Preset

LEAD_PROMPT = """\
Extract B2B sales lead information from the input text, following the
BANT qualification framework (Budget, Authority, Need, Timeline).

Fields to extract: name, email, phone, company, job_title, lead_source,
stage, budget_range, timeline, notes.

Rules:
- Missing fields return null.
- Provide a confidence score between 0.0 and 1.0 for each field:
  1.0 = explicitly stated and unambiguous, 0.0 = not found.
- job_title indicates decision-making authority.
- notes should capture the expressed need or pain points.
"""

LEAD_PRESET = Preset(
    name="lead",
    model_class=Lead,
    prompt_template=LEAD_PROMPT,
)
