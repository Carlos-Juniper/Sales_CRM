"""Needed-back dates inside the estimating SLA are rush jobs, not errors.

Maintenance and install intake share estimates.due_back_date (the "Needed
back" / "Internal deadline" field). Create and PATCH accept any date that
is today or later — including a 6-day turnaround — and reject a past date.
isRush is computed on read from that date and company_settings.sla_return_window_days
(fallback SLA_RETURN_WINDOW_DAYS). It is not stored.
"""
from __future__ import annotations

import os
import re
from datetime import date, datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch
from zoneinfo import ZoneInfo

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

os.environ.setdefault("MYSQL_HOST", "localhost")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("ENTRA_CLIENT_ID", "x")
os.environ.setdefault("ENTRA_TENANT_ID", "x")

from api.server import app, require_auth  # noqa: E402
import api.estimating as est  # noqa: E402

client = TestClient(app)

_ADMIN = {
    "id": "u-admin",
    "name": "Ada Admin",
    "email": "a@x.com",
    "role": "admin",
    "branch_id": None,
    "avatar_initials": "AA",
}

_TODAY = date(2026, 9, 24)


def _iso_in(days: int, today: date = _TODAY) -> str:
    return (today + timedelta(days=days)).isoformat()


def _today() -> date:
    """Business calendar date. HTTP tests must not use the UTC clock."""
    return est._business_today()


# 23:30 America/New_York is 03:30 UTC the next day. A same-day Eastern date
# is still "yesterday" on a UTC clock.
_EASTERN_EVENING = datetime(2026, 9, 24, 23, 30, tzinfo=ZoneInfo("America/New_York"))


class MemoryDb:
    """Just enough of the estimate write/read SQL for intake create, patch, and list."""

    def __init__(self, sla_days: int | None = 14) -> None:
        self.estimates: dict[str, dict] = {}
        self.sla_days = sla_days
        self.executes: list[tuple[str, list]] = []

    async def execute(self, sql: str, params=None):
        s = " ".join(sql.split())
        params = list(params or [])
        self.executes.append((s, params))
        m = re.match(r"INSERT INTO (\w+)\s*\(([^)]*)\)\s*VALUES", s, re.I)
        if m and m.group(1).lower() == "estimates":
            cols = [c.strip() for c in m.group(2).split(",")]
            row = dict(zip(cols, params))
            row.setdefault("created_at", "2026-09-24 12:00:00")
            row.setdefault("updated_at", "2026-09-24 12:00:00")
            row.setdefault("branch_city", None)
            self.estimates[row["id"]] = row
            return
        m = re.match(r"UPDATE estimates SET (.*) WHERE id = %s$", s, re.I)
        if m and "COALESCE" not in m.group(1):
            row = self.estimates.get(params[-1])
            if row is None:
                return
            i = 0
            for part in [p.strip() for p in m.group(1).split(",")]:
                col, expr = [x.strip() for x in part.split("=", 1)]
                if expr == "%s":
                    row[col] = params[i]
                    i += 1
            return

    async def query(self, sql: str, params=None):
        s = " ".join(sql.split())
        params = list(params or [])
        if "sla_return_window_days" in s:
            if self.sla_days is None:
                return []
            return [{"sla_return_window_days": self.sla_days}]
        if "COALESCE(MAX(estimate_number)" in s:
            nums = [int(r.get("estimate_number") or 0) for r in self.estimates.values()]
            return [{"next_num": (max(nums) if nums else 0) + 1}]
        if "FROM itb_scopes" in s or "FROM estimate_sections" in s:
            return []
        if "SELECT id FROM estimates" in s:
            rows = sorted(
                self.estimates.values(),
                key=lambda r: r.get("created_at") or "",
                reverse=True,
            )
            return [{"id": r["id"]} for r in rows]
        if "FROM estimates" in s and params:
            row = self.estimates.get(params[0])
            if row is None:
                return []
            if "estimate_type, status" in s:
                return [{
                    "estimate_type": row.get("estimate_type"),
                    "status": row.get("status"),
                    "aspire_opportunity_id": row.get("aspire_opportunity_id"),
                    "lead_id": row.get("lead_id"),
                    "aspire_branch_id": row.get("aspire_branch_id"),
                    "crew_rate_cents_per_hour": row.get("crew_rate_cents_per_hour"),
                }]
            return [dict(row)]
        return []


