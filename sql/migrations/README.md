# Schema migrations

**New source of truth: `scripts/migrate.py`**

Migrations are now applied automatically by the runner — not by hand.
See [handoffs/34-migration-runner-and-state-reconciliation.md](../../handoffs/34-migration-runner-and-state-reconciliation.md) (tool) and [handoffs/35-migration-deploy-wiring-and-live-apply.md](../../handoffs/35-migration-deploy-wiring-and-live-apply.md) (CI wiring).

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
