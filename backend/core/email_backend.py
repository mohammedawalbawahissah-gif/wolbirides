"""Django email backend that sends through Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email).

Used by the existing `send_mail` calls (sign-up and password-reset codes), so no call site changes.
The sender address (DEFAULT_FROM_EMAIL) must be on a domain verified in your Resend account.
"""
import logging

import requests
from django.conf import settings
from django.core.mail.backends.base import BaseEmailBackend

logger = logging.getLogger(__name__)

RESEND_URL = "https://api.resend.com/emails"


class ResendEmailBackend(BaseEmailBackend):
    def send_messages(self, email_messages):
        if not email_messages:
            return 0
        if not settings.RESEND_API_KEY:
            if not self.fail_silently:
                raise RuntimeError("RESEND_API_KEY is not set.")
            return 0
        sent = 0
        for message in email_messages:
            try:
                self._send(message)
                sent += 1
            except Exception:
                logger.exception("Resend email to %s failed", message.to)
                if not self.fail_silently:
                    raise
        return sent

    def _send(self, message):
        payload = {
            "from": message.from_email or settings.DEFAULT_FROM_EMAIL,
            "to": list(message.to),
            "subject": message.subject,
        }
        html = next((body for body, mimetype in getattr(message, "alternatives", []) if mimetype == "text/html"), None)
        if html:
            payload["html"] = html
        if message.content_subtype == "html":
            payload["html"] = message.body
        else:
            payload["text"] = message.body
        if message.cc:
            payload["cc"] = list(message.cc)
        if message.bcc:
            payload["bcc"] = list(message.bcc)
        if message.reply_to:
            payload["reply_to"] = list(message.reply_to)
        response = requests.post(
            RESEND_URL,
            json=payload,
            headers={"Authorization": f"Bearer {settings.RESEND_API_KEY}"},
            timeout=10,
        )
        response.raise_for_status()