@pytest.fixture
def db():
    store = MemoryDb()
    app.dependency_overrides[require_auth] = lambda: _ADMIN
    with patch("api.estimating.query", new=AsyncMock(side_effect=store.query)), \
         patch("api.estimating.execute", new=AsyncMock(side_effect=store.execute)), \
         patch("api.estimating._sync_new_opportunity_bg", new_callable=AsyncMock), \
         patch("api.estimating._push_takeoff_qtys_bg", new_callable=AsyncMock):
        yield store
    app.dependency_overrides.clear()


def _body(estimate_type: str, due: str | None, name: str = "Palm Court RFP") -> dict:
    payload = {
        "estimateType": estimate_type,
        "name": name,
        "clientName": "Palm Court HOA",
        "aspireBranchId": 3668,
        "sections": [],
    }
    if due is not None:
        payload["dueBackDate"] = due
    return payload


# ── Pure rule (frozen clock) ─────────────────────────────────────────────────

class TestRushRule:
    def test_six_days_is_rush_and_twenty_is_not(self):
        assert est.SLA_RETURN_WINDOW_DAYS == 14
        assert est._is_rush(_iso_in(6), today=_TODAY) is True
        assert est._is_rush(_iso_in(20), today=_TODAY) is False

    def test_window_edge_is_not_rush_and_past_is_not_rush(self):
        assert est._is_rush(_iso_in(14), today=_TODAY) is False
        assert est._is_rush(_iso_in(13), today=_TODAY) is True
        assert est._is_rush(_iso_in(0), today=_TODAY) is True
        assert est._is_rush(_iso_in(-1), today=_TODAY) is False

    def test_past_date_rejected_future_inside_window_allowed(self):
        est._require_due_back_not_past(_iso_in(6), today=_TODAY)
        est._require_due_back_not_past(None, today=_TODAY)
        with pytest.raises(HTTPException) as exc:
            est._require_due_back_not_past(_iso_in(-1), today=_TODAY)
        assert exc.value.status_code == 400
        assert "past" in exc.value.detail


# ── Maintenance intake create + update ───────────────────────────────────────

