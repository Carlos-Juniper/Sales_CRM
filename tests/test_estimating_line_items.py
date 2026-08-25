"""Handoff 17 — Line-Item Editor Persistence (backend).

DB fully mocked via an in-memory FakeDb that interprets the exact SQL shapes
api/estimating.py issues — no MySQL. Contract under test:

  * Round-trip: build a full maintenance estimate and a full install estimate
    via the API (POST with a nested sections→services→components tree), reload
    with GET, and assert the tree matches (Handoff 00 §6 repository criterion).
  * Section/service CRUD endpoints persist adds/edits/deletes; deleting a
    section cascades its services/components (FK ON DELETE CASCADE emulated).
  * NEW component CRUD (POST/PATCH/DELETE .../components[/{id}]) — the level
    the editors need that was missing from the backend surface.
  * NEW lifecycle endpoint (POST /estimates/{id}/lifecycle): flips
    lifecycle + derived aspire_owner and persists the edge to
    estimate_status_transitions as lifecycle:bidding → lifecycle:won — the
    in-memory frontend lifecycleAuditLog is no longer the source of truth.
  * Estimator-ownership RBAC (Handoff 18) on every new mutation route.
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
    "role": "maintenance_estimating", "branch_id": "Raleigh", "avatar_initials": "EM",
}
_SALES = {
    "id": "u2", "name": "Sally Sales", "email": "s@x.com",
    "role": "sales", "branch_id": "Raleigh", "avatar_initials": "SS",
}


# ── In-memory fake DB (interprets the SQL api/estimating.py issues) ──────────

_CHILDREN = {
    "estimates": [("estimate_sections", "estimate_id"),
                  ("estimate_status_transitions", "estimate_id"),
                  ("intake_submissions", "estimate_id")],
    "estimate_sections": [("section_services", "section_id")],
    "section_services": [("section_service_components", "section_service_id")],
}


class FakeDb:
    def __init__(self) -> None:
        # defaultdict keeps the fake tolerant of tables touched by adjacent
        # features (e.g. itb_projects from Handoff 21) without modeling them.
        from collections import defaultdict

        self.tables: dict[str, dict[str, dict]] = defaultdict(dict)

    # -- helpers ---------------------------------------------------------------
    def _cascade_delete(self, table: str, row_id: str) -> None:
        self.tables[table].pop(row_id, None)
        for child, fk in _CHILDREN.get(table, []):
            for cid in [r["id"] for r in self.tables[child].values() if r.get(fk) == row_id]:
                self._cascade_delete(child, cid)

    @staticmethod
    def _norm(sql: str) -> str:
        return " ".join(sql.split())

    # -- execute (INSERT / UPDATE / DELETE) ------------------------------------
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

        m = re.match(r"UPDATE (\w+) SET (.*) WHERE (id|estimate_id) = %s$", s, re.I)
        if m:
            table, sets, key_col = m.group(1), m.group(2), m.group(3)
            if key_col == "id":
                row = self.tables[table].get(params[-1])
            else:
                row = next(
                    (r for r in self.tables[table].values() if r.get(key_col) == params[-1]),
                    None,
                )
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
        if table == "estimate_status_transitions":
            row.setdefault("at", datetime(2026, 8, 4, 12, 0, 0))
        row.setdefault("created_at", datetime(2026, 8, 4, 12, 0, 0))
        row.setdefault("updated_at", datetime(2026, 8, 4, 12, 0, 0))

    # -- query (SELECT) ---------------------------------------------------------
    async def query(self, sql: str, params=None):
        s = self._norm(sql)
        params = list(params or [])

        # Ownership-chain JOINs (service level).
        if re.search(r"FROM section_services sv JOIN estimate_sections s", s):
            svc_id, section_id, estimate_id = params
            svc = self.tables["section_services"].get(svc_id)
            sec = self.tables["estimate_sections"].get(section_id)
            if svc and sec and svc["section_id"] == section_id and sec["estimate_id"] == estimate_id:
                return [dict(svc)]
            return []

        # Ownership-chain JOINs (component level).
        if re.search(r"FROM section_service_components c JOIN section_services sv", s):
            comp_id, service_id, section_id, estimate_id = params
            comp = self.tables["section_service_components"].get(comp_id)
            svc = self.tables["section_services"].get(service_id)
            sec = self.tables["estimate_sections"].get(section_id)
            if (
                comp and svc and sec
                and comp["section_service_id"] == service_id
                and svc["section_id"] == section_id
                and sec["estimate_id"] == estimate_id
            ):
                return [dict(comp)]
            return []

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
                    cm = re.match(r"(\w+) IN \((.*)\)$", cond.strip())
                    if cm:
                        col = cm.group(1)
                        n = cm.group(2).count("%s")
                        vals = params[idx: idx + n]
                        idx += n
                        rows = [r for r in rows if r.get(col) in vals]
                        continue
                    cm = re.match(r"(\w+) IN \('([^']*)'(?:,\s*'([^']*)')*\)$", cond.strip())
                    if cm:  # literal IN list (sweep query) — not exercised here
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


# ── Payload builders ─────────────────────────────────────────────────────────

def _maintenance_payload() -> dict:
    return {
        "estimateType": "maintenance",
        "name": "Dobson Ranch HOA — Grounds",
        "clientName": "Dobson Ranch HOA",
        "branch": "Raleigh",
        "customerType": "hoa",
        "contractValueCents": 5_077_395,
        "targetMargin": 0.22,
        "dueBackDate": "2026-08-20",
        "sections": [
            {
                "name": "Common Area",
                "squareFeet": 120_000,
                "sortOrder": 0,
                "services": [
                    # hours present — the Handoff 22 production-rate guard
                    # requires every maintenance line to resolve hours.
                    {"label": "Mowing", "qty": 42, "uom": "/yr", "complexityPct": 0.10,
                     "unitSellCents": 450, "hours": 1.5, "sortOrder": 0, "components": []},
                    {"label": "Bed detail", "qty": 26, "uom": "/yr", "complexityPct": 0.05,
                     "unitSellCents": 210, "hours": 0.8, "sortOrder": 1, "components": []},
                ],
            },
            {
                "name": "Entry & Medians",
                "squareFeet": 45_000,
                "sortOrder": 1,
                "services": [
                    {"label": "Mowing", "qty": 42, "uom": "/yr", "complexityPct": 0.15,
                     "unitSellCents": 450, "hours": 1.5, "sortOrder": 0, "components": []},
                ],
            },
        ],
    }


def _install_payload() -> dict:
    return {
        "estimateType": "install",
        "name": "Greenfield Estate Install",
        "clientName": "Greenfield GC",
        "branch": "Raleigh",
        "customerType": "commercial",
        "contractValueCents": 5_342_000,
        "targetMargin": 0.42,
        "dueBackDate": "2026-08-25",
        "sections": [
            {
                "name": "Phase 1 — Planting",
                "squareFeet": 0,
                "sortOrder": 0,
                "services": [
                    {
                        "label": 'Mahogany 30g', "qty": 20, "uom": "30g",
                        "complexityPct": 0, "unitSellCents": 150_000,
                        "embeddedCostCents": 82_500, "targetGm": 0.45,
                        "hours": 2.5, "sortOrder": 0,
                        "components": [
                            {"kind": "labor", "label": "Install crew", "qty": 8,
                             "unitCostCents": 4_500, "hours": 8, "sortOrder": 0},
                            {"kind": "material", "label": "Tree stakes", "qty": 40,
                             "unitCostCents": 350, "sortOrder": 1},
                        ],
                    },
                ],
            },
        ],
    }


def _create(payload: dict) -> dict:
    resp = client.post("/api/estimating/estimates", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _get(estimate_id: str) -> dict:
    resp = client.get(f"/api/estimating/estimates/{estimate_id}")
    assert resp.status_code == 200, resp.text
    return resp.json()


# ── Round-trip (Handoff 00 §6 repository criterion) ──────────────────────────

class TestRoundTrip:
    def test_maintenance_estimate_round_trips_full_tree(self, estimator):
        created = _create(_maintenance_payload())
        fetched = _get(created["id"])

        assert [s["name"] for s in fetched["sections"]] == ["Common Area", "Entry & Medians"]
        assert [s["squareFeet"] for s in fetched["sections"]] == [120_000, 45_000]
        common = fetched["sections"][0]
        assert [sv["label"] for sv in common["services"]] == ["Mowing", "Bed detail"]
        mow = common["services"][0]
        assert mow["qty"] == 42
        assert mow["complexityPct"] == 0.10
        assert mow["unitSellCents"] == 450
        assert mow["sortOrder"] == 0
        assert common["services"][1]["sortOrder"] == 1
        assert fetched["sections"][1]["services"][0]["complexityPct"] == 0.15
        # ids were assigned server-side and stitched consistently
        assert all(s["estimateId"] == created["id"] for s in fetched["sections"])
        for s in fetched["sections"]:
            assert all(sv["sectionId"] == s["id"] for sv in s["services"])

    def test_install_estimate_round_trips_components(self, estimator):
        created = _create(_install_payload())
        fetched = _get(created["id"])

        svc = fetched["sections"][0]["services"][0]
        assert svc["label"] == "Mahogany 30g"
        assert svc["embeddedCostCents"] == 82_500
        assert svc["targetGm"] == 0.45
        comps = svc["components"]
        assert [(c["kind"], c["label"]) for c in comps] == [
            ("labor", "Install crew"), ("material", "Tree stakes"),
        ]
        assert comps[0]["qty"] == 8
        assert comps[0]["unitCostCents"] == 4_500
        assert comps[0]["hours"] == 8
        assert comps[1]["unitCostCents"] == 350
        assert comps[1]["hours"] is None
        assert [c["sortOrder"] for c in comps] == [0, 1]
        assert all(c["sectionServiceId"] == svc["id"] for c in comps)


# ── Section / service CRUD persists (existing routes, previously untested) ───

class TestSectionServicePersistence:
    def test_added_section_and_service_survive_reload(self, estimator):
        est = _create({**_maintenance_payload(), "sections": []})
        resp = client.post(
            f"/api/estimating/estimates/{est['id']}/sections",
            json={"name": "New region", "squareFeet": 100_000},
        )
        assert resp.status_code == 201
        section = resp.json()

        resp = client.post(
            f"/api/estimating/estimates/{est['id']}/sections/{section['id']}/services",
            json={"label": "Mowing", "qty": 42, "uom": "/yr", "complexityPct": 0.1,
                  "unitSellCents": 450, "hours": 1.5, "components": []},
        )
        assert resp.status_code == 201

        fetched = _get(est["id"])
        assert len(fetched["sections"]) == 1
        assert fetched["sections"][0]["name"] == "New region"
        assert fetched["sections"][0]["services"][0]["label"] == "Mowing"

    def test_service_edits_survive_reload(self, estimator):
        est = _create(_maintenance_payload())
        section = est["sections"][0]
        svc = section["services"][0]
        resp = client.patch(
            f"/api/estimating/estimates/{est['id']}/sections/{section['id']}/services/{svc['id']}",
            json={"qty": 21, "complexityPct": 0.25},
        )
        assert resp.status_code == 200

        fetched = _get(est["id"])
        updated = fetched["sections"][0]["services"][0]
        assert updated["qty"] == 21
        assert updated["complexityPct"] == 0.25

    def test_deleted_section_is_gone_after_reload_with_children(self, estimator):
        est = _create(_install_payload())
        section = est["sections"][0]
        resp = client.delete(f"/api/estimating/estimates/{est['id']}/sections/{section['id']}")
        assert resp.status_code == 204

        fetched = _get(est["id"])
        assert fetched["sections"] == []

    def test_deleted_service_is_gone_after_reload(self, estimator):
        est = _create(_maintenance_payload())
        section = est["sections"][0]
        svc = section["services"][0]
        resp = client.delete(
            f"/api/estimating/estimates/{est['id']}/sections/{section['id']}/services/{svc['id']}"
        )
        assert resp.status_code == 204

        fetched = _get(est["id"])
        assert [sv["label"] for sv in fetched["sections"][0]["services"]] == ["Bed detail"]


# ── Component CRUD (the missing level — Handoff 17 §2.2) ─────────────────────

def _install_ids(est: dict) -> tuple[str, str, str]:
    section = est["sections"][0]
    return est["id"], section["id"], section["services"][0]["id"]


class TestComponentCrud:
    def test_create_component_appends_and_survives_reload(self, estimator):
        est = _create(_install_payload())
        eid, sid, svid = _install_ids(est)
        resp = client.post(
            f"/api/estimating/estimates/{eid}/sections/{sid}/services/{svid}/components",
            json={"kind": "material", "label": "Mulch", "qty": 12, "unitCostCents": 900},
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["kind"] == "material"
        assert body["label"] == "Mulch"
        assert body["sectionServiceId"] == svid
        assert body["sortOrder"] == 2  # appended after the two seeded components

        fetched = _get(eid)
        labels = [c["label"] for c in fetched["sections"][0]["services"][0]["components"]]
        assert labels == ["Install crew", "Tree stakes", "Mulch"]

    def test_patch_component_edits_survive_reload(self, estimator):
        est = _create(_install_payload())
        eid, sid, svid = _install_ids(est)
        comp = est["sections"][0]["services"][0]["components"][0]
        resp = client.patch(
            f"/api/estimating/estimates/{eid}/sections/{sid}/services/{svid}/components/{comp['id']}",
            json={"qty": 16, "unitCostCents": 5_000},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["qty"] == 16

        fetched = _get(eid)
        updated = fetched["sections"][0]["services"][0]["components"][0]
        assert updated["qty"] == 16
        assert updated["unitCostCents"] == 5_000

    def test_delete_component_is_gone_after_reload(self, estimator):
        est = _create(_install_payload())
        eid, sid, svid = _install_ids(est)
        comp = est["sections"][0]["services"][0]["components"][0]
        resp = client.delete(
            f"/api/estimating/estimates/{eid}/sections/{sid}/services/{svid}/components/{comp['id']}"
        )
        assert resp.status_code == 204

        fetched = _get(eid)
        labels = [c["label"] for c in fetched["sections"][0]["services"][0]["components"]]
        assert labels == ["Tree stakes"]

    def test_component_routes_404_on_broken_ownership_chain(self, estimator):
        est = _create(_install_payload())
        eid, sid, svid = _install_ids(est)
        other = _create(_install_payload())
        stray_comp = other["sections"][0]["services"][0]["components"][0]["id"]
        resp = client.patch(
            f"/api/estimating/estimates/{eid}/sections/{sid}/services/{svid}/components/{stray_comp}",
            json={"qty": 1},
        )
        assert resp.status_code == 404
        resp = client.post(
            f"/api/estimating/estimates/{eid}/sections/{sid}/services/svc-nope/components",
            json={"kind": "labor", "label": "x"},
        )
        assert resp.status_code == 404

    def test_component_mutations_are_estimator_owned(self, sales):
        # Guards run before existence checks — a sales role gets 403, never 404.
        resp = client.post(
            "/api/estimating/estimates/est-x/sections/sec-x/services/svc-x/components",
            json={"kind": "labor", "label": "x"},
        )
        assert resp.status_code == 403
        resp = client.patch(
            "/api/estimating/estimates/est-x/sections/sec-x/services/svc-x/components/cmp-x",
            json={"qty": 1},
        )
        assert resp.status_code == 403
        resp = client.delete(
            "/api/estimating/estimates/est-x/sections/sec-x/services/svc-x/components/cmp-x"
        )
        assert resp.status_code == 403


# ── Lifecycle flip persists through the status-transition path (§2.3) ────────

class TestLifecycleTransition:
    def test_won_flip_persists_and_writes_audit_row(self, estimator):
        est = _create(_maintenance_payload())
        resp = client.post(
            f"/api/estimating/estimates/{est['id']}/lifecycle", json={"to": "won"}
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["estimate"]["lifecycle"] == "won"
        assert body["estimate"]["aspireOwner"] == "crm"
        assert body["transition"] == {
            "estimateId": est["id"],
            "from": "lifecycle:bidding",
            "to": "lifecycle:won",
            "actor": "Esti Mator",
            "at": body["transition"]["at"],
        }

        # Survives reload — both the estimate row and the audit trail.
        fetched = _get(est["id"])
        assert fetched["lifecycle"] == "won"
        assert fetched["aspireOwner"] == "crm"
        audit = client.get(
            f"/api/estimating/estimates/{est['id']}/status-transitions"
        ).json()
        assert {"from": "lifecycle:bidding", "to": "lifecycle:won"}.items() <= audit[-1].items()
        assert audit[-1]["actor"] == "Esti Mator"

    def test_flip_back_to_bidding_restores_estimating_ownership(self, estimator):
        est = _create(_maintenance_payload())
        client.post(f"/api/estimating/estimates/{est['id']}/lifecycle", json={"to": "won"})
        resp = client.post(
            f"/api/estimating/estimates/{est['id']}/lifecycle", json={"to": "bidding"}
        )
        assert resp.status_code == 200
        assert resp.json()["estimate"]["aspireOwner"] == "estimating"
        audit = client.get(
            f"/api/estimating/estimates/{est['id']}/status-transitions"
        ).json()
        assert [(t["from"], t["to"]) for t in audit] == [
            ("lifecycle:bidding", "lifecycle:won"),
            ("lifecycle:won", "lifecycle:bidding"),
        ]

    def test_same_lifecycle_is_a_noop_without_audit_spam(self, estimator):
        est = _create(_maintenance_payload())
        resp = client.post(
            f"/api/estimating/estimates/{est['id']}/lifecycle", json={"to": "bidding"}
        )
        assert resp.status_code == 200
        assert resp.json()["transition"] is None
        audit = client.get(
            f"/api/estimating/estimates/{est['id']}/status-transitions"
        ).json()
        assert audit == []

    def test_rejects_bad_target_and_missing_estimate(self, estimator):
        est = _create(_maintenance_payload())
        resp = client.post(
            f"/api/estimating/estimates/{est['id']}/lifecycle", json={"to": "lost"}
        )
        assert resp.status_code == 400
        resp = client.post(
            "/api/estimating/estimates/est-missing/lifecycle", json={"to": "won"}
        )
        assert resp.status_code == 404

    def test_lifecycle_flip_is_estimator_owned(self, sales):
        resp = client.post(
            "/api/estimating/estimates/est-x/lifecycle", json={"to": "won"}
        )
        assert resp.status_code == 403
