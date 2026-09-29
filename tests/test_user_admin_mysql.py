"""POST /api/settings/users against real MySQL, through db.py.

The mocked suite (test_user_admin.py) cannot see ERROR 1364: users.avatar_initials
is NOT NULL with no default, and only strict-mode MySQL rejects an INSERT that
omits it. These tests build the users, branches, user_branches and config_audit
tables from the migration files themselves in a local scratch schema, and skip
when that database is not reachable (same setup as test_load_materials_catalog).
"""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
import pymysql
import pymysql.cursors
import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

import db  # noqa: E402
import scripts.migrate as migrate  # noqa: E402
from api.server import app, require_auth  # noqa: E402

SCRATCH_DB = "crm_user_admin_test"
CREDS = dict(host="127.0.0.1", port=3306, user="crmadmin", password="crmpassword")
MIGRATIONS = REPO / "sql" / "migrations"

# (migration file, leading text of the statement to run), in dependency order.
SCHEMA = [
    ("004_users_and_branches.sql", "CREATE TABLE IF NOT EXISTS users ("),
    ("019_branch_model.sql", "ALTER TABLE users"),
    ("004_users_and_branches.sql", "CREATE TABLE IF NOT EXISTS branches ("),
    ("019_branch_model.sql", "CREATE TABLE IF NOT EXISTS user_branches ("),
    ("020_settings_storage.sql", "CREATE TABLE IF NOT EXISTS config_audit ("),
]
BRANCH_ID = 1403
ADMIN = {
    "id": "admin-1",
    "name": "Ada Admin",
    "email": "ada.admin@juniperlandscaping.com",
    "role": "admin",
    "branch_id": None,
    "avatar_initials": "AA",
}


def _statement(migration: str, prefix: str) -> str:
    text = (MIGRATIONS / migration).read_text(encoding="utf-8")
    for stmt in migrate.split_statements(text):
        if stmt.strip().startswith(prefix):
            return stmt
    raise AssertionError(f"{prefix!r} not found in {migration}")


@pytest.fixture(scope="module")
def scratch_db():
    try:
        conn = pymysql.connect(
            **CREDS,
            database=SCRATCH_DB,
            autocommit=True,
            connect_timeout=5,
            cursorclass=pymysql.cursors.DictCursor,
        )
    except pymysql.err.OperationalError as exc:
        pytest.skip(f"{SCRATCH_DB} is not reachable: {exc}")
    with conn.cursor() as cur:
        for table in ("user_branches", "config_audit", "users", "branches"):
            cur.execute(f"DROP TABLE IF EXISTS {table}")
        for migration, prefix in SCHEMA:
            cur.execute(_statement(migration, prefix))
        cur.execute(
            "INSERT INTO branches (aspire_branch_id, branch_name) VALUES (%s, 'Fort Myers Install')",
            (BRANCH_ID,),
        )
    yield conn
    conn.close()


@pytest.fixture
async def api(scratch_db, monkeypatch):
    """An HTTP client whose db.py pool points at the scratch schema, signed in as admin."""
    with scratch_db.cursor() as cur:
        for table in ("user_branches", "config_audit", "users"):
            cur.execute(f"DELETE FROM {table}")
    monkeypatch.delenv("MYSQL_SOCKET_PATH", raising=False)
    for name, value in (
        ("MYSQL_HOST", CREDS["host"]),
        ("MYSQL_PORT", str(CREDS["port"])),
        ("MYSQL_USER", CREDS["user"]),
        ("MYSQL_PASSWORD", CREDS["password"]),
        ("MYSQL_DB", SCRATCH_DB),
    ):
        monkeypatch.setenv(name, value)
    monkeypatch.setattr(db, "_pool", None)
    app.dependency_overrides[require_auth] = lambda: ADMIN
    try:
        with patch("api.authz.query", new=AsyncMock(return_value=[{"role": "admin", "active": 1}])):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://test"
            ) as client:
                yield client
    finally:
        app.dependency_overrides.clear()
        await db.close_pool()


def _rows(conn, sql: str) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute(sql)
        return list(cur.fetchall())


async def test_authorize_inserts_user_with_initials_audit_and_branch(api, scratch_db):
    r = await api.post(
        "/api/settings/users",
        json={
            "name": "Jane Doe",
            "email": "Jane.Doe@JuniperLandscaping.com",
            "role": "manager",
            "branches": [BRANCH_ID],
        },
    )
    assert r.status_code == 201, r.text
    user_id = r.json()["id"]
    assert _rows(scratch_db, "SELECT id, email, avatar_initials, active FROM users") == [
        {"id": user_id, "email": "jane.doe@juniperlandscaping.com",
         "avatar_initials": "JD", "active": 1},
    ]
    assert _rows(scratch_db, "SELECT user_id, aspire_branch_id FROM user_branches") == [
        {"user_id": user_id, "aspire_branch_id": BRANCH_ID},
    ]
    keys = {row["setting_key"] for row in _rows(scratch_db, "SELECT setting_key FROM config_audit")}
    assert keys == {f"user.{user_id}.authorize", f"user.{user_id}.branches"}


async def test_authorize_existing_email_is_409(api, scratch_db):
    body = {"name": "Jane Doe", "email": "jane.doe@juniperlandscaping.com", "role": "manager"}
    assert (await api.post("/api/settings/users", json=body)).status_code == 201

    r = await api.post("/api/settings/users", json={**body, "email": "JANE.DOE@juniperlandscaping.com"})
    assert r.status_code == 409
    assert r.json()["detail"] == "A user with email jane.doe@juniperlandscaping.com already exists."
    assert len(_rows(scratch_db, "SELECT id FROM users")) == 1


async def test_authorize_unknown_branch_is_422_and_rolls_back(api, scratch_db):
    r = await api.post(
        "/api/settings/users",
        json={
            "name": "Jane Doe",
            "email": "jane.doe@juniperlandscaping.com",
            "role": "manager",
            "branches": [BRANCH_ID, 999999],
        },
    )
    assert r.status_code == 422
    assert r.json()["detail"] == f"One or more branch ids in [{BRANCH_ID}, 999999] do not exist."
    for table in ("users", "user_branches", "config_audit"):
        assert _rows(scratch_db, f"SELECT 1 FROM {table}") == [], table
