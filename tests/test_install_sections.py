"""Install estimate sections come from the service catalog (Handoff 55 §3).

api/install_sections.py: an install estimate is created with one section per
active, non-optional install category (sort_order, category name, category
id); afterwards only an optional-category section can be added; a standard
section cannot be renamed or re-categorized; no duplicate categories.
Maintenance estimates are unchanged. FakeDb (tests/conftest.py).
"""
from __future__ import annotations

import copy
import os
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "tests"))

os.environ.setdefault("JWT_SECRET", "test-secret")
import api.install_sections as S  # noqa: E402
from api.server import app, require_auth  # noqa: E402
from test_estimating_line_items import _install_payload, client  # noqa: E402

_ESTIMATOR = {"id": "u1", "name": "E", "email": "e@x.com", "role": "install_estimating",
              "branch_id": None, "avatar_initials": "E"}

# The seeded install catalog (scripts/data/install_service_catalog_config.json order).
CATALOG = [
    ("install-cat-landscape", "Landscape", 10, 0, 1),
    ("install-cat-irrigation", "Irrigation", 20, 0, 1),
    ("install-cat-drainage", "Drainage", 30, 0, 1),
    ("install-cat-lighting", "Lighting", 40, 0, 1),
    ("install-cat-sod", "Sod", 50, 0, 1),
    ("install-cat-hardscape", "Hardscape / Pavers", 60, 0, 1),
    ("install-cat-subcontractor", "Subcontractor", 70, 0, 1),
    ("install-cat-marketing_gratis", "Marketing / Gratis", 80, 0, 1),
    ("install-cat-optional_services", "Optional Services", 90, 1, 1),
    ("install-cat-retired", "Retired", 15, 0, 0),
]
STANDARD = [c for c in CATALOG if not c[3] and c[4]]
OPT = "install-cat-optional_services"


@pytest.fixture
def cat(db):
    app.dependency_overrides[require_auth] = lambda: _ESTIMATOR
    for cid, name, order, optional, active in CATALOG:
        db.tables["service_categories"][cid] = {"id": cid, "name": name, "estimate_type": "install",
                                                "sort_order": order, "is_optional": optional, "active": active}
    db.tables["service_categories"]["maint-cat-irrigation"] = {
        "id": "maint-cat-irrigation", "name": "Irrigation", "estimate_type": "maintenance",
        "sort_order": 10, "is_optional": 0, "active": 1}
    yield db
    app.dependency_overrides.clear()


def _payload(sections):
    p = copy.deepcopy(_install_payload())
    p["sections"] = sections
    return p


def _create(sections):
    return client.post("/api/estimating/estimates", json=_payload(sections))


def _sections(res):
    return [(s["name"], s["serviceCategoryId"]) for s in sorted(res.json()["sections"], key=lambda s: s["sortOrder"])]


# ── create ───────────────────────────────────────────────────────────────────

def test_install_create_auto_creates_one_section_per_standard_category(cat):
    res = _create([])
    assert res.status_code == 201, res.text
    assert _sections(res) == [(name, cid) for cid, name, *_ in STANDARD]
    assert [s["sortOrder"] for s in res.json()["sections"]] == list(range(8))
    names = [s[0] for s in _sections(res)]
    assert "Optional Services" not in names and "Retired" not in names


def test_install_create_without_sections_key_also_auto_creates(cat):
    p = _payload([])
    del p["sections"]
    res = client.post("/api/estimating/estimates", json=p)
    assert res.status_code == 201 and len(res.json()["sections"]) == 8


def test_sent_sections_merge_into_their_category_not_duplicated(cat):
    line = {"label": "Mahogany 30g", "qty": 2, "uom": "EA", "unitSellCents": 100, "components": []}
    res = _create([
        {"name": "Irrigation", "serviceCategoryId": "install-cat-irrigation", "squareFeet": 5, "services": [line]},
        {"name": "  sod  ", "services": [line]},                   # plain name, no id: matched
        {"serviceCategoryId": OPT, "services": [line]},             # optional: added after the standard ones
    ])
    assert res.status_code == 201, res.text
    got = sorted(res.json()["sections"], key=lambda s: s["sortOrder"])
    assert [(s["name"], s["serviceCategoryId"]) for s in got] == \
        [(name, cid) for cid, name, *_ in STANDARD] + [("Optional Services", OPT)]
    by_cat = {s["serviceCategoryId"]: s for s in got}
    assert len(by_cat["install-cat-irrigation"]["services"]) == 1
    assert by_cat["install-cat-irrigation"]["squareFeet"] == 5
    assert len(by_cat["install-cat-sod"]["services"]) == 1 and by_cat["install-cat-sod"]["name"] == "Sod"
    assert len(by_cat[OPT]["services"]) == 1
    assert by_cat["install-cat-landscape"]["services"] == []


