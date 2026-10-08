"""PDF / image -> GLM vision OCR.

One Source = one Result: a whole PDF is OCR'd page by page and the
resulting text is concatenated into a single text blob, matching the
existing plain-text ingestion flow (PasteTextInput -> /batch_extract).
An image file skips the page rendering entirely — its bytes are a
single "page".

Per-page failures are tolerated: a page whose OCR run raises is skipped
(its index recorded in ``pages_failed``) rather than failing the whole
document.
"""

import logging
from typing import Any

import fitz
from openai.types.chat import ChatCompletion
from pydantic_ai import Agent, BinaryContent
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai.settings import ModelSettings
from pydantic_ai.usage import RunUsage

from smart_data_extractor.config import get_settings

logger = logging.getLogger(__name__)

OCR_PROMPT = "Extract all text from this image verbatim. Output only the text, no commentary."

# Zhipu GLM vision model pricing, in CNY per 1M tokens: (input, output).
# glm-4v-flash is free; glm-4.5v is tiered by input token count.
_GLM_FREE_MODELS = {"glm-4v-flash"}
_GLM_4_5V_TIERS = [
    (32_000, 2.0, 6.0),
    (64_000, 4.0, 12.0),
]


class GlmChatModel(OpenAIChatModel):
    """OpenAIChatModel that tolerates Zhipu GLM's missing ``object`` field.

    Zhipu's OpenAI-compatible endpoint omits ``"object": "chat.completion"``
    from its responses. The openai SDK builds the ChatCompletion without
    validation (so ``object`` stays ``None``), and pydantic-ai's strict
    re-validation then rejects the response. Backfill the field before
    validation.
    """

    def _validate_completion(self, response: ChatCompletion) -> Any:
        if response.object is None:
            response.object = "chat.completion"
        return super()._validate_completion(response)


def build_glm_model(*, http_client: Any = None) -> OpenAIChatModel:
    """Build a GLM vision model (OpenAI-compatible endpoint, production default).

    ``http_client`` is an injection seam for tests (fake transport, no network).
    """
    settings = get_settings()
    return GlmChatModel(
        settings.glm_model,
        provider=OpenAIProvider(
            base_url=settings.glm_base_url,
            api_key=settings.glm_api_key,
            http_client=http_client,
        ),
    )


def build_ocr_agent(*, model: Any) -> Agent:
    """Build a fresh (uncached) OCR agent: plain-text output, deterministic."""
    return Agent(
        model,
        output_type=str,
        model_settings=ModelSettings(temperature=0),
    )


def pdf_to_images(pdf_bytes: bytes) -> list[bytes]:
    """Render each page of a PDF to a PNG image."""
    images = []
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        for page in doc:
            pix = page.get_pixmap()
            images.append(pix.tobytes("png"))
    finally:
        doc.close()
    return images


async def _ocr_page(agent: Agent, image_bytes: bytes, media_type: str = "image/png") -> tuple[str, RunUsage]:
    """Run OCR on a single page image."""
    result = await agent.run([OCR_PROMPT, BinaryContent(data=image_bytes, media_type=media_type)])
    return result.output, result.usage


async def _ocr_images(
    images: list[bytes],
    *,
    media_type: str,
    model: Any,
    model_ref: str | None,
) -> dict:
    """OCR a list of images (one per "page") into the shared result dict."""
    agent = build_ocr_agent(model=model)

    # Per-image OCR text aligned to the original order; None marks a failure.
    pages: list[str | None] = [None] * len(images)
    pages_failed: list[int] = []
    input_tokens = 0
    output_tokens = 0
    cost_usd = 0.0

    for index, image_bytes in enumerate(images):
        try:
            text, usage = await _ocr_page(agent, image_bytes, media_type)
        except Exception:
            logger.exception("OCR failed on page %d", index)
            pages_failed.append(index)
            continue

        pages[index] = text
        input_tokens += usage.input_tokens
        output_tokens += usage.output_tokens
        if model_ref is not None:
            cost_usd += calculate_glm_cost(usage, model_ref=model_ref)

    return {
        "text": "\n\n".join(t for t in pages if t is not None),
        "pages": pages,
        "pages_failed": pages_failed,
        "tokens_used": {"input": input_tokens, "output": output_tokens},
        "cost_usd": cost_usd,
    }


def _resolve_model(model: Any, model_ref: str | None) -> tuple[Any, str | None]:
    """Production default: build a GLM model and cost against settings.glm_model."""
    if model is None:
        model = build_glm_model()
        if model_ref is None:
            model_ref = get_settings().glm_model
    return model, model_ref


async def parse_pdf(
    pdf_bytes: bytes,
    *,
    model: Any = None,
    model_ref: str | None = None,
) -> dict:
    """OCR an entire PDF into a single text blob.

    Returns a dict with:
        text: concatenated text of successfully OCR'd pages, joined by "\\n\\n".
        pages_failed: 0-based indices of pages whose OCR run raised.
        tokens_used: {"input": int, "output": int}, summed over successful pages.
        cost_usd: total USD cost, summed over successful pages.
    """
    model, model_ref = _resolve_model(model, model_ref)
    return await _ocr_images(
        pdf_to_images(pdf_bytes), media_type="image/png", model=model, model_ref=model_ref
    )


async def parse_image(
    image_bytes: bytes,
    *,
    media_type: str = "image/png",
    model: Any = None,
    model_ref: str | None = None,
) -> dict:
    """OCR a single image file into a single text blob.

    The image bytes are used as-is (no PDF page rendering): one image =
    one "page", so the result shape matches ``parse_pdf`` exactly.
    """
    model, model_ref = _resolve_model(model, model_ref)
    return await _ocr_images(
        [image_bytes], media_type=media_type, model=model, model_ref=model_ref
    )


def calculate_glm_cost(usage: RunUsage, *, model_ref: str) -> float:
    """Calculate the USD cost of a GLM vision-model run.

    genai_prices has no GLM pricing data, so this uses a hand-maintained
    price table (CNY per 1M tokens, from Zhipu's official pricing),
    converted to USD via settings.usd_to_cny.
    """
    if model_ref in _GLM_FREE_MODELS:
        return 0.0

    price_in, price_out = _GLM_4_5V_TIERS[-1][1:]
    for tier_tokens, tier_in, tier_out in _GLM_4_5V_TIERS:
        if usage.input_tokens < tier_tokens:
            price_in, price_out = tier_in, tier_out
            break

    cost_cny = (usage.input_tokens / 1_000_000) * price_in + (usage.output_tokens / 1_000_000) * price_out
    return cost_cny / get_settings().usd_to_cny
