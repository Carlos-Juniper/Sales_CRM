#!/usr/bin/env python3
"""Load the materials item master and cost history from an Aspire/Acumatica workbook.

Reads the Stock Items sheet and the NONStock Items sheet. When an inventory
id is on both, the Stock Items row is the one that is stored. Writes
``catalog_items`` (item master, no cost) and ``catalog_prices`` (one current
cost per item, ``source='aspire_import'``). Re-running with the same cost
does not insert another price row. A changed cost archives the current row
and inserts a new one.

The workbook is not part of this repo. Pass its path.

Usage (from repo root):
    venv/bin/python scripts/load_materials_catalog.py workbook.xlsx --dry-run
    venv/bin/python scripts/load_materials_catalog.py workbook.xlsx
    venv/bin/python scripts/load_materials_catalog.py workbook.xlsx --rejects /tmp/rejects.csv

Env vars (same as scripts/migrate.py), used only when not --dry-run:
    MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DB
    MYSQL_SOCKET_PATH   — Cloud SQL Auth Proxy socket; overrides host/port

``inventory_id`` must already be 10 digits. Short numeric ids are not
zero-padded: in the Aspire export the only short id is ``101``, repeated
for 21 different products, so padding would collapse them into one fake code.
Those rows are skipped and written to the rejects CSV.

A third sheet, "Template Stock Items STENS", is not one of the two sheets
this loader reads. Its ids are counted and left unloaded.
"""
from __future__ import annotations

import argparse
import csv
import os
import sys
import uuid
import zipfile
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from xml.etree import ElementTree as ET

import pymysql
import pymysql.cursors

_M = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
_PKG = "{http://schemas.openxmlformats.org/package/2006/relationships}"

SOURCE = "aspire_import"
ENTERED_BY = "scripts/load_materials_catalog.py"
BATCH = 400

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
    inventory_id: str
    reason: str
    description: str


@dataclass
class LoadPlan:
    stock_sheet: str
    nonstock_sheet: str
    ignored_sheets: list[tuple[str, int]] = field(default_factory=list)
    stock_rows: int = 0
    nonstock_rows: int = 0
    overlap: int = 0
    stock_overrides: int = 0
    stock_override_conflicts: int = 0
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


@dataclass
class ApplyResult:
    items_upserted: int = 0
    prices_inserted: int = 0
    prices_unchanged: int = 0
    prices_archived: int = 0


# ── workbook ──────────────────────────────────────────────────────────────────

