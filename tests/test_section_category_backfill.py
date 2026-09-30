"""estimate_sections.service_category_id backfill (Handoff 55 §3).

scripts/backfill_section_categories.py matches the plain category name only
(api.install_sections.normalize_section_name: trim, collapse whitespace,
case-insensitive). It runs against a throwaway MySQL schema (opt-in, like
tests/test_migrate.py).
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

import scripts.backfill_section_categories as B  # noqa: E402

# ── the script (MySQL) ───────────────────────────────────────────────────────

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
_SCHEMA = [
    f"CREATE TABLE estimates (id VARCHAR(36) PRIMARY KEY, estimate_type ENUM('maintenance','install') NOT NULL) {_T}",
    f"CREATE TABLE service_categories (id VARCHAR(36) PRIMARY KEY, code VARCHAR(64) NOT NULL, name VARCHAR(128) NOT NULL,"
    f" estimate_type ENUM('maintenance','install') NOT NULL, sort_order INT NOT NULL DEFAULT 0,"
    f" active TINYINT(1) NOT NULL DEFAULT 1) {_T}",
    f"CREATE TABLE services (id VARCHAR(36) PRIMARY KEY, service_category_id VARCHAR(36) NOT NULL) {_T}",
    f"CREATE TABLE estimate_sections (id VARCHAR(36) PRIMARY KEY, estimate_id VARCHAR(36) NOT NULL,"
    f" name VARCHAR(255) NOT NULL, service_category_id VARCHAR(36) DEFAULT NULL) {_T}",
    f"CREATE TABLE section_services (id VARCHAR(36) PRIMARY KEY, section_id VARCHAR(36) NOT NULL,"
    f" service_id VARCHAR(36) DEFAULT NULL) {_T}",
    "INSERT INTO estimates VALUES ('e-inst', 'install'), ('e-inst2', 'install'), ('e-inst3', 'install'), ('e-mnt', 'maintenance')",
    "INSERT INTO service_categories (id, code, name, estimate_type, sort_order, active) VALUES "
    "('install-cat-landscape', 'landscape', 'Landscape', 'install', 10, 1),"
    "('install-cat-irrigation', 'irrigation', 'Irrigation', 'install', 20, 1),"
    "('install-cat-sod', 'sod', 'Sod', 'install', 50, 1),"
    "('install-cat-old', 'old', 'Retired', 'install', 90, 0),"
    "('maint-cat-irrigation', 'irrigation', 'Irrigation', 'maintenance', 10, 1)",
    "INSERT INTO services VALUES ('install-svc-18878', 'install-cat-irrigation'), ('install-svc-18882', 'install-cat-landscape')",
    "INSERT INTO estimate_sections (id, estimate_id, name, service_category_id) VALUES "
    "('s1', 'e-inst', 'Irrigation', NULL),"
    "('s2', 'e-inst', 'IRRIGATION', NULL),"                    # same estimate: duplicate of s1
    "('s3', 'e-inst2', 'Irrigation ', NULL),"
    "('s4', 'e-inst', 'Landscape - Amenity Center', NULL),"    # the area form is not the rule
    "('s5', 'e-inst', 'Landscape-Entry', NULL),"
    "('s6', 'e-inst', 'Starter Group', NULL),"
    "('s7', 'e-inst', 'Retired', NULL),"                       # inactive category
    "('s8', 'e-inst3', 'Landscape', 'install-cat-irrigation'),"  # non-NULL: never overwritten
    "('s9', 'e-inst2', '  sod ', NULL),"
    "('s10', 'e-inst2', 'Landscape', NULL),"                   # carries an Irrigation line: D9 conflict
    "('m1', 'e-mnt', 'Irrigation', NULL),"
    "('m2', 'e-mnt', 'Main Property', NULL)",
    "INSERT INTO section_services VALUES ('l1', 's10', 'install-svc-18878'), ('l2', 's1', 'install-svc-18878')",
]


@pytest.fixture
def bdb():
    conn = _db()

    def drop():
        with conn.cursor() as cur:
            cur.execute("SET FOREIGN_KEY_CHECKS=0")
            cur.execute("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()")
            for row in cur.fetchall():
                cur.execute(f"DROP TABLE `{row['TABLE_NAME']}`")
            cur.execute("SET FOREIGN_KEY_CHECKS=1")

    drop()
    with conn.cursor() as cur:
        for stmt in _SCHEMA:
            cur.execute(stmt)
    yield conn
    drop()
    conn.close()


def _cats(conn) -> dict:
    with conn.cursor() as cur:
        cur.execute("SELECT id, service_category_id FROM estimate_sections ORDER BY id")
        return {r["id"]: r["service_category_id"] for r in cur.fetchall()}


@requires_mysql
def test_dry_run_reports_matched_vs_null_and_writes_nothing(bdb):
    before = _cats(bdb)
    report = B.run(bdb, dry_run=True)
    assert _cats(bdb) == before
    assert report.counts() == {
        "install_sections": 10, "already_set": 1, "matched": 3, "left_null": 6,
        "left_null_by_reason": {"duplicate_category": 1, "no_match": 4, "service_line_conflict": 1},
        "updated": 0, "non_install_null_untouched": 2}
    assert {m["sectionId"]: m["category"] for m in report.matched} == {
        "s1": "install-cat-irrigation", "s3": "install-cat-irrigation", "s9": "install-cat-sod"}
    assert {r["sectionId"]: r["reason"] for r in report.left_null} == {
        "s2": "duplicate_category", "s4": "no_match", "s5": "no_match", "s6": "no_match",
        "s7": "no_match", "s10": "service_line_conflict"}
    text = B.format_report(report)
    assert "'Starter Group' no_match" in text and "dry-run" in text


@requires_mysql
def test_write_sets_only_null_install_sections_and_is_idempotent(bdb):
    report = B.run(bdb, dry_run=False)
    assert report.updated == 3
    assert _cats(bdb) == {
        "m1": None, "m2": None,
        "s1": "install-cat-irrigation", "s2": None, "s3": "install-cat-irrigation",
        "s4": None, "s5": None, "s6": None, "s7": None,
        "s8": "install-cat-irrigation", "s9": "install-cat-sod", "s10": None,
    }
    again = B.run(bdb, dry_run=False)
    assert again.updated == 0 and not again.matched
    assert again.counts()["already_set"] == 4 and len(again.left_null) == 6


@requires_mysql
def test_update_is_guarded_on_null(bdb):
    report = B.run(bdb, dry_run=True)
    with bdb.cursor() as cur:  # someone sets s1 between plan and apply
        cur.execute("UPDATE estimate_sections SET service_category_id = 'install-cat-landscape' WHERE id = 's1'")
    bdb.autocommit(False)
    n = B.apply(bdb, report)
    bdb.commit()
    bdb.autocommit(True)
    assert n == 2 and _cats(bdb)["s1"] == "install-cat-landscape"


def test_juniper_dev_names_match_nothing():
    """juniper-dev today: 'Starter Group' (install), 'Main Property' and
    'Entrance & Amenity Areas' (maintenance). None is a category name."""
    from api.install_sections import normalize_section_name as n
    names = {n(c) for c in ("Landscape", "Irrigation", "Drainage", "Lighting", "Sod", "Hardscape / Pavers",
                            "Subcontractor", "Marketing / Gratis", "Optional Services")}
    assert not {n("Starter Group"), n("Main Property"), n("Entrance & Amenity Areas")} & names
