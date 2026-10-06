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
    """Seed 5 standard categories + 1 optional, 2 services per standard cat,
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

    # Services: 2 per standard category (10 total), 1 in optional (not seeded)
    # turf services
    fake.tables["services"]["maint-svc-1"] = {
        "id": "maint-svc-1",
        "name": "Mowing",
        "display_name": "Lawn Mowing",
        "service_category_id": "maint-cat-turf",
        "occurrence_source": "mowing_occurrences",
        "default_occurrences": 26,
        "active": 1,
        "sort_order": 10,
    }
    fake.tables["services"]["maint-svc-2"] = {
        "id": "maint-svc-2",
        "name": "Edging",
        "display_name": None,
        "service_category_id": "maint-cat-turf",
        "occurrence_source": None,
        "default_occurrences": 26,
        "active": 1,
        "sort_order": 20,
    }
    # bed_maint services
    fake.tables["services"]["maint-svc-3"] = {
        "id": "maint-svc-3",
        "name": "Bed Weeding",
        "display_name": "Bed Weeding & Detail",
        "service_category_id": "maint-cat-bed_maint",
        "occurrence_source": "pruning_occurrences",
        "default_occurrences": 12,
        "active": 1,
        "sort_order": 10,
    }
    fake.tables["services"]["maint-svc-4"] = {
        "id": "maint-svc-4",
        "name": "Mulching",
        "display_name": None,
        "service_category_id": "maint-cat-bed_maint",
        "occurrence_source": None,
        "default_occurrences": 2,
        "active": 1,
        "sort_order": 20,
    }
    # irrigation
    fake.tables["services"]["maint-svc-5"] = {
        "id": "maint-svc-5",
        "name": "Irrigation Check",
        "display_name": None,
        "service_category_id": "maint-cat-irrigation",
        "occurrence_source": "irrigation_occurrences",
        "default_occurrences": 4,
        "active": 1,
        "sort_order": 10,
    }
    # fertilizer
    fake.tables["services"]["maint-svc-6"] = {
        "id": "maint-svc-6",
        "name": "Turf Fertilization",
        "display_name": None,
        "service_category_id": "maint-cat-fertilizer",
        "occurrence_source": "turf_fert_occurrences",
        "default_occurrences": 6,
        "active": 1,
        "sort_order": 10,
    }
    # pest_control
    fake.tables["services"]["maint-svc-7"] = {
        "id": "maint-svc-7",
        "name": "IPM",
        "display_name": "IPM Applications",
        "service_category_id": "maint-cat-pest_control",
        "occurrence_source": "ipm_occurrences",
        "default_occurrences": 12,
        "active": 1,
        "sort_order": 10,
    }
    # optional service — must NOT be seeded
    fake.tables["services"]["maint-svc-opt"] = {
        "id": "maint-svc-opt",
        "name": "Holiday Lighting",
        "display_name": None,
        "service_category_id": "maint-cat-optional",
        "occurrence_source": None,
        "default_occurrences": 1,
        "active": 1,
        "sort_order": 10,
    }

    # service_kits (referenced by kit links)
    for kit_id in ("kit-maint-1", "kit-maint-2", "kit-maint-3"):
        fake.tables["service_kits"][kit_id] = {
            "id": kit_id, "name": kit_id,
            "production_rate": 4000, "crew_size": 2,
        }

    # service_kit_links: maint-svc-1 and maint-svc-3 have kits; rest have none
    fake.tables["service_kit_links"]["skl-1"] = {
        "id": "skl-1",
        "service_id": "maint-svc-1",
        "service_kit_id": "kit-maint-1",
        "is_primary": 1,
        "sort_order": 10,
    }
    fake.tables["service_kit_links"]["skl-2"] = {
        "id": "skl-2",
        "service_id": "maint-svc-3",
        "service_kit_id": "kit-maint-2",
        "is_primary": 1,
        "sort_order": 10,
    }
    fake.tables["service_kit_links"]["skl-3"] = {
        "id": "skl-3",
        "service_id": "maint-svc-1",
        "service_kit_id": "kit-maint-3",
        "is_primary": 0,  # non-primary — must not be used
        "sort_order": 20,
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
    kit method for each standard maintenance service (H59: baked-in methods)."""
    res = client.post("/api/estimating/estimates", json=_maint_payload())
    assert res.status_code == 201, res.text
    body = res.json()
    sections = body["sections"]
    assert len(sections) == 1
    section = sections[0]
    services = section["services"]

    # H59: one row per kit method.
    # maint-svc-1 (Mowing) has 2 kits → 2 rows
    # maint-svc-3 (Bed Weeding) has 1 kit → 1 row
    # maint-svc-2 (Edging), maint-svc-4 (Mulching), maint-svc-5, maint-svc-6, maint-svc-7 have no kits → 1 row each
    # Total: 2 + 1 + 5 = 8 rows
    assert len(services) == 8, f"Expected 8 seeded method rows, got {len(services)}: {[s['label'] for s in services]}"

    # Optional service must NOT appear
    labels = [s["label"] for s in services]
    assert "Holiday Lighting" not in labels

    # Services without kits use display_name or name as label
    assert "Edging" in labels        # maint-svc-2 has no display_name, use name
    assert "IPM Applications" in labels  # maint-svc-7 has display_name

    # Mowing primary kit row (kit-maint-1)
    mowing_primary = next((s for s in services if s["serviceKitId"] == "kit-maint-1"), None)
    assert mowing_primary is not None, "Expected a row with serviceKitId=kit-maint-1"

    # Edging has no kit
    edging = next(s for s in services if s["label"] == "Edging")
    assert edging["serviceKitId"] is None

    # discipline is NULL for maintenance lines
    for svc in services:
        assert svc.get("discipline") is None


