"""Crew-rate-derived maintenance sells.

The server computes the $/1,000 SF sell from the live branch crew rate and
writes it onto lines whose kit has no catalog price. A positive unit sell
that is not that formula is hand-entered. A kit with unit_sell_cents > 0 is
catalog-priced. Only derived lines are blocked (422 crew_rate_required)
when the live rate is missing, and only those lines are repriced when
Settings changes the rate. The frozen snapshot is not a pricing source.
"""
from __future__ import annotations

from pathlib import Path

import pytest  # noqa: F401  (asyncio_mode=auto)

from conftest import FakeDb, seed_default_install_catalog
from test_estimating_line_items import _ESTIMATOR, _install_payload, client
from test_production_rate_guard import RATED_KIT
from api.maintenance_pricing import reprice_open_drafts, sell_rate_cents_per_1000_sf
from api.server import app, require_auth
from unittest.mock import AsyncMock, patch


BRANCH_WITH_RATE = 3696  # Fort Myers Maintenance — operating, seeded in migration 020
BRANCH_WITHOUT_RATE = 2224  # *** PICK A BRANCH *** — not an operating branch
OTHER_BRANCH = 1403
BRANCH_RATE_CENTS = 22_500
PREVIOUS_RATE_CENTS = 18_000
DERIVED_AT_PREVIOUS = sell_rate_cents_per_1000_sf(67_650, 0.22, PREVIOUS_RATE_CENTS)
DERIVED_AT_LIVE = sell_rate_cents_per_1000_sf(67_650, 0.22, BRANCH_RATE_CENTS)

CATALOG_KIT = {
    **RATED_KIT,
    "id": "kit-catalog-price",
    "description": "Catalog-priced mowing",
    "unit_sell_cents": 450,
}
# Catalog price that happens to equal the formula at the previous rate.
COINCIDENCE_KIT = {
    **RATED_KIT,
    "id": "kit-catalog-coincidence",
    "description": "Catalog price equals old formula",
    "unit_sell_cents": DERIVED_AT_PREVIOUS,
}

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def db():
    fake = FakeDb()
    for kit in (RATED_KIT, CATALOG_KIT, COINCIDENCE_KIT):
        fake.tables["service_kits"][kit["id"]] = dict(kit)
    fake.tables["branch_settings"][str(BRANCH_WITH_RATE)] = {
        "aspire_branch_id": BRANCH_WITH_RATE,
        "crew_rate_cents_per_hour": BRANCH_RATE_CENTS,
    }
    seed_default_install_catalog(fake)  # install create uses the catalog-driven section path
    with patch("api.estimating.query", new=AsyncMock(side_effect=fake.query)), \
         patch("api.estimating.execute", new=AsyncMock(side_effect=fake.execute)), \
         patch("api.estimating.transaction", new=fake.transaction), \
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


def _payload(branch_id: int, services: list[dict] | None) -> dict:
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
    if services is not None:
        body["sections"] = [
            {
                "name": "Common Area",
                "squareFeet": 120_000,
                "sortOrder": 0,
                "services": services,
            }
        ]
    return body


def _derived(**overrides) -> dict:
    return _svc(**{
        "label": "Derived mow",
        "serviceKitId": RATED_KIT["id"],
        "unitSellCents": 0,
        **overrides,
    })


def _assert_missing(resp, lines: list[dict] | None = None) -> list[dict]:
    assert resp.status_code == 422, resp.text
    detail = resp.json()["detail"]
    assert set(detail) == {"code", "blockedLines"}
    assert detail["code"] == "crew_rate_required"
    assert isinstance(detail["blockedLines"], list)
    for line in detail["blockedLines"]:
        assert set(line) <= {"serviceId", "sectionId"}
        assert isinstance(line["serviceId"], str) and line["serviceId"] != ""
        if "sectionId" in line:
            assert isinstance(line["sectionId"], str) and line["sectionId"] != ""
    if lines is not None:
        assert detail["blockedLines"] == lines
    return detail["blockedLines"]


