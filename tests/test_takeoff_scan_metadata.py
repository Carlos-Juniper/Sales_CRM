"""Takeoff Insert persistence & manual metadata.

Two feature slices, DB and GCS fully mocked:

1. Takeoff scan attachments — the Takeoff Insert scan reuses the GCS
   attachment flow with a new `takeoff_scan` kind that is ESTIMATE-scoped
   (intake_attachments.estimate_id, no intake submission required) and
   accepts image content types (the scan is a scanned map, not a PDF).

2. Manual turf area / curb miles — persisted on the estimate row via the
   standard PATCH endpoint and serialized back out. Beam AI automated
   takeoff is the eventual source of these values (paused — not built).
"""
from __future__ import annotations

import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("MYSQL_HOST", "localhost")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("ENTRA_CLIENT_ID", "x")
os.environ.setdefault("ENTRA_TENANT_ID", "x")
os.environ.setdefault("GCS_ATTACHMENTS_BUCKET", "test-bucket")
os.environ.setdefault("GCS_SIGNER_SA_EMAIL", "svc@project.iam.gserviceaccount.com")

import api.estimating as est  # noqa: E402
from api.server import app, require_auth  # noqa: E402

client = TestClient(app)

_USER = {
    "id": "u1", "name": "Alice", "email": "a@x.com", "role": "maintenance_estimating",
    "branch_id": "Orlando, FL", "avatar_initials": "AX",
}


@pytest.fixture
def authed():
    app.dependency_overrides[require_auth] = lambda: _USER
    yield
    app.dependency_overrides.clear()


_FAKE_UPLOAD_URL = "https://storage.googleapis.com/upload/resumable?session=abc"


def _scan_presign_payload(**over) -> dict:
    body = {
        "kind": "takeoff_scan",
        "fileName": "boundary-scan.png",
        "contentType": "image/png",
        "sizeBytes": 350_000,
    }
    body.update(over)
    return body


def _scan_row(**over) -> dict:
    """An estimate-scoped takeoff_scan attachment row (no intake submission)."""
    row = {
        "id": "att-scan1",
        "intake_submission_id": None,
        "estimate_id": "est-1",
        "file_name": "boundary-scan.png",
        "content_type": "image/png",
        "size_bytes": 350_000,
        "url": "",
        "kind": "takeoff_scan",
        "uploaded_by": "u1",
        "status": "stored",
        "object_key": "estimating/est-1/att-scan1.png",
        "created_at": "2026-08-01 10:00:00",
    }
    row.update(over)
    return row


def _full_est_row(**over) -> dict:
    """Every column _estimate_out touches, incl. the new manual takeoff fields."""
    row = {
        "id": "est-1", "estimate_type": "maintenance", "name": "Dobson Ranch HOA",
        "aspire_number": "ASP-1", "client_name": "Dobson Ranch HOA",
        "branch": "Phoenix-Desert", "customer_type": "hoa", "acreage": None,
        "contract_value_cents": 100_000, "target_margin": 0.22,
        "status": "in_progress", "lifecycle": "bidding",
        "aspire_owner": "estimating", "priority": "high", "win_probability": 0.6,
        "site_walk_date": None, "due_back_date": "2026-08-20",
        "anticipated_close_date": None, "service_start_date": None,
        "assigned_ls_estimator": None, "assigned_irr_estimator": None,
        "crm_rep": None, "notify_bm_rd_on_return": 1, "notes": None,
        "property_id": None, "aspire_opportunity_id": None,
        "aspire_sync_status": "pending", "rfi_status": None,
        "turf_area_acres": None, "curb_miles": None,
        "created_at": "2026-07-01 10:00:00", "updated_at": "2026-07-02 10:00:00",
    }
    row.update(over)
    return row


# ── Presign: takeoff_scan kind ────────────────────────────────────────────────

