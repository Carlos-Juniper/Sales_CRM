"""Tests for api/aspire_sync.py — THE anti-corruption port (bulk of Phase 1).

The port speaks OUR vocabulary (neutral *Input dataclasses in, *SyncResult out)
and is the ONLY place Aspire field names appear. All Aspire vocabulary mapping,
the COALESCE(MasterOpportunityNumber, OpportunityNumber) rule, and the
ASPIRE_SYNC_ENABLED short-circuit are asserted here against a fake client — no
real HTTP, no DB.
"""
from __future__ import annotations

import os

import pytest

os.environ.setdefault("ASPIRE_CLIENT_ID", "test-client")
os.environ.setdefault("ASPIRE_SECRET", "test-secret")

import api.aspire_sync as sync  # noqa: E402
from api import aspire_config as cfg  # noqa: E402
from api.aspire_client import AspireHTTPError, AspireUnreachable  # noqa: E402
from api.aspire_sync import (  # noqa: E402
    OpportunityInput,
    PropertyInput,
    SyncResult,
    PropertySyncResult,
)


# ── Fake transport ───────────────────────────────────────────────────────────

class FakeClient:
    """Records calls; returns queued responses or raises a queued exception."""

    def __init__(self):
        self.calls: list[tuple] = []
        self.post_returns: list = []
        self.get_returns: list = []
        self.patch_returns: list = []
        self.put_returns: list = []
        self.raise_on: dict[str, Exception] = {}

    async def _do(self, verb, path, payload, queue):
        self.calls.append((verb, path, payload))
        if verb in self.raise_on:
            raise self.raise_on[verb]
        return queue.pop(0) if queue else {}

    async def post(self, path, body):
        return await self._do("post", path, body, self.post_returns)

    async def get(self, path, params=None):
        return await self._do("get", path, params, self.get_returns)

    async def patch(self, path, body):
        return await self._do("patch", path, body, self.patch_returns)

    async def put(self, path, body):
        return await self._do("put", path, body, self.put_returns)


@pytest.fixture(autouse=True)
def _enabled(monkeypatch):
    """Default every test to sync-enabled; disabled-path tests override."""
    monkeypatch.setenv("ASPIRE_SYNC_ENABLED", "true")


def _opp(**over) -> OpportunityInput:
    base = dict(
        name="Sunny HOA Maint 2026",
        service_line="Maintenance: Contract",
        branch_city="Orlando, FL",
        is_install=False,
        aspire_property_id=238431,
        aspire_rep_contact_id=278690,
        sales_type="HOA",
        lead_source="manual",
    )
    base.update(over)
    return OpportunityInput(**base)


# ── Pure mapping helpers ─────────────────────────────────────────────────────

class TestMappingHelpers:
    def test_division_id_for_each_service_line(self):
        assert sync.division_id("Maintenance: Contract") == 1574
        assert sync.division_id("Install: Landscape") == 1569
        assert sync.division_id("Install:  Hardscape") == 2594  # double space

    def test_division_id_unknown_returns_none(self):
        assert sync.division_id("Nope: Bogus") is None

    def test_branch_id_maintenance_vs_install(self):
        assert sync.branch_id("Orlando, FL", is_install=False) == 3668
        assert sync.branch_id("Orlando, FL", is_install=True) == 3579

    def test_branch_id_unknown_returns_none(self):
        assert sync.branch_id("Atlantis, XX", is_install=False) is None

    def test_extract_number_prefers_master(self):
        assert sync.extract_aspire_number(
            {"MasterOpportunityNumber": 408123, "OpportunityNumber": 410776}
        ) == "408123"

    def test_extract_number_falls_back_to_plain_when_master_null(self):
        assert sync.extract_aspire_number(
            {"MasterOpportunityNumber": None, "OpportunityNumber": 358068}
        ) == "358068"

    def test_extract_number_never_uses_real_number(self):
        rec = {"MasterOpportunityNumber": None, "OpportunityNumber": 8, "RealOpportunityNumber": 999}
        assert sync.extract_aspire_number(rec) == "8"


