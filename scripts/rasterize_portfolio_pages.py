#!/usr/bin/env python3
"""
Rasterize Juniper Landscaping portfolio PDFs to JPEG for GCS upload.

Each PDF under --source-dir must be named:
    Portfolio - <Property Name> - <City>.pdf

The script:
  1. Finds all matching PDFs recursively under --source-dir.
  2. Rasterises page 0 at 200 dpi → exactly 1700×2200 px.
  3. Saves a JPEG (quality 90) per property to --output-dir.
  4. Writes a JSON manifest to --manifest for the seed migration (036).

Usage (from repo root):
    python -m scripts.rasterize_portfolio_pages --dry-run
    python -m scripts.rasterize_portfolio_pages
    python -m scripts.rasterize_portfolio_pages --source-dir ~/Downloads/Portfolio Pages

Env vars: none required for local use.
"""
from __future__ import annotations

import argparse
import json
import logging
import re
import sys
from pathlib import Path

import fitz  # PyMuPDF

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s  %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("rasterize_portfolio_pages")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
# 612 × 792 pt × (200/72) dpi = 1700 × 2200 px — always Letter size.
EXPECTED_W = 1700
EXPECTED_H = 2200
DPI = 200
JPEG_QUALITY = 90

# Filename typos — stored as-is so DB name matches artwork label.
# Carlos should ask Caitlyn to re-export if corrections are wanted.
# 'Cory Lakes Isles'     (likely Cory Lake Isles)
# 'Penbroke Pines'       (Pembroke Pines)
# 'Estencia at Wiregrass' (likely Estancia)
# 'Heritages Isles' (Tampa) vs 'Heritage Isles' (Melbourne) — two different properties
KNOWN_TYPOS: dict[str, str] = {}  # keyed by slug — reserved for future corrections

FOLDER_TO_REGION: dict[str, str] = {
    "Fort Lauderdale": "east-coast",
    "Melbourne": "east-coast",
    "Palm Beach": "east-coast",
    "Orlando": "central",
    "Tampa": "central",
    "Fort Myers": "west-coast",
    "Naples": "west-coast",
    "Sarasota": "west-coast",
    "Venice": "west-coast",
    "Resort": "west-coast",  # Resort folder = Sanibel/Port Charlotte area
}

# Matches exactly: "Portfolio - <Name> - <City>.pdf"
_FILENAME_RE = re.compile(
    r"^Portfolio\s+-\s+(?P<name>.+?)\s+-\s+(?P<city>.+?)\.pdf$",
    re.IGNORECASE,
)

# ---------------------------------------------------------------------------
# Pure helpers (also imported by tests)
# ---------------------------------------------------------------------------

def slugify(text: str) -> str:
    """Lowercase; collapse every run of non-alphanumeric characters to a single hyphen.

    Mirrors headshotSlug() in studio/src/lib/proposal/photos.ts.

    >>> slugify('Island Walk at West Villages')
    'island-walk-at-west-villages'
    >>> slugify('Wellen Park & Sarasota')
    'wellen-park-sarasota'
    """
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def parse_portfolio_filename(filename: str) -> tuple[str, str] | None:
    """Return (property_name, city) from a portfolio PDF filename, or None.

    >>> parse_portfolio_filename('Portfolio - Island Walk at West Villages - Venice.pdf')
    ('Island Walk at West Villages', 'Venice')
    >>> parse_portfolio_filename('some-other-file.pdf') is None
    True
    """
    m = _FILENAME_RE.match(filename)
    if not m:
        return None
    return m.group("name"), m.group("city")


def get_region_id(folder_name: str) -> str:
    """Map a source-dir subdirectory name to a region_id string.

    Falls back to 'west-coast' with a warning for unknown folders.

    >>> get_region_id('Venice')
    'west-coast'
    >>> get_region_id('Orlando')
    'central'
    """
    if folder_name in FOLDER_TO_REGION:
        return FOLDER_TO_REGION[folder_name]
    log.warning(
        "Unknown folder name %r — defaulting to 'west-coast'. "
        "Add it to FOLDER_TO_REGION if this is unexpected.",
        folder_name,
    )
    return "west-coast"


# ---------------------------------------------------------------------------
# Core processing
# ---------------------------------------------------------------------------

def rasterize_pdf(pdf_path: Path, output_path: Path) -> None:
    """Open pdf_path, rasterise page 0 at DPI dpi, save JPEG to output_path."""
    doc = fitz.open(str(pdf_path))
    try:
        page = doc[0]

        # Check text content (artwork may have text as images — warn, don't raise)
        # Text check happens after we know the property name (caller verifies).

        mat = fitz.Matrix(DPI / 72, DPI / 72)
        pix = page.get_pixmap(matrix=mat, colorspace=fitz.csRGB)

        if pix.width != EXPECTED_W or pix.height != EXPECTED_H:
            raise AssertionError(
                f"{pdf_path.name}: expected {EXPECTED_W}×{EXPECTED_H} px pixmap "
                f"at {DPI} dpi but got {pix.width}×{pix.height} px. "
                "The PDF may not be Letter size (612×792 pt)."
            )

        pix.save(str(output_path), jpg_quality=JPEG_QUALITY)
    finally:
        doc.close()


