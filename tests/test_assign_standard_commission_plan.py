"""The standard-plan assignment is a script, not a migration."""
from __future__ import annotations

from api.authz import SALES_REP_DB_ROLES
from scripts.assign_standard_commission_plan import (
    assignment_roles,
    assign,
    main,
    parse_exclude_user_ids,
)


def test_roles_follow_authz_and_include_vp_sales():
    roles = assignment_roles()
    assert list(roles[: len(SALES_REP_DB_ROLES)]) == list(SALES_REP_DB_ROLES)
    assert "vp_sales" in roles
    assert roles.count("vp_sales") == 1
    assert "michelle" not in " ".join(roles)
    assert "cady" not in " ".join(roles)


def test_parse_exclude_user_ids_accepts_repeated_and_comma_separated_values():
    parsed = parse_exclude_user_ids([
        "u-cady, u-leon",
        "u-leon",
        " u-other ",
        "",
        ",",
    ])
    assert parsed == ["u-cady", "u-leon", "u-other"]


class _Cursor:
    def __init__(self, users):
        self.users = users
        self.sqls = []
        self.params = []
        self.inserts = []
        self._last = ""

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, sql, params=None):
        self.sqls.append(sql)
        self.params.append(params)
        self._last = sql
        if "INSERT" in sql:
            self.inserts.append(params)

    def fetchone(self):
        if "commission_plans" in self._last:
            return {"plan_key": "standard"}
        return None

    def fetchall(self):
        if "role IN" in self._last:
            return list(self.users)
        if "u.id IN" in self._last:
            wanted = set(self.params[-1])
            return [user for user in self.users if user["id"] in wanted]
        return []


class _Conn:
    def __init__(self, users):
        self.cursor_obj = _Cursor(users)
        self.commits = 0

    def cursor(self):
        return self.cursor_obj

    def get_autocommit(self):
        return False

    def commit(self):
        self.commits += 1


_USERS = [
    {"id": "u-alex", "name": "Alex Sales", "role": "inside_sales"},
    {"id": "u-cady", "name": "Michelle Cady", "role": "sales"},
    {"id": "u-leon", "name": "Rodrigo Leon", "role": "vp_sales"},
]


def test_excluded_ids_are_not_assigned_in_dry_run_or_apply():
    conn = _Conn(_USERS)
    preview = assign(conn, dry_run=True, exclude_user_ids=["u-cady", "u-leon"])
    assert [row["id"] for row in preview.assigned] == ["u-alex"]
    assert [(row["id"], row["name"], row["role"]) for row in preview.excluded] == [
        ("u-cady", "Michelle Cady", "sales"),
        ("u-leon", "Rodrigo Leon", "vp_sales"),
    ]
    assert conn.cursor_obj.inserts == []
    assert conn.commits == 0
    joined = " ".join(conn.cursor_obj.sqls).lower()
    for fragment in ("michelle", "cady", "rodrigo", "leon", "%cady%", "%leon%"):
        assert fragment not in joined

    applied = assign(conn, dry_run=False, exclude_user_ids="u-cady,u-leon")
    assert [row["id"] for row in applied.assigned] == ["u-alex"]
    inserted_user_ids = [params[1] for params in conn.cursor_obj.inserts]
    assert inserted_user_ids == ["u-alex"]
    assert "u-cady" not in inserted_user_ids
    assert "u-leon" not in inserted_user_ids
    assert conn.commits == 1


def test_main_lists_excluded_users_separately(capsys, monkeypatch):
    class _Closed:
        def close(self):
            return None

    monkeypatch.setattr(
        "scripts.assign_standard_commission_plan._connect",
        lambda: _Closed(),
    )

    def fake_assign(conn, *, dry_run, effective_date, exclude_user_ids):
        assert exclude_user_ids == ["u-cady", "u-leon"]
        from scripts.assign_standard_commission_plan import AssignmentResult
        return AssignmentResult(
            assigned=[{"id": "u-alex", "name": "Alex Sales", "role": "inside_sales"}],
            excluded=[
                {"id": "u-cady", "name": "Michelle Cady", "role": "sales"},
                {"id": "u-leon", "name": "Rodrigo Leon", "role": "vp_sales"},
            ],
        )

    monkeypatch.setattr("scripts.assign_standard_commission_plan.assign", fake_assign)
    code = main([
        "--dry-run",
        "--exclude-user-ids",
        "u-cady",
        "--exclude-user-ids",
        "u-leon",
    ])
    assert code == 0
    out = capsys.readouterr().out
    assign_at = out.index("would assign 1 user(s)")
    excluded_at = out.index("excluded 2 user(s)")
    assert assign_at < excluded_at
    assert "u-alex Alex Sales (inside_sales)" in out
    assert "u-cady Michelle Cady (sales)" in out.split("excluded", 1)[1]
    assert "u-leon Rodrigo Leon (vp_sales)" in out.split("excluded", 1)[1]

    code = main(["--apply", "--exclude-user-ids", "u-cady,u-leon"])
    assert code == 0
    applied = capsys.readouterr().out
    assert applied.startswith("assigned 1 user(s)")
    assert "excluded 2 user(s)" in applied
    assert "u-cady Michelle Cady (sales)" in applied.split("excluded", 1)[1]
