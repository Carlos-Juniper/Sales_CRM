#!/usr/bin/env bash
# One-time schema bootstrap for a fresh local MariaDB.
#
# Applies the baseline table definitions in sql/create_table/ and then runs the
# numbered migrations in sql/migrations/ via scripts/migrate.py. Safe to re-run:
# create_table files use CREATE TABLE IF NOT EXISTS and the migrate runner is
# idempotent. .cursor/start.sh only calls this on the very first boot (when the
# `leads` table does not yet exist); afterwards the built schema persists on disk.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

MYSQL_ARGS=(-h127.0.0.1 -P3306 -ucrmadmin -pcrmpassword)

echo "==> [init_db] Loading baseline schema (sql/create_table/)"
# Pure CREATE TABLE files first (order-independent under FK checks off), then the
# two ALTER-style *_migration.sql files whose target tables the CREATEs define.
# --force tolerates the benign "duplicate column" notices for columns that
# estimating.sql already defines.
{
  echo "SET FOREIGN_KEY_CHECKS=0;"
  for f in bids branches estimating higher_gov_opportunities hoa_contact_information \
           hoa_properties lead_actions leads management_companies properties \
           sales_territories sam_gov_opportunities scraper_runs users; do
    cat "sql/create_table/$f.sql"; echo ";"
  done
  cat "sql/create_table/aspire_sync_migration.sql"; echo ";"
  cat "sql/create_table/attachments_migration.sql"; echo ";"
  echo "SET FOREIGN_KEY_CHECKS=1;"
} | mysql "${MYSQL_ARGS[@]}" --force crm 2>&1 | (grep -v "Using a password" || true) | \
    grep -vE "Duplicate column name|Duplicate key name|check that column/key exists" || true

echo "==> [init_db] Skipping superseded migration 046_commissions_schema"
# 046_commissions_schema.sql is a leftover, superseded duplicate of
# 054_commissions_schema.sql. It uses a DELIMITER//TRIGGER block that the
# migrate runner's statement splitter cannot parse, and it has no detector, so
# migrate.py would abort on it against a fresh DB. Record it as detected (the
# same treatment the runner gives superseded migrations); 054 creates the real
# commissions schema.
CK=$(sha256sum sql/migrations/046_commissions_schema.sql | cut -d' ' -f1)
mysql "${MYSQL_ARGS[@]}" crm 2>/dev/null <<SQL || true
CREATE TABLE IF NOT EXISTS schema_migrations (
  id CHAR(64) NOT NULL,
  checksum CHAR(64) NOT NULL,
  detected TINYINT(1) NOT NULL DEFAULT 0,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
);
INSERT IGNORE INTO schema_migrations (id, checksum, detected)
VALUES ('046_commissions_schema', '$CK', 1);
SQL

echo "==> [init_db] Running numbered migrations (scripts/migrate.py)"
# shellcheck disable=SC1091
. .venv/bin/activate
export MYSQL_HOST=127.0.0.1 MYSQL_PORT=3306 MYSQL_USER=crmadmin MYSQL_PASSWORD=crmpassword MYSQL_DB=crm
python -m scripts.migrate

echo "==> [init_db] done"
