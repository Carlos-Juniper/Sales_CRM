"""Migration 075 + the maintenance kits on GET /service-catalog (Handoff 54 §1).

Unit checks lock the file, detector, guards and rollback. API checks run the
catalog route with a patched query. The DB checks (opt-in, like
tests/test_074_component_material_link.py: MYSQL_TEST_DB, default
crm_migrate_test, skipped when nothing answers) apply 070-075 over a minimal
base, re-apply, detect a partial apply, then apply the pull script's
generated seed SQL twice and assert rated kits are byte-identical.
"""
from __future__ import annotations

import asyncio
import os
import re
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "tests"))

os.environ.setdefault("JWT_SECRET", "test-secret")
import scripts.migrate as M  # noqa: E402
from api import maintenance_catalog as MC  # noqa: E402
from api import service_catalog as SC  # noqa: E402

MIGRATION = REPO / "sql" / "migrations" / "075_maintenance_service_catalog.sql"
ROLLBACK = REPO / "sql" / "rollbacks" / "075_maintenance_service_catalog_down.sql"
TYPES_TS = REPO / "studio" / "src" / "types" / "estimating.ts"


# ── migration file ────────────────────────────────────────────────────────────

def test_file_is_075_after_074_and_registered():
    ids = [mid for mid, _ in M.migration_files()]
    assert ids == sorted(ids)
    assert ids.index("075_maintenance_service_catalog") == ids.index("074_component_material_link") + 1
    assert M._DETECT["075_maintenance_service_catalog"] is M.detect_075


def test_no_super_no_generated_and_detected_column_last():
    stmts = M.split_statements(MIGRATION.read_text(encoding="utf-8"))
    upper = "\n".join(stmts).upper()
    for word in ("TRIGGER", "FUNCTION", "PROCEDURE", "EVENT", "GENERATED", "DELIMITER"):
        assert word not in upper
    assert "occurrence_source" in stmts[-4] and stmts[-4].startswith("SET @")
    assert "information_schema" in stmts[-4]
    # Every DDL is guarded; the only bare statement is the category upsert.
    bare = [s for s in stmts if s.split()[0].upper() not in {"SET", "PREPARE", "EXECUTE", "DEALLOCATE"}]
    assert len(bare) == 1 and bare[0].startswith("INSERT INTO service_categories")
    assert "ON DUPLICATE KEY UPDATE id = id" in bare[0]


def test_migration_seeds_exactly_the_shared_category_constants():
    text = MIGRATION.read_text(encoding="utf-8")
    rows = re.findall(r"\('(maint-cat-\w+)',\s*'(\w+)',\s*'([^']+)',\s*'maintenance',\s*(\d+),\s*([01])", text)
    assert [(i, c, n, bool(int(o))) for i, c, n, _s, o in rows] == [
        (cid, code, name, opt) for code, (cid, name, opt) in MC.MAINTENANCE_CATEGORIES.items()]
    assert tuple(M.MAINTENANCE_CATEGORY_IDS_075) == tuple(v[0] for v in MC.MAINTENANCE_CATEGORIES.values())
    assert MC.STANDARD_CATEGORY_CODES == ("turf", "bed_maint", "irrigation", "fertilizer", "pest_control")


def test_migration_writes_no_services_links_or_kits():
    upper = MIGRATION.read_text(encoding="utf-8").upper()
    assert "INSERT INTO SERVICES" not in upper
    assert "INSERT INTO SERVICE_KIT_LINKS" not in upper
    assert "SERVICE_KITS SET" not in upper
    assert not re.search(r"^\s*UPDATE\s", upper, re.M)


def test_rollback_drops_only_075_effects():
    text = ROLLBACK.read_text(encoding="utf-8")
    assert "DROP COLUMN occurrence_source" in text and "DROP COLUMN sort_order" in text
    assert "075_maintenance_service_catalog" in text
    assert "service_kits" not in text


# ── API: kits nested under services ───────────────────────────────────────────

os.environ.setdefault("JWT_SECRET", "test-secret")
from fastapi.testclient import TestClient  # noqa: E402
from api.server import app, require_auth  # noqa: E402

client = TestClient(app)

_CAT = {"id": "maint-cat-turf", "code": "turf", "name": "Turf", "estimate_type": "maintenance",
        "sort_order": 10, "is_optional": 0, "aspire_service_group_name": "Turf",
        "item_class_codes": None, "active": 1}
