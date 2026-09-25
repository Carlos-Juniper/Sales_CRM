"""Pytest bootstrap — credential isolation and the shared estimating fixtures.

**Credential pinning.** ``api/server.py`` calls ``load_dotenv()`` at import time
(api/server.py:32), so importing it from any test loads the developer's real
``.env`` into ``os.environ`` for the whole pytest process. The ~140 module-level
``os.environ.setdefault(...)`` calls across the suite are then silent no-ops,
because setdefault does nothing when the name already exists — tests that
believe they run on ``test-secret`` quietly run on live credentials instead.

That is how ``ASPIRE_ENV=sandbox`` from ``.env`` reached
``_resolve_credentials()`` (api/aspire_client.py:41), which read the real
``ASPIRE_SANDBOX_SECRET`` and printed it into the failure output of
``test_aspire_client.py`` on every full-suite run. In CI that lands in a log.

Claiming the names here is enough: pytest imports conftest before any test
module, and ``load_dotenv()`` defaults to ``override=False`` — it will not
replace a name that already exists. Assignment is unconditional on purpose;
``setdefault`` here would reintroduce the very bug this guards against for a
developer who has these exported in their shell.

**Scope of what is shared.** Only ``FakeDb`` and the generic ``db`` fixture
live here. The ``estimator``/``sales`` fixtures stay with their modules on
purpose: their identities differ (takeoff signs in as ``install_estimating``,
line_items as ``maintenance_estimating``, ls_ir_split as a different user), and
hoisting them would silently change which role each suite exercises.

**FakeDb.** An in-memory interpreter for the SQL ``api/estimating.py`` issues,
backing 58 stateful round-trip tests (POST persists -> GET reads back -> PATCH
recomputes -> DELETE cascades) that ordered ``AsyncMock`` side-effect lists
cannot express without breaking every time production adds a query. It lived as
two diverged copies in test_estimating_takeoff.py and test_estimating_line_items.py,
with two further modules cross-importing from the latter; a schema change then
had to be applied in two places and was applied in neither. This file is the one
copy. Tests that need it take the ``db`` fixture.
"""
from __future__ import annotations

import os

# Must precede any api.* import, since that is what triggers load_dotenv().
_TEST_ENV = {
    "ASPIRE_ENV": "prod",
    "ASPIRE_CLIENT_ID": "test-client",
    "ASPIRE_SECRET": "test-secret",
    "ASPIRE_SANDBOX_CLIENT_ID": "test-sandbox-client",
    "ASPIRE_SANDBOX_SECRET": "test-sandbox-secret",
    "ATTENTIVE_API_KEY": "test-attentive-key",
    "ATTENTIVE_IFRAME_KEY": "test-attentive-iframe-key",
    "ATTENTIVE_STAGE_API_KEY": "test-attentive-stage-key",
    "ATTENTIVE_WEBHOOK_TOKEN": "test-attentive-webhook-token",
    "AZURE_MYSQL_PASSWORD": "test-azure-password",
    "ENTRA_CLIENT_ID": "test-client-id",
    "ENTRA_TENANT_ID": "test-tenant-id",
    "JWT_SECRET": "test-secret",
    "KMS_GRAPH_TOKEN_KEY": "projects/test/locations/us-central1/keyRings/test/cryptoKeys/test",
}
for _name, _value in _TEST_ENV.items():
    os.environ[_name] = _value

# No MYSQL_* name is pinned — not the password, and not host/port/user/db. tests/test_migrate.py and the
# proposal integration tests are opt-in: they connect to a local MySQL and run
# against a throwaway schema (MYSQL_TEST_DB, default ``crm_migrate_test``), never
# the app database, and skip via ``requires_mysql`` when nothing answers. Pinning
# the password does not make them safer — it just makes 18 of them skip silently,
# trading a real integration signal for a green-looking run. Pinning the
# user or host breaks the same tests just as quietly: the give-away is the
# suite finishing in ~10s with 24 skips instead of ~6min with 1.

import re  # noqa: E402
from datetime import datetime  # noqa: E402
from unittest.mock import AsyncMock, patch  # noqa: E402

import pytest  # noqa: E402

