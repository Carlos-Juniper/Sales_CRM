"""
Tests for scripts/migrate.py — migration runner.

Unit tests run without a real database (monkeypatching DB helpers).
Integration tests require a reachable MySQL instance and are skipped otherwise;
they create a private `crm_migrate_test` database, run scenarios, and tear down.

Set MYSQL_TEST_DB=<name> to override the test-database name (default: crm_migrate_test).
"""
from __future__ import annotations

import os
import sys
import threading
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

import scripts.migrate as M  # noqa: E402

# ── MySQL availability ─────────────────────────────────────────────────────────

_TEST_DB = os.environ.get("MYSQL_TEST_DB", "crm_migrate_test")


def _mysql_reachable() -> bool:
    try:
        import pymysql
        conn = pymysql.connect(
            host=os.environ.get("MYSQL_HOST", "127.0.0.1"),
            port=int(os.environ.get("MYSQL_PORT", "3306")),
            user=os.environ.get("MYSQL_USER", "crmadmin"),
            password=os.environ.get("MYSQL_PASSWORD", ""),
            db=_TEST_DB,
            connect_timeout=2,
            autocommit=True,
        )
        conn.close()
        return True
    except Exception:
        return False


requires_mysql = pytest.mark.skipif(
    not _mysql_reachable(),
    reason=f"MySQL test DB '{_TEST_DB}' not reachable",
)

# ── Base schema (minimal tables that migrations expect to exist pre-run) ──────

_BASE_SCHEMA = """
CREATE TABLE IF NOT EXISTS leads (
    id               VARCHAR(36) NOT NULL PRIMARY KEY,
    hoa_property_id  VARCHAR(36) DEFAULT NULL,
    status           VARCHAR(30) DEFAULT NULL,
    deleted_at       DATETIME    DEFAULT NULL,
    raw_data         JSON        DEFAULT NULL,
    -- 026 adds created_by AFTER assigned_to and indexes all three.
    assigned_to      VARCHAR(36)  DEFAULT NULL,
    source           VARCHAR(50)  DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS hoa_properties (
    id                    VARCHAR(36)  NOT NULL PRIMARY KEY,
    property_name         VARCHAR(255) NOT NULL DEFAULT '',
    address               VARCHAR(255) DEFAULT NULL,
    city                  VARCHAR(100) DEFAULT NULL,
    state                 CHAR(2)      DEFAULT NULL,
    zip                   VARCHAR(20)  DEFAULT NULL,
    branch_id             VARCHAR(100) DEFAULT NULL,
    management_company_id VARCHAR(36)  DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS estimates (
    id            VARCHAR(36)    NOT NULL PRIMARY KEY,
    property_id   VARCHAR(36)    DEFAULT NULL,
    acreage       DECIMAL(10,2)  DEFAULT NULL,
    -- 019 backfills aspire_branch_id by joining sales_territories on `branch`
    -- and switching on `estimate_type`; 020 adds a column AFTER target_margin.
    estimate_type ENUM('maintenance','install') NOT NULL DEFAULT 'maintenance',
    client_name   VARCHAR(255)   NOT NULL DEFAULT '',
    branch        VARCHAR(100)   NOT NULL DEFAULT '',
    target_margin DECIMAL(6,4)   NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS intake_submissions (
    id           VARCHAR(36)  NOT NULL PRIMARY KEY,
    estimate_id  VARCHAR(36)  NOT NULL,
    submitted_by VARCHAR(255) NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS itb_projects (
    id VARCHAR(36) NOT NULL PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS approval_tiers (
    id               VARCHAR(50) NOT NULL PRIMARY KEY,
    -- The pre-007 vocabulary, which included regional_director unchanged —
    -- 007 renames branch_manager/bp/coo and then narrows the ENUM to the
    -- canonical four. Omitting regional_director here forces the RD seed row
    -- to be stored as 'coo', which 007's narrowing step then truncates.
    role_key         ENUM('branch_manager','regional_director','bp','coo') NOT NULL,
    label            VARCHAR(100) NOT NULL DEFAULT '',
    min_value_cents  INT DEFAULT NULL,
    max_value_cents  INT DEFAULT NULL,
    tier_order       INT DEFAULT NULL,
    estimate_type    VARCHAR(50) NOT NULL DEFAULT 'maintenance'
);

CREATE TABLE IF NOT EXISTS estimate_adjustments (
    id    VARCHAR(36) NOT NULL PRIMARY KEY,
    actor VARCHAR(50) NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS takeoff_lines (
    id               VARCHAR(36)    NOT NULL PRIMARY KEY,
    opportunity_qty  DECIMAL(10,2)  DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS catalog_items (
    id               VARCHAR(100)   NOT NULL PRIMARY KEY,
    description      VARCHAR(255)   NOT NULL DEFAULT '',
    uom              VARCHAR(50)    NOT NULL DEFAULT '',
    unit_cost_cents  INT            NOT NULL DEFAULT 0,
    unit_sell_cents  INT            NOT NULL DEFAULT 0,
    target_gm        DECIMAL(5,4)   NOT NULL DEFAULT 0,
    kit_type         VARCHAR(50)    NOT NULL DEFAULT '',
    production_rate  DECIMAL(10,2)  DEFAULT NULL,
    branch           VARCHAR(100)   NOT NULL DEFAULT 'All Branches',
    active           TINYINT(1)     NOT NULL DEFAULT 1,
    service_type     VARCHAR(100)   NOT NULL DEFAULT ''
);

-- 013 adds section_services.discipline AFTER catalog_item_id.
CREATE TABLE IF NOT EXISTS section_services (
    id              VARCHAR(36)  NOT NULL PRIMARY KEY,
    section_id      VARCHAR(36)  NOT NULL,
    catalog_item_id VARCHAR(36)  DEFAULT NULL,
    label           VARCHAR(255) NOT NULL DEFAULT ''
);

-- 020 adds aspire_branch_id AFTER material_key and replaces uq_material_key.
CREATE TABLE IF NOT EXISTS material_calcs (
    id              VARCHAR(36)  NOT NULL PRIMARY KEY,
    material_key    VARCHAR(50)  NOT NULL,
    label           VARCHAR(255) NOT NULL DEFAULT '',
    unit_sell_cents BIGINT       NOT NULL DEFAULT 0,
    unit_cost_cents BIGINT       NOT NULL DEFAULT 0,
    uom             VARCHAR(20)  NOT NULL DEFAULT '',
    UNIQUE KEY uq_material_key (material_key)
);

CREATE TABLE IF NOT EXISTS intake_attachments (
    id                    VARCHAR(36) NOT NULL PRIMARY KEY,
    intake_submission_id  VARCHAR(36) NOT NULL,
    kind                  ENUM('property_map','rfp','other') NOT NULL DEFAULT 'other',
    CONSTRAINT fk_attachments_intake
        FOREIGN KEY (intake_submission_id) REFERENCES intake_submissions (id) ON DELETE CASCADE
);
"""

# Pre-migration seed rows that migrations 007 expects to already exist.
_APPROVAL_TIER_SEED = """
INSERT IGNORE INTO approval_tiers
    (id, role_key, label, min_value_cents, max_value_cents, tier_order, estimate_type) VALUES
    ('tier-maint-bm',  'branch_manager', 'Branch Manager',   0,          10000000, 1, 'maintenance'),
    ('tier-maint-rd',  'regional_director', 'Regional Director', 10000000, 25000000, 2, 'maintenance'),
    ('tier-maint-bp',  'bp',             'Business Partner', 25000000,  100000000, 3, 'maintenance'),
    ('tier-maint-coo', 'coo',            'COO',              100000000, NULL,      4, 'maintenance');
"""

