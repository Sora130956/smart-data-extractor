"""User-feedback delivery (POST /feedback): send the visitor's message to
the owner's mailbox over QQ SMTP using stdlib smtplib — no new dependency.

The production sender is synchronous (smtplib is blocking); the route runs
it in a threadpool. Tests inject fakes through ``get_deliver_feedback_fn``
or fake ``smtplib.SMTP_SSL`` at this module's boundary — the message
content is never logged (sender privacy; only its length is).
"""

import logging
import smtplib
from datetime import datetime, timezone
from email.message import EmailMessage

from smart_data_extractor.config import get_settings

logger = logging.getLogger(__name__)


class FeedbackError(Exception):
    """Delivery failure mapped to a structured HTTP error by the route.

    code: "feedback_not_configured" (missing SMTP env, -> 503) or
    "feedback_send_failed" (SMTP rejected / network issue, -> 502).
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
        FeedbackError: SMTP credentials missing, or the send failed.
    """
    settings = get_settings()
    if not settings.feedback_smtp_user or not settings.feedback_smtp_password:
        raise FeedbackError(
            "feedback_not_configured",
            "Feedback email is not configured on the server.",
        )
    to_email = settings.feedback_to_email or settings.feedback_smtp_user
    received_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    email = EmailMessage()
    email["Subject"] = "[Smart Data Extractor] User Feedback"
    email["From"] = settings.feedback_smtp_user
    email["To"] = to_email
    contact_line = (
        f"Contact: {contact}\n" if contact else "Contact: (not provided)\n"
    )
    email.set_content(
        f"A visitor submitted feedback through the demo site.\n"
        f"\n"
        f"{contact_line}"
        f"Time: {received_at}\n"
        f"IP: {requester_ip}\n"
        f"\n"
        f"--- Feedback ---\n"
        f"{message}\n"
    )

    try:
        with smtplib.SMTP_SSL(
            settings.feedback_smtp_host,
            settings.feedback_smtp_port,
            timeout=15,
        ) as smtp:
            smtp.login(settings.feedback_smtp_user, settings.feedback_smtp_password)
            smtp.send_message(email)
    except (smtplib.SMTPException, TimeoutError, OSError) as exc:
        logger.warning(
            "FEEDBACK_SEND_FAILED ip=%s error=%s", requester_ip, exc
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
