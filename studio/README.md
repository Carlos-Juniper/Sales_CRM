# Sales & Estimating Studio — Juniper Landscaping

End-to-end business development and proposal platform. From automated lead discovery through signed proposal and job creation handoff.

---

## Quick start

```bash
cd studio
npm install
npm run dev
# → http://localhost:5173
```

MSW (Mock Service Worker) is automatically started in development. No backend required.

---

## Demo accounts

All use password: **`demo`**

| Role | Email |
|------|-------|
| Inside Sales | `carlos.hernandez@juniperlandscaping.com` |
| Outside Sales | `maria.garcia@juniperlandscaping.com` |
| Estimator | `david.lee@juniperlandscaping.com` |
| Branch Manager | `robert.chen@juniperlandscaping.com` |

---

## Tech stack

| Concern | Library |
|---------|---------|
| Framework | React 19 + Vite 8 |
| Components | Radix UI primitives + Tailwind v4 |
| State | Zustand |
| Server state | TanStack Query v5 |
| Routing | React Router v7 |
| Drag-and-drop | @dnd-kit/core |
| Map | react-leaflet + Leaflet |
| Charts | Recharts |
| Mock API | MSW (Mock Service Worker) |
| Types | TypeScript 6 |
| Tests | Vitest + React Testing Library |

---

## File reference

### Entry points

| File | Description |
|------|-------------|
| `src/main.tsx` | App entry point. Conditionally boots MSW in dev before mounting React. |
| `src/App.tsx` | Root component. Wraps the app in `QueryClientProvider` (TanStack Query) and `RouterProvider`. |
| `src/router.tsx` | Defines all client-side routes using `createBrowserRouter`. Maps paths to page components; wraps every authenticated route in `RequireAuth` and role-specific guards. |
| `src/guards.tsx` | Three route guard wrappers — `InsideSalesGuard`, `OutsideSalesGuard`, `ManagerGuard` — each composing `RequireAuth` + `RoleGate` for the appropriate role set. |
| `src/index.css` | Global CSS custom properties (color tokens, spacing, dark-mode variables). |
| `src/App.css` | App-level baseline resets and utility classes. |

---

### API layer — `src/api/`

| File | Description |
|------|-------------|
| `client.ts` | Thin fetch wrapper (`apiClient`). Reads the auth token from `authStore`, attaches `Authorization: Bearer` headers, throws a typed `ApiError` on non-2xx responses. Exposes `get`, `post`, `patch`, `delete`. |
| `leads.ts` | All lead and outreach endpoints: `leadsApi.list` (paginated + filtered), `.get`, `.create`, `.patch`, `.handoff`; `outreachApi.history` and `.send`. |
| `bids.ts` | Bid, user, and dashboard endpoints: `bidsApi.list/create/patch`; `usersApi.list`; `dashboardApi.insideSales`. |
| `analytics.ts` | `analyticsApi.getRevenueAnalytics` — fetches monthly revenue data for charts. |

---

### Zustand stores — `src/store/`

| File | Description |
|------|-------------|
| `authStore.ts` | Persisted store (localStorage key `studio-auth`). Holds the authenticated `AuthUser` (id, name, email, role, token). Exposes `login`, `logout`, `setLoading`. Token is excluded from persistence. |
| `leadsStore.ts` | Ephemeral store for the Public Leads UI state: active filters (search, lead types, states, min score, assigned/unassigned toggles), sort field + direction, and current page. Optimistic updates are handled by TanStack Query in `useLeads.ts` via `onMutate`/`onSuccess`. |
| `uiStore.ts` | Global UI state: theme (`light`/`dark`/`system`), sidebar collapsed state, selected lead id, and a toast queue with auto-dismiss at 4.5 s. |

---

### Custom hooks — `src/hooks/`

