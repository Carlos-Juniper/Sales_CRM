"""Priced maintenance lines require the estimate's branch crew rate.

The $/1,000 SF formula lives only in
studio/src/lib/estimating/maintenance.ts (sellRateCentsPer1000Sf). The API
does not recompute it. It rejects (422) a priced maintenance line when neither
the frozen snapshot nor branch_settings.crew_rate_cents_per_hour is set, and
accepts the line when the branch rate is present. Unpriced lines (unit sell
null or 0) are not gated. Install estimates are not gated.
"""
from __future__ import annotations

import pytest  # noqa: F401  (asyncio_mode=auto)

from conftest import FakeDb
from test_estimating_line_items import _ESTIMATOR, _install_payload, client
from test_production_rate_guard import RATED_KIT
from api.server import app, require_auth
from api.estimating import CREW_RATE_REQUIRED_DETAIL
from unittest.mock import AsyncMock, patch


BRANCH_WITH_RATE = 3696  # Fort Myers Maintenance — operating, seeded in migration 020
BRANCH_WITHOUT_RATE = 2224  # *** PICK A BRANCH *** — not an operating branch
BRANCH_RATE_CENTS = 22_500


@pytest.fixture
def db():
    fake = FakeDb()
    fake.tables["catalog_items"][RATED_KIT["id"]] = dict(RATED_KIT)
    fake.tables["branch_settings"][str(BRANCH_WITH_RATE)] = {
        "aspire_branch_id": BRANCH_WITH_RATE,
        "crew_rate_cents_per_hour": BRANCH_RATE_CENTS,
    }
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
    base = {
        "label": "Mowing",
        "qty": 42,
        "uom": "/yr",
        "complexityPct": 0.10,
        "unitSellCents": 426,
        "hours": 1.6,
        "sortOrder": 0,
        "components": [],
    }
    return {**base, **overrides}


def _payload(branch_id: int, svc: dict | None) -> dict:
    body = {
        "estimateType": "maintenance",
        "name": "Dobson Ranch HOA — Grounds",
        "clientName": "Dobson Ranch HOA",
        "aspireBranchId": branch_id,
        "branchCity": "Fort Myers, FL",
        "customerType": "hoa",
        "targetMargin": 0.22,
        "dueBackDate": "2027-08-20",
        "sections": [],
    }
    if svc is not None:
        body["sections"] = [
            {
                "name": "Common Area",
                "squareFeet": 120_000,
                "sortOrder": 0,
                "services": [svc],
            }
        ]
    return body


class TestBranchCrewRateGate:
    def test_priced_line_uses_branch_settings_rate(self, estimator):
        resp = client.post(
            "/api/estimating/estimates",
            json=_payload(BRANCH_WITH_RATE, _svc(catalogItemId=RATED_KIT["id"])),
        )
        assert resp.status_code == 201, resp.text
        line = resp.json()["sections"][0]["services"][0]
        assert line["unitSellCents"] == 426

    def test_missing_branch_rate_rejects_priced_line(self, estimator, db):
        resp = client.post(
            "/api/estimating/estimates",
            json=_payload(BRANCH_WITHOUT_RATE, _svc()),
        )
        assert resp.status_code == 422
        assert resp.json()["detail"] == CREW_RATE_REQUIRED_DETAIL
        assert "Settings" in resp.json()["detail"]
        assert "Crew rate" in resp.json()["detail"]
        assert len(db.tables["estimates"]) == 0
        assert len(db.tables["section_services"]) == 0

    def test_unpriced_line_is_saved_without_a_crew_rate(self, estimator):
        resp = client.post(
            "/api/estimating/estimates",
            json=_payload(BRANCH_WITHOUT_RATE, _svc(unitSellCents=0, hours=1.6)),
        )
        assert resp.status_code == 201, resp.text

    def test_omitted_unit_sell_is_not_priced(self, estimator):
        svc = _svc(hours=1.6)
        svc.pop("unitSellCents")
        resp = client.post(
            "/api/estimating/estimates",
            json=_payload(BRANCH_WITHOUT_RATE, svc),
        )
        assert resp.status_code == 201, resp.text

    def test_frozen_snapshot_allows_a_priced_line_when_the_live_rate_is_gone(
        self, estimator, db
    ):
        created = client.post(
            "/api/estimating/estimates",
            json=_payload(BRANCH_WITH_RATE, None),
        )
        assert created.status_code == 201, created.text
        estimate_id = created.json()["id"]
        # Hand-edit the frozen snapshot and drop the live branch row. Pricing
        # must keep using the snapshot (same order as the editor).
        row = next(r for r in db.tables["estimates"].values() if r["id"] == estimate_id)
        row["crew_rate_cents_per_hour"] = 19_500
        del db.tables["branch_settings"][str(BRANCH_WITH_RATE)]

        section_id = client.post(
            f"/api/estimating/estimates/{estimate_id}/sections",
            json={"name": "Common Area", "squareFeet": 120_000, "services": []},
        ).json()["id"]
        resp = client.post(
            f"/api/estimating/estimates/{estimate_id}/sections/{section_id}/services",
            json=_svc(),
        )
        assert resp.status_code == 201, resp.text

    def test_patch_of_priced_line_rejects_when_the_rate_is_removed(self, estimator, db):
        created = client.post(
            "/api/estimating/estimates",
            json=_payload(BRANCH_WITH_RATE, _svc()),
        )
        assert created.status_code == 201, created.text
        est = created.json()
        section = est["sections"][0]
        svc = section["services"][0]
        del db.tables["branch_settings"][str(BRANCH_WITH_RATE)]
        resp = client.patch(
            f"/api/estimating/estimates/{est['id']}/sections/{section['id']}/services/{svc['id']}",
            json={"qty": 21},
        )
        assert resp.status_code == 422
        assert resp.json()["detail"] == CREW_RATE_REQUIRED_DETAIL
        # The edit did not persist.
        assert db.tables["section_services"][svc["id"]]["qty"] == 42

    def test_install_estimates_are_not_gated(self, estimator):
        payload = _install_payload()
        payload["aspireBranchId"] = BRANCH_WITHOUT_RATE
        resp = client.post("/api/estimating/estimates", json=payload)
        assert resp.status_code == 201, resp.text
