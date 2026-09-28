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
        monkeypatch.setattr(M, "view_exists", lambda conn, name: False)
        monkeypatch.setattr(M, "column_exists", lambda conn, table, column: True)
        monkeypatch.setattr(M, "index_exists", lambda conn, table, index: True)
        assert M.detect_065(None) is False

        monkeypatch.setattr(M, "table_exists", lambda conn, name: True)
        monkeypatch.setattr(
            M, "column_exists",
            lambda conn, table, column: not (table == "commissions" and column == "plan_key"),
        )
        assert M.detect_065(None) is False

        monkeypatch.setattr(M, "column_exists", lambda conn, table, column: True)
        monkeypatch.setattr(M, "table_exists", lambda conn, name: True)
        monkeypatch.setattr(M, "view_exists", lambda conn, name: False)
        assert M.detect_065(None) is False
        monkeypatch.setattr(M, "view_exists", lambda conn, name: True)

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
        monkeypatch.setattr(M, "view_exists", lambda conn, name: True)
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
        assert "maintenance_3_payment" in sql
        assert "construction_billing_quarterly" in sql
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
        assert "payout_schedule" not in sql
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
        view_stmts = [
            stmt for stmt in M.split_statements(sql)
            if "v_current_commission_plans" in stmt
        ]
        assert len(view_stmts) == 1
        assert view_stmts[0].lstrip().upper().startswith("CREATE OR REPLACE VIEW")
        assert "WHERE rn = 1" in view_stmts[0]
        stmts = M.split_statements(sql)
        joined = "\n".join(stmts).upper()
        assert "DELETE" not in joined
        assert "INSERT IGNORE INTO COMMISSION_INSTALLMENTS" not in joined
        assert "INSERT INTO COMMISSION_INSTALLMENTS" not in joined
        assert "information_schema.columns" in sql
        assert sum(1 for line in sql.splitlines() if line.startswith("PREPARE stmt_")) == 3
        for column in ("plan_key", "client_type", "contract_start_date"):
            assert f"ADD COLUMN {column}" in sql
        assert not any(stmt.split()[0].upper() == "ALTER" for stmt in stmts)


