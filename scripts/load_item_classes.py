#!/usr/bin/env python3
"""Load the Acumatica item class list into item_class_groups and item_classes.

Source: scripts/data/acumatica_item_classes.xlsx (Sheet1). The sheet has no
items; it is the class list items are filed under. Columns read, by header:

    Final List for Upload to Acumatica        class label, "601-IRR-Irrigation Parts"
    Acumatica Item Class ID with underscores  item_class_id, "IRRIGATION-PARTS_____"
    Posting Class                             posting_class when it is a code
    Description                               group, "600 Irrigation/Drainage"

Everything else on the sheet (the Aspire category list in column A, the
space-padded class id, the notes column) is not loaded.

Rules:
    - A class row is a label matching ``NNN-Name``. A label row with no
      underscore class id (903 Breakroom Supplies, 904 "NOT ADDED") is
      skipped and listed.
    - A class belongs to the group with the largest code not above its own
      (601 -> 600, 999 -> 999).
    - Posting Class is stored only when it is a code (DIRMATL, SUBCONTR).
      GL numbers and notes ("7300, 7310, 7320, 7330?") are left NULL and
      listed.
    - The sheet is the whole list. A class or group in the database that the
      sheet no longer has is deleted. Stale classes are deleted before the
      upsert so a class whose id changed does not collide on its code.

Usage (from repo root):
    venv/bin/python scripts/load_item_classes.py --dry-run
    venv/bin/python scripts/load_item_classes.py
    venv/bin/python scripts/load_item_classes.py other.xlsx

Env vars (same as scripts/migrate.py), used only when not --dry-run:
    MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DB, MYSQL_SOCKET_PATH
"""
from __future__ import annotations

import argparse
import re
import sys
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts.xlsx import shared_strings, sheet_rows, sheet_targets  # noqa: E402

DEFAULT_WORKBOOK = REPO_ROOT / "scripts" / "data" / "acumatica_item_classes.xlsx"

_LABEL = "final list for upload to acumatica"
_CLASS_ID = "acumatica item class id with underscores"
_POSTING = "posting class"
_GROUP = "description"

_CLASS_LABEL = re.compile(r"(\d{3})-(.+)")
_GROUP_LABEL = re.compile(r"(\d{3})\s+(.+)")
_POSTING_CODE = re.compile(r"[A-Z][A-Z0-9]*")

# Schema limits (071).
_ID_MAX = 128
_NAME_MAX = 128
_POSTING_MAX = 64

Rows = list[tuple[int, dict[str, str | None]]]


@dataclass(frozen=True)
class ItemClassGroup:
    code: int
    name: str


@dataclass(frozen=True)
class ItemClass:
    item_class_id: str
    code: int
    name: str
    group_code: int
    posting_class: str | None


@dataclass(frozen=True)
class Skipped:
    row_number: int
    label: str
    reason: str


@dataclass
class ClassList:
    groups: list[ItemClassGroup] = field(default_factory=list)
    classes: list[ItemClass] = field(default_factory=list)
    skipped: list[Skipped] = field(default_factory=list)
    # (class code, sheet text) for Posting Class cells that are not a code.
    posting_notes: list[tuple[int, str]] = field(default_factory=list)


@dataclass
class ApplyResult:
    groups_upserted: int = 0
    classes_upserted: int = 0
    classes_deleted: int = 0
    groups_deleted: int = 0


# ── workbook ──────────────────────────────────────────────────────────────────

def _text(value: str | None) -> str:
    return " ".join(str(value).split()) if value is not None else ""


def _columns(rows: Rows) -> tuple[int, dict[str, str]]:
    """Return (header index, header -> column letter) for the header row."""
    for i, (_number, row) in enumerate(rows):
        headers = {_text(v).casefold(): col for col, v in row.items() if _text(v)}
        if _LABEL in headers:
            missing = [h for h in (_CLASS_ID, _POSTING, _GROUP) if h not in headers]
            if missing:
                raise ValueError(f"item class sheet is missing columns: {', '.join(missing)}")
            return i, headers
    raise ValueError(f"item class sheet has no {_LABEL!r} header")


def _group_for(code: int, groups: list[ItemClassGroup]) -> int:
    owners = [g.code for g in groups if g.code <= code]
    if not owners:
        raise ValueError(f"item class {code} has no group")
    return max(owners)


def parse_rows(rows: Rows) -> ClassList:
    header_at, cols = _columns(rows)
    out = ClassList()
    found: list[tuple[int, int, str, str, str]] = []
    for number, row in rows[header_at + 1 :]:
        group = _GROUP_LABEL.fullmatch(_text(row.get(cols[_GROUP])))
        if group:
            out.groups.append(ItemClassGroup(code=int(group[1]), name=group[2]))
        label = _text(row.get(cols[_LABEL]))
        match = _CLASS_LABEL.fullmatch(label)
        if not match:
            continue
        class_id = (row.get(cols[_CLASS_ID]) or "").strip()
        if not class_id:
            out.skipped.append(Skipped(number, label, "no_acumatica_class_id"))
            continue
        found.append((number, int(match[1]), match[2], class_id, _text(row.get(cols[_POSTING]))))

    for kind, values in (("group", [g.code for g in out.groups]),
                         ("class code", [c[1] for c in found]),
                         ("class id", [c[3] for c in found])):
        dupes = sorted({str(v) for v in values if values.count(v) > 1})
        if dupes:
            raise ValueError(f"duplicate {kind}: {', '.join(dupes)}")
    out.groups.sort(key=lambda g: g.code)

    for number, code, name, class_id, posting in found:
        if len(class_id) > _ID_MAX or len(name) > _NAME_MAX:
            raise ValueError(f"row {number}: class id or name longer than {_ID_MAX}")
        posting_class = posting if _POSTING_CODE.fullmatch(posting) and len(posting) <= _POSTING_MAX else None
        if posting and posting_class is None:
            out.posting_notes.append((code, posting))
        out.classes.append(ItemClass(
            item_class_id=class_id,
            code=code,
            name=name,
            group_code=_group_for(code, out.groups),
            posting_class=posting_class,
        ))
    out.classes.sort(key=lambda c: c.code)
    return out


