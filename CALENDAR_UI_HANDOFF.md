# Calendar UI — Implementation Handoff

**Status:** Ready for implementation
**Date:** 2026-07-14
**Audience:** A frontend (React) implementation agent + a small backend workstream.
Every design decision below was resolved with the product owner — do not re-litigate
them; open questions are listed explicitly at the end.

---

## 1. Summary

Build a full-featured calendar page for the Juniper CRM (Sales Studio). The backend
already integrates Microsoft Graph (token storage/refresh, list + create event); the
frontend has only a lightweight list (`UpcomingMeetings`) and a basic scheduling modal
(`MeetingScheduler`) inside the lead detail panel. This work adds:

- A **new top-level calendar page** at `/inside-sales/calendar` (FullCalendar time-grid)
- **Week (default) / 3-day / 1-day views** — no month view. Mobile defaults to 1-day.
- **Event create / edit / delete** with drag-to-create and drag-to-move
- **Two new backend endpoints** (PATCH + DELETE event) and a `meeting_cancelled` lead action
- **Attendee email-chip input**, form-level timezone selector, and client-side conflict warnings

See `CONTEXT.md` (§ Calendar) for canonical domain terms and
`docs/adr/0001-fullcalendar-for-calendar-ui.md` for the library decision.

---

## 2. Decision log (resolved with product owner)

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Views: **week (default), 3-day, 1-day** toggles; no month view. Mobile (< 768 px) defaults to 1-day. | Reps schedule in time-slots; month adds no value. |
| 2 | **Personal calendar** — the rep's full Microsoft calendar, incl. non-CRM Outlook events. Lead-scoped scheduling stays in the lead detail panel. | Reps need their whole schedule to avoid conflicts. |
| 3 | **New top-level page** `/inside-sales/calendar` with a sidebar nav entry. Lead panel `CalendarTab` remains. | Time-grid needs full-viewport space; mobile needs a routable page. |
| 4 | **FullCalendar** (`@fullcalendar/react` + `timegrid` + `interaction`, all MIT). | 3-day view is pure config; drag interactions free. See ADR-0001. |
| 5 | **Backend in scope:** `PATCH` + `DELETE /api/calendar/events/{id}`, plus `meeting_cancelled` lead action on delete of a lead-linked event. | Edit/drag-move/delete are required; endpoints are thin wrappers over Graph. |
| 6 | **Timezone:** grid always renders browser-local with a zone label (e.g. "Times shown in EDT"). Timezone **dropdown on the event form only** (ET/CT/MT/PT, default = browser zone), converts to UTC on submit via `@date-fns/tz`. No grid-level switcher, no moment-timezone. | Org spans TX/PA/FL/NC — cross-zone *entry* matters; cross-zone *viewing* doesn't. |
| 7 | **Edit/delete only when `isOrganizer === true`.** Attendee events are read-only (detail popover + "Open in Outlook" via `webLink`). | Graph rejects attendee edits; avoid guaranteed 4xx confusion. |
| 8 | **Recurring events: single-occurrence edit/delete only** in v1, with an "applies to this occurrence only" note and the `webLink` escape hatch for series changes. | Series editing is a messy Graph dance; defer. |
| 9 | **Conflict detection: client-side, rep's own calendar only, warn-never-block.** Conflict = proposed `[start, end)` overlaps an existing event, excluding `showAs === 'free'` and cancelled events. Inline amber warning; submit stays enabled. | Attendees are almost always external — their calendars are unreadable regardless of scope. Double-booking is sometimes deliberate. |
| 10 | **Attendees: email chip input.** From a lead → lead's `contact_email` pre-chipped (visible, removable). From calendar page → empty. Additional emails can always be typed in either flow. | Backend already takes `list[str]`; contacts are external. |
| 11 | **Calendar-page creation makes a plain event (no lead link)** in v1. Rule: *calendar page = personal schedule; lead panel = lead workflow.* | Lead picker on the calendar form is real scope for a convenience path. |
| 12 | Testing bar matches existing repo patterns (see §8). | — |

