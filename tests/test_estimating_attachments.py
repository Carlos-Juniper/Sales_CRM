"""Tests for the GCS attachment endpoints registered in api/estimating.py.

DB and GCS are fully mocked — no MySQL, no network.

Contract under test:
  POST .../attachments/presign       → validate pdf+size, write pending row, return session URI
  POST .../attachments/{id}/confirm  → blob.reload(), flip to stored (or failed on mismatch)
  GET  .../attachments               → list with downloadable flag
  GET  .../attachments/{id}/download-url → v4 signed GET URL; authz via estimate join
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

from api.server import app, require_auth  # noqa: E402

client = TestClient(app)

_USER = {
    "id": "u1", "name": "Alice", "email": "a@x.com", "role": "estimator",
    "branch_id": "Orlando, FL", "avatar_initials": "AX",
}


@pytest.fixture
def authed():
    app.dependency_overrides[require_auth] = lambda: _USER
    yield
    app.dependency_overrides.clear()


def _att_row(**over) -> dict:
    """Canonical attachment row as returned by `query`."""
    row = {
        "id": "att-abc123",
        "intake_submission_id": "ins-1",
        "file_name": "site_plan.pdf",
        "content_type": "application/pdf",
        "size_bytes": 512_000,
        "url": "",
        "kind": "property_map",
        "uploaded_by": "u1",
        "status": "stored",
        "object_key": "estimating/est-1/att-abc123.pdf",
        "created_at": "2026-07-01 10:00:00",
    }
    row.update(over)
    return row


_PRESIGN_PAYLOAD = {
    "kind": "property_map",
    "fileName": "site.pdf",
    "contentType": "application/pdf",
    "sizeBytes": 1024,
}

_FAKE_UPLOAD_URL = "https://storage.googleapis.com/upload/resumable?session=abc"


# ── POST .../attachments/presign ──────────────────────────────────────────────

class TestPresign:
    def test_valid_pdf_writes_pending_row_and_returns_session(self, authed):
        with (
            patch("api.estimating.query", new_callable=AsyncMock) as mock_query,
            patch("api.estimating.execute", new_callable=AsyncMock) as mock_exec,
            patch("api.attachments.begin_resumable_session") as mock_session,
        ):
            mock_query.side_effect = [
                [{"id": "est-1"}],   # estimate exists
                [{"id": "ins-1"}],   # intake submission exists
            ]
            mock_session.return_value = _FAKE_UPLOAD_URL
            mock_exec.return_value = 1

            resp = client.post(
                "/api/estimating/estimates/est-1/attachments/presign",
                json=_PRESIGN_PAYLOAD,
                headers={"Origin": "http://localhost:5173"},
            )

        assert resp.status_code == 201
        body = resp.json()
        assert "attachmentId" in body
        assert body["objectKey"].startswith("estimating/est-1/")
        assert body["objectKey"].endswith(".pdf")
        assert body["uploadUrl"] == _FAKE_UPLOAD_URL
        # INSERT must have written a pending row
        sql, params = mock_exec.call_args.args
        assert "intake_attachments" in sql
        assert "pending" in params

    def test_rejects_non_pdf_before_db_write(self, authed):
        with (
            patch("api.estimating.query", new_callable=AsyncMock) as mock_query,
            patch("api.estimating.execute", new_callable=AsyncMock) as mock_exec,
        ):
            mock_query.return_value = [{"id": "est-1"}]
            resp = client.post(
                "/api/estimating/estimates/est-1/attachments/presign",
                json={**_PRESIGN_PAYLOAD, "contentType": "application/vnd.ms-excel",
                      "fileName": "budget.xlsx"},
            )

        assert resp.status_code == 400
        mock_exec.assert_not_called()

    def test_rejects_oversize_before_db_write(self, authed):
        with (
            patch("api.estimating.query", new_callable=AsyncMock) as mock_query,
            patch("api.estimating.execute", new_callable=AsyncMock) as mock_exec,
        ):
            mock_query.return_value = [{"id": "est-1"}]
            resp = client.post(
                "/api/estimating/estimates/est-1/attachments/presign",
                json={**_PRESIGN_PAYLOAD, "sizeBytes": 3 * 1024 * 1024 * 1024},
            )

        assert resp.status_code == 400
        mock_exec.assert_not_called()

    def test_rejects_zero_size(self, authed):
        with (
            patch("api.estimating.query", new_callable=AsyncMock) as mock_query,
            patch("api.estimating.execute", new_callable=AsyncMock) as mock_exec,
        ):
            mock_query.return_value = [{"id": "est-1"}]
            resp = client.post(
                "/api/estimating/estimates/est-1/attachments/presign",
                json={**_PRESIGN_PAYLOAD, "sizeBytes": 0},
            )

        assert resp.status_code == 400
        mock_exec.assert_not_called()

    def test_rejects_negative_size(self, authed):
        with (
            patch("api.estimating.query", new_callable=AsyncMock) as mock_query,
            patch("api.estimating.execute", new_callable=AsyncMock) as mock_exec,
        ):
            mock_query.return_value = [{"id": "est-1"}]
            resp = client.post(
                "/api/estimating/estimates/est-1/attachments/presign",
                json={**_PRESIGN_PAYLOAD, "sizeBytes": -1},
            )

        assert resp.status_code == 400
        mock_exec.assert_not_called()

    def test_origin_allowlist_strips_untrusted_origin(self, authed):
        """An untrusted Origin must not be reflected into the GCS session grant."""
        with (
            patch("api.estimating.query", new_callable=AsyncMock) as mock_query,
            patch("api.estimating.execute", new_callable=AsyncMock) as mock_exec,
            patch("api.attachments.begin_resumable_session") as mock_session,
        ):
            mock_query.side_effect = [
                [{"id": "est-1"}],
                [{"id": "ins-1"}],
            ]
            mock_session.return_value = _FAKE_UPLOAD_URL
            mock_exec.return_value = 1

            client.post(
                "/api/estimating/estimates/est-1/attachments/presign",
                json=_PRESIGN_PAYLOAD,
                headers={"Origin": "https://evil.example.com"},
            )

        # begin_resumable_session must have been called with empty origin string.
        _, called_origin = mock_session.call_args.args[1], mock_session.call_args.args[2]
        assert called_origin == ""

    def test_404_for_missing_estimate(self, authed):
        with patch("api.estimating.query", new_callable=AsyncMock) as mock_query:
            mock_query.return_value = []
            resp = client.post(
                "/api/estimating/estimates/est-missing/attachments/presign",
                json=_PRESIGN_PAYLOAD,
            )
        assert resp.status_code == 404

    def test_404_when_no_intake_submission(self, authed):
        with (
            patch("api.estimating.query", new_callable=AsyncMock) as mock_query,
            patch("api.estimating.execute", new_callable=AsyncMock),
            patch("api.attachments.begin_resumable_session"),
        ):
            mock_query.side_effect = [
                [{"id": "est-1"}],   # estimate exists
                [],                   # no intake submission
            ]
            resp = client.post(
                "/api/estimating/estimates/est-1/attachments/presign",
                json=_PRESIGN_PAYLOAD,
            )
        assert resp.status_code == 404

    def test_kind_defaults_to_other_when_omitted(self, authed):
        with (
            patch("api.estimating.query", new_callable=AsyncMock) as mock_query,
            patch("api.estimating.execute", new_callable=AsyncMock) as mock_exec,
            patch("api.attachments.begin_resumable_session", return_value=_FAKE_UPLOAD_URL),
        ):
            mock_query.side_effect = [
                [{"id": "est-1"}],
                [{"id": "ins-1"}],
            ]
            mock_exec.return_value = 1
            payload = {k: v for k, v in _PRESIGN_PAYLOAD.items() if k != "kind"}
            client.post(
                "/api/estimating/estimates/est-1/attachments/presign", json=payload
            )
        _, params = mock_exec.call_args.args
        assert "other" in params


# ── POST .../attachments/{id}/confirm ─────────────────────────────────────────

class TestConfirm:
    def test_flips_pending_to_stored(self, authed):
        with (
            patch("api.estimating.query", new_callable=AsyncMock) as mock_query,
            patch("api.estimating.execute", new_callable=AsyncMock) as mock_exec,
            patch("api.attachments.head") as mock_head,
        ):
            mock_query.return_value = [
                _att_row(status="pending"),
            ]
            blob = MagicMock()
            blob.content_type = "application/pdf"
            blob.size = 512_000
            mock_head.return_value = blob
            mock_exec.return_value = 1

            resp = client.post(
                "/api/estimating/estimates/est-1/attachments/att-abc123/confirm",
            )

        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "stored"
        assert body["downloadable"] is True

    def test_sets_failed_on_content_type_mismatch(self, authed):
        with (
            patch("api.estimating.query", new_callable=AsyncMock) as mock_query,
            patch("api.estimating.execute", new_callable=AsyncMock) as mock_exec,
            patch("api.attachments.head") as mock_head,
        ):
            mock_query.return_value = [_att_row(status="pending")]
            blob = MagicMock()
            blob.content_type = "text/plain"   # wrong type
            blob.size = 512_000
            mock_head.return_value = blob
            mock_exec.return_value = 1

            resp = client.post(
                "/api/estimating/estimates/est-1/attachments/att-abc123/confirm",
            )

        assert resp.status_code == 400
        _, params = mock_exec.call_args.args
        assert "failed" in params

    def test_sets_failed_on_size_zero(self, authed):
        with (
            patch("api.estimating.query", new_callable=AsyncMock) as mock_query,
            patch("api.estimating.execute", new_callable=AsyncMock) as mock_exec,
            patch("api.attachments.head") as mock_head,
        ):
            mock_query.return_value = [_att_row(status="pending")]
            blob = MagicMock()
            blob.content_type = "application/pdf"
            blob.size = 0   # upload didn't land
            mock_head.return_value = blob
            mock_exec.return_value = 1

            resp = client.post(
                "/api/estimating/estimates/est-1/attachments/att-abc123/confirm",
            )

        assert resp.status_code == 400

    def test_404_for_missing_attachment(self, authed):
        with patch("api.estimating.query", new_callable=AsyncMock) as mock_query:
            mock_query.return_value = []
            resp = client.post(
                "/api/estimating/estimates/est-1/attachments/att-missing/confirm",
            )
        assert resp.status_code == 404

    def test_409_for_legacy_row_with_null_object_key(self, authed):
        """Confirm on a legacy name-only row (object_key=NULL) must not call head(None)."""
        with (
            patch("api.estimating.query", new_callable=AsyncMock) as mock_query,
            patch("api.attachments.head") as mock_head,
        ):
            mock_query.return_value = [_att_row(object_key=None, status="pending")]
            resp = client.post(
                "/api/estimating/estimates/est-1/attachments/att-legacy/confirm",
            )

        assert resp.status_code == 409
        mock_head.assert_not_called()


# ── GET .../attachments ────────────────────────────────────────────────────────

class TestListAttachments:
    def test_returns_list_with_downloadable_true_for_stored_with_key(self, authed):
        with patch("api.estimating.query", new_callable=AsyncMock) as mock_query:
            mock_query.side_effect = [
                [{"id": "est-1"}],   # estimate exists
                [_att_row()],        # stored + object_key set
            ]
            resp = client.get("/api/estimating/estimates/est-1/attachments")

        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        att = data[0]
        assert att["downloadable"] is True
        assert att["fileName"] == "site_plan.pdf"
        assert att["kind"] == "property_map"

    def test_legacy_rows_missing_object_key_have_downloadable_false(self, authed):
        with patch("api.estimating.query", new_callable=AsyncMock) as mock_query:
            mock_query.side_effect = [
                [{"id": "est-1"}],
                [_att_row(status="stored", object_key=None)],
            ]
            resp = client.get("/api/estimating/estimates/est-1/attachments")

        assert resp.status_code == 200
        assert resp.json()[0]["downloadable"] is False

    def test_pending_rows_have_downloadable_false(self, authed):
        with patch("api.estimating.query", new_callable=AsyncMock) as mock_query:
            mock_query.side_effect = [
                [{"id": "est-1"}],
                [_att_row(status="pending")],
            ]
            resp = client.get("/api/estimating/estimates/est-1/attachments")

        assert resp.status_code == 200
        assert resp.json()[0]["downloadable"] is False

    def test_404_for_missing_estimate(self, authed):
        with patch("api.estimating.query", new_callable=AsyncMock) as mock_query:
            mock_query.return_value = []
            resp = client.get("/api/estimating/estimates/est-missing/attachments")
        assert resp.status_code == 404

    def test_returns_empty_list_when_no_attachments(self, authed):
        with patch("api.estimating.query", new_callable=AsyncMock) as mock_query:
            mock_query.side_effect = [
                [{"id": "est-1"}],
                [],
            ]
            resp = client.get("/api/estimating/estimates/est-1/attachments")

        assert resp.status_code == 200
        assert resp.json() == []


# ── Content-Disposition sanitization (L2) ─────────────────────────────────────

class TestContentDispositionSanitization:
    """The client-supplied filename is embedded in a response header on the
    signed GET URL — quotes, CR/LF, and backslashes must never survive."""

    def test_hostile_filename_is_neutralized(self):
        import api.attachments as att
        hostile = 'evil";\r\nX-Injected: 1\\ name="pwn.txt'
        disp = att.content_disposition(hostile)
        assert "\r" not in disp and "\n" not in disp
        # The quoted-string fallback carries no raw quote or backslash.
        fallback = disp.split('filename="', 1)[1].split('"', 1)[0]
        assert '"' not in fallback and "\\" not in fallback

    def test_plain_filename_round_trips(self):
        import api.attachments as att
        disp = att.content_disposition("site plan.pdf")
        assert disp.startswith("attachment; ")
        assert 'filename="site plan.pdf"' in disp
        assert "filename*=UTF-8''site%20plan.pdf" in disp

    def test_unicode_name_stays_ascii_via_rfc5987(self):
        import api.attachments as att
        disp = att.content_disposition("plán—final.pdf")
        assert disp.isascii()          # header-safe
        assert "UTF-8''" in disp       # full name preserved percent-encoded

    def test_empty_name_falls_back_to_download(self):
        import api.attachments as att
        assert 'filename="download"' in att.content_disposition("")


# ── GET .../attachments/{id}/download-url ─────────────────────────────────────

class TestDownloadUrl:
    def test_returns_signed_url_for_stored_attachment(self, authed):
        with (
            patch("api.estimating.query", new_callable=AsyncMock) as mock_query,
            patch("api.attachments.signed_get_url") as mock_sign,
        ):
            mock_query.return_value = [_att_row()]
            mock_sign.return_value = "https://storage.googleapis.com/signed?token=x"

            resp = client.get(
                "/api/estimating/estimates/est-1/attachments/att-abc123/download-url"
            )

        assert resp.status_code == 200
        body = resp.json()
        assert "storage.googleapis.com" in body["url"]
        assert body["expiresIn"] == 600   # 10 min × 60 sec

    def test_409_for_pending_attachment(self, authed):
        with patch("api.estimating.query", new_callable=AsyncMock) as mock_query:
            mock_query.return_value = [_att_row(status="pending")]
            resp = client.get(
                "/api/estimating/estimates/est-1/attachments/att-abc123/download-url"
            )
        assert resp.status_code == 409

    def test_404_for_missing_attachment(self, authed):
        with patch("api.estimating.query", new_callable=AsyncMock) as mock_query:
            mock_query.return_value = []
            resp = client.get(
                "/api/estimating/estimates/est-1/attachments/att-missing/download-url"
            )
        assert resp.status_code == 404

    def test_404_for_attachment_belonging_to_different_estimate(self, authed):
        """authz join (attachments → intake_submissions → estimates) returns empty
        if the {attachmentId} does not belong to {estimateId}."""
        with patch("api.estimating.query", new_callable=AsyncMock) as mock_query:
            # The query must join on the estimate_id — simulate cross-access by
            # returning no rows (as the authz query would produce).
            mock_query.return_value = []
            resp = client.get(
                "/api/estimating/estimates/est-other/attachments/att-abc123/download-url"
            )
        assert resp.status_code == 404


# ── RFP documents: PDF, Word, and Excel on both intakes ───────────────────────
#
# Maintenance and install intake both upload kind="rfp" through this presign
# endpoint. Extension and MIME must agree; other intake kinds stay PDF-only.

_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


class TestRfpDocumentUploads:
    @pytest.mark.parametrize(
        "file_name,content_type,ext",
        [
            ("scope.pdf", "application/pdf", ".pdf"),
            ("scope.PDF", "Application/PDF", ".pdf"),
            ("bid.doc", "application/msword", ".doc"),
            ("bid.docx", _DOCX, ".docx"),
            ("pricing.xls", "application/vnd.ms-excel", ".xls"),
            ("pricing.xlsx", _XLSX, ".xlsx"),
        ],
    )
    def test_presign_accepts_rfp_types_and_stores_canonical_mime(
        self, authed, file_name, content_type, ext
    ):
        with (
            patch("api.estimating.query", new_callable=AsyncMock) as mock_query,
            patch("api.estimating.execute", new_callable=AsyncMock) as mock_exec,
            patch("api.attachments.begin_resumable_session") as mock_session,
        ):
            mock_query.side_effect = [
                [{"id": "est-1"}],
                [{"id": "ins-1"}],
            ]
            mock_session.return_value = _FAKE_UPLOAD_URL
            mock_exec.return_value = 1

            resp = client.post(
                "/api/estimating/estimates/est-1/attachments/presign",
                json={
                    "kind": "rfp",
                    "fileName": file_name,
                    "contentType": content_type,
                    "sizeBytes": 2048,
                },
            )

        assert resp.status_code == 201
        body = resp.json()
        assert body["objectKey"].startswith("estimating/est-1/")
        assert body["objectKey"].endswith(ext)
        assert body["uploadUrl"] == _FAKE_UPLOAD_URL
        canonical = content_type.split(";")[0].strip().lower()
        assert body["contentType"] == canonical

        session_key, session_type, _origin = mock_session.call_args.args
        assert session_key == body["objectKey"]
        assert session_type == canonical

        _sql, params = mock_exec.call_args.args
        assert "rfp" in params
        assert session_type in params
        assert file_name in params
        assert "pending" in params

    def test_presign_rejects_exe(self, authed):
        with (
            patch("api.estimating.query", new_callable=AsyncMock) as mock_query,
            patch("api.estimating.execute", new_callable=AsyncMock) as mock_exec,
        ):
            mock_query.return_value = [{"id": "est-1"}]
            resp = client.post(
                "/api/estimating/estimates/est-1/attachments/presign",
                json={
                    "kind": "rfp",
                    "fileName": "payload.exe",
                    "contentType": "application/pdf",
                    "sizeBytes": 1024,
                },
            )

        assert resp.status_code == 400
        assert resp.json()["detail"] == (
            "RFP documents must be PDF, Word (.doc, .docx), or Excel (.xls, .xlsx)"
        )
        mock_exec.assert_not_called()

    def test_presign_rejects_extension_mime_mismatch(self, authed):
        with (
            patch("api.estimating.query", new_callable=AsyncMock) as mock_query,
            patch("api.estimating.execute", new_callable=AsyncMock) as mock_exec,
        ):
            mock_query.return_value = [{"id": "est-1"}]
            resp = client.post(
                "/api/estimating/estimates/est-1/attachments/presign",
                json={
                    "kind": "rfp",
                    "fileName": "budget.xlsx",
                    "contentType": "application/pdf",
                    "sizeBytes": 1024,
                },
            )

        assert resp.status_code == 400
        assert resp.json()["detail"] == (
            "RFP file extension does not match its content type"
        )
        mock_exec.assert_not_called()

    def test_other_intake_kinds_stay_pdf_only(self, authed):
        with (
            patch("api.estimating.query", new_callable=AsyncMock) as mock_query,
            patch("api.estimating.execute", new_callable=AsyncMock) as mock_exec,
        ):
            mock_query.return_value = [{"id": "est-1"}]
            resp = client.post(
                "/api/estimating/estimates/est-1/attachments/presign",
                json={
                    "kind": "property_map",
                    "fileName": "budget.xlsx",
                    "contentType": _XLSX,
                    "sizeBytes": 1024,
                },
            )

        assert resp.status_code == 400
        assert resp.json()["detail"] == "Only PDF attachments are supported"
        mock_exec.assert_not_called()

    def test_confirm_stores_docx_content_type(self, authed):
        with (
            patch("api.estimating.query", new_callable=AsyncMock) as mock_query,
            patch("api.estimating.execute", new_callable=AsyncMock) as mock_exec,
            patch("api.attachments.head") as mock_head,
        ):
            mock_query.return_value = [
                _att_row(
                    status="pending",
                    kind="rfp",
                    file_name="bid.docx",
                    content_type=_DOCX,
                    object_key="estimating/est-1/att-abc123.docx",
                )
            ]
            blob = MagicMock()
            blob.content_type = _DOCX
            blob.size = 80_000
            mock_head.return_value = blob

            resp = client.post(
                "/api/estimating/estimates/est-1/attachments/att-abc123/confirm",
            )

        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "stored"
        assert body["kind"] == "rfp"
        assert body["contentType"] == _DOCX
        assert body["downloadable"] is True
        _sql, params = mock_exec.call_args.args
        assert "stored" in params
        assert _DOCX in params

    @pytest.mark.parametrize(
        "file_name,content_type,ext",
        [
            ("scope.pdf", "application/pdf", ".pdf"),
            ("bid.doc", "application/msword", ".doc"),
            ("pricing.xlsx", _XLSX, ".xlsx"),
        ],
    )
    def test_download_url_serves_stored_content_type(
        self, authed, file_name, content_type, ext
    ):
        with (
            patch("api.estimating.query", new_callable=AsyncMock) as mock_query,
            patch("api.attachments.signed_get_url") as mock_sign,
        ):
            mock_query.return_value = [
                _att_row(
                    kind="rfp",
                    file_name=file_name,
                    content_type=content_type,
                    object_key=f"estimating/est-1/att-abc123{ext}",
                )
            ]
            mock_sign.return_value = "https://storage.googleapis.com/signed?token=x"

            resp = client.get(
                "/api/estimating/estimates/est-1/attachments/att-abc123/download-url"
            )

        assert resp.status_code == 200
        mock_sign.assert_called_once_with(
            f"estimating/est-1/att-abc123{ext}",
            file_name,
            content_type=content_type,
        )


class TestSignedUrlContentType:
    def test_response_type_is_set_when_content_type_given(self):
        import api.attachments as att

        blob = MagicMock()
        blob.generate_signed_url.return_value = "https://storage.googleapis.com/signed"
        bucket = MagicMock()
        bucket.blob.return_value = blob
        gcs = MagicMock()
        gcs.bucket.return_value = bucket
        creds = MagicMock()
        creds.token = "tok"

        with (
            patch.object(att, "_gcs", return_value=gcs),
            patch("google.auth.default", return_value=(creds, None)),
        ):
            url = att.signed_get_url(
                "estimating/est-1/att-1.xlsx",
                "pricing.xlsx",
                content_type=_XLSX,
            )

        assert url == "https://storage.googleapis.com/signed"
        kwargs = blob.generate_signed_url.call_args.kwargs
        assert kwargs["response_type"] == _XLSX
        assert "pricing.xlsx" in kwargs["response_disposition"]

    def test_response_type_omitted_when_content_type_absent(self):
        import api.attachments as att

        blob = MagicMock()
        blob.generate_signed_url.return_value = "https://storage.googleapis.com/signed"
        bucket = MagicMock()
        bucket.blob.return_value = blob
        gcs = MagicMock()
        gcs.bucket.return_value = bucket
        creds = MagicMock()
        creds.token = "tok"

        with (
            patch.object(att, "_gcs", return_value=gcs),
            patch("google.auth.default", return_value=(creds, None)),
        ):
            att.signed_get_url("estimating/est-1/att-1.pdf", "scope.pdf")

        assert "response_type" not in blob.generate_signed_url.call_args.kwargs
