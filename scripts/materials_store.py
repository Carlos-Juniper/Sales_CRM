"""Materials catalog row model and idempotent upsert.

Source-agnostic: scripts/load_materials_catalog.py builds MaterialItem rows
from a workbook today. A future Acumatica sync (GET
/entity/Default/24.200.001/StockItem, incremental on LastModified) is meant
to build the same rows and call upsert_items; nothing here reads a file.

MaterialItem is keyed on inventory_id. Field -> Acumatica StockItem field:

    inventory_id              InventoryID
    description               Description
    item_class                ItemClass (class id, IRRIGATION-PARTS_____)
    item_status               ItemStatus
    posting_class             PostingClass
    base_uom / sales_uom /
    purchase_uom              BaseUOM / SalesUOM / PurchaseUOM
    purchase_to_base_factor   UOMConversions (PurchaseUOM -> BaseUOM ConversionFactor)
    preferred_vendor_id       VendorDetails (default vendor) VendorID
    vendor_sku                CrossReferences AlternateID (vendor part number)
    unit_cost_cents           LastCost, per cost_uom (the purchase unit)

    alternate_name, aspire_category, manufacturer, available_to_bid are
    Aspire or attribute fields with no StockItem column of the same name.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

BATCH = 400


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
    item_status: str
    unit_cost_cents: int | None
    cost_uom: str | None


@dataclass
class ApplyResult:
    items_upserted: int = 0
    prices_inserted: int = 0
    prices_unchanged: int = 0
    prices_archived: int = 0


# MySQL 8.0.19 row aliases (`INSERT ... AS new`) fail on MariaDB 10.11, which
# is the local bootstrap server. VALUES() is deprecated on MySQL 8.4 and still
# executes there. aspire_catalog_item_id is not written: no source has Aspire's
# numeric CatalogItemID (the workbook's Aspire Item Code repeats inventory_id).
# active is generated from item_status (072) and is never written.
_ITEM_SQL = """
INSERT INTO materials (
    inventory_id, description, alternate_name, item_class, aspire_category,
    posting_class, manufacturer, base_uom, sales_uom, purchase_uom,
    purchase_to_base_factor, preferred_vendor_id, preferred_vendor_name,
    vendor_sku, is_stock_item, available_to_bid, item_status
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
    item_status = VALUES(item_status)
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
        item.is_stock_item, item.available_to_bid, item.item_status,
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


def upsert_items(
    conn, items: list[MaterialItem], *, source: str, entered_by: str, today: date | None = None,
) -> ApplyResult:
    """Upsert items and record cost history on material_prices.

    ``source`` and ``entered_by`` are written on each new price row
    (material_prices.source is VARCHAR(32)).

    Runs in the caller's transaction; the caller commits or rolls back, so a
    failed load leaves nothing half-written. For each priced item the
    current row is locked (SELECT ... FOR UPDATE). No current row: insert
    one. Same cost: nothing is written. Different cost: the current row is
    closed (is_current = 0, effective_to = max(its effective_from, today))
    before the new current row is inserted, so the one-current unique key
    on the generated current_inventory_id always holds.
    """
    today = today or date.today()
    result = ApplyResult(items_upserted=len(items))
    with conn.cursor() as cur:
        for batch in _chunks(items, BATCH):
            cur.executemany(_ITEM_SQL, [_item_params(item) for item in batch])

        priced = [item for item in items if item.unit_cost_cents is not None and item.cost_uom]
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
                    source,
                    entered_by,
                ))
                result.prices_inserted += 1
            if closes:
                cur.executemany(_CLOSE_SQL, closes)
            if inserts:
                cur.executemany(_PRICE_SQL, inserts)
    return result
