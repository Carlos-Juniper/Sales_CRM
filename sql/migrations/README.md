# Schema migrations

**New source of truth: `scripts/migrate.py`**

Migrations are now applied automatically by the runner — not by hand.
See [handoffs/34-migration-runner-and-state-reconciliation.md](../../handoffs/34-migration-runner-and-state-reconciliation.md) (tool) and [handoffs/35-migration-deploy-wiring-and-live-apply.md](../../handoffs/35-migration-deploy-wiring-and-live-apply.md) (CI wiring).

## The detector rule (read before adding a migration)

**A detector must test the effect of its own migration, and a multi-statement
migration needs a detector per effect or guarded statements throughout.** This is
not optional — it is the rule Handoff 49 was written to recover from.

Migration `001` violated both halves: `detect_001` keyed on a *sibling* artifact
(the `properties` table) rather than on the `leads.property_id` column its own
later steps add, **and** its `ALTER TABLE` steps were bare and unguarded. On the
live `crm` DB the `properties` table already existed, so the runner recorded 001
as `detected=1` while its two `ALTER` steps never ran — silently, for months.
`detected=1` means "the runner guessed this was applied", not "applied". Verify
column state in `information_schema` directly, never from `schema_migrations`.

The repair (migration `031`) is a NEW forward migration whose detector keys on
`leads.property_id` — its own effect — and whose every `ADD` is guarded on
`information_schema` with the dynamic PREPARE/EXECUTE pattern (see `027`/`028`).
See Handoff 49 §5 for why tightening `detect_001` instead would break the runner.

## Running migrations

```bash
# dry-run — report what would apply, no writes
python -m scripts.migrate --dry-run

# apply all pending (idempotent — safe to re-run)
python -m scripts.migrate

# verbose — prints each SQL statement as it executes
python -m scripts.migrate --verbose
```

Env vars (same as `db.py`): `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DB`, `MYSQL_SOCKET_PATH` (Unix socket; overrides host/port).

## CI integration

`cloudbuild.staging.yaml` runs the migration step **before** `gcloud run deploy` on every staging build.
A non-zero exit from `scripts/migrate.py` fails the Cloud Build step and blocks the deploy.

Prod wiring is a separate, deliberately-gated follow-up once staging has proven the pipeline step
for at least one real deploy cycle.

## Per-migration notes

