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
    """A maintenance estimate section with no services gets one row per
    standard maintenance service automatically inserted."""
    res = client.post("/api/estimating/estimates", json=_maint_payload())
    assert res.status_code == 201, res.text
    body = res.json()
    sections = body["sections"]
    assert len(sections) == 1
    section = sections[0]
    services = section["services"]

    # 5 standard categories, services count:
    # turf: 2, bed_maint: 2, irrigation: 1, fertilizer: 1, pest_control: 1 = 7
    assert len(services) == 7, f"Expected 7 seeded services, got {len(services)}: {[s['label'] for s in services]}"

    # Optional service must NOT appear
    labels = [s["label"] for s in services]
    assert "Holiday Lighting" not in labels

    # display_name used when set, else name
    assert "Lawn Mowing" in labels  # maint-svc-1 has display_name
    assert "Edging" in labels        # maint-svc-2 has no display_name, use name
    assert "IPM Applications" in labels  # maint-svc-7 has display_name

    # kit assigned for svc-1 (mowing), None for svc-2 (edging)
    mowing = next(s for s in services if s["label"] == "Lawn Mowing")
    assert mowing["serviceKitId"] == "kit-maint-1"
    edging = next(s for s in services if s["label"] == "Edging")
    assert edging["serviceKitId"] is None

    # discipline is NULL for maintenance lines
    for svc in services:
        assert svc.get("discipline") is None


def test_seeding_respects_occurrence_source(maint):
    """occurrence_source field maps to the correct estimate column for qty."""
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
    by_label = {s["label"]: s for s in services}

    # occurrence_source = "mowing_occurrences" -> payload key "mowingOccurrences" = 52
    assert by_label["Lawn Mowing"]["qty"] == 52

    # occurrence_source = "pruning_occurrences" -> 8
    assert by_label["Bed Weeding & Detail"]["qty"] == 8

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