_SVC = {"id": "maint-svc-101", "service_category_id": "maint-cat-turf", "name": "MC: Mowing Service",
        "display_name": "Mowing Service", "sort_order": 10, "default_occurrences": 40,
        "occurrence_source": "mowing_occurrences", "aspire_service_id": 101, "active": 1}
_KIT = {"id": "kit-maint-3422", "description": "Standard Production Mowing", "uom": "Sq. Ft.",
        "unit_cost_cents": 1750, "unit_sell_cents": 0, "target_gm": 0.22,
        "kit_type": "maintenance_hours", "production_rate": 67650, "aspire_branch_id": None,
        "active": 1, "service_type": "Turf Area", "service_id": "maint-svc-101",
        "basis": "takeoff", "link_sort_order": 10}
_UNRATED = {**_KIT, "id": "kit-maint-3434", "description": "Prune Medium", "production_rate": None,
            "service_type": "Bed Area", "link_sort_order": 20}


@pytest.fixture
def as_role():
    def _set(role):
        app.dependency_overrides[require_auth] = lambda: {
            "id": "u1", "name": "A", "email": "a@x.com", "role": role, "branch_id": None}
    yield _set
    app.dependency_overrides.clear()


def test_catalog_nests_categories_services_kits(as_role):
    as_role("maintenance_estimating")
    with patch("api.service_catalog.query", new_callable=AsyncMock) as q:
        q.side_effect = [[_CAT], [_SVC], [], [_KIT, _UNRATED]]
        res = client.get("/api/estimating/service-catalog", params={"estimateType": "maintenance"})
    assert res.status_code == 200, res.text
    svc = res.json()[0]["services"][0]
    assert svc["occurrenceSource"] == "mowing_occurrences"
    assert svc["pricingKitId"] == "kit-maint-3422" == svc["kits"][0]["id"]
    assert svc["defaultOccurrences"] == 40
    assert svc["kits"] == [
        {"id": "kit-maint-3422", "name": "Standard Production Mowing",
         "description": "Standard Production Mowing", "unit": "Sq. Ft.", "uom": "Sq. Ft.",
         "unitCostCents": 1750, "unitSellCents": 0, "targetGm": 0.22, "kitType": "maintenance_hours",
         "productionRate": 67650, "aspireBranchId": None, "active": True, "serviceType": "Turf Area",
         "basis": "takeoff", "sortOrder": 10, "isPrimary": True},
        {"id": "kit-maint-3434", "name": "Prune Medium", "description": "Prune Medium",
         "unit": "Sq. Ft.", "uom": "Sq. Ft.",
         "unitCostCents": 1750, "unitSellCents": 0, "targetGm": 0.22, "kitType": "maintenance_hours",
         # No defensible rate: null, never a default (the UI renders "—").
         "productionRate": None, "aspireBranchId": None, "active": True, "serviceType": "Bed Area",
         "basis": "takeoff", "sortOrder": 20, "isPrimary": False},
    ]
    kit_sql, kit_params = q.await_args_list[3].args
    assert "FROM service_kit_links l" in kit_sql and "JOIN service_kits k" in kit_sql
    # Primary (pricing) kit first: active kits, then the lowest link sort_order.
    assert "ORDER BY l.service_id, k.active DESC, l.sort_order, k.id" in kit_sql
    assert kit_params == ["maint-svc-101"]


def test_each_service_marks_only_its_first_kit_primary(as_role):
    as_role("maintenance_estimating")
    other_svc = {**_SVC, "id": "maint-svc-102", "aspire_service_id": 102, "sort_order": 20}
    other_kit = {**_UNRATED, "service_id": "maint-svc-102", "link_sort_order": 10}
    with patch("api.service_catalog.query", new_callable=AsyncMock) as q:
        q.side_effect = [[_CAT], [_SVC, other_svc], [], [_KIT, _UNRATED, other_kit]]
        res = client.get("/api/estimating/service-catalog?estimateType=maintenance")
    services = res.json()[0]["services"]
    assert [[k["isPrimary"] for k in s["kits"]] for s in services] == [[True, False], [True]]
    assert [s["pricingKitId"] for s in services] == ["kit-maint-3422", "kit-maint-3434"]
    assert services[0]["defaultItems"] == []