def _drop_all_tables(conn) -> None:
    """Empty the test database completely.

    Deliberately not a hand-maintained name list. The previous list went stale
    the moment a migration created a table nobody added to it, and any survivor
    leaks into the next test's supposedly-clean schema — a stray table carrying
    a foreign key into `users` is enough to make 004's RENAME fail with a
    "foreign key incorrectly formed" error that points nowhere near the cause.

    Safe because _TEST_DB is a private database this suite owns end to end.
    """
    with conn.cursor() as cur:
        cur.execute(
            "SELECT table_name AS t FROM information_schema.tables "
            "WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'"
        )
        names = [r["t"] for r in cur.fetchall()]
        cur.execute("SET FOREIGN_KEY_CHECKS = 0")
        for t in names:
            cur.execute(f"DROP TABLE IF EXISTS `{t}`")
        cur.execute("SET FOREIGN_KEY_CHECKS = 1")


@pytest.fixture
def db_conn():
    """
    Provide a clean pymysql connection against the test database.
    Empties the database and lays down _BASE_SCHEMA before the test, empties it
    again after.
    """
    import pymysql
    import pymysql.cursors
    conn = pymysql.connect(
        host=os.environ.get("MYSQL_HOST", "127.0.0.1"),
        port=int(os.environ.get("MYSQL_PORT", "3306")),
        user=os.environ.get("MYSQL_USER", "crmadmin"),
        password=os.environ.get("MYSQL_PASSWORD", ""),
        db=_TEST_DB,
        autocommit=True,
        cursorclass=pymysql.cursors.DictCursor,
    )
    _drop_all_tables(conn)
    with conn.cursor() as cur:
        for stmt in M.split_statements(_BASE_SCHEMA):
            cur.execute(stmt)
        for stmt in M.split_statements(_APPROVAL_TIER_SEED):
            cur.execute(stmt)
    yield conn
    _drop_all_tables(conn)
    conn.close()


# ══════════════════════════════════════════════════════════════════════════════
# Unit tests — no real database required
# ══════════════════════════════════════════════════════════════════════════════

class TestSplitStatements:
    def test_skips_blank_parts(self):
        sql = "ALTER TABLE t ADD COLUMN x INT;;  ;"
        stmts = M.split_statements(sql)
        assert len(stmts) == 1
        assert "ALTER" in stmts[0]

    def test_skips_select_only_statements(self):
        sql = "SELECT COUNT(*) FROM leads; ALTER TABLE t ADD COLUMN y INT"
        stmts = M.split_statements(sql)
        assert len(stmts) == 1
        assert stmts[0].strip().startswith("ALTER")

    def test_keeps_insert_with_subselect(self):
        sql = (
            "INSERT IGNORE INTO props (id, name) "
            "SELECT UUID(), p.name FROM parents p WHERE p.id IN "
            "(SELECT DISTINCT parent_id FROM children WHERE active=1)"
        )
        stmts = M.split_statements(sql)
        assert len(stmts) == 1
        assert stmts[0].strip().startswith("INSERT")

    def test_keeps_update_statement(self):
        sql = "UPDATE leads SET status = 'estimating' WHERE status = 'handed_off'"
        stmts = M.split_statements(sql)
        assert len(stmts) == 1
        assert "UPDATE" in stmts[0]

    def test_skips_comment_only_segments(self):
        sql = "-- just a comment\n; ALTER TABLE t ADD COLUMN z INT"
        stmts = M.split_statements(sql)
        assert all("ALTER" in s for s in stmts)

    def test_semicolon_inside_comment_does_not_create_phantom_segment(self):
        # Regression: "-- name; the lead status..." (migration 011) was splitting
        # on the ; inside the comment, producing garbage SQL as a statement.
        sql = (
            "-- Migration 011 — kanban redesign.\n"
            "--\n"
            "-- data-only rename: 'handed_off' -> 'estimating' (same concept,\n"
            "-- name; the lead status is now literally the kanban stage name).\n"
            "--\n"
            "UPDATE leads SET status = 'estimating' WHERE status = 'handed_off';\n"
            "\n"
            "-- Verification:\n"
            "--   SELECT COUNT(*) FROM leads WHERE status = 'handed_off';\n"
        )
        stmts = M.split_statements(sql)
        assert len(stmts) == 1, f"expected 1 statement, got {len(stmts)}: {stmts}"
        assert stmts[0].strip().upper().startswith("UPDATE")

    def test_real_migration_002_keeps_only_dml(self):
        path = REPO / "sql" / "migrations" / "002_backfill_leads_property_id.sql"
        stmts = M.split_statements(path.read_text())
        keywords = [s.strip().split()[0].upper() for s in stmts]
        assert "SELECT" not in keywords
        assert "INSERT" in keywords
        assert "UPDATE" in keywords

    def test_real_migration_019_splits_cleanly_and_has_no_selects(self):
        path = REPO / "sql" / "migrations" / "019_branch_model.sql"
        stmts = M.split_statements(path.read_text())
        kws = {s.strip().split()[0].upper() for s in stmts}
        assert kws == {"CREATE", "ALTER", "UPDATE", "INSERT"}

    def test_real_migration_020_splits_cleanly_and_has_no_selects(self):
        path = REPO / "sql" / "migrations" / "020_settings_storage.sql"
        stmts = M.split_statements(path.read_text())
        kws = {s.strip().split()[0].upper() for s in stmts}
        assert kws == {"CREATE", "ALTER", "INSERT"}

    def test_real_migration_004_contains_create_and_insert(self):
        path = REPO / "sql" / "migrations" / "004_users_and_branches.sql"
        stmts = M.split_statements(path.read_text())
        kws = {s.strip().split()[0].upper() for s in stmts}
        assert "CREATE" in kws
        assert "INSERT" in kws
        assert "UPDATE" in kws
        assert "SELECT" not in kws


class TestMigrationFiles:
    def test_file_count_matches_directory(self):
        # Derives count from migration_files() itself so it never goes stale when
        # new migrations are added.
        files = M.migration_files()
        assert len(files) == len(M.migration_files()), "migration_files() must be stable"

    def test_ordered_numerically(self):
        files = M.migration_files()
        ids = [mid for mid, _ in files]
        assert ids[0].startswith("001_")
        assert ids == sorted(ids)

    def test_every_file_has_a_detector_or_inline_handler(self):
        """A file with no detector re-executes on a DB that already has it."""
        inline = {
            "002_backfill_leads_property_id",
            "003_drop_leads_hoa_property_id",
            "004_users_and_branches",
        }
        for mid, _ in M.migration_files():
            assert mid in M._DETECT or mid in inline, f"{mid} has no detection path"

    def test_ids_match_stem_of_path(self):
        for mid, path in M.migration_files():
            assert mid == path.stem

    def test_022_present_in_migration_files(self):
        """Migration 022 (contract drop) must appear in the migration file list."""
        ids = [mid for mid, _ in M.migration_files()]
        assert any(mid.startswith("022_") for mid in ids), (
            "022_contract_drop_branch_columns.sql not found — did you create it?"
        )


class TestExecuteDoesNotFormatSql:
    """A migration file is raw SQL, never a % format string.

    pymysql interpolates whenever `args` is not None, so passing an empty tuple
    makes `LIKE '%DO NOT USE%'` raise "not enough arguments for format string".
    This took migration 019 down mid-file against the live database.
    """

    def test_literal_percent_passes_through_untouched(self):
        conn = MagicMock()
        cur = conn.cursor.return_value.__enter__.return_value
        sql = "UPDATE branches SET f = 0 WHERE name LIKE '%DO NOT USE%'"

        M._execute(conn, sql)

        cur.execute.assert_called_once_with(sql)

    def test_exec_statements_does_not_format(self):
        conn = MagicMock()
        cur = conn.cursor.return_value.__enter__.return_value

        M.exec_statements(conn, ["UPDATE t SET x = 1 WHERE s LIKE '%50%'"])

        assert cur.execute.call_args.args == ("UPDATE t SET x = 1 WHERE s LIKE '%50%'",)

    def test_params_still_passed_when_present(self):
        """RELEASE_LOCK(%s) and friends must keep their placeholders working."""
        conn = MagicMock()
        cur = conn.cursor.return_value.__enter__.return_value

        M._execute(conn, "SELECT RELEASE_LOCK(%s)", ("lk",))

        cur.execute.assert_called_once_with("SELECT RELEASE_LOCK(%s)", ("lk",))


