"""Tests for extraction.cost (genai_prices wrapper)."""

from pydantic_ai.usage import RunUsage

from smart_data_extractor.extraction.cost import calculate_cost


def test_calculate_cost_positive_and_magnitude():
    """1k input / 500 output tokens on gpt-4o-mini costs > 0 and < $0.01."""
    usage = RunUsage(input_tokens=1000, output_tokens=500)
    cost = calculate_cost(usage, model_ref="gpt-4o-mini")
    assert 0.0 < cost < 0.01


def test_calculate_cost_zero_tokens():
    """Zero tokens cost zero dollars."""
    usage = RunUsage(input_tokens=0, output_tokens=0)
    assert calculate_cost(usage, model_ref="gpt-4o-mini") == 0.0


def test_calculate_cost_scales_with_tokens():
    """More tokens cost strictly more (monotonicity)."""
    small = RunUsage(input_tokens=100, output_tokens=50)
    large = RunUsage(input_tokens=10_000, output_tokens=5_000)
    assert calculate_cost(large, model_ref="gpt-4o-mini") > calculate_cost(
        small, model_ref="gpt-4o-mini"
    )
