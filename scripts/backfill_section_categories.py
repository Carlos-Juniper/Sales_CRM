#!/usr/bin/env python3
"""Backfill estimate_sections.service_category_id for existing install sections (Handoff 55 §3).

A one-off data backfill, not a migration: it depends on the install catalog
rows scripts/load_service_catalog.py seeds (migration 073 creates the tables
empty), and its outcome is a report someone reads.

Rule (plain category name only): a section of an install estimate whose
service_category_id is NULL gets the active install category whose name
equals the section name after api.install_sections.normalize_section_name
(trim, collapse whitespace runs to one space, case-insensitive). Nothing
else matches: no "Category - area" form, no partial or fuzzy match.

Every other install section with a NULL category stays NULL and is listed
with a reason:
    no_match               no category has that name
    ambiguous              more than one active install category has it
    duplicate_category     the estimate already has a section with that
                           category (or an earlier section matched it)
    service_line_conflict  a service line on the section uses a service of
                           another category (Handoff 55 D9)

Never touches a non-NULL service_category_id (the UPDATE is also guarded on
IS NULL) or a maintenance estimate's section. Idempotent: a second run finds
nothing left to match. One transaction; --dry-run writes nothing.

Usage (from repo root):
    venv/bin/python scripts/backfill_section_categories.py --dry-run [--report report.json]
    venv/bin/python scripts/backfill_section_categories.py [--report report.json]

Env vars (same as scripts/migrate.py):
    MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DB, MYSQL_SOCKET_PATH
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from api.install_sections import normalize_section_name  # noqa: E402

ESTIMATE_TYPE = "install"


@dataclass
class Report:
    dry_run: bool
    install_sections: int = 0
    already_set: int = 0
    non_install_null_untouched: int = 0
    matched: list[dict] = field(default_factory=list)
    left_null: list[dict] = field(default_factory=list)
    updated: int = 0

    def counts(self) -> dict:
        reasons: dict[str, int] = {}
        for r in self.left_null:
            reasons[r["reason"]] = reasons.get(r["reason"], 0) + 1
        return {
            "install_sections": self.install_sections,
            "already_set": self.already_set,
            "matched": len(self.matched),
            "left_null": len(self.left_null),
            "left_null_by_reason": dict(sorted(reasons.items())),
            "updated": self.updated,
            "non_install_null_untouched": self.non_install_null_untouched,
        }


def _fetch(cur, sql: str, params=()) -> list[dict]:
    cur.execute(sql, params)
    return list(cur.fetchall())


def plan(cur) -> Report:
    """Read-only: classify every install section. Nothing is written."""
    report = Report(dry_run=True)
    categories = _fetch(cur, "SELECT id, code, name FROM service_categories "
                             "WHERE estimate_type = %s AND active = 1 ORDER BY sort_order, id",
                        (ESTIMATE_TYPE,))
    sections = _fetch(cur, "SELECT s.id, s.estimate_id, s.name, s.service_category_id FROM estimate_sections s "
                           "JOIN estimates e ON e.id = s.estimate_id WHERE e.estimate_type = %s "
                           "ORDER BY s.estimate_id, s.id", (ESTIMATE_TYPE,))
    report.non_install_null_untouched = _fetch(
        cur, "SELECT COUNT(*) AS n FROM estimate_sections s JOIN estimates e ON e.id = s.estimate_id "
             "WHERE e.estimate_type <> %s AND s.service_category_id IS NULL", (ESTIMATE_TYPE,))[0]["n"]
    line_categories: dict[str, set] = {}
    for r in _fetch(cur, "SELECT ss.section_id, sv.service_category_id FROM section_services ss "
                         "JOIN services sv ON sv.id = ss.service_id "
                         "JOIN estimate_sections s ON s.id = ss.section_id "
                         "JOIN estimates e ON e.id = s.estimate_id "
                         "WHERE e.estimate_type = %s AND s.service_category_id IS NULL", (ESTIMATE_TYPE,)):
        line_categories.setdefault(r["section_id"], set()).add(r["service_category_id"])

    by_name: dict[str, list[dict]] = {}
    for c in categories:
        by_name.setdefault(normalize_section_name(c["name"]), []).append(c)
    used: dict[str, set] = {}
    for s in sections:
        if s["service_category_id"] is not None:
            used.setdefault(s["estimate_id"], set()).add(s["service_category_id"])

    report.install_sections = len(sections)
    for s in sections:
        if s["service_category_id"] is not None:
            report.already_set += 1
            continue
        row = {"sectionId": s["id"], "estimateId": s["estimate_id"], "name": s["name"]}
        found = by_name.get(normalize_section_name(s["name"]), [])
        if not found:
            report.left_null.append({**row, "reason": "no_match"})
            continue
        if len(found) > 1:
            report.left_null.append({**row, "reason": "ambiguous", "candidates": [c["id"] for c in found]})
            continue
        cat = found[0]["id"]
        if cat in used.get(s["estimate_id"], set()):
            report.left_null.append({**row, "reason": "duplicate_category", "category": cat})
            continue
        others = sorted(line_categories.get(s["id"], set()) - {cat})
        if others:
            report.left_null.append({**row, "reason": "service_line_conflict", "category": cat,
                                     "serviceLineCategories": others})
            continue
        used.setdefault(s["estimate_id"], set()).add(cat)
        report.matched.append({**row, "category": cat})
    return report


def apply(conn, report: Report) -> int:
    """Set each matched section's category, only where it is still NULL."""
    n = 0
    with conn.cursor() as cur:
        for m in report.matched:
            n += cur.execute(
                "UPDATE estimate_sections SET service_category_id = %s WHERE id = %s AND service_category_id IS NULL",
                (m["category"], m["sectionId"]),
            )
    return n


