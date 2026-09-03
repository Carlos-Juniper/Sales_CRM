#!/usr/bin/env python3
"""
Migration runner for Juniper CRM.

Tracked, idempotent, lock-protected replacement for the db.run_migrations() no-op.
Detects already-applied migrations via INFORMATION_SCHEMA so it's safe to run
against databases where some migrations were previously hand-applied.

Usage (from repo root):
    python -m scripts.migrate               # apply all pending
    python -m scripts.migrate --dry-run     # report what would run, no writes
    python -m scripts.migrate --verbose     # extra per-statement output

Env vars (same as db.py):
    MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DB
    MYSQL_SOCKET_PATH   — Cloud SQL Auth Proxy socket; overrides host/port
"""
from __future__ import annotations

import argparse
import hashlib
import os
import re
import sys
from pathlib import Path
from typing import Optional

import pymysql
import pymysql.cursors

LOCK_NAME = "juniper_crm_migrations"
LOCK_TIMEOUT_SECS = 10
MIGRATIONS_DIR = Path(__file__).resolve().parents[1] / "sql" / "migrations"

_CREATE_TRACKING_TABLE = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    id          VARCHAR(100) NOT NULL,
    checksum    CHAR(64)     NOT NULL,
    applied_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    detected    TINYINT(1)   NOT NULL DEFAULT 0,
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""


# ── Connection ────────────────────────────────────────────────────────────────

def connect() -> pymysql.Connection:
    kwargs: dict = dict(
        host=os.environ.get("MYSQL_HOST", "127.0.0.1"),
        port=int(os.environ.get("MYSQL_PORT", "3306")),
        user=os.environ.get("MYSQL_USER", "crmadmin"),
        password=os.environ.get("MYSQL_PASSWORD", ""),
        db=os.environ.get("MYSQL_DB", "crm"),
        autocommit=True,
        connect_timeout=10,
        cursorclass=pymysql.cursors.DictCursor,
    )
    socket_path = os.environ.get("MYSQL_SOCKET_PATH", "")
    if socket_path:
        kwargs["unix_socket"] = socket_path
        del kwargs["host"]
        del kwargs["port"]
    return pymysql.connect(**kwargs)


# ── DB helpers ────────────────────────────────────────────────────────────────

def _run(cur, sql: str, params) -> None:
    # pymysql %-interpolates whenever args is not None, so an empty tuple still turns
    # a literal `LIKE '%DO NOT USE%'` into a bad format string. Pass no args at all
    # when there are none.
    if params:
        cur.execute(sql, params)
    else:
        cur.execute(sql)


def _fetch_one(conn, sql: str, params=()) -> Optional[dict]:
    with conn.cursor() as cur:
        _run(cur, sql, params)
        return cur.fetchone()


def _execute(conn, sql: str, params=()) -> None:
    with conn.cursor() as cur:
        _run(cur, sql, params)


# ── Tracking table ────────────────────────────────────────────────────────────

def ensure_tracking_table(conn, dry_run: bool = False) -> None:
    # Some environments have a pre-existing schema_migrations table from the
    # old hand-run tooling.  It uses `filename` as PK instead of `id` and has
    # no checksum or detected columns.  Rename it to schema_migrations_legacy
    # so the new runner can create its own table without losing the old history.
    old_schema = _fetch_one(
        conn,
        "SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schema_migrations' "
        "AND COLUMN_NAME = 'filename'",
    )
    if old_schema and old_schema["cnt"]:
        print(
            "  NOTE: renaming legacy schema_migrations (filename-PK) "
            "→ schema_migrations_legacy"
            + (" [DRY RUN — skipped]" if dry_run else "")
        )
        if not dry_run:
            _execute(conn, "RENAME TABLE schema_migrations TO schema_migrations_legacy")
    if not dry_run:
        _execute(conn, _CREATE_TRACKING_TABLE)


