# Handoff: Microsoft Graph Calendar Integration

**Date:** 2026-07-16
**Branch merged:** `staging` → `main` (fast-forward, 48 commits)
**Author:** Carlos Hernandez
**Reviewer:** Claude Code (code-review-engineer)

---

## What was built

A Microsoft Graph integration that lets inside-sales reps connect their Microsoft 365 account and manage calendar events directly inside the CRM.

### Backend (`api/graph.py` + `api/server.py`)
- **Token lifecycle** — PKCE auth flow extended with Graph scopes (`Mail.Send`, `Mail.Read`, `Calendars.ReadWrite`, `offline_access`). Tokens stored per-user in MySQL (`user_graph_tokens`). Auto-refresh via MSAL when within 5 minutes of expiry.
- **Endpoints added:**
  - `POST /api/auth/ms-graph-token` — stores Graph tokens from frontend PKCE callback
  - `GET /api/calendar/events?start=<iso>&end=<iso>` — lists calendar events (UTC enforced, pagination capped at 10 pages)
  - `POST /api/calendar/events` — creates a standalone calendar event with optional Teams meeting
  - `POST /api/leads/{lead_id}/schedule-meeting` — creates a calendar event and logs a `meeting_scheduled` lead action
- **Error types** — `GraphNotConnected` and `GraphTokenRefreshFailed` both subclass `ValueError`, so existing `_graph_call` handlers map them to HTTP 400 without modification.

### Frontend (`studio/src/`)
- `api/graph.ts` — typed API client for all three calendar endpoints
- `hooks/useCalendar.ts` — three React Query hooks: `useCalendarEvents`, `useCreateCalendarEvent`, `useScheduleMeeting`
- `views/inside-sales/components/CalendarTab.tsx` — tab entry point in lead detail panel
- `views/inside-sales/components/MeetingScheduler.tsx` — dialog for scheduling meetings; pre-fills property name and contact email
- `views/inside-sales/components/UpcomingMeetings.tsx` — 7-day window of upcoming meetings with Teams join links; "Connect Microsoft" empty state when Graph not connected

### Database
- `migrations/008_user_graph_tokens.sql` — `user_graph_tokens` table (FK cascade to `users`)

### Tests
- `tests/test_graph.py` — unit tests for `get_valid_token`, `list_events`, `create_event` (all HTTP mocked)
- `tests/test_graph_endpoints.py` — FastAPI endpoint tests for all three calendar routes
- `studio/src/test/api/graph.test.ts` — frontend happy-path tests

---

## What was fixed during review

**B1 (blocker — fixed before merge):** `tests/test_graph.py` imported `send_mail` which no longer exists in `api/graph.py`, causing `ImportError` at pytest collection time and blocking all calendar tests. Removed the stale import, the `_make_http_client_multi_post` helper, and three dead `test_send_mail_*` tests.

Commit: `d2385a2 fix(tests): remove stale send_mail import and dead tests from test_graph.py`

---

## Open issues — must fix before enabling for production users

### SECURITY — B2: OAuth tokens stored in plaintext (HIGH PRIORITY)

**What:** `access_token` and `refresh_token` are stored as plaintext columns in MySQL `user_graph_tokens`. These are bearer credentials to each user's full M365 mailbox and calendar.

**Fix:** GCP KMS envelope encryption. Full implementation instructions in the code review session. Summary:

1. Create KMS keyring + key:
   ```bash
   gcloud kms keyrings create juniper-crm --location=us-central1 --project=juniper-crm-498215-p5
   gcloud kms keys create graph-tokens --keyring=juniper-crm --location=us-central1 --purpose=encryption --project=juniper-crm-498215-p5
   ```
2. Grant Cloud Run service account `roles/cloudkms.cryptoKeyEncrypterDecrypter` on the key.
3. Add `google-cloud-kms>=2.21` to `requirements.txt`.
4. In `api/graph.py`: add `_encrypt()` / `_decrypt()` helpers using `google.cloud.kms`; call `_encrypt` in `_upsert_tokens` before writing, `_decrypt` in `get_valid_token` after reading.
5. Add `KMS_GRAPH_TOKEN_KEY=projects/juniper-crm-498215-p5/locations/us-central1/keyRings/juniper-crm/cryptoKeys/graph-tokens` to `--set-env-vars` in both `cloudbuild.yaml` and `cloudbuild.staging.yaml`.
6. **Migrate existing rows** before deploying — read each row, encrypt, write back. If deployed before migration, `_decrypt` will fail on old rows.

---

## Known gaps (non-blocking, track as follow-up)

| ID | Location | Issue |
|----|----------|-------|
| W1 | `api/server.py:store_ms_graph_token` | Incoming `scope` string is never validated. A user who declines `Calendars.ReadWrite` passes the connect step and fails later with a cryptic 502. Add a scope check and return 400 with "reconnect with calendar permission" if missing. |
| W2 | `api/graph.py:get_valid_token` | Token refresh has no DB-level lock. Two concurrent requests for an expired token will both call MSAL; Microsoft rotates refresh tokens (single-use), so the second call uses a consumed token. Fix: `SELECT ... FOR UPDATE` inside a transaction wrapping the refresh. |
| W3 | `studio/src/hooks/useCalendar.ts` | All 400s show "Connect your Microsoft account" toast. `GraphTokenRefreshFailed` (re-auth needed) and `GraphNotConnected` (first connect) look identical. Add a machine-readable `code` field to the 400 detail so the frontend can distinguish them. |
| W5 | `api/server.py:schedule_lead_meeting` | `create_event` fires (sends Teams invite) before `_record_lead_action` writes to DB. If the insert fails, the meeting is orphaned in the CRM. Add ERROR-level logging of the `event_id` on insert failure so orphans are recoverable. |

---

## Architecture notes

- **UTC everywhere:** `Prefer: outlook.timezone="UTC"` header sent on all `list_events` calls; `timeZone: "UTC"` set on `create_event`. Frontend appends `Z` to tz-less Graph datetime strings before parsing. Do not remove any of these — Graph returns local-time strings without a designator by default.
- **Pagination cap:** `_LIST_EVENTS_MAX_PAGES = 10` in `graph.py`. Prevents infinite loops on malformed nextLink responses. If the 7-day window ever returns >500 events (10 pages × 50 per page), results are silently truncated with a log warning. A `truncated: true` response field would be a cleaner signal.
- **`_graph_call` pattern:** Wraps Graph coroutines so `ValueError` (including `GraphNotConnected` / `GraphTokenRefreshFailed`) maps to HTTP 400. Graph HTTP errors map to 502. Do not catch `ValueError` at a higher scope — it would swallow non-Graph errors.
- **Migration files at repo root** (`migration_loader.py`, `migration_runner.py`, `inspect_azure_schema.py`, `migration.log`) are **untracked** (gitignored). They are one-time BigQuery → Cloud SQL migration artifacts that have already been run. Do not commit or push them.

---

## Deployment

Both `cloudbuild.yaml` (prod → `juniper-prod` Cloud SQL) and `cloudbuild.staging.yaml` (staging → `juniper-dev` Cloud SQL) are correctly configured for their environments. No `ENVIRONMENT` env var is read by the application — the value in `cloudbuild.staging.yaml` is inert.

`main` is currently **48 commits ahead of `origin/main`** and has not been pushed. Push when B2 (KMS encryption) is in place or after an explicit risk-acceptance decision.