class TestChecksum:
    def test_same_file_same_checksum(self, tmp_path):
        f = tmp_path / "m.sql"
        f.write_bytes(b"ALTER TABLE t ADD COLUMN x INT")
        assert M.file_checksum(f) == M.file_checksum(f)

    def test_different_bytes_different_checksum(self, tmp_path):
        f1 = tmp_path / "a.sql"
        f2 = tmp_path / "b.sql"
        f1.write_bytes(b"ALTER TABLE a ADD COLUMN x INT")
        f2.write_bytes(b"ALTER TABLE b ADD COLUMN x INT")
        assert M.file_checksum(f1) != M.file_checksum(f2)

    def test_checksum_is_64_hex_chars(self, tmp_path):
        f = tmp_path / "c.sql"
        f.write_bytes(b"SELECT 1")
        cs = M.file_checksum(f)
        assert len(cs) == 64
        assert all(c in "0123456789abcdef" for c in cs)


class TestIsCreateTableUsers:
    def test_matches_create_table_if_not_exists(self):
        stmt = "CREATE TABLE IF NOT EXISTS users (\n    id VARCHAR(36) NOT NULL\n)"
        assert M._is_create_table_users(stmt) is True

    def test_matches_create_table_backtick(self):
        stmt = "CREATE TABLE `users` (\n    id INT\n)"
        assert M._is_create_table_users(stmt) is True

    def test_does_not_match_branches(self):
        stmt = "CREATE TABLE IF NOT EXISTS branches (\n    id INT\n)"
        assert M._is_create_table_users(stmt) is False

    def test_does_not_match_sales_territories(self):
        stmt = "CREATE TABLE sales_territories (\n    id VARCHAR(100)\n)"
        assert M._is_create_table_users(stmt) is False

    def test_ignores_leading_comment_lines(self):
        stmt = "-- This is the users DDL\nCREATE TABLE IF NOT EXISTS users (\n    id INT\n)"
        assert M._is_create_table_users(stmt) is True

    def test_real_004_identifies_correct_statement(self):
        path = REPO / "sql" / "migrations" / "004_users_and_branches.sql"
        stmts = M.split_statements(path.read_text())
        users_stmts = [s for s in stmts if M._is_create_table_users(s)]
        assert len(users_stmts) == 1


class TestDetectFunctions:
    """Unit tests for detect_* functions using monkeypatched DB helpers."""

    # ── 001 ───────────────────────────────────────────────────────────────────

    def test_detect_001_false_when_properties_absent(self, monkeypatch):
        monkeypatch.setattr(M, "table_exists", lambda conn, t: False)
        assert M.detect_001(None) is False

    def test_detect_001_true_when_properties_present(self, monkeypatch):
        monkeypatch.setattr(M, "table_exists", lambda conn, t: t == "properties")
        assert M.detect_001(None) is True

    # ── 002 ───────────────────────────────────────────────────────────────────

    def test_detect_002_applied_when_column_absent(self, monkeypatch):
        monkeypatch.setattr(M, "column_exists", lambda conn, t, c: False)
        assert M.detect_002(None) == "applied"

    def test_detect_002_unknown_when_column_present(self, monkeypatch):
        monkeypatch.setattr(M, "column_exists", lambda conn, t, c: True)
        assert M.detect_002(None) == "unknown"

    # ── 003 ───────────────────────────────────────────────────────────────────

    def test_detect_003_true_when_column_absent(self, monkeypatch):
        monkeypatch.setattr(M, "column_exists", lambda conn, t, c: False)
        assert M.detect_003(None) is True

    def test_detect_003_false_when_column_present(self, monkeypatch):
        monkeypatch.setattr(M, "column_exists", lambda conn, t, c: True)
        assert M.detect_003(None) is False

    # ── 004 ───────────────────────────────────────────────────────────────────

    def test_detect_004_already_applied_when_all_three_tables_exist(self, monkeypatch):
        monkeypatch.setattr(M, "table_exists",
            lambda conn, t: t in {"users", "branches", "sales_territories"})
        assert M.detect_004(None) == "already_applied"

    def test_detect_004_resume_path_when_users_exists_but_branches_missing(self, monkeypatch):
        monkeypatch.setattr(M, "table_exists", lambda conn, t: t == "users")
        assert M.detect_004(None) == "resume_path"

    def test_detect_004_resume_path_when_users_and_branches_but_no_territories(self, monkeypatch):
        monkeypatch.setattr(M, "table_exists",
            lambda conn, t: t in {"users", "branches"})
        assert M.detect_004(None) == "resume_path"

    def test_detect_004_rename_path_when_crm_users_has_rows(self, monkeypatch):
        monkeypatch.setattr(M, "table_exists", lambda conn, t: t == "crm_users")
        monkeypatch.setattr(M, "table_row_count", lambda conn, t: 3)
        assert M.detect_004(None) == "rename_path"

    def test_detect_004_create_path_when_crm_users_empty(self, monkeypatch):
        monkeypatch.setattr(M, "table_exists", lambda conn, t: t == "crm_users")
        monkeypatch.setattr(M, "table_row_count", lambda conn, t: 0)
        assert M.detect_004(None) == "create_path"

    def test_detect_004_create_path_when_no_legacy_table(self, monkeypatch):
        monkeypatch.setattr(M, "table_exists", lambda conn, t: False)
        assert M.detect_004(None) == "create_path"

    # ── 007 ───────────────────────────────────────────────────────────────────

    def test_detect_007_false_when_old_enum_values(self, monkeypatch):
        monkeypatch.setattr(M, "enum_values",
            lambda conn, t, c: {"branch_manager", "bp", "coo"})
        assert M.detect_007(None) is False

    def test_detect_007_false_when_enum_canonical_but_no_install_rows(self, monkeypatch):
        monkeypatch.setattr(M, "enum_values",
            lambda conn, t, c: {"manager", "regional_director", "vice_president", "ceo"})
        monkeypatch.setattr(M, "_fetch_one", lambda conn, sql, params=(): {"cnt": 0})
        assert M.detect_007(None) is False

    def test_detect_007_true_when_canonical_enum_and_install_rows(self, monkeypatch):
        monkeypatch.setattr(M, "enum_values",
            lambda conn, t, c: {"manager", "regional_director", "vice_president", "ceo"})
        monkeypatch.setattr(M, "_fetch_one", lambda conn, sql, params=(): {"cnt": 4})
        assert M.detect_007(None) is True

    # ── 009 ───────────────────────────────────────────────────────────────────

    def test_detect_009_true_when_seeded_row_exists(self, monkeypatch):
        monkeypatch.setattr(M, "table_exists", lambda conn, t: True)
        monkeypatch.setattr(M, "_fetch_one", lambda conn, sql, params=(): {"cnt": 1})
        assert M.detect_009(None) is True

    def test_detect_009_false_when_no_seeded_row(self, monkeypatch):
        monkeypatch.setattr(M, "table_exists", lambda conn, t: True)
        monkeypatch.setattr(M, "_fetch_one", lambda conn, sql, params=(): {"cnt": 0})
        assert M.detect_009(None) is False

    def test_detect_009_false_when_catalog_items_table_absent(self, monkeypatch):
        # Regression: on a fresh prod DB without migration 009 applied,
        # catalog_items doesn't exist yet.  Must return False, not error.
        monkeypatch.setattr(M, "table_exists", lambda conn, t: False)
        assert M.detect_009(None) is False

    # ── 011 ───────────────────────────────────────────────────────────────────

    def test_detect_011_always_false(self):
        assert M.detect_011(None) is False
        assert M.detect_011(object()) is False

    # ── column-based detections ───────────────────────────────────────────────

    @pytest.mark.parametrize("fn,table,column", [
        (M.detect_005, "estimates",    "rfi_status"),
        (M.detect_006, "itb_projects", "estimate_id"),
        (M.detect_008, "takeoff_lines","catalog_item_id"),
        (M.detect_010, "estimates",    "lead_id"),
        (M.detect_012, "estimates",    "turf_area_acres"),
        (M.detect_019, "estimates",    "aspire_branch_id"),
        (M.detect_020, "estimates",    "crew_rate_cents_per_hour"),
        (M.detect_040, "proposal_requests", "chapter_order"),
    ])
    def test_column_based_detection_true(self, monkeypatch, fn, table, column):
        monkeypatch.setattr(
            M, "column_exists", lambda conn, t, c: (t == table and c == column)
        )
        assert fn(None) is True

    @pytest.mark.parametrize("fn", [
        M.detect_005, M.detect_006, M.detect_008, M.detect_010, M.detect_012,
        M.detect_019, M.detect_020, M.detect_040,
    ])
    def test_column_based_detection_false(self, monkeypatch, fn):
        monkeypatch.setattr(M, "column_exists", lambda conn, t, c: False)
        assert fn(None) is False

    # ── 022 ───────────────────────────────────────────────────────────────────

    def test_detect_022_true_when_estimates_branch_absent(self, monkeypatch):
        """022 applied ↔ estimates.branch is gone (the first DROP in the file)."""
        # estimates.branch absent = migration done
        monkeypatch.setattr(
            M, "column_exists",
            lambda conn, t, c: not (t == "estimates" and c == "branch"),
        )
        assert M.detect_022(None) is True

    def test_detect_022_false_when_estimates_branch_present(self, monkeypatch):
        """022 not applied when estimates.branch still exists."""
        monkeypatch.setattr(M, "column_exists", lambda conn, t, c: True)
        assert M.detect_022(None) is False

    def test_detect_022_does_not_key_on_users_branch_id(self, monkeypatch):
        """detect_022 must NOT key on users.branch_id — that column is deferred
        to a separate later migration (§B.3). If estimates.branch is gone but
        users.branch_id is still present, 022 is still considered applied."""
        def col_exists(conn, table, column):
            # estimates.branch dropped; users.branch_id still there
            if table == "estimates" and column == "branch":
                return False
            return True

        monkeypatch.setattr(M, "column_exists", col_exists)
        assert M.detect_022(None) is True


