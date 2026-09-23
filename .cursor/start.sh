#!/usr/bin/env bash
# Cloud Agent start phase — per-boot service reconciliation.
#
# Brings up the local MariaDB the FastAPI backend talks to. Idempotent: it
# starts the daemon only if it is not already running and bootstraps the schema
# only on the first ever boot. The dev servers themselves run as named
# `terminals` (see .cursor/environment.json), not here.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOCK=/var/run/mysqld/mysqld.sock

echo "==> [start] Ensuring MariaDB directories"
sudo mkdir -p /var/lib/mysql /var/run/mysqld /var/log/mysql
sudo chown -R mysql:mysql /var/lib/mysql /var/run/mysqld /var/log/mysql

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

# Bootstrap schema only on the first boot (when the DB has no `leads` table yet).
if ! mysql -h127.0.0.1 -P3306 -ucrmadmin -pcrmpassword crm \
      -e "SELECT 1 FROM leads LIMIT 1" >/dev/null 2>&1; then
  echo "==> [start] Fresh database detected — bootstrapping schema"
  bash "$REPO/.cursor/init_db.sh"
fi

echo "==> [start] done"