### Explicitly out of scope (v1) — record as Phase 2 backlog

- CRM contact picker (search PM Contacts / lead contacts by name) layered on the chip input
- Optional "link to lead" picker on calendar-page event creation
- Recurring series editing; decline/accept invitation actions
- Attendee availability lookup (`getSchedule` / `findMeetingTimes` — new Graph scope, tenant-internal only)
- Grid-level timezone switcher; month view

---

## 3. Current state (what exists)

### Backend — `api/graph.py`, `api/server.py`

| Piece | Location | Notes |
|---|---|---|
| Token store + auto-refresh | `api/graph.py` — `get_valid_token()` | Refreshes via MSAL within 5-min buffer. Scopes: `Mail.Send, Mail.Read, Calendars.ReadWrite, offline_access`. |
| `GraphNotConnected` / `GraphTokenRefreshFailed` | `api/graph.py` | Subclass `ValueError` → `_graph_call()` maps to HTTP 400. |
| `list_events()` | `api/graph.py` | `GET /me/calendarView`, `Prefer: outlook.timezone="UTC"`, paginates `@odata.nextLink` (10-page cap), `$top=50`. Returns **raw Graph event dicts**. |
| `create_event()` | `api/graph.py` | `POST /me/events`, UTC datetimes, optional Teams `onlineMeeting`. |
| `GET /api/calendar/events?start&end` | `api/server.py` | Auth via `require_auth`. |
| `POST /api/calendar/events` | `api/server.py` | Body: `CalendarEventCreateBody`. |
| `POST /api/leads/{id}/schedule-meeting` | `api/server.py` | Creates event **and** records `meeting_scheduled` lead action with `external_message_id = event.id`. |
| `_record_lead_action()` | `api/server.py` (~line 487) | Inserts into `lead_actions`. |
| Activity feed filter | `api/server.py` — `_ACTION_TO_CHANNEL_FULL` | Only `note_added` and `meeting_scheduled` currently surface in `/api/leads/{id}/activity`. |

Error convention: Graph HTTP failures → 502; not-connected / refresh-failed → 400
(frontend shows "Connect your Microsoft account…").

### Frontend — `studio/src/`

