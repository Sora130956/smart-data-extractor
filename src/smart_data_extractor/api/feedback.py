"""User-feedback delivery (POST /feedback): send the visitor's message to
the owner's mailbox through the Resend HTTP API (port 443).

SMTP is deliberately not used: Render's free tier blocks outbound SMTP
ports 25/465/587. The production sender is synchronous (httpx.post); the
route runs it in a threadpool. Tests inject fakes through
``get_deliver_feedback_fn`` or fake ``httpx.post`` at this module's
boundary — the message content is never logged (sender privacy; only its
length is).
"""

import logging
from datetime import datetime, timezone

import httpx

from smart_data_extractor.config import get_settings

logger = logging.getLogger(__name__)

RESEND_API_URL = "https://api.resend.com/emails"


class FeedbackError(Exception):
    """Delivery failure mapped to a structured HTTP error by the route.

    code: "feedback_not_configured" (missing RESEND_API_KEY, -> 503) or
    "feedback_send_failed" (provider rejected / network issue, -> 502).
    """

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def deliver_feedback(
    message: str, contact: str | None, requester_ip: str
) -> dict:
    """Compose and send one feedback email; returns {"ok": True}.

    Args:
        message: the visitor's feedback text (already length-validated).
        contact: optional reply address / handle the visitor left.
        requester_ip: best-effort client IP, included for owner context.

    Raises:
        FeedbackError: Resend API key missing, or the send failed.
    """
    settings = get_settings()
    if not settings.resend_api_key:
        raise FeedbackError(
            "feedback_not_configured",
            "Feedback email is not configured on the server.",
        )
    received_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    contact_line = (
        f"Contact: {contact}\n" if contact else "Contact: (not provided)\n"
    )
    payload = {
        "from": settings.feedback_from_email,
        "to": [settings.feedback_to_email],
        "subject": "[Smart Data Extractor] User Feedback",
        "text": (
            f"A visitor submitted feedback through the demo site.\n"
            f"\n"
            f"{contact_line}"
            f"Time: {received_at}\n"
            f"IP: {requester_ip}\n"
            f"\n"
            f"--- Feedback ---\n"
            f"{message}\n"
        ),
    }

    try:
        response = httpx.post(
            RESEND_API_URL,
            headers={"Authorization": f"Bearer {settings.resend_api_key}"},
            json=payload,
            timeout=15,
        )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        # Provider error bodies (e.g. "can only send to your own address")
        # are useful for the owner and never echo the visitor's message.
        detail = (
            exc.response.text[:200]
            if isinstance(exc, httpx.HTTPStatusError)
            else exc
        )
        logger.warning(
            "FEEDBACK_SEND_FAILED ip=%s error=%s", requester_ip, detail
        )
        raise FeedbackError(
            "feedback_send_failed",
            "Failed to send the feedback email. Please try again later.",
        ) from exc
    return {"ok": True}


def get_deliver_feedback_fn():
    """DI seam: the production sender (tests override via
    dependency_overrides, mirroring the extraction endpoints)."""
    return deliver_feedback
