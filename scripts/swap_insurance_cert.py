"""
Replace the Certificate of Insurance document in GCS and update its DB row.

Uploads ~/Downloads/Juniper Master COI 26-27 1.pdf to the deterministic key
  credentials/licenses/ins-cert-001.pdf
then updates licenses_certifications row id='ins-cert-001':
  - object_key  → 'credentials/licenses/ins-cert-001.pdf'
  - expiry_date → '2027-07-01'  (policy period 07/01/2026–07/01/2027)

Usage (from repo root, with venv active and Cloud SQL proxy running):
    python scripts/swap_insurance_cert.py --dry-run
    python scripts/swap_insurance_cert.py
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
OBJECT_KEY = f"credentials/licenses/{ROW_ID}.pdf"
NEW_EXPIRY = "2027-07-01"
CONTENT_TYPE = "application/pdf"

# Use GCS_CREDENTIALS_BUCKET when set (prod bucket in all deployed envs),
# falling back to GCS_ATTACHMENTS_BUCKET for local dev without the var.
GCS_BUCKET = (
    os.environ.get("GCS_CREDENTIALS_BUCKET", "")
    or os.environ.get("GCS_ATTACHMENTS_BUCKET", "")
)

DB_CFG = dict(
    host=os.environ.get("MYSQL_HOST", "127.0.0.1"),
    port=int(os.environ.get("MYSQL_PORT", 3306)),
    user=os.environ.get("MYSQL_USER", "crmadmin"),
    password=os.environ.get("MYSQL_PASSWORD", ""),
    db=os.environ.get("MYSQL_DB", "crm"),
    charset="utf8mb4",
    autocommit=False,
)


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
    args = ap.parse_args()

    # ── Pre-flight checks ────────────────────────────────────────────────────
    if not SOURCE_PATH.exists():
        print(f"ERROR: source file not found: {SOURCE_PATH}", file=sys.stderr)
        return 1

    if not GCS_BUCKET:
        print("ERROR: GCS_ATTACHMENTS_BUCKET is not set in .env", file=sys.stderr)
        return 1

    size_kb = SOURCE_PATH.stat().st_size // 1024
    print(f"Source     : {SOURCE_PATH}  ({size_kb} KB)")
    print(f"Object key : {OBJECT_KEY}")
    print(f"GCS bucket : {GCS_BUCKET}")
    print(f"GCS URI    : gs://{GCS_BUCKET}/{OBJECT_KEY}")
    print(f"New expiry : {NEW_EXPIRY}")
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
        print(f"  gs://{GCS_BUCKET}/{OBJECT_KEY}")
        print()
        print("[dry-run] Would execute:")
        print(f"  UPDATE licenses_certifications")
        print(f"    SET object_key = '{OBJECT_KEY}',")
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

    pdf_bytes = SOURCE_PATH.read_bytes()
    print(f"Uploading {len(pdf_bytes):,} bytes to gs://{GCS_BUCKET}/{OBJECT_KEY} ...")

    try:
        client = gcs_storage.Client()
        blob = client.bucket(GCS_BUCKET).blob(OBJECT_KEY)
        blob.upload_from_string(pdf_bytes, content_type=CONTENT_TYPE)
        print(f"  Upload complete.")
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
        (OBJECT_KEY, NEW_EXPIRY, ROW_ID),
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
    print(f"  GCS URI    : gs://{GCS_BUCKET}/{OBJECT_KEY}")
    print(f"  object_key : {after.get('object_key') if after else 'unknown'}")
    print(f"  expiry_date: {after.get('expiry_date') if after else 'unknown'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
