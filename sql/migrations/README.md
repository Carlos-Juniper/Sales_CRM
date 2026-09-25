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
- **009** — seeds `catalog_items` from the Aspire kit workbook (Handoff 22). Idempotent (`INSERT … ON DUPLICATE KEY UPDATE`). Refreshing from a newer workbook is a separate manual operation via `scripts/load_catalog_items.py`.
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
- **065** — commission payout installments, the standard plan (rates and payout cadence as data), `v_current_commission_plans`, and an empty billing ledger. Adds `commission_plans`, `commission_plan_rules` (including `payout_schedule`), `user_commission_plans`, `commission_installments`, `commission_billing_events`, and three columns on the existing `commissions` table: `plan_key`, `client_type`, `contract_start_date`. Maintenance rules use `maintenance_3_payment`. Install rules use `construction_billing_quarterly`. Enhancement rates are not seeded. Installment backfill is `INSERT IGNORE` (no delete). Detector keys on the new tables, the view, `payout_schedule`, the three commission columns, the basis columns, both unique indexes, and the maintenance and new-client install seeds. A commission with zero installments does not flip detection. `check_065_gate` blocks a re-run when any installment already has `collected_amount_cents`, `billing_installment_number`, or `paid_at` set.
- **066** — data only. Assigns every commission-earning sales user to `user_commission_plans` plan `standard` with fixed `effective_date` 2026-09-25. Roles are `sales`, `outside_sales`, `maintenance_sales`, `install_sales`, and `inside_sales`. Michelle Cady and Rodrigo Leon are matched by exact trimmed `users.name`. If either name is not exactly one user, the SQL aborts and `_step` returns `blocked` (the migration 003 pattern) instead of warning and continuing. Their `commission_rates` rows are not read or written. Idempotent (`INSERT IGNORE` and `NOT EXISTS`). An explicit plan row takes precedence over a legacy rate, so every other sales user moves onto the standard plan. Detector keys on a row in `commission_migration_markers`, not on who currently has a plan.

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
