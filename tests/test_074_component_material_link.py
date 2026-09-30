"""Migration 074 + component material links + service links (Handoff 55 §4/§5).

Unit checks lock the file, detector, guards and rollback. API checks run the
estimate routes against the FakeDb (tests/conftest.py): five kinds, the
inventoryId link, the price snapshot (never re-priced), serviceId on lines,
and 4xx before any write. The DB checks (opt-in, like tests/test_migrate.py)
apply 070-074 over existing components, re-apply, detect a partial apply and
roll back without rewriting rows.
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
import scripts.migrate as M  # noqa: E402
from api.server import app, require_auth  # noqa: E402
from test_estimating_line_items import _install_payload, client  # noqa: E402

MIGRATION = REPO / "sql" / "migrations" / "074_component_material_link.sql"
ROLLBACK = REPO / "sql" / "rollbacks" / "074_component_material_link_down.sql"
KINDS = ["labor", "material", "equipment", "subcontractor", "other"]


# ── migration file ────────────────────────────────────────────────────────────

def test_file_is_074_and_registered():
    ids = [mid for mid, _ in M.migration_files()]
    assert "074_component_material_link" in ids and ids == sorted(ids)
    assert M._DETECT["074_component_material_link"] is M.detect_074


def test_guarded_no_super_no_generated_and_fk_last():
    stmts = M.split_statements(MIGRATION.read_text(encoding="utf-8"))
    upper = "\n".join(stmts).upper()
    for word in ("CREATE TRIGGER", "CREATE FUNCTION", "CREATE PROCEDURE", "GENERATED", "DELIMITER"):
        assert word not in upper
    for stmt in stmts:
        assert stmt.split()[0].upper() in {"SET", "PREPARE", "EXECUTE", "DEALLOCATE"}, stmt[:80]
    assert "fk_components_material" in stmts[-4]
    assert "ON UPDATE RESTRICT" in stmts[-4]
    # kind widens before anything else, keeping both old values first.
    assert "ENUM(''labor'',''material'',''equipment'',''subcontractor'',''other'')" in stmts[0]


def test_rollback_never_rewrites_rows():
    text = ROLLBACK.read_text(encoding="utf-8").upper()
    assert "UPDATE SECTION_SERVICE_COMPONENTS" not in text
    assert "074_COMPONENT_MATERIAL_LINK" in text


# ── API (FakeDb) ──────────────────────────────────────────────────────────────

_ESTIMATOR = {"id": "u1", "name": "E", "email": "e@x.com", "role": "install_estimating",
              "branch_id": None, "avatar_initials": "E"}


@pytest.fixture
def tree(db):
    app.dependency_overrides[require_auth] = lambda: _ESTIMATOR
    db.tables["estimates"]["est-1"] = {"id": "est-1", "estimate_type": "install", "aspire_branch_id": 1}
    db.tables["estimate_sections"]["sec-1"] = {"id": "sec-1", "estimate_id": "est-1", "name": "Irrigation",
                                              "square_feet": 0, "sort_order": 0}
    db.tables["section_services"]["svc-1"] = {
        "id": "svc-1", "section_id": "sec-1", "service_kit_id": None, "label": "IN: Irrigation Install",
        "qty": 1, "uom": "LS", "complexity_pct": 0, "unit_sell_cents": None, "embedded_cost_cents": None,
        "target_gm": None, "hours": None, "sort_order": 0}
    ft = {"base_uom": "FT", "sales_uom": "FT", "purchase_uom": "FT", "purchase_to_base_factor": "1.000000"}
    db.tables["materials"]["6060000001"] = {"inventory_id": "6060000001", "description": "PVC Pipe 1in Sch40", **ft}
    db.tables["materials"]["6060000002"] = {"inventory_id": "6060000002", "description": "PVC Pipe 2in Sch40", **ft}
    db.tables["material_prices"]["mp-1"] = {"id": "mp-1", "inventory_id": "6060000001",
                                            "unit_cost_cents": 345, "uom": "FT", "is_current": 1}
    db.tables["services"]["install-svc-18878"] = {"id": "install-svc-18878",  # Landscape: the auto-created install section
                                                  "service_category_id": "install-cat-landscape"}
    yield db
    app.dependency_overrides.clear()


_BASE = "/api/estimating/estimates/est-1/sections/sec-1/services"
_COMP = f"{_BASE}/svc-1/components"


def _add(body):
    return client.post(_COMP, json=body)


@pytest.mark.parametrize("kind", KINDS)
def test_all_five_kinds_save(tree, kind):
    res = _add({"kind": kind, "label": "x", "qty": 1, "unitCostCents": 10})
    assert res.status_code == 201, res.text
    assert res.json()["kind"] == kind and res.json()["inventoryId"] is None


def test_unknown_kind_is_400_and_writes_nothing(tree):
    assert _add({"kind": "fuel", "label": "x"}).status_code == 400
    assert not tree.tables["section_service_components"]


def test_material_pick_snapshots_current_price_and_fills_label(tree):
    res = _add({"kind": "material", "inventoryId": "6060000001", "qty": 10})
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["inventoryId"] == "6060000001"
    assert body["unitCostCents"] == 345
    assert body["label"] == "PVC Pipe 1in Sch40"
    # A later price change never re-prices the saved component.
    tree.tables["material_prices"]["mp-1"]["unit_cost_cents"] = 999
    comp = next(iter(tree.tables["section_service_components"].values()))
    assert comp["unit_cost_cents"] == 345
    res = client.patch(f"{_COMP}/{body['id']}", json={"qty": 12})
    assert res.json()["unitCostCents"] == 345


def test_explicit_cost_wins_and_no_price_row_is_422_not_zero(tree):
    assert _add({"kind": "material", "inventoryId": "6060000001", "label": "a",
                 "unitCostCents": 300}).json()["unitCostCents"] == 300
    # No material_prices row and no unitCostCents: 422, never a $0 snapshot
    # (unit_cost_cents is NOT NULL, so "unknown" cannot be stored).
    res = _add({"kind": "material", "inventoryId": "6060000002", "label": "b"})
    assert res.status_code == 422
    assert "no current price" in res.json()["detail"] and "unitCostCents" in res.json()["detail"]
    assert len(tree.tables["section_service_components"]) == 1
    # With an explicit cost the unpriced item saves; uom comes from the item.
    res = _add({"kind": "material", "inventoryId": "6060000002", "label": "b", "unitCostCents": 0})
    assert res.status_code == 201 and res.json()["unitCostCents"] == 0 and res.json()["uom"] == "FT"


# ── uom + cost normalization ──────────────────────────────────────────────────

@pytest.fixture
def units(tree):
    m, p = tree.tables["materials"], tree.tables["material_prices"]
    # Garlon 4 Ultra (2.5G): counted in OZ, bought and priced per EA; 1 EA = 320 OZ.
    m["1010000073"] = {"inventory_id": "1010000073", "description": "Garlon 4 Ultra (2.5G)",
                       "base_uom": "OZ", "sales_uom": "OZ", "purchase_uom": "EA",
                       "purchase_to_base_factor": "320.000000"}
    p["mp-g"] = {"id": "mp-g", "inventory_id": "1010000073", "unit_cost_cents": 40263, "uom": "EA",
                 "is_current": 1}
    # Lesco Liquid Lime: $1.00 per 320 OZ -> 0.3125 cents/OZ; cents cannot carry it.
    m["1050000081"] = {"inventory_id": "1050000081", "description": "Lesco Liquid Lime (2.5GAL)",
                       "base_uom": "OZ", "sales_uom": "OZ", "purchase_uom": "EA",
                       "purchase_to_base_factor": "320.000000"}
    p["mp-l"] = {"id": "mp-l", "inventory_id": "1050000081", "unit_cost_cents": 100, "uom": "EA",
                 "is_current": 1}
    # Pillar G: sales LB is neither base (OZ) nor purchase (EA): no factor for it.
    m["1030000098"] = {"inventory_id": "1030000098", "description": "Pillar G (30LB)",
                       "base_uom": "OZ", "sales_uom": "LB", "purchase_uom": "EA",
                       "purchase_to_base_factor": "30.000000"}
    p["mp-p"] = {"id": "mp-p", "inventory_id": "1030000098", "unit_cost_cents": 14949, "uom": "EA",
                 "is_current": 1}
    return tree


def test_pick_fills_uom_and_prices_per_that_unit(units):
    res = _add({"kind": "material", "inventoryId": "1010000073", "qty": 64})
    assert res.status_code == 201, res.text
    # 40263 cents per EA / 320 OZ per EA = 125.82 -> 126 cents per OZ (not $402.63/OZ).
    assert res.json()["uom"] == "OZ" and res.json()["unitCostCents"] == 126
    stored = next(iter(units.tables["section_service_components"].values()))
    assert stored["uom"] == "OZ" and stored["unit_cost_cents"] == 126


def test_same_unit_price_is_unchanged(units):
    res = _add({"kind": "material", "inventoryId": "6060000001", "qty": 1})
    assert res.json()["uom"] == "FT" and res.json()["unitCostCents"] == 345


def test_caller_uom_in_purchase_unit_keeps_purchase_cost(units):
    res = _add({"kind": "material", "inventoryId": "1010000073", "uom": "ea", "qty": 2})
    assert res.status_code == 201 and res.json()["uom"] == "ea" and res.json()["unitCostCents"] == 40263


def test_unreliable_conversion_falls_back_to_price_unit(units):
    lime = _add({"kind": "material", "inventoryId": "1050000081"}).json()
    assert (lime["uom"], lime["unitCostCents"]) == ("EA", 100)
    pillar = _add({"kind": "material", "inventoryId": "1030000098"}).json()
    assert (pillar["uom"], pillar["unitCostCents"]) == ("EA", 14949)


def test_caller_uom_that_cannot_be_converted_is_422(units):
    res = _add({"kind": "material", "inventoryId": "1030000098", "uom": "LB"})
    assert res.status_code == 422 and "Cannot convert" in res.json()["detail"]
    # ...but saves when the caller prices it.
    res = _add({"kind": "material", "inventoryId": "1030000098", "uom": "LB", "unitCostCents": 498})
    assert res.status_code == 201 and (res.json()["uom"], res.json()["unitCostCents"]) == ("LB", 498)


def test_explicit_cost_without_uom_fills_material_unit(units):
    res = _add({"kind": "material", "inventoryId": "1010000073", "unitCostCents": 130})
    assert (res.json()["uom"], res.json()["unitCostCents"]) == ("OZ", 130)


@pytest.mark.parametrize("uom", ["", "   ", 5, "X" * 21])
def test_bad_uom_is_422(units, uom):
    assert _add({"kind": "labor", "label": "Crew", "uom": uom, "unitCostCents": 1}).status_code == 422
    assert not units.tables["section_service_components"]


def test_free_text_uom_round_trips_and_patches(units):
    comp = _add({"kind": "labor", "label": "Crew", "uom": " HR ", "qty": 8, "unitCostCents": 3500}).json()
    assert comp["uom"] == "HR"
    assert client.patch(f"{_COMP}/{comp['id']}", json={"uom": "DAY"}).json()["uom"] == "DAY"
    assert client.patch(f"{_COMP}/{comp['id']}", json={"uom": None}).json()["uom"] is None


def test_patch_relink_reprices_in_new_unit_unlink_keeps_uom(units):
    comp = _add({"kind": "material", "inventoryId": "6060000001"}).json()
    res = client.patch(f"{_COMP}/{comp['id']}", json={"inventoryId": "1010000073"}).json()
    assert (res["uom"], res["unitCostCents"]) == ("OZ", 126)
    res = client.patch(f"{_COMP}/{comp['id']}", json={"qty": 3}).json()
    assert (res["uom"], res["unitCostCents"]) == ("OZ", 126)
    res = client.patch(f"{_COMP}/{comp['id']}", json={"inventoryId": None}).json()
    assert (res["inventoryId"], res["uom"], res["unitCostCents"]) == (None, "OZ", 126)


def test_convert_unit_cost_rules():
    from api.catalog_links import convert_unit_cost
    g = {"base_uom": "OZ", "sales_uom": "OZ", "purchase_uom": "EA", "purchase_to_base_factor": "320"}
    assert convert_unit_cost(g, 40263, "EA", "OZ") == 126
    assert convert_unit_cost(g, 126, "OZ", "EA") == 40320
    assert convert_unit_cost(g, 40263, "EA", "ea") == 40263
    assert convert_unit_cost(g, 40263, None, "OZ") == 40263
    assert convert_unit_cost(g, 40263, "EA", None) == 40263
    assert convert_unit_cost(g, 40263, "EA", "LB") is None
    assert convert_unit_cost(g, 100, "EA", "OZ") is None
    assert convert_unit_cost(g, 0, "EA", "OZ") == 0
    assert convert_unit_cost({**g, "purchase_to_base_factor": None}, 40263, "EA", "OZ") is None
    assert convert_unit_cost({**g, "purchase_to_base_factor": "0"}, 40263, "EA", "OZ") is None


@pytest.mark.parametrize("inv", ["NOPE", 12, ""])
def test_unknown_inventory_id_is_422(tree, inv):
    assert _add({"kind": "material", "label": "x", "inventoryId": inv}).status_code == 422
    assert not tree.tables["section_service_components"]


def test_labor_and_sub_rows_save_with_null_inventory_id(tree):
    for kind in ("labor", "subcontractor"):
        res = _add({"kind": kind, "label": "Crew", "qty": 8, "unitCostCents": 3500, "hours": 8})
        assert res.status_code == 201 and res.json()["inventoryId"] is None


def test_patch_relink_resnapshots_unlink_keeps_cost(tree):
    comp = _add({"kind": "material", "inventoryId": "6060000002", "label": "b", "unitCostCents": 0}).json()
    res = client.patch(f"{_COMP}/{comp['id']}", json={"inventoryId": "6060000001"})
    assert res.json()["inventoryId"] == "6060000001" and res.json()["unitCostCents"] == 345
    res = client.patch(f"{_COMP}/{comp['id']}", json={"inventoryId": None})
    assert res.json()["inventoryId"] is None and res.json()["unitCostCents"] == 345
    assert client.patch(f"{_COMP}/{comp['id']}", json={"kind": "fuel"}).status_code == 400
    assert client.patch(f"{_COMP}/{comp['id']}", json={"inventoryId": "NOPE"}).status_code == 422


def test_free_text_component_unchanged(tree):
    res = _add({"kind": "material", "label": "Misc fittings", "qty": 1, "unitCostCents": 1200})
    assert res.status_code == 201
    assert res.json()["unitCostCents"] == 1200 and res.json()["inventoryId"] is None


def test_service_line_round_trips_service_id(tree):
    res = client.post(_BASE, json={"label": "IN: Irrigation Install", "serviceId": "install-svc-18878"})
    assert res.status_code == 201, res.text
    assert res.json()["serviceId"] == "install-svc-18878"
    sid = res.json()["id"]
    assert client.patch(f"{_BASE}/{sid}", json={"serviceId": None}).json()["serviceId"] is None
    assert client.patch(f"{_BASE}/{sid}", json={"serviceId": "nope"}).status_code == 422
    assert client.post(_BASE, json={"label": "x", "serviceId": "nope"}).status_code == 422


def test_nested_create_estimate_links_and_validates_first(tree):
    payload = copy.deepcopy(_install_payload())
    svc = payload["sections"][0]["services"][0]
    svc["serviceId"] = "install-svc-18878"
    svc["components"] = [{"kind": "material", "inventoryId": "6060000001", "qty": 3},
                         {"kind": "equipment", "label": "Trencher", "qty": 1, "unitCostCents": 15000}]
    before = len(tree.tables["estimates"])
    res = client.post("/api/estimating/estimates", json=payload)
    assert res.status_code == 201, res.text
    got = res.json()["sections"][0]["services"][0]
    assert got["serviceId"] == "install-svc-18878"
    by_kind = {c["kind"]: c for c in got["components"]}
    assert by_kind["material"]["inventoryId"] == "6060000001"
    assert by_kind["material"]["unitCostCents"] == 345
    assert by_kind["equipment"]["unitCostCents"] == 15000
    # A bad nested id is rejected before the estimate row is written.
    bad = copy.deepcopy(payload)
    bad["sections"][0]["services"][0]["components"][0]["inventoryId"] = "NOPE"
    assert client.post("/api/estimating/estimates", json=bad).status_code == 422
    assert len(tree.tables["estimates"]) == before + 1


# ── MySQL ─────────────────────────────────────────────────────────────────────

_TEST_DB = os.environ.get("MYSQL_TEST_DB", "crm_migrate_test")


def _db():
    import pymysql
    return pymysql.connect(
        host=os.environ.get("MYSQL_HOST", "127.0.0.1"),
        port=int(os.environ.get("MYSQL_PORT", "3306")),
        user=os.environ.get("MYSQL_USER", "crmadmin"),
        password=os.environ.get("MYSQL_PASSWORD", ""),
        database=_TEST_DB, autocommit=True, connect_timeout=2,
        cursorclass=pymysql.cursors.DictCursor,
    )


def _reachable() -> bool:
    try:
        _db().close()
        return True
    except Exception:
        return False


requires_mysql = pytest.mark.skipif(not _reachable(), reason=f"MySQL test DB '{_TEST_DB}' not reachable")

_T = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
_BASE_SQL = f"""
CREATE TABLE estimates (id VARCHAR(36) NOT NULL PRIMARY KEY) {_T};
CREATE TABLE service_kits (id VARCHAR(36) NOT NULL PRIMARY KEY) {_T};
CREATE TABLE estimate_sections (id VARCHAR(36) NOT NULL PRIMARY KEY, estimate_id VARCHAR(36) NOT NULL,
    name VARCHAR(255) NOT NULL) {_T};
