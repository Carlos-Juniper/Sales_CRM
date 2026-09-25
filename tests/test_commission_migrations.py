"""Detectors and SQL for commission migrations 065 and 066."""
from __future__ import annotations

import scripts.migrate as M


class TestMigration065:
    def test_detector_registered_and_keys_on_own_effects(self, monkeypatch):
        assert M._DETECT["065_commission_cadence_and_plans"] is M.detect_065

        def boom(*_args, **_kwargs):
            raise AssertionError("detector queried before schema was present")

        monkeypatch.setattr(M, "_fetch_one", boom)
        monkeypatch.setattr(M, "table_exists", lambda conn, name: False)
        monkeypatch.setattr(M, "column_exists", lambda conn, table, column: True)
        monkeypatch.setattr(M, "index_exists", lambda conn, table, index: True)
        assert M.detect_065(None) is False

        monkeypatch.setattr(M, "table_exists", lambda conn, name: True)
        monkeypatch.setattr(
            M, "column_exists",
            lambda conn, table, column: not (table == "commissions" and column == "plan_key"),
        )
        assert M.detect_065(None) is False

        monkeypatch.setattr(
            M, "column_exists",
            lambda conn, table, column: not (
                table == "commission_plan_rules" and column == "payout_schedule"
            ),
        )
        assert M.detect_065(None) is False

        monkeypatch.setattr(M, "column_exists", lambda conn, table, column: True)
        monkeypatch.setattr(
            M, "table_exists",
            lambda conn, name: name != "v_current_commission_plans",
        )
        assert M.detect_065(None) is False

        monkeypatch.setattr(M, "table_exists", lambda conn, name: True)
        monkeypatch.setattr(
            M, "column_exists",
            lambda conn, table, column: not (
                table == "commissions" and column == "contract_start_date"
            ),
        )
        assert M.detect_065(None) is False

        monkeypatch.setattr(M, "column_exists", lambda conn, table, column: True)
        monkeypatch.setattr(
            M, "index_exists",
            lambda conn, table, index: index != "uq_commission_installment",
        )
        assert M.detect_065(None) is False

    def test_detector_requires_seed_and_complete_backfill(self, monkeypatch):
        monkeypatch.setattr(M, "table_exists", lambda conn, name: True)
        monkeypatch.setattr(M, "column_exists", lambda conn, table, column: True)
        monkeypatch.setattr(M, "index_exists", lambda conn, table, index: True)
        state = {"maint": 1, "install": 1, "missing": 0}

        def fetch(_conn, sql, params=()):
            if "first_year_revenue" in sql:
                return {"cnt": state["maint"]}
            if "client_type = 'new'" in sql:
                return {"cnt": state["install"]}
            if "enhancement" in sql:
                raise AssertionError("enhancement seed is not part of detect_065")
            if "installment_number = 1" in sql:
                return {"cnt": state["missing"]}
            raise AssertionError(sql)

        monkeypatch.setattr(M, "_fetch_one", fetch)
        assert M.detect_065(None) is True

        state["maint"] = 0
        assert M.detect_065(None) is False
        state["maint"] = 1
        state["install"] = 0
        assert M.detect_065(None) is False
        state["install"] = 1
        state["missing"] = 3
        assert M.detect_065(None) is False
        state["missing"] = 0
        assert M.detect_065(None) is True

    def test_sql_alters_only_commissions_and_ignores_existing_installments(self):
        path = M.MIGRATIONS_DIR / "065_commission_cadence_and_plans.sql"
        sql = path.read_text()
        upper = sql.upper()
        assert "CREATE TABLE IF NOT EXISTS" in upper
        assert "ON DUPLICATE KEY UPDATE" in upper
        assert "INSERT INTO COMMISSION_PLANS" in upper
        assert "INSERT INTO COMMISSION_PLAN_RULES" in upper
        assert "INSERT INTO USER_COMMISSION_PLANS" not in upper
        assert "INSERT IGNORE INTO USER_COMMISSION_PLANS" not in upper
        assert "INSERT INTO COMMISSION_RATES" not in upper
        assert "UPDATE COMMISSION_RATES" not in upper
        assert "'maintenance_3_payment'" in sql
        assert "'construction_billing_quarterly'" in sql
        assert "enhancement_month_after_quarter" not in sql
        assert "rule-standard-enh" not in sql
        assert "0.01500" not in sql
        assert "Deferred until the Enhancement sale type exists" in sql
        assert "55 percent" in sql
        assert "50 percent" in sql
        assert "45 percent" in sql
        assert "pending_billing_data" in sql
        assert "commission_billing_events" in sql
        assert "contract_start_date" in sql
        assert "billing_installment_number" in sql
        assert "collected_amount_cents" in sql
        assert "INSERT INTO COMMISSION_BILLING_EVENTS" not in upper
        assert "COALESCE(e.estimate_type, '') = 'maintenance'" in sql
        assert "COALESCE(e.estimate_type, '') <> 'maintenance'" in sql
        assert "SELECT 3" in upper
        assert "0.03000" in sql
        assert "0.00400" in sql
        assert "0.00800" in sql
        assert "0.01200" in sql
        assert "0.00000" in sql
        assert "100000000" in sql
        assert "200000000" in sql
        assert "300000000" in sql
        assert "first_year_revenue" in sql
        assert "calendar_year_cumulative_revenue" in sql
        assert "v_current_commission_plans" in sql
        assert "CREATE OR REPLACE VIEW v_current_commission_plans" in sql
        stmts = M.split_statements(sql)
        joined = "\n".join(stmts).upper()
        assert "DELETE" not in joined
        assert "INFORMATION_SCHEMA" not in joined
        assert "PREPARE" not in joined
        assert "INSERT IGNORE INTO COMMISSION_INSTALLMENTS" in joined
        alters = [stmt for stmt in stmts if stmt.split()[0].upper() == "ALTER"]
        assert len(alters) == 3
        assert all(stmt.upper().startswith("ALTER TABLE COMMISSIONS ") for stmt in alters)
        assert any("PLAN_KEY" in stmt.upper() for stmt in alters)
        assert any("CLIENT_TYPE" in stmt.upper() for stmt in alters)
        assert any("CONTRACT_START_DATE" in stmt.upper() for stmt in alters)


