"""Verify the SQL content and structure of 029_real_proposal_seed_data.sql.

Slice C1 (Handoff 46 §5): migration 029 replaces the placeholder proposal seed
data shipped by 015. There is no test database in CI, so — following the
precedent of TestMigration022File in test_migrate.py — these tests read the
migration SQL text and assert on its content rather than connecting to MySQL.

What 029 must do (Handoff 46 §5 + Handoff 45 §4.10):
  5.1  delete the invented founder-bio executive row (tm-exec-ceo-001)
  5.2  clear the 'CRM Rep Placeholder' team-member name
  5.3  clear the 'Fort Myers Production Manager' team-member name
  5.4  delete the two mock 555-01xx client references and seed three real ones
  5.5  the Michelle Cady mock reference (cr-001) is removed by 5.4's delete
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

import scripts.migrate as M  # noqa: E402

MIGRATION = REPO / "sql" / "migrations" / "029_real_proposal_seed_data.sql"

# Referees whose contact_name must appear in the seed (Handoff 45 §4.10).
_REAL_REFEREES = ("Brett Beaver", "Billie Parker", "Vania Peal")

# The two fictional numbers that must be deleted and must never be re-seeded.
_MOCK_PHONES = ("(561) 555-0100", "(239) 555-0142")


def _sql() -> str:
    return MIGRATION.read_text(encoding="utf-8")


class TestMigration029File:
    def test_file_exists(self):
        assert MIGRATION.exists(), "029_real_proposal_seed_data.sql must exist"

    def test_discovered_by_migration_files(self):
        """029 is auto-discovered by the migration_files() glob."""
        ids = [mid for mid, _ in M.migration_files()]
        assert "029_real_proposal_seed_data" in ids

    def test_registered_in_detect_dispatch(self):
        """Every migration file needs a detection path; 029 uses detect_029."""
        assert "029_real_proposal_seed_data" in M._DETECT
        assert M._DETECT["029_real_proposal_seed_data"] is M.detect_029

    def test_does_not_edit_migration_015(self):
        """029 must never rewrite 015 — it is a separate corrective migration."""
        sql = _sql().upper()
        assert "015_SEED_PROPOSAL_CONFIG" not in sql or "-- " in _sql(), (
            "015 may only be referenced in a comment, never executed"
        )

    def test_deletes_invented_founder_bio_row(self):
        """5.1 — the executive row with the fabricated bio is removed."""
        sql = _sql()
        assert re.search(
            r"DELETE\s+FROM\s+`?team_members`?\s+WHERE\s+id\s*=\s*'tm-exec-ceo-001'",
            sql,
            re.IGNORECASE,
        ), "029 must DELETE the tm-exec-ceo-001 executive placeholder row"

    def test_clears_crm_rep_placeholder_name(self):
        """5.2 — 'CRM Rep Placeholder' name is nulled, not left rendering."""
        sql = _sql()
        assert "CRM Rep Placeholder" in sql
        assert re.search(
            r"UPDATE\s+`?team_members`?\s+SET\s+name\s*=\s*''",
            sql,
            re.IGNORECASE,
        ), "029 must UPDATE team_members SET name = '' for the placeholder"

    def test_clears_fort_myers_production_manager_name(self):
        """5.3 — the job-title-as-name placeholder is nulled; row stays active."""
        sql = _sql()
        assert "Fort Myers Production Manager" in sql
        # Row is cleared, never deleted (null-user row is permanent by design).
        assert not re.search(
            r"DELETE\s+FROM\s+`?team_members`?\s+WHERE\s+id\s*=\s*'tm-pm-ftm-001'",
            sql,
            re.IGNORECASE,
        ), "the production-manager row must be kept (name cleared), not deleted"

    def test_deletes_both_mock_client_references(self):
        """5.4/5.5 — both fictional 555 references are deleted."""
        sql = _sql()
        for phone in _MOCK_PHONES:
            assert phone in sql, f"{phone} must be targeted for deletion"
        assert re.search(
            r"DELETE\s+FROM\s+`?client_references`?", sql, re.IGNORECASE
        ), "029 must DELETE from client_references"

    def test_no_555_number_is_ever_inserted(self):
        """No 555-01xx phone may survive: only DELETEs may mention them."""
        for stmt in M.split_statements(_sql()):
            if stmt.strip().upper().startswith("INSERT"):
                assert not re.search(r"555-01\d\d", stmt), (
                    f"INSERT must not contain a fictional 555-01xx phone: {stmt[:80]}"
                )

    def test_three_real_referees_are_inserted(self):
        """5.4 — Brett Beaver, Billie Parker, and Vania Peal are all seeded."""
        sql = _sql()
        for name in _REAL_REFEREES:
            assert name in sql, f"real referee {name!r} missing from 029"

    def test_real_referees_carry_real_phone_numbers(self):
        """The three real phone numbers from §4.10 are present."""
        sql = _sql()
        for phone in ("206-206-3000", "239-513-0045", "239-237-2952"):
            assert phone in sql, f"real referee phone {phone} missing from 029"

    def test_inserts_are_insert_ignore_for_idempotency(self):
        """Seed INSERTs must be INSERT IGNORE so the migration is re-runnable."""
        for stmt in M.split_statements(_sql()):
            head = stmt.strip().upper()
            if head.startswith("INSERT"):
                assert head.startswith("INSERT IGNORE"), (
                    f"seed INSERT must be INSERT IGNORE: {stmt[:60]}"
                )

    def test_only_data_dml_statements(self):
        """029 is data-only: every statement is DELETE, UPDATE, or INSERT."""
        stmts = M.split_statements(_sql())
        assert len(stmts) >= 4, "expect deletes, updates, and the seed insert(s)"
        for stmt in stmts:
            first_word = stmt.strip().split()[0].upper()
            assert first_word in ("DELETE", "UPDATE", "INSERT"), (
                f"unexpected non-DML statement in 029: {stmt[:60]}"
            )
