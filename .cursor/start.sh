#!/usr/bin/env bash
# Cloud Agent start phase — per-boot service reconciliation.
#
# Brings up the local MariaDB the FastAPI backend talks to. Idempotent: it
# starts the daemon only if it is not already running, loads sql/create_table
# only when the database has no tables, and runs scripts/migrate.py on every
# boot (a no-op when nothing is pending). The dev servers themselves run as
# named `terminals` (see .cursor/environment.json), not here.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

set -a
# shellcheck disable=SC1091
. .cursor/dev.env
set +a

: "${MYSQL_HOST:?MYSQL_HOST must be set in .cursor/dev.env}"
: "${MYSQL_PORT:?MYSQL_PORT must be set in .cursor/dev.env}"
: "${MYSQL_USER:?MYSQL_USER must be set in .cursor/dev.env}"
: "${MYSQL_PASSWORD:?MYSQL_PASSWORD must be set in .cursor/dev.env}"
: "${MYSQL_DB:?MYSQL_DB must be set in .cursor/dev.env}"

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
    --socket=$SOCK --port=${MYSQL_PORT} >/var/log/mysql/mariadbd.log 2>&1 &"
  for _ in $(seq 1 30); do
    sudo mysqladmin --socket="$SOCK" ping >/dev/null 2>&1 && break
    sleep 1
  done
  sudo mysqladmin --socket="$SOCK" ping >/dev/null 2>&1 \
    || { echo "ERROR: MariaDB did not become ready" >&2; exit 1; }
fi

sql_quote() {
  # Escape a value for a single-quoted SQL string literal.
  printf "%s" "$1" | sed -e 's/\\/\\\\/g' -e "s/'/''/g"
}

if ! [[ "$MYSQL_DB" =~ ^[A-Za-z0-9_]+$ ]]; then
  echo "ERROR: MYSQL_DB must match [A-Za-z0-9_]+" >&2
  exit 1
fi
if ! [[ "$MYSQL_USER" =~ ^[A-Za-z0-9_]+$ ]]; then
  echo "ERROR: MYSQL_USER must match [A-Za-z0-9_]+" >&2
  exit 1
fi

echo "==> [start] Ensuring database and app user"
user_lit=$(sql_quote "$MYSQL_USER")
pass_lit=$(sql_quote "$MYSQL_PASSWORD")
sudo mysql --socket="$SOCK" <<SQL
CREATE DATABASE IF NOT EXISTS \`${MYSQL_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${user_lit}'@'127.0.0.1' IDENTIFIED BY '${pass_lit}';
CREATE USER IF NOT EXISTS '${user_lit}'@'localhost' IDENTIFIED BY '${pass_lit}';
GRANT ALL PRIVILEGES ON \`${MYSQL_DB}\`.* TO '${user_lit}'@'127.0.0.1';
GRANT ALL PRIVILEGES ON \`${MYSQL_DB}\`.* TO '${user_lit}'@'localhost';
FLUSH PRIVILEGES;
SQL

export MYSQL_PWD="$MYSQL_PASSWORD"
table_count=$(mysql -h"$MYSQL_HOST" -P"$MYSQL_PORT" -u"$MYSQL_USER" -N -s "$MYSQL_DB" \
  -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE()")
if [ "$table_count" = "0" ]; then
  echo "==> [start] Empty database — loading baseline schema"
  bash "$REPO/scripts/bootstrap_local_db.sh"
else
  echo "==> [start] Database already has ${table_count} tables — skipping baseline load"
fi

echo "==> [start] Running migrations"
# shellcheck disable=SC1091
. "$REPO/.venv/bin/activate"
python -m scripts.migrate

echo "==> [start] done"
