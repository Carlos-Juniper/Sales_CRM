"""
Compliance helpers for the Juniper CRM.

assert_can_contact() checks:
  1. DNC (do-not-call) phone list for call/sms channels.
  2. Per-contact opt-out flags from the contact_consent table.

Raises HTTPException(403) when the channel/contact is blocked.
"""
from __future__ import annotations

from fastapi import HTTPException
from db import T, P, query

# Channel → do_not_* field in contact_consent
_CHANNEL_CONSENT_MAP = {
    "email": "do_not_email",
    "call":  "do_not_call",
    "sms":   "do_not_text",
}


async def assert_can_contact(
    channel: str,
    *,
    phone: str | None = None,
    email: str | None = None,
    contact_id: str | None = None,
) -> None:
    """Raise HTTPException(403) when the channel/contact is blocked."""

    # 1. Check DNC list for phone-based channels
    if channel in ("call", "sms") and phone:
        rows = await query(
            f"SELECT phone FROM {T('dnc_numbers')} WHERE phone = @phone LIMIT 1",
            [P("phone", "STRING", phone)],
        )
        if rows:
            raise HTTPException(
                status_code=403,
                detail=f"Phone {phone} is on the DNC list",
            )

    # 2. Check contact_consent record for opt-out flags
    if contact_id:
        dnc_field = _CHANNEL_CONSENT_MAP.get(channel)
        if dnc_field:
            rows = await query(
                f"SELECT {dnc_field} FROM {T('contact_consent')} "
                f"WHERE contact_id = @contact_id LIMIT 1",
                [P("contact_id", "STRING", contact_id)],
            )
            if rows and rows[0].get(dnc_field):
                raise HTTPException(
                    status_code=403,
                    detail=f"Contact has opted out of {channel} communications",
                )
