"""Detectors and SQL for commission migrations 065 and 066."""
from __future__ import annotations

import os

import pytest

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

    def test_detector_requires_seeds_not_installment_counts(self, monkeypatch):
        """A commission with zero installments does not flip detect_065."""
        monkeypatch.setattr(M, "table_exists", lambda conn, name: True)
        monkeypatch.setattr(M, "column_exists", lambda conn, table, column: True)
        monkeypatch.setattr(M, "index_exists", lambda conn, table, index: True)
        state = {"maint": 1, "install": 1}

        def fetch(_conn, sql, params=()):
            if "commission_installments" in sql:
                raise AssertionError("detect_065 must not count installments")
            if "first_year_revenue" in sql:
                return {"cnt": state["maint"]}
            if "client_type = 'new'" in sql:
                return {"cnt": state["install"]}
            if "enhancement" in sql:
                raise AssertionError("enhancement seed is not part of detect_065")
            raise AssertionError(sql)

        monkeypatch.setattr(M, "_fetch_one", fetch)
        assert M.detect_065(None) is True

        state["maint"] = 0
        assert M.detect_065(None) is False
        state["maint"] = 1
        state["install"] = 0
        assert M.detect_065(None) is False
        state["install"] = 1
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

    def test_step_dry_run_still_will_apply(self, monkeypatch):
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

    def test_step_returns_blocked_when_name_guard_aborts(self, monkeypatch):
        """A count mismatch is blocked, not a warning that lets the run continue."""
        monkeypatch.setattr(M, "get_tracked", lambda conn, mid: None)
        monkeypatch.setattr(M, "detect_066", lambda conn: False)

        def boom(_conn, _path, verbose=False):
            raise RuntimeError(
                "Table 'crm.066_abort_cady_0_leon_2' doesn't exist"
            )

        monkeypatch.setattr(M, "exec_file", boom)
        tag, message = M._step(
            None,
            "066_assign_standard_commission_plan",
            M.MIGRATIONS_DIR / "066_assign_standard_commission_plan.sql",
            dry_run=False,
            verbose=False,
        )
        assert tag == "blocked"
        assert "BLOCKED" in message
        assert "066_abort_cady_0_leon_2" in message

    def test_step_does_not_swallow_other_066_errors(self, monkeypatch):
        monkeypatch.setattr(M, "get_tracked", lambda conn, mid: None)
        monkeypatch.setattr(M, "detect_066", lambda conn: False)

        def boom(_conn, _path, verbose=False):
            raise RuntimeError("disk full")

        monkeypatch.setattr(M, "exec_file", boom)
        with pytest.raises(RuntimeError, match="disk full"):
            M._step(
                None,
                "066_assign_standard_commission_plan",
                M.MIGRATIONS_DIR / "066_assign_standard_commission_plan.sql",
                dry_run=False,
                verbose=False,
            )


