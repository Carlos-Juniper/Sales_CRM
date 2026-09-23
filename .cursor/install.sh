#!/usr/bin/env bash
# Cloud Agent install phase — idempotent repository bootstrap.
#
# Runs after the repo is checked out. Refreshes Python and Node dependencies
# and ensures the Playwright Chromium browser is present. System packages
# (mariadb-server, python venv, Playwright OS libs) come from the base image
# snapshot, so this script only deals with repo-derived state.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

echo "==> [install] Python virtualenv + dependencies"
if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
. .venv/bin/activate
python -m pip install --upgrade pip
# pymysql: sync driver used by scripts/migrate.py. pytest*: backend test suite.
python -m pip install -r requirements.txt pymysql pytest pytest-asyncio

echo "==> [install] Playwright Chromium (used for proposal PDF rendering)"
# Browser binaries are cached under ~/.cache/ms-playwright; this is a fast no-op
# when they are already present in the snapshot.
python -m playwright install chromium

echo "==> [install] Frontend (studio) dependencies"
cd "$REPO/studio"
npm ci

echo "==> [install] done"
