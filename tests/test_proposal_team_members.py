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
