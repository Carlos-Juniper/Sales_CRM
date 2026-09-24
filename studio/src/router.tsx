import { createBrowserRouter, Navigate, type RouteObject } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { RequireAuth } from '@/views/auth/RoleGate'
import LoginPage from '@/views/auth/LoginPage'
import AuthCallbackPage from '@/views/auth/AuthCallbackPage'
import {
  DashboardPage, LeadFeedPage, MyLeadsPage, ProposalsPage,
  PipelinePage, MapPage, EstimatingPage, CalendarPage,
} from '@/views/inside-sales'
import AccountsPage from '@/views/inside-sales/AccountsPage'
import CommissionsPage from '@/views/inside-sales/CommissionsPage'
import SalesPerformancePage from '@/views/inside-sales/SalesPerformancePage'
import { SettingsPage } from '@/views/settings/SettingsPage'
import { SalesWorkspaceGuard, PublicLeadsGuard, EstimatingGuard, AnalyticsGuard, HomeRedirect } from '@/guards'
import ProposalPrintRoute from '@/views/inside-sales/components/estimating/ProposalPrintRoute'
import ProposalPreviewRoute from '@/views/inside-sales/components/estimating/ProposalPreviewRoute'
import { LegacyBidsRedirect } from '@/views/inside-sales/LegacyBidsRedirect'

// DEV-only routes. `import.meta.env.DEV` is replaced with a literal `false` in a
// production build, so this ternary collapses to `[]` and the dynamic import
// inside it becomes unreachable — Rollup drops the module, its chunk, and the
// fixture data it pulls in. Same gating convention as main.tsx's mock worker and
// mocks/handlers.ts. Keep the import dynamic: a static one would tie the dev
// page's module (and its CSS side effects) into the main graph.

const devRoutes: RouteObject[] = import.meta.env.DEV
  ? [
      {
        // Live visual diff of <ProposalPreview> against the rasterized Coral Bay
        // reference pages. Fixture-driven — no API, no auth, no DB row — so it
        // mounts outside RequireAuth and outside AppShell (a .print-page is a
        // fixed 816px and any narrower ancestor clips it).
        path: '/dev/proposal-fidelity',
        lazy: async () => ({
          Component: (await import('@/views/dev/ProposalFidelityPage')).default,
        }),
      },
    ]
  : []

export const router = createBrowserRouter([
  ...devRoutes,
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/auth/callback',
    element: <AuthCallbackPage />,
  },
  // Both proposal document surfaces mount outside AppShell: a .print-page is a
  // fixed 8.5in (816px), and any ancestor narrower than that clips it instead
  // of scaling it. AppShell's sidebar plus the lead panel left ~624px, which
  // cut the right quarter off every page.
  //
  // The print route carries no auth guard by design — api/proposals.py gates it
  // by session cookie or render-scoped token, which is how headless Chromium
  // reaches it. The preview route is for humans, so it requires a real session.
  {
    path: '/proposals/:id/print',
    element: <ProposalPrintRoute />,
  },
  {
    path: '/proposals/:id/preview',
    element: <RequireAuth><ProposalPreviewRoute /></RequireAuth>,
  },
  {
    path: '/',
    element: <RequireAuth><AppShell /></RequireAuth>,
    children: [
      {
        index: true,
        element: <HomeRedirect />,
      },
      // Inside Sales
      {
        path: 'inside-sales',
        element: <AnalyticsGuard><DashboardPage /></AnalyticsGuard>,
      },
      {
        path: 'inside-sales/leads',
        element: <PublicLeadsGuard><LeadFeedPage /></PublicLeadsGuard>,
      },
      {
        path: 'inside-sales/my-leads',
        element: <SalesWorkspaceGuard><MyLeadsPage /></SalesWorkspaceGuard>,
      },
      {
        path: 'inside-sales/proposals',
        element: <SalesWorkspaceGuard><ProposalsPage /></SalesWorkspaceGuard>,
      },
      {
        path: 'inside-sales/bids',
        element: <LegacyBidsRedirect />,
      },
      {
        path: 'inside-sales/pipeline',
        element: <SalesWorkspaceGuard><PipelinePage /></SalesWorkspaceGuard>,
      },
      {
        path: 'inside-sales/map',
        element: <SalesWorkspaceGuard><MapPage /></SalesWorkspaceGuard>,
      },
      // The open estimate + active tab are real URL segments (not local
      // state) so a deep link / refresh / back-navigation never loses them —
      // see EstimatingPage.tsx + useEstimatingShell.ts. Four concrete routes
      // (rather than react-router's `:param?` optional-segment syntax) keep
      // matching unambiguous while all four share one element: bare queue,
      // queue at a specific tab (no estimate open — the literal `tab/`
      // segment disambiguates this from `:estimateId`), an open estimate at
      // its default tab, and an open estimate at a specific tab.
      {
        path: 'inside-sales/estimating',
        element: <EstimatingGuard><EstimatingPage /></EstimatingGuard>,
      },
      {
        path: 'inside-sales/estimating/tab/:tab',
        element: <EstimatingGuard><EstimatingPage /></EstimatingGuard>,
      },
      {
        path: 'inside-sales/estimating/:estimateId',
        element: <EstimatingGuard><EstimatingPage /></EstimatingGuard>,
      },
      {
        path: 'inside-sales/estimating/:estimateId/:tab',
        element: <EstimatingGuard><EstimatingPage /></EstimatingGuard>,
      },
      {
        path: 'inside-sales/accounts',
        element: <SalesWorkspaceGuard><AccountsPage /></SalesWorkspaceGuard>,
      },
      {
        path: 'inside-sales/calendar',
        element: <SalesWorkspaceGuard><CalendarPage /></SalesWorkspaceGuard>,
      },
      {
        path: 'inside-sales/commissions',
        element: <SalesWorkspaceGuard><CommissionsPage /></SalesWorkspaceGuard>,
      },
      {
        path: 'inside-sales/sales-performance',
        element: <SalesWorkspaceGuard><SalesPerformancePage /></SalesWorkspaceGuard>,
      },
      // Branch Manager (Slice 12: BranchManagerPage deleted; old bookmarks redirect to settings)
      {
        path: 'branch-manager',
        element: <Navigate to="/settings" replace />,
      },
      // Settings — new shell (Slice 9): section nav, permission filtering,
      // branch picker. Deep-linkable per section and per branch. Section CONTENT
      // is filled by Slices 10–12; BranchManagerPage + the standalone
      // connections route are removed in Slice 12 (not deleted here).
      {
        path: 'settings',
        element: <RequireAuth><SettingsPage /></RequireAuth>,
      },
      {
        path: 'settings/:section',
        element: <RequireAuth><SettingsPage /></RequireAuth>,
      },
      {
        path: 'settings/branch/:aspireBranchId/:section',
        element: <RequireAuth><SettingsPage /></RequireAuth>,
      },
      // Slice 12: standalone /inside-sales/settings/connections route removed;
      // the connections UI now lives at /settings/connections (Mine section).
      {
        path: 'inside-sales/settings/connections',
        element: <Navigate to="/settings/connections" replace />,
      },
      // Catch-all
      {
        path: '*',
        element: <Navigate to="/" replace />,
      },
    ],
  },
])
