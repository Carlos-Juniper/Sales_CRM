"""GCS attachment helpers for the estimating intake feature.

Lazy-loads a storage.Client() under ADC (Cloud Run identity; no key file).
Upload uses a backend-initiated resumable session — no URL signing needed.
Download uses v4 signed GET URL via IAM signBlob because Cloud Run ADC has no
private key for local signing.

Env vars:
  GCS_ATTACHMENTS_BUCKET   — bucket name (required in production)
  GCS_SIGNER_SA_EMAIL      — runtime SA email; set explicitly because
                             Compute ADC sometimes reports "default"
  GCS_MAX_UPLOAD_BYTES     — hard cap per file (default 2 GiB)
  GCS_SIGNED_URL_TTL_MIN   — download URL TTL in minutes (default 10)
"""
from __future__ import annotations

import os
from datetime import timedelta
from typing import Optional

import google.auth
import google.auth.transport.requests
from google.cloud import storage

GCS_ATTACHMENTS_BUCKET: str = os.environ.get("GCS_ATTACHMENTS_BUCKET", "")
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


def object_key_for(estimate_id: str, attachment_id: str) -> str:
    """Deterministic object key — never uses the user filename (path-traversal guard)."""
    return f"estimating/{estimate_id}/{attachment_id}.pdf"


def begin_resumable_session(key: str, content_type: str, origin: str) -> str:
    """Initiate a GCS resumable upload and return the session URI.

    The browser PUTs bytes directly to this URI, bypassing the API server for
    upload bandwidth while keeping the backend in control of the object path.
    """
    blob = _gcs().bucket(GCS_ATTACHMENTS_BUCKET).blob(key)
    return blob.create_resumable_upload_session(content_type=content_type, origin=origin)


def head(key: str) -> storage.Blob:
    """Reload the blob metadata (used by confirm to verify the upload landed)."""
    blob = _gcs().bucket(GCS_ATTACHMENTS_BUCKET).blob(key)
    blob.reload()
    return blob


def signed_get_url(key: str, original_name: str) -> str:
    """Return a short-lived v4 signed GET URL that forces Save-As with the original filename.

    Uses IAM signBlob because Cloud Run ADC has no private key for local RSA signing.
    Requires roles/iam.serviceAccountTokenCreator on the runtime SA (on itself) and
    iamcredentials.googleapis.com enabled.
    """
    creds, _ = google.auth.default()
    creds.refresh(google.auth.transport.requests.Request())

    blob = _gcs().bucket(GCS_ATTACHMENTS_BUCKET).blob(key)
    return blob.generate_signed_url(
        version="v4",
        expiration=timedelta(minutes=GCS_SIGNED_URL_TTL_MIN),
        method="GET",
        response_disposition=f'attachment; filename="{original_name}"',
        service_account_email=GCS_SIGNER_SA_EMAIL,
        access_token=creds.token,
    )


def delete(key: str) -> None:
    """Delete an object from the bucket.

    Any future estimate/intake delete MUST call this for every stored attachment
    row before deleting the row — prefer soft-delete to preserve the corpus.
    """
    blob = _gcs().bucket(GCS_ATTACHMENTS_BUCKET).blob(key)
    blob.delete()
