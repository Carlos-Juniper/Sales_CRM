"""GCS attachment helpers for the estimating intake feature.

Lazy-loads a storage.Client() under ADC (Cloud Run identity; no key file).
Upload uses a backend-initiated resumable session — no URL signing needed.
Download uses v4 signed GET URL via IAM signBlob because Cloud Run ADC has no
private key for local signing.

Env vars:
  GCS_ATTACHMENTS_BUCKET   — bucket name for estimating/proposal assets (required in production)
  GCS_CREDENTIALS_BUCKET   — bucket for credentials/licenses/* keys; defaults to
                             GCS_ATTACHMENTS_BUCKET when unset. Set to the prod bucket
                             in all deployed environments so credential documents only
                             need updating once (not per-environment).
  GCS_SIGNER_SA_EMAIL      — runtime SA email; set explicitly because
                             Compute ADC sometimes reports "default"
  GCS_MAX_UPLOAD_BYTES     — hard cap per file (default 2 GiB)
  GCS_SIGNED_URL_TTL_MIN   — download URL TTL in minutes (default 10)
"""
from __future__ import annotations

import os
import urllib.parse
from datetime import timedelta
from typing import Optional

import google.auth
import google.auth.transport.requests
from google.cloud import storage

GCS_ATTACHMENTS_BUCKET: str = os.environ.get("GCS_ATTACHMENTS_BUCKET", "")
# Bucket for credentials/licenses/* keys. Defaults to GCS_ATTACHMENTS_BUCKET so
# local dev and unset environments are unaffected. Set to the prod bucket in all
# deployed environments so credential documents only need updating in one place.
GCS_CREDENTIALS_BUCKET: str = os.environ.get("GCS_CREDENTIALS_BUCKET", "") or GCS_ATTACHMENTS_BUCKET
GCS_SIGNER_SA_EMAIL: str = os.environ.get("GCS_SIGNER_SA_EMAIL", "")
GCS_MAX_UPLOAD_BYTES: int = int(
    os.environ.get("GCS_MAX_UPLOAD_BYTES", str(2 * 1024 * 1024 * 1024))
)
GCS_SIGNED_URL_TTL_MIN: int = int(os.environ.get("GCS_SIGNED_URL_TTL_MIN", "10"))

# Origins permitted to receive the GCS resumable-session URI (CORS). The bucket
# CORS config mirrors this list; never reflect untrusted Origin values from the
# browser into the GCS session grant.
_ALLOWED_ORIGINS_BASE = {
    "http://localhost:5173",
    "http://localhost:5174",
}
_extra = os.environ.get("CORS_EXTRA_ORIGINS", "")
ALLOWED_ORIGINS: frozenset[str] = frozenset(
    _ALLOWED_ORIGINS_BASE | {o.strip() for o in _extra.split(",") if o.strip()}
)

_client: Optional[storage.Client] = None


def _gcs() -> storage.Client:
    global _client
    if _client is None:
        _client = storage.Client()
    return _client


class RfpDocumentRejected(ValueError):
    """Client-facing rejection of an RFP upload that is not PDF, Word, or Excel."""


# RFP documents on the maintenance and install intakes. The extension and the
# MIME must agree; the value stored (and served back) is this canonical type.
# Longest entry is 71 chars — intake_attachments.content_type is VARCHAR(100).
RFP_CONTENT_TYPE_BY_EXT: dict[str, str] = {
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}

_RFP_REJECTED = (
    "RFP documents must be PDF, Word (.doc, .docx), or Excel (.xls, .xlsx)"
)
_RFP_MISMATCH = "RFP file extension does not match its content type"


def validate_rfp_document(file_name: str, content_type: str) -> str:
    """Return the canonical MIME when an RFP filename and content type agree.

    Comparison is case-insensitive, and MIME parameters (``; charset=...``)
    are ignored. The returned value is what the resumable session and the
    attachment row store, so a later download serves that content type.
    """
    ext = os.path.splitext((file_name or "").strip())[1].lower()
    mime = (content_type or "").split(";")[0].strip().lower()
    expected = RFP_CONTENT_TYPE_BY_EXT.get(ext)
    if expected is None:
        raise RfpDocumentRejected(_RFP_REJECTED)
    if mime != expected:
        raise RfpDocumentRejected(_RFP_MISMATCH)
    return expected