class TestMaintenanceIntake:
    def test_six_day_due_date_accepted_as_rush(self, db):
        due = _iso_in(6, _today())
        resp = client.post("/api/estimating/estimates", json=_body("maintenance", due))
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["dueBackDate"] == due
        assert body["isRush"] is True
        assert db.estimates[body["id"]]["due_back_date"] == due

    def test_twenty_day_due_date_is_not_rush(self, db):
        due = _iso_in(20, _today())
        resp = client.post("/api/estimating/estimates", json=_body("maintenance", due, "Long Lead"))
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["dueBackDate"] == due
        assert body["isRush"] is False

    def test_past_due_date_rejected_and_not_stored(self, db):
        due = _iso_in(-1, _today())
        resp = client.post("/api/estimating/estimates", json=_body("maintenance", due))
        assert resp.status_code == 400
        assert "past" in resp.json()["detail"]
        assert db.estimates == {}
        assert not any("INSERT INTO estimates" in sql for sql, _ in db.executes)

    def test_patch_six_days_becomes_rush_and_past_is_rejected(self, db):
        created = client.post(
            "/api/estimating/estimates",
            json=_body("maintenance", _iso_in(20, _today())),
        ).json()
        assert created["isRush"] is False

        rushed = _iso_in(6, _today())
        resp = client.patch(
            f"/api/estimating/estimates/{created['id']}",
            json={"dueBackDate": rushed},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["dueBackDate"] == rushed
        assert resp.json()["isRush"] is True

        detail = client.get(f"/api/estimating/estimates/{created['id']}")
        assert detail.status_code == 200
        assert detail.json()["isRush"] is True

        past = client.patch(
            f"/api/estimating/estimates/{created['id']}",
            json={"dueBackDate": _iso_in(-1, _today())},
        )
        assert past.status_code == 400
        assert "past" in past.json()["detail"]
        assert db.estimates[created["id"]]["due_back_date"] == rushed

    def test_queue_list_flags_rush_ahead_of_a_longer_lead(self, db):
        short = _iso_in(6, _today())
        long = _iso_in(20, _today())
        client.post("/api/estimating/estimates", json=_body("maintenance", long, "Long Lead"))
        client.post("/api/estimating/estimates", json=_body("maintenance", short, "Rush RFP"))

        resp = client.get("/api/estimating/estimates")
        assert resp.status_code == 200, resp.text
        rows = resp.json()
        by_due = sorted(rows, key=lambda e: e["dueBackDate"])
        assert [e["name"] for e in by_due] == ["Rush RFP", "Long Lead"]
        assert by_due[0]["isRush"] is True
        assert by_due[1]["isRush"] is False
        assert by_due[0]["dueBackDate"] < by_due[1]["dueBackDate"]


# ── Install intake uses the same dueBackDate rule ────────────────────────────

class TestInstallIntake:
    def test_six_day_internal_deadline_accepted_as_rush(self, db):
        due = _iso_in(6, _today())
        resp = client.post("/api/estimating/estimates", json=_body("install", due, "Install Rush"))
        assert resp.status_code == 201, resp.text
        assert resp.json()["estimateType"] == "install"
        assert resp.json()["isRush"] is True
        assert resp.json()["dueBackDate"] == due

    def test_past_internal_deadline_rejected(self, db):
        resp = client.post(
            "/api/estimating/estimates",
            json=_body("install", _iso_in(-1, _today()), "Install Late"),
        )
        assert resp.status_code == 400
        assert "past" in resp.json()["detail"]
        assert db.estimates == {}

    def test_patch_twenty_days_clears_rush(self, db):
        created = client.post(
            "/api/estimating/estimates",
            json=_body("install", _iso_in(6, _today()), "Install Rush"),
        ).json()
        assert created["isRush"] is True
        due = _iso_in(20, _today())
        resp = client.patch(
            f"/api/estimating/estimates/{created['id']}",
            json={"dueBackDate": due},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["isRush"] is False
        assert resp.json()["dueBackDate"] == due


class TestSlaWindowFromCompanySettings:
    def test_configured_window_overrides_the_fallback(self, db):
        """A 6-day date is not a rush when the company window is 5 days."""
        db.sla_days = 5
        due = _iso_in(6, _today())
        resp = client.post("/api/estimating/estimates", json=_body("maintenance", due))
        assert resp.status_code == 201, resp.text
        assert resp.json()["isRush"] is False

    def test_missing_settings_row_uses_the_shared_constant(self, db):
        db.sla_days = None
        due = _iso_in(6, _today())
        resp = client.post("/api/estimating/estimates", json=_body("maintenance", due))
        assert resp.status_code == 201, resp.text
        assert resp.json()["isRush"] is True


class TestEasternEvening:
    """23:30 Eastern is 03:30 UTC the next day.

    The old check compared the client's calendar date to date.today() in
    UTC, so a same-day needed-back date was a spurious 400 and a blank
    date became that UTC day (a rush).
    """

    def test_clock_is_the_next_utc_day(self):
        utc = _EASTERN_EVENING.astimezone(timezone.utc)
        assert utc == datetime(2026, 9, 25, 3, 30, tzinfo=timezone.utc)
        assert est._business_today(_EASTERN_EVENING) == date(2026, 9, 24)
        assert est._business_today(utc) == date(2026, 9, 24)
        assert utc.date() == date(2026, 9, 25)

    def test_same_day_needed_back_is_accepted_and_rush(self, db):
        with patch("api.estimating._business_now", return_value=_EASTERN_EVENING):
            resp = client.post(
                "/api/estimating/estimates",
                json=_body("maintenance", "2026-09-24", "Same Day"),
            )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["dueBackDate"] == "2026-09-24"
        assert body["isRush"] is True
        assert db.estimates[body["id"]]["due_back_date"] == "2026-09-24"

    def test_blank_needed_back_defaults_to_sla_window_and_is_not_rush(self, db):
        with patch("api.estimating._business_now", return_value=_EASTERN_EVENING):
            resp = client.post(
                "/api/estimating/estimates",
                json=_body("maintenance", None, "Blank Window"),
            )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["dueBackDate"] == "2026-10-08"
        assert body["isRush"] is False

    def test_blank_string_uses_the_company_window(self, db):
        db.sla_days = 21
        payload = _body("install", None, "Blank Install")
        payload["dueBackDate"] = ""
        with patch("api.estimating._business_now", return_value=_EASTERN_EVENING):
            resp = client.post("/api/estimating/estimates", json=payload)
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["dueBackDate"] == "2026-10-15"
        assert body["isRush"] is False
        assert body["estimateType"] == "install"

    def test_day_before_eastern_today_is_still_rejected(self, db):
        with patch("api.estimating._business_now", return_value=_EASTERN_EVENING):
            resp = client.post(
                "/api/estimating/estimates",
                json=_body("maintenance", "2026-09-23"),
            )
        assert resp.status_code == 400
        assert "past" in resp.json()["detail"]
        assert db.estimates == {}
