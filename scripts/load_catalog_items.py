#!/usr/bin/env python3
"""Handoff 22 — Kit Catalog loader: Aspire kit workbook → catalog_items seed.

Source of truth: `business docs/Juniper_Aspire_Kit_Review.xlsx`, pulled live
from Aspire (2026-07-14) by the GCP MySQL data workstream — the workbook Carlos
circulated for team review (Kit_Review_Email_Draft.md). Two pricing engines:

  * Install Kits (quantity-driven) — the full active + bid-available catalog
    (80 items, `ItemType='Kit' AND name LIKE '%Installed%'`). ItemCost is the
    embedded catalog/sub cost. Aspire does NOT store sell price or target GM on
    the catalog item (they are applied per estimate); we seed target_gm at the
    documented ~45% install GM and DERIVE a default unit_sell from
    cost ÷ (1 − target_gm) so a freshly added kit line prices sanely — the
    estimator overrides per estimate (blue-cell convention).
  * Maintenance Kits (hours-driven) — the active takeoff-item catalog with the
    OBSERVED production rate (units per labor-hour) and crew labor rate
    ($/hr → unit_cost_cents as cents per labor-hour) sampled from 500 recent
    kit/labor line pairs. Items the sample never hit stay production_rate NULL
    on purpose: the Handoff 22 save guard blocks estimating against them until
    the team supplies a rate. unit_sell_cents stays 0 — maintenance sell price
    is derived per estimate ($/1,000 SF), never stored on the kit.

The loader is IDEMPOTENT and reviewable:
  * deterministic ids  — maintenance: kit-maint-<Aspire takeoff item id>;
                         install: kit-inst-<sha1(description)[:12]>
  * output is `INSERT … ON DUPLICATE KEY UPDATE` (safe to re-run)
  * `--verify` compares extracted counts against the live `crm` DB
    (SQL uses bare table names — no `juniper.` prefix)

Usage (from repo root):
  venv/bin/python scripts/load_catalog_items.py                  # print SQL
  venv/bin/python scripts/load_catalog_items.py --out sql/migrations/007_seed_catalog_items.sql
  venv/bin/python scripts/load_catalog_items.py --verify         # counts vs DB

Stdlib-only on purpose (xlsx = zip of XML) — no openpyxl in requirements.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import sys
import zipfile
from dataclasses import dataclass
from pathlib import Path
from xml.etree import ElementTree as ET

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_WORKBOOK = REPO_ROOT / "business docs" / "Juniper_Aspire_Kit_Review.xlsx"

_M = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

# Sheet name → xlsx part, per the workbook's fixed layout.
_SHEETS = {"Maintenance Kits": "sheet2.xml", "Install Kits": "sheet3.xml"}

# Documented defaults (see module docstring). Confirmed provisional with the
# estimator questions doc; changing them is a data change, not a code change.
INSTALL_TARGET_GM = 0.45      # "irrigation items typically ~45% GM" (workbook README)
MAINTENANCE_TARGET_GM = 0.22  # app-wide maintenance target margin default


@dataclass(frozen=True)
class CatalogRow:
    id: str
    description: str
    uom: str
    unit_cost_cents: int
    unit_sell_cents: int
    target_gm: float
    kit_type: str  # 'maintenance_hours' | 'install_quantity'
    production_rate: float | None  # maintenance: units per labor-hour
    branch: str
    active: bool
    service_type: str


# ── xlsx parsing (stdlib) ─────────────────────────────────────────────────────

def _shared_strings(z: zipfile.ZipFile) -> list[str]:
    sst = ET.fromstring(z.read("xl/sharedStrings.xml"))
    return [
        "".join(t.text or "" for t in si.iter(_M + "t"))
        for si in sst.findall(_M + "si")
    ]


def _sheet_rows(z: zipfile.ZipFile, part: str, shared: list[str]) -> list[dict[str, str | None]]:
    root = ET.fromstring(z.read(f"xl/worksheets/{part}"))
    rows: list[dict[str, str | None]] = []
    for row in root.iter(_M + "row"):
        vals: dict[str, str | None] = {}
        for c in row:
            ref = c.get("r") or ""
            col = "".join(ch for ch in ref if ch.isalpha())
            v = c.find(_M + "v")
            if v is None:
                vals[col] = None
            elif c.get("t") == "s":
                vals[col] = shared[int(v.text)]
            else:
                vals[col] = v.text
        rows.append(vals)
    return rows


def _read_sheet(workbook: Path, sheet_name: str) -> list[dict[str, str | None]]:
    with zipfile.ZipFile(workbook) as z:
        return _sheet_rows(z, _SHEETS[sheet_name], _shared_strings(z))


def _num(raw: str | None) -> float | None:
    if raw is None or str(raw).strip() == "":
        return None
    return float(raw)


# ── extraction ────────────────────────────────────────────────────────────────

def extract_install_kits(workbook: Path = DEFAULT_WORKBOOK) -> list[CatalogRow]:
    """Install Kits tab: Item Name / Category / Item Cost / Unit / branches."""
    rows = _read_sheet(workbook, "Install Kits")
    # data starts after the header row ('Item Name', 'Category', …)
    start = next(
        i for i, r in enumerate(rows) if r.get("A") == "Item Name" and r.get("B") == "Category"
    ) + 1
    out: list[CatalogRow] = []
    for r in rows[start:]:
        name = r.get("A")
        cost = _num(r.get("C"))
        if not name or cost is None:
            continue
        cost_cents = round(cost * 100)
        digest = hashlib.sha1(name.encode("utf-8")).hexdigest()[:12]
        branch = (r.get("F") or "All Branches").strip()[:100]
        out.append(
            CatalogRow(
                id=f"kit-inst-{digest}",
                description=name.strip(),
                uom=(r.get("D") or "EA").strip(),
                unit_cost_cents=cost_cents,
                # default sell derived from embedded cost ÷ (1 − target GM);
                # per-estimate override is the real pricing surface
                unit_sell_cents=round(cost_cents / (1 - INSTALL_TARGET_GM)),
                target_gm=INSTALL_TARGET_GM,
                kit_type="install_quantity",
                production_rate=None,
                branch=branch,
                active=True,  # tab is filtered to Active + AvailableToBid
                service_type=(r.get("B") or "Install").strip(),
            )
        )
    return out


def extract_maintenance_kits(workbook: Path = DEFAULT_WORKBOOK) -> list[CatalogRow]:
    """Maintenance Kits tab: active takeoff items + observed standard rates.

    The takeoff table ends where the 'Legacy / Unmapped Item Names' review
    section begins — those rows are data-quality flags, not catalog rows.
    """
    rows = _read_sheet(workbook, "Maintenance Kits")
    start = next(
        i for i, r in enumerate(rows)
        if r.get("A") == "Takeoff Group" and r.get("C") == "Takeoff Item"
    ) + 1
    out: list[CatalogRow] = []
    for r in rows[start:]:
        group = r.get("A")
        if group is None or str(group).startswith("Legacy"):
            break
        item_id = r.get("I")
        item = r.get("C")
        if not item_id or not item:
            continue
        labor_rate = _num(r.get("E"))       # crew $/hr (may be unsampled)
        production = _num(r.get("F"))       # units per labor-hour (may be NULL)
        out.append(
            CatalogRow(
                id=f"kit-maint-{item_id}",
                description=item.strip(),
                uom=(r.get("D") or "EA").strip(),
                # cents per labor-hour (crew rate); pairs with production_rate
                unit_cost_cents=round(labor_rate * 100) if labor_rate is not None else 0,
                unit_sell_cents=0,  # maintenance sell derives per estimate
                target_gm=MAINTENANCE_TARGET_GM,
                kit_type="maintenance_hours",
                production_rate=production,
                branch="All Branches",
                active=r.get("B") == "1",
                service_type=(group or "Maintenance").strip(),
            )
        )
    return out


def extract_all(workbook: Path = DEFAULT_WORKBOOK) -> list[CatalogRow]:
    """The full catalog, maintenance first, in stable workbook order."""
    return extract_maintenance_kits(workbook) + extract_install_kits(workbook)


# ── seed SQL (reviewable + idempotent) ────────────────────────────────────────

def _sql_str(s: str) -> str:
    return "'" + s.replace("\\", "\\\\").replace("'", "''") + "'"


def _row_values(r: CatalogRow) -> str:
    production = "NULL" if r.production_rate is None else f"{r.production_rate:g}"
    return (
        f"({_sql_str(r.id)}, {_sql_str(r.description)}, {_sql_str(r.uom)}, "
        f"{r.unit_cost_cents}, {r.unit_sell_cents}, {r.target_gm:g}, "
        f"{_sql_str(r.kit_type)}, {production}, {_sql_str(r.branch)}, "
        f"{1 if r.active else 0}, {_sql_str(r.service_type)})"
    )


def generate_seed_sql(rows: list[CatalogRow]) -> str:
    counts = expected_counts(rows)
    values = ",\n".join(_row_values(r) for r in rows)
    return f"""-- Handoff 22 — seed catalog_items from the Aspire kit workbook
