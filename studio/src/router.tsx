import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { RequireAuth } from '@/views/auth/RoleGate'
import LoginPage from '@/views/auth/LoginPage'
import AuthCallbackPage from '@/views/auth/AuthCallbackPage'
import {
  DashboardPage, LeadFeedPage, BidTrackerPage,
  PipelinePage, MapPage, EstimatingPage, CalendarPage,
} from '@/views/inside-sales'
import AccountsPage from '@/views/inside-sales/AccountsPage'
import { SettingsPage } from '@/views/settings/SettingsPage'
import { InsideSalesGuard } from '@/guards'
import ProposalPrintRoute from '@/views/inside-sales/components/estimating/ProposalPrintRoute'

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/auth/callback',
    element: <AuthCallbackPage />,
  },
  {
    path: '/proposals/:id/print',
    element: <ProposalPrintRoute />,
  },
  {
    path: '/',
    element: <RequireAuth><AppShell /></RequireAuth>,
    children: [
      {
        index: true,
        element: <Navigate to="/inside-sales" replace />,
      },
      // Inside Sales
      {
        path: 'inside-sales',
        element: <InsideSalesGuard><DashboardPage /></InsideSalesGuard>,
      },
      {
        path: 'inside-sales/leads',
        element: <InsideSalesGuard><LeadFeedPage /></InsideSalesGuard>,
      },
      {
        path: 'inside-sales/bids',
        element: <InsideSalesGuard><BidTrackerPage /></InsideSalesGuard>,
      },
      {
        path: 'inside-sales/pipeline',
        element: <InsideSalesGuard><PipelinePage /></InsideSalesGuard>,
      },
      {
        path: 'inside-sales/map',
        element: <InsideSalesGuard><MapPage /></InsideSalesGuard>,
      },
      // The open estimate + active tab are real URL segments (not local
      // state) so a deep link / refresh / back-navigation never loses them —
      // see EstimatingPage.tsx + useEstimatingShell.ts. Three concrete routes
      // (rather than react-router's `:param?` optional-segment syntax) keep
      // matching unambiguous while all three share one element.
      {
        path: 'inside-sales/estimating',
        element: <InsideSalesGuard><EstimatingPage /></InsideSalesGuard>,
      },
      {
        path: 'inside-sales/estimating/:estimateId',
        element: <InsideSalesGuard><EstimatingPage /></InsideSalesGuard>,
      },
      {
        path: 'inside-sales/estimating/:estimateId/:tab',
        element: <InsideSalesGuard><EstimatingPage /></InsideSalesGuard>,
      },
      {
        path: 'inside-sales/accounts',
        element: <InsideSalesGuard><AccountsPage /></InsideSalesGuard>,
      },
      {
        path: 'inside-sales/calendar',
        element: <InsideSalesGuard><CalendarPage /></InsideSalesGuard>,
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
