#!/usr/bin/env python3
"""Load the install service catalog (Handoff 55 §1) from the checked-in Aspire extract.

Source: scripts/data/aspire_install_service_catalog.json (Handoff 55 §0). This
loader never talks to Aspire. It writes three tables created by migration 073:

    service_categories     level 1 (estimate_type = 'install' rows only)
    services               level 2, one row per Aspire Service (aspire_service_id)
    service_default_items  the D2 template, labor line only (see below)

It never writes service_kit_links (D1: install has no kit layer), and never
writes service_kits, materials, material_prices, item_classes or
item_class_groups.

Rules:
    - Categories come from the extract's recommended_sections: each Aspire
      ServiceType maps to exactly one section. Section order is the extract's
      order; Aspire carries no usable SortOrder (extract caveat).
    - 'design' is not seeded. The extract says whether Design is a level-1
      install section "is a product decision this extract cannot make", and
      flags two of its services as mis-filed. Its services are skipped and
      listed. Add it to SEEDED_SECTIONS once decided.
    - 'Sleeving' is a service under Irrigation (extract answer q1), not a
      section, so there is no Sleeving category.
    - 'Optional Services' is not a ServiceType. It is seeded as one extra
      install category with is_optional = 1 and aspire_service_group_name =
      'Optional Services' (the raw group name the extract verified carries
      OptionalServiceGroup = true, answer q3). It owns no services: in Aspire
      its lines come from the ordinary install catalog.
    - A service the extract marks inactive is skipped. A service whose name
      contains DO NOT USE is skipped even when the extract still flags it
      active (18877, 18881, 29824, 30271: zero sampled lines, answer q2).
    - aspire_service_group_name is set only where the extract verified the
      exact group name (Optional Services). default_occurrences stays NULL
      (maintenance's column).
    - item_class_codes is the §2 soft prefilter from the Handoff 55
      section -> item-class table (item_classes.code values). Sections the
      table does not list are NULL = unfiltered.
    - Default items: a labor line only, driven by the matching service_kits
      row, and only for the five main install services. DEFAULT_LABOR_KITS
      maps Aspire service id -> service_kits.id. It is empty: no install
      service_kits row is a per-service labor kit (they are priced
      "... Installed" items), so every service seeds zero default items
      rather than a guessed one. A kit listed here that is missing, not
      install_quantity, or inactive fails the load.
    - Ids are deterministic (install-cat-<code>, install-svc-<aspire id>,
      install-sdi-<aspire id>-<n>) and every write is an upsert, so a second
      run changes nothing. A category or service the extract no longer
      produces is set active = 0, never deleted (estimate lines reference it).

Every count in the extract is a SAMPLE count (Handoff 55 §0). Sample line
counts are used only to order services within a section; the summary labels
them as sample counts.

Usage (from repo root):
    venv/bin/python scripts/load_service_catalog.py --dry-run
    venv/bin/python scripts/load_service_catalog.py

Env vars (same as scripts/migrate.py), used only when not --dry-run:
    MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DB, MYSQL_SOCKET_PATH
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

DEFAULT_EXTRACT = REPO_ROOT / "scripts" / "data" / "aspire_install_service_catalog.json"

ESTIMATE_TYPE = "install"

# Sections seeded from the extract, in display order. 'design' is left out on
# purpose (see module docstring).
SEEDED_SECTIONS = (
    "landscape", "irrigation", "drainage", "lighting", "sod",
    "hardscape", "subcontractor", "marketing_gratis",
)

OPTIONAL_CODE = "optional_services"
OPTIONAL_NAME = "Optional Services"

# Handoff 55 "section -> item-class mapping", as item_classes.code values
# (scripts/data/acumatica_item_classes.xlsx). Filter on the code, never on the
# padded underscore id. Missing section = NULL = unfiltered.
ITEM_CLASS_CODES: dict[str, list[int]] = {
    # 701 Aggregate, 702 Soil, 704 Mulch, 705 Geotextile, 706 Planters,
    # 708 Hardscape/Pavers, 709 Lumber + 80x LG (Trees, Palms, Shrubs/Vines,
    # Bamboo, Annuals, Small Materials). 807 LG-Subcontractor Labor is
    # Subcontractor's.
    "landscape": [701, 702, 704, 705, 706, 708, 709, 801, 802, 803, 804, 805, 806],
    "irrigation": [601, 602, 605, 606],
    "sod": [703],
    "drainage": [604],
    "lighting": [710],
    "subcontractor": [603, 707, 807],
}

# The five main install services that may carry a default labor line.
MAIN_INSTALL_SERVICES = {
    18878: "IN: Irrigation Install",
    18882: "IN: Landscape Install",
    18888: "IN: Sod Install",
    18875: "IN: Drainage Install",
    18885: "IN: Lighting Install",
}

# Aspire service id -> service_kits.id for the default labor line. Empty: no
# defensible match exists (module docstring). Keys must be MAIN_INSTALL_SERVICES.
DEFAULT_LABOR_KITS: dict[int, str] = {}

# Schema limits (073).
_NAME_MAX = 255
_CATEGORY_NAME_MAX = 128


@dataclass(frozen=True)
class Category:
    id: str
    code: str
    name: str
    sort_order: int
    is_optional: bool
    aspire_service_group_name: str | None
    item_class_codes: list[int] | None


@dataclass(frozen=True)
class Service:
    id: str
    category_id: str
    name: str
    display_name: str
    sort_order: int
    aspire_service_id: int
    sample_line_count: int


@dataclass(frozen=True)
class Skipped:
    aspire_service_id: int | None
    name: str
    reason: str


@dataclass
class Catalog:
    categories: list[Category] = field(default_factory=list)
    services: list[Service] = field(default_factory=list)
    skipped: list[Skipped] = field(default_factory=list)
    extracted_at: str = ""


@dataclass(frozen=True)
class DefaultItem:
    id: str
    service_id: str
    kind: str
    label: str
    service_kit_id: str
    qty: int
    unit_cost_cents: int | None
    hours: None
    sort_order: int


@dataclass
class ApplyResult:
    categories_written: int = 0
    services_written: int = 0
    default_items_written: int = 0
    deactivated_categories: int = 0
    deactivated_services: int = 0


def category_id(code: str) -> str:
    return f"install-cat-{code}"


def service_id(aspire_service_id: int) -> str:
    return f"install-svc-{aspire_service_id}"


def _text(value) -> str:
    return " ".join(str(value).split()) if value is not None else ""


def _is_do_not_use(name: str) -> bool:
    return "DO NOT USE" in name.upper()


# ── extract ───────────────────────────────────────────────────────────────────

def parse_extract(data: dict) -> Catalog:
    """Build categories and services from the extract. Pure; no database."""
    rec = data.get("recommended_sections") or {}
    sections = {s["section_key"]: s for s in rec.get("sections") or []}
    type_to_section = {int(k): v for k, v in (rec.get("service_type_to_section") or {}).items()}
    if not sections or not type_to_section:
        raise ValueError("extract has no recommended_sections")
    missing = [key for key in SEEDED_SECTIONS if key not in sections]
    if missing:
        raise ValueError(f"extract has no section(s): {', '.join(missing)}")

    out = Catalog(extracted_at=str(data.get("extracted_at") or ""))
    for order, key in enumerate(SEEDED_SECTIONS, start=1):
        label = _text(sections[key]["label"])
        if not label or len(label) > _CATEGORY_NAME_MAX:
            raise ValueError(f"section {key}: bad label {label!r}")
        out.categories.append(Category(
            id=category_id(key), code=key, name=label, sort_order=order * 10,
            is_optional=False, aspire_service_group_name=None,
            item_class_codes=ITEM_CLASS_CODES.get(key),
        ))

    optional = (data.get("answers") or {}).get("q3_optional") or {}
    raw_names = optional.get("optional_services_raw_names") or []
    if raw_names != [OPTIONAL_NAME]:
        raise ValueError(f"extract q3: expected optional group name {OPTIONAL_NAME!r}, got {raw_names!r}")
    out.categories.append(Category(
        id=category_id(OPTIONAL_CODE), code=OPTIONAL_CODE, name=OPTIONAL_NAME,
        sort_order=(len(SEEDED_SECTIONS) + 1) * 10, is_optional=True,
        aspire_service_group_name=OPTIONAL_NAME, item_class_codes=None,
    ))

    seen: set[int] = set()
    by_category: dict[str, list[dict]] = {}
    for svc in data.get("services") or []:
        sid = int(svc["service_id"])
        name = str(svc["name"])
        if sid in seen:
            raise ValueError(f"duplicate aspire service id {sid}")
        seen.add(sid)
        section = type_to_section.get(int(svc["service_type_id"]))
        if section is None:
            raise ValueError(f"service {sid} {name!r}: service type {svc['service_type_id']} has no section")
        if not svc.get("active"):
            out.skipped.append(Skipped(sid, name, "inactive_in_aspire"))
            continue
        if _is_do_not_use(name):
            out.skipped.append(Skipped(sid, name, "do_not_use_still_active_in_aspire"))
            continue
        if section not in SEEDED_SECTIONS:
            out.skipped.append(Skipped(sid, name, f"section_not_seeded:{section}"))
            continue
        if len(name) > _NAME_MAX:
            raise ValueError(f"service {sid}: name longer than {_NAME_MAX}")
        by_category.setdefault(section, []).append(svc)

    for key in SEEDED_SECTIONS:
        rows = sorted(
            by_category.get(key, []),
            key=lambda s: (-int(s.get("sample_line_count") or 0), int(s["service_id"])),
        )
        for order, svc in enumerate(rows, start=1):
            display = _text(svc.get("display_name")) or _text(svc["name"])
            out.services.append(Service(
                id=service_id(int(svc["service_id"])),
                category_id=category_id(key),
                name=str(svc["name"]),
                display_name=display,
                sort_order=order * 10,
                aspire_service_id=int(svc["service_id"]),
                sample_line_count=int(svc.get("sample_line_count") or 0),
            ))

    for sid in MAIN_INSTALL_SERVICES:
        if sid not in {s.aspire_service_id for s in out.services}:
            raise ValueError(f"main install service {sid} {MAIN_INSTALL_SERVICES[sid]!r} is not seeded")
    return out


def read_extract(path: Path = DEFAULT_EXTRACT) -> Catalog:
    return parse_extract(json.loads(path.read_text(encoding="utf-8")))


# ── default items ─────────────────────────────────────────────────────────────

def resolve_default_items(conn, catalog: Catalog, kits: dict[int, str] | None = None) -> list[DefaultItem]:
    """Labor-line defaults from DEFAULT_LABOR_KITS; zero rows for every other service."""
    kits = DEFAULT_LABOR_KITS if kits is None else kits
    extra = sorted(set(kits) - set(MAIN_INSTALL_SERVICES))
    if extra:
        raise ValueError(f"default labor kits for non-main services: {extra}")
    if not kits:
        return []
    ids = sorted(set(kits.values()))
    with conn.cursor() as cur:
        cur.execute(
            f"SELECT id, description, unit_cost_cents, kit_type, active FROM service_kits "
            f"WHERE id IN ({', '.join(['%s'] * len(ids))})",
            ids,
        )
        rows = {r["id"]: r for r in cur.fetchall()}
    items = []
    for aspire_id, kit_id in sorted(kits.items()):
        kit = rows.get(kit_id)
        if kit is None or kit["kit_type"] != "install_quantity" or not kit["active"]:
            raise ValueError(f"service {aspire_id}: kit {kit_id} is missing, inactive or not an install kit")
        items.append(DefaultItem(
            id=f"install-sdi-{aspire_id}-1", service_id=service_id(aspire_id), kind="labor",
            label=kit["description"], service_kit_id=kit_id, qty=1,
            unit_cost_cents=int(kit["unit_cost_cents"]), hours=None, sort_order=0,
        ))
    return items


# ── database ──────────────────────────────────────────────────────────────────

# VALUES() rather than a row alias: same choice as load_item_classes.py.
_CATEGORY_SQL = """
INSERT INTO service_categories
    (id, code, name, estimate_type, sort_order, is_optional,
     aspire_service_group_name, item_class_codes, active)