| File | Description |
|------|-------------|
| `useLeads.ts` | TanStack Query hooks for leads: `useLeads` (list, reads filter/sort/page from `leadsStore`), `useLead` (single), `useAllLeads` (up to 100 for map), `useOutreachHistory`, `useCreateLead`, `useUpdateLead`, `useSendOutreach`, `useHandoffLead`. All mutations emit toasts on success/error. |
| `useBids.ts` | TanStack Query hooks for bids and supporting data: `useBids`, `useBidByLeadId`, `useCreateBid`, `useUpdateBid`, `useUsers`, `useInsideSalesDashboard` (auto-refetches every 60 s). |
| `useAnalytics.ts` | `useRevenueAnalytics` — fetches monthly revenue data, stale after 60 s. |
| `useRole.ts` | Reads the authenticated role from `authStore` and returns boolean flags (`isInsideSales`, `isOutsideSales`, etc.) plus a `canAccess(roles)` helper. Branch managers pass all role checks. |
| `useTheme.ts` | Syncs `uiStore` theme to the `<html>` `dark` class. Listens to `prefers-color-scheme` media query when theme is `system`. |
| `useLeadPanelKeyboard.ts` | Keyboard shortcuts for the lead detail panel — arrow key navigation between leads, Escape to close. |
| `useOutreachDrafts.ts` | Manages email and LinkedIn draft state locally before submission. Persists edits across panel opens for the same lead. |

---

### Components — `src/components/`

#### Layout — `src/components/layout/`

| File | Description |
|------|-------------|
| `AppShell.tsx` | Top-level shell. Renders `Sidebar` + `<Outlet>`, mounts the global toast stack, and initialises the theme hook. |
| `Sidebar.tsx` | Collapsible left nav. Role-filters nav items so each role only sees relevant links. Displays user avatar + name; handles logout. |
| `TopNav.tsx` | Per-page top bar. Accepts `title` and `subtitle` props; renders the page heading. |
| `PageHeader.tsx` | Simple heading + optional description block used inside page content areas. |

#### Shared — `src/components/shared/`

| File | Description |
|------|-------------|
| `LeadCard.tsx` | Summary card for a single lead — property name, city/state, lead type badge, score meter, estimated value, and status badge. |
| `ScoreMeter.tsx` / `ScoreMeter.css` | Circular progress ring that visualizes a lead's 0–100 score with a color ramp (green ≥ 75, amber ≥ 50, red < 50). |
| `StatusBadge.tsx` | Pill badge for `LeadStatus` values, styled via `STATUS_COLORS` constants. |
| `LeadTypeBadge.tsx` | Pill badge for `LeadType` (RFP, HOA, Commercial), styled via `LEAD_TYPE_COLORS` constants. |
| `DeadlineChip.tsx` | Displays days-until-deadline; changes color as deadline approaches (red ≤ 3 d, amber ≤ 7 d). Recalculates every 10 min without a page refresh. |
| `AssigneeAvatar.tsx` | Avatar circle showing a user's initials or photo, with optional tooltip. |
| `SlideOverPanel.tsx` | Accessible slide-in panel (right-anchored drawer) used to display the Lead Detail view. |
| `EmptyState.tsx` | Centered empty-state block with icon, heading, and optional CTA, used when lists have no results. |
| `LoadingSkeleton.tsx` | Shimmer placeholder blocks shown while data is loading. |
| `LinkedinIcon.tsx` | SVG icon for LinkedIn, used in outreach action buttons. |

#### UI primitives — `src/components/ui/`

Thin wrappers around Radix UI primitives with Tailwind styling applied via CVA (class-variance-authority).

| File | Description |
|------|-------------|
| `button.tsx` / `button-variants.ts` | `Button` component with `variant` (default, destructive, outline, ghost, link) and `size` props. |
| `badge.tsx` / `badge-variants.ts` | `Badge` component for small status labels. |
| `card.tsx` | `Card`, `CardHeader`, `CardContent`, `CardFooter` container components. |
| `input.tsx` | Styled `<input>` with consistent focus ring and dark-mode support. |
| `label.tsx` | Form `<label>` with correct `htmlFor` wiring and Radix Label primitive. |
| `textarea.tsx` | Multi-line `<textarea>` matching input styles. |
| `select.tsx` | Radix `Select` with trigger, content, item, and scroll-button subcomponents. |
| `dialog.tsx` | Radix `Dialog` with overlay, content, header, footer, title, and description subcomponents. |
| `dropdown-menu.tsx` | Radix `DropdownMenu` with trigger, content, item, label, separator subcomponents. |
| `tabs.tsx` | Radix `Tabs` with list, trigger, and content subcomponents. |
| `toast.tsx` | Radix `Toast` with `variant` prop (default, success, error, warning). |
| `tooltip.tsx` | Radix `Tooltip` with provider, trigger, and content subcomponents. |
| `slider.tsx` | Radix `Slider` (used for min-score filter). |
| `switch.tsx` | Radix `Switch` toggle. |
| `scroll-area.tsx` | Radix `ScrollArea` with custom scrollbar styling. |
| `separator.tsx` | Radix `Separator` (horizontal/vertical divider). |

