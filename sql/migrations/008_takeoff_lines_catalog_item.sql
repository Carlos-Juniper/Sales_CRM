-- ---------------------------------------------------------------------------
-- Migration 008 — Handoff 20 (Takeoff Lines Backend & Aspire Qty Push).
--
-- takeoff_lines.catalog_item_id — nullable link from a takeoff line to a
-- catalog_items/kit row (mirrors section_services.catalog_item_id, Handoff 00
-- §3.4). Lines that carry it are matched to Aspire OpportunityServiceItems
-- (by CatalogItemID) so the estimate-Save qty push can write ItemQuantity.
-- Lines without it are local-only and never push.
--
-- takeoff_lines.created_at — stable list ordering for the Discrepancy Review
-- table (the API orders by created_at, id); every sibling table already has it.
--
-- No FK constraint, matching the migration-set convention (relationships are
-- logical/indexed; integrity enforced in code).
--
-- MySQL 8 has no "ADD COLUMN IF NOT EXISTS", so run once and only once.
-- Apply to local `crm` (no schema prefix); for the `juniper` schema, prefix
-- the table name (see the commented block at the bottom).
-- ---------------------------------------------------------------------------

ALTER TABLE takeoff_lines
    ADD COLUMN catalog_item_id VARCHAR(36) NULL AFTER opportunity_qty,
    ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER catalog_item_id,
    ADD INDEX idx_takeoff_catalog_item (catalog_item_id);

-- juniper-schema variant:
--   ALTER TABLE juniper.takeoff_lines
--       ADD COLUMN catalog_item_id VARCHAR(36) NULL AFTER opportunity_qty,
--       ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER catalog_item_id,
--       ADD INDEX idx_takeoff_catalog_item (catalog_item_id);