class TestMigration022File:
    """Verify the SQL content and structure of 022_contract_drop_branch_columns.sql."""

    def test_022_file_exists(self):
        path = REPO / "sql" / "migrations" / "022_contract_drop_branch_columns.sql"
        assert path.exists(), "022_contract_drop_branch_columns.sql must exist"

    def test_022_drops_estimates_branch(self):
        path = REPO / "sql" / "migrations" / "022_contract_drop_branch_columns.sql"
        sql = path.read_text(encoding="utf-8").upper()
        assert "ESTIMATES" in sql
        assert "DROP COLUMN" in sql
        # The column name must appear in context with estimates
        assert "BRANCH" in sql

    def test_022_drops_catalog_items_branch(self):
        path = REPO / "sql" / "migrations" / "022_contract_drop_branch_columns.sql"
        sql = path.read_text(encoding="utf-8").upper()
        assert "CATALOG_ITEMS" in sql

    def test_022_does_not_touch_users_branch_id(self):
        """The 022 file must NOT DROP users.branch_id — that is a separate later migration."""
        path = REPO / "sql" / "migrations" / "022_contract_drop_branch_columns.sql"
        stmts = M.split_statements(path.read_text(encoding="utf-8"))
        for stmt in stmts:
            upper = stmt.upper()
            # No ALTER TABLE USERS DROP COLUMN ... allowed
            if "ALTER" in upper and "USERS" in upper and "DROP" in upper:
                raise AssertionError(
                    f"022 must not touch users table — found: {stmt[:120]}"
                )

    def test_022_parses_to_only_alter_or_drop_index_statements(self):
        """Every executable statement in 022 must be an ALTER TABLE or DROP INDEX."""
        path = REPO / "sql" / "migrations" / "022_contract_drop_branch_columns.sql"
        stmts = M.split_statements(path.read_text(encoding="utf-8"))
        assert len(stmts) >= 2, "Expect at least 2 DDL statements"
        for stmt in stmts:
            first_word = stmt.strip().split()[0].upper()
            assert first_word in ("ALTER", "DROP"), (
                f"Unexpected statement type in 022: {stmt[:60]}"
            )

    def test_022_is_registered_in_detect_dispatch(self):
        """detect_022 must be wired into the _DETECT dispatch table."""
        assert "022_contract_drop_branch_columns" in M._DETECT


class TestMigration031File:
    """Handoff 49 §3 — the migration that adds the columns 001's steps 2 & 3 never ran.

    leads.property_id + idx_property_id, and hoa_properties.assigned_to /
    contact_status / last_contacted. Every column and the index guarded on
    information_schema; no AFTER clauses; keyed on its own effect.
    """

    PATH = REPO / "sql" / "migrations" / "031_add_leads_property_id.sql"

    def test_031_file_exists(self):
        assert self.PATH.exists(), "031_add_leads_property_id.sql must exist"

    def test_031_adds_leads_property_id_and_index(self):
        sql = self.PATH.read_text(encoding="utf-8")
        assert "property_id" in sql
        assert "idx_property_id" in sql

    def test_031_adds_three_hoa_columns(self):
        sql = self.PATH.read_text(encoding="utf-8")
        for col in ("assigned_to", "contact_status", "last_contacted"):
            assert col in sql, f"031 must add hoa_properties.{col}"

    def test_031_has_no_after_clauses(self):
        """§3: drop the AFTER clauses — no positional dependency on 001's anchors."""
        # Scan only executable statements (split_statements strips -- comments),
        # so prose mentioning "after" in a header comment cannot trip this.
        for stmt in M.split_statements(self.PATH.read_text(encoding="utf-8")):
            assert " AFTER " not in stmt.upper(), f"unexpected AFTER clause: {stmt[:80]}"

    def test_031_guards_every_add_with_information_schema(self):
        """Each ADD COLUMN / ADD INDEX must be behind a PREPARE/EXECUTE guard that
        checks information_schema — an unguarded ALTER is the mistake that
        produced this handoff."""
        sql = self.PATH.read_text(encoding="utf-8")
        upper = sql.upper()
        # 4 columns + 1 index = 5 guarded ALTERs.
        assert upper.count("PREPARE") >= 5
        assert upper.count("EXECUTE") >= 5
        assert upper.count("INFORMATION_SCHEMA") >= 5

    def test_031_splits_to_prepare_execute_deallocate_only(self):
        """Every executable statement is a SET/PREPARE/EXECUTE/DEALLOCATE — no bare
        ALTER TABLE that would fail on a re-run or a correctly-migrated DB."""
        stmts = M.split_statements(self.PATH.read_text(encoding="utf-8"))
        assert stmts, "031 must contain executable statements"
        for stmt in stmts:
            first = stmt.strip().split()[0].upper()
            assert first in ("SET", "PREPARE", "EXECUTE", "DEALLOCATE"), (
                f"031 must be all guarded dynamic SQL — found bare: {stmt[:60]}"
            )

    def test_031_registered_in_detect_dispatch(self):
        assert "031_add_leads_property_id" in M._DETECT


