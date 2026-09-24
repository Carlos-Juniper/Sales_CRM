"""Tests for migration 035 roster corrections against the live crm database.

Verifies that:
  - no active team_members rows have a name containing "Placeholder"
    (any such row would block proposal renders via proposal_validation.py)
  - Rodrigo Leon exists with the correct 'sales_rep' title
  - Michelle Cady has been updated to 'lead_sales_rep'
  - the two formerly-placeholder rows (tm-am-ftm-001, tm-pm-ftm-001) are inactive

These are integration tests that require a reachable MySQL crm database.
They are skipped when MySQL is not reachable, following the same pattern as
test_migrate.py's @requires_mysql guard.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))


# ── MySQL availability (live crm database) ─────────────────────────────────────

def _crm_reachable() -> bool:
    try:
        import pymysql
        conn = pymysql.connect(
            host=os.environ.get("MYSQL_HOST", "127.0.0.1"),
            port=int(os.environ.get("MYSQL_PORT", "3306")),
            user=os.environ.get("MYSQL_USER", "crmadmin"),
            password=os.environ.get("MYSQL_PASSWORD", ""),
            db=os.environ.get("MYSQL_DB", "crm"),
            connect_timeout=2,
            autocommit=True,
        )
        conn.close()
        return True
    except Exception:
        return False


requires_crm = pytest.mark.skipif(
    not _crm_reachable(),
    reason="live crm MySQL database not reachable",
)


@pytest.fixture
def db():
    """Yield a pymysql DictCursor-backed connection to the live crm database."""
    import pymysql
    import pymysql.cursors

    conn = pymysql.connect(
        host=os.environ.get("MYSQL_HOST", "127.0.0.1"),
        port=int(os.environ.get("MYSQL_PORT", "3306")),
        user=os.environ.get("MYSQL_USER", "crmadmin"),
        password=os.environ.get("MYSQL_PASSWORD", ""),
        db=os.environ.get("MYSQL_DB", "crm"),
        autocommit=True,
        cursorclass=pymysql.cursors.DictCursor,
    )
    yield conn
    conn.close()


# ── Tests ──────────────────────────────────────────────────────────────────────

@requires_crm
def test_no_active_placeholder_rows(db):
    """Migration 035 must deactivate placeholder rows — any active placeholder blocks renders.

    api/proposal_validation.py's _PLACEHOLDER_RE = re.compile(r'\\bplaceholder\\b', re.IGNORECASE)
    blocks any render that includes a team_members row whose name matches that pattern.
    """
    with db.cursor() as cur:
        cur.execute(
            "SELECT name FROM team_members "
            "WHERE active = 1 AND name REGEXP '(?i)placeholder'"
        )
        rows = cur.fetchall()
    assert len(rows) == 0, f"Active placeholder rows found: {[r['name'] for r in rows]}"


@requires_crm
def test_rodrigo_leon_has_correct_title(db):
    """Migration 035 §1: Rod Leon renamed to Rodrigo Leon with title='sales_rep'."""
    with db.cursor() as cur:
        cur.execute(
            "SELECT title FROM team_members "
            "WHERE name = 'Rodrigo Leon' AND active = 1"
        )
        rows = cur.fetchall()
    assert len(rows) == 1, (
        f"Expected exactly 1 active row for 'Rodrigo Leon', found {len(rows)}. "
        "Migration 035 §1 may not have been applied."
    )
    assert rows[0]["title"] == "sales_rep", (
        f"Expected title='sales_rep', got '{rows[0]['title']}'. "
        "Migration 035 §1 may not have been applied."
    )


@requires_crm
def test_michelle_cady_has_lead_sales_rep_title(db):
    """Migration 035 §2: Michelle Cady's title updated to 'lead_sales_rep'."""
    with db.cursor() as cur:
        cur.execute(
            "SELECT title FROM team_members "
            "WHERE name = 'Michelle Cady' AND active = 1"
        )
        rows = cur.fetchall()
    assert len(rows) == 1, (
        f"Expected exactly 1 active row for 'Michelle Cady', found {len(rows)}."
    )
    assert rows[0]["title"] == "lead_sales_rep", (
        f"Expected title='lead_sales_rep', got '{rows[0]['title']}'. "
        "Migration 035 §2 may not have been applied."
    )


@requires_crm
def test_crm_rep_placeholder_row_is_inactive(db):
    """Migration 035 §3: tm-am-ftm-001 (was 'CRM Rep Placeholder') must be inactive."""
    with db.cursor() as cur:
        cur.execute(
            "SELECT active FROM team_members WHERE id = 'tm-am-ftm-001'"
        )
        rows = cur.fetchall()
    assert len(rows) == 1, "Row tm-am-ftm-001 not found in team_members"
    assert rows[0]["active"] == 0, (
        f"tm-am-ftm-001 is still active={rows[0]['active']}. "
        "Migration 035 §3 may not have been applied."
    )


