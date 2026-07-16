# 1. Use FullCalendar for the calendar UI

Date: 2026-07-14

## Status

Accepted

## Context

The CRM needs a time-grid calendar (week / 3-day / 1-day views — no month view) on a
new top-level page, with drag-to-create, drag-to-move, and event editing. The repo
already contains every building block for a custom grid: `date-fns` v4, `@dnd-kit`
(used by the pipeline kanban), Radix primitives, and Tailwind v4. A custom N-day
time-grid was therefore a genuine option — all three required views are the same
component with a `dayCount` prop, and month view (the painful part of custom
calendars) is out of scope.

Third-party candidates:

- **react-big-calendar** — a 3-day view requires a custom view class; SASS styling
  fights Tailwind; drag-drop is a clunky addon.
- **Schedule-X** — modern and MIT, but young; a 3-day view is not a first-class
  documented feature.
- **FullCalendar** — all three views are configuration
  (`views: { threeDay: { type: 'timeGrid', duration: { days: 3 } } }`); select-to-create
  and drag-to-move/resize ship in the MIT `interaction` plugin; premium licensing only
  covers views we don't use (timeline/resource); themeable via CSS variables.

## Decision

Use FullCalendar (`@fullcalendar/react`, `@fullcalendar/timegrid`,
`@fullcalendar/interaction`) rather than building a custom time-grid or adopting
another library.

## Consequences

- All three views plus drag interactions are configuration, not custom code — the
  largest chunks of bespoke UI work disappear.
- ~100 kB gzipped added to the bundle.
- Juniper styling (`#2E7D52` brand green, Tailwind-consistent borders/typography)
  must be applied through FullCalendar's CSS variables and class hooks rather than
  plain Tailwind classes.
- The grid renders in the browser's local timezone only. This is deliberate: a
  grid-level timezone switcher would require `@fullcalendar/moment-timezone` (which
  drags in moment). Timezone selection lives in the event form instead, using
  `@date-fns/tz`.
- Replacing the library later means rebuilding the grid, but the surrounding
  architecture (hooks, API client, event form, detail popover) is
  library-independent.
