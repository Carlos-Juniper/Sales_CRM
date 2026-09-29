#!/usr/bin/env bash
# Rewrite the JSON files in this directory from a running commissions API.
# See README.md for the seed those responses came from.
set -euo pipefail
cd "$(dirname "$0")"

: "${BASE_URL:?Set BASE_URL to the API origin, for example http://127.0.0.1:8000}"
: "${COOKIE:?Set COOKIE to the session cookie, for example session=...}"

fetch() {
  local path="$1"
  local dest="$2"
  curl -fsS -H "Cookie: ${COOKIE}" "${BASE_URL}${path}" | python3 -m json.tool > "${dest}"
}

fetch "/api/commissions/reps" reps.json
fetch "/api/commissions/summary?user_id=rep-alex&start_date=2026-01-01&end_date=2026-09-25" summary-alex.json
fetch "/api/commissions/summary?user_id=rep-cady&start_date=2026-01-01&end_date=2026-09-25" summary-cady.json
fetch "/api/commissions/list?user_id=rep-alex&start_date=2026-01-01&end_date=2026-09-25" list-alex.json
fetch "/api/commissions/list?user_id=rep-cady&start_date=2026-01-01&end_date=2026-09-25" list-cady.json
fetch "/api/commissions/payout-schedule?user_id=rep-alex&start_date=2026-01-01&end_date=2026-12-31" schedule-alex.json
fetch "/api/commissions/payout-schedule?user_id=rep-cady&start_date=2026-01-01&end_date=2026-12-31" schedule-cady.json
