#!/usr/bin/env python3
"""
Normalize headshot filenames from raw download folder to the
`headshot-<slug>.jpg` format expected by studio/src/lib/proposal/photos.ts.

Source: ~/Downloads/Headshots/ (excluding Background Needed/ subfolder)
Subdirs included: root level + CRMs/, Branch Managers/, Irrigation Managers/
Output: copies renamed files to --output-dir, ready for upload via
        scripts/upload_proposal_photos.py

Slug rule mirrors headshotSlug() in photos.ts:
  lowercase, collapse non-alphanumeric runs → single hyphen, trim ends.

Usage (from repo root):
    python -m scripts.normalize_headshots --dry-run
    python -m scripts.normalize_headshots --output-dir ./tmp/headshots/
    python -m scripts.normalize_headshots --source-dir ~/Downloads/Headshots --output-dir ./tmp/headshots/
"""
from __future__ import annotations

import argparse
import re
import shutil
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Manual overrides — map raw filename stems (after basic suffix stripping but
# BEFORE slugifying) to the correct DB name.
#
# Rod Leon → Rodrigo Leon  (W2 migration renames the DB row; slug must match)
# Diedra Calloway → Deidra Calloway  (transposed i/e in filename vs. DB)
# ---------------------------------------------------------------------------
_NAME_OVERRIDES: dict[str, str] = {
    'rod leon': 'rodrigo leon',
    'diedra calloway': 'deidra calloway',
}

# ---------------------------------------------------------------------------
# Files to skip entirely with an explanatory flag.
# Key: lowercased stem of the filename AFTER extension removal (no suffixes
# stripped yet); Value: message to print for Carlos.
# ---------------------------------------------------------------------------
_SKIP_FLAGS: dict[str, str] = {
    'amber headshot': (
        'FLAG [SKIP] amber headshot → first name only, no surname → '
        'no unique slug possible. Upload manually after confirming full name.'
    ),
    'amber': (
        'FLAG [SKIP] Amber → first name only, no surname → '
        'no unique slug possible. Upload manually after confirming full name.'
    ),
}

# City/location qualifiers that may appear between the person's name and
# "Headshot". Order matters — longest/most-specific first.
_LOCATION_QUALIFIERS = [
    'Riviera Beach Sports Turf',
    'Riviera Beach',
    'Fort Myers',
    'Davie',
]


def slugify_name(name: str) -> str:
    """Lowercase a full name and collapse non-alphanumeric runs to hyphens.

    Mirrors headshotSlug() in studio/src/lib/proposal/photos.ts exactly:
        name.toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
    """
    return re.sub(r'[^a-z0-9]+', '-', name.lower().strip()).strip('-')


def _strip_suffixes(stem: str) -> str:
    """Remove trailing photographer/location/year label noise from a stem."""
    # Work case-insensitively on a copy; we'll return the lowercased result.
    s = stem.strip()

    # 1. Strip ' - Headshot 2026'
    s = re.sub(r'\s*-\s*Headshot\s+2026\s*$', '', s, flags=re.IGNORECASE)

    # 2. Strip ' - <Location> Headshot' (location-qualified, with dash)
    for loc in _LOCATION_QUALIFIERS:
        pattern = rf'\s*-\s*{re.escape(loc)}\s+Headshot\s*$'
        s = re.sub(pattern, '', s, flags=re.IGNORECASE)

    # 3. Strip ' - Headshot' (bare, with dash)
    s = re.sub(r'\s*-\s*Headshot\s*$', '', s, flags=re.IGNORECASE)

    # 4. Strip ' <Location> Headshot' (no dash)
    for loc in _LOCATION_QUALIFIERS:
        pattern = rf'\s+{re.escape(loc)}\s+Headshot\s*$'
        s = re.sub(pattern, '', s, flags=re.IGNORECASE)

    # 5. Strip ' Headshot 2026' (no dash)
    s = re.sub(r'\s+Headshot\s+2026\s*$', '', s, flags=re.IGNORECASE)

    # 6. Strip ' Headshot' (no dash, bare)
    s = re.sub(r'\s+Headshot\s*$', '', s, flags=re.IGNORECASE)

    # 7. Strip trailing branch suffixes like ' - Fort Myers', ' - Davie', etc.
    #    Only if still present (some were consumed by location-qualified rules above).
    for loc in _LOCATION_QUALIFIERS:
        pattern = rf'\s*-\s*{re.escape(loc)}\s*$'
        s = re.sub(pattern, '', s, flags=re.IGNORECASE)

    return s.strip()


def normalize_headshot_name(raw_stem: str) -> str:
    """Convert a raw filename stem to the canonical headshot-<slug>.jpg base.

    Returns the full filename including the 'headshot-' prefix and '.jpg'
    extension so callers can write it directly. Does NOT include the extension
    separator — caller appends nothing.

    Raises ValueError for skippable files (caller should catch and flag).
    """
    cleaned = _strip_suffixes(raw_stem)
    name_lower = cleaned.lower().strip()

    # Check skip list before override lookup
    for skip_key, message in _SKIP_FLAGS.items():
        if name_lower == skip_key or raw_stem.lower().strip() == skip_key:
            raise SkipFile(message)

    # Apply manual overrides (after stripping, before slugifying)
    canonical_name = _NAME_OVERRIDES.get(name_lower, name_lower)

    slug = slugify_name(canonical_name)
    return f'headshot-{slug}'


class SkipFile(Exception):
    """Raised when a file should be skipped with a flag message."""


# ---------------------------------------------------------------------------
# Source subdirectories to walk (relative to source_dir root)
# ---------------------------------------------------------------------------
_INCLUDE_SUBDIRS = [
    '',                     # root level
    'CRMs',
    'Branch Managers',
    'Irrigation Managers',
]

# Subdirectories to always exclude
_EXCLUDE_SUBDIRS = {'Background Needed'}

# Accepted source extensions (case-insensitive)
_IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp'}


def _collect_source_files(source_dir: Path) -> list[Path]:
    """Return all image files from root + included subdirs, skipping excluded ones."""
    files: list[Path] = []
    for subdir in _INCLUDE_SUBDIRS:
        target = source_dir / subdir if subdir else source_dir
        if not target.is_dir():
            continue
        for path in sorted(target.iterdir()):
            if not path.is_file():
                continue
            if path.name.startswith('.'):
                continue
            if path.parent.name in _EXCLUDE_SUBDIRS:
                continue
            if path.suffix.lower() not in _IMAGE_EXTENSIONS:
                continue
            files.append(path)
    return files


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        '--source-dir',
        default=str(Path.home() / 'Downloads' / 'Headshots'),
        help='Root of the raw headshots download (default: ~/Downloads/Headshots)',
    )
    ap.add_argument(
        '--output-dir',
        default='./tmp/headshots/',
        help='Staging directory for normalized output (default: ./tmp/headshots/)',
    )
    ap.add_argument(
        '--dry-run',
        action='store_true',
        help='Print what would happen without writing any files',
    )
    args = ap.parse_args()

    source_dir = Path(args.source_dir).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()

    if not source_dir.is_dir():
        print(f'error: source dir not found: {source_dir}', file=sys.stderr)
        return 2

    if not args.dry_run:
        output_dir.mkdir(parents=True, exist_ok=True)

    files = _collect_source_files(source_dir)
    if not files:
        print(f'warning: no image files found under {source_dir}', file=sys.stderr)
        return 0

    copied = skipped = flagged = 0
    flags: list[str] = []

    # Special multi-file flag: detect Tom Jacob / Tom Jacobs discrepancy
    stems_lower = {p.stem.lower() for p in files}
    if 'tom jacob - davie headshot' in stems_lower and 'tom jacobs' in stems_lower:
        msg = (
            'FLAG [REVIEW] Two different spellings found:\n'
            '  "Tom Jacob - Davie Headshot.png"  (in CRMs/ or root)\n'
            '  "Tom Jacobs.jpg"  (in Background Needed/ — excluded from output)\n'
            '  → Verify correct surname before uploading. Are these two different people?'
        )
        flags.append(msg)
        print(msg)

    # Individual Rod Leon / Diedra Calloway flags are printed implicitly via
    # the override — we print an explicit callout so Carlos doesn't miss them.
    _ROD_FLAG_STEMS = {'rod leon - headshot 2026', 'rod leon - headshot', 'rod leon headshot 2026', 'rod leon headshot'}
    _DIEDRA_FLAG_STEMS = {'diedra calloway - headshot 2026', 'diedra calloway - headshot', 'diedra calloway headshot 2026'}
    for path in files:
        sl = path.stem.lower()
        if sl in _ROD_FLAG_STEMS:
            msg = (
                f'FLAG [RENAME] "{path.name}" → slug will be "rodrigo-leon" '
                f'(not "rod-leon") to match DB name "Rodrigo Leon" after W2 migration.'
            )
            flags.append(msg)
            print(msg)
        if sl in _DIEDRA_FLAG_STEMS:
            msg = (
                f'FLAG [RENAME] "{path.name}" → slug will be "deidra-calloway" '
                f'(not "diedra-calloway") to match DB spelling "Deidra Calloway".'
            )
            flags.append(msg)
            print(msg)

    for path in files:
        stem = path.stem
        try:
            out_base = normalize_headshot_name(stem)
        except SkipFile as exc:
            msg = str(exc)
            if msg not in flags:
                flags.append(msg)
                print(msg)
            flagged += 1
            continue

        out_name = f'{out_base}.jpg'
        dest = output_dir / out_name

        if args.dry_run:
            print(f'  would copy  {path.name!r:<50}  →  {out_name}')
            copied += 1
        else:
            shutil.copy2(str(path), str(dest))
            print(f'  copied      {path.name!r:<50}  →  {out_name}')
            copied += 1

    action = 'would copy' if args.dry_run else 'copied'
    print(
        f'\n{action} {copied} file(s) to {output_dir}'
        f' | {flagged} skipped (flagged) | {len(flags)} flag(s) printed above'
    )
    if not args.dry_run and copied:
        print(
            '\nNext: run python -m scripts.upload_proposal_photos --dry-run '
            'to verify, then upload without --dry-run.'
        )
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
