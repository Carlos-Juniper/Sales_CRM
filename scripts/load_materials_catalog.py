#!/usr/bin/env python3
"""Load the materials item master and cost history from an Aspire/Acumatica workbook.

Reads the Stock Items sheet. Writes ``materials`` (item master, no cost) and
cost history on ``material_prices``. The loader records history itself (070
has no triggers): inside the load transaction it locks each item's current
price row with ``SELECT ... FOR UPDATE``. A changed cost closes that row
(``is_current = 0``, ``effective_to`` = the later of its ``effective_from``
and the new ``effective_from``) and inserts the new current row. An
unchanged cost writes nothing, so re-running the same workbook adds no
price rows.

The workbook is not part of this repo. Pass its path.

Usage (from repo root):
    venv/bin/python scripts/load_materials_catalog.py workbook.xlsx --dry-run
    venv/bin/python scripts/load_materials_catalog.py workbook.xlsx
    venv/bin/python scripts/load_materials_catalog.py workbook.xlsx --rejects /tmp/rejects.csv
    venv/bin/python scripts/load_materials_catalog.py workbook.xlsx --dry-run --include-agronomy
    venv/bin/python scripts/load_materials_catalog.py workbook.xlsx --dry-run --include-nonstock

Modes:
    --stock-only (default)
        Load the Stock Items sheet only. The NONStock Items sheet is not
        required. When it is present its row count is reported; it is never
        loaded and never used to fill blanks on stock rows. In this mode:
        - Agronomy is held: a stock row whose item class contains ``-AG-``
          (the ``101-AG-Herbiside`` style class, classes 101-1xx) or whose
          loaded "USE THIS ONE" class starts with ``AGRONOMY`` is not loaded.
          It is written to the rejects file as ``held_agronomy``.
          ``--include-agronomy`` loads those rows.
        - ``inventory_id`` must be exactly 10 digits. Anything else (for
          example the placeholder ``101`` on the herbicide rows, or a 9-digit
          id) is written to the rejects file as ``invalid_inventory_id``. This
          runs before the duplicate check, so a placeholder id shared by many
          products is reported as invalid, not as a conflict.
    --include-nonstock
        The earlier behavior, unchanged: read both sheets, Stock Items wins
        over NONStock Items for the same id, short ids are stored as given,
        and agronomy is not held. Both sheets are required.

Env vars (same as scripts/migrate.py), used only when not --dry-run:
    MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DB
    MYSQL_SOCKET_PATH   — Cloud SQL Auth Proxy socket; overrides host/port

``inventory_id`` is stored exactly as the sheet gives it, after trimming
whitespace. It is never zero-padded. With ``--include-nonstock`` it does not
have to be 10 digits; in the default mode it does. An empty id is skipped. An id longer than 64 characters is skipped. An id
that maps to more than one distinct product is skipped (every row for that
id). A Stock Items row replacing a different NONStock Items row is not a
conflict: the stock row is the one stored.

A third sheet, "Template Stock Items STENS", is never loaded. Rows on it
that carry an inventory id are counted as skipped.
"""
from __future__ import annotations

import argparse
import csv
import re
import sys
import uuid
import zipfile
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts.xlsx import shared_strings, sheet_rows, sheet_targets  # noqa: E402

SOURCE = "aspire_import"
ENTERED_BY = "scripts/load_materials_catalog.py"
BATCH = 400
INVENTORY_ID_MAX = 64
CONFLICT_REASONS = frozenset({
    "conflicting_duplicate_inventory_id",
    "stock_sheet_conflict",
})
# Default (stock-only) mode only. The Aspire item ids are 10 digits.
VALID_INVENTORY_ID = re.compile(r"[0-9]{10}")
INVALID_ID_REASON = "invalid_inventory_id"
HELD_AGRONOMY_REASON = "held_agronomy"

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
    "cost_uom": 32,
}


