#!/usr/bin/env bash
# Load the baseline snapshot in sql/create_table/ into an empty local database.
#
# .cursor/start.sh calls this only when the database has no tables, then runs
# python -m scripts.migrate on every boot. This script does not apply numbered
# migrations and does not record schema_migrations rows.
#
# Files are loaded from a glob, not a hard-coded list. *_migration.sql is last:
# those ALTER scripts target databases created before the same columns were
# added to the CREATE files. On a fresh load they raise duplicate-column/key
# errors, which are ignored. Any other mysql error fails the script.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

: "${MYSQL_HOST:?MYSQL_HOST is required (sourced from .cursor/dev.env)}"
: "${MYSQL_PORT:?MYSQL_PORT is required (sourced from .cursor/dev.env)}"
: "${MYSQL_USER:?MYSQL_USER is required (sourced from .cursor/dev.env)}"
: "${MYSQL_PASSWORD:?MYSQL_PASSWORD is required (sourced from .cursor/dev.env)}"
: "${MYSQL_DB:?MYSQL_DB is required (sourced from .cursor/dev.env)}"

export MYSQL_PWD="$MYSQL_PASSWORD"

shopt -s nullglob
creates=()
alters=()
for f in sql/create_table/*.sql; do
  case "$(basename "$f")" in
    *_migration.sql) alters+=("$f") ;;
    *) creates+=("$f") ;;
  esac
done

if [ "${#creates[@]}" -eq 0 ] && [ "${#alters[@]}" -eq 0 ]; then
  echo "ERROR: no files in sql/create_table/" >&2
  exit 1
fi

echo "==> [bootstrap] CREATE files (${#creates[@]}), then *_migration.sql (${#alters[@]})"

# Return 0 when a mysql ERROR line is the documented fresh-load duplicate.
is_benign_duplicate() {
  case "$1" in
    *"Duplicate column name"*|*"Duplicate key name"*|*"check that column/key exists"*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

# mode is "strict" or "tolerate-duplicates".
# mysql --force is required only for tolerate-duplicates so one benign
# duplicate does not skip the rest of the batch. The exit status and the
# ERROR lines are both checked; unexpected errors still fail.
run_batch() {
  local mode="$1"
  shift
  local files=("$@")
  if [ "${#files[@]}" -eq 0 ]; then
    return 0
  fi

  local sql out status line unexpected
  sql=$(mktemp)
  out=$(mktemp)
  {
    echo "SET FOREIGN_KEY_CHECKS=0;"
    local f
    for f in "${files[@]}"; do
      echo "-- ${f}"
      cat "$f"
      printf '\n;\n'
    done
    echo "SET FOREIGN_KEY_CHECKS=1;"
  } >"$sql"

  set +e
  if [ "$mode" = "tolerate-duplicates" ]; then
    mysql -h"$MYSQL_HOST" -P"$MYSQL_PORT" -u"$MYSQL_USER" --force "$MYSQL_DB" <"$sql" >"$out" 2>&1
  else
    mysql -h"$MYSQL_HOST" -P"$MYSQL_PORT" -u"$MYSQL_USER" "$MYSQL_DB" <"$sql" >"$out" 2>&1
  fi
  status=$?
  set -e

  unexpected=0
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      *"ERROR "[0-9]*)
        if [ "$mode" = "tolerate-duplicates" ] && is_benign_duplicate "$line"; then
          echo "==> [bootstrap] ignoring benign duplicate: $line"
        else
          echo "$line" >&2
          unexpected=1
        fi
        ;;
      "")
        ;;
      *)
        # Keep client warnings (including MYSQL_PWD deprecation) visible.
        echo "$line" >&2
        ;;
    esac
  done <"$out"

  rm -f "$sql" "$out"

  if [ "$status" -ne 0 ]; then
    echo "ERROR: mysql failed while loading baseline schema (exit ${status})" >&2
    return "$status"
  fi
  if [ "$unexpected" -ne 0 ]; then
    echo "ERROR: baseline schema load reported an unexpected mysql error" >&2
    return 1
  fi
}

run_batch strict "${creates[@]}"
run_batch tolerate-duplicates "${alters[@]}"

echo "==> [bootstrap] done"
