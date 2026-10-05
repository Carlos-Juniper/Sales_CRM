"""Migration 073 + the install service catalog seed + GET /service-catalog (Handoff 55 §1).

Unit checks lock the file number, detector, guards, rollback and the loader's
reading of the checked-in Aspire extract. The DB checks (opt-in, like
tests/test_migrate.py: MYSQL_TEST_DB, default crm_migrate_test, skipped when
nothing answers) apply 070/071/072/073 over a minimal base, seed twice, and
assert service_kits and every materials table are unchanged by checksum.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

import scripts.migrate as M  # noqa: E402
from scripts import load_service_catalog as L  # noqa: E402

MIGRATION = REPO / "sql" / "migrations" / "073_service_catalog.sql"
ROLLBACK = REPO / "sql" / "rollbacks" / "073_service_catalog_down.sql"
EXTRACT = REPO / "scripts" / "data" / "aspire_install_service_catalog.json"


# ── migration file ────────────────────────────────────────────────────────────

def test_file_is_073_and_registered():
    ids = [mid for mid, _ in M.migration_files()]
    assert "073_service_catalog" in ids
    assert ids == sorted(ids)
    assert M._DETECT["073_service_catalog"] is M.detect_073


def test_nothing_needs_super_and_no_generated_columns():
    upper = "\n".join(M.split_statements(MIGRATION.read_text(encoding="utf-8"))).upper()
    for kind in ("TRIGGER", "FUNCTION", "PROCEDURE", "EVENT"):
        assert f"CREATE {kind}" not in upper
    assert "DELIMITER" not in upper
    assert "GENERATED" not in upper


def test_every_alter_is_guarded():
    for stmt in M.split_statements(MIGRATION.read_text(encoding="utf-8")):
        first = stmt.split()[0].upper()
        assert first in {"CREATE", "SET", "PREPARE", "EXECUTE", "DEALLOCATE"}, stmt[:80]
        if first == "CREATE":
            assert stmt.upper().startswith("CREATE TABLE IF NOT EXISTS")


def test_detector_target_is_created_last():
    stmts = M.split_statements(MIGRATION.read_text(encoding="utf-8"))
    creates = [s for s in stmts if s.upper().startswith("CREATE TABLE")]
    assert "service_default_items" in creates[-1]
    assert "fk_default_items_service_kit" in stmts[-4]  # SET ... PREPARE EXECUTE DEALLOCATE


def test_touches_materials_with_one_fulltext_index_only():
    text = MIGRATION.read_text(encoding="utf-8")
    materials_alters = [s for s in M.split_statements(text) if "ALTER TABLE materials" in s]
    assert len(materials_alters) == 1
    assert "ADD FULLTEXT INDEX ft_materials_description_alt (description, alternate_name)" in materials_alters[0]
    for table in ("material_prices", "item_classes", "item_class_groups", "service_kits"):
        assert f"ALTER TABLE {table}" not in text
        assert f"INSERT INTO {table}" not in text


def test_maintenance_columns_exist():
    text = MIGRATION.read_text(encoding="utf-8")
    for col in ("estimate_type", "is_optional", "aspire_service_group_name",
                "item_class_codes", "default_occurrences"):
        assert col in text
    assert "CREATE TABLE IF NOT EXISTS service_kit_links" in text


def test_rollback_clears_tracking_row_and_is_outside_migrations():
    text = ROLLBACK.read_text(encoding="utf-8")
    assert "DELETE FROM schema_migrations WHERE id = ''073_service_catalog''" in text
    for table in ("service_default_items", "service_kit_links", "services", "service_categories"):
        assert f"DROP TABLE IF EXISTS {table};" in text
    assert "DROP INDEX ft_materials_description_alt" in text
    assert "DROP TABLE IF EXISTS materials" not in text
    ids = [mid for mid, _ in M.migration_files()]
    assert not any("down" in mid for mid in ids)


# ── loader: reading the extract ───────────────────────────────────────────────

@pytest.fixture(scope="module")
def catalog():
    return L.read_extract(EXTRACT)


def test_categories_follow_extract_sections(catalog):
    codes = [c.code for c in catalog.categories]
    assert codes == [*L.SEEDED_SECTIONS, "optional_services"]
    assert "design" not in codes and "sleeving" not in codes
    optional = catalog.categories[-1]
    assert optional.is_optional and optional.aspire_service_group_name == "Optional Services"
    assert all(not c.is_optional and c.aspire_service_group_name is None for c in catalog.categories[:-1])
    by_code = {c.code: c for c in catalog.categories}
    assert by_code["irrigation"].item_class_codes == [601, 602, 605, 606]
    assert by_code["drainage"].item_class_codes == [604]
    assert by_code["hardscape"].item_class_codes is None


def test_services_have_extract_ids_and_categories(catalog):
    data = json.loads(EXTRACT.read_text(encoding="utf-8"))
    extract = {s["service_id"]: s for s in data["services"]}
    type_to_section = data["recommended_sections"]["service_type_to_section"]
    assert len(catalog.services) == 21
    for s in catalog.services:
        src = extract[s.aspire_service_id]
        assert s.name == src["name"]
        assert s.id == f"install-svc-{s.aspire_service_id}"
        assert s.category_id == f"install-cat-{type_to_section[str(src['service_type_id'])]}"
        assert src["active"] is True
        assert "DO NOT USE" not in s.name.upper()
    ids = {s.aspire_service_id for s in catalog.services}
    assert {18878, 18882, 18888, 18875, 18885, 28771} <= ids


def test_skips_are_reported_with_reasons(catalog):
    reasons = {s.aspire_service_id: s.reason for s in catalog.skipped}
    assert reasons[50173] == "inactive_in_aspire"
    for sid in (*DO_NOT_USE_ACTIVE, *DO_NOT_USE_INACTIVE):
        assert reasons[sid] == "do_not_use"
    assert sum(r == "section_not_seeded:design" for r in reasons.values()) == 17
    assert len(catalog.skipped) + len(catalog.services) == 48


# The nine Aspire services named "DO NOT USE" (Carlos, 2026-09-30): none is seeded.
DO_NOT_USE_ACTIVE = (18877, 18881, 29824, 30271)
DO_NOT_USE_INACTIVE = (18874, 18884, 18887, 29823, 29825)


def test_no_do_not_use_service_is_seeded(catalog):
    data = json.loads(EXTRACT.read_text(encoding="utf-8"))
    flagged = {s["service_id"]: s["active"] for s in data["services"] if "DO NOT USE" in s["name"].upper()}
    assert flagged == {**{sid: True for sid in DO_NOT_USE_ACTIVE}, **{sid: False for sid in DO_NOT_USE_INACTIVE}}
    seeded = {s.aspire_service_id for s in catalog.services}
    assert not seeded & set(flagged)
    assert not any(L._is_do_not_use(s.name) or L._is_do_not_use(s.display_name) for s in catalog.services)
    skipped = {s.aspire_service_id: s.reason for s in catalog.skipped}
    assert {sid: skipped[sid] for sid in flagged} == {sid: "do_not_use" for sid in flagged}


@pytest.mark.parametrize("name", ["IN: X do not use", "IN: X - Do  Not\tUse!", "DO NOT USE: X"])
def test_do_not_use_is_by_name_any_case_even_when_active(name):
    data = json.loads(EXTRACT.read_text(encoding="utf-8"))
    other = next(s for s in data["services"] if s["service_id"] == 28771)
    other.update(name=name, active=True)
    catalog = L.parse_extract(data)
    assert 28771 not in {s.aspire_service_id for s in catalog.services}
    assert {s.aspire_service_id: s.reason for s in catalog.skipped}[28771] == "do_not_use"
    assert not L._is_do_not_use("IN: Irrigation Install")


def test_main_services_sort_first_in_their_section(catalog):
    first = {}
    for s in sorted(catalog.services, key=lambda s: s.sort_order):
        first.setdefault(s.category_id, s.aspire_service_id)
    assert first["install-cat-irrigation"] == 18878
    assert first["install-cat-landscape"] == 18882


def test_missing_section_fails_loudly():
    data = json.loads(EXTRACT.read_text(encoding="utf-8"))
    data["recommended_sections"]["sections"] = [
        s for s in data["recommended_sections"]["sections"] if s["section_key"] != "sod"
    ]
    with pytest.raises(ValueError, match="sod"):
        L.parse_extract(data)


def test_unmapped_service_type_fails_loudly():
    data = json.loads(EXTRACT.read_text(encoding="utf-8"))
    data["services"][0] = {**data["services"][0], "service_type_id": 99999}
    with pytest.raises(ValueError, match="has no section"):
        L.parse_extract(data)


def test_loader_seeds_no_default_items_and_has_no_default_item_code():
    for gone in ("DEFAULT_LABOR_KITS", "resolve_default_items", "DefaultItem", "_DEFAULT_ITEM_SQL"):
        assert not hasattr(L, gone)
    assert "INSERT INTO service_default_items" not in Path(L.__file__).read_text(encoding="utf-8")


# ── loader config (scripts/data/install_service_catalog_config.json) ─────────

CONFIG = REPO / "scripts" / "data" / "install_service_catalog_config.json"


def test_sections_and_item_class_codes_come_from_the_config_file():
    raw = json.loads(CONFIG.read_text(encoding="utf-8"))
    assert L.CONFIG_PATH == CONFIG
    assert list(L.SEEDED_SECTIONS) == raw["seeded_sections"]["order"]
    assert L.SEEDED_SECTIONS[:2] == ("landscape", "irrigation") and "design" not in L.SEEDED_SECTIONS
    assert L.ITEM_CLASS_CODES == raw["item_class_codes"]["by_section"]
    assert (L.OPTIONAL_CODE, L.OPTIONAL_NAME) == ("optional_services", "Optional Services")
    assert set(L.MAIN_INSTALL_SERVICES) == {18878, 18882, 18888, 18875, 18885}
    # No hard-coded copies left in the loader.
    src = Path(L.__file__).read_text(encoding="utf-8")
    assert "[601, 602, 605, 606]" not in src and '"marketing_gratis"' not in src


@pytest.mark.parametrize("mutate, match", [
    (lambda c: c["seeded_sections"].update(order=["sod", "sod"]), "unique"),
    (lambda c: c["item_class_codes"]["by_section"].update(design=[701]), "seeded section"),
    (lambda c: c["item_class_codes"]["by_section"].update(sod=["703"]), "integer"),
])
def test_bad_config_fails_loudly(tmp_path, mutate, match):
    raw = json.loads(CONFIG.read_text(encoding="utf-8"))
    mutate(raw)
    path = tmp_path / "cfg.json"
    path.write_text(json.dumps(raw), encoding="utf-8")
    with pytest.raises(ValueError, match=match):
        L.load_config(path)


def test_display_name_drops_in_prefix_name_stays_verbatim(catalog):
    by_id = {s.aspire_service_id: s for s in catalog.services}
    assert by_id[18878].name == "IN: Irrigation Install"
    assert by_id[18878].display_name == "Irrigation Install"
    assert not any(s.display_name.startswith("IN:") for s in catalog.services)
    assert any(s.name.startswith("IN: ") for s in catalog.services)
    assert L.display_name({"name": "IN:  Parts", "display_name": "IN:  Irrigation  Parts"}) == "Irrigation Parts"
    assert L.display_name({"name": "IN: Sod Install", "display_name": None}) == "Sod Install"
    assert L.display_name({"name": "DS: Design", "display_name": "DS: Design"}) == "DS: Design"
    assert L.display_name({"name": "IN: ", "display_name": ""}) == "IN:"


# ── GET /api/estimating/service-catalog ───────────────────────────────────────

os.environ.setdefault("JWT_SECRET", "test-secret")
from fastapi.testclient import TestClient  # noqa: E402
from api.server import app, require_auth  # noqa: E402

client = TestClient(app)


@pytest.fixture
def as_role():
    def _set(role):
        app.dependency_overrides[require_auth] = lambda: {
            "id": "u1", "name": "A", "email": "a@x.com", "role": role, "branch_id": None,
        }
    yield _set
    app.dependency_overrides.clear()


_CAT = {"id": "install-cat-irrigation", "code": "irrigation", "name": "Irrigation",
        "estimate_type": "install", "sort_order": 20, "is_optional": 0,
        "aspire_service_group_name": None, "item_class_codes": "[601, 602, 605, 606]", "active": 1}
_SVC = {"id": "install-svc-18878", "service_category_id": "install-cat-irrigation",
        "name": "IN: Irrigation Install", "display_name": "Irrigation Install", "sort_order": 10,
        "default_occurrences": None, "aspire_service_id": 18878, "active": 1}
_ITEM = {"id": "sdi-1", "service_id": "install-svc-18878", "kind": "material", "label": "PVC",
         "inventory_id": "1000000001", "service_kit_id": None, "qty": 2, "unit_cost_cents": None,
         "current_unit_cost_cents": 345, "hours": None, "sort_order": 0}


def test_service_catalog_nests_categories_services_items(as_role):
    as_role("install_estimating")
    with patch("api.service_catalog.query", new_callable=AsyncMock) as q:
        q.side_effect = [[_CAT], [_SVC], [_ITEM], []]
        res = client.get("/api/estimating/service-catalog", params={"estimateType": "install"})
    assert res.status_code == 200
    assert res.json() == [{
        "id": "install-cat-irrigation", "code": "irrigation", "name": "Irrigation",
        "estimateType": "install", "sortOrder": 20, "isOptional": False,
        "aspireServiceGroupName": None, "itemClassCodes": [601, 602, 605, 606],
        "active": True,
        "services": [{
            "id": "install-svc-18878", "serviceCategoryId": "install-cat-irrigation",
            "name": "IN: Irrigation Install", "displayName": "Irrigation Install",
            "sortOrder": 10, "defaultOccurrences": None, "occurrenceSource": None,
            "aspireServiceId": 18878, "active": True,
            "defaultItems": [{
                "id": "sdi-1", "serviceId": "install-svc-18878", "kind": "material",
                "label": "PVC", "inventoryId": "1000000001", "serviceKitId": None, "qty": 2,
                "unitCostCents": None, "resolvedUnitCostCents": 345, "hours": None, "sortOrder": 0,
            }],
            # Handoff 54 §1: install links no kits (Handoff 55 D1).
            "kits": [],
            "pricingKitId": None,
        }],
    }]
    assert q.await_args_list[0].args[1] == ["install"]
    assert "is_current = 1" in q.await_args_list[2].args[0]


def test_template_cost_wins_over_current_price(as_role):
    as_role("install_estimating")
    with patch("api.service_catalog.query", new_callable=AsyncMock) as q:
        q.side_effect = [[_CAT], [_SVC], [{**_ITEM, "unit_cost_cents": 900}], []]
        item = client.get("/api/estimating/service-catalog?estimateType=install").json()[0]["services"][0]["defaultItems"][0]
    assert item["unitCostCents"] == 900 and item["resolvedUnitCostCents"] == 900


def test_service_catalog_empty_and_validation(as_role):
    as_role("install_estimating")
    with patch("api.service_catalog.query", new_callable=AsyncMock) as q:
        q.return_value = []
        assert client.get("/api/estimating/service-catalog?estimateType=install").json() == []
        assert q.await_count == 1
    assert client.get("/api/estimating/service-catalog?estimateType=bogus").status_code == 400
    assert client.get("/api/estimating/service-catalog").status_code == 422


def test_service_catalog_requires_estimator(as_role):
    as_role("sales")
    assert client.get("/api/estimating/service-catalog?estimateType=install").status_code == 403


# ── MySQL: migration + seed + read-only guarantee ─────────────────────────────

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

_BASE = """
CREATE TABLE estimates (id VARCHAR(36) NOT NULL PRIMARY KEY) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE service_kits (id VARCHAR(36) NOT NULL PRIMARY KEY, description VARCHAR(255) NOT NULL,
    unit_cost_cents BIGINT NOT NULL DEFAULT 0, kit_type ENUM('maintenance_hours','install_quantity') NOT NULL,
    active TINYINT(1) NOT NULL DEFAULT 1, service_type VARCHAR(100) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE estimate_sections (id VARCHAR(36) NOT NULL PRIMARY KEY, estimate_id VARCHAR(36) NOT NULL, name VARCHAR(255) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE section_services (id VARCHAR(36) NOT NULL PRIMARY KEY, section_id VARCHAR(36) NOT NULL, service_kit_id VARCHAR(36) DEFAULT NULL, label VARCHAR(255) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT INTO service_kits VALUES ('kit-inst-1', '4" Pop Up Installed', 645, 'install_quantity', 1, 'Irrigation');
"""


def _drop_all(conn):
    with conn.cursor() as cur:
        cur.execute("SET FOREIGN_KEY_CHECKS=0")
        cur.execute("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()")
        for row in cur.fetchall():
            cur.execute(f"DROP TABLE `{row['TABLE_NAME']}`")
        cur.execute("SET FOREIGN_KEY_CHECKS=1")


def _run_file(conn, path: Path) -> None:
    M.exec_file(conn, path)


def _checksums(conn) -> dict:
    out = {}
    with conn.cursor() as cur:
        for t in ("service_kits", "materials", "material_prices", "item_classes", "item_class_groups"):
            cur.execute(f"CHECKSUM TABLE `{t}` EXTENDED")
            out[t] = cur.fetchone()["Checksum"]
    return out


@pytest.fixture
def base_db():
    conn = _db()
    _drop_all(conn)
    M.exec_statements(conn, M.split_statements(_BASE))
    for name in ("070_materials_catalog", "071_item_classes", "072_materials_item_status"):
        _run_file(conn, REPO / "sql" / "migrations" / f"{name}.sql")
    with conn.cursor() as cur:
        cur.execute("INSERT INTO materials (inventory_id, description, alternate_name, is_stock_item, item_status) "
                    "VALUES ('1000000001', 'PVC Pipe 1in Sch40', NULL, 1, 'Active')")
        cur.execute("INSERT INTO material_prices (id, inventory_id, unit_cost_cents, uom, effective_from, is_current, source) "
                    "VALUES ('mp-1', '1000000001', 345, 'FT', '2026-09-01', 1, 'test')")
        cur.execute("INSERT INTO item_class_groups (code, name) VALUES (600, 'Irrigation/Drainage')")
        cur.execute("INSERT INTO item_classes (item_class_id, code, name, group_code) "
                    "VALUES ('IRRIGATION-PVC_PIPE__', 606, 'IRR-PVC Pipe', 600)")
    yield conn
    _drop_all(conn)
    conn.close()


@requires_mysql
def test_073_applies_reapplies_detects_and_rolls_back(base_db):
    conn = base_db
    assert M.detect_073(conn) is False
    _run_file(conn, MIGRATION)
    assert M.detect_073(conn) is True
    _run_file(conn, MIGRATION)  # guarded: second pass is a no-op
    assert M.column_exists(conn, "section_services", "service_id")
    assert M.column_exists(conn, "estimate_sections", "service_category_id")
    assert M.index_exists(conn, "materials", "ft_materials_description_alt")
    _run_file(conn, ROLLBACK)
    assert M.detect_073(conn) is False
    assert not M.column_exists(conn, "section_services", "service_id")
    assert not M.index_exists(conn, "materials", "ft_materials_description_alt")
    _run_file(conn, ROLLBACK)  # idempotent


@requires_mysql
def test_detect_073_false_until_default_items_exist(base_db):
    conn = base_db
    stmts = M.split_statements(MIGRATION.read_text(encoding="utf-8"))
    cut = next(i for i, s in enumerate(stmts) if "CREATE TABLE IF NOT EXISTS service_default_items" in s)
    M.exec_statements(conn, stmts[:cut])  # partial apply
    assert M.detect_073(conn) is False
    _run_file(conn, MIGRATION)  # finishes the remainder
    assert M.detect_073(conn) is True


@requires_mysql
def test_seed_twice_is_noop_and_leaves_kits_and_materials_untouched(base_db, catalog):
    conn = base_db
    _run_file(conn, MIGRATION)
    before = _checksums(conn)
    conn.autocommit(False)
    first = L.apply_catalog(conn, catalog)
    conn.commit()
    second = L.apply_catalog(conn, catalog)
    conn.commit()
    conn.autocommit(True)
    assert first.categories_written == 9 and first.services_written == 21
    assert (second.categories_written, second.services_written, second.services_adopted,
            second.deactivated_categories, second.deactivated_services) == (0, 0, 0, 0, 0)
    assert _checksums(conn) == before
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) AS n FROM service_kit_links")
        assert cur.fetchone()["n"] == 0
        cur.execute("SELECT COUNT(*) AS n FROM service_default_items")
        assert cur.fetchone()["n"] == 0
        cur.execute("SELECT COUNT(*) AS n FROM services WHERE default_occurrences IS NOT NULL")
        assert cur.fetchone()["n"] == 0
        cur.execute("SELECT s.aspire_service_id, c.code FROM services s "
                    "JOIN service_categories c ON c.id = s.service_category_id WHERE s.aspire_service_id = 28771")
        assert cur.fetchone() == {"aspire_service_id": 28771, "code": "irrigation"}
        cur.execute("SELECT COUNT(*) AS n FROM services WHERE UPPER(name) LIKE '%%DO NOT USE%%' "
                    f"OR aspire_service_id IN ({', '.join(['%s'] * 9)})",
                    [*DO_NOT_USE_ACTIVE, *DO_NOT_USE_INACTIVE])
        assert cur.fetchone()["n"] == 0


@requires_mysql
def test_seed_deactivates_rows_the_extract_drops(base_db, catalog):
    conn = base_db
    _run_file(conn, MIGRATION)
    L.apply_catalog(conn, catalog)
    from dataclasses import replace
    fewer = replace(catalog, services=[s for s in catalog.services if s.aspire_service_id != 35503])
    result = L.apply_catalog(conn, fewer)
    assert result.deactivated_services == 1
    with conn.cursor() as cur:
        cur.execute("SELECT active FROM services WHERE id = 'install-svc-35503'")
        assert cur.fetchone()["active"] == 0


@requires_mysql
def test_aspire_service_id_is_unique_and_seed_matches_on_it(base_db, catalog):
    import pymysql
    conn = base_db
    _run_file(conn, MIGRATION)
    assert M.index_exists(conn, "services", "uq_services_aspire_service")
    assert not M.index_exists(conn, "services", "idx_services_aspire_service")
    with conn.cursor() as cur:
        cur.execute("INSERT INTO service_categories (id, code, name, estimate_type) "
                    "VALUES ('install-cat-irrigation', 'irrigation', 'Irrigation', 'install'), "
                    "('mcat', 'm', 'M', 'maintenance')")
        # A pre-existing row carrying 18878 under another id is adopted, not duplicated.
        cur.execute("INSERT INTO services (id, service_category_id, name, display_name, aspire_service_id) "
                    "VALUES ('legacy-18878', 'install-cat-irrigation', 'old', 'old', 18878)")
        # NULL aspire ids are not constrained.
        cur.execute("INSERT INTO services (id, service_category_id, name, display_name) "
                    "VALUES ('hand-1', 'mcat', 'a', 'a'), ('hand-2', 'mcat', 'b', 'b')")
        with pytest.raises(pymysql.err.IntegrityError):
            cur.execute("INSERT INTO services (id, service_category_id, name, display_name, aspire_service_id) "
                        "VALUES ('dup', 'mcat', 'x', 'x', 18878)")
    first = L.apply_catalog(conn, catalog)
    assert first.services_adopted == 1
    second = L.apply_catalog(conn, catalog)
    assert (second.services_written, second.services_adopted, second.deactivated_services) == (0, 1, 0)
    with conn.cursor() as cur:
        cur.execute("SELECT id, name, display_name, active FROM services WHERE aspire_service_id = 18878")
        assert cur.fetchall() == [{"id": "legacy-18878", "name": "IN: Irrigation Install",
                                   "display_name": "Irrigation Install", "active": 1}]
        cur.execute("SELECT COUNT(*) AS n FROM services WHERE id = 'install-svc-18878'")
        assert cur.fetchone()["n"] == 0
        cur.execute("UPDATE services SET service_category_id = 'mcat' WHERE id = 'legacy-18878'")
    with pytest.raises(ValueError, match="maintenance"):
        L.apply_catalog(conn, catalog)


@requires_mysql
def test_073_rerun_upgrades_plain_aspire_index_to_unique(base_db):
    conn = base_db
    _run_file(conn, MIGRATION)
    with conn.cursor() as cur:
        cur.execute("ALTER TABLE services ADD KEY idx_services_aspire_service (aspire_service_id)")
        cur.execute("ALTER TABLE services DROP INDEX uq_services_aspire_service")
    assert M.detect_073(conn) is False
    _run_file(conn, MIGRATION)
    assert M.detect_073(conn) is True
    assert M.index_exists(conn, "services", "uq_services_aspire_service")
    assert not M.index_exists(conn, "services", "idx_services_aspire_service")
    _run_file(conn, ROLLBACK)
    assert not M.table_exists(conn, "services")


def test_catalog_keys_match_frontend_contract(as_role):
    """Key sets the CRM frontend builds against (resolvedUnitCostCents is the
    one additive extra on default items; Handoff 54 §1 adds occurrenceSource
    and kits on services)."""
    as_role("install_estimating")
    with patch("api.service_catalog.query", new_callable=AsyncMock) as q:
        q.side_effect = [[_CAT], [_SVC], [_ITEM], []]
        cat = client.get("/api/estimating/service-catalog",
                         params={"estimateType": "install"}).json()[0]
    assert set(cat) == {"id", "code", "name", "estimateType", "sortOrder", "isOptional",
                        "aspireServiceGroupName", "itemClassCodes", "active", "services"}
    svc = cat["services"][0]
    assert set(svc) == {"id", "serviceCategoryId", "name", "displayName", "sortOrder",
                        "defaultOccurrences", "occurrenceSource", "aspireServiceId", "active",
                        "defaultItems", "kits", "pricingKitId"}
    assert set(svc["defaultItems"][0]) == {
        "id", "serviceId", "kind", "label", "inventoryId", "serviceKitId", "qty",
        "unitCostCents", "hours", "sortOrder", "resolvedUnitCostCents"}


# ── estimate_sections.service_category_id round trip (FakeDb) ────────────────

def _seed_install_estimate(db):
    db.tables["estimates"]["est-1"] = {
        "id": "est-1", "estimate_type": "install", "aspire_branch_id": 1}
    db.tables["service_categories"]["install-cat-irrigation"] = {
        "id": "install-cat-irrigation", "estimate_type": "install"}
    db.tables["service_categories"]["maintenance-cat-x"] = {
        "id": "maintenance-cat-x", "estimate_type": "maintenance"}


def test_section_create_and_patch_round_trip_service_category(db, as_role):
    as_role("install_estimating")
    _seed_install_estimate(db)
    res = client.post("/api/estimating/estimates/est-1/sections",
                      json={"name": "Irrigation", "serviceCategoryId": "install-cat-irrigation"})
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["serviceCategoryId"] == "install-cat-irrigation"
    sec_id = body["id"]
    assert db.tables["estimate_sections"][sec_id]["service_category_id"] == "install-cat-irrigation"
    res = client.patch(f"/api/estimating/estimates/est-1/sections/{sec_id}",
                       json={"serviceCategoryId": None})
    assert res.status_code == 200, res.text
    assert res.json()["serviceCategoryId"] is None
    res = client.patch(f"/api/estimating/estimates/est-1/sections/{sec_id}",
                       json={"serviceCategoryId": "install-cat-irrigation"})
    assert res.json()["serviceCategoryId"] == "install-cat-irrigation"


def test_section_without_category_returns_null(db, as_role):
    as_role("install_estimating")
    _seed_install_estimate(db)
    res = client.post("/api/estimating/estimates/est-1/sections", json={"name": "Misc"})
    assert res.status_code == 201, res.text
    assert res.json()["serviceCategoryId"] is None


@pytest.mark.parametrize("cat_id", ["nope", "maintenance-cat-x", 7])
def test_section_rejects_bad_or_wrong_type_category(db, as_role, cat_id):
    as_role("install_estimating")
    _seed_install_estimate(db)
    res = client.post("/api/estimating/estimates/est-1/sections",
                      json={"name": "X", "serviceCategoryId": cat_id})
    assert res.status_code == 422
    assert not db.tables["estimate_sections"]
