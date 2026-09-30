"""Service line <-> section category match (Handoff 55 D9), enforced by the API.

A section_services row with a non-null service_id on a section that has a
service_category_id must use a service of that category; a section PATCH may
not move the section to a category its lines are not in. Both are 422s before
any write. A section with a NULL category (legacy) accepts any service.
FakeDb (tests/conftest.py); api/catalog_links.py holds the checks.
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
from api.server import app, require_auth  # noqa: E402
from test_estimating_line_items import _install_payload, client  # noqa: E402

_ESTIMATOR = {"id": "u1", "name": "E", "email": "e@x.com", "role": "install_estimating",
              "branch_id": None, "avatar_initials": "E"}
IRR, LAND = "install-cat-irrigation", "install-cat-landscape"
IRR_SVC, LAND_SVC = "install-svc-18878", "install-svc-18882"
# Optional Services: the only section an estimator can add to an install
# estimate (api/install_sections.py). OPT_SVC is a test-only service in it.
OPT, OPT_SVC = "install-cat-optional_services", "install-svc-opt"
_SEC = "/api/estimating/estimates/est-1/sections"

MISMATCH = (f"serviceId {LAND_SVC} is in serviceCategoryId {LAND}; "
            f"this section is serviceCategoryId {IRR}")


def _line(sid, section_id, service_id):
    return {"id": sid, "section_id": section_id, "service_kit_id": None, "service_id": service_id,
            "label": "line", "qty": 1, "uom": "LS", "complexity_pct": 0, "unit_sell_cents": None,
            "embedded_cost_cents": None, "target_gm": None, "hours": None, "sort_order": 0}


@pytest.fixture
def tree(db):
    app.dependency_overrides[require_auth] = lambda: _ESTIMATOR
    db.tables["estimates"]["est-1"] = {"id": "est-1", "estimate_type": "install", "aspire_branch_id": 1}
    for order, (cid, name) in enumerate(((LAND, "Landscape"), (IRR, "Irrigation")), start=1):
        db.tables["service_categories"][cid] = {"id": cid, "estimate_type": "install", "name": name,
                                                "sort_order": order * 10, "is_optional": 0, "active": 1}
    db.tables["service_categories"][OPT] = {"id": OPT, "estimate_type": "install", "name": "Optional Services",
                                            "sort_order": 90, "is_optional": 1, "active": 1}
    db.tables["services"][OPT_SVC] = {"id": OPT_SVC, "service_category_id": OPT}
    db.tables["services"][IRR_SVC] = {"id": IRR_SVC, "service_category_id": IRR}
    db.tables["services"][LAND_SVC] = {"id": LAND_SVC, "service_category_id": LAND}
    db.tables["estimate_sections"]["sec-irr"] = {"id": "sec-irr", "estimate_id": "est-1", "name": "Irrigation",
                                                 "square_feet": 0, "sort_order": 0, "service_category_id": IRR}
    db.tables["estimate_sections"]["sec-old"] = {"id": "sec-old", "estimate_id": "est-1", "name": "Legacy",
                                                 "square_feet": 0, "sort_order": 1, "service_category_id": None}
    db.tables["section_services"]["svc-1"] = _line("svc-1", "sec-irr", IRR_SVC)
    yield db
    app.dependency_overrides.clear()


def _lines(db):
    return {k: dict(v) for k, v in db.tables["section_services"].items()}


# ── service line writes ───────────────────────────────────────────────────────

def test_matching_service_saves(tree):
    res = client.post(f"{_SEC}/sec-irr/services", json={"label": "Irrigation", "serviceId": IRR_SVC})
    assert res.status_code == 201, res.text
    assert res.json()["serviceId"] == IRR_SVC
    res = client.patch(f"{_SEC}/sec-irr/services/svc-1", json={"serviceId": IRR_SVC, "qty": 2})
    assert res.status_code == 200, res.text


def test_mismatched_service_on_create_is_422_and_writes_nothing(tree):
    before = _lines(tree)
    res = client.post(f"{_SEC}/sec-irr/services", json={"label": "Landscape", "serviceId": LAND_SVC})
    assert res.status_code == 422
    assert res.json()["detail"] == MISMATCH
    assert _lines(tree) == before


def test_mismatched_service_on_patch_is_422_and_writes_nothing(tree):
    before = _lines(tree)
    res = client.patch(f"{_SEC}/sec-irr/services/svc-1", json={"serviceId": LAND_SVC, "qty": 9})
    assert res.status_code == 422
    assert res.json()["detail"] == MISMATCH
    assert _lines(tree) == before
    # Unlinking (null) and edits that do not touch serviceId are not checked.
    assert client.patch(f"{_SEC}/sec-irr/services/svc-1", json={"serviceId": None}).status_code == 200


def test_nested_section_create_checks_match_before_any_write(tree):
    body = {"serviceCategoryId": OPT, "services": [{"label": "Landscape", "serviceId": LAND_SVC}]}
    res = client.post(_SEC, json=body)
    assert res.status_code == 422
    assert res.json()["detail"] == (f"serviceId {LAND_SVC} is in serviceCategoryId {LAND}; "
                                    f"this section is serviceCategoryId {OPT}")
    assert set(tree.tables["estimate_sections"]) == {"sec-irr", "sec-old"}
    body["services"][0]["serviceId"] = OPT_SVC
    assert client.post(_SEC, json=body).status_code == 201


def test_nested_estimate_create_checks_match_before_any_write(tree):
    payload = copy.deepcopy(_install_payload())
    payload["sections"][0]["name"] = "Irrigation"
    payload["sections"][0]["serviceCategoryId"] = IRR
    payload["sections"][0]["services"][0]["serviceId"] = LAND_SVC
    before = len(tree.tables["estimates"])
    res = client.post("/api/estimating/estimates", json=payload)
    assert res.status_code == 422 and res.json()["detail"] == MISMATCH
    assert len(tree.tables["estimates"]) == before
    payload["sections"][0]["services"][0]["serviceId"] = IRR_SVC
    res = client.post("/api/estimating/estimates", json=payload)
    assert res.status_code == 201, res.text
    irr = next(s for s in res.json()["sections"] if s["serviceCategoryId"] == IRR)
    assert irr["services"][0]["serviceId"] == IRR_SVC


# ── section category PATCH ────────────────────────────────────────────────────

def test_category_patch_conflicting_with_lines_is_422(tree):
    tree.tables["section_services"]["svc-old"] = _line("svc-old", "sec-old", IRR_SVC)
    res = client.patch(f"{_SEC}/sec-old", json={"serviceCategoryId": LAND, "name": "Renamed"})
    assert res.status_code == 422
    assert res.json()["detail"] == (
        f"serviceCategoryId {LAND} conflicts with this section's service lines: "
        f"serviceId {IRR_SVC} is in serviceCategoryId {IRR}"
    )
    sec = tree.tables["estimate_sections"]["sec-old"]
    assert sec["service_category_id"] is None and sec["name"] == "Legacy"
    # sec-irr's IRR line conflicts with LAND too.
    res = client.patch(f"{_SEC}/sec-irr", json={"serviceCategoryId": LAND})
    assert res.status_code == 422
    assert tree.tables["estimate_sections"]["sec-irr"]["service_category_id"] == IRR


def test_category_patch_that_fits_or_clears_is_allowed(tree):
    tree.tables["section_services"]["svc-free"] = _line("svc-free", "sec-irr", None)  # free-text line
    assert client.patch(f"{_SEC}/sec-irr", json={"serviceCategoryId": IRR}).status_code == 200
    tree.tables["section_services"]["svc-old"] = _line("svc-old", "sec-old", OPT_SVC)
    assert client.patch(f"{_SEC}/sec-old", json={"serviceCategoryId": OPT}).status_code == 200
    res = client.patch(f"{_SEC}/sec-old", json={"serviceCategoryId": None})
    assert res.status_code == 200 and res.json()["serviceCategoryId"] is None


def test_category_patch_on_section_with_only_free_text_lines_is_allowed(tree):
    tree.tables["section_services"]["svc-free"] = _line("svc-free", "sec-old", None)
    res = client.patch(f"{_SEC}/sec-old", json={"serviceCategoryId": LAND})
    assert res.status_code == 200, res.text
    assert res.json()["serviceCategoryId"] == LAND


# ── legacy: section with no category ──────────────────────────────────────────

def test_null_category_section_accepts_any_service(tree):
    for svc in (IRR_SVC, LAND_SVC):
        res = client.post(f"{_SEC}/sec-old/services", json={"label": "x", "serviceId": svc})
        assert res.status_code == 201, res.text
    # A new uncategorized section accepts any service too.
    res = client.post(_SEC, json={"name": "Loose", "services": [{"label": "y", "serviceId": LAND_SVC}]})
    assert res.status_code == 201, res.text
    # Once it has mixed lines, giving it a category is refused.
    res = client.patch(f"{_SEC}/sec-old", json={"serviceCategoryId": OPT})
    assert res.status_code == 422
    assert res.json()["detail"] == (
        f"serviceCategoryId {OPT} conflicts with this section's service lines: "
        f"serviceId {IRR_SVC} is in serviceCategoryId {IRR}; serviceId {LAND_SVC} is in serviceCategoryId {LAND}"
    )
    # IRR conflicts with the LAND line as well.
    assert client.patch(f"{_SEC}/sec-old", json={"serviceCategoryId": IRR}).status_code == 422
