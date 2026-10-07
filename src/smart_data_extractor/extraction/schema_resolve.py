"""Field-name resolution: turn user-facing display names into LLM schema keys.

Only fields missing a ``field_name`` are sent to the LLM, in a single batch
call (one Agent run for the whole request, not one per field). When every
field already has a known name, no call is made at all (zero cost).
"""

import re
from typing import Any

from pydantic import BaseModel

from smart_data_extractor.config import get_settings
from smart_data_extractor.extraction.agent import build_agent, shared_concurrency_limiter
from smart_data_extractor.extraction.extractor import _resolve_cost

RESOLVE_INSTRUCTIONS = """\
You generate JSON schema field names for a data extraction form.

For each field listed below, produce a concise snake_case name derived from
its display name and description, in English, suitable as a Python
identifier (lowercase letters, digits, underscores; must not start with a
digit). Also produce a concise English display name (title-case phrase, e.g.
"Urgency Level") for English UI display. Return exactly one output item per
input field, echoing its original index.
"""

_IDENTIFIER_RE = re.compile(r"^[a-z][a-z0-9_]*$")


class _FieldNameItem(BaseModel):
    index: int
    field_name: str
    display_name_en: str


class _FieldNameList(BaseModel):
    fields: list[_FieldNameItem]


def _validate_identifier(name: str) -> None:
    if not _IDENTIFIER_RE.match(name):
        raise ValueError(f"Generated field name {name!r} is not a valid snake_case identifier")
    if name.endswith("_confidence"):
        raise ValueError(f"Generated field name {name!r} must not end with '_confidence'")


def _build_prompt(fields: list[dict[str, Any]], missing_indices: list[int]) -> str:
    lines = []
    for i in missing_indices:
        f = fields[i]
        lines.append(
            f"- index={i}, display_name={f['display_name']!r}, "
            f"description={f.get('description')!r}, type={f['type']!r}"
        )
    return "Fields:\n" + "\n".join(lines)


async def resolve_schema(
    fields: list[dict[str, Any]],
    *,
    model: Any = None,
    model_ref: str | None = None,
) -> dict:
    """Resolve the real schema field name for each input field.

    Args:
        fields: Each dict matches ``SchemaFieldInput``'s shape (display_name,
            description, type, required, and an optional field_name). A
            present ``field_name`` means "already known, skip generation".
        model: Optional model override (TestModel for offline tests).
        model_ref: Optional genai-prices ref override for cost tracking.

    Returns:
        {"schema": {"fields": {name: {type, description, required}}},
         "tokens_used": {"input": int, "output": int}, "cost_usd": float}

    Raises:
        ValueError: A generated name is not a valid snake_case identifier,
            collides with another field's name, or uses the reserved
            "_confidence" suffix.
    """
    missing_indices = [i for i, f in enumerate(fields) if f.get("field_name") is None]
    known_names = {f["field_name"] for f in fields if f.get("field_name") is not None}

    generated: dict[int, str] = {}
    tokens = {"input": 0, "output": 0}
    cost_usd = 0.0

    if missing_indices:
        prompt = _build_prompt(fields, missing_indices)
        if model is None:
            agent = build_agent(
                _FieldNameList,
                model=get_settings().model,
                instructions=RESOLVE_INSTRUCTIONS,
                limiter=shared_concurrency_limiter(),
            )
        else:
            agent = build_agent(_FieldNameList, model=model, instructions=RESOLVE_INSTRUCTIONS)

        result = await agent.run(prompt)
        usage = result.usage
        generated = {item.index: item for item in result.output.fields}
        tokens = {"input": usage.input_tokens, "output": usage.output_tokens}
        cost_usd = _resolve_cost(usage, model=model, model_ref=model_ref)

    seen = set(known_names)
    final_names: dict[int, str] = {}
    for i in missing_indices:
        name = generated.get(i).field_name if i in generated else None
        if name is None:
            raise ValueError(f"Field name generation did not return a name for field index {i}")
        _validate_identifier(name)
        if name in seen:
            raise ValueError(f"Generated field name {name!r} conflicts with another field")
        seen.add(name)
        final_names[i] = name

    schema_fields: dict[str, Any] = {}
    for i, f in enumerate(fields):
        name = f.get("field_name") or final_names[i]
        schema_fields[name] = {
            "type": f["type"],
            "description": f.get("description"),
            "required": f.get("required", False),
            "display_name": f["display_name"],
            "display_name_en": f.get("display_name_en")
            or (generated[i].display_name_en if i in generated else None),
        }

    return {
        "schema": {"fields": schema_fields},
        "tokens_used": tokens,
        "cost_usd": cost_usd,
    }