VALUES (%s, %s, %s, %s, %s, %s, %s, CAST(%s AS JSON), 1)
ON DUPLICATE KEY UPDATE
    code = VALUES(code),
    name = VALUES(name),
    estimate_type = VALUES(estimate_type),
    sort_order = VALUES(sort_order),
    is_optional = VALUES(is_optional),
    aspire_service_group_name = VALUES(aspire_service_group_name),
    item_class_codes = VALUES(item_class_codes),
    active = 1
"""

_SERVICE_SQL = """
INSERT INTO services
    (id, service_category_id, name, display_name, sort_order,
     default_occurrences, aspire_service_id, active)
VALUES (%s, %s, %s, %s, %s, NULL, %s, 1)
ON DUPLICATE KEY UPDATE
    service_category_id = VALUES(service_category_id),
    name = VALUES(name),
    display_name = VALUES(display_name),
    sort_order = VALUES(sort_order),
    aspire_service_id = VALUES(aspire_service_id),
    active = 1
"""

_DEFAULT_ITEM_SQL = """
INSERT INTO service_default_items
    (id, service_id, kind, label, inventory_id, service_kit_id, qty,
     unit_cost_cents, hours, sort_order)
VALUES (%s, %s, %s, %s, NULL, %s, %s, %s, %s, %s)
ON DUPLICATE KEY UPDATE
    service_id = VALUES(service_id),
    kind = VALUES(kind),
    label = VALUES(label),
    service_kit_id = VALUES(service_kit_id),
    qty = VALUES(qty),
    unit_cost_cents = VALUES(unit_cost_cents),
    hours = VALUES(hours),
    sort_order = VALUES(sort_order)
