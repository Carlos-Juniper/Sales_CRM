# Commission fixtures

Static JSON captured from `GET /api/commissions/*` on 2026-09-25 after migrations 065 and 066. The MSW handlers serve these files. They do not recompute payout buckets.

`summary-*.json` and `list-*.json` are returned as captured, including when the page sends a later year's dates. That keeps Closed this year at $1,250.00 in tests. `schedule-alex.json` is the full 2026 schedule. The payout-schedule handler drops quarters whose seeded close date falls outside `start_date` / `end_date`.

## Regenerate

Run the API from `cursor/commission-cadence-structure-610e` against the seeded database, then:

```bash
BASE_URL=http://127.0.0.1:8000 COOKIE='session=...' ./capture.sh
```

`COOKIE` is the `session` cookie for an admin user. The script writes the seven JSON files in this directory. Capture `schedule-alex.json` with a window that includes every 2026 Alex deal (the script uses 2026-01-01 through 2026-12-31) so the mock can slice that snapshot.