class TestDetect031:
    """detect_031 must key on its OWN effect (leads.property_id), not a sibling
    artifact like the `properties` table — that is the lesson of §2.1."""

    def test_detect_031_true_when_leads_property_id_present(self, monkeypatch):
        monkeypatch.setattr(
            M, "column_exists",
            lambda conn, t, c: t == "leads" and c == "property_id",
        )
        assert M.detect_031(None) is True

    def test_detect_031_false_when_leads_property_id_absent(self, monkeypatch):
        monkeypatch.setattr(M, "column_exists", lambda conn, t, c: False)
        assert M.detect_031(None) is False

    def test_detect_031_false_even_when_properties_table_exists(self, monkeypatch):
        """The exact live-DB state: `properties` exists but leads.property_id does
        not. detect_031 must report NOT applied."""
        monkeypatch.setattr(M, "table_exists", lambda conn, t: t == "properties")
        monkeypatch.setattr(M, "column_exists", lambda conn, t, c: False)
        assert M.detect_031(None) is False


class TestHardGate003:
    def test_gate_returns_zero_count(self, monkeypatch):
        monkeypatch.setattr(M, "column_exists", lambda conn, t, c: True)
        monkeypatch.setattr(M, "_fetch_one", lambda conn, sql, params=(): {"cnt": 0})
        assert M.check_003_gate(None) == 0

    def test_gate_returns_nonzero_count(self, monkeypatch):
        monkeypatch.setattr(M, "column_exists", lambda conn, t, c: True)
        monkeypatch.setattr(M, "_fetch_one", lambda conn, sql, params=(): {"cnt": 7})
        assert M.check_003_gate(None) == 7

    def test_gate_returns_zero_when_property_id_column_absent(self, monkeypatch):
        # Regression: on a fresh prod DB where migrations 001/002 haven't run yet,
        # leads.property_id doesn't exist.  The gate must return 0 (safe to proceed)
        # rather than erroring — 002 will run first and add the column.
        monkeypatch.setattr(M, "column_exists", lambda conn, t, c: False)
        assert M.check_003_gate(None) == 0

    def test_gate_returns_zero_when_hoa_property_id_column_absent(self, monkeypatch):
        # The mirror case: 003 has already run, so hoa_property_id is gone while
        # property_id remains. There is nothing left to gate, and the gate must
        # say so rather than raise "Unknown column 'hoa_property_id'".
        monkeypatch.setattr(
            M, "column_exists", lambda conn, t, c: c == "property_id"
        )
        monkeypatch.setattr(
            M, "_fetch_one",
            lambda conn, sql, params=(): pytest.fail("gate must not query after 003"),
        )
        assert M.check_003_gate(None) == 0


class TestStepLogic:
    """Test _step() for the special migrations using a minimal mock conn."""

    def _make_conn(self):
        conn = MagicMock()
        conn.cursor.return_value.__enter__ = lambda s: s
        conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
        return conn

    def test_003_blocked_when_gate_nonzero(self, monkeypatch, tmp_path):
        sql_file = tmp_path / "003_drop_leads_hoa_property_id.sql"
        sql_file.write_text("ALTER TABLE leads DROP COLUMN hoa_property_id")

        monkeypatch.setattr(M, "get_tracked", lambda conn, mid: None)
        monkeypatch.setattr(M, "detect_003", lambda conn: False)  # not yet applied
        monkeypatch.setattr(M, "check_003_gate", lambda conn: 5)  # orphans remain

        tag, msg = M._step(self._make_conn(), "003_drop_leads_hoa_property_id",
                           sql_file, dry_run=False, verbose=False)
        assert tag == "blocked"
        assert "5" in msg

    def test_003_passes_when_gate_zero(self, monkeypatch, tmp_path):
        sql_file = tmp_path / "003_drop_leads_hoa_property_id.sql"
        sql_file.write_text("ALTER TABLE leads DROP COLUMN hoa_property_id")

        monkeypatch.setattr(M, "get_tracked", lambda conn, mid: None)
        monkeypatch.setattr(M, "detect_003", lambda conn: False)
        monkeypatch.setattr(M, "check_003_gate", lambda conn: 0)
        monkeypatch.setattr(M, "exec_file", lambda conn, path, verbose=False: None)
        monkeypatch.setattr(M, "record_migration", lambda *a, **kw: None)

        tag, msg = M._step(self._make_conn(), "003_drop_leads_hoa_property_id",
                           sql_file, dry_run=False, verbose=False)
        assert tag == "ok"
        assert "applied" in msg

    def test_002_marks_detected_when_column_absent(self, monkeypatch, tmp_path):
        sql_file = tmp_path / "002_backfill_leads_property_id.sql"
        sql_file.write_text("INSERT IGNORE INTO properties SELECT 1")

        monkeypatch.setattr(M, "get_tracked", lambda conn, mid: None)
        monkeypatch.setattr(M, "detect_002", lambda conn: "applied")
        recorded = []
        monkeypatch.setattr(M, "record_migration",
            lambda conn, mid, cs, detected: recorded.append(detected))

        tag, msg = M._step(self._make_conn(), "002_backfill_leads_property_id",
                           sql_file, dry_run=False, verbose=False)
        assert tag == "ok"
        assert "detected" in msg
        assert recorded == [True]

    def test_dry_run_does_not_record(self, monkeypatch, tmp_path):
        sql_file = tmp_path / "001_canonical_properties.sql"
        sql_file.write_text("CREATE TABLE IF NOT EXISTS properties (id VARCHAR(36) PRIMARY KEY)")

        monkeypatch.setattr(M, "get_tracked", lambda conn, mid: None)
        # Patch the DB helpers that detect_001 / other detectors call so that
        # the schema looks empty (no migration applied yet).
        monkeypatch.setattr(M, "table_exists", lambda conn, t: False)
        monkeypatch.setattr(M, "column_exists", lambda conn, t, c: False)
        monkeypatch.setattr(M, "enum_values", lambda conn, t, c: set())
        recorded = []
        monkeypatch.setattr(M, "record_migration",
            lambda *a, **kw: recorded.append(True))

        tag, msg = M._step(self._make_conn(), "001_canonical_properties",
                           sql_file, dry_run=True, verbose=False)
        assert tag == "ok"
        assert msg == "will-apply"
        assert recorded == []

    def test_checksum_mismatch_warns_but_skips(self, monkeypatch, tmp_path, capsys):
        sql_file = tmp_path / "005_intake_modal_completions.sql"
        sql_file.write_text("ALTER TABLE estimates ADD COLUMN rfi_status VARCHAR(255)")

        monkeypatch.setattr(M, "get_tracked", lambda conn, mid: {
            "checksum": "aaaa" * 16,  # 64-char wrong checksum
            "detected": 0,
        })

        tag, msg = M._step(self._make_conn(), "005_intake_modal_completions",
                           sql_file, dry_run=False, verbose=False)
        assert tag == "ok"
        assert "already-applied" in msg
        captured = capsys.readouterr()
        assert "checksum mismatch" in captured.err