_CHILDREN = {
    "estimates": [("estimate_sections", "estimate_id"),
                  ("estimate_status_transitions", "estimate_id"),
                  ("intake_submissions", "estimate_id")],
    "estimate_sections": [("section_services", "section_id")],
    "section_services": [("section_service_components", "section_service_id")],
}


class FakeDb:
    def __init__(self) -> None:
        # defaultdict keeps the fake tolerant of tables touched by adjacent
        # features (e.g. itb_projects) without modeling them.
        from collections import defaultdict

        self.tables: dict[str, dict[str, dict]] = defaultdict(dict)

    # -- helpers ---------------------------------------------------------------
    def _cascade_delete(self, table: str, row_id: str) -> None:
        self.tables[table].pop(row_id, None)
        for child, fk in _CHILDREN.get(table, []):
            for cid in [r["id"] for r in self.tables[child].values() if r.get(fk) == row_id]:
                self._cascade_delete(child, cid)

    @staticmethod
    def _norm(sql: str) -> str:
        return " ".join(sql.split())

    # -- execute (INSERT / UPDATE / DELETE) ------------------------------------
    async def execute(self, sql: str, params=None):
        s = self._norm(sql)
        params = list(params or [])

        m = re.match(r"INSERT INTO (\w+)\s*\(([^)]*)\)\s*VALUES\s*\((.*)\)", s, re.I)
        if m:
            table, cols_str, vals_str = m.group(1), m.group(2), m.group(3)
            cols = [c.strip() for c in cols_str.split(",")]
            tokens = re.findall(r"%s|NULL|CURRENT_TIMESTAMP|\d+", vals_str)
            it = iter(params)
            row: dict = {}
            for col, tok in zip(cols, tokens):
                if tok == "%s":
                    row[col] = next(it)
                elif tok == "NULL":
                    row[col] = None
                elif tok == "CURRENT_TIMESTAMP":
                    row[col] = datetime(2026, 8, 4, 12, 0, 0)
                else:
                    row[col] = int(tok)
            self._apply_defaults(table, row)
            self.tables[table][row["id"]] = row
            return

        m = re.match(r"UPDATE (\w+) SET (.*) WHERE (id|estimate_id) = %s$", s, re.I)
        if m:
            table, sets, key_col = m.group(1), m.group(2), m.group(3)
            if key_col == "id":
                row = self.tables[table].get(params[-1])
            else:
                row = next(
                    (r for r in self.tables[table].values() if r.get(key_col) == params[-1]),
                    None,
                )
            i = 0
            for part in [p.strip() for p in sets.split(",")]:
                col, expr = [x.strip() for x in part.split("=", 1)]
                if expr == "%s":
                    if row is not None:
                        row[col] = params[i]
                    i += 1
                elif expr.startswith("COALESCE(%s"):
                    if row is not None and params[i] is not None:
                        row[col] = params[i]
                    i += 1
                elif "CURRENT_TIMESTAMP" in expr:
                    if row is not None:
                        row[col] = datetime(2026, 8, 4, 12, 0, 0)
            return

        m = re.match(r"DELETE FROM (\w+) WHERE id = %s$", s, re.I)
        if m:
            self._cascade_delete(m.group(1), params[0])
            return

        raise AssertionError(f"FakeDb.execute: unhandled SQL: {s}")

    def _apply_defaults(self, table: str, row: dict) -> None:
        if table == "estimates":
            row.setdefault("aspire_opportunity_id", None)
            row.setdefault("aspire_lost_reason_id", None)
            row.setdefault("aspire_sync_status", "pending")
            row.setdefault("aspire_sync_error", None)
            row.setdefault("aspire_synced_at", None)
        if table == "estimate_status_transitions":
            row.setdefault("at", datetime(2026, 8, 4, 12, 0, 0))
        if table == "takeoff_lines":
            row.setdefault("service_kit_id", None)
        row.setdefault("created_at", datetime(2026, 8, 4, 12, 0, 0))
        row.setdefault("updated_at", datetime(2026, 8, 4, 12, 0, 0))

    # -- query (SELECT) ---------------------------------------------------------
    async def query(self, sql: str, params=None):
        s = self._norm(sql)
        params = list(params or [])

        # estimates LEFT JOIN branches — added when a single estimate began
        # rendering its branch city. Modelled as a real LEFT JOIN: an unseeded
        # branches table yields branch_city = None rather than a fabricated value.
        if re.search(r"FROM estimates e LEFT JOIN branches b", s):
            row = self.tables["estimates"].get(params[0])
            if not row:
                return []
            branch = next(
                (b for b in self.tables["branches"].values()
                 if b.get("aspire_branch_id") == row.get("aspire_branch_id")),
                None,
            )
            return [dict(row, branch_city=branch.get("city") if branch else None)]

        # Next sequential estimate_number (contract generator, api/estimating.py).
        if "AS next_num" in s:
            used = [r.get("estimate_number") or 0 for r in self.tables["estimates"].values()]
            return [{"next_num": (max(used) if used else 0) + 1}]

        # Ownership-chain JOINs (service level).
        if re.search(r"FROM section_services sv JOIN estimate_sections s", s):
            svc_id, section_id, estimate_id = params
            svc = self.tables["section_services"].get(svc_id)
            sec = self.tables["estimate_sections"].get(section_id)
            if svc and sec and svc["section_id"] == section_id and sec["estimate_id"] == estimate_id:
                return [dict(svc)]
            return []

        # Ownership-chain JOINs (component level).
        if re.search(r"FROM section_service_components c JOIN section_services sv", s):
            comp_id, service_id, section_id, estimate_id = params
            comp = self.tables["section_service_components"].get(comp_id)
            svc = self.tables["section_services"].get(service_id)
            sec = self.tables["estimate_sections"].get(section_id)
            if (
                comp and svc and sec
                and comp["section_service_id"] == service_id
                and svc["section_id"] == section_id
                and sec["estimate_id"] == estimate_id
            ):
                return [dict(comp)]
            return []

        m = re.match(r"SELECT COUNT\(\*\) AS c FROM (\w+) WHERE (\w+) = %s$", s, re.I)
        if m:
            table, col = m.group(1), m.group(2)
            n = sum(1 for r in self.tables[table].values() if r.get(col) == params[0])
            return [{"c": n}]

        m = re.match(
            r"SELECT (.*?) FROM (\w+)(?: WHERE (.*?))?(?: ORDER BY (.*?))?(?: LIMIT %s)?$",
            s, re.I,
        )
        if m:
            cols_str, table, where, order = m.groups()
            rows = list(self.tables[table].values())
            if where:
                idx = 0
                for cond in where.split(" AND "):
                    cm = re.match(r"(\w+) = %s$", cond.strip())
                    if cm:
                        col, val = cm.group(1), params[idx]
                        idx += 1
                        rows = [r for r in rows if r.get(col) == val]
                        continue
                    cm = re.match(r"(\w+) IS NOT NULL$", cond.strip())
                    if cm:
                        rows = [r for r in rows if r.get(cm.group(1)) is not None]
                        continue
                    cm = re.match(r"(\w+) IN \((.*)\)$", cond.strip())
                    if cm:
                        col = cm.group(1)
                        n = cm.group(2).count("%s")
                        vals = params[idx: idx + n]
                        idx += n
                        rows = [r for r in rows if r.get(col) in vals]
                        continue
                    cm = re.match(r"(\w+) IN \('([^']*)'(?:,\s*'([^']*)')*\)$", cond.strip())
                    if cm:  # literal IN list (sweep query) — not exercised here
                        continue
                    raise AssertionError(f"FakeDb.query: unhandled WHERE cond: {cond}")
            if order:
                key = order.split(",")[0].strip()
                desc = key.upper().endswith(" DESC")
                key = key.split()[0]
                rows = sorted(rows, key=lambda r: (r.get(key) is None, r.get(key)), reverse=desc)
            cols_str = cols_str.strip()
            if cols_str != "*":
                cols = [c.strip() for c in cols_str.split(",")]
                return [{c: r.get(c) for c in cols} for r in rows]
            return [dict(r) for r in rows]

        raise AssertionError(f"FakeDb.query: unhandled SQL: {s}")


@pytest.fixture
def db():
    fake = FakeDb()
    with patch("api.estimating.query", new=AsyncMock(side_effect=fake.query)), \
         patch("api.estimating.execute", new=AsyncMock(side_effect=fake.execute)), \
         patch("api.estimating._sync_new_opportunity_bg", new_callable=AsyncMock), \
         patch("api.estimating._sync_status_bg", new_callable=AsyncMock):
        yield fake

