"""Tests for api/pipeline.py — canonical-properties promote flow.

Promotion is a LOCAL operation: it find-or-creates a canonical `properties`
row (source_type='hoa', source_id=<hoa id>, aspire_sync_status='unsynced') and
inserts the lead with `property_id`. NO Aspire call happens here — the only
sync trigger is estimate submission. DB fully mocked.
"""
from __future__ import annotations

import os
from unittest.mock import AsyncMock, patch

import pytest

os.environ.setdefault("MYSQL_HOST", "localhost")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("ENTRA_CLIENT_ID", "x")
os.environ.setdefault("ENTRA_TENANT_ID", "x")

from api import pipeline  # noqa: E402


def _hoa_row(**over):
    row = {
        "id": "hoa-1",
        "property_name": "Sunny HOA",
        "address": "123 Palm St",
        "city": "Orlando",
        "state": "FL",
        "zip": "32807",
        "arcgis_source": "orange_county",
        "estimated_acreage": 12.5,
        "branch_id": "Orlando, FL",
        "management_company_id": "mc-1",
    }
    row.update(over)
    return row


def _prop_row(**over):
    row = {
        "id": "prop-1",
        "property_type": "hoa",
        "source_type": "hoa",
        "source_id": "hoa-1",
        "name": "Sunny HOA",
        "address1": "123 Palm St",
        "city": "Orlando",
        "state": "FL",
        "zip": "32807",
        "branch_city": "Orlando, FL",
        "management_company_id": "mc-1",
        "aspire_sync_status": "unsynced",
    }
    row.update(over)
    return row


def _lead_row(**over):
    row = {
        "id": "lead-1",
        "source": "hoa_catalog",
        "lead_type": "HOA",
        "property_name": "Sunny HOA",
        "address": "123 Palm St",
        "city": "Orlando",
        "state": "FL",
        "zip": "32807",
        "source_url": "orange_county",
        "estimated_acreage": 12.5,
        "branch_id": "Orlando, FL",
        "property_id": "prop-1",
        "status": "new",
    }
    row.update(over)
    return row


class TestPromoteHoaToLead:
    @patch("api.pipeline.count_active_leads_for_property", new_callable=AsyncMock)
    @patch("api.pipeline.execute", new_callable=AsyncMock)
    @patch("api.pipeline.query", new_callable=AsyncMock)
    async def test_creates_unsynced_property_and_lead_with_property_id(
        self, mock_query, mock_exec, mock_count
    ):
        # 1: hoa row, 2: no existing property, 3: re-read property after insert
        mock_query.side_effect = [
            [_hoa_row()],
            [],
            [{"id": "prop-1"}],
        ]
        mock_count.return_value = 0

        lead = await pipeline.promote_hoa_to_lead("hoa-1")

        assert lead.property_id == "prop-1"
        assert lead.property_name == "Sunny HOA"

        # First execute = INSERT INTO properties, local-only and unsynced
        prop_sql, prop_params = mock_exec.call_args_list[0].args
        assert "INSERT INTO properties" in prop_sql
        assert "unsynced" in prop_sql or "unsynced" in prop_params
        assert "hoa-1" in prop_params  # source_id
        # source_type / property_type carried as 'hoa' (literal or param)
        assert "'hoa'" in prop_sql or "hoa" in prop_params

        # Second execute = INSERT INTO leads keyed by property_id, not hoa_property_id
        lead_sql, lead_params = mock_exec.call_args_list[1].args
        assert "INSERT INTO leads" in lead_sql
        assert "property_id" in lead_sql
        assert "hoa_property_id" not in lead_sql
        assert "prop-1" in lead_params

        # Dedup was checked against the canonical property id
        mock_count.assert_awaited_once_with("prop-1")

    @patch("api.pipeline.count_active_leads_for_property", new_callable=AsyncMock)
    @patch("api.pipeline.execute", new_callable=AsyncMock)
    @patch("api.pipeline.query", new_callable=AsyncMock)
    async def test_promotion_makes_no_aspire_call(self, mock_query, mock_exec, mock_count):
        """Promotion is local-only: the pipeline module never touches Aspire."""
        mock_query.side_effect = [[_hoa_row()], [], [{"id": "prop-1"}]]
        mock_count.return_value = 0

        with patch("api.aspire_sync.push_property", new_callable=AsyncMock) as mock_push:
            await pipeline.promote_hoa_to_lead("hoa-1")
            mock_push.assert_not_awaited()

        # And the property INSERT leaves the row unsynced
        prop_sql, prop_params = mock_exec.call_args_list[0].args
        assert "unsynced" in prop_sql or "unsynced" in prop_params

    @patch("api.pipeline.count_active_leads_for_property", new_callable=AsyncMock)
    @patch("api.pipeline.execute", new_callable=AsyncMock)
    @patch("api.pipeline.query", new_callable=AsyncMock)
    async def test_promotion_is_idempotent(self, mock_query, mock_exec, mock_count):
        """Promoting the same HOA twice → one property, one active lead."""
        # Second promote: property already exists, active lead already exists.
        mock_query.side_effect = [
            [_hoa_row()],          # hoa row
            [{"id": "prop-1"}],    # property already promoted (UNIQUE source key)
            [_lead_row()],         # existing active lead
        ]
        mock_count.return_value = 1

        lead = await pipeline.promote_hoa_to_lead("hoa-1")

        assert lead.id == "lead-1"
        assert lead.property_id == "prop-1"
        # No INSERTs at all on the second promote
        mock_exec.assert_not_awaited()

    @patch("api.pipeline.query", new_callable=AsyncMock)
    async def test_missing_hoa_raises(self, mock_query):
        mock_query.return_value = []
        with pytest.raises(ValueError):
            await pipeline.promote_hoa_to_lead("nope")


class TestPromotePropertyToLead:
    @patch("api.pipeline.count_active_leads_for_property", new_callable=AsyncMock)
    @patch("api.pipeline.execute", new_callable=AsyncMock)
    @patch("api.pipeline.query", new_callable=AsyncMock)
    async def test_creates_lead_from_canonical_property(self, mock_query, mock_exec, mock_count):
        mock_query.side_effect = [[_prop_row()]]
        mock_count.return_value = 0

        lead = await pipeline.promote_property_to_lead("prop-1")

        assert lead.property_id == "prop-1"
        lead_sql, lead_params = mock_exec.call_args.args
        assert "INSERT INTO leads" in lead_sql
        assert "property_id" in lead_sql
        assert "prop-1" in lead_params
        mock_count.assert_awaited_once_with("prop-1")

    @patch("api.pipeline.count_active_leads_for_property", new_callable=AsyncMock)
    @patch("api.pipeline.execute", new_callable=AsyncMock)
    @patch("api.pipeline.query", new_callable=AsyncMock)
    async def test_returns_existing_active_lead(self, mock_query, mock_exec, mock_count):
        mock_query.side_effect = [[_prop_row()], [_lead_row()]]
        mock_count.return_value = 1

        lead = await pipeline.promote_property_to_lead("prop-1")

        assert lead.id == "lead-1"
        mock_exec.assert_not_awaited()

    @patch("api.pipeline.query", new_callable=AsyncMock)
    async def test_missing_property_raises(self, mock_query):
        mock_query.return_value = []
        with pytest.raises(ValueError):
            await pipeline.promote_property_to_lead("nope")
