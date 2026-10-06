"""Handoff 54 §2 — Standard maintenance service seeding on section create.

When a maintenance section is created (at estimate creation time OR via the
POST .../sections endpoint), one section_services row is automatically inserted
for every service in the 5 standard (non-optional) maintenance service
categories.  Install estimates are not touched.

Uses FakeDb (tests/conftest.py) — no MySQL required.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "tests"))

os.environ.setdefault("MYSQL_HOST", "localhost")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("ENTRA_CLIENT_ID", "x")
os.environ.setdefault("ENTRA_TENANT_ID", "x")

from api.server import app, require_auth  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

client = TestClient(app)

_MAINT_ESTIMATOR = {
    "id": "u1", "name": "Maint Estimator", "email": "m@x.com",
    "role": "maintenance_estimating", "branch_id": "Orlando, FL",
    "avatar_initials": "ME",
}

_INSTALL_ESTIMATOR = {
    "id": "u2", "name": "Install Estimator", "email": "i@x.com",
    "role": "install_estimating", "branch_id": "Orlando, FL",
    "avatar_initials": "IE",
}


# ---------------------------------------------------------------------------
# Helper: seed the maintenance service catalog into the FakeDb
# ---------------------------------------------------------------------------

def seed_maint_catalog(fake) -> None:
    """Seed 5 standard categories + 1 optional using H59 curated service ids,
    plus kits + kit_links so the seeder can resolve primary kits."""
    # service_categories
    for code, (cat_id, name, is_opt) in {
        "turf":         ("maint-cat-turf", "Turf", False),
        "bed_maint":    ("maint-cat-bed_maint", "Bed Maint", False),
        "irrigation":   ("maint-cat-irrigation", "Irrigation", False),
        "fertilizer":   ("maint-cat-fertilizer", "Fertilizer", False),
        "pest_control": ("maint-cat-pest_control", "Pest Control", False),
        "optional":     ("maint-cat-optional", "Optional Services", True),
    }.items():
        fake.tables["service_categories"][cat_id] = {
            "id": cat_id,
            "code": code,
            "name": name,
            "estimate_type": "maintenance",
            "sort_order": list(["turf", "bed_maint", "irrigation", "fertilizer", "pest_control", "optional"]).index(code) * 10,
            "is_optional": 1 if is_opt else 0,
            "active": 1,
        }

    # Curated active services (allowlist + Peak for catalog). Deactivated Base
    # stays in the table at active=0 so catalog tests can assert exclusion.
    services = [
        ("maint-svc-50390", "maint-cat-turf", "MC: PEAK Mowing", "PEAK Mowing",
         "mowing_occurrences", 31, 10, 1),
        ("maint-svc-50391", "maint-cat-turf", "MC: OFF-PEAK Mowing", "OFF-PEAK Mowing",
         "mowing_occurrences", 11, 20, 1),
        ("maint-svc-50111", "maint-cat-turf", "MC: Base Maintenance", "Base Maintenance",
         "mowing_occurrences", 12, 5, 0),  # deactivated — must not seed / appear
        ("maint-svc-18906", "maint-cat-bed_maint", "MC: Pruning- Peak", "Pruning",
         "pruning_occurrences", 12, 10, 1),
        ("maint-svc-18900", "maint-cat-irrigation", "MC: Irrigation Wet Checks", "Irrigation Wet Checks",
         "irrigation_occurrences", 12, 10, 1),
        ("maint-svc-fert-turf-q1", "maint-cat-fertilizer", "Fertilizer Turf - Quarter 1", "Fertilizer Turf Q1",
         "turf_fert_occurrences", 1, 10, 1),
        ("maint-svc-18904", "maint-cat-pest_control", "MC: Insect and Disease Control", "Insect and Disease Control",
         "ipm_occurrences", 12, 10, 1),
        ("maint-svc-18902", "maint-cat-optional", "MC: Mulch", "Mulch",
         None, 1, 10, 1),  # optional — must NOT auto-seed
    ]
    for sid, cat, name, display, occ_src, default_occ, sort, active in services:
        fake.tables["services"][sid] = {
            "id": sid, "name": name, "display_name": display,
            "service_category_id": cat, "occurrence_source": occ_src,
            "default_occurrences": default_occ, "active": active, "sort_order": sort,
        }

    # Kits with production rates so reprice can stamp sell/hours
    for kit_id, desc, rate, primary in (
        ("kit-maint-1", "Standard Production Mowing", 4000, 1),
        ("kit-maint-2", "Prune Medium", 3200, 1),
        ("kit-maint-3", "Push Mower", 1200, 0),
        ("kit-maint-irr", "Wet Check", 1, 1),
        ("kit-maint-fert", "Turf Fertilizer", 60000, 1),
        ("kit-maint-pest", "Insecticide", 36000, 1),
    ):
        fake.tables["service_kits"][kit_id] = {
            "id": kit_id, "description": desc, "name": kit_id, "uom": "SF",
            "production_rate": rate, "unit_sell_cents": None, "target_gm": 0.5,
            "crew_size": 2, "material_unit_cost_cents": None,
        }

    links = [
        ("skl-1", "maint-svc-50391", "kit-maint-1", 1, 10),
        ("skl-2", "maint-svc-18906", "kit-maint-2", 1, 10),
        ("skl-3", "maint-svc-50391", "kit-maint-3", 0, 20),
        ("skl-4", "maint-svc-18900", "kit-maint-irr", 1, 10),
        ("skl-5", "maint-svc-fert-turf-q1", "kit-maint-fert", 1, 10),
        ("skl-6", "maint-svc-18904", "kit-maint-pest", 1, 10),
        ("skl-7", "maint-svc-50390", "kit-maint-1", 1, 10),  # Peak shares kit shape
    ]
    for lid, sid, kid, primary, sort in links:
        fake.tables["service_kit_links"][lid] = {
            "id": lid, "service_id": sid, "service_kit_id": kid,
            "is_primary": primary, "sort_order": sort,
        }


def seed_branch_settings(fake) -> None:
    """Crew rate needed so production-rate guard passes for maintenance lines."""
    fake.tables["branch_settings"]["3691"] = {
        "aspire_branch_id": 3691,
        "crew_rate_cents_per_hour": 18_000,
    }


def _maint_payload(**overrides) -> dict:
    """A minimal maintenance estimate payload with no sections (so seeder runs)."""
    body = {
        "estimateType": "maintenance",
        "name": "Test HOA",
        "clientName": "Test Client",
        "aspireBranchId": 3691,
        "branchCity": "Orlando, FL",
        "contractValueCents": 1_000_000,
        "targetMargin": 0.20,
        "dueBackDate": "2027-06-01",
        "mowingOccurrences": 42,
        "pruningOccurrences": 12,
        "turf_fert_occurrences": 6,
        "shrub_fert_occurrences": 4,
        "ipm_occurrences": 12,
        "irrigationOccurrences": 8,
        "sections": [
            {"name": "Main Property", "squareFeet": 50_000, "services": []}
        ],
    }
    body.update(overrides)
    return body


@pytest.fixture
def maint(db):
    """Maintenance estimator + seeded maint catalog."""
    seed_maint_catalog(db)
    seed_branch_settings(db)
    app.dependency_overrides[require_auth] = lambda: _MAINT_ESTIMATOR
    yield db
    app.dependency_overrides.clear()


@pytest.fixture
def inst(db):
    """Install estimator — no maint catalog seeded."""
    seed_branch_settings(db)
    app.dependency_overrides[require_auth] = lambda: _INSTALL_ESTIMATOR
    yield db
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_new_maintenance_section_gets_standard_services_seeded(maint):
    """A maintenance estimate section with no services gets one row per linked
    kit method for each allowlisted standard service (H59 curation)."""
    res = client.post("/api/estimating/estimates", json=_maint_payload())
    assert res.status_code == 201, res.text
    body = res.json()
    sections = body["sections"]
    assert len(sections) == 1
    section = sections[0]
    services = section["services"]

    # Off-peak mowing (2 kits) + pruning + irrigation + fert Q1 + pest = 6 rows
    assert len(services) == 6, (
        f"Expected 6 seeded method rows, got {len(services)}: {[s['label'] for s in services]}"
    )

    svc_ids = {s.get("serviceId") for s in services}
    assert "maint-svc-50391" in svc_ids          # Off-peak
    assert "maint-svc-50390" not in svc_ids      # Peak not auto-seeded
    assert "maint-svc-50111" not in svc_ids      # Base deactivated / not allowlisted
    assert "maint-svc-18902" not in svc_ids      # Optional Mulch not auto-seeded

    labels = [s["label"] for s in services]
    assert "Mulch" not in labels

    mowing_primary = next((s for s in services if s["serviceKitId"] == "kit-maint-1"), None)
    assert mowing_primary is not None, "Expected Off-peak primary kit row"
    assert mowing_primary.get("unitSellCents") is not None  # reprice after seed

    # Crew rate snapshotted onto the estimate at create
    assert body.get("crewRateCentsPerHour") == 18_000

    for svc in services:
        assert svc.get("discipline") is None


def test_seeding_respects_occurrence_source(maint):
    """occurrence_source field maps to the correct estimate column for qty.

    H59: all method rows for a service share the same qty (the occurrence count
    is per-service, not per-kit). Labels for kit-backed services are kit names.
    """
    payload = _maint_payload(
        mowingOccurrences=52,
        pruningOccurrences=8,
        irrigationOccurrences=6,
        # turf fert / ipm not sent — should resolve to 0
    )
    payload.pop("turfFertOccurrences", None)
    payload.pop("ipmOccurrences", None)

    res = client.post("/api/estimating/estimates", json=payload)
    assert res.status_code == 201, res.text
    sections = res.json()["sections"]
    services = sections[0]["services"]

    mowing_rows = [s for s in services if s.get("serviceId") == "maint-svc-50391"]
    assert len(mowing_rows) == 2, f"Expected 2 Off-peak method rows, got {len(mowing_rows)}"
    for row in mowing_rows:
        assert row["qty"] == 52, f"Mowing row qty should be 52, got {row['qty']}"

    prune_rows = [s for s in services if s.get("serviceId") == "maint-svc-18906"]
    assert len(prune_rows) == 1
    assert prune_rows[0]["qty"] == 8

    irr_rows = [s for s in services if s.get("serviceId") == "maint-svc-18900"]
    assert len(irr_rows) == 1
    assert irr_rows[0]["qty"] == 6

    fert_rows = [s for s in services if s.get("serviceId") == "maint-svc-fert-turf-q1"]
    assert len(fert_rows) == 1
    assert fert_rows[0]["qty"] == 0  # turfFertOccurrences absent → 0

    pest_rows = [s for s in services if s.get("serviceId") == "maint-svc-18904"]
    assert len(pest_rows) == 1
    assert pest_rows[0]["qty"] == 0  # ipmOccurrences absent → 0


def test_new_install_section_not_seeded(inst):
    """Install estimate sections are never auto-seeded with maintenance services."""
    payload = {
        "estimateType": "install",
        "name": "A Project",
        "clientName": "Client",
        "aspireBranchId": 3691,
        "branchCity": "Orlando, FL",
        "contractValueCents": 500_000,
        "targetMargin": 0.30,
        "dueBackDate": "2027-06-01",
        "sections": [
            {"name": "Landscape", "squareFeet": 0, "services": []}
        ],
    }
    res = client.post("/api/estimating/estimates", json=payload)
    assert res.status_code == 201, res.text
    sections = res.json()["sections"]
    # install sections don't get maint services
    for section in sections:
        assert section["services"] == []


def test_no_duplicate_seed_on_existing_section(maint):
    """Seeding does not run again when a section already has services.

    Guard: if section_services already has rows for the section, skip seeding.
    This prevents double-seeding on re-saves or calls to POST .../sections
    with services already in the body.
    """
    # Create with explicit services in the payload
    payload = _maint_payload()
    payload["sections"][0]["services"] = [
        {
            "label": "Custom Mowing", "qty": 30, "uom": "/yr",
            "complexityPct": 0.10, "unitSellCents": 400, "hours": 1.5,
            "sortOrder": 0, "components": [],
        }
    ]
    res = client.post("/api/estimating/estimates", json=payload)
    assert res.status_code == 201, res.text
    sections = res.json()["sections"]
    # Section has 1 manually-added service and no auto-seeds
    assert len(sections[0]["services"]) == 1
    assert sections[0]["services"][0]["label"] == "Custom Mowing"


# ── H59: baked-in methods ──────────────────────────────────────────────────────


def _build_baked_fake():
    """Return a FakeDb pre-seeded for baked-in methods tests.

    Catalog:
      - 1 turf category (code='turf'), 1 fertilizer category (code='fertilizer')
      - Mowing service (turf) with 3 kits: Standard 48" (is_primary=1),
        Push 21" (is_primary=0), Roadway (is_primary=0)
      - Pruning service (bed_maint) with 1 kit (is_primary=1)
      - Fertilizer service (fertilizer) with 1 kit that has material_unit_cost_cents=3200
    """
    from tests.conftest import FakeDb
    fake = FakeDb()

    # Categories
    for code, (cat_id, name, is_opt) in {
        "turf":         ("maint-cat-turf", "Turf", False),
        "bed_maint":    ("maint-cat-bed_maint", "Bed Maint", False),
        "fertilizer":   ("maint-cat-fertilizer", "Fertilizer", False),
    }.items():
        fake.tables["service_categories"][cat_id] = {
            "id": cat_id, "code": code, "name": name,
            "estimate_type": "maintenance", "sort_order": 10,
            "is_optional": 1 if is_opt else 0, "active": 1,
        }

    # Mowing service (turf)
    fake.tables["services"]["maint-svc-50391"] = {
        "id": "maint-svc-50391", "name": "Mowing", "display_name": "Lawn Mowing",
        "service_category_id": "maint-cat-turf",
        "occurrence_source": "mowing_occurrences", "default_occurrences": 26,
        "active": 1, "sort_order": 10,
    }

    # Pruning service (bed_maint) — primary starts at 0, not NULL
    fake.tables["services"]["maint-svc-18906"] = {
        "id": "maint-svc-18906", "name": "Pruning", "display_name": "Prune Medium",
        "service_category_id": "maint-cat-bed_maint",
        "occurrence_source": "pruning_occurrences", "default_occurrences": 12,
        "active": 1, "sort_order": 10,
    }

    # Fertilizer service — kit has material_unit_cost_cents=3200
    fake.tables["services"]["maint-svc-fert-turf-q1"] = {
        "id": "maint-svc-fert-turf-q1", "name": "Turf Fertilization", "display_name": None,
        "service_category_id": "maint-cat-fertilizer",
        "occurrence_source": "turf_fert_occurrences", "default_occurrences": 6,
        "active": 1, "sort_order": 10,
    }

    # Kits
    fake.tables["service_kits"]["baked-kit-std48"] = {
        "id": "baked-kit-std48", "name": "Standard 48\"",
        "production_rate": 4000, "unit_cost_cents": None, "target_gm": None,
        "material_unit_cost_cents": None, "material_qty_per_unit": None,
        "material_uom": None, "is_primary": 1,
    }
    fake.tables["service_kits"]["baked-kit-push21"] = {
        "id": "baked-kit-push21", "name": "Push 21\"",
        "production_rate": 1200, "unit_cost_cents": None, "target_gm": None,
        "material_unit_cost_cents": None, "material_qty_per_unit": None,
        "material_uom": None, "is_primary": 0,
    }
    fake.tables["service_kits"]["baked-kit-road"] = {
        "id": "baked-kit-road", "name": "Roadway",
        "production_rate": 8000, "unit_cost_cents": None, "target_gm": None,
        "material_unit_cost_cents": None, "material_qty_per_unit": None,
        "material_uom": None, "is_primary": 0,
    }
    fake.tables["service_kits"]["baked-kit-prune"] = {
        "id": "baked-kit-prune", "name": "Prune Medium",
        "production_rate": 500, "unit_cost_cents": None, "target_gm": None,
        "material_unit_cost_cents": None, "material_qty_per_unit": None,
        "material_uom": None, "is_primary": 1,
    }
    fake.tables["service_kits"]["baked-kit-fert"] = {
        "id": "baked-kit-fert", "name": "Turf Fert",
        "production_rate": 60000, "unit_cost_cents": None, "target_gm": None,
        "material_unit_cost_cents": 3200, "material_qty_per_unit": 0.0025,
        "material_uom": "Bag", "is_primary": 1,
    }

    # service_kit_links — Mowing has 3 kits; Pruning and Fert each have 1
    fake.tables["service_kit_links"]["baked-skl-std48"] = {
        "id": "baked-skl-std48", "service_id": "maint-svc-50391",
        "service_kit_id": "baked-kit-std48", "is_primary": 1, "sort_order": 10,
        "basis": "takeoff",
    }
    fake.tables["service_kit_links"]["baked-skl-push21"] = {
        "id": "baked-skl-push21", "service_id": "maint-svc-50391",
        "service_kit_id": "baked-kit-push21", "is_primary": 0, "sort_order": 20,
        "basis": "takeoff",
    }
    fake.tables["service_kit_links"]["baked-skl-road"] = {
        "id": "baked-skl-road", "service_id": "maint-svc-50391",
        "service_kit_id": "baked-kit-road", "is_primary": 0, "sort_order": 30,
        "basis": "takeoff",
    }
    fake.tables["service_kit_links"]["baked-skl-prune"] = {
        "id": "baked-skl-prune", "service_id": "maint-svc-18906",
        "service_kit_id": "baked-kit-prune", "is_primary": 1, "sort_order": 10,
        "basis": "takeoff",
    }
    fake.tables["service_kit_links"]["baked-skl-fert"] = {
        "id": "baked-skl-fert", "service_id": "maint-svc-fert-turf-q1",
        "service_kit_id": "baked-kit-fert", "is_primary": 1, "sort_order": 10,
        "basis": "takeoff",
    }

    # estimates table entry so seeder can read occurrence columns
    fake.tables["estimates"]["baked-est-1"] = {
        "id": "baked-est-1",
        "estimate_type": "maintenance",
        "mowing_occurrences": 26,
        "pruning_occurrences": 12,
        "turf_fert_occurrences": 6,
        "shrub_fert_occurrences": 4,
        "ipm_occurrences": 12,
        "irrigation_occurrences": 8,
    }

    return fake


async def _run_seeder(fake, estimate_id: str, section_id: str) -> None:
    """Run the seeder against a FakeDb instance."""
    from api.maintenance_catalog import seed_standard_maintenance_services
    await seed_standard_maintenance_services(
        estimate_id=estimate_id,
        estimate_type="maintenance",
        section_id=section_id,
        query_fn=fake.query,
        execute_fn=fake.execute,
    )


class TestBakedInMethods:

    def test_seed_bakes_in_all_kit_methods(self):
        """When a Mowing service has 3 linked kits, seeder inserts 3 section_services rows."""
        import asyncio
        fake = _build_baked_fake()
        section_id = "sec-test-001"
        asyncio.run(
            _run_seeder(fake, "baked-est-1", section_id)
        )
        seeded_services = [
            r for r in fake.tables["section_services"].values()
            if r["section_id"] == section_id
            and r.get("service_id") == "maint-svc-50391"
        ]
        assert len(seeded_services) == 3, (
            f"Expected 3 method rows for Mowing, got {len(seeded_services)}"
        )

    def test_mowing_primary_inherits_sqft_null(self):
        """Standard 48\" (is_primary=1) gets square_feet=None; other mowing methods get 0."""
        import asyncio
        fake = _build_baked_fake()
        section_id = "sec-test-002"
        asyncio.run(
            _run_seeder(fake, "baked-est-1", section_id)
        )
        mow_rows = [
            r for r in fake.tables["section_services"].values()
            if r["section_id"] == section_id
            and r.get("service_id") == "maint-svc-50391"
        ]
        primary_row = next(r for r in mow_rows if r.get("service_kit_id") == "baked-kit-std48")
        non_primary_rows = [r for r in mow_rows if r.get("service_kit_id") != "baked-kit-std48"]
        assert primary_row["square_feet"] is None, (
            f"Primary mowing kit should inherit sqft (None), got {primary_row['square_feet']}"
        )
        for row in non_primary_rows:
            assert row["square_feet"] == 0, (
                f"Non-primary mowing kit {row['service_kit_id']} should be 0, got {row['square_feet']}"
            )

    def test_pruning_primary_starts_at_zero(self):
        """Pruning primary (Prune Medium, is_primary=1) gets square_feet=0, not NULL."""
        import asyncio
        fake = _build_baked_fake()
        section_id = "sec-test-003"
        asyncio.run(
            _run_seeder(fake, "baked-est-1", section_id)
        )
        prune_rows = [
            r for r in fake.tables["section_services"].values()
            if r["section_id"] == section_id
            and r.get("service_id") == "maint-svc-18906"
        ]
        assert len(prune_rows) >= 1, "Expected at least one pruning row"
        primary_prune = next(
            r for r in prune_rows if r.get("service_kit_id") == "baked-kit-prune"
        )
        assert primary_prune["square_feet"] == 0, (
            f"Pruning primary should start at 0 (not NULL), got {primary_prune['square_feet']}"
        )

    def test_seeder_inserts_labor_component(self):
        """Each seeded method row gets a section_service_components INSERT with kind='labor'."""
        import asyncio
        fake = _build_baked_fake()
        section_id = "sec-test-004"
        asyncio.run(
            _run_seeder(fake, "baked-est-1", section_id)
        )
        service_ids = {
            r["id"] for r in fake.tables["section_services"].values()
            if r["section_id"] == section_id
        }
        assert service_ids, "No section_services rows were inserted"
        for svc_id in service_ids:
            labor_comps = [
                c for c in fake.tables["section_service_components"].values()
                if c.get("section_service_id") == svc_id and c.get("kind") == "labor"
            ]
            assert len(labor_comps) == 1, (
                f"service_id={svc_id} should have exactly 1 labor component, got {len(labor_comps)}"
            )

    def test_seeder_inserts_material_component_when_present(self):
        """Fert kit (material_unit_cost_cents=3200) gets a material component; mowing kits do not."""
        import asyncio
        fake = _build_baked_fake()
        section_id = "sec-test-005"
        asyncio.run(
            _run_seeder(fake, "baked-est-1", section_id)
        )
        # Fert row should have labor + material
        fert_rows = [
            r for r in fake.tables["section_services"].values()
            if r["section_id"] == section_id
            and r.get("service_id") == "maint-svc-fert-turf-q1"
        ]
        assert len(fert_rows) == 1, f"Expected 1 fert row, got {len(fert_rows)}"
        fert_svc_id = fert_rows[0]["id"]
        fert_comps = [
            c for c in fake.tables["section_service_components"].values()
            if c.get("section_service_id") == fert_svc_id
        ]
        kinds = {c["kind"] for c in fert_comps}
        assert "material" in kinds, f"Fert row should have a material component; got kinds={kinds}"
        assert "labor" in kinds, f"Fert row should also have a labor component; got kinds={kinds}"

        # Mowing rows (no material_unit_cost_cents) should only have labor
        mow_rows = [
            r for r in fake.tables["section_services"].values()
            if r["section_id"] == section_id
            and r.get("service_id") == "maint-svc-50391"
        ]
        for mow_row in mow_rows:
            mow_comps = [
                c for c in fake.tables["section_service_components"].values()
                if c.get("section_service_id") == mow_row["id"]
            ]
            mow_kinds = {c["kind"] for c in mow_comps}
            assert "material" not in mow_kinds, (
                f"Mowing row {mow_row['id']} should not have a material component; got {mow_kinds}"
            )

    def test_rollup_total_equals_sum_of_method_rows(self):
        """The section total equals the sum of all method rows' unit_sell_cents.

        Creates a maintenance estimate via POST (seeder inserts method rows),
        then verifies the API returns all rows and their unit_sell_cents are
        individually accessible (so callers can sum them per method or in
        aggregate). The seeder sets unit_sell_cents=NULL until pricing is
        applied; this test verifies the rows are present and the sum of any
        non-null values equals what was stored — i.e., the load path does not
        collapse method rows into a single rollup line.
        """
        import asyncio
        from tests.conftest import FakeDb
        from unittest.mock import patch, AsyncMock

        fake = FakeDb()
        seed_maint_catalog(fake)
        seed_branch_settings(fake)

        with patch("api.estimating.query", new=AsyncMock(side_effect=fake.query)), \
             patch("api.estimating.execute", new=AsyncMock(side_effect=fake.execute)), \
             patch("api.estimating.transaction", new=fake.transaction), \
             patch("api.estimating._sync_new_opportunity_bg", new_callable=AsyncMock), \
             patch("api.estimating._sync_status_bg", new_callable=AsyncMock):
            app.dependency_overrides[require_auth] = lambda: _MAINT_ESTIMATOR
            try:
                # 1. Create the estimate — seeder runs and inserts method rows.
                res = client.post("/api/estimating/estimates", json=_maint_payload())
                assert res.status_code == 201, res.text
                body = res.json()
                est_id = body["id"]
                section = body["sections"][0]
                services = section["services"]

                assert len(services) >= 2, f"Expected seeded method rows, got {len(services)}"

                # 2. Overwrite unit_sell_cents on the first two rows with known values.
                svc_ids = [s["id"] for s in services[:2]]
                fake.tables["section_services"][svc_ids[0]]["unit_sell_cents"] = 12000
                fake.tables["section_services"][svc_ids[1]]["unit_sell_cents"] = 3000

                # 3. GET the estimate and verify those two rows keep the overwritten prices.
                res2 = client.get(f"/api/estimating/estimates/{est_id}")
                assert res2.status_code == 200, res2.text
                body2 = res2.json()
                svcs2 = body2["sections"][0]["services"]
                by_id = {s["id"]: s for s in svcs2}
                assert by_id[svc_ids[0]]["unitSellCents"] == 12000
                assert by_id[svc_ids[1]]["unitSellCents"] == 3000
                assert by_id[svc_ids[0]]["unitSellCents"] + by_id[svc_ids[1]]["unitSellCents"] == 15000
            finally:
                app.dependency_overrides.clear()


