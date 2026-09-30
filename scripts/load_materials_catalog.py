#!/usr/bin/env python3
"""Load the materials item master and cost history from an Aspire/Acumatica workbook.

Reads the Stock Items sheet. The default workbook is the stock item list
committed at scripts/data/acumatica_stock_items.xlsx (one "STOCK ITEMS"
sheet). The earlier Aspire export (Stock Items, NONStock Items and STENS
sheets) still loads when its path is passed. Writes ``materials`` (item master, no cost) and
cost history on ``material_prices``. The loader records history itself (070
has no triggers): inside the load transaction it locks each item's current
price row with ``SELECT ... FOR UPDATE``. A changed cost closes that row
(``is_current = 0``, ``effective_to`` = the later of its ``effective_from``
and the new ``effective_from``) and inserts the new current row. An
unchanged cost writes nothing, so re-running the same workbook adds no
price rows.

Usage (from repo root):
    venv/bin/python scripts/load_materials_catalog.py --dry-run
    venv/bin/python scripts/load_materials_catalog.py
    venv/bin/python scripts/load_materials_catalog.py workbook.xlsx --dry-run
    venv/bin/python scripts/load_materials_catalog.py workbook.xlsx --rejects /tmp/rejects.csv
    venv/bin/python scripts/load_materials_catalog.py workbook.xlsx --dry-run --include-nonstock

Modes:
    --stock-only (default)
        Load the Stock Items sheet only. The NONStock Items sheet is not
        required. When it is present its row count is reported; it is never
        loaded and never used to fill blanks on stock rows. In this mode
        ``inventory_id`` must be exactly 10 digits. Anything else (for
        example the placeholder ``101`` on the earlier export's herbicide
        rows, or a 9-digit id) is written to the rejects file as
        ``invalid_inventory_id``. This runs before the duplicate check, so a
        placeholder id shared by many products is reported as invalid, not
        as a conflict.
    --include-nonstock
        The earlier behavior, unchanged: read both sheets, Stock Items wins
        over NONStock Items for the same id, and short ids are stored as
        given. Both sheets are required.

Unit warnings: a loaded row whose Unit Conversion Factor and UOM Conversion
disagree (the factor stored is Unit Conversion Factor), or whose Preferred
Vendor Purchase UOM differs from Purchase UOM, is loaded as given and listed
under ``warnings`` in the output.

Env vars (same as scripts/migrate.py), used only when not --dry-run:
    MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DB
    MYSQL_SOCKET_PATH   — Cloud SQL Auth Proxy socket; overrides host/port

``inventory_id`` is stored exactly as the sheet gives it, after trimming
whitespace. It is never zero-padded. With ``--include-nonstock`` it does not
have to be 10 digits; in the default mode it does. An empty id is skipped. An id longer than 64 characters is skipped. An id
that maps to more than one distinct product is skipped (every row for that
id). A Stock Items row replacing a different NONStock Items row is not a
conflict: the stock row is the one stored.

Vendor columns ("Preferred Vendor - Only for purchase items"): with two
columns the first is the vendor name and the second the vendor id (the
earlier export). With one column it is the vendor id (HERILAND26), which is
what the stock item list carries.

A third sheet, "Template Stock Items STENS", is never loaded. Rows on it
that carry an inventory id are counted as skipped.
"""
from __future__ import annotations

import argparse
import csv
import re
import sys
import zipfile
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts.materials_store import ApplyResult, MaterialItem, upsert_items  # noqa: E402
from scripts.xlsx import shared_strings, sheet_rows, sheet_targets  # noqa: E402

DEFAULT_WORKBOOK = REPO_ROOT / "scripts" / "data" / "acumatica_stock_items.xlsx"

SOURCE = "aspire_import"
ENTERED_BY = "scripts/load_materials_catalog.py"
INVENTORY_ID_MAX = 64
CONFLICT_REASONS = frozenset({
    "conflicting_duplicate_inventory_id",
    "stock_sheet_conflict",
})
# Default (stock-only) mode only. The Aspire item ids are 10 digits.
VALID_INVENTORY_ID = re.compile(r"[0-9]{10}")
INVALID_ID_REASON = "invalid_inventory_id"