"""


def _marks(values: list) -> str:
    return ", ".join(["%s"] * len(values))


def apply_catalog(conn, catalog: Catalog, items: list[DefaultItem]) -> ApplyResult:
    """Make the install catalog match the extract. Runs in the caller's transaction.

    Counts are rows MySQL reports changed, so a second run reports zeros.
    """
    if not catalog.categories or not catalog.services:
        raise ValueError("refusing to load an empty service catalog")
    result = ApplyResult()
    cat_ids = [c.id for c in catalog.categories]
    svc_ids = [s.id for s in catalog.services]
    with conn.cursor() as cur:
        for c in catalog.categories:
            result.categories_written += cur.execute(_CATEGORY_SQL, (
                c.id, c.code, c.name, ESTIMATE_TYPE, c.sort_order, int(c.is_optional),
                c.aspire_service_group_name,
                None if c.item_class_codes is None else json.dumps(c.item_class_codes),
            ))
        for s in catalog.services:
            result.services_written += cur.execute(_SERVICE_SQL, (
                s.id, s.category_id, s.name, s.display_name, s.sort_order, s.aspire_service_id,
            ))
        # Template rows for seeded services that are no longer defaults.
        keep = [i.id for i in items] or [""]
        cur.execute(
            f"DELETE d FROM service_default_items d JOIN services s ON s.id = d.service_id "
            f"JOIN service_categories c ON c.id = s.service_category_id "
            f"WHERE c.estimate_type = %s AND d.id LIKE 'install-sdi-%%' AND d.id NOT IN ({_marks(keep)})",
            [ESTIMATE_TYPE, *keep],
        )
        for i in items:
            result.default_items_written += cur.execute(_DEFAULT_ITEM_SQL, (
                i.id, i.service_id, i.kind, i.label, i.service_kit_id, i.qty,
                i.unit_cost_cents, i.hours, i.sort_order,
            ))
        result.deactivated_services = cur.execute(
            f"UPDATE services s JOIN service_categories c ON c.id = s.service_category_id "
            f"SET s.active = 0 WHERE c.estimate_type = %s AND s.active = 1 "
            f"AND s.id LIKE 'install-svc-%%' AND s.id NOT IN ({_marks(svc_ids)})",
            [ESTIMATE_TYPE, *svc_ids],
        )
        result.deactivated_categories = cur.execute(
            f"UPDATE service_categories SET active = 0 WHERE estimate_type = %s AND active = 1 "
            f"AND id LIKE 'install-cat-%%' AND id NOT IN ({_marks(cat_ids)})",
            [ESTIMATE_TYPE, *cat_ids],
        )
    return result


def format_summary(catalog: Catalog, items: list[DefaultItem], *, dry_run: bool,
                   apply: ApplyResult | None = None) -> str:
    lines = [
        f"install service catalog load ({'dry-run' if dry_run else 'write'})",
        f"  extract: {DEFAULT_EXTRACT.relative_to(REPO_ROOT)} (extracted_at {catalog.extracted_at})",
        f"  categories: {len(catalog.categories)}",
    ]
    per_cat: dict[str, int] = {}
    for s in catalog.services:
        per_cat[s.category_id] = per_cat.get(s.category_id, 0) + 1
    for c in catalog.categories:
        flags = " optional" if c.is_optional else ""
        lines.append(f"    {c.code}: {c.name} — {per_cat.get(c.id, 0)} services{flags}")
    lines.append(f"  services: {len(catalog.services)} (ordered by SAMPLE line count, not population)")
    lines.append(f"  default items: {len(items)}")
    lines += [f"    {i.service_id}: {i.kind} {i.label} ({i.service_kit_id})" for i in items]
    no_default = [MAIN_INSTALL_SERVICES[k] for k in MAIN_INSTALL_SERVICES if service_id(k) not in {i.service_id for i in items}]
    lines.append(f"  main services with zero default items (no matching labor kit): {len(no_default)}")
    lines += [f"    {name}" for name in no_default]
    lines.append(f"  skipped services: {len(catalog.skipped)}")
    lines += [f"    {s.aspire_service_id} {s.name}: {s.reason}" for s in catalog.skipped]
    if apply is not None:
        lines += [
            f"  categories changed: {apply.categories_written}",
            f"  services changed: {apply.services_written}",
            f"  default items changed: {apply.default_items_written}",
            f"  categories deactivated: {apply.deactivated_categories}",
            f"  services deactivated: {apply.deactivated_services}",
        ]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("extract", type=Path, nargs="?", default=DEFAULT_EXTRACT)
    parser.add_argument("--dry-run", action="store_true", help="parse and print counts; do not write the database")
    args = parser.parse_args(argv)

    catalog = read_extract(args.extract)
    if args.dry_run:
        # Kits are validated against service_kits at write time.
        print(format_summary(catalog, [], dry_run=True))
        print(f"  configured default labor kits (checked on write): {len(DEFAULT_LABOR_KITS)}")
        return 0

    from scripts.migrate import connect

    conn = connect()
    conn.autocommit(False)
    try:
        items = resolve_default_items(conn, catalog)
        result = apply_catalog(conn, catalog, items)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    print(format_summary(catalog, items, dry_run=False, apply=result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
