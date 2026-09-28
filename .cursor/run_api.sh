#!/usr/bin/env bash
# FastAPI dev server for the Cloud Agent "API" terminal.
# Database startup lives in .cursor/start.sh (the environment start step).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

set -a
# shellcheck disable=SC1091
. .cursor/dev.env
set +a

# shellcheck disable=SC1091
. .venv/bin/activate
exec uvicorn api.server:app --host 0.0.0.0 --port 8000 --reload