# Schema limits. A value past these is rejected rather than clipped.
_LIMITS = {
    "description": 255,
    "alternate_name": 255,
    "item_class": 128,
    "aspire_category": 128,
    "posting_class": 64,
    "manufacturer": 128,
    "base_uom": 32,
    "sales_uom": 32,
    "purchase_uom": 32,
    "preferred_vendor_id": 64,
    "preferred_vendor_name": 128,
    "vendor_sku": 128,
    "item_status": 32,
    "cost_uom": 32,
}


@dataclass(frozen=True)
class Reject:
    sheet: str
    row_number: int
    inventory_id: str
    reason: str
    description: str
    item_class: str
    aspire_category: str
    uom: str
    vendor: str
    last_cost: str


@dataclass(frozen=True)
class UnitWarning:
    inventory_id: str
    row_number: int
    message: str


@dataclass
class LoadPlan:
    stock_sheet: str
    nonstock_sheet: str | None
    ignored_sheets: list[tuple[str, int]] = field(default_factory=list)
    include_nonstock: bool = False
    # Rows with an inventory id on the ignored (STENS) sheets.
    ignored_ids: int = 0
    # Non-stock sheet rows not considered at all (default mode).
    nonstock_skipped: int = 0
    stock_rows: int = 0
    nonstock_rows: int = 0
    overlap: int = 0
    stock_overrides: int = 0
    items: list[MaterialItem] = field(default_factory=list)
    rejects: list[Reject] = field(default_factory=list)
    warnings: list[UnitWarning] = field(default_factory=list)
    zero_costs: int = 0
    bad_costs: int = 0
    identical_duplicates: int = 0

    @property
    def with_cost(self) -> int:
        return sum(1 for item in self.items if item.unit_cost_cents is not None)

    @property
    def without_cost(self) -> int:
        return len(self.items) - self.with_cost

    def reject_count(self, *reasons: str) -> int:
        return sum(1 for rej in self.rejects if rej.reason in reasons)


# ── workbook ──────────────────────────────────────────────────────────────────

def _norm_header(name: str) -> str:
    return " ".join(name.replace("\n", " ").split()).casefold()


def _header_fields(rows: list[tuple[int, dict[str, str | None]]]) -> tuple[int, dict[str, str]]:
    """Return (header index, column letter → normalized header)."""
    for i, (_number, row) in enumerate(rows):
        headers = {}
        seen: Counter[str] = Counter()
        for col, raw in row.items():
            if not raw or not str(raw).strip():
                continue
            key = _norm_header(str(raw))
            seen[key] += 1
            headers[col] = key if seen[key] == 1 else f"{key} #{seen[key]}"
        if "inventory id" in headers.values():
            return i, headers
    raise ValueError("sheet has no Inventory ID header")


def _records(rows: list[tuple[int, dict[str, str | None]]]) -> list[tuple[int, dict[str, list[str | None]]]]:
    header_at, headers = _header_fields(rows)
    out = []
    for number, row in rows[header_at + 1 :]:
        fields: dict[str, list[str | None]] = defaultdict(list)
        empty = True
        for col, key in headers.items():
            # Collapse the " #2" suffix back onto the base name, in order.
            base = key.split(" #", 1)[0]
            value = row.get(col)
            fields[base].append(value)
            if value not in (None, ""):
                empty = False
        if not empty:
            out.append((number, fields))
    return out


def _sheet_kind(name: str) -> str | None:
    compact = "".join(ch for ch in name.upper() if ch.isalnum())
    if "NONSTOCK" in compact:
        return "nonstock"
    if "STENS" in compact:
        return "ignored"
    if "STOCK" in compact and "ITEM" in compact:
        return "stock"
    return None


_Records = list[tuple[int, dict[str, list[str | None]]]]


