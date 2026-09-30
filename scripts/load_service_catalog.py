#!/usr/bin/env python3
"""Load the install service catalog (Handoff 55 §1) from the checked-in Aspire extract.

Source: scripts/data/aspire_install_service_catalog.json (Handoff 55 §0). This
loader never talks to Aspire. Decisions the extract cannot make (which
sections to seed and in what order, the Optional Services category, the
section -> item-class prefilter, the required main services) live in
scripts/data/install_service_catalog_config.json. It writes two tables
created by migration 073:

    service_categories     level 1 (estimate_type = 'install' rows only)
    services               level 2, one row per Aspire Service (aspire_service_id, UNIQUE)

It never writes service_default_items (install seeds no default items: no
install service_kits row is a per-service labor kit; the table and the API's
defaultItems field stay for later), service_kit_links (D1: install has no kit
layer), service_kits, materials, material_prices, item_classes or
item_class_groups.

Rules:
    - Categories come from the extract's recommended_sections: each Aspire
      ServiceType maps to exactly one section. Section order is the extract's
      order; Aspire carries no usable SortOrder (extract caveat).
    - 'design' is not seeded. The extract says whether Design is a level-1
      install section "is a product decision this extract cannot make", and
      flags two of its services as mis-filed. Its services are skipped and
      listed. Add it to the config's seeded_sections once decided.
    - 'Sleeving' is a service under Irrigation (extract answer q1), not a
      section, so there is no Sleeving category.
    - 'Optional Services' is not a ServiceType. It is seeded as one extra
      install category with is_optional = 1 and aspire_service_group_name =
      'Optional Services' (the raw group name the extract verified carries
      OptionalServiceGroup = true, answer q3). It owns no services: in Aspire
      its lines come from the ordinary install catalog.
    - DO NOT USE: a service whose Aspire name contains "DO NOT USE" (any
      case, any run of whitespace between the words) is never seeded,
      whatever its active flag. This check runs first, so all nine such
      services in the extract are skipped as do_not_use: four the extract
      still flags active (18877, 18881, 29824, 30271: zero sampled lines,
      answer q2) and five already inactive (18874, 18884, 18887, 29823,
      29825). The match is on name, not display_name (Aspire strips the
      marker from display names). Decided by Carlos 2026-09-30.
    - Any other service the extract marks inactive is skipped.
    - aspire_service_group_name is set only where the extract verified the
      exact group name (Optional Services). default_occurrences stays NULL
      (maintenance's column).
    - item_class_codes is the §2 soft prefilter from the Handoff 55
      section -> item-class table (item_classes.code values, in the config).
      Sections the table does not list are NULL = unfiltered.
    - name is the Aspire name verbatim; display_name is Aspire's display name
      (else the name), whitespace-collapsed, with a leading "IN: " removed.
    - Ids are deterministic (install-cat-<code>, install-svc-<aspire id>) and
      every write is an upsert, so a second run changes nothing. Services are
      matched on aspire_service_id (UNIQUE, 073): a services row that already
      carries the Aspire id under another id is updated in place, never
      duplicated (a non-install row with that id fails the load). A category
      or service the extract no longer produces is set active = 0, never
      deleted (estimate lines reference it).

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
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

DEFAULT_EXTRACT = REPO_ROOT / "scripts" / "data" / "aspire_install_service_catalog.json"

ESTIMATE_TYPE = "install"

CONFIG_PATH = REPO_ROOT / "scripts" / "data" / "install_service_catalog_config.json"


def load_config(path: Path = CONFIG_PATH) -> dict:
    """The hand-maintained loader config, validated. Keys starting with '_'
    are notes."""
    raw = json.loads(path.read_text(encoding="utf-8"))
    order = raw["seeded_sections"]["order"]
    if not order or not all(isinstance(k, str) and k for k in order) or len(set(order)) != len(order):
        raise ValueError(f"{path.name}: seeded_sections.order must be unique non-empty strings")
    optional = raw["optional_section"]
    codes = {k: v for k, v in raw["item_class_codes"]["by_section"].items() if not k.startswith("_")}
    for key, value in codes.items():
        if key not in order or not value or not all(isinstance(c, int) for c in value):
            raise ValueError(f"{path.name}: item_class_codes.{key} must be a seeded section with integer codes")
    required = {int(k): str(v) for k, v in raw["required_services"]["by_aspire_id"].items()
                if not k.startswith("_")}
    return {
        "seeded_sections": tuple(order),
        "optional_code": str(optional["code"]),
        "optional_name": str(optional["name"]),
        "item_class_codes": {k: list(v) for k, v in codes.items()},
        "required_services": required,
    }


_CONFIG = load_config()
# Sections seeded from the extract, in display order ('design' is left out on
# purpose; see the config note).
SEEDED_SECTIONS: tuple[str, ...] = _CONFIG["seeded_sections"]
OPTIONAL_CODE: str = _CONFIG["optional_code"]
OPTIONAL_NAME: str = _CONFIG["optional_name"]
# section key -> item_classes.code values. Missing section = NULL = unfiltered.
ITEM_CLASS_CODES: dict[str, list[int]] = _CONFIG["item_class_codes"]
# The five main install services; the load fails if one is not seeded.
MAIN_INSTALL_SERVICES: dict[int, str] = _CONFIG["required_services"]

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


@dataclass
class ApplyResult:
    categories_written: int = 0
    services_written: int = 0
    services_adopted: int = 0
    deactivated_categories: int = 0
    deactivated_services: int = 0


def category_id(code: str) -> str:
    return f"install-cat-{code}"


def service_id(aspire_service_id: int) -> str:
    return f"install-svc-{aspire_service_id}"


def _text(value) -> str:
    return " ".join(str(value).split()) if value is not None else ""


_IN_PREFIX_RE = re.compile(r"^IN:\s+")


def display_name(svc: dict) -> str:
    """Aspire's display name (else the name), whitespace-collapsed, without a
    leading "IN: " (the install-service marker; name keeps it verbatim)."""
    text = _text(svc.get("display_name")) or _text(svc["name"])
    return _IN_PREFIX_RE.sub("", text) or text


# Handoff 55: never seed a service named "DO NOT USE", active or not.
DO_NOT_USE_RE = re.compile(r"\bDO\s+NOT\s+USE\b", re.IGNORECASE)


def _is_do_not_use(name: str) -> bool:
    return DO_NOT_USE_RE.search(name or "") is not None


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
        if _is_do_not_use(name):  # before the active check: excluded whatever the flag says
            out.skipped.append(Skipped(sid, name, "do_not_use"))
            continue
        if not svc.get("active"):
            out.skipped.append(Skipped(sid, name, "inactive_in_aspire"))
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
            display = display_name(svc)
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

def _marks(values: list) -> str:
    return ", ".join(["%s"] * len(values))


def adopt_existing_service_ids(cur, catalog: Catalog) -> tuple[Catalog, int]:
    """Match services on aspire_service_id (UNIQUE, 073). A row that already
    carries a seeded Aspire id under a different id (created before the
    deterministic ids, or by hand) keeps its id and is updated in place, so
    the seed never collides with or duplicates it. A row with that Aspire id
    under a non-install category fails the load. Returns the catalog with
    those ids swapped in and how many were adopted."""
    from dataclasses import replace

    aspire_ids = [s.aspire_service_id for s in catalog.services]
    cur.execute(
        f"SELECT s.id, s.aspire_service_id, c.estimate_type FROM services s "
        f"JOIN service_categories c ON c.id = s.service_category_id "
        f"WHERE s.aspire_service_id IN ({_marks(aspire_ids)})",
        aspire_ids,
    )
    existing = {int(r["aspire_service_id"]): r for r in cur.fetchall()}
    services, adopted = [], 0
    for svc in catalog.services:
        row = existing.get(svc.aspire_service_id)
        if row is not None and row["id"] != svc.id:
            if row["estimate_type"] != ESTIMATE_TYPE:
                raise ValueError(
                    f"aspire service {svc.aspire_service_id} already belongs to {row['estimate_type']} "
                    f"service {row['id']}"
                )
            svc = replace(svc, id=row["id"])
            adopted += 1
        services.append(svc)
    return replace(catalog, services=services), adopted


def apply_catalog(conn, catalog: Catalog) -> ApplyResult:
    """Make the install catalog match the extract. Runs in the caller's transaction.

    Counts are rows MySQL reports changed, so a second run reports zeros.
    """
    if not catalog.categories or not catalog.services:
        raise ValueError("refusing to load an empty service catalog")
    result = ApplyResult()
    cat_ids = [c.id for c in catalog.categories]
    with conn.cursor() as cur:
        catalog, result.services_adopted = adopt_existing_service_ids(cur, catalog)
        svc_ids = [s.id for s in catalog.services]
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


def format_summary(catalog: Catalog, *, dry_run: bool, apply: ApplyResult | None = None) -> str:
    lines = [
        f"install service catalog load ({'dry-run' if dry_run else 'write'})",
        f"  extract: {DEFAULT_EXTRACT.relative_to(REPO_ROOT)} (extracted_at {catalog.extracted_at})",
        f"  config: {CONFIG_PATH.relative_to(REPO_ROOT)}",
        f"  categories: {len(catalog.categories)}",
    ]
    per_cat: dict[str, int] = {}
    for s in catalog.services:
        per_cat[s.category_id] = per_cat.get(s.category_id, 0) + 1
    for c in catalog.categories:
        flags = " optional" if c.is_optional else ""
        lines.append(f"    {c.code}: {c.name} — {per_cat.get(c.id, 0)} services{flags}")
    lines.append(f"  services: {len(catalog.services)} (ordered by SAMPLE line count, not population)")
    lines.append("  default items: none (install seeds no service_default_items)")
    lines.append(f"  skipped services: {len(catalog.skipped)}")
    lines += [f"    {s.aspire_service_id} {s.name}: {s.reason}" for s in catalog.skipped]
    if apply is not None:
        lines += [
            f"  categories changed: {apply.categories_written}",
            f"  services changed: {apply.services_written}",
            f"  services matched on aspire_service_id under an existing id: {apply.services_adopted}",
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
        print(format_summary(catalog, dry_run=True))
        return 0

    from scripts.migrate import connect

    conn = connect()
    conn.autocommit(False)
    try:
        result = apply_catalog(conn, catalog)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    print(format_summary(catalog, dry_run=False, apply=result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