CREATE TABLE section_services (id VARCHAR(36) NOT NULL PRIMARY KEY, section_id VARCHAR(36) NOT NULL,
    service_kit_id VARCHAR(36) DEFAULT NULL, label VARCHAR(255) NOT NULL) {_T};
CREATE TABLE section_service_components (
    id VARCHAR(36) NOT NULL, section_service_id VARCHAR(36) NOT NULL,
    kind ENUM('labor','material') NOT NULL, label VARCHAR(255) NOT NULL,
    qty DECIMAL(12,4) NOT NULL DEFAULT 0, unit_cost_cents BIGINT NOT NULL DEFAULT 0,
    hours DECIMAL(10,4) DEFAULT NULL, sort_order INT NOT NULL DEFAULT 0,
    PRIMARY KEY (id), KEY idx_components_service (section_service_id),
    CONSTRAINT fk_components_service FOREIGN KEY (section_service_id)
        REFERENCES section_services (id) ON DELETE CASCADE) {_T};
INSERT INTO estimate_sections VALUES ('sec-1', 'est-1', 'Irrigation');
INSERT INTO section_services VALUES ('svc-1', 'sec-1', NULL, 'IN: Irrigation Install');
INSERT INTO section_service_components (id, section_service_id, kind, label, qty, unit_cost_cents)
    VALUES ('c1', 'svc-1', 'labor', 'Crew', 8, 3500), ('c2', 'svc-1', 'material', 'PVC', 10, 345);
