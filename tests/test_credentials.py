"""Slice 15a backend — licenses_certifications + insurance_certificates CRUD + GCS scan upload.

Acceptance criteria (Handoff 38, §6 AC, Amendment C):

  licenses_certifications (branch-scoped):
    * Deactivating sets active=0; NO DELETE SQL for licenses_certifications.
    * include_expired=true returns deactivated/expired rows (list endpoint).
    * BM scoped to branch X can create/edit a license for X.
    * BM is 403 for branch Y.
    * Company-wide (aspire_branch_id=NULL) license is read-only to BM (create/edit → 403).
    * Admin edits anywhere.
    * Upload endpoint routes bytes through upload_bytes; stores returned key in object_key.
    * Each successful write inserts exactly ONE config_audit row with correct scope/actor.

  insurance_certificates (company-wide, admin-only):
    * Schema divergence: NO aspire_branch_id, NO active, NO sort_order — hard delete
      is the only removal path (same situation as portfolio_properties; flag for migration).
    * Create stores object_key + expiry_date (both required); label optional.
    * Admin-only: non-admin → 403.
    * Upload endpoint routes bytes through upload_bytes (same GCS path).
    * Each successful write inserts exactly ONE config_audit row.

DB + GCS fully mocked — patch api.settings.query / api.settings.execute and
api.attachments.upload_bytes. api.authz.query mocked for live-role / scope re-reads.
asyncio_mode = auto (pytest.ini).
"""
from __future__ import annotations

import datetime
import os
from io import BytesIO
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("MYSQL_HOST", "localhost")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("ENTRA_CLIENT_ID", "x")
os.environ.setdefault("ENTRA_TENANT_ID", "x")

from api.server import app, require_auth  # noqa: E402

client = TestClient(app)


# ── Fixtures / helpers ────────────────────────────────────────────────────────

def _user(role: str, **over) -> dict:
    u = {
        "id": "u-test",
        "name": "Test User",
        "email": "test.user@juniperlandscaping.com",
        "role": role,
        "branch_id": "b1",
        "avatar_initials": "TU",
    }
    u.update(over)
    return u


@pytest.fixture
def as_role():
    """Override require_auth with an arbitrary token claim; auto-clears."""
    def _set(role: str, **over):
        app.dependency_overrides[require_auth] = lambda: _user(role, **over)
    yield _set
    app.dependency_overrides.clear()


def _live(role: str, active: int = 1) -> list[dict]:
    """Simulate api.authz.query returning a live role row."""
    return [{"role": role, "active": active}]


def _scoped_to(*branch_ids: int) -> list[dict]:
    """Simulate api.authz.query returning user_branches rows."""
    return [{"aspire_branch_id": bid} for bid in branch_ids]


def _audit_calls(mock_exec) -> list:
    """Filter execute calls that are config_audit INSERTs."""
    return [c for c in mock_exec.await_args_list if "config_audit" in c.args[0]]


def _flat_audit(audit_call) -> str:
    """Flatten audit INSERT params to a single string for easy assertion."""
    return " ".join(str(p) for p in audit_call.args[1])


# ── Shared fake rows ──────────────────────────────────────────────────────────

def _lc_row(**over) -> dict:
    """A licenses_certifications DB row (active, branch-scoped)."""
    row = {
        "id": "lc-001",
        "kind": "license",
        "name": "Certified Pest Control Operator",
        "issuing_body": "Florida Dept of Agriculture",
        "identifier": "JB1234",
        "holder_name": "Jane Bell",
        "aspire_branch_id": 1403,
        "issued_date": datetime.date(2025, 1, 15),
        "expiry_date": datetime.date(2027, 1, 14),
        "object_key": "proposal/licenses/cpco.pdf",
        "active": 1,
        "sort_order": 0,
        "updated_at": datetime.datetime(2026, 1, 1, 0, 0, 0),
    }
    row.update(over)
    return row


def _ins_row(**over) -> dict:
    """An insurance_certificates DB row."""
    row = {
        "id": "ins-001",
        "object_key": "proposal/insurance/gl-2026.pdf",
        "expiry_date": datetime.date(2027, 6, 30),
        "label": "General Liability",
        "uploaded_at": datetime.datetime(2026, 6, 1, 12, 0, 0),
    }
    row.update(over)
    return row