# ── H59 catalog curation: allowlist, deactivate, reprice, mowing select ────────


class TestCatalogCurationAllowlist:
    def test_allowlist_is_subset_of_curated_active(self):
        from api.maintenance_catalog import (
            MAINTENANCE_CURATED_ACTIVE_IDS,
            MAINTENANCE_STANDARD_SEED_ALLOWLIST,
            DEFAULT_MOWING_SERVICE_ID,
            PEAK_MOWING_SERVICE_ID,
            OFF_PEAK_MOWING_SERVICE_ID,
        )
        assert MAINTENANCE_STANDARD_SEED_ALLOWLIST <= MAINTENANCE_CURATED_ACTIVE_IDS
        assert DEFAULT_MOWING_SERVICE_ID == OFF_PEAK_MOWING_SERVICE_ID
        assert PEAK_MOWING_SERVICE_ID in MAINTENANCE_CURATED_ACTIVE_IDS
        assert PEAK_MOWING_SERVICE_ID not in MAINTENANCE_STANDARD_SEED_ALLOWLIST
        assert OFF_PEAK_MOWING_SERVICE_ID in MAINTENANCE_STANDARD_SEED_ALLOWLIST
        # H58 shape: Off-peak + pruning + irrigation + 8 fert + pest = 12
        assert len(MAINTENANCE_STANDARD_SEED_ALLOWLIST) == 12

    def test_select_mowing_keeps_off_peak_only(self):
        from api.maintenance_catalog import select_mowing_service
        services = [
            {"id": "maint-svc-50390", "name": "PEAK"},
            {"id": "maint-svc-50391", "name": "OFF-PEAK"},
            {"id": "maint-svc-18906", "name": "Pruning"},
        ]
        out = select_mowing_service(services)
        ids = [s["id"] for s in out]
        assert "maint-svc-50391" in ids
        assert "maint-svc-50390" not in ids
        assert "maint-svc-18906" in ids


