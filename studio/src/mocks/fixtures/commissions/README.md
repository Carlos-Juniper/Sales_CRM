# Commission fixtures

Static JSON for the MSW commission handlers. The handlers return these files as-is. They do not filter by date, status, or estimate type, and they do not recompute buckets or `payable`.

The amounts, dates, and check labels were captured from `GET /api/commissions/*` on 2026-09-25 after migrations 065 and 066. This checkout's database has no cadence tables and no seeded deals, so `capture.sh` against `da580a6` could not refresh them. The JSON was aligned by hand to that API: `payable` stays true on a paid row with a known amount, list rows include `payout_period` and `payout_period_label`, `next_payout` includes `payout_period_label` and `bucket`, and schedule `year` is null because the request sends both close dates and omits `year`.

`balances_period_filtered` is not part of the summary fixture.

## Regenerate

Run the API from `cursor/commission-cadence-structure-610e` against the seeded database, then:

```bash
BASE_URL=http://127.0.0.1:8000 COOKIE='session=...' ./capture.sh
```

`COOKIE` is the `session` cookie for an admin user. The script writes the seven JSON files in this directory. `da580a6` already returns `payable`, `bucket`, `payout_period`, and `payout_period_label`, and it omits `balances_period_filtered`. A capture from that API replaces these files with those shapes.
