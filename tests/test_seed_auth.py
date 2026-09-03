"""
Tests for api/seed_auth.py — the no-password crm_users onboarding tool.

Manual login was removed, so seed_auth no longer provisions passwords into
crm_logins. It now upserts rows into the GCP Cloud SQL MySQL `users` table
(the same store entra_callback reads for authorization), via the shared
query()/execute() helpers — email, name, role, branch_id.

DB is fully mocked — no real datastore required.
Run with:  pytest tests/test_seed_auth.py -v
"""
from __future__ import annotations

import asyncio
import os
from unittest.mock import AsyncMock, patch

import pytest

os.environ.setdefault("GCP_PROJECT", "test-project")

import api.seed_auth as seed_auth  # noqa: E402


def _run(*, existing=None, affected=1, **kwargs):
    """Run provision() with query()/execute() mocked. Returns (query, execute) mocks."""
    query_mock = AsyncMock(return_value=existing or [])
    execute_mock = AsyncMock(return_value=affected)
    with patch("api.seed_auth.query", query_mock), patch("api.seed_auth.execute", execute_mock):
        asyncio.run(seed_auth.provision(**kwargs))
    return query_mock, execute_mock


def test_provision_inserts_new_user():
    _, execute_mock = _run(
        existing=[],
        email="new.rep@juniperlandscaping.com",
        name="New Rep",
        role="inside_sales",
        branch_id="b1",
    )

    assert execute_mock.await_count == 1
    sql, params = execute_mock.await_args[0]
    assert "INSERT" in sql.upper()
    assert "users" in sql  # same table entra_callback reads for authorization
    values = list(params)
    assert "new.rep@juniperlandscaping.com" in values
    assert "New Rep" in values
    assert "inside_sales" in values  # canonical role, stored verbatim
    assert "b1" in values


def test_provision_updates_existing_user_keyed_on_email():
    query_mock, execute_mock = _run(
        existing=[{"id": "existing-id"}],
        email="carlos@juniperlandscaping.com",
        name="Carlos H",
        role="manager",
        branch_id="b2",
    )

    # Looked up the existing row, then UPDATE'd it (no duplicate INSERT).
    assert query_mock.await_count == 1
    sql, params = execute_mock.await_args[0]
    assert "UPDATE" in sql.upper()
    assert "existing-id" in list(params)


def test_provision_lowercases_email_on_lookup_and_write():
    query_mock, execute_mock = _run(
        existing=[],
        email="Jane.Doe@Juniperlandscaping.com",
        name="Jane Doe",
        role="outside_sales",
        branch_id=None,
    )

    lookup_params = list(query_mock.await_args[0][1])
    insert_params = list(execute_mock.await_args[0][1])
    assert "jane.doe@juniperlandscaping.com" in lookup_params
    assert "jane.doe@juniperlandscaping.com" in insert_params


def test_provision_rejects_unknown_role():
    with pytest.raises(ValueError, match="role"):
        _run(
            existing=[],
            email="x@juniperlandscaping.com",
            name="X",
            role="astronaut",
            branch_id="b1",
        )


def test_valid_roles_are_the_ten_canonical_roles():
    # One canonical role vocabulary, backend-validated.
    assert seed_auth.VALID_ROLES == frozenset({
        "procurement", "sales", "inside_sales", "admin", "manager",
        "regional_director", "maintenance_estimating", "install_estimating",
        "vice_president", "ceo",
    })


def test_provision_accepts_new_canonical_roles():
    _, execute_mock = _run(
        existing=[],
        email="exec@juniperlandscaping.com",
        name="Big Exec",
        role="ceo",
        branch_id=None,
    )
    sql, params = execute_mock.await_args[0]
    assert "INSERT" in sql.upper()
    assert "ceo" in list(params)


def test_provision_normalizes_outside_sales_to_sales():
    # `outside_sales` is the only retired role left; it collapses into `sales`.
    _, execute_mock = _run(
        existing=[],
        email="outside_sales@juniperlandscaping.com",
        name="Legacy Rep",
        role="outside_sales",
        branch_id=None,
    )
    params = list(execute_mock.await_args[0][1])
    assert "sales" in params
    assert "outside_sales" not in params


def test_provision_requires_branch_for_manager():
    with pytest.raises(ValueError, match="branch"):
        _run(
            existing=[],
            email="boss@juniperlandscaping.com",
            name="Boss",
            role="manager",
            branch_id=None,
        )


def test_provision_allows_null_branch_for_non_manager():
    _, execute_mock = _run(
        existing=[],
        email="floater@juniperlandscaping.com",
        name="Floater",
        role="outside_sales",
        branch_id=None,
    )

    values = list(execute_mock.await_args[0][1])
    assert None in values  # branch_id written as NULL


def test_provision_rejects_empty_name():
    with pytest.raises(ValueError, match="name"):
        _run(
            existing=[],
            email="blank@juniperlandscaping.com",
            name="   ",
            role="inside_sales",
            branch_id="b1",
        )


def test_provision_raises_when_no_rows_affected():
    # A write that lands nowhere must fail loudly, not silently report success.
    with pytest.raises(RuntimeError, match="0 rows"):
        _run(
            existing=[],
            affected=0,
            email="ghost@juniperlandscaping.com",
            name="Ghost",
            role="inside_sales",
            branch_id="b1",
        )


def test_seed_auth_has_no_password_machinery():
    # No bcrypt, no crm_logins, no MySQL credential store — auth is SSO-only now.
    assert not hasattr(seed_auth, "bcrypt"), "bcrypt import should be removed"
    assert not hasattr(seed_auth, "get_pool"), "MySQL get_pool should not be used"
    with open(seed_auth.__file__) as f:
        src = f.read()
    assert "crm_logins" not in src, "crm_logins references should be removed"
    assert "password_hash" not in src, "password hashing should be removed"
    assert "hashpw" not in src, "password hashing should be removed"
