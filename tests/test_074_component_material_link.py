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
    db.tables["materials"]["6060000001"] = {"inventory_id": "6060000001", "description": "PVC Pipe 1in Sch40"}
    db.tables["materials"]["6060000002"] = {"inventory_id": "6060000002", "description": "PVC Pipe 2in Sch40"}
    db.tables["material_prices"]["mp-1"] = {"id": "mp-1", "inventory_id": "6060000001",
                                            "unit_cost_cents": 345, "is_current": 1}
    db.tables["services"]["install-svc-18878"] = {"id": "install-svc-18878"}
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


def test_explicit_cost_wins_and_no_price_row_is_zero(tree):
    assert _add({"kind": "material", "inventoryId": "6060000001", "label": "a",
                 "unitCostCents": 300}).json()["unitCostCents"] == 300
    assert _add({"kind": "material", "inventoryId": "6060000002",
                 "label": "b"}).json()["unitCostCents"] == 0


@pytest.mark.parametrize("inv", ["NOPE", 12, ""])
def test_unknown_inventory_id_is_422(tree, inv):
    assert _add({"kind": "material", "label": "x", "inventoryId": inv}).status_code == 422
    assert not tree.tables["section_service_components"]


def test_labor_and_sub_rows_save_with_null_inventory_id(tree):
    for kind in ("labor", "subcontractor"):
        res = _add({"kind": kind, "label": "Crew", "qty": 8, "unitCostCents": 3500, "hours": 8})
        assert res.status_code == 201 and res.json()["inventoryId"] is None


def test_patch_relink_resnapshots_unlink_keeps_cost(tree):
    comp = _add({"kind": "material", "inventoryId": "6060000002", "label": "b"}).json()
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