def _open_sheets(
    workbook: Path, *, require_nonstock: bool = True,
) -> tuple[tuple[str, _Records], tuple[str, _Records] | None, list[tuple[str, int]], int]:
    """Return (stock, nonstock or None, ignored sheet row counts, ignored rows with an id)."""
    with zipfile.ZipFile(workbook) as z:
        shared = shared_strings(z)
        targets = sheet_targets(z)
        chosen: dict[str, tuple[str, list]] = {}
        ignored: list[tuple[str, int]] = []
        ignored_ids = 0
        for name, target in targets:
            kind = _sheet_kind(name)
            if kind is None:
                continue
            rows = sheet_rows(z, target, shared)
            if kind == "ignored":
                try:
                    records = _records(rows)
                except ValueError:
                    records = []
                ignored.append((name, len(records)))
                ignored_ids += sum(1 for _n, fields in records if _first(fields.get("inventory id")))
                continue
            if kind in chosen:
                raise ValueError(f"more than one {kind} sheet ({chosen[kind][0]!r} and {name!r})")
            chosen[kind] = (name, _records(rows))
    if "stock" not in chosen or (require_nonstock and "nonstock" not in chosen):
        found = ", ".join(name for name, _ in targets)
        need = "a Stock Items sheet and a NONStock Items sheet" if require_nonstock else "a Stock Items sheet"
        raise ValueError(f"workbook needs {need}; found: {found}")
    return chosen["stock"], chosen.get("nonstock"), ignored, ignored_ids


# ── field mapping ─────────────────────────────────────────────────────────────

def _first(values: list[str | None] | None) -> str | None:
    if not values:
        return None
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return None


def _text(values: list[str | None] | None, limit: int) -> tuple[str | None, bool]:
    text = _first(values)
    if text is None:
        return None, False
    return text, len(text) > limit


def _flag(values: list[str | None] | None, default: int) -> int:
    text = _first(values)
    if text is None:
        return default
    token = text.strip().lower()
    if token in {"1", "true", "yes", "y", "active"}:
        return 1
    if token in {"0", "false", "no", "n", "inactive"}:
        return 0
    return default


def _decimal(values: list[str | None] | None) -> Decimal | None:
    text = _first(values)
    if text is None:
        return None
    try:
        return Decimal(text)
    except InvalidOperation:
        return None


def _factor(fields: dict[str, list[str | None]]) -> Decimal | None:
    """Unit Conversion Factor, else UOM Conversion."""
    number = _decimal(fields.get("unit conversion factor"))
    if number is None:
        number = _decimal(fields.get("uom conversion"))
    if number is None:
        return None
    return number.quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)


def _unit_warnings(inventory_id: str, row_number: int, fields: dict[str, list[str | None]]) -> list[UnitWarning]:
    """Unit disagreements on a loaded row. The row is loaded as given."""
    warnings = []
    factor = _decimal(fields.get("unit conversion factor"))
    conversion = _decimal(fields.get("uom conversion"))
    if factor is not None and conversion is not None and factor != conversion:
        warnings.append(UnitWarning(
            inventory_id, row_number,
            f"Unit Conversion Factor {_first(fields.get('unit conversion factor'))} "
            f"!= UOM Conversion {_first(fields.get('uom conversion'))} (stored the factor)",
        ))
    purchase = _first(fields.get("purchase uom"))
    vendor_purchase = _first(fields.get("preferred vendor purchase uom"))
    if purchase and vendor_purchase and purchase.strip().upper() != vendor_purchase.strip().upper():
        warnings.append(UnitWarning(
            inventory_id, row_number,
            f"Preferred Vendor Purchase UOM {vendor_purchase} != Purchase UOM {purchase}",
        ))
    return warnings