# Extension derived from the VALIDATED content type — never from the user
# filename. Image types are for the takeoff scan; Word/Excel are for RFP
# documents. Other intake kinds stay PDF-only at the endpoint layer.
_EXT_BY_CONTENT_TYPE = {
    "application/pdf": "pdf",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    **{mime: ext.lstrip(".") for ext, mime in RFP_CONTENT_TYPE_BY_EXT.items()},
}


def object_key_for(
    estimate_id: str, attachment_id: str, content_type: str = "application/pdf"
) -> str:
    """Deterministic object key — never uses the user filename (path-traversal guard)."""
    ext = _EXT_BY_CONTENT_TYPE.get(content_type, "bin")
    return f"estimating/{estimate_id}/{attachment_id}.{ext}"


def begin_resumable_session(key: str, content_type: str, origin: str) -> str:
    """Initiate a GCS resumable upload and return the session URI.

    The browser PUTs bytes directly to this URI, bypassing the API server for
    upload bandwidth while keeping the backend in control of the object path.
    """
    blob = _gcs().bucket(GCS_ATTACHMENTS_BUCKET).blob(key)
    return blob.create_resumable_upload_session(content_type=content_type, origin=origin)


def upload_bytes(key: str, data: bytes, content_type: str, bucket: str | None = None) -> None:
    """Upload raw bytes to GCS — used by server-side PDF rendering.

    Unlike begin_resumable_session (which hands a URI to the browser), this
    uploads directly from the API server. Pass `bucket` to target a non-default
    bucket (e.g. GCS_CREDENTIALS_BUCKET for credential documents).
    """
    blob = _gcs().bucket(bucket or GCS_ATTACHMENTS_BUCKET).blob(key)
    blob.upload_from_string(data, content_type=content_type)


def head(key: str) -> storage.Blob:
    """Reload the blob metadata (used by confirm to verify the upload landed)."""
    blob = _gcs().bucket(GCS_ATTACHMENTS_BUCKET).blob(key)
    blob.reload()
    return blob


def content_disposition(original_name: str) -> str:
    """Build a safe `attachment` Content-Disposition from a client filename.

    The name is attacker-controlled (L2): strip CR/LF (header injection) and
    keep the quoted-string fallback to printable ASCII with quotes/backslashes
    removed; the full original name travels percent-encoded in the RFC 5987
    `filename*` parameter, which conforming browsers prefer.
    """
    name = (original_name or "").replace("\r", "").replace("\n", "")
    fallback = "".join(
        c for c in name if c not in '"\\' and 32 <= ord(c) < 127
    ).strip() or "download"
    encoded = urllib.parse.quote(name, safe="")
    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{encoded}"


def signed_get_url(
    key: str,
    original_name: str,
    bucket: str | None = None,
    content_type: str | None = None,
) -> str:
    """Return a short-lived v4 signed GET URL that forces Save-As with the original filename.

    Uses IAM signBlob because Cloud Run ADC has no private key for local RSA signing.
    Requires roles/iam.serviceAccountTokenCreator on the runtime SA (on itself) and
    iamcredentials.googleapis.com enabled. Pass `bucket` to sign from a non-default
    bucket (e.g. GCS_CREDENTIALS_BUCKET for credential documents).

    `content_type` sets the response Content-Type (GCS `response_type`) so a
    stored Word or Excel RFP downloads as that type. Omit it to leave the
    object's own content type untouched.
    """
    creds, _ = google.auth.default()
    creds.refresh(google.auth.transport.requests.Request())

    blob = _gcs().bucket(bucket or GCS_ATTACHMENTS_BUCKET).blob(key)
    sign_kwargs: dict = {
        "version": "v4",
        "expiration": timedelta(minutes=GCS_SIGNED_URL_TTL_MIN),
        "method": "GET",
        "response_disposition": content_disposition(original_name),
        "service_account_email": GCS_SIGNER_SA_EMAIL,
        "access_token": creds.token,
    }
    if content_type:
        sign_kwargs["response_type"] = content_type
    return blob.generate_signed_url(**sign_kwargs)


def delete(key: str) -> None:
    """Delete an object from the bucket.

    Any future estimate/intake delete MUST call this for every stored attachment
    row before deleting the row — prefer soft-delete to preserve the corpus.
    """
    blob = _gcs().bucket(GCS_ATTACHMENTS_BUCKET).blob(key)
    blob.delete()