- **001** — creates the `properties` table (canonical property model, Handoff 15).
- **002** — backfills `leads.property_id` from `leads.hoa_property_id`. Idempotent (`INSERT IGNORE` + `UPDATE`). Safe to re-run while `hoa_property_id` still exists; never re-run once 003 has dropped it.
- **003** — drops `leads.hoa_property_id`. Hard gate: runner halts if any leads still have `hoa_property_id IS NOT NULL AND property_id IS NULL` after 002.
- **004** — commits the `users` DDL plus `branches` and `sales_territories`. If a populated legacy `crm_users` table exists and `users` does not, the runner issues `RENAME TABLE crm_users TO users` instead of the CREATE. See the runner's 004 branch logic.
- **005** — adds `estimates.rfi_status` (Handoff 24).
- **006** — adds `itb_projects.estimate_id` (Handoff 21).
- **007** — renames `approval_tiers.role_key` to canonical auth roles, adds the install approval ladder (Handoff 19).
- **008** — adds `takeoff_lines.catalog_item_id` and `takeoff_lines.created_at` (Handoff 20).
- **009** — seeds `catalog_items` from the Aspire kit workbook (Handoff 22). Idempotent (`INSERT … ON DUPLICATE KEY UPDATE`). Refreshing from a newer workbook is a separate manual operation via `scripts/load_service_kits.py`.
- **010** — adds `estimates.lead_id` (pipeline kanban redesign).
- **011** — renames `leads.status = 'handed_off'` → `'estimating'` (data-only; idempotent `UPDATE WHERE`). Run before deploying the renamed frontend/backend code.
- **012** — adds `estimates.turf_area_acres`, `estimates.curb_miles`, and wires takeoff-scan attachments (Handoff 27).
- **013** — adds `section_services.discipline` (nullable LS/IR override, Handoff 29).
- **014** — creates `proposal_config_tables`: `team_members`, `client_references`, `portfolio_properties`, `insurance_certificates` (Handoff 37).
- **015** — seeds `proposal_config` tables with initial data (Handoff 37).
- **016** — creates `proposal_requests` table (Handoff 37 Slice 4).
- **017** — creates `proposal_renders` table for server-side PDF render results (Handoff 39).
- **025** — creates `beam_requests` + `beam_outputs` and adds `estimates.takeoff_changed_at` (Beam/Attentive takeoff integration). Detection keys on the `estimates` column — the file's only non-idempotent statement. Originally numbered 014 on `feat/estimating-tab-redesign`; renumbered to avoid collision with 014–017 (already applied to CRM DB).
- **026** — adds `leads.created_by` plus indexes on `created_by`, `assigned_to` and `source`, backing the user-scoped Leads tab (`?mine=true`) and the gov-only Public Leads feed (`?sources=higher_gov,sam_gov`). Originally numbered 015; renumbered for same reason as 025.
- **027** — adds `estimates.latest_proposal_render_id` + `estimates.latest_proposal_object_key`, a denormalized pointer to the most recent successful proposal PDF render. Written by `api/proposal_render.py` after each render; `proposal_renders` remains the source of truth for full version history.
- **028** — merges `insurance_certificates` into `licenses_certifications` (Handoff 42), widening the `kind` ENUM to include `'insurance'` and dropping the source table as its final step. Originally numbered 027; renumbered to avoid colliding with `027_estimate_proposal_pdf_link.sql`, which merged to staging first.
- **058** — backfills `user_branches` with both twin branch ids for the 11 managers inserted by 057; fixes the proposal team picker omitting managers on maintenance-twin branches (Handoff 43 A.6).
- **062** — adds `owner_user_id` to `team_members` and `client_references` (guarded). Not the same change as 058.
- **063** — nullable `estimates.homes_budget` / `common_area_budget`. Renumbered from 059 so it does not share a number with the branch-manager migration on `integrate/staging-proposals`.
- **064** — yearly maintenance occurrence counts on `estimates`. Renumbered from 061 for the same reason.
- **065** — commission payout installments, the standard plan (rates as data), `v_current_commission_plans`, and an empty billing ledger. Adds `commission_plans`, `commission_plan_rules`, `user_commission_plans`, `commission_installments`, `commission_billing_events`, and three guarded columns on the existing `commissions` table: `plan_key`, `client_type`, `contract_start_date`. Payout timing is not a column. `maintenance` maps to `maintenance_3_payment` and `install` maps to `construction_billing_quarterly` in `api/commission_calc.py`. Enhancement rates are not seeded. The file does not insert installments. `apply_065` runs the SQL, then backfills missing installments with those helpers and skips an installment number that already exists. Detector keys on the new tables, `information_schema.VIEWS` for `v_current_commission_plans`, the three commission columns, the basis columns, both unique indexes, and the maintenance and new-client install seeds. A tracking row follows the ordinary path: checksum mismatch warns once and the file is not re-run. A commission with zero installments does not flip detection. Assigning the standard plan to people is `scripts/assign_standard_commission_plan.py` (`--dry-run` by default, `--apply` to write), not a migration. It uses `authz.SALES_REP_DB_ROLES` and also includes `vp_sales` (added to that tuple by PR #39). Michelle Cady and Rodrigo Leon stay off the standard plan: pass their `users.id` values with `--exclude-user-ids` (repeatable or comma-separated). The script matches those ids, not names, and lists excluded users separately from the users it would assign.
- **067** — data-only: users on `sales` or `outside_sales` become `maintenance_sales`. Does not grant `vp_sales`. After deploy, an admin sets Michelle Cady to VP of Sales in Settings → Users. Numbered 067 because the commissions PR uses 065 and 066. No detector: the statement is idempotent, and guessing from "no sales rows left" would skip a database that never ran it. The `schema_migrations` row is what means applied.
- **068** — widens `approval_tiers.role_key` and seeds an unbounded (`max_value_cents` NULL) row for `admin` and `vp_sales` on both estimate types, so `require_approval_authority` does not 403 them. Detector: the enum contains both roles and each has an unbounded row.
- **069** — renames kit table `catalog_items` to `service_kits` (and `catalog_item_id` to `service_kit_id` on `section_services` and `takeoff_lines`). Indexes become `idx_service_kits_kit_type`, `idx_service_kits_active`, and `idx_service_kits_aspire_branch`. Numbered 069 because 065 is the open commission-cadence migration and 067/068 are the open sales-role migrations. Rollback: `sql/rollbacks/069_service_kits_down.sql` (not run by the migrator). That file also deletes the `069_service_kits` row from `schema_migrations`.
- **070** — creates `materials` (item master, no cost) and `material_prices` (cost history, one current row per item). `material_prices.current_inventory_id` is a STORED generated column (`inventory_id` when `is_current = 1`, else NULL) under the unique key `uq_material_prices_one_current`; `fk_material_prices_item` is `ON UPDATE RESTRICT ON DELETE RESTRICT` because MySQL forbids a cascading FK on a generated column's base column. No triggers, functions, or procedures: Cloud SQL has binary logging on and the migration user has no SUPER, so `CREATE TRIGGER` fails with ERROR 1419 (the first version of this file failed that way on juniper-dev after creating `materials` and an older `material_prices`). The file is re-runnable and its guarded ALTERs upgrade that half-applied shape (drop the CASCADE FK and marker CHECK, rebuild `current_inventory_id` as generated, re-add the unique key and a RESTRICT FK); it also drops the first version's triggers and `material_price_loads` if a database has them. Price history is written by `scripts/load_materials_catalog.py` (locks the current row `FOR UPDATE`, closes it on a cost change, inserts the new current row; unchanged cost writes nothing). Detector: both tables, generated `current_inventory_id`, the unique key, and the item FK. Rollback: `sql/rollbacks/070_materials_catalog_down.sql` (not run by the migrator). That file drops the tables (and any first-version triggers) and deletes the `070_materials_catalog` row from `schema_migrations`. It does not touch `service_kits`.
- **071** — creates `item_class_groups` and `item_classes` (the Acumatica item class list). Additive, `CREATE TABLE IF NOT EXISTS` only. `item_classes.item_class_id` is the underscore class id that `materials.item_class` holds; there is no FK from `materials`. Rows come from `scripts/load_item_classes.py` reading `scripts/data/acumatica_item_classes.xlsx`, not from the migration. Detector: both tables, `uq_item_classes_code`, `fk_item_classes_group`. Rollback: `sql/rollbacks/071_item_classes_down.sql`.
- **072** — adds `materials.item_status VARCHAR(32) NOT NULL DEFAULT 'Active'` (Acumatica `ItemStatus`: Active, Inactive, No Purchases, …), backfilled from `active` (1 → `Active`, 0 → `Inactive`), and replaces `active` with a STORED generated column `(item_status = 'Active')`, re-adding `idx_materials_bid_active`. Readers of `active` are unchanged; writers set `item_status` (`scripts/materials_store.py`). Numbered 072 because 071 is `item_classes`. Every step is guarded, so a partial run finishes on the next run. Detector: `item_status` NOT NULL, generated `active`, and the index. Rollback: `sql/rollbacks/072_materials_item_status_down.sql` restores the plain `active` from `item_status`, drops `item_status`, and deletes the tracking row.

### Numbering history

Migrations 014–024 were authored in `worktree-proposify` (proposal config, seed, requests, renders,
licenses, branch model, settings storage, geocode backfill, contract column drops, soft-delete
parity, crew rate) and applied to the CRM DB before this consolidation. The estimating branch
independently created 014/015 for Beam/Leads; those were renumbered to 025/026 during the
consolidation merge (2026-09-03). The runner keys detection on the filename prefix — a duplicate
number would be silently skipped, not surfaced as a merge conflict.

---

## Historical note — hand-run instructions (superseded)

The instructions below were the old manual process before `scripts/migrate.py` existed.
They are preserved here for reference only. **Do not follow them** — the runner handles all of this automatically, including detection of already-applied migrations.

<details>
<summary>Old hand-run instructions (click to expand)</summary>

`db.run_migrations()` was a deliberate **no-op** — nothing applied SQL automatically. Files were applied by hand, in order, against the live `crm` database:

```bash
mysql -h 127.0.0.1 -P 3306 -u <user> -p crm < sql/migrations/001_canonical_properties.sql
mysql -h 127.0.0.1 -P 3306 -u <user> -p crm < sql/migrations/002_backfill_leads_property_id.sql
# ⚠️ Run 003 ONLY after the verification query at the end of 002 returns 0.
mysql -h 127.0.0.1 -P 3306 -u <user> -p crm < sql/migrations/003_drop_leads_hoa_property_id.sql
```

Superseded by `scripts/migrate.py` — see Handoff 34.

</details>