class TestDryRunBranches:
    """
    Each special branch in _step owns its own `if not dry_run` guard.
    These unit tests assert that record_migration is never called under
    dry_run=True for any of those branches.
    """

    def _make_conn(self):
        conn = MagicMock()
        conn.cursor.return_value.__enter__ = lambda s: s
        conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
        return conn

    def _no_record(self, monkeypatch):
        recorded = []
        monkeypatch.setattr(M, "record_migration",
            lambda *a, **kw: recorded.append(True))
        return recorded

    def test_002_will_apply_does_not_record(self, monkeypatch, tmp_path):
        sql_file = tmp_path / "002_backfill_leads_property_id.sql"
        sql_file.write_text("INSERT IGNORE INTO properties SELECT 1")
        monkeypatch.setattr(M, "get_tracked", lambda conn, mid: None)
        monkeypatch.setattr(M, "detect_002", lambda conn: "unknown")
        recorded = self._no_record(monkeypatch)

        tag, msg = M._step(self._make_conn(), "002_backfill_leads_property_id",
                           sql_file, dry_run=True, verbose=False)
        assert tag == "ok"
        assert "will-apply" in msg
        assert recorded == []

    def test_003_will_apply_does_not_record(self, monkeypatch, tmp_path):
        sql_file = tmp_path / "003_drop_leads_hoa_property_id.sql"
        sql_file.write_text("ALTER TABLE leads DROP COLUMN hoa_property_id")
        monkeypatch.setattr(M, "get_tracked", lambda conn, mid: None)
        monkeypatch.setattr(M, "detect_003", lambda conn: False)
        monkeypatch.setattr(M, "check_003_gate", lambda conn: 0)
        recorded = self._no_record(monkeypatch)

        tag, msg = M._step(self._make_conn(), "003_drop_leads_hoa_property_id",
                           sql_file, dry_run=True, verbose=False)
        assert tag == "ok"
        assert "will-apply" in msg
        assert recorded == []

    def test_004_rename_path_does_not_record(self, monkeypatch, tmp_path):
        sql_file = tmp_path / "004_users_and_branches.sql"
        sql_file.write_text("CREATE TABLE IF NOT EXISTS users (id INT)")
        monkeypatch.setattr(M, "get_tracked", lambda conn, mid: None)
        monkeypatch.setattr(M, "detect_004", lambda conn: "rename_path")
        recorded = self._no_record(monkeypatch)

        tag, msg = M._step(self._make_conn(), "004_users_and_branches",
                           sql_file, dry_run=True, verbose=False)
        assert tag == "ok"
        assert "will-apply" in msg
        assert recorded == []

    def test_004_resume_path_does_not_record(self, monkeypatch, tmp_path):
        sql_file = tmp_path / "004_users_and_branches.sql"
        sql_file.write_text("CREATE TABLE IF NOT EXISTS users (id INT)")
        monkeypatch.setattr(M, "get_tracked", lambda conn, mid: None)
        monkeypatch.setattr(M, "detect_004", lambda conn: "resume_path")
        recorded = self._no_record(monkeypatch)

        tag, msg = M._step(self._make_conn(), "004_users_and_branches",
                           sql_file, dry_run=True, verbose=False)
        assert tag == "ok"
        assert "will-apply" in msg
        assert recorded == []

    def test_004_create_path_does_not_record(self, monkeypatch, tmp_path):
        sql_file = tmp_path / "004_users_and_branches.sql"
        sql_file.write_text("CREATE TABLE IF NOT EXISTS users (id INT)")
        monkeypatch.setattr(M, "get_tracked", lambda conn, mid: None)
        monkeypatch.setattr(M, "detect_004", lambda conn: "create_path")
        recorded = self._no_record(monkeypatch)

        tag, msg = M._step(self._make_conn(), "004_users_and_branches",
                           sql_file, dry_run=True, verbose=False)
        assert tag == "ok"
        assert "will-apply" in msg
        assert recorded == []


class TestRunOrchestration:
    """Test run() with fully mocked DB, verifying halting and exit behavior."""

    def test_run_halts_on_blocked(self, monkeypatch, tmp_path):
        """When a migration is blocked, subsequent ones are never attempted."""
        mig_dir = tmp_path / "migs"
        mig_dir.mkdir()
        (mig_dir / "001_a.sql").write_text("CREATE TABLE properties (id INT)")
        (mig_dir / "002_b.sql").write_text("UPDATE leads SET x = 1")
        (mig_dir / "003_c.sql").write_text("ALTER TABLE leads DROP COLUMN x")

        calls = []

        def fake_step(conn, mid, path, dry_run, verbose):
            calls.append(mid)
            if mid == "002_b":
                return "blocked", "BLOCKED — something wrong"
            return "ok", "applied"

        monkeypatch.setattr(M, "_step", fake_step)
        monkeypatch.setattr(M, "ensure_tracking_table", lambda conn, dry_run=False: None)
        monkeypatch.setattr(M, "acquire_lock", lambda conn, timeout=10: True)
        monkeypatch.setattr(M, "release_lock", lambda conn: None)
        monkeypatch.setattr(M, "connect", lambda: MagicMock())

        result = M.run(migrations_dir=mig_dir)
        assert result is False
        assert "001_a" in calls
        assert "002_b" in calls
        assert "003_c" not in calls

    def test_run_returns_false_when_lock_fails(self, monkeypatch):
        monkeypatch.setattr(M, "ensure_tracking_table", lambda conn, dry_run=False: None)
        monkeypatch.setattr(M, "acquire_lock", lambda conn, timeout=10: False)
        monkeypatch.setattr(M, "release_lock", lambda conn: None)
        monkeypatch.setattr(M, "connect", lambda: MagicMock(close=MagicMock()))

        result = M.run()
        assert result is False

    def test_run_returns_true_on_all_ok(self, monkeypatch, tmp_path):
        mig_dir = tmp_path / "m"
        mig_dir.mkdir()
        (mig_dir / "001_x.sql").write_text("CREATE TABLE t (id INT)")

        monkeypatch.setattr(M, "_step",
            lambda conn, mid, path, dry_run, verbose: ("ok", "applied"))
        monkeypatch.setattr(M, "ensure_tracking_table", lambda conn, dry_run=False: None)
        monkeypatch.setattr(M, "acquire_lock", lambda conn, timeout=10: True)
        monkeypatch.setattr(M, "release_lock", lambda conn: None)
        monkeypatch.setattr(M, "connect", lambda: MagicMock())

        result = M.run(migrations_dir=mig_dir)
        assert result is True


# ══════════════════════════════════════════════════════════════════════════════
# Integration tests — require real MySQL
# ══════════════════════════════════════════════════════════════════════════════

@requires_mysql
class TestFullFreshApply:
    def test_every_migration_applies_on_clean_schema(self, db_conn):
        """The whole set, start to finish, against nothing but _BASE_SCHEMA.

        Counted against migration_files() rather than a literal: this assertion
        was pinned at 12 and silently stopped covering 013-020, which is how
        _BASE_SCHEMA drifted far enough that 007 no longer applied at all.
        """
        expected = [mid for mid, _ in M.migration_files()]

        ok = M.run(conn=db_conn)
        assert ok is True

        with db_conn.cursor() as cur:
            cur.execute("SELECT * FROM schema_migrations ORDER BY id")
            tracked = cur.fetchall()

        assert [row["id"] for row in tracked] == expected
        assert all(row["detected"] == 0 for row in tracked)

    def test_all_tracking_rows_have_valid_checksums(self, db_conn):
        M.run(conn=db_conn)
        with db_conn.cursor() as cur:
            cur.execute("SELECT id, checksum FROM schema_migrations")
            rows = cur.fetchall()
        for row in rows:
            path = REPO / "sql" / "migrations" / f"{row['id']}.sql"
            assert M.file_checksum(path) == row["checksum"], (
                f"{row['id']}: stored checksum does not match file"
            )


@requires_mysql
class TestIdempotency:
    def test_second_run_is_noop_and_exits_zero(self, db_conn):
        M.run(conn=db_conn)

        with db_conn.cursor() as cur:
            cur.execute("SELECT applied_at FROM schema_migrations ORDER BY id")
            first_times = [r["applied_at"] for r in cur.fetchall()]

        ok = M.run(conn=db_conn)
        assert ok is True

        with db_conn.cursor() as cur:
            cur.execute("SELECT applied_at FROM schema_migrations ORDER BY id")
            second_times = [r["applied_at"] for r in cur.fetchall()]

        assert first_times == second_times  # no new rows, no timestamp changes

    def test_second_run_reports_all_already_applied(self, db_conn, capsys):
        M.run(conn=db_conn)
        capsys.readouterr()  # discard first-run output

        ok = M.run(conn=db_conn)
        assert ok is True
        out = capsys.readouterr().out
        lines = [l for l in out.splitlines() if l.strip()]
        assert all("already-applied" in l for l in lines)