def _shared_strings(z: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in z.namelist():
        return []
    root = ET.fromstring(z.read("xl/sharedStrings.xml"))
    return [
        "".join(t.text or "" for t in si.iter(_M + "t"))
        for si in root.findall(_M + "si")
    ]


def _sheet_targets(z: zipfile.ZipFile) -> list[tuple[str, str]]:
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    rid_to_target = {rel.get("Id"): rel.get("Target") for rel in rels}
    out = []
    for sh in wb.findall(_M + "sheets/" + _M + "sheet"):
        name = sh.get("name") or ""
        target = rid_to_target[sh.get(_REL + "id")]
        target = target.lstrip("/")
        if not target.startswith("xl/"):
            target = "xl/" + target
        out.append((name, target))
    return out


def _sheet_rows(z: zipfile.ZipFile, target: str, shared: list[str]) -> list[dict[str, str | None]]:
    root = ET.fromstring(z.read(target))
    rows: list[dict[str, str | None]] = []
    for row in root.iter(_M + "row"):
        vals: dict[str, str | None] = {}
        for cell in row:
            ref = cell.get("r") or ""
            col = "".join(ch for ch in ref if ch.isalpha())
            value = cell.find(_M + "v")
            inline = cell.find(_M + "is")
            if inline is not None:
                text = "".join(t.text or "" for t in inline.iter(_M + "t"))
            elif value is None or value.text is None:
                text = None
            elif cell.get("t") == "s":
                text = shared[int(value.text)]
            else:
                text = value.text
            vals[col] = text
        rows.append(vals)
    return rows


def _norm_header(name: str) -> str:
    return " ".join(name.replace("\n", " ").split()).casefold()


def _header_fields(rows: list[dict[str, str | None]]) -> tuple[int, dict[str, str]]:
    """Return (header index, column letter → normalized header)."""
    for i, row in enumerate(rows):
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


def _records(rows: list[dict[str, str | None]]) -> list[dict[str, list[str | None]]]:
    header_at, headers = _header_fields(rows)
    out = []
    for row in rows[header_at + 1 :]:
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
            out.append(fields)
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


def _open_sheets(workbook: Path) -> tuple[str, str, list[tuple[str, list[dict[str, list[str | None]]]]], list[tuple[str, int]]]:
    with zipfile.ZipFile(workbook) as z:
        shared = _shared_strings(z)
        targets = _sheet_targets(z)
        chosen: dict[str, tuple[str, list]] = {}
        ignored: list[tuple[str, int]] = []
        for name, target in targets:
            kind = _sheet_kind(name)
            if kind is None:
                continue
            rows = _sheet_rows(z, target, shared)
            if kind == "ignored":
                try:
                    ignored.append((name, len(_records(rows))))
                except ValueError:
                    ignored.append((name, 0))
                continue
            if kind in chosen:
                raise ValueError(f"more than one {kind} sheet ({chosen[kind][0]!r} and {name!r})")
            chosen[kind] = (name, _records(rows))
    if "stock" not in chosen or "nonstock" not in chosen:
        found = ", ".join(name for name, _ in targets)
        raise ValueError(f"workbook needs a Stock Items sheet and a NONStock Items sheet; found: {found}")
    return chosen["stock"][0], chosen["nonstock"][0], [
        (chosen["stock"][0], chosen["stock"][1]),
        (chosen["nonstock"][0], chosen["nonstock"][1]),
    ], ignored


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


def _map_row(fields: dict[str, list[str | None]], *, is_stock: int, sheet: str) -> tuple[MaterialItem | None, Reject | None, str]:
    inventory_id = _first(fields.get("inventory id")) or ""
    description = _first(fields.get("description")) or ""
    if not inventory_id:
        return None, Reject(sheet, "", "missing_inventory_id", description), "missing"
    if not (inventory_id.isdigit() and len(inventory_id) == 10):
        return None, Reject(sheet, inventory_id, "inventory_id_not_10_digits", description), "bad_id"
    if not description:
        return None, Reject(sheet, inventory_id, "missing_description", ""), "missing_desc"

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
        return None, Reject(sheet, inventory_id, "value_too_long:" + ",".join(too_long), description), "long"

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


def _collapse(
    sheet: str, rows: list[dict[str, list[str | None]]], *, is_stock: int,
) -> tuple[dict[str, tuple[MaterialItem, str]], list[Reject], Counter]:
    """One item per inventory id. Conflicting duplicates are all rejected."""
    grouped: dict[str, list[tuple[MaterialItem, str]]] = defaultdict(list)
    rejects: list[Reject] = []
    notes: Counter = Counter()
    for fields in rows:
        item, reject, _cost_status = _map_row(fields, is_stock=is_stock, sheet=sheet)
        if reject is not None:
            rejects.append(reject)
            notes[reject.reason.split(":", 1)[0]] += 1
            continue
        assert item is not None
        grouped[item.inventory_id].append((item, _cost_status))

    kept: dict[str, tuple[MaterialItem, str]] = {}
    for inventory_id, pairs in grouped.items():
        first, cost_status = pairs[0]
        if all(_signature(other) == _signature(first) for other, _ in pairs[1:]):
            kept[inventory_id] = (first, cost_status)
            if len(pairs) > 1:
                notes["identical_duplicates_collapsed"] += len(pairs) - 1
            continue
        notes["conflicting_duplicate_inventory_id"] += len(pairs)
        for item, _ in pairs:
            rejects.append(Reject(
                sheet, inventory_id, "conflicting_duplicate_inventory_id", item.description,
            ))
    return kept, rejects, notes


def _ten_digit_ids(kept: dict[str, tuple[MaterialItem, str]], rejects: list[Reject]) -> set[str]:
    ids = set(kept)
    for rej in rejects:
        if rej.inventory_id.isdigit() and len(rej.inventory_id) == 10:
            ids.add(rej.inventory_id)
    return ids


def _overrides(stock: MaterialItem, other: MaterialItem) -> bool:
    return _signature(stock) != _signature(other)


def build_plan(workbook: Path) -> LoadPlan:
    stock_name, non_name, sheets, ignored = _open_sheets(workbook)
    stock_rows = sheets[0][1]
    non_rows = sheets[1][1]
    stock, stock_rejects, stock_notes = _collapse(stock_name, stock_rows, is_stock=1)
    non, non_rejects, non_notes = _collapse(non_name, non_rows, is_stock=0)

    blocked = {
        rej.inventory_id
        for rej in stock_rejects
        if rej.reason == "conflicting_duplicate_inventory_id"
    }
    non_ids = _ten_digit_ids(non, non_rejects)
    items: list[MaterialItem] = []
    statuses: dict[str, str] = {}
    rejects = list(stock_rejects)
    overrides = 0
    conflicts = 0
    for inventory_id, (item, _status) in stock.items():
        if inventory_id not in non_ids:
            continue
        overrides += 1
        other = non.get(inventory_id)
        # No single non-stock row (its copies disagree, or it was rejected)
        # means the sheets do not carry the same item.
        if other is None or _overrides(item, other[0]):
            conflicts += 1
    for inventory_id, (item, status) in non.items():
        if inventory_id in blocked:
            rejects.append(Reject(
                non_name, inventory_id, "stock_sheet_conflict", item.description,
            ))
            continue
        if inventory_id in stock:
            continue
        items.append(item)
        statuses[inventory_id] = status
    for rej in non_rejects:
        # Stock already won this id. Drop the non-stock duplicate rejects.
        if rej.reason == "conflicting_duplicate_inventory_id" and rej.inventory_id in stock:
            continue
        rejects.append(rej)

    for inventory_id, (item, status) in stock.items():
        items.append(item)
        statuses[inventory_id] = status
    items.sort(key=lambda item: item.inventory_id)
    plan = LoadPlan(
        stock_sheet=stock_name,
        nonstock_sheet=non_name,
        ignored_sheets=ignored,
        stock_rows=len(stock_rows),
        nonstock_rows=len(non_rows),
        overlap=len(_ten_digit_ids(stock, stock_rejects) & non_ids),
        stock_overrides=overrides,
        stock_override_conflicts=conflicts,
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
    short = sorted({rej.inventory_id for rej in plan.rejects if rej.reason == "inventory_id_not_10_digits" and rej.inventory_id.isdigit()})
    lines = [
        f"materials catalog load ({'dry-run' if dry_run else 'write'})",
        f"  stock sheet: {plan.stock_sheet} rows={plan.stock_rows}",
        f"  nonstock sheet: {plan.nonstock_sheet} rows={plan.nonstock_rows}",
    ]
    for name, count in plan.ignored_sheets:
        lines.append(f"  ignored sheet: {name} rows={count} (not loaded)")
    lines.extend([
        f"  overlap inventory ids: {plan.overlap}",
        f"  stock overrides: {plan.stock_overrides}",
        f"  stock override conflicts: {plan.stock_override_conflicts}",
        f"  unique items: {len(plan.items)}",
        f"  stock items: {sum(1 for item in plan.items if item.is_stock_item)}",
        f"  nonstock items: {sum(1 for item in plan.items if not item.is_stock_item)}",
        f"  items with cost: {plan.with_cost}",
        f"  items without cost: {plan.without_cost}",
        f"  zero costs (no price row): {plan.zero_costs}",
        f"  bad costs (item kept, no price row): {plan.bad_costs}",
        f"  identical duplicate rows collapsed: {plan.identical_duplicates}",
        f"  rejects: {len(plan.rejects)}",
    ])
    for reason, count in sorted(reasons.items()):
        lines.append(f"    {reason}: {count}")
    if short:
        lines.append(
            "  short numeric ids not zero-padded: "
            + ", ".join(f"{value} x{sum(1 for rej in plan.rejects if rej.inventory_id == value)}" for value in short)
        )
        lines.append(
            "  zero-pad decision: no. A short id is only padded when it is a truncated Aspire code."
            " These values are placeholders shared by different products."
        )
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
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["sheet", "inventory_id", "reason", "description"])
        for rej in rejects:
            writer.writerow([rej.sheet, rej.inventory_id, rej.reason, rej.description])


# ── database ──────────────────────────────────────────────────────────────────

def connect():
    kwargs: dict = dict(
        host=os.environ.get("MYSQL_HOST", "127.0.0.1"),
        port=int(os.environ.get("MYSQL_PORT", "3306")),
        user=os.environ.get("MYSQL_USER", "crmadmin"),
        password=os.environ.get("MYSQL_PASSWORD", ""),
        database=os.environ.get("MYSQL_DB", "crm"),
        autocommit=False,
        connect_timeout=10,
        cursorclass=pymysql.cursors.DictCursor,
    )
    socket_path = os.environ.get("MYSQL_SOCKET_PATH", "")
    if socket_path:
        kwargs["unix_socket"] = socket_path
        del kwargs["host"]
        del kwargs["port"]
    return pymysql.connect(**kwargs)


# MySQL 8.0.19 row aliases (`INSERT ... AS new`) fail on MariaDB 10.11, which
# is the local bootstrap server. VALUES() is deprecated on MySQL 8.4 and still
# executes there. aspire_catalog_item_id is omitted: the workbook's Aspire
# Item Code repeats inventory_id and is not Aspire's numeric CatalogItemID.
_ITEM_SQL = """
INSERT INTO catalog_items (
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

_PRICE_INSERT = """
INSERT INTO catalog_prices (
    id, inventory_id, unit_cost_cents, uom, vendor_id, vendor_name,
    effective_from, is_current, source, entered_by
) VALUES (%s, %s, %s, %s, %s, %s, %s, 1, %s, %s)
"""

_PRICE_ARCHIVE = """
UPDATE catalog_prices
   SET is_current = 0, effective_to = %s
 WHERE id = %s AND is_current = 1
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


def apply_plan(conn, plan: LoadPlan, *, today: date | None = None) -> ApplyResult:
    """Upsert items and sync current prices. Caller commits or rolls back."""
    today = today or date.today()
    result = ApplyResult(items_upserted=len(plan.items))
    with conn.cursor() as cur:
        for batch in _chunks(plan.items, BATCH):
            cur.executemany(_ITEM_SQL, [_item_params(item) for item in batch])

        priced = [item for item in plan.items if item.unit_cost_cents is not None]
        current: dict[str, dict] = {}
        ids = [item.inventory_id for item in priced]
        for batch in _chunks(ids, BATCH):
            marks = ", ".join(["%s"] * len(batch))
            cur.execute(
                f"""SELECT id, inventory_id, unit_cost_cents, effective_from
                      FROM catalog_prices
                     WHERE is_current = 1 AND inventory_id IN ({marks})""",
                batch,
            )
            for row in cur.fetchall():
                current[row["inventory_id"]] = row

        to_archive: list[tuple] = []
        to_insert: list[tuple] = []
        for item in priced:
            existing = current.get(item.inventory_id)
            if existing is not None and int(existing["unit_cost_cents"]) == item.unit_cost_cents:
                result.prices_unchanged += 1
                continue
            if existing is not None:
                effective_to = today
                effective_from = existing["effective_from"]
                if effective_from is not None and effective_from > effective_to:
                    effective_to = effective_from
                to_archive.append((effective_to, existing["id"]))
            to_insert.append((
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
        # Archive first so the one-current unique key is free for the new row.
        for batch in _chunks(to_archive, BATCH):
            cur.executemany(_PRICE_ARCHIVE, batch)
        for batch in _chunks(to_insert, BATCH):
            cur.executemany(_PRICE_INSERT, batch)
        result.prices_archived = len(to_archive)
        result.prices_inserted = len(to_insert)
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
    args = parser.parse_args(argv)
    rejects_path = args.rejects or Path.cwd() / f"{args.workbook.stem}.rejects.csv"

    plan = build_plan(args.workbook)
    write_rejects(rejects_path, plan.rejects)
    if args.dry_run:
        print(format_summary(plan, dry_run=True, rejects_path=rejects_path))
        return 0

    conn = connect()
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