class TestMigration065Ordinary:
    def test_no_special_case_helpers(self):
        assert not hasattr(M, "check_065_gate")
        assert not hasattr(M, "_ensure_current_plan_view")
        assert not hasattr(M, "detect_066")
        assert "066_assign_standard_commission_plan" not in M._DETECT

    def test_step_dry_run_will_apply(self, monkeypatch):
        monkeypatch.setattr(M, "get_tracked", lambda conn, mid: None)
        monkeypatch.setitem(M._DETECT, "065_commission_cadence_and_plans", lambda conn: False)
        tag, message = M._step(
            None,
            "065_commission_cadence_and_plans",
            M.MIGRATIONS_DIR / "065_commission_cadence_and_plans.sql",
            dry_run=True,
            verbose=False,
        )
        assert tag == "ok"
        assert message == "will-apply"

    def test_tracked_065_warns_once_and_does_not_rerun(self, monkeypatch, capsys):
        monkeypatch.setattr(
            M, "get_tracked",
            lambda conn, mid: {"checksum": "stale", "detected": 0},
        )

        def forbid(*_args, **_kwargs):
            raise AssertionError("tracked 065 must not re-run")

        monkeypatch.setattr(M, "apply_065", forbid)
        monkeypatch.setattr(M, "exec_file", forbid)
        tag, message = M._step(
            None,
            "065_commission_cadence_and_plans",
            M.MIGRATIONS_DIR / "065_commission_cadence_and_plans.sql",
            dry_run=False,
            verbose=False,
        )
        assert tag == "ok"
        assert "already-applied" in message
        assert capsys.readouterr().err.count("checksum mismatch") == 1

    def test_untracked_step_calls_apply_065(self, monkeypatch):
        monkeypatch.setattr(M, "get_tracked", lambda conn, mid: None)
        monkeypatch.setitem(M._DETECT, "065_commission_cadence_and_plans", lambda conn: False)
        seen = {}

        def apply(_conn, _path, verbose=False):
            seen["apply"] = True

        monkeypatch.setattr(M, "apply_065", apply)
        monkeypatch.setattr(M, "record_migration", lambda *args, **kwargs: seen.setdefault("recorded", True))
        tag, message = M._step(
            None,
            "065_commission_cadence_and_plans",
            M.MIGRATIONS_DIR / "065_commission_cadence_and_plans.sql",
            dry_run=False,
            verbose=False,
        )
        assert tag == "ok"
        assert message == "applied"
        assert seen == {"apply": True, "recorded": True}


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
    def test_065_apply_backfill_and_reapply_leaves_paid_installments(self, mysql_conn):
        """065 creates the view and installments. A second backfill leaves paid rows.

        The schema file is safe to execute twice. Assigning people is the
        one-off script, not a migration.
        """
        from scripts.assign_standard_commission_plan import assign

        conn = mysql_conn
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO users (id, name, email, role, avatar_initials) VALUES "
                "('u-cady', 'Michelle Cady', 'cady@example.com', 'sales', 'MC'),"
                "('u-leon', 'Rodrigo Leon', 'leon@example.com', 'vp_sales', 'RL'),"
                "('u-alex', 'Alex Sales', 'alex@example.com', 'inside_sales', 'AS')"
            )
            cur.execute("INSERT INTO leads (id) VALUES ('lead-1')")
            cur.execute(
                "INSERT INTO estimates (id, estimate_type, service_start_date) VALUES "
                "('est-m', 'maintenance', '2026-02-01'),"
                "('est-i', 'install', NULL)"
            )
            cur.execute(
                "INSERT INTO commissions ("
                "id, estimate_id, lead_id, user_id, contract_value_cents, "
                "commission_rate, commission_amount_cents, status, created_at"
                ") VALUES ("
                "'comm-m', 'est-m', 'lead-1', 'u-alex', 100000, 0.03000, 300, "
                "'approved', '2026-02-10 16:00:00'),"
                "('comm-i', 'est-i', 'lead-1', 'u-cady', 100000, 0.00400, 400, "
                "'approved', '2026-02-10 16:00:00')"
            )

        M.apply_065(conn, M.MIGRATIONS_DIR / "065_commission_cadence_and_plans.sql")
        M.exec_file(conn, M.MIGRATIONS_DIR / "065_commission_cadence_and_plans.sql")
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) AS cnt FROM information_schema.VIEWS "
                "WHERE TABLE_SCHEMA = DATABASE() "
                "AND TABLE_NAME = 'v_current_commission_plans'"
            )
            assert int(cur.fetchone()["cnt"]) == 1
            cur.execute(
                "SELECT installment_number, status, amount_cents, payout_date, "
                "payout_period_label, billing_installment_number "
                "FROM commission_installments WHERE commission_id = 'comm-m' "
                "ORDER BY installment_number"
            )
            created = cur.fetchall()
            cur.execute(
                "SELECT installment_number, status, amount_cents, payout_date "
                "FROM commission_installments WHERE commission_id = 'comm-i'"
            )
            install_rows = cur.fetchall()
        assert [row["installment_number"] for row in created] == [1, 2, 3]
        assert created[0]["status"] == "scheduled"
        assert str(created[0]["payout_date"]) == "2026-03-31"
        assert created[0]["payout_period_label"] == "March 2026"
        assert int(created[0]["amount_cents"]) == 150
        assert created[1]["status"] == "pending_billing_data"
        assert int(created[1]["billing_installment_number"]) == 6
        assert created[2]["status"] == "pending_billing_data"
        assert int(created[2]["billing_installment_number"]) == 12
        assert len(install_rows) == 1
        assert install_rows[0]["status"] == "pending_billing_data"
        assert install_rows[0]["amount_cents"] is None
        assert install_rows[0]["payout_date"] is None

        with conn.cursor() as cur:
            cur.execute(
                "UPDATE commission_installments SET "
                "status = 'paid', amount_cents = 111, collected_amount_cents = 222, "
                "paid_at = '2026-08-01 15:00:00', payout_period_label = 'KEEP', "
                "billing_installment_number = 99 "
                "WHERE commission_id = 'comm-m' AND installment_number IN (2, 3)"
            )
        M.backfill_065_installments(conn)
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

        preview = assign(
            conn, dry_run=True, exclude_user_ids=["u-cady", "u-leon"],
        )
        assert [row["name"] for row in preview.assigned] == ["Alex Sales"]
        assert [(row["id"], row["name"], row["role"]) for row in preview.excluded] == [
            ("u-cady", "Michelle Cady", "sales"),
            ("u-leon", "Rodrigo Leon", "vp_sales"),
        ]
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) AS cnt FROM user_commission_plans")
            assert int(cur.fetchone()["cnt"]) == 0
        assigned = assign(
            conn, dry_run=False, exclude_user_ids=["u-cady", "u-leon"],
        )
        assert [row["name"] for row in assigned.assigned] == ["Alex Sales"]
        assert [row["id"] for row in assigned.excluded] == ["u-cady", "u-leon"]
        again = assign(
            conn, dry_run=False, exclude_user_ids=["u-cady", "u-leon"],
        )
        assert again.assigned == []
        with conn.cursor() as cur:
            cur.execute(
                "SELECT u.name FROM user_commission_plans p "
                "JOIN users u ON u.id = p.user_id ORDER BY u.name"
            )
            names = [row["name"] for row in cur.fetchall()]
        assert names == ["Alex Sales"]