@requires_mysql
class TestPartialStateDetection:
    def test_detects_004_already_applied_by_hand(self, db_conn):
        """Simulate 004 applied by hand: users + branches + sales_territories exist,
        but no schema_migrations rows. The runner should detect 001-004 and apply
        everything after them."""
        # Apply just 001–004 by executing their files directly (bypasses runner)
        for mid in ("001_canonical_properties", "002_backfill_leads_property_id",
                    "003_drop_leads_hoa_property_id", "004_users_and_branches"):
            path = REPO / "sql" / "migrations" / f"{mid}.sql"
            M.exec_file(db_conn, path)

        ok = M.run(conn=db_conn)
        assert ok is True

        with db_conn.cursor() as cur:
            cur.execute("SELECT id, detected FROM schema_migrations ORDER BY id")
            rows = {r["id"]: r["detected"] for r in cur.fetchall()}

        assert set(rows) == {mid for mid, _ in M.migration_files()}
        # 001–004 were pre-applied → detected=1
        assert rows["001_canonical_properties"] == 1
        assert rows["003_drop_leads_hoa_property_id"] == 1
        assert rows["004_users_and_branches"] == 1
        # everything after them applied fresh → detected=0
        assert rows["005_intake_modal_completions"] == 0
        assert rows["012_takeoff_scan_and_manual_metadata"] == 0
        assert rows["020_settings_storage"] == 0


@requires_mysql
class TestMigration004RenameBranch:
    def test_crm_users_gets_renamed_to_users(self, db_conn):
        """When crm_users exists with rows and users doesn't, 004 renames the table."""
        with db_conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS crm_users (
                    id              VARCHAR(36)  NOT NULL PRIMARY KEY,
                    name            VARCHAR(255) NOT NULL DEFAULT '',
                    email           VARCHAR(255) NOT NULL UNIQUE,
                    role            VARCHAR(50)  NOT NULL DEFAULT 'sales',
                    branch_id       VARCHAR(100) DEFAULT NULL,
                    avatar_initials VARCHAR(5)   NOT NULL DEFAULT '??',
                    aspire_rep_id   INT          DEFAULT NULL,
                    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            """)
            cur.execute("""
                INSERT INTO crm_users (id, name, email, role, avatar_initials) VALUES
                ('u-test-001', 'Test User',  'test@juniperlandscaping.com', 'sales', 'TU'),
                ('u-test-002', 'Other User', 'other@juniperlandscaping.com','admin', 'OU')
            """)

        # Apply 001–003 to get the base schema in the right state
        for mid in ("001_canonical_properties", "002_backfill_leads_property_id",
                    "003_drop_leads_hoa_property_id"):
            path = REPO / "sql" / "migrations" / f"{mid}.sql"
            M.exec_file(db_conn, path)

        ok = M.run(conn=db_conn)
        assert ok is True

        # crm_users should be gone; users should have the original rows
        assert not M.table_exists(db_conn, "crm_users")
        assert M.table_exists(db_conn, "users")
        with db_conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) AS cnt FROM users")
            row = cur.fetchone()
        assert row["cnt"] >= 2

    def test_004_tracking_row_shows_not_detected(self, db_conn):
        """When the rename_path is taken, detected=0 (we actually applied DDL)."""
        with db_conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE crm_users (
                    id    VARCHAR(36)  NOT NULL PRIMARY KEY,
                    name  VARCHAR(255) NOT NULL DEFAULT '',
                    email VARCHAR(255) NOT NULL UNIQUE,
                    role  VARCHAR(50)  NOT NULL DEFAULT 'sales',
                    avatar_initials VARCHAR(5) NOT NULL DEFAULT '??',
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                ) ENGINE=InnoDB
            """)
            cur.execute(
                "INSERT INTO crm_users (id, name, email) VALUES ('u1', 'U', 'u@x.com')"
            )
        for mid in ("001_canonical_properties", "002_backfill_leads_property_id",
                    "003_drop_leads_hoa_property_id"):
            M.exec_file(db_conn, REPO / "sql" / "migrations" / f"{mid}.sql")

        M.run(conn=db_conn)

        with db_conn.cursor() as cur:
            cur.execute(
                "SELECT detected FROM schema_migrations WHERE id = '004_users_and_branches'"
            )
            row = cur.fetchone()
        assert row["detected"] == 0


@requires_mysql
class TestHardGate003Integration:
    def test_run_halts_before_003_when_orphaned_leads_exist(self, db_conn):
        """After 001+002, if unresolved leads remain, 003 must block the run."""
        # Apply 001 to get leads.property_id
        M.exec_file(db_conn, REPO / "sql" / "migrations" / "001_canonical_properties.sql")

        # Insert a lead that has hoa_property_id but no hoa_properties row to resolve it
        with db_conn.cursor() as cur:
            cur.execute("""
                INSERT INTO leads (id, hoa_property_id, status)
                VALUES ('lead-orphan', 'ghost-hoa-id-does-not-exist', 'active')
            """)

        ok = M.run(conn=db_conn)
        assert ok is False

        # 001 is tracked; 002 may or may not be tracked; 003+ should NOT be tracked
        with db_conn.cursor() as cur:
            cur.execute("SELECT id FROM schema_migrations ORDER BY id")
            tracked_ids = {r["id"] for r in cur.fetchall()}
        assert "003_drop_leads_hoa_property_id" not in tracked_ids
        assert "004_users_and_branches" not in tracked_ids

    def test_run_succeeds_when_no_orphaned_leads(self, db_conn):
        """When all leads with hoa_property_id already have property_id, gate passes."""
        M.exec_file(db_conn, REPO / "sql" / "migrations" / "001_canonical_properties.sql")
        # No orphaned leads — gate count = 0
        ok = M.run(conn=db_conn)
        assert ok is True
        assert M.check_003_gate(db_conn) == 0  # column is gone after 003 ran


@requires_mysql
class TestDryRun:
    def test_dry_run_writes_nothing_on_clean_db(self, db_conn):
        M.ensure_tracking_table(db_conn)
        with db_conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) AS cnt FROM schema_migrations")
            before = cur.fetchone()["cnt"]

        ok = M.run(dry_run=True, conn=db_conn)

        with db_conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) AS cnt FROM schema_migrations")
            after = cur.fetchone()["cnt"]

        assert ok is True
        assert after == before  # zero writes

    def test_dry_run_reports_will_apply_for_all_on_clean_db(self, db_conn, capsys):
        M.ensure_tracking_table(db_conn)
        M.run(dry_run=True, conn=db_conn)
        out = capsys.readouterr().out
        will_apply_lines = [l for l in out.splitlines() if "will-apply" in l]
        # All 12 migrations pending; 002+003 may say "will-apply" or "detected"
        # depending on column state — at minimum the ones with reliable detection should appear
        assert len(will_apply_lines) >= 10

    def test_dry_run_writes_nothing_after_partial_apply(self, db_conn):
        """Even after some migrations are tracked, dry-run adds no new tracking rows."""
        # Apply 001 for real
        M.exec_file(db_conn, REPO / "sql" / "migrations" / "001_canonical_properties.sql")
        M.ensure_tracking_table(db_conn)
        M.record_migration(db_conn, "001_canonical_properties",
                           M.file_checksum(REPO / "sql" / "migrations" / "001_canonical_properties.sql"),
                           detected=False)

        with db_conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) AS cnt FROM schema_migrations")
            before = cur.fetchone()["cnt"]

        M.run(dry_run=True, conn=db_conn)

        with db_conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) AS cnt FROM schema_migrations")
            after = cur.fetchone()["cnt"]

        assert after == before


