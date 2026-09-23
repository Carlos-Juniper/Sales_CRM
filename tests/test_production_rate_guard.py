"""Production-rate save guard (backend, server-side enforcement).

Locked decision: production rates are REQUIRED — a maintenance line cannot be
saved with a null production rate / unresolvable hours. A line resolves when:

  * the line itself carries non-null hours (hours trivially computable), OR
  * its catalog_item has a non-null production_rate.

Otherwise the write is rejected 422 with a clear message (frontend shows its
own guard, but the server never trusts the client). Install estimates are
untouched — install kits are quantity-driven and carry no production rate.

Enforced on every path that persists maintenance service lines:
  POST /estimates (nested tree) · POST sections (nested services)
  POST services · PATCH services (including edits that null-out hours or
  repoint catalog_item_id at an unrated kit).
"""
from __future__ import annotations

import pytest  # noqa: F401  (asyncio_mode=auto)

from conftest import FakeDb  # the one shared copy
from test_estimating_line_items import (  # same-dir import (pytest rootdir)
    _ESTIMATOR,
    _install_payload,
    _maintenance_payload,
    client,
)
from api.server import app, require_auth
from unittest.mock import AsyncMock, patch


RATED_KIT = {
    "id": "kit-maint-3422", "description": "Standard Production Mowing",
    "uom": "Sq. Ft.", "unit_cost_cents": 1750, "unit_sell_cents": 0,
    "target_gm": 0.22, "kit_type": "maintenance_hours",
    "production_rate": 67650.0, "branch": "All Branches", "active": 1,
    "service_type": "Turf Area",
}
UNRATED_KIT = {
    **RATED_KIT,
    "id": "kit-maint-3435", "description": "Prune Easy",
    "unit_cost_cents": 0, "production_rate": None, "service_type": "Bed Area",
}


@pytest.fixture
def db():
    fake = FakeDb()
    for kit in (RATED_KIT, UNRATED_KIT):
        fake.tables["catalog_items"][kit["id"]] = dict(kit)
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


def _svc(**overrides) -> dict:
    base = {"label": "Mowing", "qty": 42, "uom": "/yr", "complexityPct": 0.10,
            "unitSellCents": 450, "sortOrder": 0, "components": []}
    return {**base, **overrides}


def _maint_with_service(svc: dict) -> dict:
    payload = _maintenance_payload()
    payload["sections"] = [
        {"name": "Common Area", "squareFeet": 120_000, "sortOrder": 0,
         "services": [svc]},
    ]
    return payload


def _create_maint(services_ok=True) -> dict:
    svc = _svc(catalogItemId=RATED_KIT["id"]) if services_ok else _svc()
    resp = client.post("/api/estimating/estimates", json=_maint_with_service(svc))
    assert resp.status_code == 201, resp.text
    return resp.json()


class TestCreateEstimateGuard:
    def test_rejects_line_with_no_hours_and_no_kit(self, estimator):
        resp = client.post(
            "/api/estimating/estimates", json=_maint_with_service(_svc())
        )
        assert resp.status_code == 422
        assert "production rate" in resp.json()["detail"].lower()
        assert "Mowing" in resp.json()["detail"]

    def test_rejects_line_whose_kit_has_null_production_rate(self, estimator):
        resp = client.post(
            "/api/estimating/estimates",
            json=_maint_with_service(_svc(catalogItemId=UNRATED_KIT["id"])),
        )
        assert resp.status_code == 422
        assert "production rate" in resp.json()["detail"].lower()

    def test_rejects_line_pointing_at_unknown_kit(self, estimator):
        resp = client.post(
            "/api/estimating/estimates",
            json=_maint_with_service(_svc(catalogItemId="kit-nope")),
        )
        assert resp.status_code == 422

    def test_accepts_line_with_rated_kit(self, estimator, db):
        resp = client.post(
            "/api/estimating/estimates",
            json=_maint_with_service(_svc(catalogItemId=RATED_KIT["id"])),
        )
        assert resp.status_code == 201, resp.text
        # nothing partial persisted on the earlier rejects
        assert len(db.tables["estimates"]) == 1

    def test_accepts_line_with_explicit_hours(self, estimator):
        resp = client.post(
            "/api/estimating/estimates", json=_maint_with_service(_svc(hours=1.6))
        )
        assert resp.status_code == 201, resp.text

    def test_rejected_create_persists_nothing(self, estimator, db):
        resp = client.post(
            "/api/estimating/estimates", json=_maint_with_service(_svc())
        )
        assert resp.status_code == 422
        assert len(db.tables["estimates"]) == 0
        assert len(db.tables["section_services"]) == 0

    def test_install_estimates_are_not_gated(self, estimator):
        payload = _install_payload()
        # strip hours from the install line — still fine: install kits are
        # quantity-driven and carry no production rate by design
        payload["sections"][0]["services"][0].pop("hours")
        resp = client.post("/api/estimating/estimates", json=payload)
        assert resp.status_code == 201, resp.text


class TestSectionAndServiceGuard:
    def test_create_section_rejects_unresolvable_nested_service(self, estimator):
        est = _create_maint()
        resp = client.post(
            f"/api/estimating/estimates/{est['id']}/sections",
            json={"name": "Entry", "squareFeet": 45_000, "services": [_svc()]},
        )
        assert resp.status_code == 422

    def test_create_service_rejects_unrated_kit(self, estimator):
        est = _create_maint()
        section_id = est["sections"][0]["id"]
        resp = client.post(
            f"/api/estimating/estimates/{est['id']}/sections/{section_id}/services",
            json=_svc(catalogItemId=UNRATED_KIT["id"]),
        )
        assert resp.status_code == 422
        assert "production rate" in resp.json()["detail"].lower()

    def test_create_service_accepts_rated_kit(self, estimator):
        est = _create_maint()
        section_id = est["sections"][0]["id"]
        resp = client.post(
            f"/api/estimating/estimates/{est['id']}/sections/{section_id}/services",
            json=_svc(label="Bed detail", catalogItemId=RATED_KIT["id"]),
        )
        assert resp.status_code == 201, resp.text

    def test_patch_cannot_null_out_hours_without_rated_kit(self, estimator):
        # line saved via explicit hours, no kit — nulling hours must be blocked
        payload = _maint_with_service(_svc(hours=1.6))
        est = client.post("/api/estimating/estimates", json=payload).json()
        section = est["sections"][0]
        svc = section["services"][0]
        resp = client.patch(
            f"/api/estimating/estimates/{est['id']}/sections/{section['id']}"
            f"/services/{svc['id']}",
            json={"hours": None},
        )
        assert resp.status_code == 422

    def test_patch_cannot_repoint_at_unrated_kit(self, estimator):
        est = _create_maint()
        section = est["sections"][0]
        svc = section["services"][0]
        resp = client.patch(
            f"/api/estimating/estimates/{est['id']}/sections/{section['id']}"
            f"/services/{svc['id']}",
            json={"catalogItemId": UNRATED_KIT["id"]},
        )
        assert resp.status_code == 422

    def test_patch_unrelated_field_on_resolved_line_is_fine(self, estimator):
        est = _create_maint()
        section = est["sections"][0]
        svc = section["services"][0]
        resp = client.patch(
            f"/api/estimating/estimates/{est['id']}/sections/{section['id']}"
            f"/services/{svc['id']}",
            json={"qty": 21},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["qty"] == 21