def run(conn, *, dry_run: bool) -> Report:
    conn.autocommit(False)
    try:
        with conn.cursor() as cur:
            report = plan(cur)
        report.dry_run = dry_run
        if dry_run:
            conn.rollback()
        else:
            report.updated = apply(conn, report)
            conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.autocommit(True)
    return report


def format_report(report: Report) -> str:
    c = report.counts()
    lines = [
        f"section category backfill ({'dry-run' if report.dry_run else 'write'})",
        f"  install sections: {c['install_sections']}",
        f"  already set (left alone): {c['already_set']}",
        f"  matched: {c['matched']}" + ("" if report.dry_run else f" (updated {c['updated']})"),
    ]
    per_cat: dict[str, int] = {}
    for m in report.matched:
        per_cat[m["category"]] = per_cat.get(m["category"], 0) + 1
    lines += [f"    {cat}: {n}" for cat, n in sorted(per_cat.items())]
    lines.append(f"  left NULL: {c['left_null']} {c['left_null_by_reason'] or ''}".rstrip())
    for r in report.left_null:
        extra = ""
        if r["reason"] == "ambiguous":
            extra = f" candidates={','.join(r['candidates'])}"
        elif r["reason"] in ("duplicate_category", "service_line_conflict"):
            extra = f" category={r['category']}"
            if r.get("serviceLineCategories"):
                extra += f" lines={','.join(r['serviceLineCategories'])}"
        lines.append(f"    {r['sectionId']} (estimate {r['estimateId']}): {r['name']!r} {r['reason']}{extra}")
    lines.append(f"  non-install sections with NULL category (never touched): {c['non_install_null_untouched']}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="classify and report; write nothing")
    parser.add_argument("--report", type=Path, help="also write the full report as JSON here")
    args = parser.parse_args(argv)

    from scripts.migrate import connect

    conn = connect()
    try:
        report = run(conn, dry_run=args.dry_run)
    finally:
        conn.close()
    print(format_report(report))
    if args.report:
        args.report.write_text(json.dumps({**asdict(report), "counts": report.counts()}, indent=2) + "\n",
                               encoding="utf-8")
        print(f"  report: {args.report}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
