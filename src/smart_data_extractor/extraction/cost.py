"""Cost tracking: wrap genai_prices.calc_price for RunUsage."""

from genai_prices import calc_price
from pydantic_ai.usage import RunUsage


def calculate_cost(usage: RunUsage, model_ref: str) -> float:
    """Calculate the USD cost of a single agent run.

    Args:
        usage: Token usage from an agent run (result.usage).
        model_ref: genai-prices model identifier, e.g. "gpt-4o-mini".

    Returns:
        Total price in USD as a plain float (JSON-serializable).
    """
    return float(calc_price(usage, model_ref=model_ref).total_price)