@dataclass(frozen=True)
class MaterialItem:
    inventory_id: str
    description: str
    alternate_name: str | None
    item_class: str | None
    aspire_category: str | None
    posting_class: str | None
    manufacturer: str | None
    base_uom: str | None
    sales_uom: str | None
    purchase_uom: str | None
    purchase_to_base_factor: Decimal | None
    preferred_vendor_id: str | None
    preferred_vendor_name: str | None
    vendor_sku: str | None
    is_stock_item: int
    available_to_bid: int
    active: int
    unit_cost_cents: int | None
    cost_uom: str | None
    sheet: str


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


@dataclass
class LoadPlan:
    stock_sheet: str
    nonstock_sheet: str | None
    ignored_sheets: list[tuple[str, int]] = field(default_factory=list)
    include_nonstock: bool = False
    include_agronomy: bool = False
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


@dataclass
class ApplyResult:
    items_upserted: int = 0
    prices_inserted: int = 0
    prices_unchanged: int = 0
    prices_archived: int = 0


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
    number = _decimal(fields.get("unit conversion factor"))
    if number is None:
        raw = _first(fields.get("uom conversion"))
        if raw is None:
            return None
        try:
            number = Decimal(raw)
        except InvalidOperation:
            return None
    return number.quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)


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
    vendors = fields.get("preferred vendor - only for purchase items") or []
    vendor_name = _first(vendors[:1]) or ""
    vendor_id = _first(vendors[1:2]) if len(vendors) > 1 else ""
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
    # The stock sheet has two Item Class columns. The second is the current
    # category ("USE THIS ONE" on the review row). Non-stock has one.
    item_class_raw = str(classes[1]).strip() if len(classes) > 1 else (str(classes[0]).strip() if classes else None)
    vendors = fields.get("preferred vendor - only for purchase items") or []
    vendor_name = _first(vendors[:1])
    vendor_id = _first(vendors[1:2]) if len(vendors) > 1 else None

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
    status = _first(fields.get("item status"))
    active = 1 if status is None or status.casefold() == "active" else 0
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
        active=active,
        unit_cost_cents=cents,
        cost_uom=uom if cents is not None else None,
        sheet=sheet,
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


def _is_agronomy(fields: dict[str, list[str | None]], item_class: str | None) -> bool:
    """Agronomy by either Item Class column: ``1xx-AG-...`` or ``AGRONOMY__-...``.

    The loaded class is the second ("USE THIS ONE") column, which carries the
    Aspire category code (``AGRONOMY__-HERBISIDE_``). The ``-AG-`` marker
    (``101-AG-Herbiside``) is on the first column of the same row.
    """
    for value in fields.get("item class") or []:
        if value and "-AG-" in str(value).upper():
            return True
    return bool(item_class) and str(item_class).strip().upper().startswith("AGRONOMY")


def _build_stock_only(workbook: Path, *, include_agronomy: bool) -> LoadPlan:
    (stock_name, stock_rows), nonstock, ignored, ignored_ids = _open_sheets(
        workbook, require_nonstock=False,
    )
    stock, rejects, notes = _collapse(stock_name, stock_rows, is_stock=1, strict_ids=True)
    items: list[MaterialItem] = []
    statuses: dict[str, str] = {}
    for inventory_id, (item, status, row_number, fields) in stock.items():
        if not include_agronomy and _is_agronomy(fields, item.item_class):
            rejects.append(_reject(stock_name, row_number, fields, inventory_id, HELD_AGRONOMY_REASON))
            continue
        items.append(item)
        statuses[inventory_id] = status
    items.sort(key=lambda item: item.inventory_id)
    non_rows = nonstock[1] if nonstock else []
    return LoadPlan(
        stock_sheet=stock_name,
        nonstock_sheet=nonstock[0] if nonstock else None,
        ignored_sheets=ignored,
        include_nonstock=False,
        include_agronomy=include_agronomy,
        ignored_ids=ignored_ids,
        nonstock_skipped=len(non_rows),
        stock_rows=len(stock_rows),
        nonstock_rows=len(non_rows),
        items=items,
        rejects=rejects,
        zero_costs=sum(1 for status in statuses.values() if status == "zero"),
        bad_costs=sum(1 for status in statuses.values() if status in {"bad", "no_uom"}),
        identical_duplicates=notes["identical_duplicates_collapsed"],
    )


