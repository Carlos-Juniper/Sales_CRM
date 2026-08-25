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


# ── In-memory fake DB (interprets the SQL api/estimating.py issues) ──────────

_CHILDREN = {
    "estimates": [("estimate_sections", "estimate_id"),
                  ("estimate_status_transitions", "estimate_id"),
                  ("intake_submissions", "estimate_id"),
                  ("takeoff_lines", "estimate_id")],
    "estimate_sections": [("section_services", "section_id")],
    "section_services": [("section_service_components", "section_service_id")],
}


class FakeDb:
    def __init__(self) -> None:
        from collections import defaultdict

        self.tables: dict[str, dict[str, dict]] = defaultdict(dict)

    def _cascade_delete(self, table: str, row_id: str) -> None:
        self.tables[table].pop(row_id, None)
        for child, fk in _CHILDREN.get(table, []):
            for cid in [r["id"] for r in self.tables[child].values() if r.get(fk) == row_id]:
                self._cascade_delete(child, cid)

    @staticmethod
    def _norm(sql: str) -> str:
        return " ".join(sql.split())

    async def execute(self, sql: str, params=None):
        s = self._norm(sql)
        params = list(params or [])

        m = re.match(r"INSERT INTO (\w+)\s*\(([^)]*)\)\s*VALUES\s*\((.*)\)", s, re.I)
        if m:
            table, cols_str, vals_str = m.group(1), m.group(2), m.group(3)
            cols = [c.strip() for c in cols_str.split(",")]
            tokens = re.findall(r"%s|NULL|CURRENT_TIMESTAMP|\d+", vals_str)
            it = iter(params)
            row: dict = {}
            for col, tok in zip(cols, tokens):
                if tok == "%s":
                    row[col] = next(it)
                elif tok == "NULL":
                    row[col] = None
                elif tok == "CURRENT_TIMESTAMP":
                    row[col] = datetime(2026, 8, 4, 12, 0, 0)
                else:
                    row[col] = int(tok)
            self._apply_defaults(table, row)
            self.tables[table][row["id"]] = row
            return

        m = re.match(r"UPDATE (\w+) SET (.*) WHERE id = %s$", s, re.I)
        if m:
            table, sets = m.group(1), m.group(2)
            row = self.tables[table].get(params[-1])
            i = 0
            for part in [p.strip() for p in sets.split(",")]:
                col, expr = [x.strip() for x in part.split("=", 1)]
                if expr == "%s":
                    if row is not None:
                        row[col] = params[i]
                    i += 1
                elif expr.startswith("COALESCE(%s"):
                    if row is not None and params[i] is not None:
                        row[col] = params[i]
                    i += 1
                elif "CURRENT_TIMESTAMP" in expr:
                    if row is not None:
                        row[col] = datetime(2026, 8, 4, 12, 0, 0)
            return

        m = re.match(r"DELETE FROM (\w+) WHERE id = %s$", s, re.I)
        if m:
            self._cascade_delete(m.group(1), params[0])
            return

        raise AssertionError(f"FakeDb.execute: unhandled SQL: {s}")

    def _apply_defaults(self, table: str, row: dict) -> None:
        if table == "estimates":
            row.setdefault("aspire_opportunity_id", None)
            row.setdefault("aspire_lost_reason_id", None)
            row.setdefault("aspire_sync_status", "pending")
            row.setdefault("aspire_sync_error", None)
            row.setdefault("aspire_synced_at", None)
        if table == "takeoff_lines":
            row.setdefault("catalog_item_id", None)
        row.setdefault("created_at", datetime(2026, 8, 4, 12, 0, 0))
        row.setdefault("updated_at", datetime(2026, 8, 4, 12, 0, 0))

    async def query(self, sql: str, params=None):
        s = self._norm(sql)
        params = list(params or [])

        m = re.match(r"SELECT COUNT\(\*\) AS c FROM (\w+) WHERE (\w+) = %s$", s, re.I)
        if m:
            table, col = m.group(1), m.group(2)
            n = sum(1 for r in self.tables[table].values() if r.get(col) == params[0])
            return [{"c": n}]

        m = re.match(
            r"SELECT (.*?) FROM (\w+)(?: WHERE (.*?))?(?: ORDER BY (.*?))?(?: LIMIT %s)?$",
            s, re.I,
        )
        if m:
            cols_str, table, where, order = m.groups()
            rows = list(self.tables[table].values())
            if where:
                idx = 0
                for cond in where.split(" AND "):
                    cm = re.match(r"(\w+) = %s$", cond.strip())
                    if cm:
                        col, val = cm.group(1), params[idx]
                        idx += 1
                        rows = [r for r in rows if r.get(col) == val]
                        continue
                    cm = re.match(r"(\w+) IS NOT NULL$", cond.strip())
                    if cm:
                        col = cm.group(1)
                        rows = [r for r in rows if r.get(col) is not None]
                        continue
                    cm = re.match(r"(\w+) IN \((.*)\)$", cond.strip())
                    if cm:
                        col = cm.group(1)
                        n = cm.group(2).count("%s")
                        vals = params[idx: idx + n]
                        idx += n
                        rows = [r for r in rows if r.get(col) in vals]
                        continue
                    raise AssertionError(f"FakeDb.query: unhandled WHERE cond: {cond}")
            if order:
                key = order.split(",")[0].strip()
                desc = key.upper().endswith(" DESC")
                key = key.split()[0]
                rows = sorted(rows, key=lambda r: (r.get(key) is None, r.get(key)), reverse=desc)
            cols_str = cols_str.strip()
            if cols_str != "*":
                cols = [c.strip() for c in cols_str.split(",")]
                return [{c: r.get(c) for c in cols} for r in rows]
            return [dict(r) for r in rows]

        raise AssertionError(f"FakeDb.query: unhandled SQL: {s}")


@pytest.fixture
def db():
    fake = FakeDb()
    with patch("api.estimating.query", new=AsyncMock(side_effect=fake.query)), \
         patch("api.estimating.execute", new=AsyncMock(side_effect=fake.execute)), \
         patch("api.estimating._sync_new_opportunity_bg", new_callable=AsyncMock), \
         patch("api.estimating._sync_status_bg", new_callable=AsyncMock):
        yield fake


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
            "branch": "Raleigh",
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
            assert [(i.catalog_item_id, i.qty, i.uom) for i in items] == [
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
