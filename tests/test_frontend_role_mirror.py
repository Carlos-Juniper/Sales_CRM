"""studio/src hand-mirrors api/authz.py; drift here is a silent auth bug.

Handoff 54 §5 acceptance: "A role in authz.CANONICAL_ROLES but absent from
studio/src/lib/roles.ts fails a test." roles.ts takes CANONICAL_ROLES from
'@/types' (studio/src/types/index.ts), so the guard reads that literal and
checks roles.ts still imports it, then compares every roles.ts set that
mirrors a Python set member for member.

FRONTEND_PENDING_ROLES lists canonical roles whose frontend change has not
merged yet (Handoff 54 §5's frontend half owns roles.ts / types / sidebar /
tabs). A pending role may be absent from the TS mirrors. The moment it
appears in studio/src/types/index.ts the pending test fails until the entry
is deleted here, so the waiver cannot outlive the frontend change.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

from api import authz

STUDIO = Path(__file__).resolve().parents[1] / "studio" / "src"
ROLES_TS = STUDIO / "lib" / "roles.ts"
TYPES_TS = STUDIO / "types" / "index.ts"

# Handoff 54 §5 roles whose studio/src change is in flight. Delete each entry
# when the frontend PR that adds it merges (the test below enforces this).
FRONTEND_PENDING_ROLES = frozenset({
    "maintenance_estimating_manager",
    "install_estimating_manager",
    "sales_manager",
})

# roles.ts constant -> the api/authz.py set it mirrors.
MIRRORED_SETS = {
    "ADMIN_EQUIVALENT_ROLES": "ADMIN_EQUIVALENT_ROLES",
    "ESTIMATOR_ROLES": "ESTIMATOR_ROLES",
    "ESTIMATING_ONLY_ROLES": "ESTIMATING_ONLY_ROLES",
    "APPROVER_ROLES": "APPROVER_ROLES",
    "CROSS_BRANCH_ROLES": "CROSS_BRANCH_ROLES",
    "REP_SELECTOR_ROLES": "REP_VIEWER_ROLES",
    "FULL_ACCESS_ROLES": "FULL_ACCESS_ROLES",
    "FIELD_SALES_ROLES": "FIELD_SALES_ROLES",
    "ROSTER_REP_ROLES": "ROSTER_REP_ROLES",
    "SALES_REP_ROLES": "SALES_REP_DB_ROLES",
    "RETIRED_SALES_ROLES": "RETIRED_SALES_ROLES",
}

_ARRAY_RE = r"export const {name}\b[^=]*=\s*\[(?P<body>.*?)\]"


def _array_items(source: str, name: str, consts: dict[str, set[str]]) -> set[str]:
    """String literals in `export const NAME = [...]`, with `...OTHER` spreads
    resolved against already-parsed constants."""
    m = re.search(_ARRAY_RE.format(name=re.escape(name)), source, re.S)
    if not m:
        raise AssertionError(f"{name} not found as an array literal")
    body = re.sub(r"//[^\n]*|/\*.*?\*/", "", m.group("body"), flags=re.S)
    items = set(re.findall(r"'([a-z_]+)'", body))
    for spread in re.findall(r"\.\.\.([A-Z_]+)", body):
        if spread not in consts:
            consts[spread] = _array_items(source, spread, consts)
        items |= consts[spread]
    return items


def _frontend_canonical() -> set[str]:
    return _array_items(TYPES_TS.read_text(), "CANONICAL_ROLES", {})


def test_roles_ts_takes_canonical_roles_from_types():
    src = ROLES_TS.read_text()
    assert re.search(r"import\s*\{[^}]*\bCANONICAL_ROLES\b[^}]*\}\s*from\s*'@/types'", src), (
        "roles.ts must source CANONICAL_ROLES from '@/types'; if it now declares "
        "its own list, point this guard at that list"
    )


def test_every_canonical_role_is_mirrored_in_the_frontend():
    missing = set(authz.CANONICAL_ROLES) - _frontend_canonical() - FRONTEND_PENDING_ROLES
    assert not missing, (
        f"api/authz.py CANONICAL_ROLES has {sorted(missing)} but studio/src/types/index.ts "
        "CANONICAL_ROLES (imported by studio/src/lib/roles.ts) does not"
    )


def test_frontend_has_no_role_the_backend_does_not():
    extra = _frontend_canonical() - set(authz.CANONICAL_ROLES)
    assert not extra, f"frontend CANONICAL_ROLES has unknown roles {sorted(extra)}"


@pytest.mark.parametrize("role", sorted(FRONTEND_PENDING_ROLES))
def test_pending_waiver_is_removed_once_the_frontend_lands(role):
    assert role in authz.CANONICAL_ROLES
    assert role not in _frontend_canonical(), (
        f"{role} is now in studio/src/types/index.ts: delete it from "
        "FRONTEND_PENDING_ROLES in this file"
    )


@pytest.mark.parametrize("ts_name,py_name", sorted(MIRRORED_SETS.items()))
def test_roles_ts_sets_mirror_authz(ts_name, py_name):
    ts_items = _array_items(ROLES_TS.read_text(), ts_name, {})
    py_items = set(getattr(authz, py_name))
    assert ts_items - py_items == set(), f"{ts_name} has roles authz.{py_name} lacks"
    assert py_items - ts_items - FRONTEND_PENDING_ROLES == set(), (
        f"authz.{py_name} has roles roles.ts {ts_name} lacks"
    )