class TestTakeoffScanPresign:
    def test_image_scan_presigns_estimate_scoped_without_submission(self, authed):
        """A takeoff scan needs no intake submission — it hangs off the estimate."""
        with (
            patch("api.estimating.query", new_callable=AsyncMock) as mock_query,
            patch("api.estimating.execute", new_callable=AsyncMock) as mock_exec,
            patch("api.attachments.begin_resumable_session") as mock_session,
        ):
            # ONLY the estimate lookup — no intake_submissions query.
            mock_query.return_value = [{"id": "est-1"}]
            mock_session.return_value = _FAKE_UPLOAD_URL

            resp = client.post(
                "/api/estimating/estimates/est-1/attachments/presign",
                json=_scan_presign_payload(),
                headers={"Origin": "http://localhost:5173"},
            )

        assert resp.status_code == 201
        body = resp.json()
        assert body["objectKey"].startswith("estimating/est-1/")
        assert body["objectKey"].endswith(".png")
        assert body["uploadUrl"] == _FAKE_UPLOAD_URL

        # The resumable session must carry the image content type, not pdf.
        args = mock_session.call_args.args
        assert "image/png" in args

        # The pending row is linked to the estimate, kind=takeoff_scan.
        sql, params = mock_exec.call_args.args
        assert "intake_attachments" in sql
        assert "estimate_id" in sql
        assert "takeoff_scan" in params
        assert "est-1" in params

    @pytest.mark.parametrize(
        "content_type,ext",
        [("image/jpeg", ".jpg"), ("image/webp", ".webp"), ("application/pdf", ".pdf")],
    )
    def test_scan_accepts_common_scan_types_with_right_extension(
        self, authed, content_type, ext
    ):
        with (
            patch("api.estimating.query", new_callable=AsyncMock) as mock_query,
            patch("api.estimating.execute", new_callable=AsyncMock),
            patch("api.attachments.begin_resumable_session") as mock_session,
        ):
            mock_query.return_value = [{"id": "est-1"}]
            mock_session.return_value = _FAKE_UPLOAD_URL
            resp = client.post(
                "/api/estimating/estimates/est-1/attachments/presign",
                json=_scan_presign_payload(contentType=content_type),
            )
        assert resp.status_code == 201
        assert resp.json()["objectKey"].endswith(ext)

    def test_scan_rejects_unsupported_content_type(self, authed):
        with (
            patch("api.estimating.query", new_callable=AsyncMock) as mock_query,
            patch("api.estimating.execute", new_callable=AsyncMock) as mock_exec,
        ):
            mock_query.return_value = [{"id": "est-1"}]
            resp = client.post(
                "/api/estimating/estimates/est-1/attachments/presign",
                json=_scan_presign_payload(contentType="text/plain", fileName="notes.txt"),
            )
        assert resp.status_code == 400
        mock_exec.assert_not_called()

    def test_intake_kinds_remain_pdf_only(self, authed):
        """The relaxed image allowance is takeoff_scan-scoped — intake stays PDF."""
        with (
            patch("api.estimating.query", new_callable=AsyncMock) as mock_query,
            patch("api.estimating.execute", new_callable=AsyncMock) as mock_exec,
        ):
            mock_query.return_value = [{"id": "est-1"}]
            resp = client.post(
                "/api/estimating/estimates/est-1/attachments/presign",
                json=_scan_presign_payload(kind="property_map"),
            )
        assert resp.status_code == 400
        mock_exec.assert_not_called()


# ── Confirm: validates against the presigned content type ────────────────────

class TestTakeoffScanConfirm:
    def _blob(self, content_type="image/png", size=350_000):
        blob = MagicMock()
        blob.content_type = content_type
        blob.size = size
        return blob

    def test_confirm_stores_image_scan(self, authed):
        with (
            patch("api.estimating.query", new_callable=AsyncMock) as mock_query,
            patch("api.estimating.execute", new_callable=AsyncMock) as mock_exec,
            patch("api.attachments.head") as mock_head,
        ):
            mock_query.return_value = [_scan_row(status="pending")]
            mock_head.return_value = self._blob()

            resp = client.post(
                "/api/estimating/estimates/est-1/attachments/att-scan1/confirm"
            )

        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "stored"
        assert body["kind"] == "takeoff_scan"
        assert body["downloadable"] is True
        sql, params = mock_exec.call_args.args
        assert "stored" in params

    def test_confirm_rejects_content_type_mismatch(self, authed):
        """The landed blob must match what presign authorized — else flip failed."""
        with (
            patch("api.estimating.query", new_callable=AsyncMock) as mock_query,
            patch("api.estimating.execute", new_callable=AsyncMock) as mock_exec,
            patch("api.attachments.head") as mock_head,
        ):
            mock_query.return_value = [_scan_row(status="pending")]
            mock_head.return_value = self._blob(content_type="application/x-msdownload")

            resp = client.post(
                "/api/estimating/estimates/est-1/attachments/att-scan1/confirm"
            )

        assert resp.status_code == 400
        sql, params = mock_exec.call_args.args
        assert "failed" in params