class TestBranchCrewRateGate:
    def test_formula_matches_the_editor(self):
        assert sell_rate_cents_per_1000_sf(60_000, 0.22, 18_000) == 385
        assert sell_rate_cents_per_1000_sf(60_000, 0.22, 22_500) == 481
        assert DERIVED_AT_PREVIOUS == 341
        assert DERIVED_AT_LIVE == 426

    def test_zero_sell_on_a_deriving_kit_is_priced_from_the_live_rate(self, estimator):
        resp = client.post(
            "/api/estimating/estimates",
            json=_payload(BRANCH_WITH_RATE, [_derived()]),
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["sections"][0]["services"][0]["unitSellCents"] == DERIVED_AT_LIVE

    def test_hand_entered_price_is_stored_as_sent(self, estimator):
        resp = client.post(
            "/api/estimating/estimates",
            json=_payload(BRANCH_WITH_RATE, [
                _svc(serviceKitId=RATED_KIT["id"], unitSellCents=999),
            ]),
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["sections"][0]["services"][0]["unitSellCents"] == 999

    def test_catalog_price_does_not_need_a_crew_rate(self, estimator):
        resp = client.post(
            "/api/estimating/estimates",
            json=_payload(BRANCH_WITHOUT_RATE, [
                _svc(label="Catalog price", serviceKitId=CATALOG_KIT["id"], unitSellCents=450),
            ]),
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["sections"][0]["services"][0]["unitSellCents"] == 450

    def test_positive_price_without_a_kit_does_not_need_a_rate(self, estimator):
        resp = client.post(
            "/api/estimating/estimates",
            json=_payload(BRANCH_WITHOUT_RATE, [_svc(unitSellCents=426)]),
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["sections"][0]["services"][0]["unitSellCents"] == 426

    def test_missing_rate_blocks_only_derived_lines_and_persists_nothing(self, estimator, db):
        resp = client.post(
            "/api/estimating/estimates",
            json=_payload(BRANCH_WITHOUT_RATE, [
                _derived(),
                _svc(label="Hand entered", serviceKitId=RATED_KIT["id"], unitSellCents=999),
                _svc(label="Catalog price", serviceKitId=CATALOG_KIT["id"], unitSellCents=450),
            ]),
        )
        _assert_missing(resp, [])
        assert len(db.tables["estimates"]) == 0
        assert len(db.tables["section_services"]) == 0

    def test_create_ignores_a_client_id_that_is_not_a_saved_line(self, estimator, db):
        resp = client.post(
            "/api/estimating/estimates",
            json=_payload(BRANCH_WITHOUT_RATE, [_derived(id="client-tmp")]),
        )
        _assert_missing(resp, [])
        assert len(db.tables["estimates"]) == 0

    def test_unpriced_line_without_a_deriving_kit_is_saved(self, estimator):
        resp = client.post(
            "/api/estimating/estimates",
            json=_payload(BRANCH_WITHOUT_RATE, [_svc(unitSellCents=0)]),
        )
        assert resp.status_code == 201, resp.text

    def test_omitted_unit_sell_without_a_deriving_kit_is_saved(self, estimator):
        svc = _svc()
        svc.pop("unitSellCents")
        resp = client.post(
            "/api/estimating/estimates",
            json=_payload(BRANCH_WITHOUT_RATE, [svc]),
        )
        assert resp.status_code == 201, resp.text

    def test_section_service_and_patch_price_from_the_live_rate(self, estimator, db):
        created = client.post(
            "/api/estimating/estimates",
            json=_payload(BRANCH_WITH_RATE, None),
        )
        assert created.status_code == 201, created.text
        estimate_id = created.json()["id"]

        section = client.post(
            f"/api/estimating/estimates/{estimate_id}/sections",
            json={"name": "Entry", "squareFeet": 45_000, "services": [_derived(label="Section line")]},
        )
        assert section.status_code == 201, section.text
        assert section.json()["services"][0]["unitSellCents"] == DERIVED_AT_LIVE

        added = client.post(
            f"/api/estimating/estimates/{estimate_id}/sections/{section.json()['id']}/services",
            json=_derived(label="Service line"),
        )
        assert added.status_code == 201, added.text
        assert added.json()["unitSellCents"] == DERIVED_AT_LIVE

        patched = client.patch(
            f"/api/estimating/estimates/{estimate_id}/sections/{section.json()['id']}"
            f"/services/{added.json()['id']}",
            json={"unitSellCents": 0},
        )
        assert patched.status_code == 200, patched.text
        assert patched.json()["unitSellCents"] == DERIVED_AT_LIVE
        assert db.tables["section_services"][added.json()["id"]]["unit_sell_cents"] == DERIVED_AT_LIVE

    def test_frozen_snapshot_does_not_price_a_derived_line(self, estimator, db):
        created = client.post(
            "/api/estimating/estimates",
            json=_payload(BRANCH_WITH_RATE, None),
        )
        assert created.status_code == 201, created.text
        estimate_id = created.json()["id"]
        row = next(r for r in db.tables["estimates"].values() if r["id"] == estimate_id)
        row["crew_rate_cents_per_hour"] = 19_500
        del db.tables["branch_settings"][str(BRANCH_WITH_RATE)]

        resp = client.post(
            f"/api/estimating/estimates/{estimate_id}/sections",
            json={"name": "Common Area", "squareFeet": 120_000, "services": [_derived()]},
        )
        _assert_missing(resp, [])
        assert len(db.tables["estimate_sections"]) == 0

    def test_section_post_blocks_only_the_derived_line(self, estimator, db):
        created = client.post(
            "/api/estimating/estimates",
            json=_payload(BRANCH_WITHOUT_RATE, None),
        )
        assert created.status_code == 201, created.text
        resp = client.post(
            f"/api/estimating/estimates/{created.json()['id']}/sections",
            json={
                "name": "Common Area",
                "squareFeet": 120_000,
                "services": [
                    _svc(label="Hand entered", unitSellCents=999),
                    _derived(),
                ],
            },
        )
        _assert_missing(resp, [])
        assert len(db.tables["estimate_sections"]) == 0

    def test_service_post_returns_the_structured_error(self, estimator, db):
        created = client.post(
            "/api/estimating/estimates",
            json=_payload(BRANCH_WITHOUT_RATE, None),
        )
        section = client.post(
            f"/api/estimating/estimates/{created.json()['id']}/sections",
            json={"name": "Common Area", "squareFeet": 120_000, "services": []},
        )
        assert section.status_code == 201, section.text
        resp = client.post(
            f"/api/estimating/estimates/{created.json()['id']}/sections/{section.json()['id']}/services",
            json=_derived(),
        )
        _assert_missing(resp, [])
        assert len(db.tables["section_services"]) == 0

    def test_patch_blocks_a_derived_line_and_persists_nothing(self, estimator, db):
        created = client.post(
            "/api/estimating/estimates",
            json=_payload(BRANCH_WITH_RATE, [_derived()]),
        )
        assert created.status_code == 201, created.text
        est = created.json()
        section = est["sections"][0]
        svc = section["services"][0]
        assert svc["unitSellCents"] == DERIVED_AT_LIVE
        del db.tables["branch_settings"][str(BRANCH_WITH_RATE)]
        resp = client.patch(
            f"/api/estimating/estimates/{est['id']}/sections/{section['id']}/services/{svc['id']}",
            json={"unitSellCents": 0, "qty": 21},
        )
        _assert_missing(resp, [{"serviceId": svc["id"], "sectionId": section["id"]}])
        assert db.tables["section_services"][svc["id"]]["qty"] == 42
        assert db.tables["section_services"][svc["id"]]["unit_sell_cents"] == DERIVED_AT_LIVE

    def test_install_estimates_are_not_gated(self, estimator):
        payload = _install_payload()
        payload["aspireBranchId"] = BRANCH_WITHOUT_RATE
        resp = client.post("/api/estimating/estimates", json=payload)
        assert resp.status_code == 201, resp.text


class TestGuardLivesInOneModule:
    def test_estimating_py_calls_one_helper_and_stays_at_its_original_size(self):
        text = (ROOT / "api" / "estimating.py").read_text()
        assert len(text.splitlines()) <= 3520
        assert text.count("_live_branch_crew_rate(") == 4
        assert "_require_crew_rate_for_priced_maintenance_lines" not in text
        assert "CREW_RATE_REQUIRED_DETAIL" not in text
        assert "branch_crew_rate_missing" not in text
        pricing = (ROOT / "api" / "maintenance_pricing.py").read_text()
        assert 'CREW_RATE_REQUIRED = "crew_rate_required"' in pricing
        assert "CREW_RATE_REQUIRED_DETAIL" not in pricing
        assert "branch_crew_rate_missing" not in pricing
        assert "MAINTENANCE_SERVICE_CATALOG" not in pricing


def _put(db: FakeDb, table: str, row: dict) -> None:
    db.tables[table][row["id"]] = row


def _estimate(db: FakeDb, estimate_id: str, branch_id: int, status: str) -> None:
    _put(db, "estimates", {
        "id": estimate_id,
        "status": status,
        "estimate_type": "maintenance",
        "aspire_branch_id": branch_id,
    })


def _line(db: FakeDb, service_id: str, section_id: str, kit_id: str, cents: int) -> None:
    _put(db, "section_services", {
        "id": service_id,
        "section_id": section_id,
        "service_kit_id": kit_id,
        "unit_sell_cents": cents,
    })


class TestRepriceOpenDrafts:
    async def test_open_draft_derived_line_updates(self, db):
        _estimate(db, "est-draft", BRANCH_WITH_RATE, "in_progress")
        _put(db, "estimate_sections", {"id": "sec-draft", "estimate_id": "est-draft"})
        _line(db, "svc-derived", "sec-draft", RATED_KIT["id"], DERIVED_AT_PREVIOUS)
        updated = await reprice_open_drafts(BRANCH_WITH_RATE, PREVIOUS_RATE_CENTS, BRANCH_RATE_CENTS)
        assert updated == 1
        assert db.tables["section_services"]["svc-derived"]["unit_sell_cents"] == DERIVED_AT_LIVE

    async def test_approved_estimate_is_untouched(self, db):
        _estimate(db, "est-approved", BRANCH_WITH_RATE, "approved")
        _put(db, "estimate_sections", {"id": "sec-approved", "estimate_id": "est-approved"})
        _line(db, "svc-approved", "sec-approved", RATED_KIT["id"], DERIVED_AT_PREVIOUS)
        updated = await reprice_open_drafts(BRANCH_WITH_RATE, PREVIOUS_RATE_CENTS, BRANCH_RATE_CENTS)
        assert updated == 0
        assert db.tables["section_services"]["svc-approved"]["unit_sell_cents"] == DERIVED_AT_PREVIOUS

    async def test_manual_and_catalog_lines_are_untouched(self, db):
        _estimate(db, "est-draft", BRANCH_WITH_RATE, "queued")
        _put(db, "estimate_sections", {"id": "sec-draft", "estimate_id": "est-draft"})
        _line(db, "svc-derived", "sec-draft", RATED_KIT["id"], DERIVED_AT_PREVIOUS)
        _line(db, "svc-hand", "sec-draft", RATED_KIT["id"], 999)
        _line(db, "svc-catalog", "sec-draft", COINCIDENCE_KIT["id"], DERIVED_AT_PREVIOUS)
        updated = await reprice_open_drafts(BRANCH_WITH_RATE, PREVIOUS_RATE_CENTS, BRANCH_RATE_CENTS)
        assert updated == 1
        assert db.tables["section_services"]["svc-derived"]["unit_sell_cents"] == DERIVED_AT_LIVE
        assert db.tables["section_services"]["svc-hand"]["unit_sell_cents"] == 999
        assert db.tables["section_services"]["svc-catalog"]["unit_sell_cents"] == DERIVED_AT_PREVIOUS

    async def test_other_branch_is_untouched(self, db):
        _estimate(db, "est-other", OTHER_BRANCH, "new_from_sales")
        _put(db, "estimate_sections", {"id": "sec-other", "estimate_id": "est-other"})
        _line(db, "svc-other", "sec-other", RATED_KIT["id"], DERIVED_AT_PREVIOUS)
        updated = await reprice_open_drafts(BRANCH_WITH_RATE, PREVIOUS_RATE_CENTS, BRANCH_RATE_CENTS)
        assert updated == 0
        assert db.tables["section_services"]["svc-other"]["unit_sell_cents"] == DERIVED_AT_PREVIOUS

    async def test_first_rate_and_unchanged_rate_do_not_rewrite(self, db):
        _estimate(db, "est-draft", BRANCH_WITH_RATE, "in_progress")
        _put(db, "estimate_sections", {"id": "sec-draft", "estimate_id": "est-draft"})
        _line(db, "svc-derived", "sec-draft", RATED_KIT["id"], DERIVED_AT_PREVIOUS)
        assert await reprice_open_drafts(BRANCH_WITH_RATE, None, BRANCH_RATE_CENTS) == 0
        assert await reprice_open_drafts(BRANCH_WITH_RATE, BRANCH_RATE_CENTS, BRANCH_RATE_CENTS) == 0
        assert db.tables["section_services"]["svc-derived"]["unit_sell_cents"] == DERIVED_AT_PREVIOUS