class TestOpportunityPayloadBuilder:
    def test_maps_core_aspire_fields(self):
        payload = sync.build_opportunity_payload(_opp())
        assert payload["OpportunityName"] == "Sunny HOA Maint 2026"
        assert payload["PropertyID"] == 238431
        assert payload["DivisionID"] == 1574
        assert payload["BranchID"] == 3668
        assert payload["OpportunityStatusID"] == cfg.ASPIRE_OPPORTUNITY_STATUS_NEW
        assert payload["SalesRepID"] == 278690
        assert payload["SalesTypeID"] == 1684
        assert payload["OpportunityType"] == cfg.ASPIRE_OPPORTUNITY_TYPE_DEFAULT

    def test_install_uses_install_branch(self):
        payload = sync.build_opportunity_payload(
            _opp(service_line="Install: Landscape", is_install=True)
        )
        assert payload["DivisionID"] == 1569
        assert payload["BranchID"] == 3579

    def test_optional_none_fields_omitted(self):
        payload = sync.build_opportunity_payload(
            _opp(aspire_rep_contact_id=None, sales_type=None)
        )
        assert "SalesRepID" not in payload
        assert "SalesTypeID" not in payload


# ── push_new_opportunity ─────────────────────────────────────────────────────

class TestPushNewOpportunity:
    async def test_disabled_short_circuits(self, monkeypatch):
        monkeypatch.setenv("ASPIRE_SYNC_ENABLED", "false")
        client = FakeClient()
        res = await sync.push_new_opportunity(_opp(), client=client)
        assert res.status == "disabled"
        assert client.calls == []

    async def test_pending_when_property_not_synced(self):
        client = FakeClient()
        res = await sync.push_new_opportunity(_opp(aspire_property_id=None), client=client)
        assert res.status == "pending"
        assert client.calls == []  # nothing pushed; sweep resolves later

    async def test_success_stores_id_and_coalesced_number(self):
        client = FakeClient()
        # POST /Opportunities returns a bare integer (confirmed 2026-08-24, swagger v1).
        client.post_returns = [630956]
        client.get_returns = [
            [{"MasterOpportunityNumber": None, "OpportunityNumber": 8}]
        ]
        res = await sync.push_new_opportunity(_opp(), client=client)
        assert res.status == "synced"
        assert res.aspire_opportunity_id == 630956
        assert res.aspire_number == "8"
        assert client.calls[0][0] == "post"
        assert client.calls[0][1] == "/Opportunities"
        # follow-up GET always hits the verified collection endpoint + id filter.
        verb, path, params = client.calls[1]
        assert verb == "get"
        assert path == "/Opportunities"
        assert "OpportunityID eq 630956" in params["$filter"]

    async def test_created_id_survives_a_failed_followup_read(self):
        # A read failure must NOT discard the created id — else the sweep would
        # re-POST and duplicate the opportunity.
        client = FakeClient()
        client.post_returns = [630956]  # bare int, as confirmed by swagger v1
        client.raise_on["get"] = AspireHTTPError(503, "read down")
        res = await sync.push_new_opportunity(_opp(), client=client)
        assert res.status == "synced"
        assert res.aspire_opportunity_id == 630956
        assert res.aspire_number is None

    async def test_bare_int_post_always_fetches_number_via_get(self):
        # POST /Opportunities returns a bare int — follow-up GET is always needed.
        client = FakeClient()
        client.post_returns = [630956]
        client.get_returns = [
            [{"MasterOpportunityNumber": 408123, "OpportunityNumber": 630001}]
        ]
        res = await sync.push_new_opportunity(_opp(), client=client)
        assert res.status == "synced"
        assert res.aspire_opportunity_id == 630956
        assert res.aspire_number == "408123"
        get_calls = [c for c in client.calls if c[0] == "get"]
        assert len(get_calls) == 1

    async def test_http_error_marks_failed(self):
        client = FakeClient()
        client.raise_on["post"] = AspireHTTPError(500, "boom")
        res = await sync.push_new_opportunity(_opp(), client=client)
        assert res.status == "failed"
        assert "500" in res.error

    async def test_network_error_marks_failed(self):
        client = FakeClient()
        client.raise_on["post"] = AspireUnreachable("down")
        res = await sync.push_new_opportunity(_opp(), client=client)
        assert res.status == "failed"


# ── push_status ──────────────────────────────────────────────────────────────