# ── Estimate-scoped listing / signed download (survives reload) ─────────────

class TestEstimateScopedAttachmentRead:
    def test_list_returns_estimate_linked_scan_rows(self, authed):
        with patch("api.estimating.query", new_callable=AsyncMock) as mock_query:
            mock_query.side_effect = [
                [{"id": "est-1"}],
                [_scan_row()],
            ]
            resp = client.get("/api/estimating/estimates/est-1/attachments")

        assert resp.status_code == 200
        rows = resp.json()
        assert len(rows) == 1
        assert rows[0]["kind"] == "takeoff_scan"
        assert rows[0]["estimateId"] == "est-1"
        assert rows[0]["intakeSubmissionId"] is None
        assert rows[0]["downloadable"] is True

        # The list query must match rows linked directly via ia.estimate_id
        # (takeoff scans) as well as legacy submission-joined rows.
        list_sql = mock_query.call_args_list[1].args[0]
        assert "ia.estimate_id" in list_sql
        assert "LEFT JOIN" in list_sql.upper()

    def test_download_url_for_estimate_linked_scan(self, authed):
        with (
            patch("api.estimating.query", new_callable=AsyncMock) as mock_query,
            patch("api.attachments.signed_get_url") as mock_sign,
        ):
            mock_query.return_value = [_scan_row()]
            mock_sign.return_value = "https://signed.example/scan.png"

            resp = client.get(
                "/api/estimating/estimates/est-1/attachments/att-scan1/download-url"
            )

        assert resp.status_code == 200
        assert resp.json()["url"] == "https://signed.example/scan.png"
        mock_sign.assert_called_once_with(
            "estimating/est-1/att-scan1.png", "boundary-scan.png"
        )


# ── Manual turf area / curb miles (Beam is the FUTURE source — not built) ────

class TestManualTakeoffMetadata:
    def test_patch_persists_turf_and_curb(self, authed):
        with (
            patch("api.estimating.query", new_callable=AsyncMock) as mock_query,
            patch("api.estimating.execute", new_callable=AsyncMock) as mock_exec,
            patch("api.estimating._push_takeoff_qtys_bg", new_callable=AsyncMock),
        ):
            mock_query.side_effect = [
                # current-status guard read
                [{"estimate_type": "maintenance", "status": "in_progress",
                  "aspire_opportunity_id": None}],
                # _load_estimate: estimate row + (no) sections + SLA window
                [_full_est_row(turf_area_acres=12.5, curb_miles=3.4)],
                [],
                [{"sla_return_window_days": 14}],
            ]
            resp = client.patch(
                "/api/estimating/estimates/est-1",
                json={"turfAreaAcres": 12.5, "curbMiles": 3.4},
            )

        assert resp.status_code == 200
        body = resp.json()
        assert body["turfAreaAcres"] == 12.5
        assert body["curbMiles"] == 3.4

        update_sql, update_params = mock_exec.call_args.args
        assert "turf_area_acres = %s" in update_sql
        assert "curb_miles = %s" in update_sql
        assert 12.5 in update_params
        assert 3.4 in update_params

    def test_updatable_map_exposes_manual_takeoff_fields(self):
        assert est._UPDATABLE["turfAreaAcres"] == "turf_area_acres"
        assert est._UPDATABLE["curbMiles"] == "curb_miles"

    def test_estimate_out_defaults_null_for_premigration_rows(self):
        row = _full_est_row()
        del row["turf_area_acres"]
        del row["curb_miles"]
        out = est._estimate_out(row, [])
        assert out["turfAreaAcres"] is None
        assert out["curbMiles"] is None

    def test_estimate_out_serializes_decimals(self):
        from decimal import Decimal

        out = est._estimate_out(
            _full_est_row(turf_area_acres=Decimal("12.50"), curb_miles=Decimal("3.40")),
            [],
        )
        assert out["turfAreaAcres"] == 12.5
        assert out["curbMiles"] == 3.4
