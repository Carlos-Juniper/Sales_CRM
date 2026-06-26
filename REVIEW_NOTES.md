# Code Review Notes — feat/comms-shared

Findings from post-commit code review. Critical and Important items were fixed before the follow-up commit. Minor items are documented here for awareness.

---

## Fixed in follow-up commit

| Finding | Fix |
|---------|-----|
| **C2** — `contact_id` never passed to `assert_can_contact()` from the compliance check endpoint | Added `contact_id: str \| None = Query(None)` to `GET /api/compliance/check` and threaded it through |
| **C3** — `GET /api/contacts/{id}/consent` returned a raw BigQuery Row object, not a dict | Changed `return rows[0]` → `return dict(rows[0])` |
| **I1** — Unknown channel silently allowed contact (e.g. `channel="carrier_pigeon"`) | Added `_VALID_CHANNELS` frozenset and raises `HTTPException(400)` for unrecognised channels |
| **I2** — No test covering unknown channel behaviour | Added `test_unknown_channel_raises_400`, `test_note_channel_always_allowed`, `test_meeting_channel_always_allowed`, `test_linkedin_channel_always_allowed` |
| **I3** — `ConnectionsPage` existed but was not in the router | Added route `inside-sales/settings/connections` to `studio/src/router.tsx` |
| **I4** — `useContactConsent` / `usePatchConsent` hooks had no consuming UI | Created `ConsentBadge.tsx`; wired into `ConversationPane` header using `lead.contact_id`; added `contact_id?: string \| null` to `Lead` interface |

---

## Open minor items

### m1 — Dead `Bubble.tsx` import risk
**File:** `studio/src/views/inside-sales/components/outreach/ConversationPane.tsx`  
`ConversationPane` was refactored to use `ActivityBubble` instead of the old `Bubble` component. Verify that no other file still imports `Bubble.tsx` and that the old file can be deleted if it's now unreferenced. The refactor in this branch removes the import correctly, but `Bubble.tsx` itself was not deleted (it may still be in use elsewhere or may be safely removable).

**Action:** Run `grep -r "from.*Bubble'" studio/src --include='*.tsx'` before deleting.

### m2 — `email` parameter accepted but unused in `assert_can_contact`
**File:** `api/compliance.py:23`  
The `email` keyword argument exists in the signature (matching the spec contract for future CAN-SPAM email suppression) but no check currently uses it. There is no email-based DNC table in migration 007.

**Action:** When the email suppression list is implemented (a separate task), add a check analogous to the `dnc_numbers` check for the `email` channel. Until then, the parameter is a no-op placeholder — this is intentional and the function docstring now notes it.

---

## Architecture note — C1

The compliance guard (`assert_can_contact`) is defined in this branch and is the source of truth. The actual send endpoints (Graph email, Twilio call/SMS) live in `feat/graph-integration` and `feat/telephony-twilio` — those branches are responsible for calling the guard before initiating any send. The usage pattern is documented in the `api/compliance.py` module docstring.

This branch cannot enforce that downstream branches call the guard, but the `/api/compliance/check` endpoint now fully exercises the guard (including `contact_id`) so it can be used for pre-flight checks from the frontend before the send button is activated.
