"""Predefined extraction scenarios: model + prompt bindings."""

from smart_data_extractor.presets.base import Preset
from smart_data_extractor.presets.contact import CONTACT_PRESET
from smart_data_extractor.presets.invoice import INVOICE_PRESET
from smart_data_extractor.presets.lead import LEAD_PRESET

PRESETS: dict[str, Preset] = {
    preset.name: preset
    for preset in (CONTACT_PRESET, INVOICE_PRESET, LEAD_PRESET)
}


def get_preset(name: str) -> Preset:
    """Look up a preset by name.

    Raises:
        ValueError: If the name is not a registered preset.
    """
    try:
        return PRESETS[name]
    except KeyError:
        available = ", ".join(sorted(PRESETS))
        raise ValueError(
            f"Unknown preset {name!r}. Available presets: {available}"
        ) from None


__all__ = ["PRESETS", "Preset", "get_preset"]
