"""Install estimate sections come from the service catalog (Handoff 55 §3).

Creating an INSTALL estimate creates one section per active, non-optional
install service_categories row, in sort_order, named after the category,
with service_category_id set (plan_install_create_sections). A section sent
with the create request that names a standard category (by
serviceCategoryId, or with no id by its plain name under
normalize_section_name) is merged into that category's section (its
squareFeet, services and name). Every other sent section is kept as sent,
after the standard ones.

create_estimate writes the estimate row and these sections (with their
services and components) inside one db.transaction(): a failure partway
rolls everything back.

No extra section rules are enforced here: sections can still be added,
renamed or re-categorized afterwards as before. Maintenance estimates are
untouched. If no active install category exists (catalog not loaded yet),
the sections are kept as sent, as before 073.

The name rule (trim, collapse whitespace, case-insensitive, nothing else) is
defined once here as normalize_section_name; the backfill script
(scripts/backfill_section_categories.py) imports it.
"""
from __future__ import annotations

import re
from typing import Any, Awaitable, Callable

QueryFn = Callable[..., Awaitable[list]]

_WS = re.compile(r"\s+")


def normalize_section_name(name: Any) -> str:
    """Trim, collapse every whitespace run to one space, lowercase. None -> ''."""
    return "" if name is None else _WS.sub(" ", str(name)).strip().lower()


def same_section_name(a: Any, b: Any) -> bool:
    return normalize_section_name(a) == normalize_section_name(b)


async def active_install_categories(query_fn: QueryFn) -> list[dict]:
    """Active install service_categories in sort_order (standard and optional)."""
    rows = await query_fn(
        "SELECT id, name, sort_order, is_optional, active FROM service_categories "
        "WHERE estimate_type = %s ORDER BY sort_order",
        ["install"],
    )
    rows = [r for r in rows if r.get("active") is None or r["active"]]  # NOT NULL DEFAULT 1 in 073
    return sorted(rows, key=lambda r: (r.get("sort_order") or 0, r["id"]))


async def plan_install_create_sections(sections: Any, query_fn: QueryFn) -> Any:
    """The sections an install estimate is created with (see module doc)."""
    categories = await active_install_categories(query_fn)
    standard = [c for c in categories if not c.get("is_optional")]
    if not standard:
        return sections  # catalog not loaded: pre-073 behaviour
    chosen: dict[str, dict] = {}
    extra: list[dict] = []
    for section in [s for s in sections or [] if isinstance(s, dict)]:
        cat_id = section.get("serviceCategoryId")
        if cat_id is None:
            match = [c for c in standard if same_section_name(c["name"], section.get("name"))]
            cat_id = match[0]["id"] if match else None
        category = next((c for c in standard if c["id"] == cat_id), None)
        if category is None or cat_id in chosen:  # not a standard category (or a repeat): kept as sent
            named = next((c["name"] for c in categories if c["id"] == section.get("serviceCategoryId")), None)
            extra.append({**section, "name": section.get("name") or named} if named else section)
            continue
        by_id = section.get("serviceCategoryId") is not None and section.get("name")
        chosen[cat_id] = {**section, "serviceCategoryId": cat_id, "name": section["name"] if by_id else category["name"]}
    out = [chosen.get(c["id"]) or {"name": c["name"], "serviceCategoryId": c["id"], "services": []}
           for c in standard]
    return [{**s, "sortOrder": i} for i, s in enumerate(out + extra)]