class TestPushStatus:
    async def test_won_returns_failed_no_endpoint(self):
        # Aspire API v1 has no endpoint to update opportunity status (confirmed 2026-08-24).
        client = FakeClient()
        res = await sync.push_status(630956, "won", client=client)
        assert res.status == "failed"
        assert res.aspire_opportunity_id == 630956
        assert "no endpoint" in res.error.lower()
        assert client.calls == []

    async def test_lost_returns_failed_no_endpoint(self):
        client = FakeClient()
        res = await sync.push_status(630956, "lost", lost_reason_id=13, client=client)
        assert res.status == "failed"
        assert res.aspire_opportunity_id == 630956
        assert "no endpoint" in res.error.lower()
        assert client.calls == []

    async def test_lost_rejects_deprecated_reason(self):
        client = FakeClient()
        res = await sync.push_status(630956, "lost", lost_reason_id=4, client=client)
        # 4 is deprecated — must not be written
        assert res.status == "failed"
        assert client.calls == []

    async def test_pending_when_opportunity_not_synced(self):
        client = FakeClient()
        res = await sync.push_status(None, "won", client=client)
        assert res.status == "pending"
        assert client.calls == []

    async def test_disabled_short_circuits(self, monkeypatch):
        monkeypatch.setenv("ASPIRE_SYNC_ENABLED", "false")
        client = FakeClient()
        res = await sync.push_status(630956, "won", client=client)
        assert res.status == "disabled"
        assert client.calls == []


# ── push_property ────────────────────────────────────────────────────────────

def _prop(**over) -> PropertyInput:
    base = dict(
        name="Sunny HOA",
        address1="123 Palm St",
        city="Orlando",
        state="FL",
        zip="32807",
        branch_city="Orlando, FL",
        is_install=False,
    )
    base.update(over)
    return PropertyInput(**base)


class TestPushProperty:
    async def test_disabled_short_circuits(self, monkeypatch):
        monkeypatch.setenv("ASPIRE_SYNC_ENABLED", "false")
        client = FakeClient()
        res = await sync.push_property(_prop(), client=client)
        assert res.status == "disabled"
        assert client.calls == []

    async def test_success_returns_property_id(self):
        client = FakeClient()
        # POST /Properties returns a bare integer (confirmed 2026-08-24, swagger v1).
        client.post_returns = [715389]
        res = await sync.push_property(_prop(), client=client)
        assert isinstance(res, PropertySyncResult)
        assert res.status == "synced"
        assert res.aspire_property_id == 715389
        body = client.calls[0][2]
        assert body["PropertyName"] == "Sunny HOA"
        assert body["BranchID"] == 3668
        assert body["Active"] is True

    async def test_error_marks_failed(self):
        client = FakeClient()
        client.raise_on["post"] = AspireUnreachable("down")
        res = await sync.push_property(_prop(), client=client)
        assert res.status == "failed"

    async def test_industry_id_included_when_provided(self):
        client = FakeClient()
        client.post_returns = [715389]
        res = await sync.push_property(_prop(industry_id=2204), client=client)
        assert res.status == "synced"
        assert client.calls[0][2]["IndustryID"] == 2204

    def test_industry_id_omitted_when_none(self):
        payload = sync.build_property_payload(_prop())
        assert "IndustryID" not in payload


# ── One-way takeoff qty push ─────────────────────────────────────────────────
#
# push_opportunity_service_item_qty writes our locally-owned opportunity_qty
# into OpportunityServiceItem.ItemQuantity, joined OpportunityServiceID →
# OpportunityService.OpportunityID, matched by CatalogItemID with the UOM
# checked against AllocationUnitTypeName. Best-effort, batched, never raises.

def _qty_lines():
    return [
        sync.TakeoffQtyLine(service_kit_id="501", qty=110, uom="ea"),
        sync.TakeoffQtyLine(service_kit_id="502", qty=1640, uom="FT"),
    ]


class TestPushOpportunityServiceItemQty:
    async def test_disabled_short_circuits(self, monkeypatch):
        monkeypatch.setenv("ASPIRE_SYNC_ENABLED", "false")
        client = FakeClient()
        res = await sync.push_opportunity_service_item_qty(9001, _qty_lines(), client=client)
        assert res.status == "disabled"
        assert client.calls == []

    async def test_unsynced_opportunity_is_pending(self):
        client = FakeClient()
        res = await sync.push_opportunity_service_item_qty(None, _qty_lines(), client=client)
        assert res.status == "pending"
        assert client.calls == []

    async def test_no_lines_is_a_synced_noop(self):
        client = FakeClient()
        res = await sync.push_opportunity_service_item_qty(9001, [], client=client)
        assert res.status == "synced"
        assert res.pushed == 0
        assert client.calls == []

    async def test_enabled_returns_failed_no_endpoint(self):
        # Aspire API v1 has no endpoint to update OpportunityServiceItem quantity
        # (confirmed 2026-08-24 via swagger v1).
        client = FakeClient()
        res = await sync.push_opportunity_service_item_qty(9001, _qty_lines(), client=client)
        assert res.status == "failed"
        assert "no endpoint" in res.error.lower()
        assert client.calls == []
