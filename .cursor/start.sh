#!/usr/bin/env bash
# Cloud Agent start phase — per-boot service reconciliation.
#
# Brings up the local MariaDB the FastAPI backend talks to. Idempotent: it
# starts the daemon only if it is not already running and bootstraps the schema
# only on the first ever boot. The dev servers themselves run as named
# `terminals` (see .cursor/environment.json), not here.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# MariaDB's packaged config pins pid-file/socket under /run/mysqld. On some VMs
# /var/run is a real directory rather than a symlink to /run, so create the
# canonical /run/mysqld path (and /var/run/mysqld for good measure).
SOCK=/run/mysqld/mysqld.sock

echo "==> [start] Ensuring MariaDB directories"
sudo install -d -o mysql -g mysql /run/mysqld /var/run/mysqld /var/lib/mysql /var/log/mysql

if [ ! -d /var/lib/mysql/mysql ]; then
  echo "==> [start] Initializing MariaDB data directory"
  sudo mariadb-install-db --user=mysql --datadir=/var/lib/mysql >/dev/null
fi

if sudo mysqladmin --socket="$SOCK" ping >/dev/null 2>&1; then
  echo "==> [start] MariaDB already running"
else
  echo "==> [start] Starting MariaDB"
  sudo bash -c "nohup mariadbd --user=mysql --datadir=/var/lib/mysql \
    --socket=$SOCK --port=3306 >/var/log/mysql/mariadbd.log 2>&1 &"
  for _ in $(seq 1 30); do
    sudo mysqladmin --socket="$SOCK" ping >/dev/null 2>&1 && break
    sleep 1
  done
  sudo mysqladmin --socket="$SOCK" ping >/dev/null 2>&1 \
    || { echo "ERROR: MariaDB did not become ready" >&2; exit 1; }
fi

echo "==> [start] Ensuring database and app user"
sudo mysql --socket="$SOCK" <<'SQL'
CREATE DATABASE IF NOT EXISTS crm CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'crmadmin'@'127.0.0.1' IDENTIFIED BY 'crmpassword';
CREATE USER IF NOT EXISTS 'crmadmin'@'localhost' IDENTIFIED BY 'crmpassword';
GRANT ALL PRIVILEGES ON crm.* TO 'crmadmin'@'127.0.0.1';
GRANT ALL PRIVILEGES ON crm.* TO 'crmadmin'@'localhost';
FLUSH PRIVILEGES;
SQL

# First boot loads sql/create_table and the numbered migrations. Later boots
# still run scripts/migrate.py. The baseline snapshot already has `leads`, so
# skipping migrations after that leaves new files (including 065's
# v_current_commission_plans view) unapplied.
if ! mysql -h127.0.0.1 -P3306 -ucrmadmin -pcrmpassword crm \
      -e "SELECT 1 FROM leads LIMIT 1" >/dev/null 2>&1; then
  echo "==> [start] Fresh database detected — bootstrapping schema"
  bash "$REPO/.cursor/init_db.sh"
else
  echo "==> [start] Applying pending migrations"
  # shellcheck disable=SC1091
  . "$REPO/.venv/bin/activate"
  export MYSQL_HOST=127.0.0.1 MYSQL_PORT=3306 MYSQL_USER=crmadmin MYSQL_PASSWORD=crmpassword MYSQL_DB=crm
  # 066 blocks when Michelle Cady and Rodrigo Leon are not exactly one user
  # each. That must not skip 065 or take the dev server down.
  python -m scripts.migrate || echo "==> [start] WARNING: migrations did not all apply"
fi

echo "==> [start] done"