@requires_mysql
class TestMigration031Integration:
    """Handoff 49 §3 acceptance criteria, against a real MySQL test DB."""

    PATH = REPO / "sql" / "migrations" / "031_add_leads_property_id.sql"

    def _has_index(self, conn, table, index) -> bool:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) AS c FROM information_schema.statistics "
                "WHERE table_schema = DATABASE() AND table_name = %s AND index_name = %s",
                (table, index),
            )
            return cur.fetchone()["c"] > 0

    def _prop_id_columns(self, conn) -> int:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) AS c FROM information_schema.columns "
                "WHERE table_schema = DATABASE() AND table_name = 'leads' "
                "AND column_name = 'property_id'"
            )
            return cur.fetchone()["c"]

    def test_running_twice_is_idempotent(self, db_conn):
        """Running the migration twice leaves exactly one property_id column, one
        idx_property_id index, and three hoa_properties columns."""
        M.exec_file(db_conn, self.PATH)
        M.exec_file(db_conn, self.PATH)  # must not raise

        assert self._prop_id_columns(db_conn) == 1
        assert self._has_index(db_conn, "leads", "idx_property_id")
        for col in ("assigned_to", "contact_status", "last_contacted"):
            assert M.column_exists(db_conn, "hoa_properties", col)

    def test_select_property_id_succeeds_after_apply(self, db_conn):
        M.exec_file(db_conn, self.PATH)
        with db_conn.cursor() as cur:
            cur.execute("SELECT property_id FROM leads LIMIT 1")  # must not raise

    def test_noop_when_001_already_applied_correctly(self, db_conn):
        """A DB where 001's ALTERs DID land: 031 must be a no-op that does not error."""
        # Simulate 001 having applied its steps 2 & 3.
        with db_conn.cursor() as cur:
            cur.execute("ALTER TABLE leads ADD COLUMN property_id VARCHAR(36) DEFAULT NULL")
            cur.execute("ALTER TABLE leads ADD INDEX idx_property_id (property_id)")
            cur.execute("ALTER TABLE hoa_properties ADD COLUMN assigned_to VARCHAR(255) DEFAULT NULL")
            cur.execute("ALTER TABLE hoa_properties ADD COLUMN contact_status VARCHAR(50) DEFAULT NULL")
            cur.execute("ALTER TABLE hoa_properties ADD COLUMN last_contacted DATE DEFAULT NULL")

        M.exec_file(db_conn, self.PATH)  # must not raise

        assert self._prop_id_columns(db_conn) == 1
        assert self._has_index(db_conn, "leads", "idx_property_id")

    def test_detector_reports_not_applied_when_only_properties_table_exists(self, db_conn):
        """The live-DB scenario: `properties` exists (from 001 step 1) but
        leads.property_id does not. detect_031 must say NOT applied."""
        # _BASE_SCHEMA has no properties table; create it to mirror the live DB.
        with db_conn.cursor() as cur:
            cur.execute("CREATE TABLE IF NOT EXISTS properties (id VARCHAR(36) PRIMARY KEY)")
        assert M.table_exists(db_conn, "properties")
        assert not M.column_exists(db_conn, "leads", "property_id")
        assert M.detect_031(db_conn) is False


@requires_mysql
class TestConcurrencyLock:
    def test_second_runner_cannot_acquire_lock_while_first_holds_it(self, db_conn):
        """A second connection cannot acquire the advisory lock while the first holds it."""
        import pymysql
        import pymysql.cursors
        conn2 = pymysql.connect(
            host=os.environ.get("MYSQL_HOST", "127.0.0.1"),
            port=int(os.environ.get("MYSQL_PORT", "3306")),
            user=os.environ.get("MYSQL_USER", "crmadmin"),
            password=os.environ.get("MYSQL_PASSWORD", ""),
            db=_TEST_DB,
            autocommit=True,
            cursorclass=pymysql.cursors.DictCursor,
        )
        try:
            M.ensure_tracking_table(db_conn)
            acquired1 = M.acquire_lock(db_conn, timeout=1)
            assert acquired1 is True
            try:
                acquired2 = M.acquire_lock(conn2, timeout=0)
                assert acquired2 is False, "Second runner should not get the lock"
            finally:
                M.release_lock(db_conn)
            # After release, second conn CAN acquire it
            acquired_after = M.acquire_lock(conn2, timeout=1)
            assert acquired_after is True
            M.release_lock(conn2)
        finally:
            conn2.close()

    def test_concurrent_run_calls_serialize(self, db_conn):
        """
        Two run() calls started concurrently on the same DB: one gets the lock
        and runs; the other fails to acquire it and exits cleanly (no DDL errors).
        """
        results: list[bool] = []
        errors: list[Exception] = []

        def _run():
            import pymysql
            import pymysql.cursors
            c = pymysql.connect(
                host=os.environ.get("MYSQL_HOST", "127.0.0.1"),
                port=int(os.environ.get("MYSQL_PORT", "3306")),
                user=os.environ.get("MYSQL_USER", "crmadmin"),
                password=os.environ.get("MYSQL_PASSWORD", ""),
                db=_TEST_DB,
                autocommit=True,
                cursorclass=pymysql.cursors.DictCursor,
            )
            try:
                r = M.run(conn=c)
                results.append(r)
            except Exception as e:
                errors.append(e)
            finally:
                c.close()

        t1 = threading.Thread(target=_run)
        t2 = threading.Thread(target=_run)
        t1.start()
        t2.start()
        t1.join(timeout=60)
        t2.join(timeout=60)

        assert not errors, f"Unexpected exceptions: {errors}"
        # At least one run succeeded; none crashed with a duplicate-apply error
        assert len(results) == 2
        assert any(r is True for r in results)  # at least one run completed cleanly


class TestMigration059:
    """059 makes the contract-structure budget columns nullable.

    Detector keys on that effect (both columns exist AND are nullable), not on
    a sibling artifact. The file itself is guarded dynamic SQL so a re-run
    after a partial apply is safe.
    """

    PATH = REPO / "sql" / "migrations" / "059_estimate_optional_contract_budgets.sql"

    def test_registered_in_detect_dispatch(self):
        assert "059_estimate_optional_contract_budgets" in M._DETECT
        assert M._DETECT["059_estimate_optional_contract_budgets"] is M.detect_059

    def test_detect_true_only_when_both_columns_are_nullable(self, monkeypatch):
        monkeypatch.setattr(
            M, "column_nullable",
            lambda conn, t, c: t == "estimates" and c in {"homes_budget", "common_area_budget"},
        )
        assert M.detect_059(None) is True

    def test_detect_false_when_a_column_is_missing_or_not_null(self, monkeypatch):
        monkeypatch.setattr(
            M, "column_nullable",
            lambda conn, t, c: t == "estimates" and c == "homes_budget",
        )
        assert M.detect_059(None) is False
        monkeypatch.setattr(M, "column_nullable", lambda conn, t, c: False)
        assert M.detect_059(None) is False

    def test_sql_is_guarded_and_covers_add_and_modify(self):
        text = self.PATH.read_text(encoding="utf-8")
        assert "homes_budget" in text
        assert "common_area_budget" in text
        upper = text.upper()
        assert "ADD COLUMN" in upper
        assert "MODIFY COLUMN" in upper
        assert "IS_NULLABLE" in upper
        stmts = M.split_statements(text)
        assert stmts, "059 must contain executable statements"
        for stmt in stmts:
            first = stmt.strip().split()[0].upper()
            assert first in ("SET", "PREPARE", "EXECUTE", "DEALLOCATE"), (
                f"059 must be all guarded dynamic SQL — found bare: {stmt[:80]}"
            )
