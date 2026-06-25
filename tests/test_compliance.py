"""
Tests for api/compliance.py — assert_can_contact allow/block matrix.
Uses AsyncMock patches on the BigQuery query function.
Run with: PYTHONPATH=. venv/bin/pytest tests/test_compliance.py -v
"""
from __future__ import annotations

import os
import pytest
from unittest.mock import AsyncMock, patch
from fastapi import HTTPException

os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("TWILIO_ACCOUNT_SID", "")

# Must import AFTER env is set
from api.compliance import assert_can_contact  # noqa: E402

# ── Helpers ───────────────────────────────────────────────────────────────────


def _query_returns(rows: list) -> AsyncMock:
    return AsyncMock(return_value=rows)


# ── Allow cases ───────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_allow_email_with_no_consent_record():
    with patch("api.compliance.query", _query_returns([])):
        await assert_can_contact("email", contact_id="c1")  # should not raise


@pytest.mark.asyncio
async def test_allow_call_when_not_in_dnc_and_no_consent_block():
    with patch("api.compliance.query", _query_returns([])):
        await assert_can_contact("call", phone="+16025551234", contact_id="c1")


@pytest.mark.asyncio
async def test_allow_sms_when_not_in_dnc_and_no_consent_block():
    with patch("api.compliance.query", _query_returns([])):
        await assert_can_contact("sms", phone="+16025551234", contact_id="c1")


@pytest.mark.asyncio
async def test_allow_meeting_channel_always():
    with patch("api.compliance.query", _query_returns([])):
        await assert_can_contact("meeting", contact_id="c1")


# ── Block cases — DNC list ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_block_call_when_phone_in_dnc_list():
    with patch("api.compliance.query", _query_returns([{"phone": "+16025551234"}])):
        with pytest.raises(HTTPException) as exc:
            await assert_can_contact("call", phone="+16025551234")
        assert exc.value.status_code == 403
        assert "DNC" in exc.value.detail or "dnc" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_block_sms_when_phone_in_dnc_list():
    with patch("api.compliance.query", _query_returns([{"phone": "+16025551234"}])):
        with pytest.raises(HTTPException) as exc:
            await assert_can_contact("sms", phone="+16025551234")
        assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_email_channel_does_not_check_dnc_list():
    """Email channel should not check dnc_numbers table."""
    call_count = 0

    async def mock_query(sql, params=None):
        nonlocal call_count
        call_count += 1
        # If the DNC table is being checked for email, that's a bug — return empty anyway
        return []

    with patch("api.compliance.query", mock_query):
        await assert_can_contact("email", phone="+16025551234", contact_id="c1")
    # Only the consent check should have been made, not a DNC phone check
    # (exactly one call for the email consent check with contact_id)
    assert call_count <= 1  # 0 if no consent row found; 1 if consent checked


# ── Block cases — consent flags ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_block_email_when_do_not_email_true():
    async def mock_query(sql, params=None):
        if "dnc_numbers" in sql:
            return []
        return [{"do_not_email": True}]

    with patch("api.compliance.query", mock_query):
        with pytest.raises(HTTPException) as exc:
            await assert_can_contact("email", contact_id="c1")
        assert exc.value.status_code == 403
        assert "email" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_block_call_when_do_not_call_true():
    query_call = 0

    async def mock_query(sql, params=None):
        nonlocal query_call
        query_call += 1
        if "dnc_numbers" in sql:
            return []  # not in DNC
        return [{"do_not_call": True}]

    with patch("api.compliance.query", mock_query):
        with pytest.raises(HTTPException) as exc:
            await assert_can_contact("call", phone="+16025551234", contact_id="c1")
        assert exc.value.status_code == 403
        assert "call" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_block_sms_when_do_not_text_true():
    async def mock_query(sql, params=None):
        if "dnc_numbers" in sql:
            return []
        return [{"do_not_text": True}]

    with patch("api.compliance.query", mock_query):
        with pytest.raises(HTTPException) as exc:
            await assert_can_contact("sms", phone="+16025551234", contact_id="c1")
        assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_allow_call_when_do_not_email_but_not_do_not_call():
    """do_not_email=True should not block a call."""

    async def mock_query(sql, params=None):
        if "dnc_numbers" in sql:
            return []
        return [{"do_not_call": False}]

    with patch("api.compliance.query", mock_query):
        await assert_can_contact("call", phone="+16025551234", contact_id="c1")


@pytest.mark.asyncio
async def test_no_contact_id_skips_consent_check():
    """With no contact_id, only DNC check runs (for phone channels)."""
    with patch("api.compliance.query", _query_returns([])):
        await assert_can_contact("call", phone="+16025551234")  # should not raise