def test_service_without_links_has_empty_kits_and_null_pricing_kit(as_role):
    as_role("maintenance_estimating")
    with patch("api.service_catalog.query", new_callable=AsyncMock) as q:
        q.side_effect = [[_CAT], [_SVC], [], []]
        res = client.get("/api/estimating/service-catalog?estimateType=maintenance")
    svc = res.json()[0]["services"][0]
    assert svc["kits"] == [] and svc["pricingKitId"] is None
    assert "serviceKitId" not in str(svc["defaultItems"])


def test_catalog_skips_the_kit_query_without_services(as_role):
    as_role("maintenance_estimating")
    with patch("api.service_catalog.query", new_callable=AsyncMock) as q:
        q.side_effect = [[_CAT], []]
        res = client.get("/api/estimating/service-catalog?estimateType=maintenance")
    assert res.json()[0]["services"] == [] and q.await_count == 2


def test_catalog_requires_an_estimating_role(as_role):
    as_role("maintenance_sales")
    assert client.get("/api/estimating/service-catalog?estimateType=maintenance").status_code == 403


def _ts_interface_fields(name: str) -> set[str]:
    src = TYPES_TS.read_text(encoding="utf-8")
    m = re.search(rf"export interface {name} \{{(.*?)\n\}}", src, re.S)
    assert m, name
    body = re.sub(r"/\*.*?\*/|//[^\n]*", "", m.group(1), flags=re.S)
    return set(re.findall(r"^\s*(\w+)\??:", body, re.M))


def test_kit_serializers_match_the_studio_service_kit_type():
    """The CatalogItem/branch drift Handoff 54 §1 flagged: the TS kit type and
    the serializers must name the same fields (branch was replaced by
    aspireBranchId in 069)."""
    ts = _ts_interface_fields("ServiceKit")
    assert "branch" not in ts and "aspireBranchId" in ts
    from api.estimating import _service_kit_out
    plain = _service_kit_out({k: v for k, v in _KIT.items()})
    assert set(plain) == ts
    linked = SC._linked_kit_out(_KIT)
    assert set(linked) - {"basis", "sortOrder", "isPrimary", "name", "unit"} == ts


# ── DB checks (opt-in) ───────────────────────────────────────────────────────

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
CREATE TABLE schema_migrations (id VARCHAR(100) NOT NULL PRIMARY KEY, checksum CHAR(64) NOT NULL,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, detected TINYINT(1) NOT NULL DEFAULT 0) {_T};
CREATE TABLE estimates (id VARCHAR(36) NOT NULL PRIMARY KEY) {_T};
CREATE TABLE service_kits (
    id VARCHAR(36) NOT NULL PRIMARY KEY, description VARCHAR(255) NOT NULL, uom VARCHAR(20) NOT NULL,
    unit_cost_cents BIGINT NOT NULL DEFAULT 0, unit_sell_cents BIGINT NOT NULL DEFAULT 0,
    target_gm DECIMAL(6,4) NOT NULL DEFAULT 0,
    kit_type ENUM('maintenance_hours','install_quantity') NOT NULL,
    production_rate DECIMAL(10,4) DEFAULT NULL, aspire_branch_id INT DEFAULT NULL,
    active TINYINT(1) NOT NULL DEFAULT 1, service_type VARCHAR(100) NOT NULL) {_T};
CREATE TABLE estimate_sections (id VARCHAR(36) NOT NULL PRIMARY KEY, estimate_id VARCHAR(36) NOT NULL,
    name VARCHAR(255) NOT NULL) {_T};
CREATE TABLE section_services (id VARCHAR(36) NOT NULL PRIMARY KEY, section_id VARCHAR(36) NOT NULL,
    service_kit_id VARCHAR(36) DEFAULT NULL, label VARCHAR(255) NOT NULL) {_T};
CREATE TABLE section_service_components (
    id VARCHAR(36) NOT NULL PRIMARY KEY, section_service_id VARCHAR(36) NOT NULL,
    kind ENUM('labor','material') NOT NULL, label VARCHAR(255) NOT NULL,
    qty DECIMAL(12,4) NOT NULL DEFAULT 0, unit_cost_cents BIGINT NOT NULL DEFAULT 0,
    hours DECIMAL(10,4) DEFAULT NULL, sort_order INT NOT NULL DEFAULT 0) {_T};