def read_workbook(workbook: Path = DEFAULT_WORKBOOK) -> ClassList:
    with zipfile.ZipFile(workbook) as z:
        targets = sheet_targets(z)
        if len(targets) != 1:
            raise ValueError(f"expected one sheet, found {len(targets)}")
        return parse_rows(sheet_rows(z, targets[0][1], shared_strings(z)))


def format_summary(parsed: ClassList, *, dry_run: bool, apply: ApplyResult | None = None,
                   unknown_material_classes: list[tuple[str, int]] | None = None) -> str:
    lines = [
        f"item class load ({'dry-run' if dry_run else 'write'})",
        f"  groups: {len(parsed.groups)}",
        f"  classes: {len(parsed.classes)}",
        f"  classes with posting class: {sum(1 for c in parsed.classes if c.posting_class)}",
        f"  skipped rows: {len(parsed.skipped)}",
    ]
    lines += [f"    row {s.row_number} {s.label}: {s.reason}" for s in parsed.skipped]
    lines.append(f"  posting class left NULL (not a code): {len(parsed.posting_notes)}")
    lines += [f"    {code}: {text}" for code, text in parsed.posting_notes]
    if apply is not None:
        lines += [
            f"  groups upserted: {apply.groups_upserted}",
            f"  classes upserted: {apply.classes_upserted}",
            f"  classes deleted: {apply.classes_deleted}",
            f"  groups deleted: {apply.groups_deleted}",
        ]
    if unknown_material_classes is not None:
        lines.append(f"  materials item classes not in the list: {len(unknown_material_classes)}")
        lines += [f"    {cls}: {count} items" for cls, count in unknown_material_classes]
    return "\n".join(lines)


# ── database ──────────────────────────────────────────────────────────────────

# VALUES() rather than a row alias: MariaDB 10.11 (local bootstrap) has no
# row alias, and MySQL 8.4 still runs VALUES(). Same choice as
# scripts/load_materials_catalog.py.
_GROUP_SQL = """
INSERT INTO item_class_groups (code, name) VALUES (%s, %s)
ON DUPLICATE KEY UPDATE name = VALUES(name)
"""

_CLASS_SQL = """
INSERT INTO item_classes (item_class_id, code, name, group_code, posting_class)
VALUES (%s, %s, %s, %s, %s)
ON DUPLICATE KEY UPDATE
    code = VALUES(code),
    name = VALUES(name),
    group_code = VALUES(group_code),
    posting_class = VALUES(posting_class)
"""


def _marks(values: list) -> str:
    return ", ".join(["%s"] * len(values))


def apply_list(conn, parsed: ClassList) -> ApplyResult:
    """Make the tables match the sheet. Runs in the caller's transaction."""
    if not parsed.classes or not parsed.groups:
        raise ValueError("refusing to load an empty item class list")
    ids = [c.item_class_id for c in parsed.classes]
    codes = [g.code for g in parsed.groups]
    result = ApplyResult(groups_upserted=len(parsed.groups), classes_upserted=len(parsed.classes))
    with conn.cursor() as cur:
        result.classes_deleted = cur.execute(
            f"DELETE FROM item_classes WHERE item_class_id NOT IN ({_marks(ids)})", ids,
        )
        cur.executemany(_GROUP_SQL, [(g.code, g.name) for g in parsed.groups])
        cur.executemany(_CLASS_SQL, [
            (c.item_class_id, c.code, c.name, c.group_code, c.posting_class)
            for c in parsed.classes
        ])
        result.groups_deleted = cur.execute(
            f"DELETE FROM item_class_groups WHERE code NOT IN ({_marks(codes)})", codes,
        )
    return result


def unknown_material_classes(conn) -> list[tuple[str, int]]:
    """materials.item_class values with no item_classes row, most items first."""
    with conn.cursor() as cur:
        cur.execute(
            """SELECT m.item_class AS item_class, COUNT(*) AS items
                 FROM materials m
                 LEFT JOIN item_classes c ON c.item_class_id = m.item_class
                WHERE m.item_class IS NOT NULL AND c.item_class_id IS NULL
                GROUP BY m.item_class
                ORDER BY items DESC, m.item_class"""
        )
        return [(row["item_class"], int(row["items"])) for row in cur.fetchall()]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("workbook", type=Path, nargs="?", default=DEFAULT_WORKBOOK)
    parser.add_argument("--dry-run", action="store_true", help="parse and print counts; do not write the database")
    args = parser.parse_args(argv)

    parsed = read_workbook(args.workbook)
    if args.dry_run:
        print(format_summary(parsed, dry_run=True))
        return 0

    from scripts.migrate import connect

    conn = connect()
    conn.autocommit(False)
    try:
        result = apply_list(conn, parsed)
        unknown = unknown_material_classes(conn)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    print(format_summary(parsed, dry_run=False, apply=result, unknown_material_classes=unknown))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