| Piece | Location | Notes |
|---|---|---|
| Types | `types/index.ts` | `CalendarEvent`, `CalendarEventCreatePayload`, `ScheduleMeetingPayload`. **Missing fields needed for v1** (see §5.1). |
| API client | `api/graph.ts` | `listEvents`, `createEvent`, `scheduleMeeting`. |
| Hooks | `hooks/useCalendar.ts` | `useCalendarEvents(start,end,enabled)` (staleTime 60 s, retry false), `useCreateCalendarEvent`, `useScheduleMeeting`. Query key: `['calendar', start, end]`. |
| Lead panel UI | `views/inside-sales/components/` | `CalendarTab.tsx`, `MeetingScheduler.tsx` (modal; silently attaches `lead.contact_email`), `UpcomingMeetings.tsx` (7-day list; normalizes Graph's bare UTC datetimes by appending `Z`). |
| Routing / nav | `router.tsx`, `components/layout/Sidebar.tsx` | Flat routes under `/inside-sales/*` wrapped in `InsideSalesGuard`; `navItems` array drives the sidebar (roles: `inside_sales`, `manager`). |
| Stack | `package.json` | React 19, React Router 7, TanStack Query 5, Zustand, Tailwind 4, Radix, `date-fns` 4, `@dnd-kit`, lucide-react, MSW 2, Vitest, Playwright. |
| Brand | — | Juniper green `#2E7D52` (hover `#256644`); sidebar CSS vars in `Sidebar.tsx`. |

**Gotcha inherited from Graph:** with `Prefer: outlook.timezone="UTC"`, event
start/end come back **without** a timezone designator (e.g.
`2026-06-27T10:00:00.0000000`). Any parsing must normalize by appending `Z` when no
offset is present — see `formatEventTime()` in `UpcomingMeetings.tsx:6-25` for the
existing reference implementation. Centralize this in a shared util (§5.4).

---

## 4. Backend workstream

### 4.1 `api/graph.py` — two new functions (mirror `create_event` exactly: `get_valid_token`, httpx, 15 s timeout, 502 mapping)

```python
async def update_event(user_id, event_id, *, subject=None, start_iso=None,
                       end_iso=None, attendees=None, body=None) -> dict:
    # PATCH {_GRAPH_BASE}/me/events/{event_id}
    # Build payload ONLY from non-None kwargs:
    #   subject → "subject"
    #   start_iso → {"start": {"dateTime": start_iso, "timeZone": "UTC"}}   (same for end)
    #   attendees → same mapping as create_event
    #   body → {"body": {"contentType": "HTML", "content": body}}
    # Return resp.json() (Graph returns the updated event).

async def delete_event(user_id, event_id) -> None:
    # DELETE {_GRAPH_BASE}/me/events/{event_id} — expect 204.
    # Treat 404 as success (idempotent delete), other 4xx/5xx → HTTPException 502.
```

### 4.2 `api/server.py` — two new routes (follow the existing `calendar_*` pattern + `_graph_call`)

```
PATCH  /api/calendar/events/{event_id}
  Body model CalendarEventUpdateBody: all fields optional —
    subject: str | None, start_iso: str | None, end_iso: str | None,
    attendees: list[str] | None, body: str | None
  → returns updated raw Graph event dict

DELETE /api/calendar/events/{event_id}   → 204
  After successful Graph delete:
    row = SELECT lead_id, detail FROM lead_actions
          WHERE external_message_id = %s AND action_type = 'meeting_scheduled' LIMIT 1
    if row: _record_lead_action(lead_id=row.lead_id, action_type='meeting_cancelled',
                                detail=row.detail, performed_by=user['id'],
                                external_message_id=event_id)
```

### 4.3 Activity feed

Add `"meeting_cancelled": "meeting"` to `_ACTION_TO_CHANNEL_FULL` in `server.py` so
cancellations appear in the lead activity timeline. Frontend `ActivityItem` rendering
already keys off `channel`; if the timeline should visually distinguish
scheduled-vs-cancelled, thread `action_type` through — otherwise the `detail` string
(meeting subject) suffices for v1.

### 4.4 Backend tests (pytest — mirror `tests/test_graph_endpoints.py` style)

- PATCH/DELETE require auth (401/403 unauthenticated)
- 400 when Graph not connected (`GraphNotConnected` path)
- 502 when Graph returns an error status
- PATCH sends only provided fields (partial payload assertion against the mocked httpx call)
- DELETE records `meeting_cancelled` when a matching `meeting_scheduled` action exists; no action row otherwise
- DELETE returns 204 on Graph 404 (idempotency)

---

## 5. Frontend workstream

### 5.0 New dependencies

```
@fullcalendar/react  @fullcalendar/core  @fullcalendar/timegrid  @fullcalendar/interaction
@date-fns/tz
```

### 5.1 Types — `types/index.ts`

Extend `CalendarEvent` with the Graph fields v1 relies on (all returned by
`calendarView` by default — no backend change needed):

```ts
export interface CalendarEvent {
  // ...existing fields...
  isOrganizer?: boolean
  type?: 'singleInstance' | 'occurrence' | 'exception' | 'seriesMaster'
  seriesMasterId?: string | null
  showAs?: 'free' | 'tentative' | 'busy' | 'oof' | 'workingElsewhere' | 'unknown'
  isCancelled?: boolean
}

export interface CalendarEventUpdatePayload {
  subject?: string
  start_iso?: string
  end_iso?: string
  attendees?: string[]
  body?: string
}
```

### 5.2 API client — `api/graph.ts`

```ts
updateEvent(eventId: string, payload: CalendarEventUpdatePayload) →
  apiClient.patch<CalendarEvent>(`/calendar/events/${eventId}`, payload)
deleteEvent(eventId: string) →
  apiClient.delete(`/calendar/events/${eventId}`)
```

(Check `api/client.ts` for existing `patch`/`delete` helpers; add if missing,
following its `get`/`post` implementations.)

### 5.3 Hooks — `hooks/useCalendar.ts`

- `useUpdateCalendarEvent()` — mutation; on success invalidate `[CALENDAR_KEY]`,
  toast "Meeting updated". Same 400 → "Connect your Microsoft account…" error
  mapping as the existing mutations.
- `useDeleteCalendarEvent()` — mutation; on success invalidate `[CALENDAR_KEY]`
  **and** `['activity']` (cancellation may add a lead action), toast "Meeting deleted".
- Drag-to-move UX: use optimistic update (`onMutate` cache patch, rollback in
  `onError`) so the event doesn't snap back while the PATCH is in flight.

### 5.4 Shared utils

- `lib/graphDates.ts` — `parseGraphDate(iso: string): Date` (append `Z` when no
  tz designator — lift the regex from `UpcomingMeetings.tsx`), plus
  `toUtcIso(wallClock: string, tz: string): string` using `@date-fns/tz` (`TZDate`).
  Refactor `UpcomingMeetings.tsx` to consume it.
- `lib/calendarConflicts.ts` — **pure function**, the most test-worthy code in the feature:

  ```ts
  findConflicts(
    proposed: { start: Date; end: Date },
    events: CalendarEvent[],
    excludeEventId?: string,          // ignore self when editing
  ): CalendarEvent[]
  // overlap: proposed.start < event.end && event.start < proposed.end
  // skip: showAs === 'free', isCancelled, id === excludeEventId
  ```

- `lib/timezones.ts` — the four selectable zones:
  `America/New_York`, `America/Chicago`, `America/Denver`, `America/Los_Angeles`,
  labeled ET/CT/MT/PT; helper to resolve the browser default
  (`Intl.DateTimeFormat().resolvedOptions().timeZone`) to the nearest listed zone.

### 5.5 Components

```
views/inside-sales/CalendarPage.tsx            — page shell: header, view toggle, zone label
views/inside-sales/components/calendar/
  CalendarGrid.tsx                             — FullCalendar wrapper (see config below)
  EventFormDialog.tsx                          — create + edit (shared), Radix Dialog
  EventDetailPopover.tsx                       — click event → details (Radix Popover)
  AttendeeChipInput.tsx                        — email chips
  ConflictWarning.tsx                          — amber inline notice
```

**CalendarGrid.tsx — FullCalendar config:**

```ts
plugins: [timeGridPlugin, interactionPlugin]
initialView: isMobile ? 'timeGridDay' : 'timeGridWeek'   // isMobile: matchMedia('(max-width: 767px)') at mount
views: { threeDay: { type: 'timeGrid', duration: { days: 3 } } }
headerToolbar: false        // build our own header with the existing Button/Tabs components
selectable: true            // drag/click empty slot → open EventFormDialog prefilled
editable: true              // drag-to-move / resize
eventAllow: (_, event) => event.extendedProps.isOrganizer === true   // attendee events immovable
eventDrop / eventResize: → useUpdateCalendarEvent (optimistic)
eventClick: → EventDetailPopover
nowIndicator: true
slotMinTime '06:00' / slotMaxTime '20:00' (scrollable beyond via scrollTime)
height: '100%'
```

Data feed: derive visible range from FullCalendar's `datesSet` callback →
`useCalendarEvents(rangeStartIso, rangeEndIso)` (keeps the existing
`['calendar', start, end]` key shape). Map `CalendarEvent` → FullCalendar
`EventInput` using `parseGraphDate`; stash the raw event in `extendedProps`.
Style: brand green `#2E7D52` for organizer events; muted gray for attendee-only
events; theme via FullCalendar CSS vars (`--fc-*`) in a `calendar.css`.

**EventFormDialog.tsx** (create + edit):

- Fields: subject (required), date, start/end time, timezone select (default browser
  zone; §5.4), `AttendeeChipInput`, optional body textarea, "Teams meeting" switch
  (default on — matches current `MeetingScheduler` behavior).
- On change of date/time/zone → run `findConflicts` against the loaded events cache →
  render `ConflictWarning` ("Overlaps with 'Site visit — Palm Grove HOA' (10:00–11:00)").
  Submit stays enabled.
- Edit mode: prefill from event; if `type === 'occurrence' || type === 'exception'`,
  show note *"This event repeats — changes apply to this occurrence only."*
- Validation: end > start; chip emails match a standard email regex before chip-ify.

**EventDetailPopover.tsx:**

- Subject, formatted time range, attendee list, Teams join button
  (`onlineMeeting.joinUrl`), "Open in Outlook" (`webLink`, new tab).
- If `isOrganizer`: Edit (→ EventFormDialog) and Delete (→ confirm dialog →
  `useDeleteCalendarEvent`) buttons. Otherwise read-only.

**AttendeeChipInput.tsx:**

- Controlled `string[]`; Enter/comma/blur commits a chip after email validation;
  × removes; invalid input shows inline error, not a chip.

### 5.6 Routing + nav

- `router.tsx`: add `{ path: 'inside-sales/calendar', element: <InsideSalesGuard><CalendarPage /></InsideSalesGuard> }`
  and export `CalendarPage` from `views/inside-sales/index.tsx`.
- `Sidebar.tsx` `navItems`: `{ label: 'Calendar', icon: Calendar /* lucide */, href: '/inside-sales/calendar', roles: ['inside_sales', 'manager'] }`
  — placed after 'Pipeline'.

### 5.7 MeetingScheduler upgrade (lead panel)

Refactor `MeetingScheduler.tsx` to reuse `EventFormDialog` in "lead mode":

- Lead's `contact_email` arrives **pre-chipped and visible** (removable) instead of
  today's silent attach; additional emails addable.
- Gains the timezone select and conflict warning for free.
- Submit routes to `useScheduleMeeting(lead.id)` (unchanged endpoint) rather than
  `useCreateCalendarEvent`.
- `CalendarTab`/`UpcomingMeetings` otherwise unchanged; optionally add a
  "View full calendar →" link to `/inside-sales/calendar`.

### 5.8 Data flow

```
CalendarPage
 └─ CalendarGrid (FullCalendar)
     ├─ datesSet ──────────────► useCalendarEvents(start,end) ──► GET /api/calendar/events
     ├─ select (empty slot) ───► EventFormDialog (create) ──► useCreateCalendarEvent ──► POST /api/calendar/events
     ├─ eventDrop/eventResize ─► useUpdateCalendarEvent (optimistic) ──► PATCH /api/calendar/events/{id}
     └─ eventClick ────────────► EventDetailPopover
                                   ├─ Edit ──► EventFormDialog (edit) ──► PATCH …
                                   └─ Delete ─► confirm ──► useDeleteCalendarEvent ──► DELETE …
                                                                (backend records meeting_cancelled if lead-linked)
LeadDetailPanel ► CalendarTab ► MeetingScheduler(EventFormDialog, lead mode)
                                   └─► useScheduleMeeting ──► POST /api/leads/{id}/schedule-meeting
All mutations invalidate ['calendar']; delete also invalidates ['activity'].
Timezone: form wall-clock + selected zone ──toUtcIso──► UTC on the wire ──parseGraphDate──► browser-local render.
```

---

## 6. Error / empty states (match existing patterns)

- **Graph not connected (400):** grid area shows the existing dashed-border empty
  state ("Connect your Microsoft account to see your calendar") with a link to
  `/inside-sales/settings/connections`. Mutations already toast the connect message.
- **Graph 502:** toast "Could not load calendar" + retry button; keep last cached events visible.
- **Loading:** skeleton grid (pulse blocks), matching `LoadingSkeleton` conventions.
- **Attendee-event edit attempts:** prevented in UI (no buttons, `eventAllow` blocks drag) — never let the 4xx happen.

---

## 7. Acceptance criteria

**Views & navigation**
- [ ] "Calendar" appears in the sidebar for `inside_sales` and `manager` roles; route `/inside-sales/calendar` renders behind `InsideSalesGuard`
- [ ] Week view default on desktop; toggle switches Week / 3-day / Day; selection survives navigation within the session
- [ ] Viewport < 768 px initially renders 1-day view
- [ ] Header shows current-timezone label (e.g. "Times shown in EDT"); today has a now-indicator line

**Events display**
- [ ] All events in the visible range render at correct local times (incl. Graph's no-designator UTC strings)
- [ ] Organizer events use brand green; attendee-only events visually muted
- [ ] Overlapping events render side-by-side

**Create**
- [ ] Click/drag an empty slot opens the form prefilled with that slot
- [ ] Subject required; end must be after start; invalid attendee emails cannot become chips
- [ ] Timezone select defaults to browser zone; picking CT for a 10:00 meeting stores 15:00/16:00 UTC (DST-aware via `@date-fns/tz`)
- [ ] Conflict with a busy event shows the amber warning naming the conflicting event; submit remains enabled; `showAs: 'free'` events trigger no warning
- [ ] Created event appears without manual refresh (cache invalidation)

**Edit / delete**
- [ ] Organizer events: drag-to-move and resize persist via PATCH (optimistic, rolls back on failure); edit dialog saves changed fields only
- [ ] Attendee events: no edit/delete affordances; not draggable; popover shows details + join + Outlook links
- [ ] Recurring occurrence edit shows the "this occurrence only" note; changes affect only that occurrence
- [ ] Delete requires confirmation; deleting a lead-linked event records `meeting_cancelled` visible in that lead's activity feed
- [ ] DELETE of an already-deleted event does not error (idempotent)

**Lead workflow**
- [ ] Scheduling from a lead pre-chips the lead's contact email (visible, removable); more emails addable
- [ ] Lead-scheduled meetings still record `meeting_scheduled` and appear in the activity feed

**Quality gates**
- [ ] `npm run lint`, `npm run test`, `tsc -b` clean; backend `pytest` clean
- [ ] Playwright smoke: open calendar → toggle views → create event → verify render → delete

---

## 8. Testing strategy (agreed)

| Layer | Scope |
|---|---|
| pytest | §4.4 list |
| Vitest + MSW | New MSW handlers for PATCH/DELETE in `mocks/handlers.ts`; hook tests for update/delete mutations (invalidation, optimistic rollback, error toasts) mirroring `test/hooks/useBids.test.ts` style |
| Vitest (pure) | `calendarConflicts` (boundary-touching events don't conflict; free/cancelled/self excluded; partial + containing overlaps do), `graphDates` (designator-less normalization, DST conversions for all four zones) |
| RTL component | `EventFormDialog` (validation, chips, conflict warning, timezone default), `AttendeeChipInput`, `EventDetailPopover` (organizer vs attendee affordances). **Do not** unit-test the FullCalendar grid internals in jsdom — trust the library |
| Playwright | Single smoke flow per acceptance criteria; add to existing `e2e/` |

---

## 9. Estimated effort

| Workstream | Estimate |
|---|---|
| Backend: `update_event`/`delete_event`, routes, `meeting_cancelled`, activity-map, pytest | 1–1.5 days |
| Frontend: page, grid, FullCalendar theming, view toggles, mobile default | 2 days |
| Frontend: EventFormDialog + chips + timezone + conflicts; detail popover; delete flow | 2 days |
| Frontend: MeetingScheduler refactor to shared dialog | 0.5 day |
| Tests (Vitest/RTL/MSW + Playwright smoke) + polish | 1.5–2 days |
| **Total (single engineer)** | **~7–8 working days** |

Suggested sequencing: backend endpoints first (frontend drag-move depends on PATCH),
then grid read-only, then create, then edit/delete, then MeetingScheduler refactor.

---

## 10. Known open items (minor — implementer's discretion)

- Exact placement of the view toggle (header tabs vs dropdown) — use existing `Tabs` component
- Whether the lead activity timeline visually distinguishes cancelled meetings beyond the detail text (§4.3)
- `slotMinTime`/`slotMaxTime` bounds (06:00–20:00 suggested; grid remains scrollable)
