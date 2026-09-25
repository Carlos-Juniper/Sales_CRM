"""Takeoff Lines Backend & Aspire Qty Push.

DB fully mocked via an in-memory FakeDb (same style as
tests/test_estimating_line_items.py) — no MySQL, no live Aspire. Contract:

  * GET/POST/PATCH/DELETE /api/estimating/estimates/{id}/takeoff-lines[/{lid}]
    persist estimator-owned takeoff rows; plan/add%/measured/opportunity qty
    and catalog_item_id are all writable (opportunity_qty is a LOCAL value —
    never read from Aspire).
  * Derived fields (bidQty/flagged/deltaVsOpp) are recomputed server-side —
    client-sent derived values are ignored. bidQty uses
    round (locked decision), not ceil.
  * On estimate Save (PATCH /estimates/{id}) the lines that carry a
    catalog_item_id are pushed to Aspire ONCE as a batch, best-effort — an
    Aspire failure never fails the Save.
  * Estimator-ownership RBAC on every mutation route.
"""
from __future__ import annotations

import os
import re
from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest  # noqa: F401  (asyncio_mode=auto)
from fastapi.testclient import TestClient

os.environ.setdefault("MYSQL_HOST", "localhost")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("ENTRA_CLIENT_ID", "x")
os.environ.setdefault("ENTRA_TENANT_ID", "x")

from api.server import app, require_auth  # noqa: E402

client = TestClient(app)

_ESTIMATOR = {
    "id": "u1", "name": "Esti Mator", "email": "e@x.com",
    "role": "install_estimating", "branch_id": "Raleigh", "avatar_initials": "EM",
}
_SALES = {
    "id": "u2", "name": "Sally Sales", "email": "s@x.com",
    "role": "sales", "branch_id": "Raleigh", "avatar_initials": "SS",
}


# FakeDb, _CHILDREN and the `db` fixture now live in tests/conftest.py —
# they were duplicated here and in test_estimating_takeoff.py and had
# diverged, so a schema change had to land in two places and landed in none.

@pytest.fixture
def estimator(db):
    app.dependency_overrides[require_auth] = lambda: _ESTIMATOR
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def sales(db):
    app.dependency_overrides[require_auth] = lambda: _SALES
    yield
    app.dependency_overrides.clear()