def check_text_contains_name(pdf_path: Path, property_name: str) -> bool:
    """Return True if page 0 text contains property_name (case-insensitive)."""
    doc = fitz.open(str(pdf_path))
    try:
        text = doc[0].get_text()
    finally:
        doc.close()
    return property_name.lower() in text.lower()


def process_source_dir(
    source_dir: Path,
    output_dir: Path,
    manifest_path: Path,
    dry_run: bool,
) -> int:
    """Walk source_dir, process PDFs, write manifest. Returns exit code."""

    # Collect all PDFs recursively
    pdf_files = sorted(source_dir.rglob("*.pdf"))
    if not pdf_files:
        log.error("No PDF files found under %s", source_dir)
        return 2

    entries: list[dict] = []
    slug_to_file: dict[str, str] = {}  # slug → first filename that produced it
    processed = written = skipped = 0

    for pdf_path in pdf_files:
        # The region comes from the immediate subdirectory of source_dir.
        try:
            relative = pdf_path.relative_to(source_dir)
        except ValueError:
            log.warning("SKIP  %s — cannot determine relative path", pdf_path.name)
            skipped += 1
            continue

        parts = relative.parts
        folder_name = parts[0] if len(parts) > 1 else ""
        region_id = get_region_id(folder_name) if folder_name else get_region_id("")

        parsed = parse_portfolio_filename(pdf_path.name)
        if parsed is None:
            log.warning("SKIP  %s — filename doesn't match 'Portfolio - <Name> - <City>.pdf'", pdf_path.name)
            skipped += 1
            continue

        property_name, city = parsed
        slug = slugify(property_name)
        object_key = f"proposal/portfolio/{slug}.jpg"
        out_file = output_dir / f"{slug}.jpg"

        # Duplicate slug detection (raise immediately)
        if slug in slug_to_file:
            raise RuntimeError(
                f"Duplicate slug '{slug}' produced by both:\n"
                f"  {slug_to_file[slug]}\n"
                f"  {pdf_path.name}\n"
                "Rename one PDF or update KNOWN_TYPOS to disambiguate."
            )
        slug_to_file[slug] = pdf_path.name
        processed += 1

        entry = {
            "slug": slug,
            "property_name": property_name,
            "city_state": f"{city}, FL",
            "photo_object_key": object_key,
            "region_id": region_id,
            "source_pdf": pdf_path.name,
        }

        if dry_run:
            log.info("DRY-RUN  would write %s → %s", pdf_path.name, out_file.name)
            entries.append(entry)
            written += 1
            continue

        # Text content sanity check (warn only — artwork may embed text as raster)
        if not check_text_contains_name(pdf_path, property_name):
            log.warning(
                "  %s: page text does not contain '%s' "
                "(artwork may use embedded raster text — verify manually)",
                pdf_path.name,
                property_name,
            )

        # Rasterise
        output_dir.mkdir(parents=True, exist_ok=True)
        rasterize_pdf(pdf_path, out_file)
        log.info("  wrote  %s  (%s)", out_file.name, _human_size(out_file))
        entries.append(entry)
        written += 1

    # Write manifest
    if dry_run:
        log.info("DRY-RUN  would write manifest → %s  (%d entries)", manifest_path, len(entries))
    else:
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_text(json.dumps(entries, indent=2, ensure_ascii=False) + "\n")
        log.info("Wrote manifest → %s  (%d entries)", manifest_path, len(entries))

    action = "would process" if dry_run else "processed"
    log.info(
        "\nSummary: %s %d PDFs, wrote %d, skipped %d",
        action,
        processed,
        written,
        skipped,
    )
    return 0


def _human_size(path: Path) -> str:
    kb = path.stat().st_size // 1024
    return f"{kb} KB"


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument(
        "--source-dir",
        default="~/Downloads/Portfolio Pages",
        help="Root folder containing region sub-folders of portfolio PDFs (default: ~/Downloads/Portfolio Pages)",
    )
    ap.add_argument(
        "--output-dir",
        default="./studio/public/proposal/portfolio",
        help="Directory to write rasterised JPEGs (default: ./studio/public/proposal/portfolio)",
    )
    ap.add_argument(
        "--manifest",
        default="./sql/migrations/036_portfolio_manifest.json",
        help="Path to write the JSON manifest (default: ./sql/migrations/036_portfolio_manifest.json)",
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be done without writing files or the manifest",
    )
    args = ap.parse_args()

    source_dir = Path(args.source_dir).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()
    manifest_path = Path(args.manifest).expanduser().resolve()

    if not source_dir.is_dir():
        log.error("Source directory not found: %s", source_dir)
        return 2

    log.info("Source  : %s", source_dir)
    log.info("Output  : %s", output_dir)
    log.info("Manifest: %s", manifest_path)
    if args.dry_run:
        log.info("(dry-run mode — no files will be written)")

    return process_source_dir(source_dir, output_dir, manifest_path, dry_run=args.dry_run)


if __name__ == "__main__":
    raise SystemExit(main())
