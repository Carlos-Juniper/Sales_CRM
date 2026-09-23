#!/usr/bin/env bash
# Cloud Agent install phase — idempotent environment bootstrap.
#
# Runs from the repo root after checkout (and whenever dependencies are
# refreshed). Installs the system packages the stack needs (MariaDB server,
# a Python venv module, and the Playwright browser + its OS libraries), then
# the Python and Node dependencies. Every step is idempotent, so re-running is
# safe and fast once things are already present.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

echo "==> [install] System packages (MariaDB, python venv, build tools)"
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -qq
sudo apt-get install -y -qq \
  mariadb-server mariadb-client \
  python3-venv python3-dev \
  build-essential curl git

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
# --with-deps installs the browser and its OS libraries. Cached under
# ~/.cache/ms-playwright, so this is fast once already present.
python -m playwright install --with-deps chromium

echo "==> [install] Frontend (studio) dependencies"
cd "$REPO/studio"
npm ci

echo "==> [install] done"