def _cost_cents(fields: dict[str, list[str | None]]) -> tuple[int | None, str]:
    """Return (cents, status) where status is ok, blank, zero, or bad."""
    text = _first(fields.get("last cost"))
    if text is None:
        return None, "blank"
    try:
        amount = Decimal(text)
    except InvalidOperation:
        return None, "bad"
    cents = int((amount * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    if cents < 0:
        return None, "bad"
    if cents == 0:
        return None, "zero"
    return cents, "ok"


def _vendor(fields: dict[str, list[str | None]]) -> tuple[str | None, str | None]:
    """(vendor name, vendor id). Two columns: name then id. One column: the id."""
    vendors = fields.get("preferred vendor - only for purchase items") or []
    if len(vendors) > 1:
        return _first(vendors[:1]), _first(vendors[1:2])
    return None, _first(vendors)


def _cost_uom(item_uoms: tuple[str | None, str | None, str | None]) -> str | None:
    purchase, base, sales = item_uoms
    return purchase or base or sales


def _display_cost(raw: str | None) -> str:
    """Sheet cost for the rejects file. Excel floats are shown to the cent."""
    text = (raw or "").strip()
    if not text:
        return ""
    try:
        amount = Decimal(text)
    except InvalidOperation:
        return text
    return format(amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP), "f")


def _sheet_view(fields: dict[str, list[str | None]]) -> dict[str, str]:
    """Sheet text for the rejects file. Item class follows the loader's column choice."""
    classes = [str(v).strip() for v in (fields.get("item class") or []) if v and str(v).strip()]
    item_class = classes[1] if len(classes) > 1 else (classes[0] if classes else "")
    vendor_name, vendor_id = _vendor(fields)
    if vendor_name and vendor_id:
        vendor = f"{vendor_name} ({vendor_id})"
    else:
        vendor = vendor_name or vendor_id or ""
    purchase = _first(fields.get("purchase uom")) or ""
    base = _first(fields.get("base uom")) or ""
    sales = _first(fields.get("sales uom")) or ""
    return {
        "description": _first(fields.get("description")) or "",
        "item_class": item_class,
        "aspire_category": _first(fields.get("aspire catalog category")) or "",
        "uom": purchase or base or sales,
        "vendor": vendor,
        "last_cost": _display_cost(_first(fields.get("last cost"))),
    }


def _reject(sheet: str, row_number: int, fields: dict[str, list[str | None]], inventory_id: str, reason: str) -> Reject:
    view = _sheet_view(fields)
    return Reject(
        sheet=sheet,
        row_number=row_number,
        inventory_id=inventory_id,
        reason=reason,
        description=view["description"],
        item_class=view["item_class"],
        aspire_category=view["aspire_category"],
        uom=view["uom"],
        vendor=view["vendor"],
        last_cost=view["last_cost"],
    )


def _map_row(
    fields: dict[str, list[str | None]], *, row_number: int, is_stock: int, sheet: str,
    strict_ids: bool = False,
) -> tuple[MaterialItem | None, Reject | None, str]:
    inventory_id = (_first(fields.get("inventory id")) or "").strip()
    description = _first(fields.get("description")) or ""
    if not inventory_id:
        return None, _reject(sheet, row_number, fields, "", "missing_inventory_id"), "missing"
    if len(inventory_id) > INVENTORY_ID_MAX:
        return None, _reject(sheet, row_number, fields, inventory_id, "inventory_id_too_long"), "long_id"
    if strict_ids and not VALID_INVENTORY_ID.fullmatch(inventory_id):
        return None, _reject(sheet, row_number, fields, inventory_id, INVALID_ID_REASON), "invalid_id"
    if not description:
        return None, _reject(sheet, row_number, fields, inventory_id, "missing_description"), "missing_desc"

    classes = [v for v in (fields.get("item class") or []) if v and str(v).strip()]
    # The earlier export's stock sheet has two Item Class columns; the second
    # is the current class ("USE THIS ONE" on the review row). Non-stock and
    # the stock item list have one (the list's label column is headed "Item
    # Class Working" and is not read).
    item_class_raw = str(classes[1]).strip() if len(classes) > 1 else (str(classes[0]).strip() if classes else None)
    vendor_name, vendor_id = _vendor(fields)

    texts: dict[str, str | None] = {}
    too_long: list[str] = []
    for key, source, limit in (
        ("description", [description], _LIMITS["description"]),
        ("alternate_name", fields.get("aspire item alternate name"), _LIMITS["alternate_name"]),
        ("item_class", [item_class_raw] if item_class_raw else [], _LIMITS["item_class"]),
        ("aspire_category", fields.get("aspire catalog category"), _LIMITS["aspire_category"]),
        ("posting_class", fields.get("posting class"), _LIMITS["posting_class"]),
        ("manufacturer", fields.get("manufacturer"), _LIMITS["manufacturer"]),
        ("base_uom", fields.get("base uom"), _LIMITS["base_uom"]),
        ("sales_uom", fields.get("sales uom"), _LIMITS["sales_uom"]),
        ("purchase_uom", fields.get("purchase uom"), _LIMITS["purchase_uom"]),
        ("preferred_vendor_id", [vendor_id] if vendor_id else [], _LIMITS["preferred_vendor_id"]),
        ("preferred_vendor_name", [vendor_name] if vendor_name else [], _LIMITS["preferred_vendor_name"]),
        ("vendor_sku", fields.get("item cross reference (vendor sku)"), _LIMITS["vendor_sku"]),
        ("item_status", fields.get("item status"), _LIMITS["item_status"]),
    ):
        value, over = _text(source, limit)
        texts[key] = value
        if over:
            too_long.append(key)
    if too_long:
        return None, _reject(sheet, row_number, fields, inventory_id, "value_too_long:" + ",".join(too_long)), "long"

    cents, cost_status = _cost_cents(fields)
    uom = _cost_uom((texts["purchase_uom"], texts["base_uom"], texts["sales_uom"]))
    if cents is not None and uom is None:
        cents = None
        cost_status = "no_uom"
    item = MaterialItem(
        inventory_id=inventory_id,
        description=texts["description"] or description,
        alternate_name=texts["alternate_name"],
        item_class=texts["item_class"],
        aspire_category=texts["aspire_category"],
        posting_class=texts["posting_class"],
        manufacturer=texts["manufacturer"],
        base_uom=texts["base_uom"],
        sales_uom=texts["sales_uom"],
        purchase_uom=texts["purchase_uom"],
        purchase_to_base_factor=_factor(fields),
        preferred_vendor_id=texts["preferred_vendor_id"],
        preferred_vendor_name=texts["preferred_vendor_name"],
        vendor_sku=texts["vendor_sku"],
        is_stock_item=is_stock,
        available_to_bid=_flag(fields.get("available to bid"), 1),
        item_status=texts["item_status"] or "Active",
        unit_cost_cents=cents,
        cost_uom=uom if cents is not None else None,
    )
    return item, None, cost_status


def _signature(item: MaterialItem) -> tuple:
    return (
        item.description,
        item.item_class,
        item.aspire_category,
        item.unit_cost_cents,
        item.base_uom,
        item.purchase_uom,
        item.preferred_vendor_name,
        item.preferred_vendor_id,
        item.vendor_sku,
    )


# A kept row plus the sheet fields needed if it is later rejected.
_Kept = tuple[MaterialItem, str, int, dict[str, list[str | None]]]


def _collapse(
    sheet: str, rows: list[tuple[int, dict[str, list[str | None]]]], *, is_stock: int,
    strict_ids: bool = False,
) -> tuple[dict[str, _Kept], list[Reject], Counter]:
    """One item per inventory id. An id with more than one distinct product is rejected."""
    grouped: dict[str, list[_Kept]] = defaultdict(list)
    rejects: list[Reject] = []
    notes: Counter = Counter()
    for row_number, fields in rows:
        item, reject, cost_status = _map_row(
            fields, row_number=row_number, is_stock=is_stock, sheet=sheet, strict_ids=strict_ids,
        )
        if reject is not None:
            rejects.append(reject)
            notes[reject.reason.split(":", 1)[0]] += 1
            continue
        assert item is not None
        grouped[item.inventory_id].append((item, cost_status, row_number, fields))

    kept: dict[str, _Kept] = {}
    for inventory_id, pairs in grouped.items():
        first = pairs[0]
        if all(_signature(other[0]) == _signature(first[0]) for other in pairs[1:]):
            kept[inventory_id] = first
            if len(pairs) > 1:
                notes["identical_duplicates_collapsed"] += len(pairs) - 1
            continue
        notes["conflicting_duplicate_inventory_id"] += len(pairs)
        for _item, _status, row_number, fields in pairs:
            rejects.append(_reject(
                sheet, row_number, fields, inventory_id, "conflicting_duplicate_inventory_id",
            ))
    return kept, rejects, notes


def _ids_of(kept: dict[str, _Kept], rejects: list[Reject]) -> set[str]:
    ids = set(kept)
    for rej in rejects:
        if rej.inventory_id:
            ids.add(rej.inventory_id)
    return ids


def _build_stock_only(workbook: Path) -> LoadPlan:
    (stock_name, stock_rows), nonstock, ignored, ignored_ids = _open_sheets(
        workbook, require_nonstock=False,
    )
    stock, rejects, notes = _collapse(stock_name, stock_rows, is_stock=1, strict_ids=True)
    items: list[MaterialItem] = []
    statuses: dict[str, str] = {}
    warnings: list[UnitWarning] = []
    for inventory_id, (item, status, row_number, fields) in stock.items():
        items.append(item)
        statuses[inventory_id] = status
        warnings.extend(_unit_warnings(inventory_id, row_number, fields))
    items.sort(key=lambda item: item.inventory_id)
    non_rows = nonstock[1] if nonstock else []
    return LoadPlan(
        stock_sheet=stock_name,
        nonstock_sheet=nonstock[0] if nonstock else None,
        ignored_sheets=ignored,
        include_nonstock=False,
        ignored_ids=ignored_ids,
        nonstock_skipped=len(non_rows),
        stock_rows=len(stock_rows),
        nonstock_rows=len(non_rows),
        items=items,
        rejects=rejects,
        warnings=sorted(warnings, key=lambda w: w.row_number),
        zero_costs=sum(1 for status in statuses.values() if status == "zero"),
        bad_costs=sum(1 for status in statuses.values() if status in {"bad", "no_uom"}),
        identical_duplicates=notes["identical_duplicates_collapsed"],
    )


def build_plan(workbook: Path, *, include_nonstock: bool = False) -> LoadPlan:
    """Plan the load. Stock-only by default; ``include_nonstock`` is the earlier behavior."""
    if not include_nonstock:
        return _build_stock_only(workbook)
    (stock_name, stock_rows), (non_name, non_rows), ignored, ignored_ids = _open_sheets(workbook)
    stock, stock_rejects, stock_notes = _collapse(stock_name, stock_rows, is_stock=1)
    non, non_rejects, non_notes = _collapse(non_name, non_rows, is_stock=0)

    blocked = {
        rej.inventory_id
        for rej in stock_rejects
        if rej.reason == "conflicting_duplicate_inventory_id"
    }
    non_ids = _ids_of(non, non_rejects)
    items: list[MaterialItem] = []
    statuses: dict[str, str] = {}
    warnings: list[UnitWarning] = []
    rejects = list(stock_rejects)
    overrides = 0
    for inventory_id in stock:
        if inventory_id in non_ids:
            overrides += 1
    for inventory_id, (item, status, row_number, fields) in non.items():
        if inventory_id in blocked:
            # The stock sheet already disagrees with itself, so the non-stock
            # row is not a fallback.
            rejects.append(_reject(non_name, row_number, fields, inventory_id, "stock_sheet_conflict"))
            continue
        if inventory_id in stock:
            # Stock wins. A different non-stock row is not a conflict.
            continue
        items.append(item)
        statuses[inventory_id] = status
        warnings.extend(_unit_warnings(inventory_id, row_number, fields))
    for rej in non_rejects:
        # Stock already won this id. Drop the non-stock duplicate rejects.
        if rej.reason == "conflicting_duplicate_inventory_id" and rej.inventory_id in stock:
            continue
        rejects.append(rej)

    for inventory_id, (item, status, row_number, fields) in stock.items():
        items.append(item)
        statuses[inventory_id] = status
        warnings.extend(_unit_warnings(inventory_id, row_number, fields))
    items.sort(key=lambda item: item.inventory_id)
    plan = LoadPlan(
        stock_sheet=stock_name,
        nonstock_sheet=non_name,
        ignored_sheets=ignored,
        include_nonstock=True,
        ignored_ids=ignored_ids,
        stock_rows=len(stock_rows),
        nonstock_rows=len(non_rows),
        overlap=len(_ids_of(stock, stock_rejects) & non_ids),
        stock_overrides=overrides,
        items=items,
        rejects=rejects,
        warnings=warnings,
        zero_costs=sum(1 for status in statuses.values() if status == "zero"),
        bad_costs=sum(1 for status in statuses.values() if status in {"bad", "no_uom"}),
        identical_duplicates=(
            stock_notes["identical_duplicates_collapsed"]
            + non_notes["identical_duplicates_collapsed"]
        ),
    )
    return plan


def format_summary(plan: LoadPlan, *, dry_run: bool, rejects_path: Path, apply: ApplyResult | None = None) -> str:
    reasons = Counter(rej.reason for rej in plan.rejects)
    conflict_rows = [rej for rej in plan.rejects if rej.reason in CONFLICT_REASONS]
    conflict_ids = {rej.inventory_id for rej in conflict_rows}
    mode = "include-nonstock" if plan.include_nonstock else "stock-only"
    lines = [
        f"materials catalog load ({'dry-run' if dry_run else 'write'})",
        f"  mode: {mode}",
        f"  stock sheet: {plan.stock_sheet} rows={plan.stock_rows}",
    ]
    if plan.nonstock_sheet is None:
        lines.append("  nonstock sheet: absent")
    elif plan.include_nonstock:
        lines.append(f"  nonstock sheet: {plan.nonstock_sheet} rows={plan.nonstock_rows}")
    else:
        lines.append(f"  nonstock sheet: {plan.nonstock_sheet} rows={plan.nonstock_rows} (not loaded)")
    for name, count in plan.ignored_sheets:
        lines.append(f"  ignored sheet: {name} rows={count} (not loaded)")
    lines.extend([
        f"  loaded: {len(plan.items)}",
        f"  rejected conflicts: {len(conflict_rows)} rows ({len(conflict_ids)} inventory ids)",
        f"  rejected invalid ids: {plan.reject_count(INVALID_ID_REASON)}",
        f"  skipped STENS: {plan.ignored_ids}",
        f"  skipped non-stock: {plan.nonstock_skipped}",
    ])
    if plan.include_nonstock:
        lines.extend([
            f"  overlap inventory ids: {plan.overlap}",
            f"  stock overrides: {plan.stock_overrides}",
        ])
    lines.extend([
        f"  unique items: {len(plan.items)}",
        f"  stock items: {sum(1 for item in plan.items if item.is_stock_item)}",
        f"  nonstock items: {sum(1 for item in plan.items if not item.is_stock_item)}",
        f"  items with cost: {plan.with_cost}",
        f"  items without cost: {plan.without_cost}",
        f"  zero costs (no price row): {plan.zero_costs}",
        f"  bad costs (item kept, no price row): {plan.bad_costs}",
        f"  identical duplicate rows collapsed: {plan.identical_duplicates}",
        f"  conflict inventory ids: {len(conflict_ids)}",
        f"  conflict rows: {len(conflict_rows)}",
        f"  rejects: {len(plan.rejects)}",
    ])
    for reason, count in sorted(reasons.items()):
        lines.append(f"    {reason}: {count}")
    lines.append(f"  rejects csv: {rejects_path}")
    lines.append(f"  unit warnings (loaded as given): {len(plan.warnings)} rows")
    for warning in plan.warnings:
        lines.append(f"    warning: {warning.inventory_id} (row {warning.row_number}): {warning.message}")
    if apply is not None:
        lines.extend([
            f"  items upserted: {apply.items_upserted}",
            f"  prices inserted: {apply.prices_inserted}",
            f"  prices unchanged: {apply.prices_unchanged}",
            f"  prices archived: {apply.prices_archived}",
        ])
    return "\n".join(lines)


def write_rejects(path: Path, rejects: list[Reject]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    ordered = sorted(rejects, key=lambda rej: (rej.sheet, rej.row_number, rej.inventory_id))
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow([
            "reason", "sheet", "row_number", "inventory_id", "description",
            "item_class", "aspire_category", "uom", "vendor", "last_cost",
        ])
        for rej in ordered:
            writer.writerow([
                rej.reason, rej.sheet, rej.row_number, rej.inventory_id, rej.description,
                rej.item_class, rej.aspire_category, rej.uom, rej.vendor, rej.last_cost,
            ])


def _md_cell(value: str) -> str:
    return value.replace("|", "\\|").replace("\n", " ")


def _id_sort_key(inventory_id: str) -> tuple:
    if inventory_id.isdigit():
        return (0, int(inventory_id), inventory_id)
    return (1, inventory_id)


def format_conflict_brief(plan: LoadPlan) -> str:
    """Markdown a procurement contact can read: one section per conflicting id."""
    groups: dict[str, list[Reject]] = defaultdict(list)
    for rej in plan.rejects:
        if rej.reason in CONFLICT_REASONS:
            groups[rej.inventory_id].append(rej)
    lines = [
        "# Inventory IDs used for more than one product",
        "",
        "These inventory IDs were not loaded. Each one appears on the Aspire item workbook as more than one distinct product, so there is no single item to store.",
        "A Stock Items row that replaces a NONStock Items row is not a conflict and is not listed.",
        "Rows with a blank inventory ID were skipped separately and are not listed.",
        "",
        f"{len(groups)} inventory IDs, {sum(len(rows) for rows in groups.values())} sheet rows.",
        "",
    ]
    for inventory_id in sorted(groups, key=_id_sort_key):
        rows = sorted(groups[inventory_id], key=lambda rej: (rej.sheet, rej.row_number))
        lines.append(f"## {inventory_id}")
        lines.append("")
        lines.append(f"{len(rows)} rows.")
        lines.append("")
        lines.append("| Sheet | Row | Description | Item class | Aspire category | UOM | Vendor | Last cost |")
        lines.append("| --- | --- | --- | --- | --- | --- | --- | --- |")
        for rej in rows:
            lines.append(
                "| "
                + " | ".join(_md_cell(part) for part in (
                    rej.sheet, str(rej.row_number), rej.description, rej.item_class,
                    rej.aspire_category, rej.uom, rej.vendor, rej.last_cost,
                ))
                + " |"
            )
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


# ── database ──────────────────────────────────────────────────────────────────

def apply_plan(conn, plan: LoadPlan, *, today: date | None = None) -> ApplyResult:
    """Write the plan's items through materials_store.upsert_items (caller commits)."""
    return upsert_items(conn, plan.items, source=SOURCE, entered_by=ENTERED_BY, today=today)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "workbook", type=Path, nargs="?", default=DEFAULT_WORKBOOK,
        help=f"Aspire/Acumatica item workbook (.xlsx); default {DEFAULT_WORKBOOK.relative_to(REPO_ROOT)}",
    )
    parser.add_argument("--dry-run", action="store_true", help="parse and print counts; do not write the database")
    parser.add_argument(
        "--rejects",
        type=Path,
        help="CSV of skipped rows (default: <workbook stem>.rejects.csv in the current directory)",
    )
    parser.add_argument(
        "--conflicts",
        type=Path,
        help="Markdown brief of inventory ids that map to more than one product",
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--stock-only",
        dest="include_nonstock",
        action="store_false",
        help="default: load the Stock Items sheet only; the NONStock sheet is optional and never loaded",
    )
    mode.add_argument(
        "--include-nonstock",
        dest="include_nonstock",
        action="store_true",
        help="earlier behavior: load both sheets, stock wins on overlap, no id filter",
    )
    parser.set_defaults(include_nonstock=False)
    args = parser.parse_args(argv)
    rejects_path = args.rejects or Path.cwd() / f"{args.workbook.stem}.rejects.csv"

    plan = build_plan(args.workbook, include_nonstock=args.include_nonstock)
    write_rejects(rejects_path, plan.rejects)
    if args.conflicts is not None:
        args.conflicts.parent.mkdir(parents=True, exist_ok=True)
        args.conflicts.write_text(format_conflict_brief(plan), encoding="utf-8")
    if args.dry_run:
        print(format_summary(plan, dry_run=True, rejects_path=rejects_path))
        return 0

    from scripts.migrate import connect

    conn = connect()
    conn.autocommit(False)
    try:
        result = apply_plan(conn, plan)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    print(format_summary(plan, dry_run=False, rejects_path=rejects_path, apply=result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