def test_seeding_respects_occurrence_source(maint):
    """occurrence_source field maps to the correct estimate column for qty.

    H59: all method rows for a service share the same qty (the occurrence count
    is per-service, not per-kit). Labels for kit-backed services are kit names;
    labels for kit-free services are display_name or name.
    """
    payload = _maint_payload(
        mowingOccurrences=52,
        pruningOccurrences=8,
        irrigationOccurrences=6,
        # turf_fert/shrub_fert/ipm not sent — should resolve to 0
    )
    # Drop occurrence fields that are not set to simulate them being absent
    payload.pop("turf_fert_occurrences", None)
    payload.pop("shrub_fert_occurrences", None)
    payload.pop("ipm_occurrences", None)

    res = client.post("/api/estimating/estimates", json=payload)
    assert res.status_code == 201, res.text
    sections = res.json()["sections"]
    services = sections[0]["services"]

    # Mowing rows are keyed by serviceKitId (labels are kit names in H59).
    # Both mowing method rows carry the same qty from mowing_occurrences.
    mowing_rows = [s for s in services if s.get("serviceId") == "maint-svc-1"]
    assert len(mowing_rows) == 2, f"Expected 2 mowing method rows, got {len(mowing_rows)}"
    for row in mowing_rows:
        assert row["qty"] == 52, f"Mowing row qty should be 52, got {row['qty']}"

    # Bed weeding has 1 kit row (kit-maint-2) → occurrence from pruning_occurrences = 8
    bw_rows = [s for s in services if s.get("serviceId") == "maint-svc-3"]
    assert len(bw_rows) == 1
    assert bw_rows[0]["qty"] == 8

    # Services with no kits use their display_name / name as label.
    by_label = {s["label"]: s for s in services}

    # occurrence_source = None -> default_occurrences = 26
    assert by_label["Edging"]["qty"] == 26

    # occurrence_source = "turf_fert_occurrences" -> not in payload -> 0
    assert by_label["Turf Fertilization"]["qty"] == 0

    # occurrence_source = "irrigation_occurrences" -> 6
    assert by_label["Irrigation Check"]["qty"] == 6


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
        "turf":         ("baked-cat-turf", "Turf", False),
        "bed_maint":    ("baked-cat-bed_maint", "Bed Maint", False),
        "fertilizer":   ("baked-cat-fertilizer", "Fertilizer", False),
    }.items():
        fake.tables["service_categories"][cat_id] = {
            "id": cat_id, "code": code, "name": name,
            "estimate_type": "maintenance", "sort_order": 10,
            "is_optional": 1 if is_opt else 0, "active": 1,
        }

    # Mowing service (turf)
    fake.tables["services"]["baked-svc-mow"] = {
        "id": "baked-svc-mow", "name": "Mowing", "display_name": "Lawn Mowing",
        "service_category_id": "baked-cat-turf",
        "occurrence_source": "mowing_occurrences", "default_occurrences": 26,
        "active": 1, "sort_order": 10,
    }

    # Pruning service (bed_maint) — primary starts at 0, not NULL
    fake.tables["services"]["baked-svc-prune"] = {
        "id": "baked-svc-prune", "name": "Pruning", "display_name": "Prune Medium",
        "service_category_id": "baked-cat-bed_maint",
        "occurrence_source": "pruning_occurrences", "default_occurrences": 12,
        "active": 1, "sort_order": 10,
    }

    # Fertilizer service — kit has material_unit_cost_cents=3200
    fake.tables["services"]["baked-svc-fert"] = {
        "id": "baked-svc-fert", "name": "Turf Fertilization", "display_name": None,
        "service_category_id": "baked-cat-fertilizer",
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
        "id": "baked-skl-std48", "service_id": "baked-svc-mow",
        "service_kit_id": "baked-kit-std48", "is_primary": 1, "sort_order": 10,
        "basis": "takeoff",
    }
    fake.tables["service_kit_links"]["baked-skl-push21"] = {
        "id": "baked-skl-push21", "service_id": "baked-svc-mow",
        "service_kit_id": "baked-kit-push21", "is_primary": 0, "sort_order": 20,
        "basis": "takeoff",
    }
    fake.tables["service_kit_links"]["baked-skl-road"] = {
        "id": "baked-skl-road", "service_id": "baked-svc-mow",
        "service_kit_id": "baked-kit-road", "is_primary": 0, "sort_order": 30,
        "basis": "takeoff",
    }
    fake.tables["service_kit_links"]["baked-skl-prune"] = {
        "id": "baked-skl-prune", "service_id": "baked-svc-prune",
        "service_kit_id": "baked-kit-prune", "is_primary": 1, "sort_order": 10,
        "basis": "takeoff",
    }
    fake.tables["service_kit_links"]["baked-skl-fert"] = {
        "id": "baked-skl-fert", "service_id": "baked-svc-fert",
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
            and r.get("service_id") == "baked-svc-mow"
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
            and r.get("service_id") == "baked-svc-mow"
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
            and r.get("service_id") == "baked-svc-prune"
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
            and r.get("service_id") == "baked-svc-fert"
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
            and r.get("service_id") == "baked-svc-mow"
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

                # 2. Manually set unit_sell_cents on the first two rows so we
                #    have known values to assert the sum against.
                svc_ids = [s["id"] for s in services[:2]]
                fake.tables["section_services"][svc_ids[0]]["unit_sell_cents"] = 12000
                fake.tables["section_services"][svc_ids[1]]["unit_sell_cents"] = 3000

                # 3. GET the estimate and verify both rows come back with their prices.
                res2 = client.get(f"/api/estimating/estimates/{est_id}")
                assert res2.status_code == 200, res2.text
                body2 = res2.json()
                svcs2 = body2["sections"][0]["services"]
                priced = [s for s in svcs2 if s.get("unitSellCents") is not None]
                assert len(priced) == 2, f"Expected 2 priced rows, got {len(priced)}"
                total = sum(s["unitSellCents"] for s in priced)
                assert total == 15000, f"Expected 12000+3000=15000, got {total}"
            finally:
                app.dependency_overrides.clear()