class TestMigration066:
    def test_detector_registered(self):
        assert M._DETECT["066_assign_standard_commission_plan"] is M.detect_066
        assert not hasattr(M, "warn_066_name_matches")
        assert not hasattr(M, "_SALES_ROLES_066")
        assert not hasattr(M, "_roles_sql_066")

    def test_sql_matches_exact_names_and_aborts_when_unresolved(self):
        sql = (M.MIGRATIONS_DIR / "066_assign_standard_commission_plan.sql").read_text()
        upper = sql.upper()
        assert "2026-09-25" in sql
        assert "LOWER(TRIM(name)) = 'michelle cady'" in sql
        assert "LOWER(TRIM(name)) = 'rodrigo leon'" in sql
        assert "LIKE" not in upper
        assert "vp_sales" not in sql
        assert "067" not in sql
        assert "inside_sales" in sql
        assert "outside_sales" in sql
        assert "maintenance_sales" in sql
        assert "install_sales" in sql
        assert "'sales'" in sql
        assert "066_abort_cady_" in sql
        assert "INSERT IGNORE INTO user_commission_plans" in sql
        assert "commission_migration_markers" in sql
        assert "066_assign_standard_commission_plan" in sql
        assert "NOT EXISTS" in upper
        assert "DELETE" not in upper
        executable = "\n".join(M.split_statements(sql))
        assert "commission_rates" not in executable
        first = [stmt.split()[0].upper() for stmt in M.split_statements(sql)]
        assert first == [
            "SET", "SET", "SET", "PREPARE", "EXECUTE", "DEALLOCATE",
            "INSERT", "CREATE", "INSERT",
        ]

    def test_detector_keys_on_the_marker_not_current_assignments(self, monkeypatch):
        monkeypatch.setattr(M, "table_exists", lambda conn, name: False)

        def boom(*_args, **_kwargs):
            raise AssertionError("detector queried before the marker table existed")

        monkeypatch.setattr(M, "_fetch_one", boom)
        assert M.detect_066(None) is False

        monkeypatch.setattr(
            M, "table_exists",
            lambda conn, name: name == "commission_migration_markers",
        )
        seen = {"cnt": 1}

        def fetch(_conn, sql, params=()):
            assert "commission_migration_markers" in sql
            assert "user_commission_plans" not in sql
            assert params == (M._MARKER_066,)
            return {"cnt": seen["cnt"]}

        monkeypatch.setattr(M, "_fetch_one", fetch)
        assert M.detect_066(None) is True
        seen["cnt"] = 0
        assert M.detect_066(None) is False

    def test_step_does_not_special_case_066(self, monkeypatch):
        monkeypatch.setattr(M, "get_tracked", lambda conn, mid: None)
        monkeypatch.setattr(M, "table_exists", lambda conn, name: False)
        tag, message = M._step(
            None,
            "066_assign_standard_commission_plan",
            M.MIGRATIONS_DIR / "066_assign_standard_commission_plan.sql",
            dry_run=True,
            verbose=False,
        )
        assert tag == "ok"
        assert message == "will-apply"