class TestMigration065Gate:
    def test_gate_is_zero_before_the_installment_table_exists(self, monkeypatch):
        monkeypatch.setattr(M, "table_exists", lambda conn, name: False)

        def boom(*_args, **_kwargs):
            raise AssertionError("gate queried before commission_installments existed")

        monkeypatch.setattr(M, "_fetch_one", boom)
        assert M.check_065_gate(None) == 0

    def test_gate_counts_billing_or_payment_rows(self, monkeypatch):
        monkeypatch.setattr(M, "table_exists", lambda conn, name: True)
        monkeypatch.setattr(M, "column_exists", lambda conn, table, column: True)
        seen = {}

        def fetch(_conn, sql, params=()):
            seen["sql"] = sql
            return {"cnt": 4}

        monkeypatch.setattr(M, "_fetch_one", fetch)
        assert M.check_065_gate(None) == 4
        assert "collected_amount_cents IS NOT NULL" in seen["sql"]
        assert "billing_installment_number IS NOT NULL" in seen["sql"]
        assert "paid_at IS NOT NULL" in seen["sql"]

    def test_step_blocks_when_installments_already_have_billing_data(self, monkeypatch):
        monkeypatch.setattr(M, "get_tracked", lambda conn, mid: None)
        monkeypatch.setattr(M, "detect_065", lambda conn: False)
        monkeypatch.setattr(M, "check_065_gate", lambda conn: 2)
        applied = {"n": 0}

        def boom(*_args, **_kwargs):
            applied["n"] += 1
            raise AssertionError("065 must not execute when the gate is open")

        monkeypatch.setattr(M, "exec_file", boom)
        tag, message = M._step(
            None,
            "065_commission_cadence_and_plans",
            M.MIGRATIONS_DIR / "065_commission_cadence_and_plans.sql",
            dry_run=False,
            verbose=False,
        )
        assert tag == "blocked"
        assert "BLOCKED" in message
        assert "2 commission installment" in message
        assert applied["n"] == 0

    def test_step_applies_when_the_gate_is_clear(self, monkeypatch):
        monkeypatch.setattr(M, "get_tracked", lambda conn, mid: None)
        monkeypatch.setattr(M, "detect_065", lambda conn: False)
        monkeypatch.setattr(M, "check_065_gate", lambda conn: 0)
        tag, message = M._step(
            None,
            "065_commission_cadence_and_plans",
            M.MIGRATIONS_DIR / "065_commission_cadence_and_plans.sql",
            dry_run=True,
            verbose=False,
        )
        assert tag == "ok"
        assert message == "will-apply"


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


def _drop_all(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT table_name AS t, table_type AS kind FROM information_schema.tables "
            "WHERE table_schema = DATABASE()"
        )
        rows = list(cur.fetchall())
        cur.execute("SET FOREIGN_KEY_CHECKS = 0")
        for row in rows:
            kind = "VIEW" if row["kind"] == "VIEW" else "TABLE"
            cur.execute(f"DROP {kind} IF EXISTS `{row['t']}`")
        cur.execute("SET FOREIGN_KEY_CHECKS = 1")


_MIN_SCHEMA = """
CREATE TABLE users (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL,
    avatar_initials VARCHAR(5) NOT NULL DEFAULT ''
);
CREATE TABLE leads (
    id VARCHAR(36) NOT NULL PRIMARY KEY
);
CREATE TABLE estimates (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    estimate_type ENUM('maintenance','install') NOT NULL,
    service_start_date DATE NULL
);
CREATE TABLE commissions (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    estimate_id VARCHAR(36) NOT NULL,
    lead_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    contract_value_cents BIGINT NOT NULL,
    commission_rate DECIMAL(6,5) NOT NULL,
    commission_amount_cents BIGINT NOT NULL,
    status ENUM('approved','paid','cancelled') NOT NULL DEFAULT 'approved',
    paid_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (estimate_id) REFERENCES estimates (id),
    FOREIGN KEY (lead_id) REFERENCES leads (id),
    FOREIGN KEY (user_id) REFERENCES users (id)
);
"""


@pytest.fixture
def mysql_conn():
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
    _drop_all(conn)
    with conn.cursor() as cur:
        for stmt in M.split_statements(_MIN_SCHEMA):
            cur.execute(stmt)
    yield conn
    _drop_all(conn)
    conn.close()