def get_tracked(conn, migration_id: str) -> Optional[dict]:
    # schema_migrations may not exist yet in dry-run mode (ensure_tracking_table
    # skips the CREATE in that case).  Treat a missing table as "not tracked".
    if not table_exists(conn, "schema_migrations"):
        return None
    # Likewise, if the table uses the old filename-PK schema (dry-run on a DB
    # that hasn't been migrated yet), treat all rows as untracked.
    if not column_exists(conn, "schema_migrations", "id"):
        return None
    return _fetch_one(
        conn, "SELECT * FROM schema_migrations WHERE id = %s", (migration_id,)
    )


def record_migration(conn, migration_id: str, checksum: str, detected: bool) -> None:
    _execute(
        conn,
        "INSERT INTO schema_migrations (id, checksum, detected) VALUES (%s, %s, %s)",
        (migration_id, checksum, 1 if detected else 0),
    )


# ── Advisory lock ─────────────────────────────────────────────────────────────

def acquire_lock(conn, timeout: int = LOCK_TIMEOUT_SECS) -> bool:
    row = _fetch_one(conn, "SELECT GET_LOCK(%s, %s) AS acquired", (LOCK_NAME, timeout))
    return bool(row and row["acquired"])


def release_lock(conn) -> None:
    _execute(conn, "SELECT RELEASE_LOCK(%s)", (LOCK_NAME,))


# ── Migration file utilities ──────────────────────────────────────────────────

def migration_files(migrations_dir: Path = MIGRATIONS_DIR) -> list[tuple[str, Path]]:
    """Return [(migration_id, path), ...] in numeric filename order."""
    paths = sorted(migrations_dir.glob("0*.sql"))
    return [(p.stem, p) for p in paths]