# ════════════════════════════════════════════════════════════════════════════════
# licenses_certifications CRUD
# ════════════════════════════════════════════════════════════════════════════════

class TestLicensesCreate:
    """POST /api/settings/licenses"""

    _VALID_BODY = {
        "kind": "license",
        "name": "Certified Pest Control Operator",
        "issuingBody": "Florida Dept of Agriculture",
        "identifier": "JB1234",
        "holderName": "Jane Bell",
        "aspireBranchId": 1403,
        "issuedDate": "2025-01-15",
        "expiryDate": "2027-01-14",
        "sortOrder": 0,
    }

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_bm_creates_for_own_branch_201(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("manager")
        mock_authz_query.return_value = _scoped_to(1403)
        r = client.post("/api/settings/licenses", json=self._VALID_BODY)
        assert r.status_code == 201
        body = r.json()
        assert body["name"] == "Certified Pest Control Operator"
        assert body["aspireBranchId"] == 1403
        assert body["kind"] == "license"

        inserts = [
            c for c in mock_exec.await_args_list
            if "licenses_certifications" in c.args[0] and "INSERT" in c.args[0].upper()
        ]
        assert len(inserts) == 1

        audits = _audit_calls(mock_exec)
        assert len(audits) == 1
        flat = _flat_audit(audits[0])
        assert "branch" in flat
        assert "1403" in flat
        assert "test.user@juniperlandscaping.com" in flat

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_bm_create_out_of_scope_branch_403(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("manager")
        mock_authz_query.return_value = _scoped_to(1403)
        body = {**self._VALID_BODY, "aspireBranchId": 3696}
        r = client.post("/api/settings/licenses", json=body)
        assert r.status_code == 403
        mock_exec.assert_not_awaited()

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_bm_cannot_create_company_wide_403(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        """Company-wide (aspire_branch_id=None) rows are admin-only for BM."""
        as_role("manager")
        mock_authz_query.return_value = _scoped_to(1403)
        body = {**self._VALID_BODY, "aspireBranchId": None}
        r = client.post("/api/settings/licenses", json=body)
        assert r.status_code == 403
        mock_exec.assert_not_awaited()

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_admin_creates_company_wide_201(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        body = {**self._VALID_BODY, "aspireBranchId": None}
        r = client.post("/api/settings/licenses", json=body)
        assert r.status_code == 201
        audits = _audit_calls(mock_exec)
        assert len(audits) == 1
        flat = _flat_audit(audits[0])
        assert "company" in flat

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_admin_creates_for_any_branch_201(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        body = {**self._VALID_BODY, "aspireBranchId": 9999}
        r = client.post("/api/settings/licenses", json=body)
        assert r.status_code == 201
        audits = _audit_calls(mock_exec)
        assert len(audits) == 1
        flat = _flat_audit(audits[0])
        assert "branch" in flat and "9999" in flat


class TestLicensesUpdate:
    """PATCH /api/settings/licenses/{id}"""

    _EXISTING_ROW = _lc_row()

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_bm_updates_own_branch_row_200(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("manager")
        mock_authz_query.return_value = _scoped_to(1403)
        mock_query.return_value = [self._EXISTING_ROW]
        r = client.patch("/api/settings/licenses/lc-001", json={"name": "Updated License Name"})
        assert r.status_code == 200
        body = r.json()
        assert body["id"] == "lc-001"

        updates = [
            c for c in mock_exec.await_args_list
            if "UPDATE" in c.args[0].upper() and "licenses_certifications" in c.args[0]
        ]
        assert len(updates) == 1
        audits = _audit_calls(mock_exec)
        assert len(audits) == 1
        flat = _flat_audit(audits[0])
        assert "1403" in flat

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_bm_update_out_of_scope_row_403(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("manager")
        mock_authz_query.return_value = _scoped_to(1403)
        mock_query.return_value = [_lc_row(aspire_branch_id=3696)]
        r = client.patch("/api/settings/licenses/lc-001", json={"name": "Hax"})
        assert r.status_code == 403
        updates = [c for c in mock_exec.await_args_list if "UPDATE" in c.args[0].upper()]
        assert len(updates) == 0

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_bm_cannot_update_company_wide_row_403(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        """BM cannot edit company-wide (aspire_branch_id=None) rows."""
        as_role("manager")
        mock_authz_query.return_value = _scoped_to(1403)
        mock_query.return_value = [_lc_row(aspire_branch_id=None)]
        r = client.patch("/api/settings/licenses/lc-001", json={"name": "Hax"})
        assert r.status_code == 403

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_admin_can_edit_any_row(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        mock_query.return_value = [_lc_row(aspire_branch_id=9999)]
        r = client.patch("/api/settings/licenses/lc-001", json={"name": "Admin Edit"})
        assert r.status_code == 200


class TestLicensesDeactivate:
    """DELETE /api/settings/licenses/{id} — soft-delete (active=0), never hard DELETE."""

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_deactivate_sets_active_zero_never_hard_delete(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        """Core AC: deactivating a license sets active=0; NO DELETE SQL for licenses_certifications."""
        as_role("manager")
        mock_authz_query.return_value = _scoped_to(1403)
        mock_query.return_value = [_lc_row(aspire_branch_id=1403)]
        r = client.delete("/api/settings/licenses/lc-001")
        assert r.status_code == 200

        # Must UPDATE active=0, never DELETE.
        updates = [
            c for c in mock_exec.await_args_list
            if "UPDATE" in c.args[0].upper() and "licenses_certifications" in c.args[0]
        ]
        deletes = [
            c for c in mock_exec.await_args_list
            if "DELETE" in c.args[0].upper() and "licenses_certifications" in c.args[0]
        ]
        assert len(updates) == 1
        assert len(deletes) == 0, "Hard DELETE must NEVER be issued for licenses_certifications"

        # The UPDATE must carry active=0.
        update_params = updates[0].args[1]
        assert 0 in update_params

        # One audit row.
        audits = _audit_calls(mock_exec)
        assert len(audits) == 1
        flat = _flat_audit(audits[0])
        assert "1403" in flat or "branch" in flat

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_deactivate_out_of_scope_403(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("manager")
        mock_authz_query.return_value = _scoped_to(1403)
        mock_query.return_value = [_lc_row(aspire_branch_id=3696)]
        r = client.delete("/api/settings/licenses/lc-001")
        assert r.status_code == 403
        mock_exec.assert_not_awaited()


class TestLicensesList:
    """GET /api/settings/licenses — list with scope and active/expired filtering."""

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_include_expired_returns_deactivated_row(
        self, mock_query, mock_authz_query, as_role
    ):
        """AC: include_expired=true still returns the deactivated/expired row."""
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        # Simulate a deactivated + expired row being returned when include_expired=true.
        deactivated = _lc_row(active=0, expiry_date=datetime.date(2020, 1, 1))
        mock_query.return_value = [deactivated]
        r = client.get("/api/settings/licenses?include_expired=true")
        assert r.status_code == 200
        items = r.json()
        assert len(items) == 1
        assert items[0]["active"] is False

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_default_excludes_inactive_and_expired(
        self, mock_query, mock_authz_query, as_role
    ):
        """Default list excludes inactive rows (active=1 filter in SQL)."""
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        mock_query.return_value = []
        r = client.get("/api/settings/licenses")
        assert r.status_code == 200
        # Verify the SQL contains the active filter.
        sql = mock_query.call_args[0][0]
        assert "active = 1" in sql

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_date_fields_iso_serialized(
        self, mock_query, mock_authz_query, as_role
    ):
        """issued_date/expiry_date/updated_at must come back as ISO strings."""
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        mock_query.return_value = [_lc_row()]
        r = client.get("/api/settings/licenses")
        assert r.status_code == 200
        item = r.json()[0]
        assert item["issuedDate"] == "2025-01-15"
        assert item["expiryDate"] == "2027-01-14"
        # updated_at is a datetime — must be ISO, not a raw object.
        assert isinstance(item["updatedAt"], str)


# ── GCS scan upload for licenses_certifications ───────────────────────────────

class TestLicensesScanUpload:
    """POST /api/settings/licenses/{id}/scan — upload bytes via upload_bytes, store key."""

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    @patch("api.attachments.upload_bytes")
    async def test_upload_calls_upload_bytes_and_stores_key(
        self, mock_upload, mock_query, mock_exec, mock_authz_query, as_role
    ):
        """Core AC: upload routes bytes through upload_bytes; stores returned key in object_key."""
        as_role("manager")
        mock_authz_query.return_value = _scoped_to(1403)
        mock_query.return_value = [_lc_row(aspire_branch_id=1403, object_key=None)]
        # upload_bytes is void — the key is constructed by the endpoint.
        mock_upload.return_value = None

        pdf_bytes = b"%PDF-1.4 fake scan"
        r = client.post(
            "/api/settings/licenses/lc-001/scan",
            files={"file": ("scan.pdf", BytesIO(pdf_bytes), "application/pdf")},
        )
        assert r.status_code == 200
        body = r.json()
        # The endpoint must return the stored object_key.
        assert "objectKey" in body
        stored_key = body["objectKey"]
        assert stored_key  # non-empty

        # upload_bytes must have been called exactly once with the right bytes.
        mock_upload.assert_called_once()
        call_args = mock_upload.call_args
        assert call_args[0][1] == pdf_bytes  # data arg
        assert call_args[0][0] == stored_key  # key arg matches what was stored

        # An UPDATE must have set object_key in the DB.
        updates = [
            c for c in mock_exec.await_args_list
            if "UPDATE" in c.args[0].upper() and "licenses_certifications" in c.args[0]
        ]
        assert len(updates) == 1
        # stored_key must appear in the UPDATE params.
        assert stored_key in updates[0].args[1]

        # One audit row for the key update.
        audits = _audit_calls(mock_exec)
        assert len(audits) == 1

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    @patch("api.attachments.upload_bytes")
    async def test_upload_out_of_scope_403(
        self, mock_upload, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("manager")
        mock_authz_query.return_value = _scoped_to(1403)
        mock_query.return_value = [_lc_row(aspire_branch_id=3696)]
        r = client.post(
            "/api/settings/licenses/lc-001/scan",
            files={"file": ("scan.pdf", BytesIO(b"pdf"), "application/pdf")},
        )
        assert r.status_code == 403
        mock_upload.assert_not_called()
        mock_exec.assert_not_awaited()

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    @patch("api.attachments.upload_bytes")
    async def test_no_second_signing_route_added(
        self, mock_upload, mock_query, mock_exec, mock_authz_query, as_role
    ):
        """Verify the upload path reuses upload_bytes — no parallel uploader introduced."""
        # Confirm upload_bytes is the only GCS write function ever invoked.
        # This test imports and inspects — if a second upload helper were wired in,
        # it would NOT be patched here and would error (GCS not available in test env).
        as_role("manager")
        mock_authz_query.return_value = _scoped_to(1403)
        mock_query.return_value = [_lc_row(aspire_branch_id=1403)]
        mock_upload.return_value = None
        r = client.post(
            "/api/settings/licenses/lc-001/scan",
            files={"file": ("x.pdf", BytesIO(b"pdf"), "application/pdf")},
        )
        # If a second signer/uploader existed it would 500 (GCS not available).
        assert r.status_code == 200
        mock_upload.assert_called_once()


# ════════════════════════════════════════════════════════════════════════════════
# Handoff 42: Insurance documents via the unified /api/settings/licenses endpoint
# ════════════════════════════════════════════════════════════════════════════════
#
# After migration 027, insurance_certificates is dropped and its data lives in
# licenses_certifications with kind='insurance'. Insurance documents are now
# branch-scoped like licenses (no admin-only guard). The /api/settings/insurance
# endpoints have been removed; all operations go through /api/settings/licenses
# (or the /api/settings/documents alias) with kind='insurance'.


def _ins_lc_row(**over) -> dict:
    """An insurance-kind licenses_certifications DB row (post migration 027)."""
    row = {
        "id": "ins-001",
        "kind": "insurance",
        "name": "General Liability",   # label is now stored in name
        "issuing_body": None,
        "identifier": None,
        "holder_name": None,
        "aspire_branch_id": None,       # company-wide
        "issued_date": None,
        "expiry_date": datetime.date(2027, 6, 30),
        "object_key": "credentials/insurance/ins-001.pdf",
        "active": 1,
        "sort_order": 0,
        "updated_at": datetime.datetime(2026, 6, 1, 12, 0, 0),
    }
    row.update(over)
    return row


class TestInsuranceViaUnifiedEndpoint:
    """POST /api/settings/licenses with kind='insurance' — global-only policy.

    Insurance is a single company-wide document. Branch-scoped insurance rows
    are rejected (422). Creating a second active company-wide row is rejected
    (409). Company-wide rows require admin.
    """

    _VALID_BODY = {
        "kind": "insurance",
        "name": "General Liability",
        "expiryDate": "2027-06-30",
        "objectKey": "credentials/insurance/gl-2026.pdf",
        "aspireBranchId": None,  # company-wide
    }

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_create_insurance_company_wide_succeeds_when_none_exists(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        """Happy path: admin can create the single global insurance document when
        no active company-wide insurance row exists yet."""
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        # No existing active insurance row.
        mock_query.return_value = []
        r = client.post("/api/settings/licenses", json=self._VALID_BODY)
        assert r.status_code == 201
        body = r.json()
        assert body["kind"] == "insurance"
        assert body["name"] == "General Liability"
        assert body["expiryDate"] == "2027-06-30"
        assert body["aspireBranchId"] is None

        inserts = [
            c for c in mock_exec.await_args_list
            if "licenses_certifications" in c.args[0] and "INSERT" in c.args[0].upper()
        ]
        assert len(inserts) == 1

        audits = _audit_calls(mock_exec)
        assert len(audits) == 1
        flat = _flat_audit(audits[0])
        assert "company" in flat
        assert "test.user@juniperlandscaping.com" in flat

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_non_admin_cannot_create_company_wide_insurance_403(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        """BM cannot create a company-wide insurance document (aspireBranchId=None → admin-only)."""
        as_role("manager")
        mock_authz_query.return_value = _scoped_to(1403)
        r = client.post("/api/settings/licenses", json=self._VALID_BODY)
        assert r.status_code == 403
        mock_exec.assert_not_awaited()

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_create_insurance_with_branch_id_returns_422(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        """Insurance documents must be company-wide — any aspireBranchId value
        must be rejected with 422 before touching the DB."""
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        body = {**self._VALID_BODY, "aspireBranchId": 1403}
        r = client.post("/api/settings/licenses", json=body)
        assert r.status_code == 422
        detail = r.json().get("detail", "")
        assert "company-wide" in detail or "aspireBranchId" in detail
        mock_exec.assert_not_awaited()

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_create_insurance_when_active_exists_returns_409(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        """Creating a second active company-wide insurance row must be rejected
        with 409 — edit or replace the existing one instead."""
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        # Simulate an existing active company-wide insurance row.
        mock_query.return_value = [_ins_lc_row()]
        r = client.post("/api/settings/licenses", json=self._VALID_BODY)
        assert r.status_code == 409
        detail = r.json().get("detail", "")
        assert "already exists" in detail or "insurance" in detail.lower()
        mock_exec.assert_not_awaited()

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_expiry_date_required_for_insurance_422(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        """Handoff 42 AC: expiryDate is required when creating any document kind."""
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        body = {"kind": "insurance", "name": "GL", "aspireBranchId": None}
        r = client.post("/api/settings/licenses", json=body)
        assert r.status_code == 422
        mock_exec.assert_not_awaited()

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_expiry_date_required_for_license_422(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        """Handoff 42 AC: expiryDate is required for all kinds, including 'license'."""
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        # Missing expiryDate — should 422
        body = {
            "kind": "license",
            "name": "Certified Pest Control Operator",
            "aspireBranchId": None,
        }
        r = client.post("/api/settings/licenses", json=body)
        assert r.status_code == 422
        mock_exec.assert_not_awaited()

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_invalid_kind_422(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        """kind must be one of: license, certification, insurance."""
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        body = {**self._VALID_BODY, "kind": "contract"}
        r = client.post("/api/settings/licenses", json=body)
        assert r.status_code == 422
        mock_exec.assert_not_awaited()

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_old_insurance_endpoint_removed_404(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        """Verify the /api/settings/insurance endpoint no longer exists (404)."""
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        r = client.post("/api/settings/insurance", json=self._VALID_BODY)
        assert r.status_code == 404

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_patch_cannot_change_kind_to_insurance(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        """PATCH with kind='insurance' must be rejected with 400 — kind is immutable after
        creation. This blocks a BM from converting their branch license into an insurance
        row, bypassing the single-global invariant.

        Because 'kind' is excluded from _LC_UPDATABLE, the patch body produces no
        updatable fields, which causes the endpoint to respond 400 (no fields to update)
        before any DB write occurs.
        """
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        # Existing row is a plain license.
        mock_query.return_value = [_lc_row(aspire_branch_id=None, kind="license")]
        r = client.patch("/api/settings/licenses/lc-001", json={"kind": "insurance"})
        # kind is not in _LC_UPDATABLE, so no updatable fields → 400, no DB write.
        assert r.status_code == 400
        mock_exec.assert_not_awaited()

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_patch_on_insurance_row_succeeds(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        """Normal PATCH (name, expiryDate) on an existing insurance row still works.

        Removing 'kind' from _LC_UPDATABLE must not break legitimate edits to
        insurance documents — only the kind field itself is now immutable.
        """
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        # Existing insurance row (company-wide, aspire_branch_id=None).
        mock_query.return_value = [_ins_lc_row()]
        r = client.patch(
            "/api/settings/licenses/ins-001",
            json={"name": "Updated GL Policy", "expiryDate": "2028-06-30"},
        )
        assert r.status_code == 200
        updates = [
            c for c in mock_exec.await_args_list
            if "UPDATE" in c.args[0].upper() and "licenses_certifications" in c.args[0]
        ]
        assert len(updates) == 1
        # Audit entries: one per changed field (name + expiryDate = 2).
        audits = _audit_calls(mock_exec)
        assert len(audits) == 2


class TestInsuranceDeactivateViaUnified:
    """DELETE /api/settings/licenses/{id} for kind='insurance' rows.

    Insurance documents now use the same soft-delete path as licenses.
    Branch-scoped: company-wide rows (aspire_branch_id=None) still require admin.
    """

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_admin_deactivates_company_wide_insurance_200(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        """Admin can soft-delete a company-wide insurance doc."""
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        mock_query.return_value = [_ins_lc_row()]  # aspire_branch_id=None
        r = client.delete("/api/settings/licenses/ins-001")
        assert r.status_code == 200

        updates = [
            c for c in mock_exec.await_args_list
            if "UPDATE" in c.args[0].upper() and "licenses_certifications" in c.args[0]
        ]
        hard_deletes = [
            c for c in mock_exec.await_args_list
            if "DELETE" in c.args[0].upper() and "licenses_certifications" in c.args[0]
        ]
        assert len(updates) == 1
        assert len(hard_deletes) == 0, "Hard DELETE must never be issued"
        assert 0 in updates[0].args[1]

        audits = _audit_calls(mock_exec)
        assert len(audits) == 1
        flat = _flat_audit(audits[0])
        assert "company" in flat

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_bm_deactivates_own_branch_insurance_200(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        """Handoff 42 AC: BM can soft-delete a branch-scoped insurance row."""
        as_role("manager")
        mock_authz_query.return_value = _scoped_to(1403)
        mock_query.return_value = [_ins_lc_row(aspire_branch_id=1403)]
        r = client.delete("/api/settings/licenses/ins-001")
        assert r.status_code == 200
        audits = _audit_calls(mock_exec)
        assert len(audits) == 1

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_bm_cannot_deactivate_company_wide_insurance_403(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        """Company-wide insurance rows (aspire_branch_id=None) still require admin to deactivate."""
        as_role("manager")
        mock_authz_query.return_value = _scoped_to(1403)
        mock_query.return_value = [_ins_lc_row()]  # aspire_branch_id=None
        r = client.delete("/api/settings/licenses/ins-001")
        assert r.status_code == 403
        mock_exec.assert_not_awaited()


class TestInsuranceUpdateViaUnified:
    """PATCH /api/settings/licenses/{id} for insurance rows."""

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_admin_patches_insurance_name_200(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        mock_query.return_value = [_ins_lc_row()]
        r = client.patch("/api/settings/licenses/ins-001", json={"name": "Workers Comp"})
        assert r.status_code == 200
        body = r.json()
        assert body["id"] == "ins-001"

        updates = [
            c for c in mock_exec.await_args_list
            if "UPDATE" in c.args[0].upper() and "licenses_certifications" in c.args[0]
        ]
        assert len(updates) == 1
        audits = _audit_calls(mock_exec)
        assert len(audits) == 1

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_bm_patches_own_branch_insurance_200(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        """Handoff 42 AC: BM can patch branch-scoped insurance (no longer admin-only)."""
        as_role("manager")
        mock_authz_query.return_value = _scoped_to(1403)
        mock_query.return_value = [_ins_lc_row(aspire_branch_id=1403)]
        r = client.patch("/api/settings/licenses/ins-001", json={"expiryDate": "2028-01-01"})
        assert r.status_code == 200


class TestInsuranceListViaUnified:
    """GET /api/settings/licenses returns insurance-kind rows alongside license/certification."""

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_list_includes_insurance_rows(
        self, mock_query, mock_authz_query, as_role
    ):
        """The unified list returns all kinds including insurance."""
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        mock_query.return_value = [
            _lc_row(),                # kind='license'
            _ins_lc_row(),            # kind='insurance'
        ]
        r = client.get("/api/settings/licenses")
        assert r.status_code == 200
        items = r.json()
        kinds = {item["kind"] for item in items}
        assert "license" in kinds
        assert "insurance" in kinds

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_documents_alias_works(
        self, mock_query, mock_authz_query, as_role
    ):
        """GET /api/settings/documents is an alias for /api/settings/licenses."""
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        mock_query.return_value = [_ins_lc_row()]
        r = client.get("/api/settings/documents")
        assert r.status_code == 200
        items = r.json()
        assert len(items) == 1
        assert items[0]["kind"] == "insurance"


class TestInsuranceScanUploadViaUnified:
    """POST /api/settings/licenses/{id}/scan for insurance-kind rows."""

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    @patch("api.attachments.upload_bytes")
    async def test_admin_uploads_insurance_scan_200(
        self, mock_upload, mock_query, mock_exec, mock_authz_query, as_role
    ):
        """Upload endpoint works for insurance-kind rows (company-wide → admin)."""
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        mock_query.return_value = [_ins_lc_row(object_key=None)]
        mock_upload.return_value = None

        pdf_bytes = b"%PDF-1.4 insurance cert"
        r = client.post(
            "/api/settings/licenses/ins-001/scan",
            files={"file": ("cert.pdf", BytesIO(pdf_bytes), "application/pdf")},
        )
        assert r.status_code == 200
        body = r.json()
        assert "objectKey" in body
        stored_key = body["objectKey"]
        assert stored_key

        mock_upload.assert_called_once()
        call_args = mock_upload.call_args
        assert call_args[0][1] == pdf_bytes

        updates = [
            c for c in mock_exec.await_args_list
            if "UPDATE" in c.args[0].upper() and "licenses_certifications" in c.args[0]
        ]
        assert len(updates) == 1
        assert stored_key in updates[0].args[1]

        audits = _audit_calls(mock_exec)
        assert len(audits) == 1

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    @patch("api.attachments.upload_bytes")
    async def test_bm_uploads_own_branch_insurance_200(
        self, mock_upload, mock_query, mock_exec, mock_authz_query, as_role
    ):
        """Handoff 42 AC: BM can upload file for branch-scoped insurance row."""
        as_role("manager")
        mock_authz_query.return_value = _scoped_to(1403)
        mock_query.return_value = [_ins_lc_row(aspire_branch_id=1403, object_key=None)]
        mock_upload.return_value = None

        r = client.post(
            "/api/settings/licenses/ins-001/scan",
            files={"file": ("cert.pdf", BytesIO(b"pdf"), "application/pdf")},
        )
        assert r.status_code == 200
        mock_upload.assert_called_once()