-- (business docs/Juniper_Aspire_Kit_Review.xlsx, pulled live 2026-07-14).
-- Generated by scripts/load_catalog_items.py — REGENERATE, don't hand-edit.
-- Idempotent: INSERT … ON DUPLICATE KEY UPDATE (deterministic ids).
--
-- Expected counts after load ({counts['total']} rows):
--   install_quantity  = {counts['install_quantity']}
--   maintenance_hours = {counts['maintenance_hours']}
-- Verify: SELECT kit_type, COUNT(*) FROM catalog_items GROUP BY kit_type;

INSERT INTO catalog_items
    (id, description, uom, unit_cost_cents, unit_sell_cents, target_gm,
     kit_type, production_rate, branch, active, service_type)
VALUES
{values}
ON DUPLICATE KEY UPDATE
    description     = VALUES(description),
    uom             = VALUES(uom),
    unit_cost_cents = VALUES(unit_cost_cents),
    unit_sell_cents = VALUES(unit_sell_cents),
    target_gm       = VALUES(target_gm),
    kit_type        = VALUES(kit_type),
    production_rate = VALUES(production_rate),
    branch          = VALUES(branch),
    active          = VALUES(active),
    service_type    = VALUES(service_type);
"""


# ── count validation (SQL-investigation pattern) ──────────────────────────────

def expected_counts(rows: list[CatalogRow]) -> dict[str, int]:
    return {
        "install_quantity": sum(1 for r in rows if r.kit_type == "install_quantity"),
        "maintenance_hours": sum(1 for r in rows if r.kit_type == "maintenance_hours"),
        "total": len(rows),
    }


async def verify_counts(rows: list[CatalogRow], query=None) -> tuple[bool, str]:
    """Compare extracted counts against the live `crm` DB (bare table names).

    `query` defaults to db.query (the app's pool); injectable for tests.
    """
    if query is None:  # pragma: no cover - live-DB path
        sys.path.insert(0, str(REPO_ROOT))
        from db import query as query  # noqa: PLC0415
    expected = expected_counts(rows)
    db_rows = await query(
        "SELECT kit_type, COUNT(*) AS c FROM catalog_items GROUP BY kit_type", []
    )
    actual = {r["kit_type"]: int(r["c"]) for r in db_rows}
    lines = []
    ok = True
    for kit_type in ("install_quantity", "maintenance_hours"):
        exp, act = expected[kit_type], actual.get(kit_type, 0)
        status = "OK" if exp == act else "MISMATCH"
        ok = ok and exp == act
        lines.append(f"  {kit_type:<18} expected={exp:<4} db={act:<4} {status}")
    return ok, "catalog_items count validation:\n" + "\n".join(lines)


# ── CLI ───────────────────────────────────────────────────────────────────────

def main(argv: list[str] | None = None) -> int:  # pragma: no cover - thin CLI
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--workbook", type=Path, default=DEFAULT_WORKBOOK)
    parser.add_argument("--out", type=Path, help="write seed SQL here (else stdout)")
    parser.add_argument(
        "--verify", action="store_true",
        help="compare extracted counts against the live crm DB and exit",
    )
    args = parser.parse_args(argv)

    rows = extract_all(args.workbook)
    if args.verify:
        ok, report = asyncio.run(verify_counts(rows))
        print(report)
        return 0 if ok else 1

    sql = generate_seed_sql(rows)
    if args.out:
        args.out.write_text(sql, encoding="utf-8")
        counts = expected_counts(rows)
        print(f"Wrote {counts['total']} rows to {args.out} "
              f"(install={counts['install_quantity']}, "
              f"maintenance={counts['maintenance_hours']})")
    else:
        print(sql)
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
