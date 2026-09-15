#!/usr/bin/env python3
"""
Upload proposal assets (photos, portfolio pages, headshots) to a private GCS bucket.

Three asset sets live under studio/public/proposal/:
  photos/      — brand photography and logos   → proposal/photos/
  portfolio/   — rasterized portfolio JPEGs    → proposal/portfolio/
  headshots/   — normalized headshot JPEGs     → proposal/headshots/

The bucket must already exist with uniform bucket-level access. Objects are
served through the /proposal-assets/{path} proxy route in api/server.py, which
authenticates via the Cloud Run service account — no allUsers grant needed.

Requires the Cloud Run runtime SA to have roles/storage.objectViewer on the
bucket. Grant once with:
    gcloud storage buckets add-iam-policy-binding gs://juniper-crm-proposal-assets \
      --member="serviceAccount:<SA_EMAIL>" --role="roles/storage.objectViewer"

Usage (from repo root, with venv active):
    python -m scripts.upload_proposal_assets --dry-run
    python -m scripts.upload_proposal_assets --set photos
    python -m scripts.upload_proposal_assets --set portfolio
    python -m scripts.upload_proposal_assets --set headshots
    python -m scripts.upload_proposal_assets  # all three sets
    python -m scripts.upload_proposal_assets --bucket other-bucket
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import mimetypes
import os
import sys
from pathlib import Path

from google.cloud import storage

REPO_ROOT = Path(__file__).resolve().parent.parent
STUDIO_PUBLIC = REPO_ROOT / "studio" / "public" / "proposal"

ASSET_SETS = {
    "photos":    (STUDIO_PUBLIC / "photos",    "proposal/photos"),
    "portfolio": (STUDIO_PUBLIC / "portfolio", "proposal/portfolio"),
    "headshots": (STUDIO_PUBLIC / "headshots", "proposal/headshots"),
}

CACHE_CONTROL = "public, max-age=86400"


def _md5_b64(path: Path) -> str:
    digest = hashlib.md5(path.read_bytes()).digest()
    return base64.b64encode(digest).decode()


def upload_set(bucket: storage.Bucket, local_dir: Path, prefix: str, dry_run: bool) -> tuple[int, int]:
    if not local_dir.is_dir():
        print(f"  warning: {local_dir} does not exist — skipping", file=sys.stderr)
        return 0, 0

    files = sorted(p for p in local_dir.rglob("*") if p.is_file() and not p.name.startswith("."))
    if not files:
        print(f"  warning: {local_dir} is empty — skipping", file=sys.stderr)
        return 0, 0

    uploaded = skipped = 0
    for path in files:
        rel = path.relative_to(local_dir)
        key = f"{prefix}/{rel}"
        existing = bucket.get_blob(key)
        local_md5 = _md5_b64(path)

        if existing is not None and existing.md5_hash == local_md5:
            print(f"  skip    {key}")
            skipped += 1
            continue

        size_kb = path.stat().st_size // 1024
        if dry_run:
            verb = "replace" if existing is not None else "create"
            print(f"  {verb:<7} {key}  ({size_kb} KB)")
            uploaded += 1
            continue

        blob = bucket.blob(key)
        blob.cache_control = CACHE_CONTROL
        blob.upload_from_filename(
            str(path),
            content_type=mimetypes.guess_type(path.name)[0] or "application/octet-stream",
        )
        print(f"  upload  {key}  ({size_kb} KB)")
        uploaded += 1

    return uploaded, skipped


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--bucket",
        default=os.environ.get("PROPOSAL_ASSETS_BUCKET", "juniper-crm-proposal-assets"),
        help="GCS bucket name (default: juniper-crm-proposal-assets)",
    )
    ap.add_argument(
        "--set",
        choices=list(ASSET_SETS.keys()),
        default=None,
        dest="asset_set",
        help="Upload only this set. Omit to upload all three.",
    )
    ap.add_argument("--dry-run", action="store_true", help="Report what would change, no writes.")
    args = ap.parse_args()

    sets_to_run = {args.asset_set: ASSET_SETS[args.asset_set]} if args.asset_set else ASSET_SETS

    client = storage.Client()
    bucket = client.bucket(args.bucket)

    total_uploaded = total_skipped = 0
    for name, (local_dir, prefix) in sets_to_run.items():
        print(f"\n── {name} ({prefix}) ──")
        u, s = upload_set(bucket, local_dir, prefix, args.dry_run)
        total_uploaded += u
        total_skipped += s

    action = "would upload" if args.dry_run else "uploaded"
    print(f"\n{action} {total_uploaded}, skipped {total_skipped} → gs://{args.bucket}/proposal/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