"""


def _drop(conn):
    with conn.cursor() as cur:
        cur.execute("SET FOREIGN_KEY_CHECKS=0")
        cur.execute("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()")
        for row in cur.fetchall():
            cur.execute(f"DROP TABLE `{row['TABLE_NAME']}`")
        cur.execute("SET FOREIGN_KEY_CHECKS=1")


@pytest.fixture
def mdb():
    conn = _db()
    _drop(conn)
    M.exec_statements(conn, M.split_statements(_BASE_SQL))
    for name in ("070_materials_catalog", "071_item_classes", "072_materials_item_status",
                 "073_service_catalog"):
        M.exec_file(conn, REPO / "sql" / "migrations" / f"{name}.sql")
    with conn.cursor() as cur:
        cur.execute("INSERT INTO materials (inventory_id, description, is_stock_item) "
                    "VALUES ('6060000001', 'PVC Pipe 1in Sch40', 1)")
    yield conn
    _drop(conn)
    conn.close()


def _one(conn, sql, params=()):
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


@requires_mysql
def test_074_applies_over_existing_rows_reapplies_and_rolls_back(mdb):
    assert not M.detect_074(mdb)
    M.exec_file(mdb, MIGRATION)
    assert M.detect_074(mdb)
    M.exec_file(mdb, MIGRATION)  # re-run is a no-op
    assert _one(mdb, "SELECT id, kind, inventory_id FROM section_service_components ORDER BY id") == [
        {"id": "c1", "kind": "labor", "inventory_id": None},
        {"id": "c2", "kind": "material", "inventory_id": None}]
    with mdb.cursor() as cur:
        cur.execute("INSERT INTO section_service_components (id, section_service_id, kind, label, inventory_id) "
                    "VALUES ('c3', 'svc-1', 'equipment', 'Trencher', NULL), "
                    "('c4', 'svc-1', 'material', 'PVC', '6060000001')")
    import pymysql
    with pytest.raises(pymysql.err.IntegrityError):
        with mdb.cursor() as cur:
            cur.execute("INSERT INTO section_service_components (id, section_service_id, kind, label, inventory_id) "
                        "VALUES ('c5', 'svc-1', 'material', 'x', 'NOPE')")
    with pytest.raises(pymysql.err.IntegrityError):
        with mdb.cursor() as cur:
            cur.execute("UPDATE materials SET inventory_id = 'X' WHERE inventory_id = '6060000001'")
    # Rollback with a wider kind in use: link dropped, kind left wide, rows untouched.
    M.exec_file(mdb, ROLLBACK)
    assert not M.detect_074(mdb)
    assert _one(mdb, "SELECT kind FROM section_service_components WHERE id = 'c3'") == [{"kind": "equipment"}]
    M.exec_file(mdb, MIGRATION)
    assert M.detect_074(mdb)
    with mdb.cursor() as cur:
        cur.execute("DELETE FROM section_service_components WHERE id IN ('c3', 'c4')")
    M.exec_file(mdb, ROLLBACK)
    col = _one(mdb, "SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() "
                    "AND TABLE_NAME = 'section_service_components' AND COLUMN_NAME = 'kind'")
    assert col[0]["t"] == "enum('labor','material')"
    assert not M.column_exists(mdb, "section_service_components", "inventory_id")
    assert not M.column_exists(mdb, "section_service_components", "uom")


@requires_mysql
def test_074_adds_nullable_uom_and_finishes_a_pre_uom_apply(mdb):
    M.exec_file(mdb, MIGRATION)
    col = _one(mdb, "SELECT COLUMN_TYPE AS t, IS_NULLABLE AS n, COLUMN_DEFAULT AS d FROM information_schema.COLUMNS "
                    "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'section_service_components' "
                    "AND COLUMN_NAME = 'uom'")
    assert col == [{"t": "varchar(20)", "n": "YES", "d": None}]
    assert _one(mdb, "SELECT uom FROM section_service_components WHERE id = 'c2'") == [{"uom": None}]
    # A database that ran 074 before uom existed: not detected, re-run adds it.
    with mdb.cursor() as cur:
        cur.execute("ALTER TABLE section_service_components DROP COLUMN uom")
    assert not M.detect_074(mdb)
    M.exec_file(mdb, MIGRATION)
    assert M.detect_074(mdb) and M.column_exists(mdb, "section_service_components", "uom")


@requires_mysql
def test_074_partial_apply_is_not_detected_and_finishes(mdb):
    with mdb.cursor() as cur:
        cur.execute("ALTER TABLE section_service_components MODIFY COLUMN kind "
                    "ENUM('labor','material','equipment','subcontractor','other') NOT NULL")
        cur.execute("ALTER TABLE section_service_components ADD COLUMN inventory_id "
                    "VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL")
    assert not M.detect_074(mdb)
    M.exec_file(mdb, MIGRATION)
    assert M.detect_074(mdb)


# ── set-based validation (review should-fix) ─────────────────────────────────

def test_nested_create_loads_materials_prices_and_services_set_based(units, monkeypatch):
    """A nested body with many components costs one materials, one
    material_prices and one services query, not one per component or line."""
    import api.estimating as E
    seen = []
    real = E.query

    async def counting(sql, params=None):
        seen.append(" ".join(sql.split()))
        return await real(sql, params)

    monkeypatch.setattr(E, "query", counting)
    payload = copy.deepcopy(_install_payload())
    svc = payload["sections"][0]["services"][0]
    svc["serviceId"] = "install-svc-18878"
    ids = ["6060000001", "1010000073", "1050000081", "1030000098", "6060000001", "1010000073"]
    svc["components"] = [{"kind": "material", "inventoryId": i, "qty": 1} for i in ids]
    svc["components"].append({"kind": "labor", "label": "Crew", "qty": 8, "unitCostCents": 3500})
    payload["sections"][0]["services"].append(copy.deepcopy(svc))
    res = client.post("/api/estimating/estimates", json=payload)
    assert res.status_code == 201, res.text

    def count(prefix):
        return sum(q.startswith(prefix) for q in seen)

    assert count("SELECT inventory_id, description") == 1
    assert count("SELECT inventory_id, unit_cost_cents, uom FROM material_prices") == 1
    assert count("SELECT unit_cost_cents, uom FROM material_prices") == 0
    assert count("SELECT id, service_category_id FROM services") == 1
    got = [(c["inventoryId"], c["uom"], c["unitCostCents"])
           for s in res.json()["sections"][0]["services"] for c in s["components"] if c["inventoryId"]]
    assert got[:4] == [("6060000001", "FT", 345), ("1010000073", "OZ", 126),
                       ("1050000081", "EA", 100), ("1030000098", "EA", 14949)]
    assert len(got) == 12


def test_set_based_validation_still_rejects_before_any_write(units):
    payload = copy.deepcopy(_install_payload())
    svc = payload["sections"][0]["services"][0]
    svc["components"] = [{"kind": "material", "inventoryId": "6060000001"},
                         {"kind": "material", "inventoryId": "6060000002"}]  # no price -> 422
    before = len(units.tables["estimates"])
    res = client.post("/api/estimating/estimates", json=payload)
    assert res.status_code == 422 and "no current price" in res.json()["detail"]
    svc["components"] = [{"kind": "material", "inventoryId": "NOPE"}]
    assert client.post("/api/estimating/estimates", json=payload).status_code == 422
    svc["components"] = []
    svc["serviceId"] = "nope"
    assert client.post("/api/estimating/estimates", json=payload).status_code == 422
    assert len(units.tables["estimates"]) == before