def _create_estimate(estimate_type: str = "install") -> str:
    res = client.post(
        "/api/estimating/estimates",
        json={
            "estimateType": estimate_type,
            "name": "Takeoff Test",
            "clientName": "Acme",
            "aspireBranchId": 3688, "branchCity": "Raleigh, NC",
            "customerType": "commercial",
        },
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _line_payload(**over) -> dict:
    base = {
        "description": "Irrigation lateral line",
        "uom": "FT",
        "planQty": 100,
        "addPct": 0.1,
        "measuredQty": 115,
        "opportunityQty": 100,
        "catalogItemId": "cat-1",
    }
    base.update(over)
    return base


def _url(estimate_id: str, line_id: str | None = None) -> str:
    base = f"/api/estimating/estimates/{estimate_id}/takeoff-lines"
    return f"{base}/{line_id}" if line_id else base


# ── CRUD + server-side derived recompute ─────────────────────────────────────

class TestTakeoffCrud:
    def test_get_empty_list(self, estimator):
        eid = _create_estimate()
        res = client.get(_url(eid))
        assert res.status_code == 200
        assert res.json() == []

    def test_post_persists_and_returns_server_derived_fields(self, estimator):
        eid = _create_estimate()
        # Client-sent derived values are lies — the server must recompute.
        res = client.post(_url(eid), json=_line_payload(bidQty=9999, flagged=False, deltaVsOpp=0))
        assert res.status_code == 201, res.text
        line = res.json()
        assert line["estimateId"] == eid
        assert line["description"] == "Irrigation lateral line"
        assert line["catalogItemId"] == "cat-1"
        assert line["opportunityQty"] == 100
        # Derived, recomputed: round(100 × 1.1) = 110; |115−100|/100 = 15% > 10%.
        assert line["bidQty"] == 110
        assert line["flagged"] is True
        assert line["deltaVsOpp"] == 15

        listed = client.get(_url(eid)).json()
        assert [l["id"] for l in listed] == [line["id"]]
        assert listed[0]["bidQty"] == 110

    def test_bid_qty_uses_round_not_ceil(self, estimator):
        eid = _create_estimate()
        # 101 × 1.1 = 111.1 → round 111 (ceil would say 112).
        r1 = client.post(_url(eid), json=_line_payload(planQty=101, addPct=0.1)).json()
        assert r1["bidQty"] == 111
        # 24 × 1.05 = 25.2 → round 25 (ceil would say 26).
        r2 = client.post(_url(eid), json=_line_payload(planQty=24, addPct=0.05)).json()
        assert r2["bidQty"] == 25

    def test_patch_updates_and_recomputes(self, estimator):
        eid = _create_estimate()
        line = client.post(_url(eid), json=_line_payload()).json()

        res = client.patch(_url(eid, line["id"]), json={"measuredQty": 100})
        assert res.status_code == 200
        body = res.json()
        assert body["measuredQty"] == 100
        assert body["flagged"] is False
        assert body["deltaVsOpp"] == 0

        # opportunity_qty is locally-set and editable — never read from Aspire.
        body = client.patch(_url(eid, line["id"]), json={"opportunityQty": 90}).json()
        assert body["opportunityQty"] == 90
        assert body["deltaVsOpp"] == 10

        # catalog link is settable and clearable.
        body = client.patch(_url(eid, line["id"]), json={"catalogItemId": None}).json()
        assert body["catalogItemId"] is None

    def test_patch_ignores_client_sent_derived_values(self, estimator, db):
        eid = _create_estimate()
        line = client.post(_url(eid), json=_line_payload()).json()
        res = client.patch(
            _url(eid, line["id"]), json={"bidQty": 1, "flagged": False, "deltaVsOpp": -99}
        )
        assert res.status_code == 200
        body = res.json()
        assert body["bidQty"] == 110
        assert body["flagged"] is True
        assert body["deltaVsOpp"] == 15
        # Nothing derived ever lands in the row itself.
        row = db.tables["takeoff_lines"][line["id"]]
        assert "bid_qty" not in row and "flagged" not in row and "delta_vs_opp" not in row

    def test_delete_removes_line(self, estimator):
        eid = _create_estimate()
        line = client.post(_url(eid), json=_line_payload()).json()
        assert client.delete(_url(eid, line["id"])).status_code == 204
        assert client.get(_url(eid)).json() == []

    def test_404s(self, estimator):
        assert client.get(_url("est-missing")).status_code == 404
        assert client.post(_url("est-missing"), json=_line_payload()).status_code == 404
        eid = _create_estimate()
        assert client.patch(_url(eid, "tk-missing"), json={"planQty": 1}).status_code == 404
        assert client.delete(_url(eid, "tk-missing")).status_code == 404
        # A line can never be reached through another estimate's URL.
        line = client.post(_url(eid), json=_line_payload()).json()
        other = _create_estimate()
        assert client.patch(_url(other, line["id"]), json={"planQty": 1}).status_code == 404
        assert client.delete(_url(other, line["id"])).status_code == 404

    def test_get_never_touches_aspire(self, estimator):
        # opportunity_qty has NO Aspire read dependency, ever (locked decision).
        eid = _create_estimate()
        client.post(_url(eid), json=_line_payload())
        with patch(
            "api.estimating.aspire_sync.push_opportunity_service_item_qty",
            new_callable=AsyncMock,
        ) as push, patch(
            "api.estimating.aspire_sync.list_opportunities_for_property",
            new_callable=AsyncMock,
        ) as reads:
            res = client.get(_url(eid))
            assert res.status_code == 200
            push.assert_not_called()
            reads.assert_not_called()


class TestTakeoffRbac:
    def test_sales_can_read_but_not_write(self, sales):
        # Estimate creation is open to sales (intake); takeoff writes are
        # estimator-owned (takeoff is estimator scope).
        eid = _create_estimate()
        assert client.get(_url(eid)).status_code == 200
        assert client.post(_url(eid), json=_line_payload()).status_code == 403
        assert client.patch(_url(eid, "tk-x"), json={"planQty": 1}).status_code == 403
        assert client.delete(_url(eid, "tk-x")).status_code == 403


# ── Save → one batched, best-effort Aspire qty push ──────────────────────────

class TestSavePushesTakeoffQtys:
    def _setup(self, db) -> str:
        eid = _create_estimate()
        db.tables["estimates"][eid]["aspire_opportunity_id"] = 9001
        client.post(_url(eid), json=_line_payload(
            description="Mahogany", uom="ea", opportunityQty=24, catalogItemId="501"))
        client.post(_url(eid), json=_line_payload(
            description="Lateral", uom="FT", opportunityQty=1640, catalogItemId="502"))
        client.post(_url(eid), json=_line_payload(
            description="Unlinked", uom="SF", opportunityQty=5, catalogItemId=None))
        return eid

    def test_save_pushes_catalog_linked_lines_once_as_a_batch(self, estimator, db):
        eid = self._setup(db)
        with patch("api.estimating.aspire_sync.sync_enabled", return_value=True), \
             patch(
                 "api.estimating.aspire_sync.push_opportunity_service_item_qty",
                 new_callable=AsyncMock,
             ) as push:
            push.return_value.status = "synced"
            res = client.patch(f"/api/estimating/estimates/{eid}", json={"name": "Saved"})
            assert res.status_code == 200
            # ONE pass over the estimate's lines — not a call per edit/line.
            push.assert_awaited_once()
            opp_id, items = push.await_args.args
            assert opp_id == 9001
            assert [(i.service_kit_id, i.qty, i.uom) for i in items] == [
                ("501", 24.0, "ea"),
                ("502", 1640.0, "FT"),
            ]

    def test_takeoff_line_edits_do_not_push(self, estimator, db):
        eid = self._setup(db)
        line_id = client.get(_url(eid)).json()[0]["id"]
        with patch("api.estimating.aspire_sync.sync_enabled", return_value=True), \
             patch(
                 "api.estimating.aspire_sync.push_opportunity_service_item_qty",
                 new_callable=AsyncMock,
             ) as push:
            client.patch(_url(eid, line_id), json={"opportunityQty": 30})
            push.assert_not_called()

    def test_save_without_catalog_lines_skips_push(self, estimator, db):
        eid = _create_estimate()
        client.post(_url(eid), json=_line_payload(catalogItemId=None))
        with patch("api.estimating.aspire_sync.sync_enabled", return_value=True), \
             patch(
                 "api.estimating.aspire_sync.push_opportunity_service_item_qty",
                 new_callable=AsyncMock,
             ) as push:
            res = client.patch(f"/api/estimating/estimates/{eid}", json={"name": "Saved"})
            assert res.status_code == 200
            push.assert_not_called()

    def test_aspire_failure_never_fails_the_save(self, estimator, db):
        eid = self._setup(db)
        with patch("api.estimating.aspire_sync.sync_enabled", return_value=True), \
             patch(
                 "api.estimating.aspire_sync.push_opportunity_service_item_qty",
                 new=AsyncMock(side_effect=RuntimeError("aspire exploded")),
             ):
            res = client.patch(f"/api/estimating/estimates/{eid}", json={"name": "Saved"})
            assert res.status_code == 200
            assert res.json()["name"] == "Saved"

    def test_sync_disabled_short_circuits(self, estimator, db):
        # Explicitly force the gate off (the developer .env may flip it on).
        eid = self._setup(db)
        with patch("api.estimating.aspire_sync.sync_enabled", return_value=False), \
             patch(
                 "api.estimating.aspire_sync.push_opportunity_service_item_qty",
                 new_callable=AsyncMock,
             ) as push:
            res = client.patch(f"/api/estimating/estimates/{eid}", json={"name": "Saved"})
            assert res.status_code == 200
            push.assert_not_called()