def test_non_category_sections_are_kept_after_the_standard_ones(cat):
    """No extra section rules: a sent section that is not a standard category
    (or repeats one) is kept as sent, after the auto-created sections."""
    res = _create([{"name": "Starter Group"}, {"name": "Irrigation"}, {"name": "IRRIGATION"}])
    assert res.status_code == 201, res.text
    assert _sections(res) == [(name, cid) for cid, name, *_ in STANDARD] + \
        [("Starter Group", None), ("IRRIGATION", None)]


def test_maintenance_create_is_unchanged(cat):
    as_maint = {**_ESTIMATOR, "role": "maintenance_estimating"}
    app.dependency_overrides[require_auth] = lambda: as_maint
    p = _payload([{"name": "Main Property", "squareFeet": 0, "services": []}])
    p["estimateType"] = "maintenance"
    res = client.post("/api/estimating/estimates", json=p)
    assert res.status_code == 201, res.text
    assert _sections(res) == [("Main Property", None)]


def test_unloaded_catalog_keeps_sections_as_sent(db):
    db.tables["service_categories"].clear()  # conftest seeds one category; unload it
    app.dependency_overrides[require_auth] = lambda: _ESTIMATOR
    try:
        res = _create([{"name": "Starter Group", "services": []}])
        assert res.status_code == 201, res.text
        assert _sections(res) == [("Starter Group", None)]
        assert db.tx_events == ["begin", "commit"]
    finally:
        app.dependency_overrides.clear()


# ── one transaction ──────────────────────────────────────────────────────────

def test_create_commits_estimate_and_sections_in_one_transaction(cat):
    res = _create([])
    assert res.status_code == 201, res.text
    assert cat.tx_events == ["begin", "commit"]
    assert len(cat.tables["estimates"]) == 1 and len(cat.tables["estimate_sections"]) == len(STANDARD)


@pytest.mark.parametrize("fail_on", ["section:3", "service:1", "component:1"])
def test_failure_partway_leaves_no_estimate_and_no_sections(cat, fail_on):
    """A write failing after the estimate row and some sections are in rolls
    the whole create back: no estimate, no sections, services or components."""
    from unittest.mock import AsyncMock, patch

    from fastapi.testclient import TestClient

    table, nth = {"section": "estimate_sections", "service": "section_services",
                  "component": "section_service_components"}[fail_on.split(":")[0]], int(fail_on.split(":")[1])
    seen = {"n": 0}

    async def failing_execute(sql, params=None):
        if f"INSERT INTO {table}" in " ".join(sql.split()):
            seen["n"] += 1
            if seen["n"] == nth:
                assert cat.tables["estimates"], "estimate row should already be written"
                raise RuntimeError("simulated failure partway through create")
        return await cat.execute(sql, params)

    body = _payload([{"name": "Landscape", "services": [{
        "label": "Mulch", "qty": 1, "uom": "EA", "unitSellCents": 100, "embeddedCostCents": 50,
        "components": [{"kind": "labor", "label": "Crew", "qty": 1, "unitCostCents": 10, "hours": 1}]}]}])
    with patch("api.estimating.execute", new=AsyncMock(side_effect=failing_execute)):
        res = TestClient(app, raise_server_exceptions=False).post("/api/estimating/estimates", json=body)
    assert res.status_code == 500
    assert seen["n"] == nth
    assert cat.tx_events == ["begin", "rollback"]
    for t in ("estimates", "estimate_sections", "section_services", "section_service_components",
              "intake_submissions", "itb_projects"):
        assert not cat.tables[t], t


@pytest.mark.parametrize("raw, norm", [
    ("Irrigation", "irrigation"), ("IRRIGATION", "irrigation"), ("Irrigation ", "irrigation"),
    ("  Hardscape \t/  Pavers\n", "hardscape / pavers"), (None, ""), ("", ""),
])
def test_normalize_section_name(raw, norm):
    assert S.normalize_section_name(raw) == norm
