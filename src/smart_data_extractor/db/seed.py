"""Seed data for the three builtin presets."""

from sqlalchemy.orm import Session

CONTACT_PROMPT = """\
Extract contact information from the input text.

Fields to extract: name, email, phone, company, job_title, website.

Rules:
- Missing fields return null.
- Provide a confidence score between 0.0 and 1.0 for each field:
  1.0 = explicitly stated and unambiguous, 0.0 = not found.
- Normalize emails to lowercase and dates/URLs to their canonical form.
"""

INVOICE_PROMPT = """\
Extract invoice data from the input text.

Fields to extract: invoice_number, date, vendor, total, tax, currency.

Rules:
- Missing fields return null.
- Provide a confidence score between 0.0 and 1.0 for each field:
  1.0 = explicitly stated and unambiguous, 0.0 = not found.
- Normalize dates to ISO format (YYYY-MM-DD).
- Amounts are plain numbers without currency symbols.
"""

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

# (field_name, display_name_zh, display_name_en, type, format, description)
_CONTACT_FIELDS = [
    ("name", "姓名", "Name", "string", None, "Full name of the contact person"),
    ("email", "邮箱", "Email", "string", "email", "Email address of the contact"),
    ("phone", "电话", "Phone", "string", "phone", "Phone number of the contact"),
    ("company", "公司", "Company", "string", None, "Company or organization name"),
    ("job_title", "职位", "Job Title", "string", None, "Job title or position of the contact"),
    ("website", "网站", "Website", "string", "url", "Company or personal website URL"),
]

_INVOICE_FIELDS = [
    ("invoice_number", "发票号码", "Invoice Number", "string", None, "Unique invoice identifier or number"),
    ("date", "日期", "Date", "date", "date", "Invoice date in ISO format (YYYY-MM-DD)"),
    ("vendor", "供应商", "Vendor", "string", None, "Vendor or seller name"),
    ("total", "总金额", "Total", "number", None, "Total invoice amount"),
    ("tax", "税额", "Tax", "number", None, "Tax amount"),
    ("currency", "货币", "Currency", "string", None, "Currency code (e.g. USD, EUR)"),
]

_LEAD_FIELDS = [
    ("name", "姓名", "Name", "string", None, "Full name of the lead"),
    ("email", "邮箱", "Email", "string", "email", "Email address of the lead"),
    ("phone", "电话", "Phone", "string", "phone", "Phone number of the lead"),
    ("company", "公司", "Company", "string", None, "Company or organization name"),
    ("job_title", "职位", "Job Title", "string", None, "Job title or position of the lead"),
    ("lead_source", "线索来源", "Lead Source", "string", None, "Source where the lead originated (e.g. website, referral)"),
    ("stage", "阶段", "Stage", "string", None, "Current stage in the sales pipeline"),
    ("budget_range", "预算范围", "Budget Range", "string", None, "Estimated budget range (BANT: Budget)"),
    ("timeline", "时间线", "Timeline", "string", None, "Expected purchase timeline (BANT: Timeline)"),
    ("notes", "备注", "Notes", "string", None, "Additional notes or context about the lead"),
]

_PRESETS = [
    ("contact", "联系人", "Contact", CONTACT_PROMPT, _CONTACT_FIELDS),
    ("invoice", "发票", "Invoice", INVOICE_PROMPT, _INVOICE_FIELDS),
    ("lead", "销售线索", "Lead", LEAD_PROMPT, _LEAD_FIELDS),
]


def seed_builtin_presets(session: Session) -> None:
    """Insert the three builtin presets (caller commits)."""
    from smart_data_extractor.db.models import SchemaDefinition, SchemaFieldRow

    for schema_id, name_zh, name_en, prompt, fields in _PRESETS:
        session.add(
            SchemaDefinition(
                id=schema_id,
                display_name_zh=name_zh,
                display_name_en=name_en,
                is_builtin=True,
                prompt_template=prompt,
            )
        )
        for order, (fname, fzh, fen, ftype, ffmt, fdesc) in enumerate(fields):
            session.add(
                SchemaFieldRow(
                    schema_id=schema_id,
                    field_name=fname,
                    display_name_zh=fzh,
                    display_name_en=fen,
                    type=ftype,
                    format=ffmt,
                    description=fdesc,
                    required=False,
                    order=order,
                )
            )