@requires_crm
def test_fort_myers_pm_placeholder_row_is_inactive(db):
    """Migration 035 §4: tm-pm-ftm-001 (was 'Fort Myers Production Manager') must be inactive."""
    with db.cursor() as cur:
        cur.execute(
            "SELECT active FROM team_members WHERE id = 'tm-pm-ftm-001'"
        )
        rows = cur.fetchall()
    assert len(rows) == 1, "Row tm-pm-ftm-001 not found in team_members"
    assert rows[0]["active"] == 0, (
        f"tm-pm-ftm-001 is still active={rows[0]['active']}. "
        "Migration 035 §4 may not have been applied."
    )


# ── Migration 058: user_branches twin-branch backfill ─────────────────────────
# Each manager must hold every aspire_branch_id touched by migration 058.
# The 13 distinct branch ids are the only ones asserted here; a broader check
# across all operating branches is xfail until data entry for remaining managers
# lands. (Gerich holds Tampa North's 3677; Rinard is 3691 only, matching live
# user_branches — so the 17 rows collapse to 13 distinct branch ids.)

_058_MANAGER_BRANCHES: list[tuple[str, str, list[int]]] = [
    # (user_id, display_name, [aspire_branch_id, ...])
    ("398230da-4334-4963-880c-a34ba16d5cbc", "Alberto Toucet",    [1403, 3696]),
    ("76692f5d-98d4-4b2c-9085-4a88b8b90ed0", "Brennen Garrett",   [1403, 3696]),
    ("5924d85f-4d3c-40ef-be08-c9c89f887b3c", "Diego Cantu",       [1374, 3684]),
    ("e8ebb236-0f8a-4223-85c3-07250109b4c3", "Todd Ruggles",      [1374, 3684]),
    ("58c9ac90-cbac-4cff-8ccc-98d7cd2ddaa0", "Eddie Tanguay",     [1402, 3698]),
    ("2bc19d99-7785-4ab4-9b13-10ff10f6fb25", "Matthew Gerich",    [3677, 3695]),
    ("768a600b-e92a-4055-bee0-06b8944b864b", "Garth Rinard",      [3691]),
    ("3c2bf1b9-e955-41dc-8e29-b2735aa58f5f", "Catarino Martinez", [3697]),
    ("1a1a09ae-3cfa-464f-a9d0-6a66861e5ef7", "Juan Nova",         [3663]),
    ("f85ff28d-e266-47d4-b4a5-9aabbe59f845", "Matt Hammond",      [1412]),
    ("8fa625b7-5e66-48e6-81f9-66acc4da4e06", "Roger Kelley",      [3671]),
]

# All distinct branch ids touched by migration 058.
_058_ALL_BRANCH_IDS: list[int] = sorted(
    {bid for _, _, bids in _058_MANAGER_BRANCHES for bid in bids}
)


@requires_crm
def test_migration_058_all_manager_user_branches_rows_present(db):
    """Each of the 11 managers must hold every branch id listed in migration 058
    in the user_branches table (idempotent; safe to assert after partial apply).
    """
    with db.cursor() as cur:
        cur.execute(
            "SELECT user_id, aspire_branch_id FROM user_branches"
        )
        all_rows = cur.fetchall()

    by_user: dict[str, set[int]] = {}
    for r in all_rows:
        by_user.setdefault(r["user_id"], set()).add(r["aspire_branch_id"])

    missing: list[str] = []
    for user_id, name, branch_ids in _058_MANAGER_BRANCHES:
        held = by_user.get(user_id, set())
        absent = [b for b in branch_ids if b not in held]
        if absent:
            missing.append(f"{name} ({user_id}): missing {absent}")

    assert not missing, (
        "Migration 058 incomplete — the following managers are missing user_branches rows:\n"
        + "\n".join(missing)
    )


@requires_crm
def test_migration_058_each_branch_has_at_least_one_manager(db):
    """Each distinct branch id touched by migration 058 must return at least one
    team_members row under the get_proposal_team_members WHERE clause (direct
    match OR user_branches subquery). Limited to the 13 ids migration 058 touches.
    """
    with db.cursor() as cur:
        no_coverage: list[int] = []
        for branch_id in _058_ALL_BRANCH_IDS:
            cur.execute(
                """
                SELECT COUNT(*) AS cnt
                  FROM team_members
                 WHERE active = 1
                   AND (
                         aspire_branch_id = %s
                      OR aspire_branch_id IS NULL
                      OR user_id IN (
                             SELECT user_id FROM user_branches
                              WHERE aspire_branch_id = %s
                         )
                   )
                """,
                (branch_id, branch_id),
            )
            row = cur.fetchone()
            if not row or int(row["cnt"]) == 0:
                no_coverage.append(branch_id)

    assert not no_coverage, (
        f"Branches with no active team_members under the A.6 WHERE clause: {no_coverage}. "
        "Migration 058 may not have been applied."
    )
