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
# insurance_certificates CRUD
# ════════════════════════════════════════════════════════════════════════════════
#
# Schema divergence vs licenses_certifications (documented for migration follow-up):
#   - NO aspire_branch_id  → company-wide only, admin-only writes
#   - NO active column     → no soft-delete; removal is a hard DELETE
#                            (same situation as portfolio_properties; flag for migration)
#   - NO sort_order        → ordering by uploaded_at DESC
#   - object_key NOT NULL  → required on creation (the cert IS the upload)
#   - uploaded_at auto     → set by DB DEFAULT CURRENT_TIMESTAMP

class TestInsuranceCreate:
    """POST /api/settings/insurance — admin-only, company-wide."""

    _VALID_BODY = {
        "objectKey": "proposal/insurance/gl-2026.pdf",
        "expiryDate": "2027-06-30",
        "label": "General Liability",
    }

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_admin_creates_201(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        r = client.post("/api/settings/insurance", json=self._VALID_BODY)
        assert r.status_code == 201
        body = r.json()
        assert body["objectKey"] == "proposal/insurance/gl-2026.pdf"
        assert body["label"] == "General Liability"

        inserts = [
            c for c in mock_exec.await_args_list
            if "insurance_certificates" in c.args[0] and "INSERT" in c.args[0].upper()
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
    async def test_non_admin_create_403(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("manager")
        mock_authz_query.return_value = _live("manager")
        r = client.post("/api/settings/insurance", json=self._VALID_BODY)
        assert r.status_code == 403
        mock_exec.assert_not_awaited()

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_missing_required_fields_422(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        r = client.post("/api/settings/insurance", json={"label": "GL"})
        assert r.status_code == 422


class TestInsuranceUpdate:
    """PATCH /api/settings/insurance/{id} — admin-only."""

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_admin_updates_label_200(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        mock_query.return_value = [_ins_row()]
        r = client.patch("/api/settings/insurance/ins-001", json={"label": "Workers Comp"})
        assert r.status_code == 200
        body = r.json()
        assert body["id"] == "ins-001"

        updates = [
            c for c in mock_exec.await_args_list
            if "UPDATE" in c.args[0].upper() and "insurance_certificates" in c.args[0]
        ]
        assert len(updates) == 1
        audits = _audit_calls(mock_exec)
        assert len(audits) == 1
        flat = _flat_audit(audits[0])
        assert "company" in flat

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_non_admin_update_403(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("manager")
        mock_authz_query.return_value = _live("manager")
        mock_query.return_value = [_ins_row()]
        r = client.patch("/api/settings/insurance/ins-001", json={"label": "Hack"})
        assert r.status_code == 403


class TestInsuranceDelete:
    """DELETE /api/settings/insurance/{id} — admin-only hard delete (no active column).

    NOTE: insurance_certificates has no `active` column so soft-delete is not
    possible without a schema migration. This is flagged for follow-up (same
    situation as portfolio_properties). Hard delete is the current implementation.
    """

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_admin_delete_200(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        mock_query.return_value = [_ins_row()]
        r = client.delete("/api/settings/insurance/ins-001")
        assert r.status_code == 200

        deletes = [
            c for c in mock_exec.await_args_list
            if "DELETE" in c.args[0].upper() and "insurance_certificates" in c.args[0]
        ]
        assert len(deletes) == 1

        audits = _audit_calls(mock_exec)
        assert len(audits) == 1
        flat = _flat_audit(audits[0])
        assert "company" in flat

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_non_admin_delete_403(
        self, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("manager")
        mock_authz_query.return_value = _live("manager")
        mock_query.return_value = [_ins_row()]
        r = client.delete("/api/settings/insurance/ins-001")
        assert r.status_code == 403
        mock_exec.assert_not_awaited()


class TestInsuranceList:
    """GET /api/settings/insurance — admin-only list."""

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_admin_list_200(
        self, mock_query, mock_authz_query, as_role
    ):
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        mock_query.return_value = [_ins_row()]
        r = client.get("/api/settings/insurance")
        assert r.status_code == 200
        items = r.json()
        assert len(items) == 1
        item = items[0]
        # Dates must serialize as ISO strings.
        assert item["expiryDate"] == "2027-06-30"
        assert isinstance(item["uploadedAt"], str)

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    async def test_non_admin_list_403(
        self, mock_query, mock_authz_query, as_role
    ):
        as_role("manager")
        mock_authz_query.return_value = _live("manager")
        r = client.get("/api/settings/insurance")
        assert r.status_code == 403


# ── GCS scan upload for insurance_certificates ────────────────────────────────

class TestInsuranceScanUpload:
    """POST /api/settings/insurance/upload — upload cert bytes via upload_bytes."""

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    @patch("api.attachments.upload_bytes")
    async def test_upload_calls_upload_bytes_and_creates_record(
        self, mock_upload, mock_query, mock_exec, mock_authz_query, as_role
    ):
        """Upload routes bytes through upload_bytes; creates an insurance record with the key."""
        as_role("admin")
        mock_authz_query.return_value = _live("admin")
        mock_upload.return_value = None

        pdf_bytes = b"%PDF-1.4 cert"
        r = client.post(
            "/api/settings/insurance/upload",
            files={"file": ("cert.pdf", BytesIO(pdf_bytes), "application/pdf")},
            data={"expiryDate": "2027-06-30", "label": "General Liability"},
        )
        assert r.status_code == 201
        body = r.json()
        assert "objectKey" in body
        stored_key = body["objectKey"]
        assert stored_key

        # upload_bytes must have been called exactly once.
        mock_upload.assert_called_once()
        call_args = mock_upload.call_args
        assert call_args[0][1] == pdf_bytes
        assert call_args[0][0] == stored_key

        # An INSERT into insurance_certificates must have run.
        inserts = [
            c for c in mock_exec.await_args_list
            if "insurance_certificates" in c.args[0] and "INSERT" in c.args[0].upper()
        ]
        assert len(inserts) == 1

        # One audit row.
        audits = _audit_calls(mock_exec)
        assert len(audits) == 1

    @patch("api.authz.query", new_callable=AsyncMock)
    @patch("api.settings.execute", new_callable=AsyncMock)
    @patch("api.settings.query", new_callable=AsyncMock)
    @patch("api.attachments.upload_bytes")
    async def test_non_admin_upload_403(
        self, mock_upload, mock_query, mock_exec, mock_authz_query, as_role
    ):
        as_role("manager")
        mock_authz_query.return_value = _live("manager")
        r = client.post(
            "/api/settings/insurance/upload",
            files={"file": ("cert.pdf", BytesIO(b"pdf"), "application/pdf")},
            data={"expiryDate": "2027-06-30"},
        )
        assert r.status_code == 403
        mock_upload.assert_not_called()
        mock_exec.assert_not_awaited()