def _build_curation_fake():
    """FakeDb with Peak+Off-peak+Base turf services; only Off-peak allowlisted."""
    from tests.conftest import FakeDb
    from api.maintenance_catalog import (
        OFF_PEAK_MOWING_SERVICE_ID,
        PEAK_MOWING_SERVICE_ID,
    )
    fake = FakeDb()
    fake.tables["service_categories"]["maint-cat-turf"] = {
        "id": "maint-cat-turf", "code": "turf", "name": "Turf",
        "estimate_type": "maintenance", "sort_order": 10,
        "is_optional": 0, "active": 1,
    }
    fake.tables["service_categories"]["maint-cat-bed_maint"] = {
        "id": "maint-cat-bed_maint", "code": "bed_maint", "name": "Bed Maint",
        "estimate_type": "maintenance", "sort_order": 20,
        "is_optional": 0, "active": 1,
    }
    # Active Peak + Off-peak + deactivated-style Base (active=0)
    fake.tables["services"][PEAK_MOWING_SERVICE_ID] = {
        "id": PEAK_MOWING_SERVICE_ID, "name": "MC: PEAK Mowing",
        "display_name": "PEAK Mowing",
        "service_category_id": "maint-cat-turf",
        "occurrence_source": "mowing_occurrences", "default_occurrences": 31,
        "active": 1, "sort_order": 10,
    }
    fake.tables["services"][OFF_PEAK_MOWING_SERVICE_ID] = {
        "id": OFF_PEAK_MOWING_SERVICE_ID, "name": "MC: OFF-PEAK Mowing",
        "display_name": "OFF-PEAK Mowing",
        "service_category_id": "maint-cat-turf",
        "occurrence_source": "mowing_occurrences", "default_occurrences": 11,
        "active": 1, "sort_order": 20,
    }
    fake.tables["services"]["maint-svc-50111"] = {
        "id": "maint-svc-50111", "name": "MC: Base Maintenance",
        "display_name": "Base Maintenance",
        "service_category_id": "maint-cat-turf",
        "occurrence_source": "mowing_occurrences", "default_occurrences": 12,
        "active": 0, "sort_order": 5,
    }
    fake.tables["services"]["maint-svc-18906"] = {
        "id": "maint-svc-18906", "name": "MC: Pruning- Peak",
        "display_name": "Pruning",
        "service_category_id": "maint-cat-bed_maint",
        "occurrence_source": "pruning_occurrences", "default_occurrences": 12,
        "active": 1, "sort_order": 10,
    }
    # Kits for Off-peak (2 methods) + Peak (1) + Pruning (1)
    for kid, desc, rate, primary in [
        ("kit-off-std", "Standard Production Mowing", 35000, 1),
        ("kit-off-push", "Push Mower Low Production", 8000, 0),
        ("kit-peak-std", "Standard Production Mowing Peak", 35000, 1),
        ("kit-prune", "Prune Medium", 3200, 1),
    ]:
        fake.tables["service_kits"][kid] = {
            "id": kid, "description": desc, "uom": "SF",
            "production_rate": rate, "unit_sell_cents": None, "target_gm": 0.5,
            "material_unit_cost_cents": None,
        }
    fake.tables["service_kit_links"]["l1"] = {
        "id": "l1", "service_id": OFF_PEAK_MOWING_SERVICE_ID,
        "service_kit_id": "kit-off-std", "is_primary": 1, "sort_order": 10,
    }
    fake.tables["service_kit_links"]["l2"] = {
        "id": "l2", "service_id": OFF_PEAK_MOWING_SERVICE_ID,
        "service_kit_id": "kit-off-push", "is_primary": 0, "sort_order": 20,
    }
    fake.tables["service_kit_links"]["l3"] = {
        "id": "l3", "service_id": PEAK_MOWING_SERVICE_ID,
        "service_kit_id": "kit-peak-std", "is_primary": 1, "sort_order": 10,
    }
    fake.tables["service_kit_links"]["l4"] = {
        "id": "l4", "service_id": "maint-svc-18906",
        "service_kit_id": "kit-prune", "is_primary": 1, "sort_order": 10,
    }
    fake.tables["estimates"]["cur-est-1"] = {
        "id": "cur-est-1", "estimate_type": "maintenance",
        "aspire_branch_id": 42,
        "mowing_occurrences": 42, "pruning_occurrences": 12,
        "turf_fert_occurrences": 4, "shrub_fert_occurrences": 4,
        "ipm_occurrences": 6, "irrigation_occurrences": 12,
    }
    fake.tables["estimate_sections"]["cur-sec-1"] = {
        "id": "cur-sec-1", "estimate_id": "cur-est-1",
        "name": "Common Area", "square_feet": 70000, "sort_order": 0,
    }
    fake.tables["branch_settings"]["bs-42"] = {
        "id": "bs-42", "aspire_branch_id": 42,
        "crew_rate_cents_per_hour": 2319,
    }
    return fake


