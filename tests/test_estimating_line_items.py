"""Line-Item Editor Persistence (backend).

DB fully mocked via an in-memory FakeDb that interprets the exact SQL shapes
api/estimating.py issues — no MySQL. Contract under test:

  * Round-trip: build a full maintenance estimate and a full install estimate
    via the API (POST with a nested sections→services→components tree), reload
    with GET, and assert the tree matches (repository criterion).
  * Section/service CRUD endpoints persist adds/edits/deletes; deleting a
    section cascades its services/components (FK ON DELETE CASCADE emulated).
  * NEW component CRUD (POST/PATCH/DELETE .../components[/{id}]) — the level
    the editors need that was missing from the backend surface.
  * NEW lifecycle endpoint (POST /estimates/{id}/lifecycle): flips
    lifecycle + derived aspire_owner and persists the edge to
    estimate_status_transitions as lifecycle:bidding → lifecycle:won — the
    in-memory frontend lifecycleAuditLog is no longer the source of truth.
  * Estimator-ownership RBAC on every new mutation route.
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


# ── Payload builders ─────────────────────────────────────────────────────────

def _maintenance_payload() -> dict:
    return {
        "estimateType": "maintenance",
        "name": "Dobson Ranch HOA — Grounds",
        "clientName": "Dobson Ranch HOA",
        "aspireBranchId": 3689, "branchCity": "Raleigh, NC",
        "customerType": "hoa",
        "contractValueCents": 5_077_395,
        "targetMargin": 0.22,
        "dueBackDate": "2027-08-20",
        "sections": [
            {
                "name": "Common Area",
                "squareFeet": 120_000,
                "sortOrder": 0,
                "services": [
                    # hours present — the production-rate guard
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
        "aspireBranchId": 3688, "branchCity": "Raleigh, NC",
        "customerType": "commercial",
        "contractValueCents": 5_342_000,
        "targetMargin": 0.42,
        "dueBackDate": "2027-08-25",
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


# ── Round-trip (repository criterion) ──────────────────────────

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


# ── Component CRUD (the missing level) ─────────────────────

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