def build_plan(
    workbook: Path, *, include_nonstock: bool = False, include_agronomy: bool = False,
) -> LoadPlan:
    """Plan the load. Stock-only by default; ``include_nonstock`` is the earlier behavior."""
    if not include_nonstock:
        return _build_stock_only(workbook, include_agronomy=include_agronomy)
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
    for rej in non_rejects:
        # Stock already won this id. Drop the non-stock duplicate rejects.
        if rej.reason == "conflicting_duplicate_inventory_id" and rej.inventory_id in stock:
            continue
        rejects.append(rej)

    for inventory_id, (item, status, _row_number, _fields) in stock.items():
        items.append(item)
        statuses[inventory_id] = status
    items.sort(key=lambda item: item.inventory_id)
    plan = LoadPlan(
        stock_sheet=stock_name,
        nonstock_sheet=non_name,
        ignored_sheets=ignored,
        include_nonstock=True,
        include_agronomy=True,
        ignored_ids=ignored_ids,
        stock_rows=len(stock_rows),
        nonstock_rows=len(non_rows),
        overlap=len(_ids_of(stock, stock_rejects) & non_ids),
        stock_overrides=overrides,
        items=items,
        rejects=rejects,
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
    if plan.include_nonstock:
        mode = "include-nonstock"
    else:
        mode = "stock-only, " + ("agronomy included" if plan.include_agronomy else "agronomy held")
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
        f"  held agronomy: {plan.reject_count(HELD_AGRONOMY_REASON)}",
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

# MySQL 8.0.19 row aliases (`INSERT ... AS new`) fail on MariaDB 10.11, which
# is the local bootstrap server. VALUES() is deprecated on MySQL 8.4 and still
# executes there. aspire_catalog_item_id is omitted: the workbook's Aspire
# Item Code repeats inventory_id and is not Aspire's numeric CatalogItemID.
_ITEM_SQL = """
INSERT INTO materials (
    inventory_id, description, alternate_name, item_class, aspire_category,
    posting_class, manufacturer, base_uom, sales_uom, purchase_uom,
    purchase_to_base_factor, preferred_vendor_id, preferred_vendor_name,
    vendor_sku, is_stock_item, available_to_bid, active
) VALUES (
    %s, %s, %s, %s, %s,
    %s, %s, %s, %s, %s,
    %s, %s, %s,
    %s, %s, %s, %s
)
ON DUPLICATE KEY UPDATE
    description = VALUES(description),
    alternate_name = VALUES(alternate_name),
    item_class = VALUES(item_class),
    aspire_category = VALUES(aspire_category),
    posting_class = VALUES(posting_class),
    manufacturer = VALUES(manufacturer),
    base_uom = VALUES(base_uom),
    sales_uom = VALUES(sales_uom),
    purchase_uom = VALUES(purchase_uom),
    purchase_to_base_factor = VALUES(purchase_to_base_factor),
    preferred_vendor_id = VALUES(preferred_vendor_id),
    preferred_vendor_name = VALUES(preferred_vendor_name),
    vendor_sku = VALUES(vendor_sku),
    is_stock_item = VALUES(is_stock_item),
    available_to_bid = VALUES(available_to_bid),
    active = VALUES(active)
"""

# material_prices.current_inventory_id is a generated column (070): it is
# never written here. is_current drives it and the one-current unique key.
_CLOSE_SQL = """
UPDATE material_prices
   SET is_current = 0, effective_to = %s
 WHERE id = %s AND is_current = 1
"""

_PRICE_SQL = """
INSERT INTO material_prices (
    id, inventory_id, unit_cost_cents, uom, vendor_id, vendor_name,
    effective_from, is_current, source, entered_by
) VALUES (%s, %s, %s, %s, %s, %s, %s, 1, %s, %s)
"""


def _chunks(rows: list, size: int):
    for start in range(0, len(rows), size):
        yield rows[start : start + size]


def _item_params(item: MaterialItem) -> tuple:
    return (
        item.inventory_id, item.description, item.alternate_name, item.item_class,
        item.aspire_category, item.posting_class, item.manufacturer, item.base_uom,
        item.sales_uom, item.purchase_uom, item.purchase_to_base_factor,
        item.preferred_vendor_id, item.preferred_vendor_name, item.vendor_sku,
        item.is_stock_item, item.available_to_bid, item.active,
    )


def _lock_current_prices(cur, inventory_ids: list[str]) -> dict[str, dict]:
    """Current price row per item, locked FOR UPDATE until the caller commits.

    One query per batch of items; each returned row is locked, so a
    concurrent loader or API write waits instead of racing the close/insert.
    """
    found: dict[str, dict] = {}
    for batch in _chunks(inventory_ids, BATCH):
        marks = ", ".join(["%s"] * len(batch))
        cur.execute(
            f"""SELECT id, inventory_id, unit_cost_cents, effective_from
                  FROM material_prices
                 WHERE is_current = 1 AND inventory_id IN ({marks})
                   FOR UPDATE""",
            batch,
        )
        for row in cur.fetchall():
            found[row["inventory_id"]] = row
    return found


def _close_date(current_from: date | None, new_from: date) -> date:
    """effective_to for the closed row: never before its own effective_from.

    chk_material_prices_range requires effective_to >= effective_from. A row
    that became current later than ``new_from`` (for example a backdated
    re-run) closes on its own start date.
    """
    if current_from is None:
        return new_from
    return max(current_from, new_from)


def apply_plan(conn, plan: LoadPlan, *, today: date | None = None) -> ApplyResult:
    """Upsert items and record cost history on material_prices.

    Runs in the caller's transaction; the caller commits or rolls back, so a
    failed load leaves nothing half-written. For each priced item the
    current row is locked (SELECT ... FOR UPDATE). No current row: insert
    one. Same cost: nothing is written. Different cost: the current row is
    closed (is_current = 0, effective_to = max(its effective_from, today))
    before the new current row is inserted, so the one-current unique key
    on the generated current_inventory_id always holds.
    """
    today = today or date.today()
    result = ApplyResult(items_upserted=len(plan.items))
    with conn.cursor() as cur:
        for batch in _chunks(plan.items, BATCH):
            cur.executemany(_ITEM_SQL, [_item_params(item) for item in batch])

        priced = [item for item in plan.items if item.unit_cost_cents is not None and item.cost_uom]
        for batch in _chunks(priced, BATCH):
            current = _lock_current_prices(cur, [item.inventory_id for item in batch])
            closes: list[tuple] = []
            inserts: list[tuple] = []
            for item in batch:
                existing = current.get(item.inventory_id)
                if existing is not None and int(existing["unit_cost_cents"]) == item.unit_cost_cents:
                    result.prices_unchanged += 1
                    continue
                if existing is not None:
                    closes.append((_close_date(existing["effective_from"], today), existing["id"]))
                    result.prices_archived += 1
                inserts.append((
                    str(uuid.uuid4()),
                    item.inventory_id,
                    item.unit_cost_cents,
                    item.cost_uom,
                    item.preferred_vendor_id,
                    item.preferred_vendor_name,
                    today,
                    SOURCE,
                    ENTERED_BY,
                ))
                result.prices_inserted += 1
            if closes:
                cur.executemany(_CLOSE_SQL, closes)
            if inserts:
                cur.executemany(_PRICE_SQL, inserts)
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("workbook", type=Path, help="Aspire/Acumatica item workbook (.xlsx)")
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
        help="earlier behavior: load both sheets, stock wins on overlap, no id or agronomy filter",
    )
    parser.set_defaults(include_nonstock=False)
    parser.add_argument(
        "--include-agronomy",
        action="store_true",
        help="stock-only mode: load agronomy rows (item class -AG-) instead of holding them",
    )
    args = parser.parse_args(argv)
    rejects_path = args.rejects or Path.cwd() / f"{args.workbook.stem}.rejects.csv"

    plan = build_plan(
        args.workbook,
        include_nonstock=args.include_nonstock,
        include_agronomy=args.include_agronomy,
    )
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