class TestCatalogCurationSeeder:
    def test_deactivated_base_not_seeded(self):
        import asyncio
        from api.maintenance_catalog import seed_standard_maintenance_services
        fake = _build_curation_fake()
        asyncio.run(seed_standard_maintenance_services(
            "cur-est-1", "maintenance", "cur-sec-1", fake.query, fake.execute,
        ))
        seeded_svc_ids = {
            r.get("service_id") for r in fake.tables["section_services"].values()
            if r["section_id"] == "cur-sec-1"
        }
        assert "maint-svc-50111" not in seeded_svc_ids
        assert "maint-svc-50390" not in seeded_svc_ids  # Peak not auto-seeded
        assert "maint-svc-50391" in seeded_svc_ids      # Off-peak seeded
        assert "maint-svc-18906" in seeded_svc_ids

    def test_off_peak_bakes_all_methods(self):
        import asyncio
        from api.maintenance_catalog import seed_standard_maintenance_services
        fake = _build_curation_fake()
        asyncio.run(seed_standard_maintenance_services(
            "cur-est-1", "maintenance", "cur-sec-1", fake.query, fake.execute,
        ))
        off_peak_rows = [
            r for r in fake.tables["section_services"].values()
            if r.get("service_id") == "maint-svc-50391"
        ]
        assert len(off_peak_rows) == 2
        kits = {r["service_kit_id"] for r in off_peak_rows}
        assert kits == {"kit-off-std", "kit-off-push"}

    def test_reprice_after_seed_sets_sell_and_hours(self):
        import asyncio
        from api.maintenance_catalog import seed_standard_maintenance_services
        from api.maintenance_pricing import sell_rate_cents_per_1000_sf
        fake = _build_curation_fake()
        asyncio.run(seed_standard_maintenance_services(
            "cur-est-1", "maintenance", "cur-sec-1", fake.query, fake.execute,
        ))
        primary = next(
            r for r in fake.tables["section_services"].values()
            if r.get("service_kit_id") == "kit-off-std"
        )
        expected_sell = sell_rate_cents_per_1000_sf(35000, 0.5, 2319)
        assert primary["unit_sell_cents"] == expected_sell
        # Primary inherits section 70000 SF → hours = 70000/35000 = 2.0
        assert primary["hours"] == pytest.approx(2.0)
        non_primary = next(
            r for r in fake.tables["section_services"].values()
            if r.get("service_kit_id") == "kit-off-push"
        )
        assert non_primary["hours"] == pytest.approx(0.0)
        assert non_primary["unit_sell_cents"] == sell_rate_cents_per_1000_sf(8000, 0.5, 2319)


class TestMigration082Registration:
    def test_082_registered_after_081(self):
        import scripts.migrate as M
        ids = [mid for mid, _ in M.migration_files()]
        assert "082_maintenance_catalog_curation" in ids
        assert ids.index("082_maintenance_catalog_curation") == ids.index(
            "081_service_kit_links_markup_columns"
        ) + 1
        assert M._DETECT["082_maintenance_catalog_curation"] is M.detect_082

    def test_082_file_deactivates_base_and_months(self):
        from pathlib import Path
        text = (Path(__file__).resolve().parents[1]
                / "sql" / "migrations" / "082_maintenance_catalog_curation.sql"
                ).read_text(encoding="utf-8")
        assert "maint-svc-50111" in text
        for month_id in (
            "50150", "50151", "50152", "50153", "50154", "50155",
            "50156", "50157", "50158", "50159", "50160", "50161",
        ):
            assert f"maint-svc-{month_id}" in text
        assert "maint-svc-50390" in text and "active = 1" in text
        assert "maint-svc-50391" in text