def file_checksum(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def split_statements(sql_text: str) -> list[str]:
    """
    Split SQL text on ';' boundaries, returning only executable DML/DDL.

    Strips -- comments first so that a semicolon inside a comment line
    (e.g. "-- name; rest of comment" in 011) cannot create phantom segments.
    Skips blank segments and pure SELECT statements (informational checksums).

    The migration set has no stored procedures or ';'-containing string literals,
    so semicolon splitting is safe after comment removal.
    """
    # Remove everything from -- to end of line before splitting.
    cleaned = re.sub(r"--[^\n]*", "", sql_text)
    result = []
    for part in cleaned.split(";"):
        effective = part.strip()
        if not effective:
            continue
        first_word = effective.split()[0].upper()
        if first_word == "SELECT":
            continue  # informational count query, not DDL/DML to execute
        result.append(effective)
    return result


def exec_statements(conn, stmts: list[str], verbose: bool = False) -> None:
    for stmt in stmts:
        if verbose:
            print(f"    » {stmt.strip()[:120]}")
        _execute(conn, stmt)


def exec_file(conn, path: Path, verbose: bool = False) -> None:
    exec_statements(conn, split_statements(path.read_text(encoding="utf-8")), verbose)


# ── INFORMATION_SCHEMA helpers ────────────────────────────────────────────────

def table_exists(conn, table: str) -> bool:
    row = _fetch_one(
        conn,
        "SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.TABLES "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s",
        (table,),
    )
    return bool(row and row["cnt"])


def column_exists(conn, table: str, column: str) -> bool:
    row = _fetch_one(
        conn,
        "SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND COLUMN_NAME = %s",
        (table, column),
    )
    return bool(row and row["cnt"])


def table_row_count(conn, table: str) -> int:
    row = _fetch_one(conn, f"SELECT COUNT(*) AS cnt FROM `{table}`")
    return int(row["cnt"]) if row else 0


def enum_values(conn, table: str, column: str) -> set[str]:
    """Return the set of allowed values declared for an ENUM column."""
    row = _fetch_one(
        conn,
        "SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND COLUMN_NAME = %s",
        (table, column),
    )
    if not row:
        return set()
    return set(re.findall(r"'([^']+)'", row["COLUMN_TYPE"]))


# ── Per-migration detection ───────────────────────────────────────────────────

def detect_001(conn) -> bool:
    """001 applied ↔ `properties` table exists."""
    return table_exists(conn, "properties")


# HAZARD (migration 002 / 003 ordering)
# ─────────────────────────────────────
# 002's SQL directly references leads.hoa_property_id.
# 003 DROPS that column.  Once 003 has run, leads.hoa_property_id is gone and
# 002 CANNOT be safely re-executed — the INSERT / UPDATE statements reference a
# column that no longer exists.
#
# detect_002 returns 'applied' when the column is absent (003 already ran ⇒ 002
# must have run before it) so the runner marks 002 detected=1 WITHOUT executing
# the file.  The 'unknown' path (column present, can't tell from schema) is safe
# to execute because the INSERT IGNORE + UPDATE are idempotent while the column
# still exists.

def detect_002(conn) -> str:
    """
    'applied'  — leads.hoa_property_id is absent (003 already ran → 002 done).
                 NEVER re-execute 002 in this state.
    'unknown'  — column still present; runner will execute (idempotent).
    """
    if not column_exists(conn, "leads", "hoa_property_id"):
        return "applied"
    return "unknown"


def check_003_gate(conn) -> int:
    """
    Hard gate for migration 003: count of leads where hoa_property_id is set
    but property_id is NULL (i.e. 002's backfill left orphans).  Must be 0
    before 003 runs; nonzero halts the entire migration run.

    Returns 0 (safe to proceed) if leads.property_id doesn't exist yet —
    migration 002 hasn't run, so there can be no orphans, and 002 will run
    before 003 in sequence.

    Also returns 0 once leads.hoa_property_id is gone: 003 has already run, so
    there is nothing left to gate. Without this the gate raises "Unknown column
    'hoa_property_id'" on every DB that is already past 003.
    """
    if not column_exists(conn, "leads", "property_id"):
        return 0
    if not column_exists(conn, "leads", "hoa_property_id"):
        return 0
    row = _fetch_one(
        conn,
        "SELECT COUNT(*) AS cnt FROM leads "
        "WHERE hoa_property_id IS NOT NULL AND property_id IS NULL",
    )
    return int(row["cnt"]) if row else 0


def detect_003(conn) -> bool:
    """003 applied ↔ leads.hoa_property_id column is absent."""
    return not column_exists(conn, "leads", "hoa_property_id")


def detect_004(conn) -> str:
    """
    'already_applied' — users, branches, and sales_territories all exist; skip entirely.
    'resume_path'     — users exists but branches or sales_territories missing;
                        a prior rename_path run failed after RENAME but before the
                        remaining DDL/DML; continue from where it left off.
    'rename_path'     — crm_users exists with ≥1 row, users doesn't;
                        execute RENAME TABLE instead of the CREATE.
    'create_path'     — neither; run file verbatim.
    """
    if table_exists(conn, "users"):
        # Require all three tables before declaring fully applied — a partial
        # rename_path failure leaves users present but branches/sales_territories absent.
        if table_exists(conn, "branches") and table_exists(conn, "sales_territories"):
            return "already_applied"
        return "resume_path"
    if table_exists(conn, "crm_users") and table_row_count(conn, "crm_users") >= 1:
        return "rename_path"
    return "create_path"


def detect_005(conn) -> bool:
    """005 applied ↔ estimates.rfi_status column exists."""
    return column_exists(conn, "estimates", "rfi_status")


def detect_006(conn) -> bool:
    """006 applied ↔ itb_projects.estimate_id column exists."""
    return column_exists(conn, "itb_projects", "estimate_id")


def detect_007(conn) -> bool:
    """
    007 applied ↔ approval_tiers.role_key ENUM contains {manager, vice_president, ceo}
    AND at least one install-ladder row exists.  Both must hold — partial state
    is treated as not applied.
    """
    values = enum_values(conn, "approval_tiers", "role_key")
    if not {"manager", "vice_president", "ceo"}.issubset(values):
        return False
    row = _fetch_one(
        conn, "SELECT COUNT(*) AS cnt FROM approval_tiers WHERE estimate_type = 'install'"
    )
    return bool(row and row["cnt"] > 0)


def detect_008(conn) -> bool:
    """008 applied ↔ takeoff_lines.catalog_item_id column exists."""
    return column_exists(conn, "takeoff_lines", "catalog_item_id")


def detect_009(conn) -> bool:
    """
    009 applied ↔ at least one seeded catalog_items row with id='kit-maint-5388' exists.
    Refreshing catalog_items from a newer kit workbook is an explicit, separate
    operation (scripts/load_catalog_items.py); never triggered here.
    """
    if not table_exists(conn, "catalog_items"):
        return False
    row = _fetch_one(
        conn, "SELECT COUNT(*) AS cnt FROM catalog_items WHERE id = 'kit-maint-5388'"
    )
    return bool(row and row["cnt"] >= 1)


def detect_010(conn) -> bool:
    """010 applied ↔ estimates.lead_id column exists."""
    return column_exists(conn, "estimates", "lead_id")


def detect_011(_conn) -> bool:
    """
    011 is a data-only rename (handed_off → estimating); no reliable schema signal.
    Always returns False so the runner executes the UPDATE on its first pass —
    safe because WHERE status = 'handed_off' is a no-op once no matching rows
    remain.  Subsequent runs skip it via the schema_migrations record.
    """
    return False


def detect_012(conn) -> bool:
    """012 applied ↔ estimates.turf_area_acres column exists."""
    return column_exists(conn, "estimates", "turf_area_acres")


def detect_013(conn) -> bool:
    """013 applied ↔ section_services.discipline column exists."""
    return column_exists(conn, "section_services", "discipline")


def detect_019(conn) -> bool:
    """019 applied ↔ estimates.aspire_branch_id column exists.

    Keys on the estimates column rather than user_branches: that one is a
    CREATE TABLE IF NOT EXISTS and so cannot distinguish a partial run, while the
    ALTER that adds this column is non-idempotent against an existing table.
    """
    return column_exists(conn, "estimates", "aspire_branch_id")


def detect_020(conn) -> bool:
    """020 applied ↔ estimates.crew_rate_cents_per_hour column exists.

    Keyed on the file's last statement. Everything before it is either
    CREATE TABLE IF NOT EXISTS or an idempotent INSERT, so a partial run leaves
    detection FALSE and the file safely re-runnable.
    """
    return column_exists(conn, "estimates", "crew_rate_cents_per_hour")


def detect_022(conn) -> bool:
    """022 applied ↔ estimates.branch column is absent.

    Keying on estimates.branch (the first DROP in the file) rather than
    catalog_items.branch: if a partial run dropped estimates.branch only,
    re-running will skip the already-applied DROP and execute the remaining
    catalog_items DROP — but MySQL ALTER TABLE DROP COLUMN on a missing column
    raises an error. In practice, both ALTERs are atomic statements and the
    runner stops on any failure, so a partial apply is unlikely. The estimates
    column is chosen because it is the primary motivation for the migration.

    Note: detect_022 deliberately does NOT key on users.branch_id — that column
    is deferred to a separate later migration (Handoff 38 Amendment B.3).
    """
    return not column_exists(conn, "estimates", "branch")


# ── Migration 004 conditional execution ──────────────────────────────────────

def _is_create_table_users(stmt: str) -> bool:
    """True if stmt is the CREATE TABLE (IF NOT EXISTS) users (...) block."""
    content = " ".join(
        ln for ln in stmt.splitlines() if not ln.strip().startswith("--")
    ).strip()
    return bool(
        re.match(
            r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?users`?\s*\(",
            content,
            re.IGNORECASE,
        )
    )


def apply_004(conn, path: Path, verbose: bool = False, branch: str | None = None) -> None:
    """
    Execute migration 004 with branch logic.

    Caller should pass `branch` (already returned by detect_004) to avoid
    a redundant INFORMATION_SCHEMA round-trip and prevent TOCTOU skew.

    rename_path:  RENAME TABLE crm_users TO users, then run every statement
                  from the file EXCEPT the CREATE TABLE users block.
    resume_path:  users already exists (RENAME succeeded before a prior failure);
                  skip both RENAME and CREATE TABLE users, run everything else.
                  All remaining statements are idempotent (CREATE IF NOT EXISTS,
                  ON DUPLICATE KEY UPDATE, WHERE-gated UPDATE).
    create_path:  run the file verbatim.
    """
    if branch is None:
        branch = detect_004(conn)
    if branch == "already_applied":
        return  # defensive guard; caller should not reach here

    stmts = split_statements(path.read_text(encoding="utf-8"))

    if branch == "rename_path":
        if verbose:
            print("    » RENAME TABLE crm_users TO users")
        _execute(conn, "RENAME TABLE crm_users TO users")
        for stmt in stmts:
            if _is_create_table_users(stmt):
                if verbose:
                    print("    ↷ skipping CREATE TABLE users (replaced by RENAME)")
                continue
            if verbose:
                print(f"    » {stmt.strip()[:120]}")
            _execute(conn, stmt)
    elif branch == "resume_path":
        for stmt in stmts:
            if _is_create_table_users(stmt):
                if verbose:
                    print("    ↷ skipping CREATE TABLE users (already exists)")
                continue
            if verbose:
                print(f"    » {stmt.strip()[:120]}")
            _execute(conn, stmt)
    else:
        exec_statements(conn, stmts, verbose)


# ── Detection dispatch table ──────────────────────────────────────────────────

_DETECT: dict = {
    "001_canonical_properties":                  detect_001,
    # 002 and 003 handled inline (special gate/hazard logic)
    # 004 handled inline (conditional branch)
    "005_intake_modal_completions":              detect_005,
    "006_itb_estimate_link":                     detect_006,
    "007_approval_tier_roles_and_install_ladder": detect_007,
    "008_takeoff_lines_catalog_item":            detect_008,
    "009_seed_catalog_items":                    detect_009,
    "010_estimates_lead_id":                     detect_010,
    "011_leads_status_estimating_rename":        detect_011,
    "012_takeoff_scan_and_manual_metadata":      detect_012,
    "013_section_services_discipline":           detect_013,
    "019_branch_model":                          detect_019,
    "020_settings_storage":                      detect_020,
    "022_contract_drop_branch_columns":          detect_022,
}


# ── Main run logic ────────────────────────────────────────────────────────────

def _do_apply(
    conn,
    migration_id: str,
    path: Path,
    checksum: str,
    dry_run: bool,
    verbose: bool,
    *,
    apply_fn=None,
    suffix: str = "",
) -> tuple[str, str]:
    """Dry-run / execute / record in one place — no branch duplicates this logic."""
    if dry_run:
        return "ok", f"will-apply{suffix}"
    fn = apply_fn if apply_fn is not None else lambda: exec_file(conn, path, verbose)
    fn()
    record_migration(conn, migration_id, checksum, detected=False)
    return "ok", f"applied{suffix}"


def _step(
    conn,
    migration_id: str,
    path: Path,
    dry_run: bool,
    verbose: bool,
) -> tuple[str, str]:
    """
    Process one migration.  Returns (tag, message) where tag is one of
    'ok' or 'blocked'.  Caller stops the run on 'blocked'.
    """
    checksum = file_checksum(path)

    # ── already tracked ───────────────────────────────────────────────────────
    tracked = get_tracked(conn, migration_id)
    if tracked:
        if tracked["checksum"] != checksum:
            print(
                f"  WARNING: {migration_id} checksum mismatch — file edited after apply "
                f"(recorded={tracked['checksum'][:12]}… current={checksum[:12]}…)",
                file=sys.stderr,
            )
        kind = "detected" if tracked["detected"] else "applied"
        return "ok", f"already-applied ({kind})"

    # ── 002: hazard check ─────────────────────────────────────────────────────
    if migration_id == "002_backfill_leads_property_id":
        d2 = detect_002(conn)
        if d2 == "applied":
            if verbose:
                print(
                    f"    {migration_id}: hoa_property_id absent — 003 already ran; "
                    f"backfilling tracking row as detected=1 (NEVER re-execute 002 now)"
                )
            if not dry_run:
                record_migration(conn, migration_id, checksum, detected=True)
            return "ok", "already-applied (detected — schema present, no tracking row)"
        # unknown: column present, safe to execute (INSERT IGNORE + UPDATE are idempotent)
        return _do_apply(conn, migration_id, path, checksum, dry_run, verbose)

    # ── 003: hard gate ────────────────────────────────────────────────────────
    if migration_id == "003_drop_leads_hoa_property_id":
        if detect_003(conn):
            if not dry_run:
                record_migration(conn, migration_id, checksum, detected=True)
            return "ok", "already-applied (detected — schema present, no tracking row)"
        unresolved = check_003_gate(conn)
        if unresolved != 0:
            return (
                "blocked",
                f"BLOCKED — {unresolved} lead(s) have hoa_property_id IS NOT NULL "
                f"but property_id IS NULL. "
                f"Resolve the orphaned leads from migration 002 before dropping the column.",
            )
        return _do_apply(conn, migration_id, path, checksum, dry_run, verbose)

    # ── 004: conditional branch ───────────────────────────────────────────────
    if migration_id == "004_users_and_branches":
        branch = detect_004(conn)
        if branch == "already_applied":
            if not dry_run:
                record_migration(conn, migration_id, checksum, detected=True)
            return "ok", "already-applied (detected — schema present, no tracking row)"
        _BRANCH_LABEL = {
            "rename_path": " (rename_path — crm_users→users)",
            "resume_path": " (resume_path — continuing partial apply)",
            "create_path": " (create_path)",
        }
        return _do_apply(conn, migration_id, path, checksum, dry_run, verbose,
                         apply_fn=lambda: apply_004(conn, path, verbose, branch=branch),
                         suffix=_BRANCH_LABEL.get(branch, ""))

    # ── standard detection (005–012) ──────────────────────────────────────────
    detect_fn = _DETECT.get(migration_id)
    if detect_fn and detect_fn(conn):
        if not dry_run:
            record_migration(conn, migration_id, checksum, detected=True)
        return "ok", "already-applied (detected — schema present, no tracking row)"

    return _do_apply(conn, migration_id, path, checksum, dry_run, verbose)


def run(
    dry_run: bool = False,
    verbose: bool = False,
    migrations_dir: Path = MIGRATIONS_DIR,
    conn=None,
) -> bool:
    """
    Run all migrations in order.  Returns True when every migration ended in an
    'ok' state (already-applied or applied).

    Pass `conn` explicitly to override the env-var connection (used by tests).
    When conn is None, a new connection is created and closed on exit.
    """
    own_conn = conn is None
    if own_conn:
        conn = connect()

    lock_acquired = False
    try:
        ensure_tracking_table(conn, dry_run=dry_run)

        lock_acquired = acquire_lock(conn)
        if not lock_acquired:
            print(
                "Could not acquire advisory lock — another migration runner is active. "
                "Exiting without changes.",
                file=sys.stderr,
            )
            return False

        files = migration_files(migrations_dir)
        if not files:
            print(f"No migration files found in {migrations_dir}", file=sys.stderr)
            return True

        if dry_run:
            print("DRY RUN — no writes will be made\n")

        all_ok = True
        for migration_id, path in files:
            try:
                tag, message = _step(conn, migration_id, path, dry_run, verbose)
            except Exception as exc:
                print(f"{migration_id}: ERROR — {exc}", file=sys.stderr)
                all_ok = False
                break

            print(f"{migration_id}: {message}")

            if tag == "blocked":
                print(
                    f"\nRun halted at {migration_id}. "
                    f"Migrations after this point were NOT attempted.",
                    file=sys.stderr,
                )
                all_ok = False
                break

        return all_ok
    finally:
        if lock_acquired:
            try:
                release_lock(conn)
            except Exception:
                pass
        if own_conn:
            try:
                conn.close()
            except Exception:
                pass


# ── CLI ───────────────────────────────────────────────────────────────────────

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__.splitlines()[0],
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--dry-run", action="store_true", help="Report only; no writes")
    parser.add_argument("--verbose", action="store_true", help="Print each SQL statement")
    args = parser.parse_args(argv)

    ok = run(dry_run=args.dry_run, verbose=args.verbose)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