@requires_mysql
class TestCommissionMigrationsOnMysql:
    def test_065_and_066_apply_and_reapply_leaves_paid_installments(self, mysql_conn):
        """Execute 065 and 066 against MySQL.

        Re-applying the installment backfill leaves paid installments 2 and 3
        untouched. A name-count mismatch makes _step return blocked.
        """
        conn = mysql_conn
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO users (id, name, email, role, avatar_initials) VALUES "
                "('u-cady', 'Michelle Cady', 'cady@example.com', 'sales', 'MC'),"
                "('u-leon', 'Rodrigo Leon', 'leon@example.com', 'sales', 'RL'),"
                "('u-alex', 'Alex Sales', 'alex@example.com', 'inside_sales', 'AS')"
            )
            cur.execute("INSERT INTO leads (id) VALUES ('lead-1')")
            cur.execute(
                "INSERT INTO estimates (id, estimate_type, service_start_date) "
                "VALUES ('est-m', 'maintenance', '2026-02-01')"
            )
            cur.execute(
                "INSERT INTO commissions ("
                "id, estimate_id, lead_id, user_id, contract_value_cents, "
                "commission_rate, commission_amount_cents, status, created_at"
                ") VALUES ("
                "'comm-m', 'est-m', 'lead-1', 'u-alex', 100000, 0.03000, 300, "
                "'approved', '2026-02-10 16:00:00')"
            )

        M.exec_file(conn, M.MIGRATIONS_DIR / "065_commission_cadence_and_plans.sql")
        with conn.cursor() as cur:
            cur.execute(
                "SELECT installment_number, status, amount_cents "
                "FROM commission_installments WHERE commission_id = 'comm-m' "
                "ORDER BY installment_number"
            )
            created = cur.fetchall()
        assert [row["installment_number"] for row in created] == [1, 2, 3]
        assert created[1]["status"] == "pending_billing_data"
        assert created[2]["status"] == "pending_billing_data"

        with conn.cursor() as cur:
            cur.execute(
                "UPDATE commission_installments SET "
                "status = 'paid', amount_cents = 111, collected_amount_cents = 222, "
                "paid_at = '2026-08-01 15:00:00', payout_period_label = 'KEEP', "
                "billing_installment_number = 99 "
                "WHERE commission_id = 'comm-m' AND installment_number IN (2, 3)"
            )
        backfill = [
            stmt for stmt in M.split_statements(
                (M.MIGRATIONS_DIR / "065_commission_cadence_and_plans.sql").read_text()
            )
            if "INSERT IGNORE INTO commission_installments" in stmt
        ]
        assert len(backfill) == 2
        M.exec_statements(conn, backfill)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT installment_number, status, amount_cents, collected_amount_cents, "
                "payout_period_label, billing_installment_number, paid_at "
                "FROM commission_installments WHERE commission_id = 'comm-m' "
                "AND installment_number IN (2, 3) ORDER BY installment_number"
            )
            kept = cur.fetchall()
        assert len(kept) == 2
        for row in kept:
            assert row["status"] == "paid"
            assert int(row["amount_cents"]) == 111
            assert int(row["collected_amount_cents"]) == 222
            assert row["payout_period_label"] == "KEEP"
            assert int(row["billing_installment_number"]) == 99
            assert str(row["paid_at"]).startswith("2026-08-01 15:00:00")

        M.exec_file(conn, M.MIGRATIONS_DIR / "066_assign_standard_commission_plan.sql")
        M.exec_file(conn, M.MIGRATIONS_DIR / "066_assign_standard_commission_plan.sql")
        with conn.cursor() as cur:
            cur.execute(
                "SELECT u.name FROM user_commission_plans p "
                "JOIN users u ON u.id = p.user_id ORDER BY u.name"
            )
            assigned = [row["name"] for row in cur.fetchall()]
        assert assigned == ["Alex Sales"]

        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO users (id, name, email, role, avatar_initials) VALUES "
                "('u-cady-2', 'Michelle Cady', 'cady2@example.com', 'sales', 'M2')"
            )
            cur.execute("DELETE FROM commission_migration_markers")
        tag, message = M._step(
            conn,
            "066_assign_standard_commission_plan",
            M.MIGRATIONS_DIR / "066_assign_standard_commission_plan.sql",
            dry_run=False,
            verbose=False,
        )
        assert tag == "blocked", message
        assert "BLOCKED" in message
        assert "066_abort_cady_" in message
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) AS cnt FROM user_commission_plans")
            assert int(cur.fetchone()["cnt"]) == 1
