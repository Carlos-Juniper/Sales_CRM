"""
Replace the Certificate of Insurance document in GCS and update its DB row.

Uploads ~/Downloads/Juniper Master COI 26-27 1.pdf to TWO deterministic keys:
  credentials/licenses/ins-cert-001.pdf   the source document (admin downloads)
  credentials/licenses/ins-cert-001.png   page 1 rasterized (the proposal page)

then updates licenses_certifications row id='ins-cert-001':
  - object_key  → 'credentials/licenses/ins-cert-001.png'
  - expiry_date → '2027-07-01'  (policy period 07/01/2026–07/01/2027)

Why object_key points at the PNG and not the PDF
------------------------------------------------
The proposal is HTML printed by headless Chromium (api/proposal_render.py calls
page.pdf()). Chromium does not rasterize nested PDF plugin content into print
output, so a PDF object_key cannot reach the page: <img src="...pdf"> never
loads, and <object type="application/pdf"> renders in the on-screen preview and
then prints as a blank box. That blank-COI regression shipped once already
(commit 2051d4d). The certificate has to arrive as a raster image, exactly like
the portfolio chapter does — see scripts/rasterize_portfolio_pages.py.

Only page 1 is rasterized: that is the page the proposal shows. The full
multi-page PDF is still uploaded, so nothing is lost.

Usage (from repo root, with the Cloud SQL proxy running via
`./venv/bin/python run_dev.py`):

    ./venv/bin/python scripts/swap_insurance_cert.py --dry-run --use-default-bucket
    ./venv/bin/python scripts/swap_insurance_cert.py --use-default-bucket

`--use-default-bucket` is only needed while GCS_CREDENTIALS_BUCKET is absent from
your local .env; set it there and the flag becomes unnecessary. The script
deliberately refuses to guess — see the DEFAULT_CREDENTIALS_BUCKET comment.

Note: staging and prod SHARE the credentials bucket (GCS_CREDENTIALS_BUCKET is
juniper-crm-attachments-prod in both cloudbuild files) but have SEPARATE
databases, so the upload happens once and the DB update must be run per env
(point MYSQL_* / the proxy at each in turn).
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# ---------------------------------------------------------------------------
# Env loading — mirrors the pattern in seed_contract_estimate.py.
# Can't `source .env` in zsh because secret values contain glob chars.
# ---------------------------------------------------------------------------
env_file = ROOT / ".env"
if env_file.exists():
    for _line in env_file.read_text().splitlines():
        _line = _line.strip()
        if not _line or _line.startswith("#") or "=" not in _line:
            continue
        _k, _, _v = _line.partition("=")
        os.environ.setdefault(_k.strip(), _v.strip())

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
SOURCE_PATH = Path.home() / "Downloads" / "Juniper Master COI 26-27 1.pdf"
ROW_ID = "ins-cert-001"
PDF_OBJECT_KEY = f"credentials/licenses/{ROW_ID}.pdf"
PNG_OBJECT_KEY = f"credentials/licenses/{ROW_ID}.png"
NEW_EXPIRY = "2027-07-01"
PDF_CONTENT_TYPE = "application/pdf"
PNG_CONTENT_TYPE = "image/png"

# Rasterization settings, kept identical to scripts/rasterize_portfolio_pages.py
# so every scanned page in the document is captured at the same density. Defined
# here rather than imported: this script is run as a path (python
# scripts/swap_insurance_cert.py), which does not put the repo root on sys.path.
# 612 × 792 pt × (200/72) dpi = 1700 × 2200 px for a Letter page.
DPI = 200
COI_PAGE_INDEX = 0  # page 1 only — the page the proposal prints

# Credential documents live in GCS_CREDENTIALS_BUCKET, which is
# juniper-crm-attachments-prod in BOTH cloudbuild.staging.yaml and
# cloudbuild.yaml — every deployed environment reads credentials/* from the one
# prod bucket.
#
# api.attachments falls back to GCS_ATTACHMENTS_BUCKET when the var is unset, so
# that local dev works standalone. This script must NOT inherit that fallback:
# it publishes to the deployed environments, and a laptop .env that only sets
# GCS_ATTACHMENTS_BUCKET would silently upload to the staging attachments bucket
# — which neither deployed environment ever reads. The upload would report
# success and the certificate would still be missing from every proposal. Ask
# for the bucket explicitly instead of guessing wrong.
DEFAULT_CREDENTIALS_BUCKET = "juniper-crm-attachments-prod"
GCS_BUCKET = os.environ.get("GCS_CREDENTIALS_BUCKET", "")

DB_CFG = dict(
    host=os.environ.get("MYSQL_HOST", "127.0.0.1"),
    port=int(os.environ.get("MYSQL_PORT", 3306)),
    user=os.environ.get("MYSQL_USER", "crmadmin"),
    password=os.environ.get("MYSQL_PASSWORD", ""),
    db=os.environ.get("MYSQL_DB", "crm"),
    charset="utf8mb4",
    autocommit=False,
)


def rasterize_first_page(pdf_bytes: bytes) -> bytes:
    """Render page 1 of the COI to PNG bytes at DPI.

    Raises RuntimeError with an actionable message rather than letting a raw
    PyMuPDF error surface — this runs interactively and the caller needs to know
    whether the source file or the library is the problem.
    """
    try:
        import fitz  # PyMuPDF
    except ImportError as e:  # pragma: no cover - environment guard
        raise RuntimeError(
            "PyMuPDF is not installed. Activate the venv (it is already there, "
            "alongside scripts/rasterize_portfolio_pages.py)."
        ) from e

    with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
        if doc.page_count == 0:
            raise RuntimeError("Source PDF has no pages.")
        page = doc.load_page(COI_PAGE_INDEX)
        pix = page.get_pixmap(dpi=DPI)
        return pix.tobytes("png")


def fetch_row(cur) -> dict | None:
    cur.execute(
        "SELECT id, kind, object_key, expiry_date, active, aspire_branch_id "
        "FROM licenses_certifications WHERE id = %s",
        (ROW_ID,),
    )
    return cur.fetchone()


def print_row(label: str, row: dict | None) -> None:
    if row is None:
        print(f"  {label}: <not found>")
        return
    expiry = str(row.get("expiry_date") or "NULL")
    obj_key = row.get("object_key") or "NULL"
    active = row.get("active")
    branch = row.get("aspire_branch_id") or "NULL (company-wide)"
    print(f"  {label}:")
    print(f"    object_key     : {obj_key}")
    print(f"    expiry_date    : {expiry}")
    print(f"    active         : {active}")
    print(f"    aspire_branch_id: {branch}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would happen without uploading or updating the DB.",
    )
    ap.add_argument(
        "--bucket",
        default="",
        help=(
            "Credentials bucket to upload to. Defaults to $GCS_CREDENTIALS_BUCKET, "
            f"then {DEFAULT_CREDENTIALS_BUCKET!r} with --use-default-bucket."
        ),
    )
    ap.add_argument(
        "--use-default-bucket",
        action="store_true",
        help=(
            f"Use {DEFAULT_CREDENTIALS_BUCKET!r} (the value every deployed "
            "environment uses) when GCS_CREDENTIALS_BUCKET is not set locally."
        ),
    )
    args = ap.parse_args()

    # ── Pre-flight checks ────────────────────────────────────────────────────
    if not SOURCE_PATH.exists():
        print(f"ERROR: source file not found: {SOURCE_PATH}", file=sys.stderr)
        return 1

    bucket_name = args.bucket or GCS_BUCKET
    if not bucket_name and args.use_default_bucket:
        bucket_name = DEFAULT_CREDENTIALS_BUCKET
    if not bucket_name:
        print(
            "ERROR: no credentials bucket resolved.\n"
            "  GCS_CREDENTIALS_BUCKET is not set in .env, and this script will not\n"
            "  fall back to GCS_ATTACHMENTS_BUCKET: credentials/* are served only\n"
            f"  from the credentials bucket ({DEFAULT_CREDENTIALS_BUCKET} in both\n"
            "  cloudbuild files), so uploading anywhere else silently succeeds and\n"
            "  leaves the certificate missing from every proposal.\n"
            "\n"
            "  Fix with either:\n"
            f"    echo 'GCS_CREDENTIALS_BUCKET={DEFAULT_CREDENTIALS_BUCKET}' >> .env\n"
            "    ./venv/bin/python scripts/swap_insurance_cert.py --use-default-bucket",
            file=sys.stderr,
        )
        return 1

    size_kb = SOURCE_PATH.stat().st_size // 1024
    print(f"Source     : {SOURCE_PATH}  ({size_kb} KB)")
    print(f"GCS bucket : {bucket_name}")
    print(f"PDF key    : {PDF_OBJECT_KEY}   (source document)")
    print(f"PNG key    : {PNG_OBJECT_KEY}   (page 1 @ {DPI} dpi — what the proposal prints)")
    print(f"New expiry : {NEW_EXPIRY}")
    print()

    # Rasterize before touching GCS or the DB: a source PDF we cannot render is
    # a hard stop, not something to discover after a half-finished swap.
    pdf_bytes = SOURCE_PATH.read_bytes()
    try:
        png_bytes = rasterize_first_page(pdf_bytes)
    except RuntimeError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    print(f"Rasterized page 1 → PNG ({len(png_bytes):,} bytes)")
    print()

    # ── DB connection ────────────────────────────────────────────────────────
    try:
        import pymysql
        import pymysql.cursors
    except ImportError:
        print("ERROR: pymysql not installed. Activate the venv.", file=sys.stderr)
        return 1

    try:
        conn = pymysql.connect(**DB_CFG)
    except pymysql.err.OperationalError as e:
        print(f"ERROR: Cannot connect to DB: {e}", file=sys.stderr)
        print("  Is the Cloud SQL proxy running? (python run_dev.py)", file=sys.stderr)
        return 1

    cur = conn.cursor(pymysql.cursors.DictCursor)

    # ── Show current state ───────────────────────────────────────────────────
    before = fetch_row(cur)
    print_row("BEFORE", before)
    print()

    if before is None:
        print(f"ERROR: Row id={ROW_ID!r} not found in licenses_certifications.", file=sys.stderr)
        cur.close()
        conn.close()
        return 1

    if args.dry_run:
        print("[dry-run] Would upload:")
        print(f"  gs://{bucket_name}/{PDF_OBJECT_KEY}  ({len(pdf_bytes):,} bytes)")
        print(f"  gs://{bucket_name}/{PNG_OBJECT_KEY}  ({len(png_bytes):,} bytes)")
        print()
        print("[dry-run] Would execute:")
        print(f"  UPDATE licenses_certifications")
        print(f"    SET object_key = '{PNG_OBJECT_KEY}',")
        print(f"        expiry_date = '{NEW_EXPIRY}'")
        print(f"    WHERE id = '{ROW_ID}'")
        cur.close()
        conn.close()
        return 0

    # ── GCS upload ───────────────────────────────────────────────────────────
    try:
        from google.cloud import storage as gcs_storage
    except ImportError:
        print("ERROR: google-cloud-storage not installed. Activate the venv.", file=sys.stderr)
        cur.close()
        conn.close()
        return 1

    # The PNG is uploaded first. If the run dies between the two uploads the row
    # still points at the previous certificate, which is stale but renders —
    # strictly better than pointing at a key that has no image behind it.
    try:
        client = gcs_storage.Client()
        bucket = client.bucket(bucket_name)
        for key, data, ctype in (
            (PNG_OBJECT_KEY, png_bytes, PNG_CONTENT_TYPE),
            (PDF_OBJECT_KEY, pdf_bytes, PDF_CONTENT_TYPE),
        ):
            print(f"Uploading {len(data):,} bytes to gs://{bucket_name}/{key} ...")
            bucket.blob(key).upload_from_string(data, content_type=ctype)
            print("  Upload complete.")
    except Exception as e:
        print(f"ERROR: GCS upload failed: {e}", file=sys.stderr)
        cur.close()
        conn.close()
        return 1

    print()

    # ── DB update ────────────────────────────────────────────────────────────
    print(f"Updating DB row id={ROW_ID!r} ...")
    cur.execute(
        "UPDATE licenses_certifications "
        "SET object_key = %s, expiry_date = %s "
        "WHERE id = %s",
        (PNG_OBJECT_KEY, NEW_EXPIRY, ROW_ID),
    )
    conn.commit()
    print(f"  Rows affected: {cur.rowcount}")
    print()

    # ── Confirm new state ────────────────────────────────────────────────────
    after = fetch_row(cur)
    print_row("AFTER", after)
    print()

    cur.close()
    conn.close()

    print("Done.")
    print(f"  PDF        : gs://{bucket_name}/{PDF_OBJECT_KEY}")
    print(f"  PNG        : gs://{bucket_name}/{PNG_OBJECT_KEY}")
    print(f"  object_key : {after.get('object_key') if after else 'unknown'}")
    print(f"  expiry_date: {after.get('expiry_date') if after else 'unknown'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