"""


def _drop(conn):
    with conn.cursor() as cur:
        cur.execute("SET FOREIGN_KEY_CHECKS=0")
        cur.execute("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()")
        for row in cur.fetchall():
            cur.execute(f"DROP TABLE `{row['TABLE_NAME']}`")
        cur.execute("SET FOREIGN_KEY_CHECKS=1")


def _rows(conn, sql, params=()):
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


@pytest.fixture
def mdb():
    from scripts.pull_aspire_service_catalog import load_baseline_kits
    conn = _db()
    _drop(conn)
    M.exec_statements(conn, M.split_statements(_BASE_SQL))
    with conn.cursor() as cur:
        for kit_id, k in load_baseline_kits().items():
            cur.execute(
                "INSERT INTO service_kits (id, description, uom, kit_type, production_rate, service_type) "
                "VALUES (%s, %s, 'Sq. Ft.', 'maintenance_hours', %s, %s)",
                (kit_id, k["description"], k["production_rate"], k["service_type"]))
    for name in ("070_materials_catalog", "071_item_classes", "072_materials_item_status",
                 "073_service_catalog", "074_component_material_link"):
        M.exec_file(conn, REPO / "sql" / "migrations" / f"{name}.sql")
    yield conn
    _drop(conn)
    conn.close()


@requires_mysql
def test_075_applies_reapplies_detects_partial_and_rolls_back(mdb):
    assert not M.detect_075(mdb)
    M.exec_file(mdb, MIGRATION)
    assert M.detect_075(mdb)
    M.exec_file(mdb, MIGRATION)
    cats = _rows(mdb, "SELECT id, is_optional FROM service_categories WHERE estimate_type = 'maintenance' "
                      "ORDER BY sort_order")
    assert [c["id"] for c in cats] == list(M.MAINTENANCE_CATEGORY_IDS_075)
    assert [c["is_optional"] for c in cats] == [0, 0, 0, 0, 0, 1]
    # A partial apply (column dropped) is not detected; the guarded file finishes it.
    with mdb.cursor() as cur:
        cur.execute("ALTER TABLE services DROP COLUMN occurrence_source")
    assert not M.detect_075(mdb)
    M.exec_file(mdb, MIGRATION)
    assert M.detect_075(mdb)
    # A renamed category keeps its edit on re-run (upsert keeps existing rows).
    with mdb.cursor() as cur:
        cur.execute("UPDATE service_categories SET name = 'Turf Care' WHERE id = 'maint-cat-turf'")
    M.exec_file(mdb, MIGRATION)
    assert _rows(mdb, "SELECT name FROM service_categories WHERE id = 'maint-cat-turf'")[0]["name"] == "Turf Care"
    M.exec_file(mdb, ROLLBACK)
    assert not M.detect_075(mdb)
    assert not M.column_exists(mdb, "services", "occurrence_source")
    M.exec_file(mdb, MIGRATION)
    assert M.detect_075(mdb)


@requires_mysql
def test_generated_seed_sql_applies_twice_and_never_moves_a_set_rate(mdb):
    from test_pull_aspire_service_catalog import FakeAspire, build_data
    from scripts import pull_aspire_service_catalog as P
    M.exec_file(mdb, MIGRATION)
    before = {r["id"]: r for r in _rows(mdb, "SELECT * FROM service_kits")}
    raw = asyncio.run(P.pull(FakeAspire(build_data()), log=lambda *_: None))
    plan = P.derive(raw, P.load_baseline_kits())
    sql = P.render_sql(plan)
    for _ in range(2):
        M.exec_statements(mdb, M.split_statements(sql))
    after = {r["id"]: r for r in _rows(mdb, "SELECT * FROM service_kits")}
    assert set(after) == set(before)  # no kit id added or removed
    changed = {k for k in before if before[k] != after[k]}
    assert changed == {"kit-maint-3434", "kit-maint-3439"}
    for k in changed:
        assert before[k]["production_rate"] is None
        assert {c for c in before[k] if before[k][c] != after[k][c]} == {"production_rate"}
    fert = _rows(mdb, "SELECT COUNT(*) AS n FROM services WHERE service_category_id = 'maint-cat-fertilizer'")
    assert fert[0]["n"] == 8
    pest = _rows(mdb, "SELECT COUNT(*) AS n FROM services WHERE service_category_id = 'maint-cat-pest_control'")
    assert pest[0]["n"] == 2
    links = _rows(mdb, "SELECT COUNT(*) AS n FROM service_kit_links")[0]["n"]
    assert links == len(plan.links)