---

### Views — `src/views/`

#### Auth — `src/views/auth/`

| File | Description |
|------|-------------|
| `LoginPage.tsx` | Email + password login form. Posts to `/api/auth/login`, stores the returned `AuthUser` in `authStore`, and redirects to the user's role default route. Shows quick-fill buttons for demo accounts. |
| `RoleGate.tsx` | Two guard components: `RequireAuth` (redirects to `/login` if unauthenticated) and `RoleGate` (redirects to a fallback route if the user's role is not in the allowed list). |

#### Inside Sales — `src/views/inside-sales/`  *(Phase 1 — complete)*

| File | Description |
|------|-------------|
| `index.tsx` | Barrel export for all Inside Sales page components. |
| `DashboardPage.tsx` | Analytics hub. Renders KPI summary cards from `useInsideSalesDashboard` plus six analytics sub-cards (revenue forecast, pipeline, score distribution, team performance, territory heat map, bid deadline tracker). |
| `LeadFeedPage.tsx` | Paginated, filterable, sortable lead list. Reads filter/sort state from `leadsStore`; opens `LeadDetailPanel` on row click. |
| `OutreachQueuePage.tsx` | Shows leads with `status = contacted` that are pending follow-up. Inline actions: Send Now and Snooze 3 days. |
| `BidTrackerPage.tsx` | Table of RFP bids with live deadline countdown chips (via `DeadlineChip`), estimated value, and per-bid status actions. Stats row at top. |
| `PipelinePage.tsx` / `PipelinePage.css` | Kanban board with four columns (New, Contacted, Proposal Sent, Won/Lost). Uses `@dnd-kit` for drag-and-drop between columns. Displays column lead count and total value. |
| `MapPage.tsx` / `MapPage.css` | Leaflet map of all leads plotted as circle markers. Marker color = lead type; radius scales with contract value; opacity dims won/lost/disqualified leads. Filter bar for lead type. Clicking a marker opens `LeadDetailPanel`. |
| `EstimatingPage.tsx` | Tabbed estimating workspace with four tabs: Estimate Queue, Line-Item Editor, Proposal Export, and Margin Analysis. Selecting a queue item auto-navigates to the editor. |
| `components/LeadDetailPanel.tsx` / `.css` | Slide-over detail view for a single lead. Shows address, Google Maps embed, score breakdown tooltip, contact info, AI-drafted email and LinkedIn message (editable), one-click send, status dropdown, disqualify reason, and handoff button. Contains four tabs: Overview, Outreach, History, Bid. |
| `components/OverviewTab.tsx` | Lead detail tab showing property details, contact info, and scoring breakdown. |
| `components/OutreachTab.tsx` | Lead detail tab with AI-drafted email and LinkedIn messages. Wires to `useOutreachDrafts` and `useSendOutreach`. |
| `components/HistoryTab.tsx` | Lead detail tab showing a timeline of status changes, outreach events, and handoffs. |
| `components/BidTab.tsx` | Lead detail tab for RFP bid details — status, deadline, estimated value, and link to the submission. |
| `components/LeadFilters.tsx` | Filter panel: text search, lead type checkboxes, state multi-select, min-score slider, assigned/unassigned toggles, and reset button. Writes to `leadsStore`. |
| `components/HandoffModal.tsx` | Dialog to hand a lead off to an outside sales rep. Selects rep from `useUsers`, pre-populates AI notes, attaches last outreach, and requires SLA confirmation before submitting. |
| `components/AddLeadModal.tsx` | Dialog to manually create a new lead. Form fields: property name, address, city, state, lead type, and contact info. Posts to `/api/leads`. |
| `components/analytics/BidDeadlineTrackerCard.tsx` | Card showing upcoming RFP bid deadlines sorted by urgency. |
| `components/analytics/PipelineAnalyticsCard.tsx` | Bar/funnel chart of leads by pipeline stage with conversion rate stats. |
| `components/analytics/RevenueForecastCard.tsx` | Monthly revenue forecast chart using `useRevenueAnalytics` data. |
| `components/analytics/ScoreDistributionCard.tsx` | Histogram of leads bucketed by score range. |
| `components/analytics/TeamPerformanceCard.tsx` | Per-rep table of leads contacted, proposals sent, and win rate. |
| `components/analytics/TerritoryHeatMapCard.tsx` | Grid or map visualization of lead density and win rates by geographic area. |
| `components/estimating/EstimateQueue.tsx` | List of estimates sorted by priority/deadline. Each row shows lead name, assigned estimator, status, and due date. Emits `onSelect` callback to drive editor navigation. |
| `components/estimating/LineItemEditor.tsx` / `.css` | Editable table of estimate line items (labor, materials, equipment, overhead, subcontractor). Computes per-row margin and running totals. |
| `components/estimating/MarginAnalysis.tsx` / `.css` | Margin breakdown by category with target vs. actual comparison and warning indicators. |
| `components/estimating/ProposalExport.tsx` | Proposal preview and PDF-export trigger. Formats line items, totals, and cover details into a printable layout. |

#### Outside Sales — `src/views/outside-sales/`  *(Phase 2 — scaffold)*

| File | Description |
|------|-------------|
| `index.tsx` | Placeholder page listing the five planned Phase 2 modules (Site Walk Capture, Voice Dictation, Photo Gallery, Proposal Viewer, Submit to Estimating) with descriptions and a "Coming in Phase 2" banner. |

#### Branch Manager — `src/views/branch-manager/`  *(Phase 3 — scaffold)*

| File | Description |
|------|-------------|
| `index.tsx` | Placeholder page listing the six planned Phase 3 modules (Executive Dashboard, Team Performance, Pipeline Analytics, Territory Heat Map, Revenue Forecast, Branch Operations) with a "Coming in Phase 3" banner. |

---

### Mocks — `src/mocks/`

| File | Description |
|------|-------------|
| `handlers.ts` | MSW request handlers for all API endpoints. Implements full filtering, sorting, and pagination logic in-memory using `mockLeads` and `mockBids`. Simulates 300 ms network delay. |
| `data.ts` | Seed dataset: 14 mock leads (HOA, RFP, Commercial across AZ), 6 bids, 8 users, outreach history records, dashboard summary stats, and monthly revenue figures. |
| `estimatingData.ts` | Seed dataset for the estimating module: mock `EstimateQueueItem` and `Estimate` records with pre-computed line-item totals and margins. |
| `browser.ts` | Creates the MSW `worker` for browser/dev usage via `setupWorker`. |
| `server.ts` | Creates the MSW `server` for Node/test usage via `setupServer`. |

---

### Types — `src/types/`

| File | Description |
|------|-------------|
| `index.ts` | Core domain types: `LeadType`, `LeadStatus`, `UserRole`, `BidStatus`, `OutreachChannel`, `Lead`, `Bid`, `User`, `AuthUser`, `OutreachHistory`, `InsideSalesSummary`, `MonthlyRevenue`, `ScoreFactor`. |
| `outside-sales.ts` | Phase 2 type stubs: `SiteWalkCapture`, `SitePhoto`, `ProposalDraft`, `ProposalLineItem`. |
| `estimating.ts` | Estimating module types: `EstimateStatus`, `EstimatePriority`, `LineItemCategory`, `LineItem`, `Estimate`, `EstimateQueueItem`, `BidOutcomeLog`, `LossReason`. |

---

### Lib — `src/lib/`

| File | Description |
|------|-------------|
| `utils.ts` | Pure helper functions: `cn` (Tailwind class merger), `formatCurrency` (compact $K/$M), `formatDate`, `formatRelativeTime`, `daysUntil`, `getInitials`, `formatCompact`, `scoreToColor`. |
| `constants.ts` | Shared display constants: `BRAND_GREEN`, `LEAD_TYPE_COLORS`, `STATUS_COLORS`, `BID_STATUS_LABELS`, `LEAD_STATUS_LABELS`, `KANBAN_COLUMNS`, `DISQUALIFY_REASONS`, `PAGE_SIZE`. |

---

### Tests — `src/test/`

| File / Directory | Description |
|------------------|-------------|
| `setup.ts` | Global Vitest setup. Imports `@testing-library/jest-dom`, stubs `ResizeObserver` and `window.matchMedia` for jsdom, and starts/resets/stops the MSW server around each test. |
| `utils.tsx` | Test utility exports: `createQueryClient` (no retries, zero stale time), `createWrapper` (QueryClient + MemoryRouter + TooltipProvider), and `loginAs` helper to seed `authStore`. |
| `api/client.test.ts` | Unit tests for `apiClient` — verifies Authorization header attachment, error propagation, and HTTP method routing. |
| `hooks/useLeads.test.ts` | Tests for all `useLeads` hooks (list, get, create, update, send outreach, handoff). |
| `hooks/useBids.test.ts` | Tests for `useBids`, `useCreateBid`, `useUpdateBid`, `useUsers`, and `useInsideSalesDashboard`. |
| `hooks/useAnalytics.test.ts` | Tests for `useRevenueAnalytics`. |
| `stores/authStore.test.ts` | Tests for login, logout, persistence behavior, and token exclusion from localStorage. |
| `stores/leadsStore.test.ts` | Tests for filter mutations, sort toggle logic, and page reset on filter change. |
| `stores/uiStore.test.ts` | Tests for theme, sidebar, toast queue, and lead selection. |
| `lib/utils.test.ts` | Unit tests for every helper in `utils.ts`. |
| `lib/constants.test.ts` | Snapshot / structure tests for constants. |
| `components/shared/` | Per-component unit tests for `LeadCard`, `ScoreMeter`, `StatusBadge`, `LeadTypeBadge`, `DeadlineChip`, `EmptyState`. |
| `views/auth/LoginPage.test.tsx` | Integration tests for login form submission, validation, error display, and demo account shortcuts. |
| `views/auth/RoleGate.test.tsx` | Tests for redirect behavior when unauthenticated or wrong role. |
| `views/inside-sales/` | Page-level integration tests for Dashboard, Public Leads, Outreach Queue, Bid Tracker, Pipeline, and Estimating pages. |
| `views/inside-sales/components/` | Tests for `LeadDetailPanel` and `LeadFilters`. |
| `router.test.tsx` | Route-level tests verifying default redirect, auth guard, and role-guard redirects. |
| `edge-cases.test.tsx` | Cross-cutting edge-case tests (empty states, loading states, error boundaries). |

---

## Mock API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/leads` | Paginated + sortable + filterable lead list |
| POST | `/api/leads` | Create a new lead |
| GET | `/api/leads/:id` | Single lead |
| PATCH | `/api/leads/:id` | Update status, handoff, etc. |
| POST | `/api/leads/:id/handoff` | Hand off lead to outside sales rep |
| GET | `/api/outreach/:lead_id` | Outreach history |
| POST | `/api/outreach/send` | Send email or LinkedIn |
| GET | `/api/bids` | RFP bid list |
| POST | `/api/bids` | Create a bid |
| PATCH | `/api/bids/:id` | Update bid status |
| GET | `/api/users` | Users (role/branch filter) |
| GET | `/api/dashboard/inside-sales` | Summary stats |
| GET | `/api/analytics/revenue` | Monthly revenue data |
| POST | `/api/auth/login` | Mock login (password: demo) |

---

## Role-based routing

| Role | Default route | Access |
|------|--------------|--------|
| `inside_sales` | `/inside-sales` | Inside Sales views |
| `outside_sales` | `/outside-sales` | Outside Sales view |
| `estimator` | `/inside-sales` | Inside Sales + Estimating views |
| `branch_manager` | `/inside-sales` | All views |
| `executive` | `/branch-manager` | Branch Manager view |

---

## Connecting to the real FastAPI backend

1. Remove the `await enableMocking()` block in `src/main.tsx`
2. Add `VITE_API_BASE_URL=https://your-api.com` to `.env.local`
3. Update `BASE_URL` in `src/api/client.ts` to `import.meta.env.VITE_API_BASE_URL`
4. Replace mock `/api/auth/login` with Supabase `signInWithPassword` and store JWT in `authStore`
